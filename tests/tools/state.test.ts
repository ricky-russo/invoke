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
})
