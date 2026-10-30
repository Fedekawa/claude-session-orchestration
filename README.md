# claude-session-orchestration

A Claude Code marketplace, `session-orchestration`, with two plugins for running an orchestrator session with worker sessions.

| Plugin | What it is |
|---|---|
| [`orchestrator-workers`](plugins/orchestrator-workers/README.md) | Skills and agents: how to split work, brief workers, keep them isolated, review what comes back, integrate it, and keep the docs honest. Plain Markdown. |
| [`orchestration-monitor`](plugins/orchestration-monitor/README.md) | An optional mod: the orchestrator's cache timing and usage limits above the prompt, and an `/orchestration` panel with each subagent's and worker session's progress. Ships a TypeScript hooks module. |

![orchestration-monitor in the Claude desktop app: the cache band above the prompt and the orchestration panel](plugins/orchestration-monitor/assets/screenshot.webp)

## Install

In Claude Code:

```text
/plugin marketplace add Fedekawa/claude-session-orchestration
/plugin install orchestrator-workers@session-orchestration
/plugin install orchestration-monitor@session-orchestration
```

`orchestrator-workers` used to be called `session-orchestration`. The marketplace renames existing installs; run its install line once.

## Contributing

Issues and pull requests are welcome. Keep changes small and in the spirit of the repo: the simplest thing that works, general enough for anyone's project, and no mention of a specific company, client or private tool. A change to a plugin's skills, agents or code raises the `version` in that plugin's `.claude-plugin/plugin.json`, or installed copies never see it.

## License

MIT. See [LICENSE](LICENSE).
