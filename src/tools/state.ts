import { mkdir, readFile, writeFile, rename } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import type { PipelineState, BatchState, ReviewCycle, TaskState } from '../types.js'
import { sanitizeReviewedSha } from './reviewed-sha.js'

export class StateManager {
  private static readonly PERSIST_ONCE_KEYS = [
    'work_branch',
    'work_branch_path',
    'base_branch',
    'spec',
    'plan',
    'tasks',
    'strategy',
    'bug_ids',
  ] as const satisfies ReadonlyArray<keyof PipelineState>

  private statePath: string
  private tmpPath: string
  private storageDir: string
  private dirEnsured = false
  private writeQueue: Promise<void> = Promise.resolve()
  private cachedState: PipelineState | null = null

  constructor(projectDir: string, sessionDir?: string) {
    this.storageDir = sessionDir ?? path.join(projectDir, '.invoke')
    this.statePath = path.join(this.storageDir, 'state.json')
    this.tmpPath = path.join(this.storageDir, 'state.json.tmp')
    this.cachedState = null
  }

  async get(): Promise<PipelineState | null> {
    if (this.cachedState !== null) {
      return this.cachedState
    }
    if (!existsSync(this.statePath)) {
      return null
    }
    const content = await readFile(this.statePath, 'utf-8')
    const parsed = JSON.parse(content) as PipelineState
    if (parsed?.review_cycles) {
      for (const rc of parsed.review_cycles) {
        if (rc.reviewed_sha !== undefined) {
          rc.reviewed_sha = sanitizeReviewedSha(rc.reviewed_sha)
        }
      }
    }
    this.cachedState = parsed
    return parsed
  }

  async initialize(pipelineId: string): Promise<PipelineState> {
    return this.enqueueWrite(async () => {
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
    })
  }

  async update(updates: Partial<PipelineState>): Promise<PipelineState> {
    return this.applyComposite({ partial: updates })
  }

  async addBatch(batch: BatchState): Promise<PipelineState> {
    return this.enqueueWrite(async () => {
      const current = await this.get()
      if (!current) {
        throw new Error('No active pipeline. Call initialize() first.')
      }
      current.batches.push(batch)
      current.last_updated = new Date().toISOString()
      await this.writeAtomic(current)
      return current
    })
  }

  /**
   * Apply a composite state update inside a single atomic write.
   *
   * Ordering (load-bearing):
   *   1. batchUpdate (upsert by id)
   *   2. reviewCycleUpdate (upsert by id)
   *   3. partial spread (top-level field replacement)
   *
   * The partial spread is applied last so callers can use
   * `partial.batches` or `partial.review_cycles` to fully replace the
   * upsert results. Invoke-resume redo paths rely on this contract,
   * including clearing batches with `partial.batches: []` (BUG-001).
   *
   * Trade-off: if a caller passes both `batch_update` and
   * `partial.batches`, the array replacement silently clobbers the
   * upserted result. This is intentional per the BUG-001 spec; the
   * cycle-1 mutex rejection was a regression that was reverted in
   * cycle 2 R1. See state-tools.ts for the soft warning that logs when
   * callers send both forms together.
   */
  async applyComposite(updates: {
    batchUpdate?: BatchState
    reviewCycleUpdate?: ReviewCycle
    partial?: Partial<PipelineState>
  }): Promise<PipelineState> {
    return this.enqueueWrite(async () => {
      const current = await this.get()
      if (!current) {
        throw new Error('No active pipeline. Call initialize() first.')
      }

      let next: PipelineState = { ...current }

      if (updates.batchUpdate) {
        this.applyBatchUpsert(next, updates.batchUpdate)
      }
      if (updates.reviewCycleUpdate) {
        this.applyReviewCycleUpsert(next, updates.reviewCycleUpdate)
      }
      if (updates.partial) {
        const safePartial = this.filterPersistOncePartial(updates.partial)
        next = { ...next, ...safePartial }
      }

      next.last_updated = new Date().toISOString()
      await this.writeAtomic(next)
      return next
    })
  }

  async updateBatch(batchIndex: number, updates: Partial<BatchState>): Promise<PipelineState> {
    return this.enqueueWrite(async () => {
      const current = await this.get()
      if (!current) {
        throw new Error('No active pipeline. Call initialize() first.')
      }
      if (batchIndex >= current.batches.length) {
        throw new Error(
          `Batch index ${batchIndex} out of range (${current.batches.length} batches)`
        )
      }
      current.batches[batchIndex] = { ...current.batches[batchIndex], ...updates }
      current.last_updated = new Date().toISOString()
      await this.writeAtomic(current)
      return current
    })
  }

