---
name: invoke-resume
description: "MUST USE when the user returns to a project with an active invoke pipeline, or when session-start hook detects active state. Triggers on: 'continue', 'resume', 'where was I', 'pick up where I left off', active pipeline detected."
---

# Invoke — Resume Pipeline

You are resuming an in-progress invoke pipeline from a previous session.

## Messaging Rules

**ALWAYS use `AskUserQuestion` for user decisions.** Never print options as text and wait for free-form input. If only 1 option exists, auto-select it.

## Flow

### 1. Read State

Call `invoke_get_state` to get the current pipeline state.

If state is null, inform the user there's no active pipeline and offer to start one (which will trigger invoke-scope).

### 2. Present Status

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
>   • [task-id]: ✅ completed
>   • [task-id]: ❌ error — [result_summary]
>   • [task-id]: ⏳ pending

### 3. Check for Orphaned Worktrees

Call `invoke_cleanup_worktrees` with `discover_only: true` (or read the worktree list) to check for worktrees that exist on disk but may be from a crashed session.

If orphaned worktrees are found:

> "Found [N] worktrees from the previous session. Some may have incomplete work."
> 1. **Keep and merge** — merge whatever was completed
> 2. **Discard** — clean up all worktrees and restart the affected tasks
> 3. **Inspect** — let me check each worktree's status first

If "Inspect": check each worktree for uncommitted changes and committed changes via `git -C <worktree_path> status` and `git -C <worktree_path> log --oneline -5`, then present options per worktree.

### 4. Offer Options

> "What would you like to do?"
> 1. **Continue** — pick up where we left off at the [stage] stage
> 2. **Redo current stage** — restart the [stage] stage from scratch
> 3. **Abort** — clean up and start fresh

### 5. Handle Choice

**Continue:**
- Load the appropriate stage skill based on `current_stage`:
  - `scope` — invoke-scope picks up at clarifying questions (research may already be done)
  - `plan` — invoke-plan picks up at planner dispatch or plan selection
  - `orchestrate` — invoke-orchestrate picks up at task breakdown
  - `build` — invoke-build resumes at the **next incomplete batch**. Within a batch, only re-dispatch tasks that are NOT `completed`. Present: "Batch [N]: [M] of [T] tasks already completed. Resuming [T-M] remaining tasks."
  - `review` — invoke-review resumes at reviewer selection

**Redo:**
- Reset state for the current stage but keep prior stage outputs
- Re-trigger the current stage skill

**Abort:**
- Clean up worktrees via `invoke_cleanup_worktrees`
- Reset pipeline state
- Inform user: "Pipeline cleaned up. Ready to start fresh."
