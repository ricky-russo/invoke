---
name: invoke-resume
description: "MUST USE when the user returns to a project with an active invoke pipeline, or when session-start hook detects active state. Triggers on: 'continue', 'resume', 'where was I', 'pick up where I left off', active pipeline detected."
---

# Invoke — Resume Pipeline

You are resuming an in-progress invoke pipeline from a previous session.

## Messaging

**BEFORE doing anything else**, invoke the `invoke-messaging` skill using the Skill tool (`Skill({ skill: "invoke:invoke-messaging" })`). This loads the messaging format standards you MUST follow for all output. Do NOT proceed with any pipeline steps until invoke-messaging is loaded. Use `AskUserQuestion` for all user decisions.

## Flow

### 1. Discover Sessions

Call `invoke_list_sessions` first to discover all active sessions.

If there are no active sessions, inform the user and offer to start a new pipeline.

If there is only one active session, auto-select it and inform the user: "Auto-selecting [pipeline_id] (only active pipeline)." Do not present `AskUserQuestion` with a single option — per the messaging standard, skip selection UI when there is only one choice.

If there are multiple active sessions, present them to the user for selection using `AskUserQuestion`.

Use the chosen session's `session_id` for all subsequent state tool calls in this flow. The chosen `session_id` is the same value as the pipeline's `pipeline_id`, and the tools remain backward-compatible because `session_id` is optional.

### 2. Read State

Call `invoke_get_state` with the selected `session_id` to get the current pipeline state.

If state is null, inform the user there's no active pipeline and offer to start one (which will trigger invoke-scope).

### 3. Present Status

Present the pipeline status clearly, including the last activity timestamp:

> "Found an active invoke pipeline:"
> - **Pipeline ID:** [id]
> - **Started:** [date]
> - **Last Active:** [last_updated — highlight if more than 24 hours ago]
> - **Current Stage:** [stage]
> - **Spec:** [spec filename if set]
> - **Plan:** [plan filename if set]
> - **Strategy:** [strategy if set]
> - **Work Branch:** [branch name if set]

For each batch, show task-level progress:

> **Batch [N]:** [status] — [completed]/[total] tasks
>   • [task-id]: ✅ merged
>   • [task-id]: ✅ completed awaiting merge
>   • [task-id]: ❌ error — [result_summary]
>   • [task-id]: ⏳ pending

### 4. Check for Orphaned Worktrees

To discover orphaned worktrees, read the pipeline state from `invoke_get_state`. For each batch, check each task's `worktree_path` field. If a `worktree_path` is set and the task is not marked `merged: true`, verify the worktree still exists on disk by running `git worktree list` via Bash and checking if the path appears. Worktrees that exist on disk but have tasks not marked completed are candidates for orphan inspection.

If orphaned worktrees are found:

```
AskUserQuestion({
  questions: [{
    question: "Found [N] worktrees from the previous session. Some may have incomplete work.",
    header: "Orphaned worktrees",
    multiSelect: false,
    options: [
      { label: "Keep and merge", description: "Merge whatever was completed" },
      { label: "Discard", description: "Clean up all worktrees and restart the affected tasks" },
      { label: "Inspect", description: "Check each worktree's status first" }
    ]
  }]
})
```

If "Inspect": check each worktree for uncommitted changes and committed changes via `git -C <worktree_path> status` and `git -C <worktree_path> log --oneline -5`, then present options per worktree.

### 5. Offer Options

```
AskUserQuestion({
  questions: [{
    question: "What would you like to do?",
    header: "Resume pipeline",
    multiSelect: false,
    options: [
      { label: "Continue", description: "Pick up where we left off at the [stage] stage" },
      { label: "Redo current stage", description: "Restart the [stage] stage from scratch" },
      { label: "Abort", description: "Clean up and start fresh" }
    ]
  }]
})
```

### 6. Handle Choice

**Continue:**
- Load the appropriate stage skill based on `current_stage` by calling `Skill()`:
  - `scope` — `Skill({ skill: "invoke:invoke-scope" })` — check if context.md exists via `invoke_get_context`. If not initialized, invoke-scope should resume at context initialization (step 2). If context exists, invoke-scope picks up at researcher dispatch or clarifying questions (research may already be done).
  - `plan` — `Skill({ skill: "invoke:invoke-plan" })` — invoke-plan picks up at planner dispatch or plan selection
  - `orchestrate` — `Skill({ skill: "invoke:invoke-orchestrate" })` — invoke-orchestrate picks up at task breakdown
  - `build` — `Skill({ skill: "invoke:invoke-build" })` — invoke-build resumes at the **next batch with unmerged work or unresolved failures**. Within a batch, never re-dispatch tasks already marked `merged: true`, and never re-dispatch tasks already `completed` but awaiting merge. Only re-dispatch tasks that are both unmerged and incomplete. Present: "Batch [N]: [M] merged, [R] completed awaiting merge, resuming [U] remaining tasks."
  - `review` — `Skill({ skill: "invoke:invoke-review" })` — invoke-review resumes at reviewer selection

**Redo:**

Reset state for the current stage but keep prior stage outputs, then re-invoke the stage skill. Per-stage operations:

- **scope:** Call `invoke_set_state({ session_id: "<pipeline_id>", spec: "", batches: [] })`. Keep context.md.
- **plan:** Call `invoke_set_state({ session_id: "<pipeline_id>", plan: "", strategy: "" })`. Keep spec.
- **orchestrate:** Call `invoke_set_state({ session_id: "<pipeline_id>", strategy: "", batches: [] })`. Keep spec and plan.
- **build:** Call `invoke_cleanup_worktrees({})` to remove existing worktrees, then call `invoke_set_state({ session_id: "<pipeline_id>", batches: [] })`. Keep spec, plan, and strategy.
- **review:** Call `invoke_set_state({ session_id: "<pipeline_id>", review_cycles: [] })`. Keep everything else.

After clearing the appropriate fields, re-invoke the stage skill using the same `Skill()` calls listed under Continue above.

**Abort:**

1. Call `invoke_cleanup_worktrees({})` to remove all worktrees.
2. Call `invoke_cleanup_sessions({ session_id: "<pipeline_id>" })` to remove the session.
3. Inform the user: "Pipeline cleaned up. Ready to start fresh — use invoke-scope to begin a new pipeline."