  async updateTask(
    batchIndex: number,
    taskId: string,
    updates: Partial<TaskState>
  ): Promise<PipelineState> {
    return this.enqueueWrite(async () => {
      const current = await this.get()
      if (!current) {
        throw new Error('No active pipeline. Call initialize() first.')
      }
      if (batchIndex >= current.batches.length) {
        throw new Error(
          `Batch index ${batchIndex} out of range (${current.batches.length} batches)`
        )
      }
      const task = current.batches[batchIndex].tasks.find(t => t.id === taskId)
      if (!task) {
        throw new Error(`Task '${taskId}' not found in batch ${batchIndex}`)
      }
      Object.assign(task, updates)
      current.last_updated = new Date().toISOString()
      await this.writeAtomic(current)
      return current
    })
  }

  async getReviewCycleCount(batchId?: number): Promise<number> {
    const state = await this.get()
    if (!state) return 0
    if (batchId !== undefined) {
      return state.review_cycles.filter(rc => rc.batch_id === batchId).length
    }
    return state.review_cycles.length
  }

  async reset(): Promise<void> {
    await this.enqueueWrite(async () => {
      if (existsSync(this.statePath)) {
        const { unlink } = await import('fs/promises')
        await unlink(this.statePath)
      }
      this.cachedState = null
    })
  }

  private enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const queuedOperation = this.writeQueue.then(operation)
    this.writeQueue = queuedOperation.then(
      () => undefined,
      () => undefined
    )
    return queuedOperation
  }

  private async writeAtomic(state: PipelineState): Promise<void> {
    if (!this.dirEnsured) {
      await mkdir(this.storageDir, { recursive: true })
      this.dirEnsured = true
    }

    const content = JSON.stringify(state, null, 2) + '\n'
    await writeFile(this.tmpPath, content)
    await rename(this.tmpPath, this.statePath)
    this.cachedState = state
  }

  private filterPersistOncePartial(partial: Partial<PipelineState>): Partial<PipelineState> {
    const filtered = { ...partial }

    for (const key of StateManager.PERSIST_ONCE_KEYS) {
      if (filtered[key] === undefined || filtered[key] === null) {
        delete filtered[key]
      }
    }

    return filtered
  }

  private applyBatchUpsert(state: PipelineState, batch: BatchState): void {
    const batches = [...state.batches]
    const existingIndex = batches.findIndex(existingBatch => existingBatch.id === batch.id)

    if (existingIndex >= 0) {
      const existing = batches[existingIndex]
      const mergedTasks = this.mergeTasksById(existing.tasks, batch.tasks)
      batches[existingIndex] = { ...existing, ...batch, tasks: mergedTasks }
    } else {
      batches.push(batch)
    }

    state.batches = batches
  }

  /**
   * Merge incoming task entries into an existing tasks array by task id.
   *
   * Semantics (load-bearing for invoke-build's conflict redispatch loop):
   *   - Tasks present in `updates` are merged on top of the existing entry
   *     by id. Existing fields are preserved unless overridden by `updates`.
   *   - Tasks present only in `existing` are preserved unchanged.
   *   - Tasks present only in `updates` are appended.
   *
   * This lets callers send only the changed task entries in
   * `batch_update.tasks` without dropping sibling task state. The skill
   * relies on this so the conflict redispatch path can update a single
   * task without re-reading the full tasks array first.
   */
  private mergeTasksById(
    existing: TaskState[],
    updates: TaskState[]
  ): TaskState[] {
    if (!updates || updates.length === 0) {
      return [...existing]
    }
    const merged = [...existing]
    for (const update of updates) {
      const idx = merged.findIndex(task => task.id === update.id)
      if (idx >= 0) {
        merged[idx] = { ...merged[idx], ...update }
      } else {
        merged.push(update)
      }
    }
    return merged
  }

  private applyReviewCycleUpsert(state: PipelineState, cycle: ReviewCycle): void {
    const reviewCycles = [...state.review_cycles]
    const existingIndex = reviewCycles.findIndex(existingCycle => existingCycle.id === cycle.id)

    if (existingIndex >= 0) {
      reviewCycles[existingIndex] = {
        ...reviewCycles[existingIndex],
        ...cycle,
      }
    } else {
      reviewCycles.push(cycle)
    }

    state.review_cycles = reviewCycles
  }
}
