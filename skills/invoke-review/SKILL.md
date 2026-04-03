---
name: invoke-review
description: "MUST USE when build is complete and code needs review, or when a build-review loop iteration starts. Triggers after invoke-build completes. Do not dispatch reviewers without this skill."
---

# Invoke — Review Stage

You are running the review stage. Your job is to dispatch reviewers, present findings, let the user triage, and loop back to build for fixes.

## Messaging

Load the `invoke-messaging` skill and follow its standards for all user-facing output — agent dispatches, progress updates, results, errors, and selection prompts. Use `AskUserQuestion` for all user decisions.

## Flow

### 1. Verify State

Call `invoke_get_state` to verify we're at the review stage.

### 2. Select Reviewers

Read the config with `invoke_get_config` to see available reviewers.

Present available reviewers using `AskUserQuestion` with `multiSelect: true`. Each option's label is the subrole name, description includes provider(s), model(s), and effort. Read the actual configured reviewers from `invoke_get_config` — do not hardcode the list.

### 3. Dispatch Reviewers

Dispatch selected reviewers using `invoke_dispatch_batch`:
- `create_worktrees: false` (reviewers don't modify code)
- `task_context: { task_description: "<what was built — summary from plan>", diff: "<git diff of all changes>" }`

Call `invoke_get_batch_status` with the batch ID — it will wait up to 60 seconds for a status change before returning. Keep calling until complete. Do NOT use `sleep` between calls.

### 4. Present Findings

Collect findings from all reviewers. Present them grouped by reviewer:

> **Security Review** (3 findings)
> 1. [HIGH] SQL injection in src/db/query.ts:42 — Use parameterized queries
> 2. [MEDIUM] Session token in localStorage src/auth/session.ts:15 — Use HttpOnly cookies
> 3. [LOW] Verbose error messages src/api/handler.ts:88 — Sanitize error output
>
> **Code Quality Review** (1 finding)
> 1. [MEDIUM] Duplicated validation logic in src/api/users.ts:30 and src/api/posts.ts:25 — Extract shared validator

### 5. User Triage

For each finding, ask the user:
> "Accept or dismiss? (You can also accept/dismiss all from a reviewer)"

Options:
- **Accept** — will be sent to build agents for fixing
- **Dismiss** — false positive or intentional, skip it

### 6. Auto-Fix Accepted Findings

Bundle accepted findings as fix tasks. For each finding, create a task:
- `task_description`: the finding details + suggestion
- `acceptance_criteria`: the specific fix expected
- `relevant_files`: the file(s) mentioned in the finding

Dispatch fix tasks using `invoke_dispatch_batch` with `create_worktrees: true`.

Poll, collect results, merge — same flow as build stage.

### 7. Next Cycle

After fixes are applied, ask the user:
> "Fixes applied. Want to run another review cycle, or are you satisfied?"

If another cycle: loop back to step 2.
If satisfied: proceed to completion.

### 8. Complete Pipeline

Use the same slug from the spec/plan filenames. Save the review history using `invoke_save_artifact`:
- `stage: "reviews"`
- `filename: "YYYY-MM-DD-<slug>-review-N.json"` (e.g., `2026-04-03-auth-middleware-review-1.json`)

### 9. Commit Strategy

Ask the user how to commit the final result:
> "Pipeline complete. How should I commit?"
> 1. One commit (squash all)
> 2. Per batch (N commits) — [preview commit messages]
> 3. Per task (N commits) — [preview commit messages]
> 4. Custom grouping

Execute the chosen commit strategy. Clean up the work branch after squash merge.

Update state:
- `current_stage: "complete"`

## Error Handling

- If a reviewer fails, present the error and proceed with other reviewers' results
- If fix agents fail, present the error and let the user decide: retry, fix manually, or dismiss the finding
- If all reviewers return no findings, congratulate and proceed to commit

## Key Principles

- Present findings clearly — severity, location, description, suggestion
- Let the user make all triage decisions — never auto-dismiss findings
- The loop continues until the user is satisfied, not until reviewers find zero issues
