---
name: reviewing-session-work
description: Review a worker session's or subagent's result before accepting it. Check the report against the actual diff, re-run the checks, judge scope and quality, then decide accept, rework or reject. Use when a worker reports done, before merging its branch, and before telling the user a delegated task is finished.
---

# Reviewing Session Work

A worker's report is a claim. As lead, your job is to turn claims into verified facts before they reach the user. Workers are usually honest, and usually optimistic: they cannot see what they did not think to check.

## Procedure

1. **Find the work.** Locate the branch, worktree or diff range:
   ```bash
   git log --oneline <base>..<branch>
   git diff --stat <base>...<branch>
   ```
   If you cannot find the work, the report is not evidence of anything.
2. **Scope check.** Compare the files touched with the files the brief gave the worker. Unexpected files, shared choke-point files, deleted tests and formatting-only churn all need an explanation.
3. **Done-when check.** Walk the brief's list. For each item find evidence (a command result, a diff hunk, an observed behaviour), not an assertion.
4. **Re-run verification yourself.** Typecheck, lint, tests and build, in the worker's worktree. First confirm that worktree is at the head you are reviewing (`git -C <worktree> rev-parse HEAD`) and clean (`git -C <worktree> status --short`); checks on a different tree prove nothing. If dependencies are missing and you cannot install them, say the checks were not run; never count them as passing. If behaviour changed, exercise the real thing, not only the tests. Compare with the report: numbers that do not match are a finding.
5. **Read the diff.** Look specifically for:
   - weakened bars: new `@ts-ignore`, `eslint-disable` or `# noqa`; skipped or deleted tests; loosened assertions or thresholds
   - stubs, `TODO`s, unimplemented branches, hardcoded values that belong in config
   - swallowed errors, broad catches, silent fallbacks
   - debug leftovers, secrets, stray files
   - scope creep: refactors nobody asked for
6. **Docs check, check-only.** Did the docs that describe the changed behaviour change too? Use `syncing-docs-with-code` to find drift (its steps 1-4, 6 and 7, never step 5), or for a wide change the `docs-drift-auditor` agent (`session-orchestration:docs-drift-auditor`). Do not edit the worker's branch: send drift back as a numbered finding. Shared docs wait for the integration pass.
7. **Verdict.**
   - **Accept.** Verified, in scope, docs right.
   - **Accept with follow-ups.** Safe to merge. List each follow-up and who owns it.
   - **Rework.** Send specific, numbered findings back to the **same** worker, which already has the context, if your host can continue it (a message tool, or `claude -p --resume <session-id>`). Otherwise start a fresh worker with the brief, the numbered findings and the branch name. Re-review the delta and re-run all checks.
   - **Reject.** Wrong approach. Say why and re-brief, possibly with a new worker.

## Independent review for high-stakes work

For auth, payments, data migrations, anything irreversible, or anything you would be embarrassed to get wrong, use the `work-reviewer` agent (`session-orchestration:work-reviewer`) for a fresh-context read. Give it the brief, the base and head refs and the worktree path, not your opinion and not the worker's conclusion, so it is not anchored. Treat its findings as input and verify the ones you act on.

## Telling the user

Separate what you verified from what you took from the report: "I re-ran the tests (214 pass) and read the diff. I did not exercise the checkout flow in a browser." Do not paste the worker's report in as your own summary.
