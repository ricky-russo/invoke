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

### 2. Work Branch (per-session integration worktree)

Read `config.settings.commit_style` via `invoke_get_config`. Default to `per-task` if unset. This value gates whether a per-batch collapse runs after each batch's final merge (see step g2).

If `state.work_branch` is set (new sessions initialized via `invoke_session_init_worktree` in invoke-scope), all merges in this build stage will go into the session integration worktree at `state.work_branch_path`. The `invoke_merge_worktree` tool automatically routes there when given `session_id`.

If `state.work_branch` is NOT set (legacy sessions from before per-session-branches), merges fall through to the user's repoDir HEAD branch — the legacy behavior. R8 of the spec preserves this for backwards compatibility.

Either way, you do NOT manually run `git checkout -b` or create a branch. The dispatch tool creates per-task worktrees, and the merge tool handles routing.

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
- `session_id: <pipeline_id>` — **REQUIRED.** Without `session_id`, builder worktrees branch from `main` instead of the session work branch, producing incorrect diffs. The server emits a warning when this happens but does not block dispatch (see BUG-015).

Always include `prior_findings: ''` (empty string) in each initial builder task's `task_context`. This substitutes to empty on R1, and the builder's `## Handling Prior Review Findings` section falls through silently when there are no prior findings. This prevents the composer from leaving an unresolved `{{prior_findings}}` literal in the rendered prompt.

For each task, include `timeout` in `task_context`. Before calling `invoke_dispatch_batch`, read the builder subrole's provider entry timeout from the config (via `invoke_get_config`): use the `timeout` field from `roles.builder.<subrole>.providers[0]`. If the provider entry has no `timeout`, fall back to `settings.agent_timeout`. If neither is set, use `'300'`. The value must be a string (e.g., `timeout: '900'`). This substitutes into `{{timeout}}` in the builder prompt template, giving the builder awareness of its time budget.

The response includes the **resolved provider/model/effort** for each task (read from the current pipeline.yaml). Use this info for your dispatch message — do NOT guess the provider before the tool returns. Display the dispatch summary AFTER receiving the response.

After dispatching, note that `invoke_get_metrics` can be called with `session_id: <pipeline_id>` at any time to inspect current pipeline usage and dispatch limits.

For a resumed batch:
- Do NOT re-dispatch tasks that are already merged.
- Do NOT re-dispatch tasks that are already completed but not yet merged.
- Re-dispatch only the unmerged incomplete tasks.
- Present: "Batch [N]: [M] merged, [R] completed awaiting merge, resuming [U] remaining tasks."

If there are no tasks to re-dispatch on resume, skip straight to progress/merge handling for the existing batch state.

#### d. Monitor Progress and Offer Immediate Merge

> **Session ownership:** Always pass `session_id: <pipeline_id>` on `invoke_get_batch_status` and `invoke_get_task_result` calls. The MCP server enforces session ownership on these tools to prevent cross-session data leakage.

Call `invoke_get_batch_status` with `{ batch_id, session_id: <pipeline_id> }` — it will wait up to 60 seconds for a status change before returning. The response contains `{ batchId, status, agents: [{ taskId, status }] }` — status information only, no result data. Keep calling until every task in the batch is terminal. Do NOT use `sleep` between calls.

When any agent transitions to a terminal state (`completed`, `error`, or `timeout`), immediately call `invoke_get_task_result({ batch_id, task_id, session_id: <pipeline_id> })` for that task to fetch its full result. **Never call `invoke_get_task_result` inside the polling loop for tasks still `pending`, `dispatched`, or `running` — the tool errors for non-terminal tasks.**

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

Bug recording applies in two cases:

**Case A — Agent failed with a pre-existing bug:** When a build agent fails and the error appears to be a pre-existing bug (not merely a task-specific failure such as a merge conflict or a missing dependency introduced by this pipeline):

1. Ask the user via `AskUserQuestion`: "Agent [task_id] failed on what appears to be a pre-existing bug. Want to log it?"
2. If yes, call `invoke_report_bug` with `title`, `description` from the error output, a `severity` estimate, `file`/`line` if available in the stack trace or error message, and `session_id` from the current pipeline.
3. Confirm: "Logged [BUG-NNN]: [title]"

