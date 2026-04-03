import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BatchManager } from '../../src/dispatch/batch-manager.js'
import { StateManager } from '../../src/tools/state.js'
import type { DispatchEngine } from '../../src/dispatch/engine.js'
import type { WorktreeManager } from '../../src/worktree/manager.js'
import type { AgentResult } from '../../src/types.js'
import { mkdir, rm } from 'fs/promises'
import path from 'path'
import os from 'os'

const STATE_TEST_DIR = path.join(os.tmpdir(), 'invoke-batch-state-test')

const mockResult: AgentResult = {
  role: 'builder',
  subrole: 'default',
  provider: 'claude',
  model: 'opus-4.6',
  status: 'success',
  output: { summary: 'Built the thing', raw: 'Full output' },
  duration: 5000,
}

const mockEngine = {
  dispatch: vi.fn().mockResolvedValue(mockResult),
} as unknown as DispatchEngine

const mockWorktreeManager = {
  create: vi.fn().mockResolvedValue({
    taskId: 'task-1',
    worktreePath: '/tmp/wt-task-1',
    branch: 'invoke-wt-task-1',
  }),
  cleanup: vi.fn(),
} as unknown as WorktreeManager

describe('BatchManager', () => {
  let manager: BatchManager

  beforeEach(() => {
    vi.clearAllMocks()
    manager = new BatchManager(mockEngine, mockWorktreeManager, undefined)
  })

  it('dispatches a batch and returns a batch ID immediately', async () => {
    const batchId = manager.dispatchBatch({
      tasks: [
        { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: { task_description: 'Build X' } },
        { taskId: 'task-2', role: 'builder', subrole: 'default', taskContext: { task_description: 'Build Y' } },
      ],
      createWorktrees: true,
    })

    expect(batchId).toBeTruthy()
    expect(typeof batchId).toBe('string')
  })

  it('tracks batch status from running to completed', async () => {
    const batchId = manager.dispatchBatch({
      tasks: [
        { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: false,
    })

    // Initially running
    let status = manager.getStatus(batchId)
    expect(status).not.toBeNull()
    expect(['running', 'completed']).toContain(status!.status)

    // Wait for completion
    await vi.waitFor(() => {
      const s = manager.getStatus(batchId)
      expect(s!.status).toBe('completed')
    }, { timeout: 2000 })

    const finalStatus = manager.getStatus(batchId)
    expect(finalStatus!.status).toBe('completed')
    expect(finalStatus!.agents[0].status).toBe('completed')
    expect(finalStatus!.agents[0].result).toEqual(mockResult)
  })

  it('creates worktrees when requested', async () => {
    manager.dispatchBatch({
      tasks: [
        { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: true,
    })

    await vi.waitFor(() => {
      expect(mockWorktreeManager.create).toHaveBeenCalledWith('task-1')
    }, { timeout: 2000 })
  })

  it('cancels a running batch', async () => {
    // Make dispatch hang
    const neverResolve = new Promise<AgentResult>(() => {})
    vi.mocked(mockEngine.dispatch).mockReturnValue(neverResolve)

    const batchId = manager.dispatchBatch({
      tasks: [
        { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: false,
    })

    manager.cancel(batchId)

    const status = manager.getStatus(batchId)
    expect(status!.status).toBe('cancelled')
  })

  it('returns null for unknown batch ID', () => {
    expect(manager.getStatus('nonexistent')).toBeNull()
  })

  describe('waitForStatus', () => {
    it('returns immediately when batch is already completed', async () => {
      vi.mocked(mockEngine.dispatch).mockResolvedValue(mockResult)

      const batchId = manager.dispatchBatch({
        tasks: [
          { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
        ],
        createWorktrees: false,
      })

      // Wait for the batch to finish first
      await vi.waitFor(() => {
        expect(manager.getStatus(batchId)!.status).toBe('completed')
      }, { timeout: 2000 })

      const start = Date.now()
      const status = await manager.waitForStatus(batchId, 30)
      const elapsed = Date.now() - start

      expect(status!.status).toBe('completed')
      expect(elapsed).toBeLessThan(1000)
    })

    it('returns null for unknown batch ID', async () => {
      const status = await manager.waitForStatus('nonexistent', 1)
      expect(status).toBeNull()
    })

    it('returns when an agent status changes', async () => {
      // First task resolves quickly, second hangs
      const neverResolve = new Promise<AgentResult>(() => {})
      vi.mocked(mockEngine.dispatch)
        .mockResolvedValueOnce(mockResult)
        .mockReturnValueOnce(neverResolve)

      const batchId = manager.dispatchBatch({
        tasks: [
          { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
          { taskId: 'task-2', role: 'builder', subrole: 'default', taskContext: {} },
        ],
        createWorktrees: false,
      })

      const status = await manager.waitForStatus(batchId, 10)

      // Should return once task-1 completes (status change detected)
      expect(status!.status).toBe('running')
      expect(status!.agents[0].status).toBe('completed')
    })

    it('returns after timeout when nothing changes', async () => {
      const neverResolve = new Promise<AgentResult>(() => {})
      vi.mocked(mockEngine.dispatch).mockReturnValue(neverResolve)

      const batchId = manager.dispatchBatch({
        tasks: [
          { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
        ],
        createWorktrees: false,
      })

      // Wait for agent to be running before we start the wait
      await vi.waitFor(() => {
        expect(manager.getStatus(batchId)!.agents[0].status).toBe('running')
      }, { timeout: 2000 })

      const start = Date.now()
      const status = await manager.waitForStatus(batchId, 2)
      const elapsed = Date.now() - start

      expect(status!.status).toBe('running')
      expect(elapsed).toBeGreaterThanOrEqual(1900)
      expect(elapsed).toBeLessThan(4000)
    })
  })
})

describe('BatchManager with state persistence', () => {
  let stateManager: StateManager
  let statefulManager: BatchManager

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(mockEngine.dispatch).mockResolvedValue(mockResult)
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
    statefulManager.dispatchBatch({
      tasks: [
        { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: false,
    })

    await vi.waitFor(async () => {
      const state = await stateManager.get()
      const task = state!.batches[0].tasks.find(t => t.id === 'task-1')
      expect(task!.status).toBe('completed')
    }, { timeout: 3000 })

    const state = await stateManager.get()
    expect(state!.batches[0].tasks[0].result_summary).toBeTruthy()
    expect(state!.batches[0].tasks[0].result_status).toBe('success')
  })

  it('persists batch completion status', async () => {
    statefulManager.dispatchBatch({
      tasks: [
        { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: false,
    })

    await vi.waitFor(async () => {
      const state = await stateManager.get()
      expect(state!.batches[0].status).toBe('completed')
    }, { timeout: 3000 })
  })
})
