# orchestration-monitor

A Claude Code mod that shows what an orchestrator session is doing and how much room it has left. It goes with the `session-orchestration` skills and works on its own.

"Context" is the lead's context window: how much of what the model can hold at once is already used. When it fills up, Claude Code compacts the conversation and detail is lost, so an orchestrator wants to see it coming.

- **Context band**, above the prompt: an orange meter of the lead's context with a mood (😎 🙂 😬 🥵), tokens used out of the window, and your usage limits (5-hour and 7-day). A button names what is in flight (`🤖 2 working · 🛰️ 1 active · 🙋 1 to check`) and opens the panel.
- **Orchestration panel** (`/orchestration` toggles it), one card per item. It opens by itself the first time the lead delegates.
  - **Lead**: context meter, model, usage limits. From 70% it suggests delegating or `/compact`.
  - **Subagents**: how far each one is (`██░░ 2/4 tokenizer done`), what it is doing right now (`now Edit parser.ts`), model, context, tokens and time.
  - **Worker sessions**: how far each one is, and whether it is working, done, paused without being done, waiting for an answer, or quiet for 10 minutes. The last three get a **👀 Ask the orchestrator to look** button, which sends the lead a message to check on that session and unblock it.

## How progress is reported

- **Subagents**: the mod adds one line to every subagent's brief asking it to call the `step` tool the mod provides, with its plan's size and each step as it finishes. The "now" line needs nothing from the subagent: it is the latest tool it called.
- **Worker sessions**: the mod adds one line to every worker session's brief asking it to start each end-of-turn summary with `Progress: <done>/<total> — <note>`, or `Needs input: <question>` when it stops for an answer. The lead reads that line in the note the desktop app sends when the session ends a turn, so a session's progress moves once per turn, not live.

## Limits

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
