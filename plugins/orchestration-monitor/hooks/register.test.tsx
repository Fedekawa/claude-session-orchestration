import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PLUGIN = 'orchestration-monitor'
const MODEL = 'claude-opus-5-5'
const band = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} }
const pane = { title: '', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

// The lead at 72% of a 200K window, $1.50 spent, 5-hour limit at 40%.
const lead = (on: On, opened: string[] = []) => {
  mock.clock(on, { now: Date.parse('2026-10-29T15:00:00Z') })
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('session.model', () => ({ value: MODEL }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 144_000, window: 200_000, percent: 72 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 40 }],
      cost: { usd: 1.5 },
    },
  }))
}

// One subagent on the lead's model: spawned, one request of 50K context, finished.
const subagent = async ($: Engine, on: On) => {
  on('agent.spawn', () => ({ model: MODEL, agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }) as never)
  on('turn.step', async function* () {
    const usage = { model: MODEL, input_tokens: 10_000, output_tokens: 2_000, cache_read_input_tokens: 38_000, cache_creation_input_tokens: 0 }
    return { turnId: 'turn', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage } as never
  })
  await $.agent.spawn({ tool_use_id: 't1', prompt: 'p', description: 'Write the parser', subagentType: 'general-purpose', provider: 'engine', parentModel: MODEL, background: false, fork: false } as never)
  const stream = ($.turn.step as (e: unknown) => AsyncIterable<unknown>)({ turnId: 'turn', index: 0, model: MODEL, messageCount: 1, agentId: 'a1' })
  for await (const _ of stream) void _
}

const texts = async ($: Engine, mount: Parameters<Engine['ui']['mount']>[0]) => {
  const ui = await $.ui.mount(mount)
  const all = (await ui.findAll({ type: 'Text' })).map(t => String(t.text))
  await ui.unmount()
  return all.join('\n')
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the band shows the lead's context and limits, no money`, async ($, on) => {
    lead(on)
    const drawn = await texts($, { plugin: PLUGIN, surface, component: 'AbovePrompt', props: band })
    expect(drawn).toContain('72% 😬')
    expect(drawn).toContain('144k of 200k tokens')
    expect(drawn).toContain('5h 40%')
    // Money stays out of sight.
    expect(drawn).not.toContain('$')
  })

  test(`${surface}: a subagent's run shows in the panel and opens it once`, async ($, on) => {
    const opened: string[] = []
    lead(on, opened)
    await subagent($, on)

    const running = await texts($, { plugin: PLUGIN, surface, component: 'Pane', requestId: 'orchestration', props: pane })
    expect(running).toContain('Write the parser')
    expect(running).toContain('🧠 50k (25%)')
    expect(running).toContain('1 working · 0 done')

    await ($.turn.complete as (e: unknown) => Promise<unknown>)({ agentId: 'a1', reason: 'answer', answer: 'ok' })
    const done = await texts($, { plugin: PLUGIN, surface, component: 'Pane', requestId: 'orchestration', props: pane })
    expect(done).toContain('✅')
    expect(done).toContain('0 working · 1 done')
    expect(done).not.toContain('$')
    expect(opened).toEqual(['orchestration'])
  })

  test(`${surface}: a started worker session waits for its report`, async ($, on) => {
    lead(on)
    on('session.receive', (_$, e) => ({ text: e.text }))
    on('tool.call', () => ({ result: 'Started session "Add pagination" (local_abc123).' }) as never)
    await $.tool.call({ tool: 'mcp__ccd_session__start_session', title: 'Add pagination', initiation: 'user_asked' } as never)

    const waiting = await texts($, { plugin: PLUGIN, surface, component: 'Pane', requestId: 'orchestration', props: pane })
    expect(waiting).toContain('⏳')
    expect(waiting).toContain('Add pagination')
    expect(waiting).toContain('waiting for report')

    await ($.session.receive as (e: unknown) => Promise<unknown>)({ origin: { kind: 'unclassified' }, text: '<side-sessions-event> local_abc123 ended its turn' })
    const reported = await texts($, { plugin: PLUGIN, surface, component: 'Pane', requestId: 'orchestration', props: pane })
    expect(reported).toContain('📨')
  })
}

test('the band still draws before the first reply has a context figure', async ($, on) => {
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  const drawn = await texts($, { plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: band })
  expect(drawn).toContain('🧠 Context')
  expect(drawn).toContain('fills in after the next reply')
})
