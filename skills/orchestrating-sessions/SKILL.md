---
name: orchestrating-sessions
description: Run an orchestrator session that splits a task across worker sessions or subagents, hands each a brief, tracks them, reviews what comes back and integrates the result. Use when a task has two or more independent parts, when you are the orchestrator (also called the lead, master or main session) coordinating others, or when deciding whether work should run here, in a subagent or in its own session.
---

# Orchestrating Sessions

You are the orchestrator. You own the goal, the decisions, the relationship with the user and the integration. Each worker owns the details of one bounded task. Your value is the split, the briefs and the review, not typing code in parallel with your workers.

One standard applies to every session, yours included: the most elegant code is the simplest that solves the problem. Write nothing speculative, change only what the task requires, and hold your workers to the same bar (the brief template and `working-as-a-session` carry it; the reviews enforce it).

## 1. Decide where each piece runs

| Run it... | When | Limits |
|---|---|---|
| **Here** | A question, a read, one edit, a handful of tool calls | None. Never spawn for small things. |
| **In a subagent** | You need the result in this turn: wide searching or reading, a review, a verification, independent read-only analysis | Cheap and parallel. Returns one message. The user cannot steer it. It should not spawn further agents, whatever the host allows. |
| **In its own session** | A task of its own that outlives this turn, that the user may want to open, steer or review apart from you, and that ends in something of its own (a branch, a PR, a change in another repo) | Most overhead. Needs a full brief and isolation (section 4). |

Testing, checking, reviewing or demoing what you just built is never its own session. Do it here or in a subagent and use the answer immediately.

## 2. Split test

Parallelize two pieces only when **all** of these hold:

1. **Independent.** Neither needs the other's output.
2. **Disjoint files and state.** No two writers touch the same file (see choke points below), and none share runtime state: dev-server ports, a local database, caches, container names.
3. **Separable.** They do not have to land as one change.
4. **Verifiable.** Each has a "done when" that someone else can check.

If any fails, run them in sequence or keep them in one session. Two writers on one file means conflicts and silent overwrites; serializing is cheaper.

**Choke points** are files many changes want to touch: lockfiles, barrel or index exports, route and registry tables, migration numbering, generated files, schema files and API specs, `.env.example`, agent instruction files (`CLAUDE.md`, `AGENTS.md`), top-level README and CHANGELOG. Give each to exactly one owner (usually you, at integration) and tell workers to report what they need there instead of editing it.

**Shared interfaces.** When units are coupled through an interface (types, API shape, schema, event format), write and commit that contract on the base first, hand it to every brief as read-only, and only then dispatch. A worker that needs the contract changed escalates; it does not edit it.

For a non-trivial split, give the goal to the `session-planner` agent (installed as `session-orchestration:session-planner`), then check its conflict map yourself.

## 3. Plan, then dispatch

Write the work-unit table before spawning anything:

| Unit | Goal | Owned files | Depends on | Model | Runs in |
|---|---|---|---|---|---|

- One brief per unit. Use `writing-session-briefs`. A worker knows only what its brief says.
- Pick the model per unit: searches, lookups and mechanical edits go to a small fast model; well-specified implementation to a mid-tier model; architecture, hard debugging and review to the strongest.
- Fork or fresh? A fork inherits this whole conversation: use it when the task leans on the conversation and the conversation is short. Use a fresh session with a full brief when the task is self-contained or the conversation is long.
- Launch independent subagents in one message (several tool calls at once) so they start together.
- Cap concurrency at what you can actually review, roughly three or four. Beyond that, review becomes the bottleneck and quality drops.
- Give every worker a budget (time, turns or cost) and a stop rule: report partial results at the limit.

## 4. Isolation

- Anything that writes code gets its own branch, ideally its own git worktree:
  ```bash
  git worktree add ../<repo>-<unit> -b <unit-branch> <base>
  ```
- A subagent that writes code needs this too: by default it shares your checkout, and a `checkout` there switches your branch. Use the host's isolation where it exists (for example an Agent-tool option such as `isolation: "worktree"`), or create the worktree first and give the subagent its absolute path. Tell it to use absolute paths or `git -C <path>`, and never to run `checkout` or `switch` in your checkout.
- Read-only sessions may share a checkout.
- Never put two writers in one checkout, even on "different" files. A branch switch in one breaks the other.
- A fresh worktree has none of your gitignored files (dependencies, `.env`, generated code). Put the setup command in the brief, say which env file to copy (never commit it), and give each worker its own port, database or schema if it runs anything locally.
- Workers do not push, open PRs, deploy, run migrations or touch production unless the brief says so and the user approved it.

### Ways to run a worker

