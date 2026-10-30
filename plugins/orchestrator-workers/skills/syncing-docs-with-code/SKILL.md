---
name: syncing-docs-with-code
description: Keep documentation in step with code changes. Find the docs that describe changed behaviour, update or flag them, and check doc claims against the code. Use after changing behaviour, APIs, config, CLI flags, environment variables, schemas or architecture, before self-review or orchestrator review, and when asked to audit docs drift.
---

# Syncing Docs with Code

Docs are part of the change. Stale docs are bugs with a long fuse: they send the next person, or the next agent, in the wrong direction with full confidence. A change is not done until the docs that describe it are right, or the drift is explicitly reported.

Order of work: **code, then docs, then self-review, then orchestrator review.** Docs written before the code settles describe the plan, not the product.

## Which side is the truth?

| The doc is... | If doc and code disagree |
|---|---|
| A description of current behaviour (README, guides, how-tos, run instructions, comments, agent instruction files such as `CLAUDE.md`) | **Code wins.** Fix the doc. |
| A contract the code should implement (spec, API schema, ADR, requirements) | There is a bug on one side. **Do not silently pick one.** Flag both sides to the orchestrator or user. If this change deliberately alters the contract, update the contract on purpose and say so. |
| A record of a past decision (ADR) | Never rewrite history. Add a new record that supersedes it. |

## Who edits what

- **Working alone:** edit any doc the change affects.
- **As a worker in a multi-session effort:** edit only docs inside files you own (including comments and docstrings) and docs your brief lists. Every other doc is shared surface, so report it under "Needs from the orchestrator". Shared files are the choke points listed in `orchestrating-sessions` (README, CHANGELOG, `CLAUDE.md`, `AGENTS.md`, `.env.example`, schemas and API specs among them).
- **As the orchestrator reviewing a worker:** check only. Do not edit the worker's branch; send drift back as a numbered finding.
- **As the orchestrator integrating:** run one final pass on the combined change and update the shared docs once. Two correct per-branch edits can contradict each other.

## Procedure

1. **Inventory the doc surfaces** in this repo: `README*`, `docs/`, `CONTRIBUTING`, `CHANGELOG`, ADRs, agent instruction files (`CLAUDE.md`, `AGENTS.md`), API schemas (OpenAPI, GraphQL), `.env.example`, config references, CLI `--help` text, docstrings and comments near the changed code, migration notes, runbooks.
2. **Extract the change surface** from the diff (`git diff <base>...HEAD`): public functions and types, endpoints, flags, environment variables, config keys, defaults, error messages, file paths, commands, and anything removed or renamed.
3. **Search the docs** for each item: the new name, the **old** name, old values, paths and commands. Removals are where drift hides.
4. **Classify each hit:**
   - still true
   - wrong
   - incomplete
   - missing (new behaviour with no docs)
   - dangling (points at something that no longer exists)
5. **Update with the smallest edit** that makes each claim true, in the docs you may edit (see above). Match the existing style and level of detail. Do not rewrite for taste, do not document things that do not exist, and do not paste code into docs when a reference will do.
6. **Verify what can be checked.** Run documented commands, check that referenced paths exist, make sure code samples still run, and spot-check links.
7. **Record the outcome**, always, in three buckets: *updated*, *checked and unchanged*, *drift found but not fixed (and why)*. This goes in the report.

## Don't

- Create new doc files nobody asked for.
- Add changelog entries unless the project keeps a changelog.
- Leave "TODO: document" placeholders.
- Fix unrelated stale docs you stumble on. Report them.

## Wide audits

For a large repo, or a repo-wide drift audit, hand the survey to the `docs-drift-auditor` agent (`orchestrator-workers:docs-drift-auditor`). It is read-only and returns a findings table; you decide which fixes to apply. If you are a subagent, do not spawn it: audit the narrower scope yourself, or report that a wide audit is needed.
