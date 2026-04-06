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

Call `invoke_get_state` with `session_id: <pipeline_id>` to verify we're at the build stage. Read the task breakdown from `invoke_read_artifact` with `stage: "plans"` and the filename from `state.tasks` (for example, `state.tasks.replace('plans/', '')`).

If build is resuming from existing state, inspect the saved batch/task records before dispatching anything:
- A task with `merged: true` is already finished. Never re-dispatch it.
- A task with `status: "completed"` and `merged !== true` is ready to merge. Offer that merge instead of re-dispatching it.
- Only re-dispatch tasks that are both unmerged and incomplete (`pending`, `dispatched`, `running`, or a failed task the user explicitly chose `Retry` for).

Present resumed batch status in task buckets so the user can see what is already merged vs. still pending:
> "Batch N: 2 merged, 1 completed awaiting merge, 1 running, 1 failed"

### 2. Create Work Branch

The first time build runs for this pipeline, note the current branch. All build work happens on a temporary work branch — but since agents work in worktrees, the current branch stays clean until merge.

The `invoke_dispatch_batch` tool with `create_worktrees: true` automatically creates git worktrees for each task. Do not manually run `git checkout -b` or create branches — the dispatch tool handles this. The current branch stays clean until worktrees are merged back.

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

#### c. Dispatch or Resume Batch

For a new batch, call `invoke_dispatch_batch` with:
- `tasks`: the batch's tasks with their task_context
- `create_worktrees: true`

The response includes the **resolved provider/model/effort** for each task (read from the current pipeline.yaml). Use this info for your dispatch message — do NOT guess the provider before the tool returns. Display the dispatch summary AFTER receiving the response.

After dispatching, note that `invoke_get_metrics` can be called with `session_id: <pipeline_id>` at any time to inspect current pipeline usage and dispatch limits.

For a resumed batch:
- Do NOT re-dispatch tasks that are already merged.
- Do NOT re-dispatch tasks that are already completed but not yet merged.
- Re-dispatch only the unmerged incomplete tasks.
- Present: "Batch [N]: [M] merged, [R] completed awaiting merge, resuming [U] remaining tasks."

If there are no tasks to re-dispatch on resume, skip straight to progress/merge handling for the existing batch state.

#### d. Monitor Progress and Offer Immediate Merge

Call `invoke_get_batch_status` with the batch ID — it will wait up to 60 seconds for a status change before returning. Keep calling until every task in the batch is resolved. Do NOT use `sleep` between calls.

On every poll, report progress by bucket so the user can see what is already merged vs. waiting vs. failed:
> "Batch N progress: merged [task-1], awaiting merge [task-2], pending [task-3], failed [task-4]"

If a task completes successfully and has a worktree, offer to merge it immediately. Do NOT wait for the rest of the batch. Use `AskUserQuestion`:

```
AskUserQuestion({
  questions: [{
    question: "[task_id] completed successfully. Merge it now?",
    header: "Merge task",
    multiSelect: false,
    options: [
      { label: "Merge now", description: "Merge this task immediately and run post-merge validation before any other merge" },
      { label: "Wait", description: "Leave it completed for now and revisit after the next status change" }
    ]
  }]
})
```

If multiple tasks become ready at the same time, keep the old batch-level user experience: present the ready tasks together if helpful, but merge them one at a time in task order with validation between merges.

If the batch has been running for more than 10 minutes, use `AskUserQuestion` to ask the user whether to keep waiting, cancel remaining tasks and proceed with completed ones, or abort the batch.

> **Note:** Build tasks use a 10-minute timeout threshold (vs 5 minutes for research, planning, and review stages) because build agents perform more work: reading existing code, implementing changes, running tests, and committing. This is intentional.

#### e. Recover Failed Tasks

If a task returns `error` or `timeout`, present the failure and ask what to do with that task: `Retry`, `Skip`, or `Abort`.

- `Retry`: re-dispatch only that failed task, then resume polling.
- `Skip`: leave that task failed for this batch and continue merging other successful tasks.
- `Abort`: stop the batch.

Failed tasks do NOT block merging successful tasks that are already completed. Other completed tasks can still be merged while you work through failed-task recovery.

