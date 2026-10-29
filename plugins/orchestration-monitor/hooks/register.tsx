import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, SessionUsage } from 'claude-code'

import type { AgentRun, WorkerSession } from '../types'

const PANE = 'orchestration'
// Change a tag when that list's fields change: it declines what an earlier
// version stored, which outlives a reload.
const agents = atom({ plugin: 'orchestration-monitor', key: 'agents' } as const, [], { shape: 'agents-1' })
const sessions = atom({ plugin: 'orchestration-monitor', key: 'sessions' } as const, [], { shape: 'sessions-1' })
// Written to redraw: after each orchestrator request (the context changed) and each second while work runs.
const tick = atom({ plugin: 'orchestration-monitor', key: 'tick' } as const, 0)
const isAutoOpened = atom({ plugin: 'orchestration-monitor', key: 'isAutoOpened' } as const, false)

// The desktop app's session tools; other hosts start workers in ways a mod cannot see.
const SESSION_TOOLS = /^mcp__ccd_session__(start_session|hand_off_to_session)$/
const STEP_TOOL = 'mcp__orchestration-monitor__step'
// Added to the end of each subagent's brief: a tool listed alone gets skipped, the same ask in the brief is followed.
const STEP_BRIEF = `

Progress reporting: before any other work, call \`${STEP_TOOL}\` with \`total\` (your plan in 3-8 steps) and \`done: 0\`; call it again with \`done\` and a few-word \`note\` as each step finishes. It only draws a progress bar for the orchestrator.`
// Added to the end of each worker session's brief: its end-of-turn note is all the orchestrator hears of it.
const SESSION_BRIEF = `

Progress reporting for the orchestrator: start every end-of-turn summary with one line \`Progress: <done>/<total> — <a few words>\` (your plan in 3-8 steps). If you stop because you need an answer or a decision, start it with \`Needs input: <the question>\` instead.`
// A worker session not heard from for this long gets a Look button.
const QUIET_MS = 10 * 60_000

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

// What a tool call is working on, in a few words: `Edit register.tsx`, `Bash Run the tests`.
function activityOf(tool: string, input: Record<string, unknown>): string {
  const path = [input.file_path, input.path, input.notebook_path].find(v => typeof v === 'string') as string | undefined
  const hint = path?.split('/').pop() ?? [input.description, input.pattern, input.command].find(v => typeof v === 'string')
  const name = tool.replace(/^mcp__[^_]+(?:_[^_]+)*__/, '')
  return hint ? `${name} ${String(hint).slice(0, 60)}` : name
}

// `reason` is fixed wording: the Look prompt sends it as the person's own words.
type SessionState = { mark: string; label: string; reason?: string }

// What the panel can say of a worker session from what reached the orchestrator.
function stateOf(s: WorkerSession, at: number, spin: string): SessionState {
  if (s.needsInput) return { mark: '🙋', label: `needs input: ${s.needsInput}`, reason: 'its last report says it needs input' }
  if (s.progress && s.progress.total > 0 && s.progress.done >= s.progress.total) return { mark: '✅', label: 'done' }
  if (s.reportedAt) {
    return { mark: '📨', label: `paused at ${fmtClock(s.reportedAt)}, not done`, reason: 'it ended its turn without saying it is done' }
  }
  const quiet = at - s.startedAt
  if (quiet >= QUIET_MS) return { mark: '💤', label: `quiet for ${fmtTime(quiet)}`, reason: `nothing heard from it for ${fmtTime(quiet)}` }
  return { mark: spin, label: 'working' }
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

// Opens the panel by itself once per session, the first time the orchestrator delegates.
async function autoOpen($: EngineInterface): Promise<void> {
  if (await read($, isAutoOpened)) return
  await update($, isAutoOpened, () => true)
  void openPane($)
}

// The desktop app tells the orchestrator of a worker's turn on a line of its own,
// `The session "<title>" you started (local_…) finished a turn. It reported (…): "<recap>" …`,
// and of the linked sessions' states on one line, `Linked sessions now (…): name = local_… (idle), …`.
// Only those line starts are the app's: a recap is quoted with its line breaks shown as ⏎,
// so a worker cannot start a line and speak for another session.
const TURN_LINE = /^The session "[^"\n]*" you started \((local_[\w-]+)\) finished a turn\.([^\n]*)$/gm
const LINKED_LINE = /^Linked sessions now[^\n]*$/m

