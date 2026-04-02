import { readFile, writeFile, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import type { PipelineState } from '../types.js'

export class StateManager {
  private statePath: string

  constructor(private projectDir: string) {
    this.statePath = path.join(projectDir, '.invoke', 'state.json')
  }

  async get(): Promise<PipelineState | null> {
    if (!existsSync(this.statePath)) {
      return null
    }
    const content = await readFile(this.statePath, 'utf-8')
    return JSON.parse(content) as PipelineState
  }

  async initialize(pipelineId: string): Promise<PipelineState> {
    const state: PipelineState = {
      pipeline_id: pipelineId,
      started: new Date().toISOString(),
      current_stage: 'scope',
      batches: [],
      review_cycles: [],
    }
    await this.write(state)
    return state
  }

  async update(updates: Partial<PipelineState>): Promise<PipelineState> {
    const current = await this.get()
    if (!current) {
      throw new Error('No active pipeline. Call initialize() first.')
    }
    const updated = { ...current, ...updates }
    await this.write(updated)
    return updated
  }

  async reset(): Promise<void> {
    if (existsSync(this.statePath)) {
      await unlink(this.statePath)
    }
  }

  private async write(state: PipelineState): Promise<void> {
    await writeFile(this.statePath, JSON.stringify(state, null, 2) + '\n')
  }
}
