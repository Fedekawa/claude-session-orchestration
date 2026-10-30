---
name: writing-session-briefs
description: Write a self-contained brief that hands a task to another session, subagent or teammate. Use when you are about to start a worker session, delegate to a subagent, split work across sessions, or leave a task for a future session to pick up.
---

# Writing Session Briefs

The worker has none of your context. The brief is everything it knows. A vague brief returns confident, wrong work; a good one takes five minutes and saves an hour of rework.

## The rule

Hand over understanding, not just a task. Never write "based on the findings, fix it" or "do what we discussed". State what you found, what you decided and why.

## Template

```markdown
# Brief: <short title>

## Goal
One or two sentences: the outcome you want and why it matters.

## Context
What is already known or decided. Where to look (paths, with a line on why each matters).
What has been ruled out. Constraints that come from outside this task.

## Scope
- In: ...
- Out (do not touch): ...

## Files
- You own (may edit): ...
- Read-only: ...
- Shared files you must not edit (report what you need instead): ...

## Done when
- [ ] <observable outcome someone else can check>
- [ ] ...

## Verify
Exact commands (typecheck, lint, tests, build) and how to exercise the real behaviour.

## Environment
Where to work: worktree <absolute path>, branch <name>, based on <base branch> @ <sha>.
Use absolute paths or `git -C <path>`; never `checkout` or `switch` in a checkout someone else uses.
Setup: <install/build command>; copy <env file> from <where> (never commit it).
Runtime state: use port <n> / database or schema <name> so parallel workers do not collide.

## Hard limits
- Never work on the default branch.
- No push, PR, deploy, migration or other destructive or production action.
- No new dependencies without asking.
- <project-specific limits>

## Code standard
The most elegant code is the simplest that solves the problem. Nothing speculative:
no abstraction, option or layer this brief did not ask for.
Surgical changes: every changed line traces back to this brief; match the existing style.
State the assumptions you made. If a simpler approach exists, say so.

## Docs
Docs that must follow your change (see `syncing-docs-with-code`).
Shared top-level docs: report what needs changing, do not edit.

## Report back
Use the default report from `working-as-a-session`, or: <your format>.
Deliver it as your final message (or write it to <path outside the work tree>).

## Escalate when
You are blocked; the brief contradicts the code; finishing needs a file you do not own;
you find a problem outside scope (report it, do not fix it).

## Budget
Stop and report partial results at <time / turns / cost limit>.
```

Drop sections that do not apply to a small task, but never drop **Goal**, **Done when**, **Files**, **Hard limits** or **Report back**. Without **Files** the worker has no defined ownership. **Code standard** can be dropped: `working-as-a-session` applies it by default.

## What a good brief passes

- Could a competent engineer with the repo and only this text start right now?
- Is every "done when" something a stranger could check with a command or by looking?
- Does it say what **not** to touch?
- Does it say what to do when stuck?
- Does it point at files instead of pasting them? A path and a line on why beats a pasted file.
- Can it be read in two minutes? Length should come from precision, never from pasted bulk.

## Weak versus strong

**Weak**

> Add rate limiting to the API.

**Strong**

> **Goal:** Add per-API-key rate limiting (100 requests/minute) to the public REST API so one noisy client cannot starve the rest.
>
> **Context:** Middleware lives in `src/server/middleware/`. Auth already sets `req.apiKeyId` (`auth.ts`). The Redis client is `src/lib/redis.ts`. In-memory counters are ruled out: the API runs on three instances.
>
> **Scope:** In: new middleware, wiring, tests. Out: the admin API and any limits UI.
>
> **Done when:** the 101st request within a minute returns 429 with a `Retry-After` header; the limit resets after the window; two keys are limited independently; tests cover all three.
>
> **Verify:** `npm test -- rate-limit` and `npm run typecheck`; then run the dev server and hit it with a loop of 101 requests.
>
> **Hard limits:** branch `feat/rate-limit` in its own worktree; no push; no new dependencies.

## Matching the brief to the mechanism

- **Subagent:** it returns one message. Say exactly what shape you want back and ask for `file:line` citations.
- **Fork:** it already has the conversation, so the brief can be short, but it still needs scope, done-when and hard limits.
- **Fresh session:** use the full template.
- **Headless run (`claude -p`):** save the brief to a file and pass it with `"$(cat brief.md)"`. Never paste it inside double quotes yourself: the shell would run any backticks in it. See `orchestrating-sessions` for the full command.
