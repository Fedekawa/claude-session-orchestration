import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { AgentRun, WorkerSession } from '../types'

const PANE = 'orchestration'
// Change a tag when that list's fields change: it declines what an earlier
// version stored, which outlives a reload.
const agents = atom({ plugin: 'orchestration-monitor', key: 'agents' } as const, [], { shape: 'agents-1' })
const sessions = atom({ plugin: 'orchestration-monitor', key: 'sessions' } as const, [], { shape: 'sessions-1' })
// Written to redraw: after each lead request (the context changed) and each second while agents run.
const tick = atom({ plugin: 'orchestration-monitor', key: 'tick' } as const, 0)
const isAutoOpened = atom({ plugin: 'orchestration-monitor', key: 'isAutoOpened' } as const, false)

// The desktop app's session tools; other hosts start workers in ways a mod cannot see.
const SESSION_TOOLS = /^mcp__ccd_session__(start_session|hand_off_to_session)$/

const OK = '#5fbf8f'
const WARN = '#e0a23a'
const HOT = '#e5534b'

const fmtTokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

const fmtTime = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

const fmtClock = (at: number): string => new Date(at).toTimeString().slice(0, 5)

const heat = (percent: number): string => (percent >= 85 ? HOT : percent >= 70 ? WARN : OK)

const shortModel = (model: string): string => model.replace(/^claude-/, '').replace(/-\d{8}$/, '')

function limitsText(usage: SessionUsage): string {
  const names: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }
  return usage.rateLimits.map(r => `${names[r.kind] ?? r.kind} ${Math.round(r.percentUsed)}%`).join(' · ')
}

async function openPane($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  await update($, tick, () => now)
  await $.ui.open({ id: PANE, title: 'Orchestration' })
}

async function togglePane($: EngineInterface): Promise<boolean> {
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    return false
  }
  await openPane($)
  return true
}

// Opens the panel by itself once per session, the first time the lead delegates.
async function autoOpen($: EngineInterface): Promise<void> {
  if (await read($, isAutoOpened)) return
  await update($, isAutoOpened, () => true)
  void openPane($)
}