**Case B — Agent succeeded but discovered a pre-existing bug:** When a build agent completes successfully but its output mentions a pre-existing bug in code it touched (e.g., a note in the commit message, output log, or artifact):

1. Ask the user via `AskUserQuestion`: "Agent [task_id] completed but reported a pre-existing bug. Want to log it?"
2. If yes, call `invoke_report_bug` with `title`, `description` from the agent's reported finding, a `severity` estimate, `file`/`line` if included, and `session_id` from the current pipeline.
3. Confirm: "Logged [BUG-NNN]: [title]"

#### f. Merge and Validate Sequentially

When the user chooses to merge a ready task, call `invoke_merge_worktree` for that task with `{ task_id, session_id: <pipeline_id> }`. This routes the squash merge into the session integration worktree (or the legacy repoDir for sessions without `state.work_branch`).

Immediately after each successful merge, call `invoke_run_post_merge` with `{ session_id: <pipeline_id> }` before attempting any other merge. The post-merge validation hook will then run automatically (lint, tests). If any post-merge command or validation step fails, present the failure and help fix it before continuing to the next merge.

Never merge two tasks back-to-back without running `invoke_run_post_merge` and waiting for validation between them. This catches conflicts early.

#### f.1 Conflict Response and Redispatch (R4 + C5 budget)

The `invoke_merge_worktree` tool returns one of two shapes:
- Success: `{ task_id, status: 'merged', commit_sha: '<sha>' }`
- Conflict: `{ task_id, status: 'conflict', conflicting_files: [...], merge_target_path: '...' }`

**WARNING:** Do NOT prompt the user for manual conflict resolution. The R4 + C5 redispatch loop handles conflicts automatically via the auto-redispatch budget; manual prompts are only valid AFTER the budget is exhausted (step 6 below).

If the response is `status: 'conflict'`:

1. Locate the conflicted task by id (you do not need to read the full tasks array — see step 4).

2. Compute the task's NEW `conflict_attempts` = (existing `conflict_attempts` ?? 0) + 1.

3. Compute the C5 BUDGET: read `max_review_cycles` from the `invoke_get_review_cycle_count` response (or fall back to 3 if unavailable). The conflict redispatch budget per task is `max(2, max_review_cycles)` — a task may be auto-redispatched up to that many times before manual escalation.

4. Update state via `invoke_set_state` with `batch_update`. `invoke_set_state` now merges `batch_update.tasks` by task id, so you can send ONLY the changed task entries:

   ```
   batch_update: {
     id: <batch-id>,
     status: 'in_progress',
     tasks: [
       {
         id: <conflicted-task-id>,
         status: 'conflict',
         conflict_attempts: <new-value>,
         conflicting_files: <array-from-merge-response>,
       }
     ]
   }
   ```

   Sibling tasks in the batch are preserved automatically. Do NOT read the full tasks array first — just send the delta.

5. If the new `conflict_attempts <= BUDGET` (auto-redispatch is still allowed):
   - Re-dispatch the same builder for the task by calling `invoke_dispatch_batch` with a single task whose `task_context` extends the original with conflict information. `invoke_dispatch_batch.task_context` is `Record<string, string>`. The redispatch task_context should include:
     - `original_task_description`: the original task_description string verbatim
     - `conflicting_files`: a comma-separated list of conflicting file paths (or JSON-encoded array)
     - `merge_target_path`: the path string from the merge response
     - `conflict_instructions`: a string explaining how to apply the rebuilt work on top of the integration worktree state
     - `current_files_json`: a JSON-encoded object mapping each conflicting file's full path (relative to `merge_target_path`) to its current contents. Using full paths as keys avoids basename collisions.

     Do NOT use a key per file (e.g. `current_<filename>`) — file basenames can collide. Use one `current_files_json` field instead.

     Before building `current_files_json`, compute the total byte size of the file contents. If the total exceeds 200 KB:
     - Include only the conflicting file PATHS in `current_files_json` (mapping each path to an empty string).
     - Set an additional task_context key `current_files_truncated: 'true'`.
     - Add to `conflict_instructions`: 'The current contents of the conflicting files were too large to inline (over 200 KB). Use the Read tool with paths under `merge_target_path` to read each file on demand.'

     If the total is under 200 KB, include the full contents inline. This bounds the redispatch payload to a sane size while still letting the rebuilt builder access full contents when needed.
   - Resume polling for that single-task batch as in step d (use `invoke_get_batch_status` + `invoke_get_task_result` with `session_id`).
   - When the redispatched builder completes, attempt `invoke_merge_worktree` again. If it succeeds, mark the task `merged: true` and continue. If it conflicts again, recurse to step 1 — this loop is bounded by the BUDGET.

