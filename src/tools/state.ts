import { mkdir, readFile, writeFile, rename } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import type { PipelineState, BatchState, TaskState } from '../types.js'

export class StateManager {
  private statePath: string
  private tmpPath: string
  private storageDir: string
  private dirEnsured = false

  constructor(projectDir: string, sessionDir?: string) {
    this.storageDir = sessionDir ?? path.join(projectDir, '.invoke')
    this.statePath = path.join(this.storageDir, 'state.json')
    this.tmpPath = path.join(this.storageDir, 'state.json.tmp')
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

  async getReviewCycleCount(batchId?: number): Promise<number> {
    const state = await this.get()
    if (!state) return 0
    if (batchId !== undefined) {
      return state.review_cycles.filter(rc => rc.batch_id === batchId).length
    }
    return state.review_cycles.length
  }

  async reset(): Promise<void> {
    if (existsSync(this.statePath)) {
      const { unlink } = await import('fs/promises')
      await unlink(this.statePath)
    }
  }

  private async writeAtomic(state: PipelineState): Promise<void> {
    if (!this.dirEnsured) {
      await mkdir(this.storageDir, { recursive: true })
      this.dirEnsured = true
    }

    const content = JSON.stringify(state, null, 2) + '\n'
    await writeFile(this.tmpPath, content)
    await rename(this.tmpPath, this.statePath)
  }
}
