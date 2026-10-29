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
}

export type WorkerSession = {
  id: string
  title: string
  /** The host's id for it (`local_…`), when its start result named one. */
  sessionId?: string
  startedAt: number
  reportedAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    'orchestration-monitor': {
      agents: Shaped<AgentRun[]>
      sessions: Shaped<WorkerSession[]>
      tick: number
      isAutoOpened: boolean
    }
  }
}
