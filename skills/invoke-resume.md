---
name: invoke-resume
description: Use when the user returns to a project that has an in-progress invoke pipeline, or when a session-start hook detects active pipeline state
---

# Invoke — Resume Pipeline

You are resuming an in-progress invoke pipeline from a previous session.

## Flow

### 1. Read State

Call `invoke_get_state` to get the current pipeline state.

If state is null, inform the user there's no active pipeline and offer to start one (which will trigger invoke-scope).

### 2. Present Status

Present the pipeline status clearly:

> "Found an active invoke pipeline:"
> - **Pipeline ID:** [id]
> - **Started:** [date]
> - **Current Stage:** [stage]
> - **Spec:** [spec filename if set]
> - **Plan:** [plan filename if set]
> - **Strategy:** [strategy if set]
> - **Batches:** [N completed / M total]
> - **Work Branch:** [branch name if set]

If there are any active worktrees, list them.

### 3. Offer Options

> "What would you like to do?"
> 1. **Continue** — pick up where we left off at the [stage] stage
> 2. **Redo current stage** — restart the [stage] stage from scratch
> 3. **Abort** — clean up and start fresh

### 4. Handle Choice

**Continue:**
- Load the appropriate stage skill based on `current_stage`:
  - `scope` — invoke-scope picks up at clarifying questions (research may already be done)
  - `plan` — invoke-plan picks up at planner dispatch or plan selection
  - `orchestrate` — invoke-orchestrate picks up at task breakdown
  - `build` — invoke-build resumes at the next incomplete batch
  - `review` — invoke-review resumes at reviewer selection

**Redo:**
- Reset state for the current stage but keep prior stage outputs
- Re-trigger the current stage skill

**Abort:**
- Clean up worktrees via `invoke_cleanup_worktrees`
- Reset pipeline state
- Inform user: "Pipeline cleaned up. Ready to start fresh."

## Worktree Recovery

If the state shows worktrees that may be orphaned (session crashed during build):

> "Found [N] worktrees from the previous session. Some may have incomplete work."
> 1. **Keep and merge** — merge whatever was completed
> 2. **Discard** — clean up all worktrees and restart the batch
> 3. **Inspect** — let me check each worktree's status first

If "Inspect": check each worktree for uncommitted changes and committed changes, then present options per worktree.
