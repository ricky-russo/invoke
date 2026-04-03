# Pipeline State Recovery

**Date:** 2026-04-03
**Status:** Draft

## Goal

Make invoke fully recoverable from session interruptions at any point in the pipeline by persisting all state to disk on every mutation.

## Problem

Five gaps make invoke unable to recover from session interruptions:

1. **Batch state in-memory only** — `BatchManager` stores batch records in a `Map` that dies with the MCP server process. Batch/task progress is lost on interruption.
2. **Worktree tracking in-memory only** — `WorktreeManager` uses a `Map`. Orphaned worktrees become invisible after a crash.
3. **Intermediate results not persisted** — Research/planner output exists only in the in-memory batch records. Lost if session dies before Claude processes them.
4. **`invoke_set_state` can't update nested state** — The Zod schema only accepts flat top-level fields. No way to persist batch/task granular progress through the tool.
5. **No timestamps** — `PipelineState` has `started` but no `last_updated`. Can't tell when a pipeline was last active for staleness decisions.

## Requirements

### Persist on every mutation

Every time batch, task, or worktree state changes, the change must be written to `.invoke/state.json` before the operation is considered complete. Recovery reads from this file on startup.

### Task-level recovery

On resume, invoke must know exactly which tasks completed, which were mid-flight, and which haven't started. It must be able to resume only the incomplete tasks rather than redoing an entire batch.

### Worktree discovery

On resume, invoke must be able to discover orphaned worktrees on disk even if the in-memory tracking was lost. Git worktrees created by invoke follow a naming convention (`invoke-wt-*`) that can be matched.

### Timestamps

Every state write includes a `last_updated` ISO timestamp. This allows the resume skill to assess staleness and make informed decisions.

## Architecture

### StateManager changes

Add to `src/tools/state.ts`:

- `last_updated: string` written automatically on every `update()` call
- `updateTask(batchIndex: number, taskId: string, updates: Partial<TaskState>): Promise<PipelineState>` — updates a specific task within a batch without replacing the entire array
- `addBatch(batch: BatchState): Promise<PipelineState>` — appends a new batch to the `batches` array
- `updateBatch(batchIndex: number, updates: Partial<BatchState>): Promise<PipelineState>` — updates batch-level fields (e.g., status)

### BatchManager changes

Modify `src/dispatch/batch-manager.ts`:

- Accept `StateManager` as a constructor dependency
- On every agent status transition (pending → dispatched → running → completed/error), call `stateManager.updateTask()` to persist the change
- On batch completion, call `stateManager.updateBatch()` to update the batch-level status
- Store agent results in state as they complete (not just in-memory)
- On `getStatus()`: if the in-memory map has no record for a batch ID, fall back to reading from `state.json` (handles process restart)

### WorktreeManager changes

Modify `src/worktree/manager.ts`:

- After creating a worktree, persist the path/branch to the task's `worktree` field in `state.json` via state manager
- `listActive()` reads from both the in-memory map AND `git worktree list` output, matching `invoke-wt-*` branches
- New method `discoverOrphaned(): Promise<WorktreeInfo[]>` — runs `git worktree list`, filters for invoke branches, returns any not tracked in-memory

### `invoke_set_state` tool changes

Update `src/tools/state-tools.ts`:

- Add `batches` and `review_cycles` to the Zod schema so skills can persist full structured progress
- These accept the full array shapes from the types

### PipelineState type changes

Update `src/types.ts`:

- Add `last_updated: string` to `PipelineState`
- Add `worktree_path?: string` and `worktree_branch?: string` to `TaskState` (more explicit than the current `worktree?: string | null`)

### Resume skill improvements

Update `skills/invoke-resume/SKILL.md`:

- Read task-level progress from `state.json`
- Present granular status: "Batch 2: 3/5 tasks complete. Resume the 2 incomplete tasks?"
- Use `discoverOrphaned()` to find worktrees that exist on disk but aren't in state
- Show `last_updated` in the status display so user knows how stale the pipeline is

### File changes

| File | Change |
|---|---|
| `src/types.ts` | Add `last_updated` to PipelineState, expand TaskState worktree fields |
| `src/tools/state.ts` | Add `updateTask()`, `addBatch()`, `updateBatch()`, auto-set `last_updated` |
| `src/tools/state-tools.ts` | Add `batches` and `review_cycles` to `invoke_set_state` schema |
| `src/dispatch/batch-manager.ts` | Accept StateManager, persist on every status transition |
| `src/worktree/manager.ts` | Persist worktree info to state, add `discoverOrphaned()` |
| `skills/invoke-resume/SKILL.md` | Task-level resume, orphan discovery, staleness display |
| `tests/tools/state.test.ts` | Tests for new methods |
| `tests/dispatch/batch-manager.test.ts` | Tests for state persistence during batch execution |
| `tests/worktree/manager.test.ts` | Tests for orphan discovery |

## Constraints

- State writes must be atomic — write to temp file then rename, to avoid corrupt `state.json` on crash during write
- State file should not grow unbounded — agent result `raw` output can be large. Store only `summary` and `status` in state; full output goes to artifacts
- No breaking changes to existing `invoke_get_state` output shape — only additive fields

## Acceptance criteria

- [ ] Every batch/task status transition is persisted to `state.json`
- [ ] Worktree paths are persisted and discoverable after process restart
- [ ] `last_updated` is set on every state write
- [ ] `invoke_set_state` accepts `batches` and `review_cycles`
- [ ] `StateManager.updateTask()` can update a single task without replacing the array
- [ ] Resume skill can present task-level progress
- [ ] Orphaned worktrees are discoverable via `git worktree list`
- [ ] State writes are atomic (temp file + rename)
- [ ] All existing tests pass
- [ ] Agent result raw output is NOT stored in state (only summary/status)

## Out of scope

- State migration from old format (no existing deployments with state files)
- Multi-pipeline support (one active pipeline at a time)
- State encryption or access control