6. If the new `conflict_attempts > BUDGET` (auto-redispatch budget exhausted per C5):
   - Use `AskUserQuestion` to escalate:
     ```
     AskUserQuestion({
       questions: [{
         question: 'Task [task_id] has exhausted the auto-redispatch budget ([N] attempts). What should I do?',
         header: 'Conflict',
         multiSelect: false,
         options: [
           { label: 'Skip', description: 'Skip this task for the current batch and continue with other tasks' },
           { label: 'Abort', description: 'Stop the entire batch' }
         ]
       }]
     })
     ```
   - Honor the user's choice:
     - **Skip**: mark the task with status `error` and a `result_summary` explaining the conflict; do NOT mark it merged. Continue with other tasks in the batch.
     - **Abort**: stop the entire batch.
   - Do NOT offer a Retry option — C5 forbids unbounded redispatch.

**The conflict redispatch counts as a normal builder dispatch and is automatically tracked by metrics.** The budget in step 3 enforces C5 by capping how many times a single task can re-enter this loop.

#### g. Update State

Keep the batch state current throughout the batch using `invoke_set_state` with `session_id: <pipeline_id>` and `batch_update: { id: <batch-id>, status: <status>, tasks: [...] }`:
- After each successful merge, capture `commit_sha` from the merge response and update that task with `merged: true` and `commit_sha`:
  ```
  batch_update: {
    id: <batch-id>,
    status: 'in_progress',
    tasks: [{ id: <task-id>, status: 'completed', merged: true, commit_sha: <sha from merge response> }]
  }
  ```
- Use batch status `in_progress` while work is still actively running.
- Use batch status `partial` when some tasks are already merged or skipped but the batch still has remaining unmerged work or unresolved failures.
- Use batch status `completed` only when every successful task is merged and every failed task has been retried successfully or explicitly skipped.
- Use batch status `error` if the user aborts or the batch cannot continue.

> **Guidance:** Use `batch_update` for all incremental batch and task progress writes. Reserve full `batches: [...]` array writes for clearing state (e.g., invoke-resume redo paths).

When resuming, rely on this saved state instead of guessing from the filesystem. Tasks already marked `merged: true` are done; tasks marked `completed` but not merged should be offered for merge; only unmerged incomplete tasks should be re-dispatched.

#### g2. Per-batch collapse (if commit_style = per-batch)

After all tasks in the batch are merged and state is updated (step g), check whether to collapse commits:

If `commit_style == 'per-batch'` AND `state.work_branch_path` is set (non-legacy session):
1. Determine the base SHA for this batch:
   - For batch 0: run `git merge-base <state.base_branch> HEAD` on the session work branch path
   - For batch N>0: use `state.batches[N-1].commit_sha`
2. Call `invoke_collapse_commits({ session_id: <pipeline_id>, base_sha, message: 'feat: batch-<N+1>' })`
3. Persist the returned commit_sha on the batch via `invoke_set_state`:
   ```
   batch_update: {
     id: <batch-id>,
     status: 'completed',
     commit_sha: <collapsed sha>,
     tasks: [<each task with its commit_sha updated to the collapsed sha>]
   }
   ```
4. After this, every task in this batch has its commit_sha replaced with the batch's collapsed commit_sha. They no longer exist as standalone commits on the work branch, so any future fix tasks must target the batch commit.

