# orchestration-monitor

A Claude Code mod that shows what an orchestrator session is doing, how much room it has left and whether its cache is still warm. It goes with the `session-orchestration` skills and works on its own.

"Context" is the orchestrator's context window: how much of what the model can hold at once is already used. When it fills up, Claude Code compacts the conversation and detail is lost, so an orchestrator wants to see it coming.

- **Cache band**, above the prompt:
  - ♻️ **Cache**: how long the orchestrator's prompt cache stays warm, as a meter counting down the hour since its last request (`warm 47m more`), then `❄️ cold` once it has expired, when the next reply sends the whole conversation again (slower, and it counts more against your limits). Beside it, the share of input tokens read from the cache this session (`92% hit`).
  - 🕐 how long this session has been running.
  - 📊 **limits**: how much of your plan's 5-hour and 7-day usage allowance is used.
  - A button that names what is in flight (`🤖 2 working · 🛰️ 1 active · 🙋 1 to check`) and opens the panel.
- **Orchestration panel** (`/orchestration` toggles it), one card per item. It opens by itself the first time the orchestrator delegates.
  - **Orchestrator**: context meter, model, cache hit rate, session age, usage limits. From 70% it suggests delegating or `/compact`.
  - **Subagents**: only the running ones, and any that failed; a finished one leaves the panel and is counted in the heading. Each card shows how far it is (`██░░ 2/4 tokenizer done`), what it is doing right now (`now Edit parser.ts`), model, context, tokens and how long it has run (🕐).
  - **Worker sessions**: the open ones (a finished one leaves the panel and is counted in the heading), each with how far it is, and whether it is working, paused without being done, waiting for an answer, or quiet for 10 minutes. The last three get a **👀 Ask the orchestrator to look** button, which sends the orchestrator a message to check on that session and unblock it.

## How progress is reported

- **Subagents**: the mod adds one line to every subagent's brief asking it to call the `step` tool the mod provides, with its plan's size and each step as it finishes. The "now" line needs nothing from the subagent: it is the latest tool it called.
- **Worker sessions**: the mod adds one line to every worker session's brief asking it to start each end-of-turn summary with `Progress: <done>/<total> — <note>`, or `Needs input: <question>` when it stops for an answer. The orchestrator reads that line in the note the desktop app sends when the session ends a turn, so a session's progress moves once per turn, not live.

## Limits

- The cache countdown assumes 1-hour cache entries, which Claude Code writes on a subscription. A session writing 5-minute entries goes cold sooner than shown.
- Worker sessions are separate processes, so their tokens and context are not visible here: only what their end-of-turn notes say.
- Worker sessions are picked up from the Claude desktop app's session tools (`start_session`, `hand_off_to_session`). Workers started another way, such as `claude -p` in a terminal, do not appear. The note format is the desktop app's; if it changes, sessions stay at "working".

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
