---
name: invoke-build
description: "MUST USE when an orchestrated task breakdown has been approved and is ready to build. Triggers after invoke-orchestrate completes. Do not dispatch build agents without this skill."
---

# Invoke — Build Stage

You are running the build stage. Your job is to dispatch builder agents for each batch, manage worktrees, merge results, and track progress.

## Messaging

Load the `invoke-messaging` skill and follow its standards for all user-facing output — agent dispatches, progress updates, results, errors, and selection prompts. Use `AskUserQuestion` for all user decisions.

## Flow

### 1. Verify State

Call `invoke_get_state` to verify we're at the build stage. Read the task breakdown from `invoke_read_artifact` with `stage: "plans"`, `filename: "tasks.json"`.

### 2. Create Work Branch

The first time build runs for this pipeline, note the current branch. All build work happens on a temporary work branch — but since agents work in worktrees, the current branch stays clean until merge.

### 3. Execute Batches

For each batch in order:

#### a. Select Builders

Present available builders using `AskUserQuestion` with `multiSelect: true`, noting the batch number and task count in the question text. Each option's description includes provider(s), model(s), and effort.

#### b. Dispatch Batch

Call `invoke_dispatch_batch` with:
- `tasks`: the batch's tasks with their task_context
- `create_worktrees: true`

Each task's prompt is composed by the MCP from the builder role template + strategy template + task context.

#### c. Monitor Progress

Call `invoke_get_batch_status` with the batch ID — it will wait up to 60 seconds for a status change before returning. Keep calling until the batch completes. Do NOT use `sleep` between calls. Report progress to the user:
> "Batch N progress: task-1 ✅, task-2 running, task-3 running"

**CRITICAL: Do NOT proceed to step d while any tasks in the batch are still running.** You must wait for all tasks to complete or fail. If the batch has been running for more than 10 minutes, use `AskUserQuestion` to ask the user whether to keep waiting, cancel remaining tasks and proceed with completed ones, or abort the batch.

#### d. Collect Results

When the batch completes, review results:
- For successful tasks: proceed to merge
- For failed tasks: present the error and ask: "Retry, skip, or abort batch?"

#### e. Merge Worktrees

For each completed task, call `invoke_merge_worktree` with the task_id. This merges the worktree branch and cleans up.

If a merge conflict occurs, present it to the user and help resolve it.

#### f. Post-Merge Validation

After all worktrees in a batch are merged, call `invoke_run_post_merge` to regenerate lockfiles (e.g., `composer.lock`, `package-lock.json`) before running validation. If any command fails, present the error and help the user resolve it before continuing.

The post-merge validation hook will run automatically (lint, tests). If it fails, present the failure and help fix it before proceeding.

#### g. Update State

Update the batch status in the pipeline state via `invoke_set_state`.

#### h. Inter-Batch Review (optional)

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

If the user selects reviewers, present the available reviewers from `invoke_get_config` using `AskUserQuestion` with `multiSelect: true` (same as the review stage selection). Then follow the standard review flow: dispatch selected reviewers, present findings, let user triage, dispatch fix tasks if needed. Once satisfied, continue to the next batch.

### 4. Build Complete

When all batches are done, update state:
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
