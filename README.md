# claude-session-orchestration

A Claude Code marketplace, `session-orchestration`, with two plugins for running an orchestrator session with worker sessions.

| Plugin | What it is |
|---|---|
| [`orchestrator-workers`](plugins/orchestrator-workers/README.md) | Skills and agents: how to split work, brief workers, keep them isolated, review what comes back, integrate it, and keep the docs honest. Plain Markdown. |
| [`orchestration-monitor`](plugins/orchestration-monitor/README.md) | An optional mod: the orchestrator's cache timing and usage limits above the prompt, and an `/orchestration` panel with each subagent's and worker session's progress. Ships a TypeScript hooks module. |

![orchestration-monitor in the Claude desktop app: the cache band above the prompt and the orchestration panel](plugins/orchestration-monitor/assets/screenshot.webp)

## How it works

One session, the **orchestrator**, owns the goal. It splits off only the parts that are truly independent, hands each one to a **worker** (a subagent or its own session) with a self-contained brief, then verifies every worker's report against the actual diff before integrating. You make the final call.

```mermaid
---
config:
  flowchart:
    wrappingWidth: 260
---
flowchart TD
    user(["You give the goal"])

    subgraph P1 ["① ORCHESTRATOR PLANS"]
        plan["Split only if parts are<br/>independent, in separate<br/>files, and checkable.<br/>Write one brief per worker."]
    end

    subgraph P2 ["② WORKERS BUILD"]
        wa["Worker<br/>own branch"]
        wb["Worker<br/>own branch"]
        wc["Worker<br/>own branch"]
        report["Each worker self-reviews,<br/>then sends a report<br/>(a claim, not proof)"]
        wa & wb & wc --> report
    end

    subgraph P3 ["③ ORCHESTRATOR VERIFIES"]
        review["Check the diff,<br/>re-run the checks.<br/>Problems? Send findings<br/>back to the same worker."]
        integrate["Merge into integrate/goal.<br/>Full checks, one docs pass."]
        review -- "accept" --> integrate
    end

    done(["Summary +<br/>recommendation<br/>You decide:<br/>merge, push or PR"])

    user --> P1 --> P2 --> P3 --> done

    classDef you fill:#f1f5f9,stroke:#475569,color:#0f172a
    classDef orch fill:#dbeafe,stroke:#1d4ed8,color:#0f172a
    classDef worker fill:#dcfce7,stroke:#15803d,color:#0f172a
    class user,done you
    class plan,review,integrate orch
    class wa,wb,wc,report worker
    style P1 fill:none,stroke:#94a3b8,stroke-dasharray:5 4
    style P2 fill:none,stroke:#94a3b8,stroke-dasharray:5 4
    style P3 fill:none,stroke:#94a3b8,stroke-dasharray:5 4
```

Three rules carry most of the value:

1. **Split only what is truly independent.** Disjoint files, no shared output, a checkable "done when". Everything else stays in one session.
2. **A brief is the whole world.** A worker knows only what its brief says, so hand over understanding, not just a task.
3. **A report is a claim.** The orchestrator verifies against the diff before anything is called done.

The skills behind each phase, the agents, and how workers can be launched are in the [`orchestrator-workers` README](plugins/orchestrator-workers/README.md).

### Watching it live

`orchestration-monitor` asks every worker to open its end-of-turn note with a progress line, reads those notes as they reach the orchestrator, and draws one card per worker. A card moves like this:

```mermaid
flowchart TD
    start(["Orchestrator starts a worker<br/>start_session · hand_off_to_session"])

    subgraph panel ["ON THE PANEL"]
        working["🔄 Working"]
        paused["📨 Paused<br/>ended a turn, not done"]
        needs["🙋 Needs input"]
        quiet["💤 Quiet<br/>nothing heard for 10 min"]
        working -- "note: Progress n/m" --> paused
        working -- "note: Needs input" --> needs
        working -. "silence" .-> quiet
        paused & needs -- "orchestrator messages it" --> working
    end

    done(["✅ Done<br/>leaves the panel,<br/>counted in the heading"])
    archived(["🗄️ Archived<br/>leaves the panel for good.<br/>Orchestrator reads a<br/>confirmation line."])

    start --> working
    panel -- "note: Progress m/m" --> done
    panel -- "archive tool, or the app<br/>lists it as (archived)" --> archived
    done -- "archived later" --> archived

    classDef you fill:#f1f5f9,stroke:#475569,color:#0f172a
    classDef live fill:#dcfce7,stroke:#15803d,color:#0f172a
    classDef look fill:#ffedd5,stroke:#c2410c,color:#0f172a
    class start,done,archived you
    class working live
    class paused,needs,quiet look
    style panel fill:none,stroke:#94a3b8,stroke-dasharray:5 4
```

Subagents work the same way, except they report through a `step` tool and leave the panel when they finish (a failed one stays). Details, limits and privacy are in the [`orchestration-monitor` README](plugins/orchestration-monitor/README.md).

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
