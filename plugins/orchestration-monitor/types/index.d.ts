export type AgentStatus = 'running' | 'done' | 'failed'

export type AgentRun = {
  id: string
  agentId?: string
  type: string
  description: string
  model: string
  effort?: string
  status: AgentStatus
  startedAt: number
  endedAt?: number
  /** Input plus output of the latest model request: what the agent's window holds. */
  contextTokens: number
  /** Every token of every request, summed. */
  tokens: number
  steps: number
  /** The latest tool the agent called, with a short hint (`Edit register.tsx`). */
  activity?: string
  /** Self-reported by the agent through the `step` tool. */
  stepDone?: number
  stepTotal?: number
  stepNote?: string
}

export type SessionProgress = { done: number; total: number; note: string }

export type WorkerSession = {
  id: string
  title: string
  /** The host's id for it (`local_…`), when its start result named one. */
  sessionId?: string
  startedAt: number
  /** When its latest end-of-turn note arrived; cleared when the orchestrator messages it again. */
  reportedAt?: number
  /** From the `Progress: n/m — note` line its brief asks it to start each recap with. */
  progress?: SessionProgress
  /** From a `Needs input: …` line: what it is waiting on. */
  needsInput?: string
  /** Its git branch: from the brief's `branch <name>`, the start tool's input, or a `Branch:` line in its notes. */
  branch?: string
  /** When its branch was merged (a `git merge` naming it, or the Mark merged button): it leaves the panel. */
  mergedAt?: number
  /** When it was archived: it leaves the panel and no later note brings it back. */
  archivedAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    'orchestration-monitor': {
      agents: Shaped<AgentRun[]>
      sessions: Shaped<WorkerSession[]>
      tick: number
      /** The orchestrator's input tokens this session, how many were read from the prompt cache, and when it last sent a request. */
      cache: { read: number; total: number; lastAt?: number }
      isAutoOpened: boolean
    }
  }
}
