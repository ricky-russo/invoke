---
name: invoke-build
description: Use when an orchestrated task breakdown has been approved and is ready to build — typically after invoke-orchestrate completes
---

# Invoke — Build Stage

You are running the build stage. Your job is to dispatch builder agents for each batch, manage worktrees, merge results, and track progress.

## Flow

### 1. Verify State

Call `invoke_get_state` to verify we're at the build stage. Read the task breakdown from `invoke_read_artifact` with `stage: "plans"`, `filename: "tasks.json"`.

### 2. Create Work Branch

The first time build runs for this pipeline, note the current branch. All build work happens on a temporary work branch — but since agents work in worktrees, the current branch stays clean until merge.

### 3. Execute Batches

For each batch in order:

#### a. Select Builders

Ask the user which builder roles to use for this batch:
> "Batch N ready ([X] tasks). Available builders: [list sub-roles under builder]. Which builders should handle these tasks?"

#### b. Dispatch Batch

Call `invoke_dispatch_batch` with:
- `tasks`: the batch's tasks with their task_context
- `create_worktrees: true`

Each task's prompt is composed by the MCP from the builder role template + strategy template + task context.

#### c. Monitor Progress

Poll `invoke_get_batch_status` periodically. Report progress to the user:
> "Batch N progress: task-1 ✅, task-2 running, task-3 running"

Allow the user to interact while waiting (e.g., "how's it going?").

#### d. Collect Results

When the batch completes, review results:
- For successful tasks: proceed to merge
- For failed tasks: present the error and ask: "Retry, skip, or abort batch?"

#### e. Merge Worktrees

For each completed task, call `invoke_merge_worktree` with the task_id. This merges the worktree branch and cleans up.

If a merge conflict occurs, present it to the user and help resolve it.

#### f. Post-Merge Validation

The post-merge validation hook will run automatically (lint, tests). If it fails, present the failure and help fix it before proceeding.

#### g. Update State

Update the batch status in the pipeline state via `invoke_set_state`.

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
