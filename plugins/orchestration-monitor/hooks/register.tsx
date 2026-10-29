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

// Claude's orange, the one colour the mod draws in; everything else is plain or dim.
const ORANGE = '#d97757'
const SPINNER = ['◐', '◓', '◑', '◒']

const mood = (percent: number): string => (percent >= 85 ? '🥵' : percent >= 70 ? '😬' : percent >= 40 ? '🙂' : '😎')

// The window's fill: the engine's own percentage, else worked out from the tokens.
const fillOf = (usage: SessionUsage): number | undefined =>
  usage.context.percent ??
  (usage.context.tokens !== undefined && usage.context.window
    ? Math.round((usage.context.tokens / usage.context.window) * 100)
    : undefined)

const fmtTokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

const fmtTime = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

// A meter of `width` cells, `ratio` of them filled.
const barText = (ratio: number, width: number): [string, string] => {
  const full = Math.round(Math.min(1, Math.max(0, ratio)) * width)
  return ['█'.repeat(full), '░'.repeat(width - full)]
}

const fmtClock = (at: number): string => new Date(at).toTimeString().slice(0, 5)

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
    const at = await read($, tick)
    const usage = await $.session.usage()
    const percent = fillOf(usage)

    // Draw this row with the other mods' bands beneath it. Claude Code's own
    // placeholder ({ type: 'engine' }) is never nested: the desktop drops a band that nests it.
    const drawn = await Promise.resolve(next(e)).catch(() => null)
    const below = drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? drawn : null

    const { Box, Text, Button } = $.ui.resolve(e)
    const bar = (ratio: number, w: number) => {
      const [full, empty] = barText(ratio, w)
      return (
        <Box flexDirection="row">
          <Text color={ORANGE}>{full}</Text>
          <Text dimColor>{empty}</Text>
        </Box>
      )
    }
    const list = await read($, agents)
    const workers = await read($, sessions)
    const running = list.filter(a => a.status === 'running').length
    const waiting = workers.filter(s => !s.reportedAt).length
    const limits = limitsText(usage)
    const crew = [running > 0 && `🤖 ${running} working`, waiting > 0 && `🛰️ ${waiting} waiting`].filter(Boolean).join(' · ')
    const width = Math.max(8, Math.min(24, e.props.bodyColumns - 72))

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text bold color={ORANGE}>
            🧠 Context
          </Text>
          {percent === undefined ? (
            <Text dimColor>fills in after the next reply</Text>
          ) : (
            <Box flexDirection="row" gap={1}>
              {bar(percent / 100, width)}
              <Text bold color={ORANGE}>
                {percent}% {mood(percent)}
              </Text>
              <Text dimColor>
                {fmtTokens(usage.context.tokens ?? 0)} of {fmtTokens(usage.context.window)} tokens
              </Text>
            </Box>
          )}
          {limits && <Text dimColor>⏱ {limits}</Text>}
          <Button
            key="orchestration-open"
            label={running > 0 ? `${SPINNER[Math.floor(at / 1000) % SPINNER.length]} ${crew}` : crew || '🔭 Orchestration'}
            plain
            onPress={() => void togglePane($)}
          />
        </Box>
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const bar = (ratio: number, w: number) => {
      const [full, empty] = barText(ratio, w)
      return (
        <Box flexDirection="row">
          <Text color={ORANGE}>{full}</Text>
          <Text dimColor>{empty}</Text>
        </Box>
      )
    }
    const at = Math.max(await read($, tick), await $.clock.now())
    const usage = await $.session.usage({ breakdown: 'summary', columns: e.props.bodyColumns })
    const list = await read($, agents)
    const workers = await read($, sessions)
    const percent = fillOf(usage) ?? 0
    const window = usage.context.window
    const leadModel = await $.session.model()
    const used = (usage.context.breakdown?.categories ?? [])
      .filter(c => c.kind === 'used' && c.tokens > 0)
      .sort((a, b) => b.tokens - a.tokens)
    const biggest = used[0]?.tokens ?? 1
    const running = list.filter(a => a.status === 'running').reverse()
    const finished = list.filter(a => a.status !== 'running').reverse()
    const agentTokens = list.reduce((sum, a) => sum + a.tokens, 0)
    const width = Math.max(10, Math.min(40, e.props.bodyColumns - 14))
    const spin = SPINNER[Math.floor(at / 1000) % SPINNER.length]
    const limits = limitsText(usage)

    const agentRow = (a: AgentRun) => {
      // A subagent on the lead's model has the lead's window; for any other only the count is sure.
      const fill = a.model === leadModel && window ? ` (${Math.round((a.contextTokens / window) * 100)}%)` : ''
      const time = fmtTime((a.endedAt ?? at) - a.startedAt)
      const mark = a.status === 'running' ? spin : a.status === 'done' ? '✅' : '💥'
      return (
        <Box key={a.id} flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text color={a.status === 'running' ? ORANGE : undefined}>{mark}</Text>
            <Text bold={a.status === 'running'} wrap="truncate-end">
              {a.description || a.type}
            </Text>
          </Box>
          <Box flexDirection="row" gap={1}>
            <Text> </Text>
            <Text>● {shortModel(a.model)}</Text>
            {a.effort && <Text dimColor>{a.effort}</Text>}
            <Text dimColor wrap="truncate-end">
              {a.type} · 🧠 {fmtTokens(a.contextTokens)}
              {fill} · {fmtTokens(a.tokens)} tokens · ⏱ {time}
            </Text>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text bold color={ORANGE}>
              🧠 Lead
            </Text>
            <Text dimColor>● {shortModel(leadModel)}</Text>
          </Box>
          <Box flexDirection="row" gap={1}>
            {bar(percent / 100, width)}
            <Text bold color={ORANGE}>
              {percent}% {mood(percent)}
            </Text>
          </Box>
          <Text dimColor>
            {fmtTokens(usage.context.tokens ?? 0)} of {fmtTokens(window)} tokens used
          </Text>
          {limits && <Text dimColor>⏱ Usage limits: {limits}</Text>}
          {percent >= 70 && (
            <Text color={ORANGE}>{mood(percent)} Getting full: hand work to a subagent or run /compact.</Text>
          )}
        </Box>

        {used.length > 0 && (
          <Box flexDirection="column">
            <Text bold color={ORANGE}>
              📦 What fills the context
            </Text>
            {used.slice(0, 6).map(c => (
              <Box key={`cat-${c.name}`} flexDirection="row" gap={1}>
                {bar(c.tokens / biggest, 10)}
                <Text>{fmtTokens(c.tokens)}</Text>
                <Text dimColor wrap="truncate-end">
                  {c.name}
                </Text>
              </Box>
            ))}
          </Box>
        )}

        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text bold color={ORANGE}>
              🤖 Subagents
            </Text>
            <Text dimColor>
              {running.length} working · {finished.length} done
              {agentTokens ? ` · ${fmtTokens(agentTokens)} tokens` : ''}
            </Text>
          </Box>
          {list.length === 0 && <Text dimColor>None yet. 💤</Text>}
          {running.map(agentRow)}
          {finished.map(agentRow)}
        </Box>

        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text bold color={ORANGE}>
              🛰️ Worker sessions
            </Text>
            <Text dimColor>{workers.length}</Text>
          </Box>
          {workers.length === 0 && <Text dimColor>None started from here.</Text>}
          {[...workers].reverse().map(s => (
            <Box key={s.id} flexDirection="row" gap={1}>
              <Text>{s.reportedAt ? '📨' : '⏳'}</Text>
              <Text bold={!s.reportedAt} wrap="truncate-end">
                {s.title}
              </Text>
              <Text dimColor>
                started {fmtClock(s.startedAt)}
                {s.reportedAt ? ` · reported ${fmtClock(s.reportedAt)}` : ' · waiting for report'}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
