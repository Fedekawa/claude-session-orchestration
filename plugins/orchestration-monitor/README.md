# orchestration-monitor

A Claude Code mod that shows what an orchestrator session is doing and how much room it has left. It goes with the `session-orchestration` skills and works on its own.

- **Context band**, above the prompt: the lead's context fill (green, amber from 70%, red from 85%), tokens used out of the window, the session's cost, and the rate-limit windows. A button names what is in flight (`2 agents · 1 session`) and opens the panel.
- **Orchestration panel** (`/orchestration` toggles it). It opens by itself the first time the lead delegates.
  - **Lead**: context fill, model, cost, rate limits, and the biggest parts of the context (messages, tools, memory files…), as `/context` estimates them. From 70% it suggests delegating or `/compact`.
  - **Subagents**: running and finished, with type, model, effort, context, total tokens and time. Context shows as a percentage when the subagent runs on the lead's model, so its window is known.
  - **Worker sessions**: sessions the lead started, with when each started and whether its report has come back.

## Limits

- Worker sessions are separate processes, so their tokens and context are not visible here, only that they started and that a report arrived.
- Worker sessions are picked up from the Claude desktop app's session tools (`start_session`, `hand_off_to_session`). Workers started another way, such as `claude -p` in a terminal, do not appear.
- Cost is the session total Claude Code reports, subagents included. There is no per-subagent price.

## Install

```text
/plugin marketplace add Fedekawa/claude-session-orchestration
/plugin install orchestration-monitor@session-orchestration
```

## Develop

```bash
claude plugin validate plugins/orchestration-monitor
claude plugin test plugins/orchestration-monitor
```

Inspired by [savvy-progress](https://github.com/JohnnyVizz/claude-kit/tree/main/plugins/savvy-progress).
