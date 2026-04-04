---
name: invoke-review
description: "MUST USE when build is complete and code needs review, or when a build-review loop iteration starts. Triggers after invoke-build completes. Do not dispatch reviewers without this skill."
---

# Invoke — Review Stage

You are running the review stage. Your job is to dispatch reviewers, present findings, let the user triage, and loop back to build for fixes.

## Messaging

**BEFORE doing anything else**, invoke the `invoke-messaging` skill using the Skill tool (`Skill({ skill: "invoke:invoke-messaging" })`). This loads the messaging format standards you MUST follow for all output. Do NOT proceed with any pipeline steps until invoke-messaging is loaded. Use `AskUserQuestion` for all user decisions.

## Flow

### 1. Verify State

Call `invoke_get_state` to verify we're at the review stage.

### 2. Show Current Usage

Call `invoke_get_metrics` with no stage filter before selecting reviewers. Display the current pipeline usage so the user can see dispatch headroom before review starts. Use `summary` and `limits` to show the current totals, including dispatches used, `max_dispatches` when available, total prompt chars, and total duration.

### 3. Select Reviewers

Read the config with `invoke_get_config` to see available reviewers.

Present available reviewers using `AskUserQuestion` with `multiSelect: true`. Each option's label is the subrole name, description includes provider(s), model(s), and effort. Read the actual configured reviewers from `invoke_get_config` — do not hardcode the list.

### 4. Dispatch Reviewers

Dispatch selected reviewers using `invoke_dispatch_batch`:
- `create_worktrees: false` (reviewers don't modify code)
- `task_context: { task_description: "<what was built — summary from plan>", diff: "<git diff of all changes>" }`

Check the batch response before moving on. It includes `dispatch_estimate`, and may include `warning` when the projected usage is approaching or exceeding `max_dispatches`. Surface that warning to the user as an advisory notice before the dispatch summary and status polling.

Call `invoke_get_batch_status` with the batch ID — it will wait up to 60 seconds for a status change before returning. Keep calling until complete. Do NOT use `sleep` between calls.

**CRITICAL: Do NOT proceed to step 5 while any dispatched reviewers are still running.** You must wait for all reviewers to complete or fail. If reviewers have been running for more than 5 minutes, use `AskUserQuestion` to ask the user whether to keep waiting, proceed with partial results, or cancel.

### 5. Present Findings

**Print the full findings as text output first** so the user can read them. Group by reviewer:

> **Security Review** (3 findings)
> 1. [HIGH] SQL injection in src/db/query.ts:42 — Use parameterized queries
> 2. [MEDIUM] Session token in localStorage src/auth/session.ts:15 — Use HttpOnly cookies
> 3. [LOW] Verbose error messages src/api/handler.ts:88 — Sanitize error output
>
> **Code Quality Review** (1 finding)
> 1. [MEDIUM] Duplicated validation logic in src/api/users.ts:30 and src/api/posts.ts:25 — Extract shared validator

### 6. User Triage

THEN, in a separate message, ask the user how to handle the findings using `AskUserQuestion`. Always offer bulk options first:

```
AskUserQuestion({
  questions: [{
    question: "[N] findings from [M] reviewers. How would you like to proceed?",
    header: "Review triage",
    multiSelect: false,
    options: [
      { label: "Fix all", description: "Accept all findings and dispatch fix agents" },
      { label: "Dismiss all", description: "Dismiss all findings and proceed" },
      { label: "Triage individually", description: "Review each finding and choose accept or dismiss" }
    ]
  }]
})
```

If the user chooses **Triage individually**, present findings grouped by reviewer using `AskUserQuestion` with `multiSelect: true` — selected findings are accepted, unselected are dismissed. Note: `AskUserQuestion` supports max 4 options per question. If there are more than 4 findings, group into multiple questions by reviewer.

After triage, record the review cycle with `invoke_set_state` under `review_cycles`. Save the reviewers, findings, and triage result (`accepted` / `dismissed`). For final review cycles in this stage, include `scope: 'final'`.

### 7. Auto-Fix Accepted Findings

**ALWAYS dispatch builder agents for fixes — NEVER fix code directly in the session.** Fixing directly bypasses the pipeline (no worktrees, no state tracking, no validation).

Bundle accepted findings as fix tasks. For each finding, create a task:
- `task_description`: the finding details + suggestion
- `acceptance_criteria`: the specific fix expected
- `relevant_files`: the file(s) mentioned in the finding

Dispatch fix tasks using `invoke_dispatch_batch` with `create_worktrees: true`.

Call `invoke_get_batch_status` to wait for completion. Merge worktrees, run post-merge commands, validate — same flow as a regular build batch.

### 8. Next Cycle

After fixes are applied, ask the user:
> "Fixes applied. Want to run another review cycle, or are you satisfied?"

If another cycle: loop back to step 3.
If satisfied: proceed to completion.

### 9. Complete Pipeline

Use the same slug from the spec/plan filenames. Save the review history using `invoke_save_artifact`:
- `stage: "reviews"`
- `filename: "YYYY-MM-DD-<slug>-review-N.json"` (e.g., `2026-04-03-auth-middleware-review-1.json`)

#### Update Project Context

After saving the review history, update context.md to record what was built:

1. Call `invoke_get_context` to check if context.md exists. If not, skip this step.
2. Call `invoke_update_context` with:
   - `section: "Completed Work"`
   - `mode: "append"`
   - `content: "\n- [date]: [one-line summary of what was built] (spec: [spec filename])"`
3. If the build changed the project's architecture (new directories, components, or significant structural changes), call `invoke_update_context` with:
   - `section: "Architecture"`
   - `mode: "replace"`
   - `content: [updated architecture description]`
4. If there are accepted findings that were NOT fixed (deferred), call `invoke_update_context` with:
   - `section: "Known Issues"`
   - `mode: "append"`
   - `content: "\n- [finding summary] (deferred from pipeline [id])"`

At pipeline completion, call `invoke_get_metrics` and print a usage summary:

```
📊 Pipeline Usage Summary
   ├─ Total dispatches: [N]
   ├─ By stage: scope ([N]), plan ([N]), build ([N]), review ([N])
   ├─ By provider: claude ([N]), codex ([N])
   ├─ Total prompt chars: [N]
   └─ Total duration: [N]s
```

Get this data from `invoke_get_metrics`: use `summary.total_dispatches`, `summary.total_prompt_chars`, `summary.total_duration_ms`, and `summary.by_stage`; convert `summary.total_duration_ms` to seconds for the final line; aggregate `entries` by `provider` for the provider line; print `0` for any missing stage before rendering the summary.

### 10. Commit Strategy

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
