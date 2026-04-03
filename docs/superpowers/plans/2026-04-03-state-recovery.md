# State Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make invoke fully recoverable from session interruptions by persisting all batch/task/worktree state to disk on every mutation.

**Architecture:** Enhance `StateManager` with atomic writes, granular update methods (`updateTask`, `addBatch`, `updateBatch`), and auto-timestamping. Wire `BatchManager` and `WorktreeManager` to persist through `StateManager`. Add worktree orphan discovery via `git worktree list`. Update `invoke_set_state` schema to accept nested structures.

**Tech Stack:** TypeScript, Node fs (atomic write via temp+rename), child_process (git worktree list), vitest

---

### Task 1: Update PipelineState and TaskState types

**Files:**
- Modify: `src/types.ts:106-139`

- [ ] **Step 1: Add `last_updated` to PipelineState and expand TaskState**

In `src/types.ts`, change:

```ts
export interface PipelineState {
  pipeline_id: string
  started: string
  current_stage: 'scope' | 'plan' | 'orchestrate' | 'build' | 'review' | 'complete'
  work_branch?: string
  spec?: string
  plan?: string
  strategy?: string
  batches: BatchState[]
  review_cycles: ReviewCycle[]
}
```

To:

```ts
export interface PipelineState {
  pipeline_id: string
  started: string
  last_updated: string
  current_stage: 'scope' | 'plan' | 'orchestrate' | 'build' | 'review' | 'complete'
  work_branch?: string
  spec?: string
  plan?: string
  strategy?: string
  batches: BatchState[]
  review_cycles: ReviewCycle[]
}
```

And change:

```ts
export interface TaskState {
  id: string
  status: 'pending' | 'dispatched' | 'running' | 'completed' | 'error' | 'timeout'
  worktree?: string | null
  result?: AgentResult
}
```

To:

```ts
export interface TaskState {
  id: string
  status: 'pending' | 'dispatched' | 'running' | 'completed' | 'error' | 'timeout'
  worktree_path?: string
  worktree_branch?: string
  result_summary?: string
  result_status?: 'success' | 'error' | 'timeout'
}
```