#### e.1 Bug Recording

When a build agent fails and the error appears to be a pre-existing bug (not merely a task-specific failure such as a merge conflict or a missing dependency introduced by this pipeline):

1. Ask the user via `AskUserQuestion`: "Agent [task_id] encountered what appears to be a pre-existing bug. Want to log it?"
2. If yes, call `invoke_report_bug` with `title`, `description` from the error output, a `severity` estimate, `file`/`line` if available in the stack trace or error message, and `session_id` from the current pipeline.
3. Confirm: "Logged [BUG-NNN]: [title]"

#### f. Merge and Validate Sequentially

When the user chooses to merge a ready task, call `invoke_merge_worktree` for that task only. This merges the worktree branch and cleans up.

If a merge conflict occurs, present it to the user and help resolve it.

Immediately after each successful merge, call `invoke_run_post_merge` before attempting any other merge. The post-merge validation hook will then run automatically (lint, tests). If any post-merge command or validation step fails, present the failure and help fix it before continuing to the next merge.

Never merge two tasks back-to-back without running `invoke_run_post_merge` and waiting for validation between them. This catches conflicts early.

#### g. Update State

Keep the batch state current via `invoke_set_state` with `session_id: <pipeline_id>` throughout the batch:
- After each successful merge, update that task with `TaskState.merged: true`.
- Use batch status `in_progress` while work is still actively running.
- Use batch status `partial` when some tasks are already merged or skipped but the batch still has remaining unmerged work or unresolved failures.
- Use batch status `completed` only when every successful task is merged and every failed task has been retried successfully or explicitly skipped.
- Use batch status `error` if the user aborts or the batch cannot continue.

When resuming, rely on this saved state instead of guessing from the filesystem. Tasks already marked `merged: true` are done; tasks marked `completed` but not merged should be offered for merge; only unmerged incomplete tasks should be re-dispatched.

#### h. Inter-Batch Review (optional)

After each batch is fully resolved — all successful tasks merged and validated, all failed tasks retried or explicitly skipped — ask the user if they want to run reviewers before proceeding to the next batch. Use `AskUserQuestion`:

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

**For accepted findings that need fixing: ALWAYS dispatch builder agents via `invoke_dispatch_batch` with worktrees.** Do NOT fix code directly in the session — that bypasses the pipeline (no worktrees, no state tracking, no validation). Bundle accepted findings as fix tasks, dispatch builders, merge, validate — same flow as a regular build batch. Structure fix tasks the same way as invoke-review step 7 defines them: each fix task gets the finding details, the file and line reference, and the suggested fix as `task_context`. Set the builder subrole based on the nature of the fix (e.g., `docs` for documentation fixes, `default` for code fixes).

When you record an inter-batch review cycle with `invoke_set_state`, include `session_id: <pipeline_id>`, `batch_id: <current batch id>`, and `scope: 'batch'`. This is especially important when accepted findings trigger fix dispatches, so later review-cycle checks stay tied to the correct batch.

### 4. Build Complete

When all batches are done, update state via `invoke_set_state` with `session_id: <pipeline_id>`:
- `current_stage: "review"`

Then invoke `Skill({ skill: "invoke:invoke-review" })` to begin the review stage.

### Bug Resolution

After the final build batch completes:

1. Read pipeline state via `invoke_get_state` with `session_id: <pipeline_id>`.
2. If `state.bug_ids` is present and non-empty, note them — they will be resolved when the pipeline ultimately completes (after review).

## Error Handling

- **Agent timeout**: Present error, offer retry/skip/abort
- **Agent error**: Present raw output, offer retry/skip/abort
- **Merge conflict**: Present conflicts, help user resolve
- **Validation failure**: Present test/lint output, help fix before merging the next task or starting the next batch
- **User abort**: Clean up worktrees via `invoke_cleanup_worktrees`, ask if they want to keep or discard the work branch

## Key Principles

- Never proceed to the next batch if the current batch has unresolved failures or unmerged successful tasks
- Always merge and validate one task at a time before starting the next merge or the next batch
- If all tasks complete at the same time, the flow is effectively the same as before: review the completed set, then merge sequentially with validation between merges
- Keep the user informed of progress without overwhelming them
