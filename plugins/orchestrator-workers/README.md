# orchestrator-workers

Skills and agents for running **an orchestrator Claude Code session (also called a lead or main session) with worker sessions**: how to split work, brief workers, keep them isolated, review what comes back, integrate it, and keep the docs honest while you do.

The skills and agents are plain Markdown: no runtime, no dependencies, and nothing specific to one language, framework or host. They run nothing, send nothing and fetch nothing on their own. An optional mod adds a live view of the orchestration (see below).

## Install

In Claude Code:

```text
/plugin marketplace add Fedekawa/claude-session-orchestration
/plugin install orchestrator-workers@session-orchestration
```

Installed it as `session-orchestration` before? The marketplace renames it for you; run the install line above once.

To try it without installing, point `claude --plugin-dir` at this folder in a local clone of the repository.

## The model in sixty seconds

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

Skills by phase: ① `orchestrating-sessions`, `writing-session-briefs` · ② `working-as-a-session`, `self-review-before-handoff`, `syncing-docs-with-code` · ③ `reviewing-session-work`, `orchestrating-sessions`, `syncing-docs-with-code`.

Three rules carry most of the value:

1. **Split only what is truly independent.** Disjoint files, no shared output, a checkable "done when". Everything else stays in one session.
2. **A brief is the whole world.** A worker knows only what its brief says, so hand over understanding, not just a task.
3. **A report is a claim.** The orchestrator verifies against the diff before anything is called done.

## What is inside

### Skills

| Skill | Use it when |
|---|---|
| `orchestrating-sessions` | You are the orchestrator. Decide here / subagent / own session, split, dispatch, isolate, integrate, close out. |
| `writing-session-briefs` | You are about to hand a task to another session or subagent. Template and checklist. |
| `working-as-a-session` | You are the worker. Scope, branch discipline, escalation, and the report format. |
| `self-review-before-handoff` | You are about to say "done". Review your own diff, run the checks, sync docs, write an honest report. |
| `reviewing-session-work` | A worker says it is finished. Verify the claim, decide accept / rework / reject. |
| `syncing-docs-with-code` | Behaviour, API or config changed. Find the docs that describe it, update or flag them, and know which side is the truth. |

### Agents

| Agent | Role | Tools |
|---|---|---|
| `session-planner` | Decides whether to split a goal, and how: work units, conflict map, choke points. | read-only |
| `work-reviewer` | Fresh-context review of a diff against its brief. Does not trust the report. | read + run checks |
| `docs-drift-auditor` | Finds docs that no longer match the code, with proposed fixes. | read + safe commands |

The agents never edit files. Models are set in each agent's frontmatter (`opus` for the planner and reviewer, `sonnet` for the auditor); change them to taste, or use `inherit` to follow your session's model.

### Optional mod: orchestration-monitor

A separate plugin in the same marketplace, for watching an orchestration live: the orchestrator's cache timing, session age and usage limits above the prompt, and an `/orchestration` panel with each subagent's and worker session's progress, and a button to ask the orchestrator to look at a stalled one. Unlike the skills it ships code (a TypeScript hooks module), so it is not part of this plugin. See [its README](https://github.com/Fedekawa/claude-session-orchestration/tree/main/plugins/orchestration-monitor).

```text
/plugin install orchestration-monitor@session-orchestration
```

### Installed names

Plugin components are namespaced, and `subagent_type` must match exactly:

| Kind | Name |
|---|---|
| Skill | `/orchestrator-workers:orchestrating-sessions` (same pattern for the other five) |
| Agent | `orchestrator-workers:session-planner`, `orchestrator-workers:work-reviewer`, `orchestrator-workers:docs-drift-auditor` |

## Quick start

Once installed, ask for the behaviour you want in plain language. For example:

- "Use the orchestrating-sessions skill: split this into independent parts and run them as separate sessions."
- "Write a brief for a worker to add pagination to the orders endpoint."
- "You're a worker session. Here is your brief: ... Follow working-as-a-session."
- "Review what the worker produced on branch `feat/x` with reviewing-session-work."
- "Run syncing-docs-with-code on this branch before I open the PR."

## How workers run

The skills describe the protocol (brief, branch, report), not a particular launcher, so they work with any of these:

| Mechanism | Result comes back as |
|---|---|
| Subagent (Agent tool) | Its final message |
| A host's session-spawning tool, such as a desktop app's | A notification or report when it ends a turn |
| Headless run: `claude -p` in a worktree, brief read from a file | stdout (JSON with `--output-format json`) |
| A terminal tab you drive: `claude` in a worktree | You paste the report, or it writes it outside the work tree |

Anything that writes code, subagents included, should get its own git worktree:

```bash
git worktree add ../myrepo-unit-a -b feat/unit-a main
```

Headless workers have nobody to answer permission prompts. Pre-approve only what the brief needs and cap the spend; `orchestrating-sessions` has the exact command. Never paste a brief inside double quotes, because the shell would run any backticks in it.

## Principles behind the defaults

- **One writer per file, one owner per shared file.** Lockfiles, index exports, route tables, migrations, schemas, `CLAUDE.md`, top-level README and CHANGELOG all have exactly one owner, usually the orchestrator at integration.
- **Contracts first.** When parts share an interface, the orchestrator commits it before dispatching, and workers receive it read-only.
- **Sonnet works, Opus advises.** Every worker gets its model explicitly: Sonnet by default, with Opus as its advisor (`/advisor opus`, or `--advisor opus` for a headless run), Haiku for pure lookups. A worker given no model runs on the orchestrator's, usually the most expensive.
- **Safe by default.** Workers do not push, open PRs, deploy, migrate or touch production unless the brief says so and a human approved it.
- **The simplest code that works is the most elegant.** Every worker starts from this standard, every brief can restate it, and every review treats speculative abstractions, unrequested options and non-surgical edits as findings. Adapted from [Andrej Karpathy's notes on LLM coding pitfalls](https://x.com/karpathy/status/2015883857489522876).
- **Docs are part of the change.** Code, then docs, then self-review, then orchestrator review. Code wins over docs that describe behaviour; specs and ADRs are never silently overruled.
- **Escalate early.** A fast, well-described blocker beats three more attempts at the same wall.
- **Decisions are multiple choice.** When the orchestrator needs the user's input it explains what the decision is about and offers at least three alternatives with pros and cons, one of them recommended. The user answers with a letter.
- **Honest reports.** "Verified" means run and observed. Failing checks are reported as failing.

## Privacy

This plugin collects, stores and sends no data. It is Markdown instructions only: no code, hooks, MCP servers or connectors, and no service of its own that could receive anything. What Claude reads while following the skills (your repository, diffs, briefs and reports) stays in your Claude session, under the same terms as the rest of that session. Anything that leaves your machine, such as a push, a pull request or a deploy, happens only when you approve it.

## Contributing

Issues and pull requests are welcome. Keep changes small and in the spirit of the repo: the simplest thing that works, general enough for anyone's project, and no mention of a specific company, client or private tool.

## License

MIT. See [LICENSE](LICENSE).