Note: We store only `result_summary` and `result_status` in state — not the full `AgentResult` with raw output. Full results go to artifacts.

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: Build errors in files that reference the old `TaskState.worktree` or `TaskState.result` fields. These will be fixed in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(state): add last_updated to PipelineState, restructure TaskState"
```

---

### Task 2: Atomic writes and new StateManager methods

**Files:**
- Modify: `src/tools/state.ts`
- Modify: `tests/tools/state.test.ts`

- [ ] **Step 1: Write failing tests for new methods**

Add to `tests/tools/state.test.ts`:

```ts
  it('sets last_updated on every update', async () => {
    await stateManager.initialize('pipeline-123')
    const before = (await stateManager.get())!.last_updated

    // Small delay to ensure timestamp differs
    await new Promise(r => setTimeout(r, 10))
    await stateManager.update({ current_stage: 'plan' })
    const after = (await stateManager.get())!.last_updated

    expect(after).not.toBe(before)
  })

  it('sets last_updated on initialize', async () => {
    const state = await stateManager.initialize('pipeline-123')
    expect(state.last_updated).toBeTruthy()
    expect(new Date(state.last_updated).getTime()).toBeGreaterThan(0)
  })

  it('adds a batch via addBatch', async () => {
    await stateManager.initialize('pipeline-123')
    await stateManager.addBatch({
      id: 1,
      status: 'pending',
      tasks: [
        { id: 'task-1', status: 'pending' },
        { id: 'task-2', status: 'pending' },
      ],
    })

    const state = await stateManager.get()
    expect(state!.batches).toHaveLength(1)
    expect(state!.batches[0].tasks).toHaveLength(2)
  })

  it('updates a batch via updateBatch', async () => {
    await stateManager.initialize('pipeline-123')
    await stateManager.addBatch({
      id: 1,
      status: 'pending',
      tasks: [{ id: 'task-1', status: 'pending' }],
    })
    await stateManager.updateBatch(0, { status: 'in_progress' })

    const state = await stateManager.get()
    expect(state!.batches[0].status).toBe('in_progress')
  })

  it('updates a specific task via updateTask', async () => {
    await stateManager.initialize('pipeline-123')
    await stateManager.addBatch({
      id: 1,
      status: 'in_progress',
      tasks: [
        { id: 'task-1', status: 'pending' },
        { id: 'task-2', status: 'pending' },
      ],
    })
    await stateManager.updateTask(0, 'task-2', {
      status: 'running',
      worktree_path: '/tmp/invoke-worktree-task-2',
      worktree_branch: 'invoke-wt-task-2',
    })

    const state = await stateManager.get()
    expect(state!.batches[0].tasks[0].status).toBe('pending')
    expect(state!.batches[0].tasks[1].status).toBe('running')
    expect(state!.batches[0].tasks[1].worktree_path).toBe('/tmp/invoke-worktree-task-2')
  })

  it('throws when updating task in nonexistent batch', async () => {
    await stateManager.initialize('pipeline-123')
    await expect(
      stateManager.updateTask(5, 'task-1', { status: 'running' })
    ).rejects.toThrow()
  })

  it('throws when updating nonexistent task', async () => {
    await stateManager.initialize('pipeline-123')
    await stateManager.addBatch({
      id: 1,
      status: 'in_progress',
      tasks: [{ id: 'task-1', status: 'pending' }],
    })
    await expect(
      stateManager.updateTask(0, 'nonexistent', { status: 'running' })
    ).rejects.toThrow()
  })

  it('writes atomically (temp file then rename)', async () => {
    await stateManager.initialize('pipeline-123')

    // Verify the file exists and is valid JSON after write
    const raw = await readFile(
      path.join(TEST_DIR, '.invoke', 'state.json'),
      'utf-8'
    )
    const parsed = JSON.parse(raw)
    expect(parsed.pipeline_id).toBe('pipeline-123')
    // No .tmp files should be left behind
    const { readdirSync } = await import('fs')
    const files = readdirSync(path.join(TEST_DIR, '.invoke'))
    const tmpFiles = files.filter((f: string) => f.endsWith('.tmp'))
    expect(tmpFiles).toHaveLength(0)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tools/state.test.ts`
Expected: FAIL — new methods don't exist, `last_updated` not set

- [ ] **Step 3: Implement enhanced StateManager**

Replace `src/tools/state.ts` with:

```ts
import { readFile, writeFile, rename } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import type { PipelineState, BatchState, TaskState } from '../types.js'

export class StateManager {
  private statePath: string
  private tmpPath: string

  constructor(private projectDir: string) {
    this.statePath = path.join(projectDir, '.invoke', 'state.json')
    this.tmpPath = path.join(projectDir, '.invoke', 'state.json.tmp')
  }

  async get(): Promise<PipelineState | null> {
    if (!existsSync(this.statePath)) {
      return null
    }
    const content = await readFile(this.statePath, 'utf-8')
    return JSON.parse(content) as PipelineState
  }

  async initialize(pipelineId: string): Promise<PipelineState> {
    const now = new Date().toISOString()
    const state: PipelineState = {
      pipeline_id: pipelineId,
      started: now,
      last_updated: now,
      current_stage: 'scope',
      batches: [],
      review_cycles: [],
    }
    await this.writeAtomic(state)
    return state
  }

  async update(updates: Partial<PipelineState>): Promise<PipelineState> {
    const current = await this.get()
    if (!current) {
      throw new Error('No active pipeline. Call initialize() first.')
    }
    const updated = { ...current, ...updates, last_updated: new Date().toISOString() }
    await this.writeAtomic(updated)
    return updated
  }

  async addBatch(batch: BatchState): Promise<PipelineState> {
    const current = await this.get()
    if (!current) {
      throw new Error('No active pipeline. Call initialize() first.')
    }
    current.batches.push(batch)
    current.last_updated = new Date().toISOString()
    await this.writeAtomic(current)
    return current
  }

  async updateBatch(batchIndex: number, updates: Partial<BatchState>): Promise<PipelineState> {
    const current = await this.get()
    if (!current) {
      throw new Error('No active pipeline. Call initialize() first.')
    }
    if (batchIndex >= current.batches.length) {
      throw new Error(`Batch index ${batchIndex} out of range (${current.batches.length} batches)`)
    }
    current.batches[batchIndex] = { ...current.batches[batchIndex], ...updates }
    current.last_updated = new Date().toISOString()
    await this.writeAtomic(current)
    return current
  }

  async updateTask(
    batchIndex: number,
    taskId: string,
    updates: Partial<TaskState>
  ): Promise<PipelineState> {
    const current = await this.get()
    if (!current) {
      throw new Error('No active pipeline. Call initialize() first.')
    }
    if (batchIndex >= current.batches.length) {
      throw new Error(`Batch index ${batchIndex} out of range (${current.batches.length} batches)`)
    }
    const task = current.batches[batchIndex].tasks.find(t => t.id === taskId)
    if (!task) {
      throw new Error(`Task '${taskId}' not found in batch ${batchIndex}`)
    }
    Object.assign(task, updates)
    current.last_updated = new Date().toISOString()
    await this.writeAtomic(current)
    return current
  }

  async reset(): Promise<void> {
    if (existsSync(this.statePath)) {
      const { unlink } = await import('fs/promises')
      await unlink(this.statePath)
    }
  }

  private async writeAtomic(state: PipelineState): Promise<void> {
    const content = JSON.stringify(state, null, 2) + '\n'
    await writeFile(this.tmpPath, content)
    await rename(this.tmpPath, this.statePath)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tools/state.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/tools/state.ts tests/tools/state.test.ts
git commit -m "feat(state): atomic writes, last_updated, addBatch, updateBatch, updateTask"
```

---

### Task 3: Wire BatchManager to persist state

**Files:**
- Modify: `src/dispatch/batch-manager.ts`
- Modify: `tests/dispatch/batch-manager.test.ts`

- [ ] **Step 1: Write failing test for state persistence**

Add to `tests/dispatch/batch-manager.test.ts`:

```ts
import { StateManager } from '../../src/tools/state.js'
import { mkdir, rm } from 'fs/promises'
import path from 'path'
import os from 'os'

const STATE_TEST_DIR = path.join(os.tmpdir(), 'invoke-batch-state-test')

describe('BatchManager with state persistence', () => {
  let stateManager: StateManager
  let statefulManager: BatchManager

  beforeEach(async () => {
    vi.clearAllMocks()
    await mkdir(path.join(STATE_TEST_DIR, '.invoke'), { recursive: true })
    stateManager = new StateManager(STATE_TEST_DIR)
    await stateManager.initialize('test-pipeline')
    await stateManager.addBatch({
      id: 1,
      status: 'pending',
      tasks: [
        { id: 'task-1', status: 'pending' },
      ],
    })
    statefulManager = new BatchManager(mockEngine, mockWorktreeManager, stateManager, 0)
  })

  afterEach(async () => {
    await rm(STATE_TEST_DIR, { recursive: true, force: true })
  })

  it('persists task status transitions to state.json', async () => {
    vi.mocked(mockEngine.dispatch).mockResolvedValue(mockResult)

    statefulManager.dispatchBatch({
      tasks: [
        { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: false,
    })

    // Wait for completion
    await vi.waitFor(async () => {
      const state = await stateManager.get()
      const task = state!.batches[0].tasks.find(t => t.id === 'task-1')
      expect(task!.status).toBe('completed')
    }, { timeout: 3000 })

    const state = await stateManager.get()
    expect(state!.batches[0].tasks[0].result_summary).toBeTruthy()
    expect(state!.batches[0].tasks[0].result_status).toBe('success')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dispatch/batch-manager.test.ts`
Expected: FAIL — BatchManager doesn't accept StateManager yet

- [ ] **Step 3: Update BatchManager to accept and use StateManager**

Replace `src/dispatch/batch-manager.ts` with:

```ts
import { randomUUID } from 'crypto'
import type { DispatchEngine } from './engine.js'
import type { WorktreeManager } from '../worktree/manager.js'
import type { StateManager } from '../tools/state.js'
import type { BatchRequest, BatchStatus, AgentStatus, AgentResult } from '../types.js'

interface BatchRecord {
  status: BatchStatus
  abortController: AbortController
  batchIndex: number
}

export class BatchManager {
  private batches = new Map<string, BatchRecord>()

  constructor(
    private engine: DispatchEngine,
    private worktreeManager: WorktreeManager,
    private stateManager?: StateManager,
    private batchIndex: number = 0
  ) {}

  dispatchBatch(request: BatchRequest): string {
    const batchId = randomUUID().slice(0, 8)
    const agents: AgentStatus[] = request.tasks.map(task => ({
      taskId: task.taskId,
      status: 'pending' as const,
    }))

    const abortController = new AbortController()
    const currentIndex = this.batchIndex++
    const record: BatchRecord = {
      status: { batchId, status: 'running', agents },
      abortController,
      batchIndex: currentIndex,
    }

    this.batches.set(batchId, record)

    // Fire and forget — dispatch all tasks in parallel
    this.runBatch(batchId, request, abortController.signal, currentIndex)

    return batchId
  }

  getStatus(batchId: string): BatchStatus | null {
    const record = this.batches.get(batchId)
    return record ? record.status : null
  }

  async waitForStatus(batchId: string, waitSeconds: number): Promise<BatchStatus | null> {
    const record = this.batches.get(batchId)
    if (!record) return null

    if (record.status.status !== 'running') return record.status

    const snapshot = record.status.agents.map(a => a.status).join(',')

    const deadline = Date.now() + waitSeconds * 1000
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1000))

      if (record.status.status !== 'running') return record.status

      const current = record.status.agents.map(a => a.status).join(',')
      if (current !== snapshot) return record.status
    }

    return record.status
  }

  cancel(batchId: string): void {
    const record = this.batches.get(batchId)
    if (!record) return

    record.abortController.abort()
    record.status.status = 'cancelled'
    for (const agent of record.status.agents) {
      if (agent.status === 'pending' || agent.status === 'dispatched' || agent.status === 'running') {
        agent.status = 'error'
      }
    }
  }

  private async persistTaskStatus(
    batchIndex: number,
    taskId: string,
    status: string,
    result?: AgentResult
  ): Promise<void> {
    if (!this.stateManager) return
    try {
      await this.stateManager.updateTask(batchIndex, taskId, {
        status: status as any,
        result_summary: result?.output.summary,
        result_status: result?.status,
      })
    } catch {
      // Non-critical — don't fail the dispatch if state persistence fails
    }
  }

  private async runBatch(
    batchId: string,
    request: BatchRequest,
    signal: AbortSignal,
    batchIndex: number
  ): Promise<void> {
    const record = this.batches.get(batchId)!

    const promises = request.tasks.map(async (task, index) => {
      if (signal.aborted) return

      const agentStatus = record.status.agents[index]

      try {
        let workDir: string | undefined

        if (request.createWorktrees) {
          agentStatus.status = 'dispatched'
          await this.persistTaskStatus(batchIndex, task.taskId, 'dispatched')
          const wt = await this.worktreeManager.create(task.taskId)
          workDir = wt.worktreePath

          // Persist worktree info
          if (this.stateManager) {
            try {
              await this.stateManager.updateTask(batchIndex, task.taskId, {
                status: 'dispatched',
                worktree_path: wt.worktreePath,
                worktree_branch: wt.branch,
              })
            } catch {}
          }
        }

        agentStatus.status = 'running'
        await this.persistTaskStatus(batchIndex, task.taskId, 'running')

        if (signal.aborted) return

        const result = await this.engine.dispatch({
          role: task.role,
          subrole: task.subrole,
          taskContext: task.taskContext,
          workDir,
        })

        agentStatus.status = 'completed'
        agentStatus.result = result
        await this.persistTaskStatus(batchIndex, task.taskId, 'completed', result)
      } catch (err) {
        agentStatus.status = 'error'
        const errorResult: AgentResult = {
          role: task.role,
          subrole: task.subrole,
          provider: 'unknown',
          model: 'unknown',
          status: 'error',
          output: {
            summary: err instanceof Error ? err.message : 'Unknown error',
            raw: String(err),
          },
          duration: 0,
        }
        agentStatus.result = errorResult
        await this.persistTaskStatus(batchIndex, task.taskId, 'error', errorResult)
      }
    })

    await Promise.allSettled(promises)

    if (!signal.aborted) {
      const allDone = record.status.agents.every(
        a => a.status === 'completed' || a.status === 'error' || a.status === 'timeout'
      )
      const anyError = record.status.agents.some(a => a.status === 'error' || a.status === 'timeout')

      record.status.status = allDone
        ? (anyError ? 'error' : 'completed')
        : 'running'

      // Persist batch-level status
      if (this.stateManager) {
        try {
          await this.stateManager.updateBatch(batchIndex, {
            status: allDone ? (anyError ? 'error' : 'completed') : 'in_progress',
          })
        } catch {}
      }
    }
  }
}
```

- [ ] **Step 4: Update existing BatchManager tests**

The existing tests create `BatchManager` with 2 args. Update to pass `undefined` for stateManager:

In `tests/dispatch/batch-manager.test.ts`, change:

```ts
    manager = new BatchManager(mockEngine, mockWorktreeManager)
```

To:

```ts
    manager = new BatchManager(mockEngine, mockWorktreeManager, undefined)
```

- [ ] **Step 5: Update index.ts to pass stateManager to BatchManager**

In `src/index.ts`, change line 76:

```ts
    const batchManager = new BatchManager(engine, worktreeManager)
```

To:

```ts
    const batchManager = new BatchManager(engine, worktreeManager, stateManager)
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/dispatch/batch-manager.test.ts`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add src/dispatch/batch-manager.ts tests/dispatch/batch-manager.test.ts src/index.ts
git commit -m "feat(state): wire BatchManager to persist task status transitions"
```

---

### Task 4: Worktree orphan discovery

**Files:**
- Modify: `src/worktree/manager.ts`
- Modify: `tests/worktree/manager.test.ts`

- [ ] **Step 1: Write failing test for discoverOrphaned**

Add to `tests/worktree/manager.test.ts`:

```ts
describe('discoverOrphaned', () => {
  it('returns empty array when no invoke worktrees exist', async () => {
    const manager = new WorktreeManager(TEST_REPO_DIR)
    const orphaned = await manager.discoverOrphaned()
    expect(orphaned).toEqual([])
  })
})
```

Note: Testing actual orphan discovery requires creating real git worktrees. The test structure depends on the existing test setup in `tests/worktree/manager.test.ts`. Read the existing test file first to understand the fixtures, then add the test following the same pattern.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/worktree/manager.test.ts`
Expected: FAIL — `discoverOrphaned` doesn't exist

- [ ] **Step 3: Add discoverOrphaned method**

In `src/worktree/manager.ts`, add after the `listActive()` method:

```ts
  async discoverOrphaned(): Promise<WorktreeInfo[]> {
    try {
      const output = execSync('git worktree list --porcelain', {
        cwd: this.repoDir,
        stdio: 'pipe',
      }).toString()

      const orphaned: WorktreeInfo[] = []
      const blocks = output.split('\n\n').filter(Boolean)

      for (const block of blocks) {
        const lines = block.split('\n')
        const worktreeLine = lines.find(l => l.startsWith('worktree '))
        const branchLine = lines.find(l => l.startsWith('branch '))

        if (!worktreeLine || !branchLine) continue

        const worktreePath = worktreeLine.replace('worktree ', '')
        const fullBranch = branchLine.replace('branch ', '')
        const branch = fullBranch.replace('refs/heads/', '')

        // Only match invoke-created worktrees
        if (!branch.startsWith('invoke-wt-')) continue

        // Extract taskId from branch name
        const taskId = branch.replace('invoke-wt-', '')

        // Skip if already tracked in-memory
        if (this.worktrees.has(taskId)) continue

        orphaned.push({ taskId, worktreePath, branch })
      }

      return orphaned
    } catch {
      return []
    }
  }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/worktree/manager.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/worktree/manager.ts tests/worktree/manager.test.ts
git commit -m "feat(state): add worktree orphan discovery via git worktree list"
```

---

### Task 5: Update invoke_set_state schema for nested state

**Files:**
- Modify: `src/tools/state-tools.ts`

- [ ] **Step 1: Update the Zod schema**

In `src/tools/state-tools.ts`, replace the `invoke_set_state` tool registration with:

```ts
  server.registerTool(
    'invoke_set_state',
    {
      description: 'Update pipeline state fields. Pass only the fields to update. Supports nested batches and review_cycles.',
      inputSchema: z.object({
        pipeline_id: z.string().optional(),
        current_stage: z.enum(['scope', 'plan', 'orchestrate', 'build', 'review', 'complete']).optional(),
        work_branch: z.string().optional(),
        spec: z.string().optional(),
        plan: z.string().optional(),
        strategy: z.string().optional(),
        batches: z.array(z.object({
          id: z.number(),
          status: z.enum(['pending', 'in_progress', 'completed', 'error']),
          tasks: z.array(z.object({
            id: z.string(),
            status: z.enum(['pending', 'dispatched', 'running', 'completed', 'error', 'timeout']),
            worktree_path: z.string().optional(),
            worktree_branch: z.string().optional(),
            result_summary: z.string().optional(),
            result_status: z.enum(['success', 'error', 'timeout']).optional(),
          })),
        })).optional(),
        review_cycles: z.array(z.object({
          id: z.number(),
          reviewers: z.array(z.string()),
          findings: z.array(z.any()),
          triaged: z.object({
            accepted: z.array(z.any()),
            dismissed: z.array(z.any()),
          }).optional(),
        })).optional(),
      }),
    },
    async (updates) => {
      try {
        let state = await stateManager.get()
        if (!state) {
          state = await stateManager.initialize(updates.pipeline_id ?? `pipeline-${Date.now()}`)
        }
        const updated = await stateManager.update(updates)
        return {
          content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `State error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    }
  )
```

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 3: Commit**

```bash
git add src/tools/state-tools.ts
git commit -m "feat(state): expand invoke_set_state schema for batches and review_cycles"
```

---

### Task 6: Update invoke-resume skill for task-level recovery

**Files:**
- Modify: `skills/invoke-resume/SKILL.md`

- [ ] **Step 1: Update the resume skill**

Replace the content of `skills/invoke-resume/SKILL.md` with:

```markdown
---
name: invoke-resume
description: "MUST USE when the user returns to a project with an active invoke pipeline, or when session-start hook detects active state. Triggers on: 'continue', 'resume', 'where was I', 'pick up where I left off', active pipeline detected."
---

# Invoke — Resume Pipeline

You are resuming an in-progress invoke pipeline from a previous session.

## Messaging

Load the `invoke-messaging` skill and follow its standards for all user-facing output — agent dispatches, progress updates, results, errors, and selection prompts. Use `AskUserQuestion` for all user decisions.

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
```

- [ ] **Step 2: Commit**

```bash
git add skills/invoke-resume/SKILL.md
git commit -m "feat(state): update resume skill for task-level recovery and staleness display"
```

---

### Task 7: Run full test suite and fix build errors

**Files:** Various (fixing compilation errors from TaskState changes)

- [ ] **Step 1: Build the project**

Run: `npm run build`

If there are errors from the `TaskState` changes (removing `worktree?: string | null` and `result?: AgentResult`), fix them:

- In `src/dispatch/batch-manager.ts`: the `agentStatus.result = result` lines should no longer set full AgentResult on TaskState. The in-memory `AgentStatus` type still has `result?: AgentResult` (that's in `BatchStatus`, not `TaskState`). Verify the types are separate.
- Any test that references `TaskState.result` or `TaskState.worktree` needs updating to use `result_summary`/`result_status` and `worktree_path`/`worktree_branch`.

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Commit if fixes were needed**

```bash
git add -A
git commit -m "fix: resolve build errors and test updates from TaskState restructure"
```

---

### Task 8: Integration verification

**Files:** None (manual verification)

- [ ] **Step 1: Verify state.json is written correctly**

Run a quick smoke test by manually calling the state tools:

```bash
cd /tmp && mkdir -p test-project/.invoke
echo '{}' > test-project/.invoke/pipeline.yaml
```

Then verify the MCP server starts and state tools work. This is a manual check — the implementer should verify that `state.json` is created with `last_updated`, batches persist, and the file uses atomic writes.

- [ ] **Step 2: Final build and test**

Run: `npm run build && npx vitest run`
Expected: Clean build, all tests pass

- [ ] **Step 3: Commit if any final cleanup needed**

```bash
git add -A
git commit -m "fix: final cleanup from state recovery implementation"
```
