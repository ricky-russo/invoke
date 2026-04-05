---
name: invoke-build
description: "MUST USE when an orchestrated task breakdown has been approved and is ready to build. Triggers after invoke-orchestrate completes. Do not dispatch build agents without this skill."
---

# Invoke — Build Stage

You are running the build stage. Your job is to dispatch builder agents for each batch, manage worktrees, merge results, and track progress.

## Messaging

**BEFORE doing anything else**, invoke the `invoke-messaging` skill using the Skill tool (`Skill({ skill: "invoke:invoke-messaging" })`). This loads the messaging format standards you MUST follow for all output. Do NOT proceed with any pipeline steps until invoke-messaging is loaded. Use `AskUserQuestion` for all user decisions.

## Flow

All `invoke_get_state`, `invoke_set_state`, `invoke_get_metrics`, and `invoke_get_review_cycle_count` calls in this flow must include `session_id`, and `session_id` equals the pipeline's `pipeline_id`. The tools remain backward-compatible because `session_id` is optional, but do not omit it here.

### 1. Verify State

Call `invoke_get_state` with `session_id: <pipeline_id>` to verify we're at the build stage. Read the task breakdown from `invoke_read_artifact` with `stage: "plans"`, `filename: "tasks.json"`.

### 2. Create Work Branch

The first time build runs for this pipeline, note the current branch. All build work happens on a temporary work branch — but since agents work in worktrees, the current branch stays clean until merge.

### 3. Execute Batches

For each batch in order:

#### a. Check Review Cycle Guard Rail

Before selecting builders, call `invoke_get_review_cycle_count` with `session_id: <pipeline_id>` and the current orchestration batch ID (`batch.id`).

If the response includes `max_review_cycles` and `count >= max_review_cycles`, warn the user that this batch has reached the configured review-cycle limit and ask whether to continue allowing review cycles for this batch or skip further review cycles for it. Use `AskUserQuestion`:

```
AskUserQuestion({
  questions: [{
    question: "Batch [N] has already used [count]/[max_review_cycles] review cycles. Continue allowing review cycles for this batch?",
    header: "Review limit",
    multiSelect: false,
    options: [
      { label: "Continue", description: "Keep inter-batch review available for this batch" },
      { label: "Skip further review", description: "Build and validate this batch, but skip more review cycles for it" }
    ]
  }]
})
```

This guard rail is advisory. Do NOT block the build batch itself.

#### b. Select Builders

Present available builders using `AskUserQuestion` with `multiSelect: true`, noting the batch number and task count in the question text. Each option's description includes provider(s), model(s), and effort.

#### c. Dispatch Batch

Call `invoke_dispatch_batch` with:
- `tasks`: the batch's tasks with their task_context
- `create_worktrees: true`

The response includes the **resolved provider/model/effort** for each task (read from the current pipeline.yaml). Use this info for your dispatch message — do NOT guess the provider before the tool returns. Display the dispatch summary AFTER receiving the response.

After dispatching, note that `invoke_get_metrics` can be called with `session_id: <pipeline_id>` at any time to inspect current pipeline usage and dispatch limits.

#### d. Monitor Progress

Call `invoke_get_batch_status` with the batch ID — it will wait up to 60 seconds for a status change before returning. Keep calling until the batch completes. Do NOT use `sleep` between calls. Report progress to the user:
> "Batch N progress: task-1 ✅, task-2 running, task-3 running"

**CRITICAL: Do NOT proceed to step e while any tasks in the batch are still running.** You must wait for all tasks to complete or fail. If the batch has been running for more than 10 minutes, use `AskUserQuestion` to ask the user whether to keep waiting, cancel remaining tasks and proceed with completed ones, or abort the batch.

#### e. Collect Results

When the batch completes, review results:
- For successful tasks: proceed to merge
- For failed tasks: present the error and ask: "Retry, skip, or abort batch?"

#### f. Merge Worktrees

For each completed task, call `invoke_merge_worktree` with the task_id. This merges the worktree branch and cleans up.

If a merge conflict occurs, present it to the user and help resolve it.

#### g. Post-Merge Validation

After all worktrees in a batch are merged, call `invoke_run_post_merge` to regenerate lockfiles (e.g., `composer.lock`, `package-lock.json`) before running validation. If any command fails, present the error and help the user resolve it before continuing.

The post-merge validation hook will run automatically (lint, tests). If it fails, present the failure and help fix it before proceeding.

#### h. Update State

Update the batch status in the pipeline state via `invoke_set_state` with `session_id: <pipeline_id>`.

#### i. Inter-Batch Review (optional)

After each batch is merged and validated, ask the user if they want to run reviewers before proceeding to the next batch. Use `AskUserQuestion`:

```
AskUserQuestion({
  questions: [{
    question: "Batch [N] complete and merged. Run reviewers before batch [N+1]?",
    header: "Inter-batch review",
    multiSelect: false,
    options: [
      { label: "Select reviewers", description: "Choose which reviewers to dispatch against the current codebase" },
      { label: "Skip", description: "Proceed to batch [N+1] without review" }
    ]
  }]
})
```

If the user selects reviewers, present the available reviewers from `invoke_get_config` using `AskUserQuestion` with `multiSelect: true` (same as the review stage selection). Then follow the standard review flow: dispatch selected reviewers, present findings. For triage, always offer "Fix all / Dismiss all / Triage individually" as the first choice before drilling into individual findings.

If step a resulted in "Skip further review", skip this prompt for the current batch and continue to the next batch after validation.

**For accepted findings that need fixing: ALWAYS dispatch builder agents via `invoke_dispatch_batch` with worktrees.** Do NOT fix code directly in the session — that bypasses the pipeline (no worktrees, no state tracking, no validation). Bundle accepted findings as fix tasks, dispatch builders, merge, validate — same flow as a regular build batch.

When you record an inter-batch review cycle with `invoke_set_state`, include `session_id: <pipeline_id>`, `batch_id: <current batch id>`, and `scope: 'batch'`. This is especially important when accepted findings trigger fix dispatches, so later review-cycle checks stay tied to the correct batch.

### 4. Build Complete

When all batches are done, update state via `invoke_set_state` with `session_id: <pipeline_id>`:
- `current_stage: "review"`

The review stage skill will auto-trigger from here.

## Error Handling

- **Agent timeout**: Present error, offer retry/skip/abort
- **Agent error**: Present raw output, offer retry/skip/abort
- **Merge conflict**: Present conflicts, help user resolve
- **Validation failure**: Present test/lint output, help fix before next batch
- **User abort**: Clean up worktrees via `invoke_cleanup_worktrees`, ask if they want to keep or discard the work branch

## Key Principles

- Never proceed to the next batch if the current batch has unresolved failures
- Always merge and validate before starting the next batch
- Keep the user informed of progress without overwhelming them