| Mechanism | How the result comes back |
|---|---|
| Subagent (Agent tool) | Its final message |
| A host session tool (for example a desktop app's "start session") | A notification or report when it finishes a turn |
| Headless run (`claude -p`, brief read from a file, inside the worktree) | stdout; JSON with `--output-format json` |
| A terminal tab the user drives (`claude` inside the worktree) | The user pastes the report, or the worker writes it to a path outside the work tree named in the brief |

A headless worker has nobody to answer permission prompts, so pre-approve what its brief needs and cap the spend. Save the brief to a file and read it from there. Never paste a brief inside double quotes: the shell would run any backticks in it. Run it in the background so it does not block you:

```bash
cd ../<repo>-<unit> && claude -p "$(cat /abs/path/brief.md)" \
  --permission-mode acceptEdits \
  --allowedTools "Bash(npm test:*)" "Bash(npm run typecheck:*)" \
  --max-budget-usd 5 --output-format json < /dev/null > /abs/path/report.json
```

Never use `--dangerously-skip-permissions` for a worker. The JSON output carries the session id, which `claude -p --resume <session-id>` needs later for rework. (`claude -w <name>` can create the worktree for you.)

## 5. While they run

- Do not poll. Take your own non-overlapping step now; results arrive on their own. If your host does not deliver them, ask the user to paste the report.
- Keep a ledger: name, scope, branch or worktree, state, budget. Keep it in a scratch file outside the repo, not in your head: context compaction on a long run loses what only you remember.
- A blocked worker is your top priority. Answer fast, or ask the user in the format of section 9. When you forward the user's approval, quote their words.
- A worker that passes its budget or goes quiet: stop it and ask for a partial report.
- Never invent or predict a worker's result. If asked before it arrives, say it is still running.

## 6. Review every result

A report is a claim, not proof. Run `reviewing-session-work` on each result before it counts as done.

## 7. Integrate

1. Create a named integration branch (`integrate/<goal>`) from the base. It is the single candidate the user will merge or open a PR from. Worker branches are inputs to it, not alternatives to it.
2. Merge the worker branches into it in dependency order: foundations first, then the least conflicting.
3. Resolve conflicts yourself. If one shows two workers touched the same thing, note it; your split leaked.
4. Run the full checks on the **combined** result. Pieces that pass alone can fail together.
5. Run `syncing-docs-with-code` once on the combined change and update the shared docs (the choke points).
6. When you tell the user about a branch, name it exactly. If a tag shares a branch's name, use the full ref (`refs/heads/<name>`).

Merging into the integration branch is your job. Merging that branch into the base, pushing, and opening PRs are the user's call: ask, naming the branch.

## 8. Close out

Tell the user what changed, what they must decide or verify, what you skipped, and your recommendation. Anything they must decide goes in the format of section 9. Say which claims you verified yourself and which come from worker reports. Offer to close or archive finished sessions (if your host supports it) and to remove merged worktrees, and do it only on their yes, after checking each target is clean and merged.

## 9. When you need the user's decision

Never ask an open question. The user has less context than you and should be able to answer in one word. Every request for input is multiple choice:

1. **What the decision is about.** One or two sentences: what it affects, why you cannot decide it yourself, and what happens if nobody decides (the default you will take, or that work stays blocked).
2. **At least three real alternatives.** Each one a path you would actually take. "Do nothing" or "defer" counts when it is genuine; a straw man added to reach three does not.
3. **Pros and cons of each**, in the user's terms: cost, risk, time, what it rules out later.
4. **One recommended option**, marked, with the reason in one sentence.

```markdown
**Decision: <title>**
<what it is about, why it is yours, what happens with no answer>

| | Option | Pros | Cons |
|---|---|---|---|
| A (recommended) | ... | ... | ... |
| B | ... | ... | ... |
| C | ... | ... | ... |

**Recommendation:** A, because <one sentence>. Reply with a letter, or describe another option.
```

One decision per question. Two unrelated decisions are two questions. If your host has a question tool with selectable options, use it with the same content: the recommended option first and labelled as such, the pros and cons in each option's description. A worker's escalation usually arrives as two options; reshape it into this format before it reaches the user, adding the alternative the worker could not see from inside its scope.

## Anti-patterns

- The orchestrator implementing a worker's task "while waiting".
- Briefs like "based on your findings, fix it". Hand over the understanding, not only the task.
- A session for a five-minute task.
- Two writers on one file set, or in one checkout.
- Units that guess a shared interface instead of receiving it.
- Accepting "done" without looking at the diff.
- Unbounded fan-out, or workers with no budget.
- Going silent. The user should always be able to tell what is running and what you are waiting on.
- Open questions to the user ("how do you want to handle this?") instead of a multiple-choice decision with a recommendation.
