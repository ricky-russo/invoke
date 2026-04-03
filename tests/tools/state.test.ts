import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { StateManager } from '../../src/tools/state.js'
import { mkdir, rm, readFile } from 'fs/promises'
import path from 'path'

const TEST_DIR = path.join(import.meta.dirname, 'fixtures', 'state-test')

let stateManager: StateManager

beforeEach(async () => {
  await mkdir(path.join(TEST_DIR, '.invoke'), { recursive: true })
  stateManager = new StateManager(TEST_DIR)
})

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('StateManager', () => {
  it('returns null when no state file exists', async () => {
    const state = await stateManager.get()
    expect(state).toBeNull()
  })

  it('creates initial state', async () => {
    await stateManager.initialize('pipeline-123')

    const state = await stateManager.get()
    expect(state).not.toBeNull()
    expect(state!.pipeline_id).toBe('pipeline-123')
    expect(state!.current_stage).toBe('scope')
    expect(state!.batches).toEqual([])
    expect(state!.review_cycles).toEqual([])
  })

  it('updates specific fields', async () => {
    await stateManager.initialize('pipeline-123')
    await stateManager.update({
      current_stage: 'build',
      work_branch: 'invoke/work-1234',
      strategy: 'tdd',
    })

    const state = await stateManager.get()
    expect(state!.current_stage).toBe('build')
    expect(state!.work_branch).toBe('invoke/work-1234')
    expect(state!.strategy).toBe('tdd')
    expect(state!.pipeline_id).toBe('pipeline-123')
  })

  it('writes state as formatted JSON', async () => {
    await stateManager.initialize('pipeline-123')

    const raw = await readFile(
      path.join(TEST_DIR, '.invoke', 'state.json'),
      'utf-8'
    )
    const parsed = JSON.parse(raw)
    expect(parsed.pipeline_id).toBe('pipeline-123')
    expect(raw).toContain('\n') // formatted, not minified
  })

  it('resets state', async () => {
    await stateManager.initialize('pipeline-123')
    await stateManager.update({ current_stage: 'build' })
    await stateManager.reset()

    const state = await stateManager.get()
    expect(state).toBeNull()
  })

  it('sets last_updated on initialize', async () => {
    const state = await stateManager.initialize('pipeline-123')
    expect(state.last_updated).toBeTruthy()
    expect(new Date(state.last_updated).getTime()).toBeGreaterThan(0)
  })

  it('sets last_updated on every update', async () => {
    await stateManager.initialize('pipeline-123')
    const before = (await stateManager.get())!.last_updated
    await new Promise(r => setTimeout(r, 10))
    await stateManager.update({ current_stage: 'plan' })
    const after = (await stateManager.get())!.last_updated
    expect(after).not.toBe(before)
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

  it('writes atomically (no leftover tmp files)', async () => {
    await stateManager.initialize('pipeline-123')
    const { readdirSync } = await import('fs')
    const files = readdirSync(path.join(TEST_DIR, '.invoke'))
    const tmpFiles = files.filter((f: string) => f.endsWith('.tmp'))
    expect(tmpFiles).toHaveLength(0)
  })
})
