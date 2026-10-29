---
name: self-review-before-handoff
description: A pre-report gate for a worker. Sync the docs, commit, review your own diff against the brief, run the checks and write an honest report before handing work to a lead or reviewer. Use before saying done, before opening a PR, and before reporting to an orchestrator.
---

# Self-Review Before Handoff

You are biased toward your own work. This gate exists to catch the cheap problems (the ones a reviewer should never have to spend time on) and to produce the evidence your report needs. The lead still verifies; your job is to make verification boring.

The order matters and follows the rule **code, then docs, then self-review**: docs are written once the code has settled, and the review covers the docs too.

## The gate, in order

1. **Freeze.** Stop adding code. New ideas go in the report under "Found but didn't fix".
2. **Re-read the brief.** Go through the "done when" list item by item. Anything not met is "partial", not "done".
3. **Sync the docs.** Run `syncing-docs-with-code` and keep its three-bucket record (updated, unchanged, unfixed).
4. **Commit everything.** Unless the brief forbids committing, commit all your work, then confirm:
   ```bash
   git status --short   # must print nothing
   ```
   Uncommitted or untracked work is invisible to the lead and to reviewers, and is lost if the worktree is removed.
5. **Read your whole diff** as a reviewer who did not write it, code and docs together. The base is in the brief:
   ```bash
   git diff <base>...HEAD
   ```
   Read every hunk.
6. **Checklist**
   - **Scope:** only owned files? Nothing adjacent "while I was there"?
   - **Correctness:** empty, null and boundary inputs; error paths; ordering and concurrency; off-by-one.
   - **Simplicity:** could this be smaller? Any abstraction, option or layer nobody asked for?
   - **Hygiene:** debug output, commented-out code, `TODO`s, secrets, stray files, formatting-only churn.
   - **Tests:** new behaviour is tested; the new tests fail without your change; none are skipped, deleted or loosened.
   - **Safety:** nothing touches production data, auth, migrations or destructive paths unless the brief allowed it.
7. **Run the checks** your project has: typecheck, lint, tests, build. Then exercise the real behaviour, not only the tests. Keep the commands and results; they go in the report.
8. **Independent pass (optional, recommended for risky or large changes).** Start the `work-reviewer` agent (`session-orchestration:work-reviewer`) with the brief, the base and head refs and your worktree path. Do not give it your opinion of the work. Skip this step if you are a subagent: do not spawn agents, whatever the host allows.
9. **Fix, commit, re-run.** Every fix invalidates earlier results: re-run the checks that could be affected, and confirm `git status --short` is empty again.
10. **Write the report** in the format from `working-as-a-session`. Every line under "Verified" names a command and its actual result.

## Red flags that mean you are not done

- A check fails or is skipped and you cannot explain why.
- You edited a test, lint rule, type or threshold to make something pass.
- You are writing "should work" or "probably fine".
- Code you wrote has never been run.
- The diff contains something you cannot justify against the brief.
- The docs describe the old behaviour.
- `git status --short` is not empty.

If any of these is true, fix it or report it. Do not hide it in a summary.

## What this gate is not

It is not a substitute for the lead's review, and it is not a reason to expand scope. If self-review turns up a larger problem than the brief allows, report it and let the lead decide.