async function markReported($: EngineInterface, text: string): Promise<void> {
  const list = await read($, sessions)
  if (!list.some(s => s.sessionId && !s.reportedAt && text.includes(s.sessionId))) return
  const at = await $.clock.now()
  await update($, sessions, all =>
    all.map(s => (s.sessionId && !s.reportedAt && text.includes(s.sessionId) ? { ...s, reportedAt: at } : s)),
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'orchestration',
      description: "Show or hide the orchestration panel: the lead's context, its subagents and worker sessions",
    })
    // Ticks the running agents' clocks; quiet when nothing runs.
    $.clock.every(1000, () => {
      void (async () => {
        if (!(await read($, agents)).some(a => a.status === 'running')) return
        const at = await $.clock.now()
        await update($, tick, () => at)
      })()
    })
    return started
  })

  on('command.run', { command: 'orchestration' }, async $ => {
    const isOpen = await togglePane($)
    return { text: isOpen ? 'Orchestration panel opened.' : 'Orchestration panel closed.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined) return started

    const at = await $.clock.now()
    const run: AgentRun = {
      id: started.agentId ?? e.tool_use_id,
      agentId: started.agentId,
      type: e.subagentType,
      description: e.description,
      model: started.model,
      status: 'running',
      startedAt: at,
      contextTokens: 0,
      tokens: 0,
      steps: 0,
    }
    await update($, agents, list => [...list.filter(a => a.id !== run.id), run].slice(-100))
    await autoOpen($)
    return started
  })

  // Each model request: a subagent's live context and tokens, or a redraw for the lead's.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const agentId = e.agentId
    const usage = result.usage
    if (!agentId) {
      const now = await $.clock.now()
      await update($, tick, () => now)
      return result
    }
    if (!usage) return result

    const sum =
      (usage.input_tokens || 0) +
      (usage.cache_read_input_tokens || 0) +
      (usage.cache_creation_input_tokens || 0) +
      (usage.output_tokens || 0)
    await update($, agents, list =>
      list.map(
        (a): AgentRun =>
          a.agentId !== agentId
            ? a
            : {
                ...a,
                model: usage.model || e.model,
                effort: typeof e.effort === 'string' ? e.effort : a.effort,
                contextTokens: sum,
                tokens: a.tokens + sum,
                steps: a.steps + 1,
              },
      ),
    )
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    const at = await $.clock.now()
    if (agentId) {
      await update($, agents, list =>
        list.map((a): AgentRun => {
          if (a.agentId !== agentId) return a
          // A run whose steps went unseen still gets the turn's own sum.
          const fallback = a.steps === 0 && e.usage
          return {
            ...a,
            status: e.reason === 'answer' ? 'done' : 'failed',
            endedAt: at,
            ...(fallback && e.usage
              ? {
                  tokens:
                    e.usage.input_tokens +
                    e.usage.output_tokens +
                    e.usage.cache_read_input_tokens +
                    e.usage.cache_creation_input_tokens,
                }
              : {}),
          }
        }),
      )
    }
    await update($, tick, () => at)
    return next(e)
  })

  on('tool.call', { tool: SESSION_TOOLS }, async ($, e, next) => {
    const ran = await next(e)
    if (!('result' in ran) || ran.result === undefined) return ran
    const text = typeof ran.result === 'string' ? ran.result : JSON.stringify(ran.result)
    // An offer the user turned down, or a proposal not yet started, names no session.
    const sessionId = text.match(/local_[A-Za-z0-9_-]+/)?.[0]
    if (!sessionId) return ran

    const input = e as unknown as { title?: string }
    const at = await $.clock.now()
    const worker: WorkerSession = { id: e.tool_use_id, title: input.title || sessionId, sessionId, startedAt: at }
    await update($, sessions, list => [...list.filter(s => s.sessionId !== sessionId), worker].slice(-50))
    await autoOpen($)
    return ran
  })

  // A worker's report reaches the lead as a message naming the worker's session id.
  on('prompt.submit', async ($, e, next) => {
    await markReported($, e.text)
    return next(e)
  })
  on('session.receive', async ($, e, next) => {
    if (!e.agentId) await markReported($, e.text)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    await read($, tick)
    const usage = await $.session.usage()
    const percent = usage.context.percent
    if (percent === undefined) return next(e)

    // Draw this row with the other mods' bands beneath it. Claude Code's own
    // placeholder ({ type: 'engine' }) is never nested: the desktop drops a band that nests it.
    const drawn = await Promise.resolve(next(e)).catch(() => null)
    const below = drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? drawn : null

    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, agents)
    const workers = await read($, sessions)
    const running = list.filter(a => a.status === 'running').length
    const waiting = workers.filter(s => !s.reportedAt).length
    const limits = limitsText(usage)
    const crew = [running > 0 && `${running} agent${running === 1 ? '' : 's'}`, waiting > 0 && `${waiting} session${waiting === 1 ? '' : 's'}`]
      .filter(Boolean)
      .join(' · ')

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2}>
          <Text color={heat(percent)}>● ctx {percent}%</Text>
          <Text dimColor>
            {fmtTokens(usage.context.tokens ?? 0)}/{fmtTokens(usage.context.window)}
          </Text>
          {usage.cost && <Text dimColor>${usage.cost.usd.toFixed(2)}</Text>}
          {limits && <Text dimColor>{limits}</Text>}
          <Button key="orchestration-open" label={crew || 'panel'} plain onPress={() => void togglePane($)} />
        </Box>
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const at = Math.max(await read($, tick), await $.clock.now())
    const usage = await $.session.usage({ breakdown: 'summary', columns: e.props.bodyColumns })
    const list = await read($, agents)
    const workers = await read($, sessions)
    const percent = usage.context.percent ?? 0
    const window = usage.context.window
    const leadModel = await $.session.model()
    const used = (usage.context.breakdown?.categories ?? [])
      .filter(c => c.kind === 'used' && c.tokens > 0)
      .sort((a, b) => b.tokens - a.tokens)
    const running = list.filter(a => a.status === 'running').reverse()
    const finished = list.filter(a => a.status !== 'running').reverse()
    const agentTokens = list.reduce((sum, a) => sum + a.tokens, 0)

    const agentRow = (a: AgentRun) => {
      // A subagent on the lead's model has the lead's window; for any other only the count is sure.
      const fill = a.model === leadModel && window ? ` (${Math.round((a.contextTokens / window) * 100)}%)` : ''
      const time = fmtTime((a.endedAt ?? at) - a.startedAt)
      const mark = a.status === 'running' ? '▸' : a.status === 'done' ? '✓' : '✕'
      return (
        <Box key={a.id} flexDirection="column">
          <Text color={a.status === 'failed' ? HOT : undefined} dimColor={a.status === 'done'} wrap="truncate-end">
            {mark} {a.description || a.type}
          </Text>
          <Text dimColor wrap="truncate-end">
            {'  '}
            {a.type} · {shortModel(a.model)}
            {a.effort ? ` ${a.effort}` : ''} · ctx {fmtTokens(a.contextTokens)}
            {fill} · {fmtTokens(a.tokens)} tok · {time}
          </Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>Lead</Text>
          <Text color={heat(percent)}>
            ctx {percent}% · {fmtTokens(usage.context.tokens ?? 0)}/{fmtTokens(window)} · {shortModel(leadModel)}
          </Text>
          <Text dimColor>
            {usage.cost ? `$${usage.cost.usd.toFixed(2)} this session` : ''}
            {usage.cost && usage.rateLimits.length ? ' · ' : ''}
            {limitsText(usage)}
          </Text>
          {used.slice(0, 6).map(c => (
            <Text key={`cat-${c.name}`} dimColor wrap="truncate-end">
              {'  '}
              {c.name}: {fmtTokens(c.tokens)}
            </Text>
          ))}
          {percent >= 70 && <Text color={heat(percent)}>Near auto-compact: delegate or /compact soon.</Text>}
        </Box>

        <Box flexDirection="column">
          <Text bold>
            Subagents · {running.length} running · {finished.length} finished
            {agentTokens ? ` · ${fmtTokens(agentTokens)} tok` : ''}
          </Text>
          {list.length === 0 && <Text dimColor>None yet.</Text>}
          {running.map(agentRow)}
          {finished.map(agentRow)}
        </Box>

        <Box flexDirection="column">
          <Text bold>Worker sessions · {workers.length}</Text>
          {workers.length === 0 && <Text dimColor>None started from here.</Text>}
          {[...workers].reverse().map(s => (
            <Text key={s.id} dimColor={!!s.reportedAt} wrap="truncate-end">
              {s.reportedAt ? '✓' : '…'} {s.title} · started {fmtClock(s.startedAt)}
              {s.reportedAt ? ` · reported ${fmtClock(s.reportedAt)}` : ' · no report yet'}
            </Text>
          ))}
        </Box>
      </Box>
    )
  })
}