async function hearFrom($: EngineInterface, text: string): Promise<void> {
  const turns = new Map([...text.matchAll(TURN_LINE)].map(m => [m[1] ?? '', m[2] ?? '']))
  const linked = text.match(LINKED_LINE)?.[0] ?? ''
  const working = new Set([...linked.matchAll(/(local_[\w-]+) \(working\)/g)].map(m => m[1]))
  if (turns.size === 0 && working.size === 0) return
  const at = await $.clock.now()
  await update($, sessions, all =>
    all.map((s): WorkerSession => {
      if (!s.sessionId) return s
      const recap = turns.get(s.sessionId)
      if (recap === undefined) {
        // Messaged again by the orchestrator or the user: back at work.
        return working.has(s.sessionId) && s.reportedAt ? { ...s, startedAt: at, reportedAt: undefined, needsInput: undefined } : s
      }
      const progress = recap.match(/Progress:\s*(\d+)\s*\/\s*(\d+)\s*(?:[—–-]\s*([^⏎."]*))?/i)
      const needs = recap.match(/Needs input:\s*([^⏎"]*)/i)?.[1]?.trim()
      return {
        ...s,
        reportedAt: at,
        progress: progress
          ? { done: Number(progress[1]), total: Number(progress[2]), note: (progress[3] ?? '').trim().slice(0, 80) }
          : s.progress,
        needsInput: needs?.slice(0, 120) || undefined,
      }
    }),
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'orchestration',
      description: "Show or hide the orchestration panel: the orchestrator's context, its subagents and worker sessions",
    })
    await $.tool.register({
      name: 'step',
      description:
        "For subagents: report progress on your own task to the orchestrator's panel. " +
        'Right after reading the brief, call it with `total` (your plan in 3-8 steps) and `done: 0`; ' +
        'call it again as each step finishes. Cheap and silent: it only draws a bar.',
      inputSchema: {
        type: 'object',
        properties: {
          done: { type: 'integer', minimum: 0, description: 'Steps finished so far.' },
          total: { type: 'integer', minimum: 1, description: 'Steps planned; may change if the plan changes.' },
          note: { type: 'string', description: 'The step in progress, a few words.' },
        },
        required: ['done'],
      },
      // In every agent's tool list, not behind ToolSearch: agents do not go looking for it.
      isDeferred: false,
    })
    // Ticks the clocks of running agents and of sessions not yet heard from; quiet otherwise.
    $.clock.every(1000, () => {
      void (async () => {
        const isBusy =
          (await read($, agents)).some(a => a.status === 'running') ||
          (await read($, sessions)).some(s => !s.reportedAt && !s.needsInput)
        if (!isBusy) return
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
    const started = await next(e.prompt.includes(STEP_TOOL) ? e : { ...e, prompt: e.prompt + STEP_BRIEF })
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

  // A subagent's own progress: the call runs in its loop, so agentId names it.
  on('tool.call', { tool: STEP_TOOL }, async ($, e) => {
    const input = e as unknown as { done?: number; total?: number; note?: string }
    const agentId = e.agentId
    if (!agentId) return { result: 'ignored: only subagents report steps' }
    await update($, agents, list =>
      list.map((a): AgentRun => {
        if (a.agentId !== agentId) return a
        const total = Math.max(0, Math.round(input.total ?? a.stepTotal ?? 0))
        const done = Math.max(0, Math.round(input.done ?? a.stepDone ?? 0))
        return { ...a, stepTotal: total, stepDone: total ? Math.min(total, done) : done, stepNote: input.note?.trim().slice(0, 80) || undefined }
      }),
    )
    return { result: 'ok' }
  })

  // What each subagent is doing right now.
  on('tool.call', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId && e.tool !== STEP_TOOL) {
      const activity = activityOf(e.tool, e as unknown as Record<string, unknown>)
      await update($, agents, list => list.map(a => (a.agentId === agentId ? { ...a, activity } : a)))
    }
    return next(e)
  })

  // Each model request: a subagent's live context and tokens, or a redraw for the orchestrator's.
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
    const input = e as unknown as { title?: string; prompt?: string }
    const needsBrief = typeof input.prompt === 'string' && !input.prompt.includes('Progress: <done>/<total>')
    const ran = await next(needsBrief ? ({ ...e, prompt: input.prompt + SESSION_BRIEF } as typeof e) : e)
    if (!('result' in ran) || ran.result === undefined) return ran
    const text = typeof ran.result === 'string' ? ran.result : JSON.stringify(ran.result)
    // An offer the user turned down, or a proposal not yet started, names no session.
    const sessionId = text.match(/local_[A-Za-z0-9_-]+/)?.[0]
    if (!sessionId) return ran

    const at = await $.clock.now()
    const worker: WorkerSession = { id: e.tool_use_id, title: input.title || sessionId, sessionId, startedAt: at }
    await update($, sessions, list => [...list.filter(s => s.sessionId !== sessionId), worker].slice(-50))
    await autoOpen($)
    return ran
  })

  // The orchestrator writing to a worker sets it going again.
  on('tool.call', { tool: 'SendMessage' }, async ($, e, next) => {
    const to = String((e as unknown as { to?: unknown }).to ?? '')
    const at = await $.clock.now()
    await update($, sessions, all =>
      all.map(s => (s.sessionId && to.includes(s.sessionId) ? { ...s, startedAt: at, reportedAt: undefined, needsInput: undefined } : s)),
    )
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await hearFrom($, e.text)
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
    const spin = SPINNER[Math.floor(at / 1000) % SPINNER.length] ?? ''
    const running = list.filter(a => a.status === 'running').length
    const states = workers.map(s => stateOf(s, at, spin))
    const active = states.filter(s => s.label === 'working').length
    const needYou = states.filter(s => s.reason).length
    const limits = limitsText(usage)
    const crew = [
      running > 0 && `🤖 ${running} working`,
      active > 0 && `🛰️ ${active} active`,
      needYou > 0 && `🙋 ${needYou} to check`,
    ]
      .filter(Boolean)
      .join(' · ')
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
            label={running + active > 0 ? `${spin} ${crew}` : crew || '🔭 Orchestration'}
            plain
            onPress={() => void togglePane($)}
          />
        </Box>
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
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
    const at = Math.max(await read($, tick), await $.clock.now())
    const usage = await $.session.usage()
    const list = await read($, agents)
    const workers = await read($, sessions)
    const percent = fillOf(usage) ?? 0
    const window = usage.context.window
    const orchestratorModel = await $.session.model()
    const running = list.filter(a => a.status === 'running').reverse()
    const finished = list.filter(a => a.status !== 'running').reverse()
    const agentTokens = list.reduce((sum, a) => sum + a.tokens, 0)
    // A card's border and padding take 4 columns, the count beside a meter about 8.
    const width = Math.max(10, Math.min(40, e.props.bodyColumns - 18))
    const spin = SPINNER[Math.floor(at / 1000) % SPINNER.length] ?? ''
    const limits = limitsText(usage)

    const card = (key: string, isLit: boolean, children: RenderChildren) => (
      <Box key={key} flexDirection="column" borderStyle="round" borderColor={isLit ? ORANGE : undefined} borderDimColor={!isLit} paddingX={1}>
        {children}
      </Box>
    )
    const heading = (title: string, detail: string) => (
      <Box flexDirection="row" gap={1}>
        <Text bold color={ORANGE}>
          {title}
        </Text>
        <Text dimColor>{detail}</Text>
      </Box>
    )
    const steps = (done: number, total: number, note: string) => (
      <Box flexDirection="row" gap={1}>
        {bar(done / total, width)}
        <Text bold color={ORANGE}>
          {done}/{total}
        </Text>
        {note && (
          <Text dimColor wrap="truncate-end">
            {note}
          </Text>
        )}
      </Box>
    )

    const agentCard = (a: AgentRun) => {
      // A subagent on the orchestrator's model has the orchestrator's window; for any other only the count is sure.
      const fill = a.model === orchestratorModel && window ? ` (${Math.round((a.contextTokens / window) * 100)}%)` : ''
      const time = fmtTime((a.endedAt ?? at) - a.startedAt)
      const mark = a.status === 'running' ? spin : a.status === 'done' ? '✅' : '💥'
      return card(
        a.id,
        a.status === 'running',
        <>
          <Box flexDirection="row" gap={1}>
            <Text color={a.status === 'running' ? ORANGE : undefined}>{mark}</Text>
            <Text bold wrap="truncate-end">
              {a.description || a.type}
            </Text>
          </Box>
          {a.stepTotal ? steps(a.stepDone ?? 0, a.stepTotal, a.stepNote ?? '') : null}
          {a.status === 'running' && a.activity && (
            <Box flexDirection="row" gap={1}>
              <Text color={ORANGE}>now</Text>
              <Text wrap="truncate-end">{a.activity}</Text>
            </Box>
          )}
          <Text dimColor wrap="truncate-end">
            ● {shortModel(a.model)}
            {a.effort ? ` ${a.effort}` : ''} · 🧠 {fmtTokens(a.contextTokens)}
            {fill} · {fmtTokens(a.tokens)} tokens · ⏱ {time}
          </Text>
        </>,
      )
    }

    const sessionCard = (s: WorkerSession) => {
      const state = stateOf(s, at, spin)
      const look = `Check on worker session ${s.sessionId}: ${state.reason}. Read its latest report with get_session, then unblock it or tell me what it needs.`
      return card(
        s.id,
        state.reason !== undefined,
        <>
          <Box flexDirection="row" gap={1}>
            <Text color={ORANGE}>{state.mark}</Text>
            <Text bold wrap="truncate-end">
              {s.title}
            </Text>
          </Box>
          {s.progress && s.progress.total > 0 && steps(s.progress.done, s.progress.total, s.progress.note)}
          <Text dimColor wrap="truncate-end">
            {state.label} · started {fmtClock(s.startedAt)}
          </Text>
          {state.reason && (
            <Button key={`look-${s.id}`} label="👀 Ask the orchestrator to look" onPress={() => void $.prompt.submit({ text: look, asUser: true })} />
          )}
        </>,
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {card(
          'orchestrator',
          percent >= 70,
          <>
            {heading('🧠 Orchestrator', `● ${shortModel(orchestratorModel)}`)}
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
          </>,
        )}

        <Box flexDirection="column">
          {heading(
            '🤖 Subagents',
            `${running.length} working · ${finished.length} done${agentTokens ? ` · ${fmtTokens(agentTokens)} tokens` : ''}`,
          )}
          {list.length === 0 && <Text dimColor>None yet. 💤</Text>}
          {running.map(agentCard)}
          {finished.map(agentCard)}
        </Box>

        <Box flexDirection="column">
          {heading('🛰️ Worker sessions', String(workers.length))}
          {workers.length === 0 && <Text dimColor>None started from here.</Text>}
          {[...workers].reverse().map(sessionCard)}
        </Box>
      </Box>
    )
  })
}