If `commit_style == 'per-batch'` AND `state.work_branch_path` is NOT set (legacy session):
  Skip the collapse. `invoke_collapse_commits` requires a session work branch path and would return an error otherwise. Legacy sessions fall back to append-only behavior: tasks keep their per-task commits, nothing is rewritten, and the skill prints: `Legacy session — per-batch collapse skipped; commits remain per-task.`

If `commit_style != 'per-batch'`:
  Skip this step. Tasks keep their per-task commit_sha.

#### g3. Batch-Boundary Context Enrichment

After step g2, review the current batch for durable discoveries before asking about inter-batch review:

1. Collect the `result.output.summary` / result summary for every completed task in the current batch. These summaries are already available from the `invoke_get_task_result({ batch_id, task_id, session_id: <pipeline_id> })` calls made in step d — reuse them.
2. Analyze the batch-level results for any newly established patterns, interfaces, conventions, or constraints.
3. Call `invoke_get_context` and read the current `Session Discoveries` content. It may be empty or may already contain cumulative discoveries from earlier batches.
4. If no meaningful discoveries emerged from this batch, skip this step.
5. Otherwise, write a complete cumulative replacement via `invoke_update_context({ section: 'Session Discoveries', mode: 'replace', content: <cumulative summary> })`.

Format `<cumulative summary>` as concise markdown bullet points grouped by `Patterns`, `Interfaces`, `Conventions`, and `Constraints`. Keep the entire section under 500 characters. Each update must be a full cumulative summary that supersedes the previous `Session Discoveries` content.

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

When dispatching builder fix agents for accepted findings, first call `invoke_get_prior_findings_for_builder({ session_id: <pipeline_id>, batch_id: <current batch id> })` and pass the result (from `result.content[0].text`) as `task_context.prior_findings` on every fix task, matching the pattern in `invoke-review` step 7. This gives the builder the same out-of-scope-filtered checklist the reviewer produced.

When you record an inter-batch review cycle, first call `invoke_get_review_cycle_count` with `session_id: <pipeline_id>` and the batch ID to obtain the current count, then use `count + 1` as the new monotonic `id`. Call `invoke_set_state` with `session_id: <pipeline_id>` and `review_cycle_update: { id: <next-id>, batch_id: <current batch id>, scope: 'batch', tier: <tier if applicable>, reviewers: [...], findings: [...], triaged: { accepted: [...], deferred: [...], dismissed: [...] } }`. This is especially important when accepted findings trigger fix dispatches, so later review-cycle checks stay tied to the correct batch.

### 4. Build Complete

When all batches are done:

#### 4a. Bug Resolution

1. Read pipeline state via `invoke_get_state` with `session_id: <pipeline_id>`.
2. If `state.bug_ids` is present and non-empty, note them — they will be resolved when the pipeline ultimately completes after review.

#### 4b. Transition to Review Stage

Update state via `invoke_set_state` with `session_id: <pipeline_id>`:
- `current_stage: "review"`

**CRITICAL — You MUST execute the `next_step` returned by `invoke_set_state` now. Do NOT dispatch reviewers yourself, do NOT run review logic inline, and do NOT skip this step.** The server validates the transition and the response includes a `next_step` field — execute it immediately to invoke the review stage.

**STOP HERE.** Do not proceed past this point in the build skill. The `next_step` response hands control to invoke-review, which takes over from here.

## Error Handling

- **Agent timeout**: Present error, offer retry/skip/abort
- **Agent error**: Present raw output, offer retry/skip/abort
- **Merge conflict**: handled automatically by the R4+C5 redispatch loop in step f.1. If the budget is exhausted, the user is prompted with Skip / Abort (no Retry).
- **Validation failure**: Present test/lint output, help fix before merging the next task or starting the next batch
- **User abort**: Clean up worktrees via `invoke_cleanup_worktrees`, ask if they want to keep or discard the work branch

## Key Principles

- Never proceed to the next batch if the current batch has unresolved failures or unmerged successful tasks
- Always merge and validate one task at a time before starting the next merge or the next batch
- If all tasks complete at the same time, the flow is effectively the same as before: review the completed set, then merge sequentially with validation between merges
- Keep the user informed of progress without overwhelming them
