# orchestration-monitor

A Claude Code mod that shows what an orchestrator session is doing and how much room it has left. It goes with the `session-orchestration` skills and works on its own.

"Context" is the lead's context window: how much of what the model can hold at once is already used. When it fills up, Claude Code compacts the conversation and detail is lost, so an orchestrator wants to see it coming.

- **Context band**, above the prompt: an orange meter of the lead's context with a mood (😎 🙂 😬 🥵), tokens used out of the window, and your usage limits (5-hour and 7-day). A button names what is in flight (`🤖 2 working · 🛰️ 1 waiting`) and opens the panel.
- **Orchestration panel** (`/orchestration` toggles it). It opens by itself the first time the lead delegates.
  - **Lead**: context meter, model, usage limits. From 70% it suggests delegating or `/compact`.
  - **What fills the context**: the biggest parts (messages, tools, memory files…) as bars, as `/context` estimates them.
  - **Subagents**: running (with a spinner) and finished, with model, effort, type, context, total tokens and time. Context shows as a percentage when the subagent runs on the lead's model, so its window is known.
  - **Worker sessions**: sessions the lead started, with when each started and whether its report has come back.

## Limits

- Worker sessions are separate processes, so their tokens and context are not visible here, only that they started and that a report arrived.
- Worker sessions are picked up from the Claude desktop app's session tools (`start_session`, `hand_off_to_session`). Workers started another way, such as `claude -p` in a terminal, do not appear.

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
