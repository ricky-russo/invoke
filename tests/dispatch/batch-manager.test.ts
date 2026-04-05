import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BatchManager } from '../../src/dispatch/batch-manager.js'
import type { DispatchEngine } from '../../src/dispatch/engine.js'
import type { WorktreeManager } from '../../src/worktree/manager.js'
import type { AgentResult, PipelineState } from '../../src/types.js'
import type { StateManager } from '../../src/tools/state.js'

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
    const batchId = await manager.dispatchBatch({
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
    const batchId = await manager.dispatchBatch({
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
    await manager.dispatchBatch({
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

    const batchId = await manager.dispatchBatch({
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

      const batchId = await manager.dispatchBatch({
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

      const batchId = await manager.dispatchBatch({
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

      const batchId = await manager.dispatchBatch({
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

describe('max_parallel_agents', () => {
  let manager: BatchManager

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(mockEngine.dispatch).mockImplementation(() =>
      new Promise(resolve => setTimeout(() => resolve(mockResult), 50))
    )
    manager = new BatchManager(mockEngine, mockWorktreeManager, undefined)
  })

  it('limits concurrent dispatches when maxParallel is set', async () => {
    let maxConcurrent = 0
    let currentConcurrent = 0

    vi.mocked(mockEngine.dispatch).mockImplementation(async () => {
      currentConcurrent++
      if (currentConcurrent > maxConcurrent) maxConcurrent = currentConcurrent
      await new Promise(r => setTimeout(r, 50))
      currentConcurrent--
      return mockResult
    })

    const batchId = await manager.dispatchBatch({
      tasks: [
        { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
        { taskId: 'task-2', role: 'builder', subrole: 'default', taskContext: {} },
        { taskId: 'task-3', role: 'builder', subrole: 'default', taskContext: {} },
        { taskId: 'task-4', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: false,
      maxParallel: 2,
    })

    await vi.waitFor(() => {
      const status = manager.getStatus(batchId)
      expect(status!.status).toBe('completed')
    }, { timeout: 5000 })

    expect(maxConcurrent).toBeLessThanOrEqual(2)
    expect(maxConcurrent).toBeGreaterThan(0)
  })

  it('runs all tasks in parallel when maxParallel is 0', async () => {
    let maxConcurrent = 0
    let currentConcurrent = 0

    vi.mocked(mockEngine.dispatch).mockImplementation(async () => {
      currentConcurrent++
      if (currentConcurrent > maxConcurrent) maxConcurrent = currentConcurrent
      await new Promise(r => setTimeout(r, 50))
      currentConcurrent--
      return mockResult
    })

    const batchId = await manager.dispatchBatch({
      tasks: [
        { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
        { taskId: 'task-2', role: 'builder', subrole: 'default', taskContext: {} },
        { taskId: 'task-3', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: false,
      maxParallel: 0,
    })

    await vi.waitFor(() => {
      const status = manager.getStatus(batchId)
      expect(status!.status).toBe('completed')
    }, { timeout: 5000 })

    expect(maxConcurrent).toBe(3) // all ran simultaneously
  })
})

describe('BatchManager with state persistence', () => {
  let stateManager: StateManager
  let statefulManager: BatchManager
  let persistedState: PipelineState
  let updateTask: ReturnType<typeof vi.fn>
  let updateBatch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(mockEngine.dispatch).mockResolvedValue(mockResult)
    persistedState = {
      pipeline_id: 'test-pipeline',
      started: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      current_stage: 'build',
      batches: [
        {
          id: 0,
          status: 'completed',
          tasks: [{ id: 'task-0', status: 'completed' }],
        },
        {
          id: 1,
          status: 'completed',
          tasks: [{ id: 'task-1', status: 'completed' }],
        },
      ],
      review_cycles: [],
    }
    updateTask = vi.fn().mockResolvedValue(persistedState)
    updateBatch = vi.fn().mockResolvedValue(persistedState)
    stateManager = {
      get: vi.fn().mockResolvedValue(persistedState),
      updateTask,
      updateBatch,
    } as unknown as StateManager
    statefulManager = new BatchManager(mockEngine, mockWorktreeManager, stateManager)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('persists task status transitions using the derived batch index', async () => {
    const batchId = await statefulManager.dispatchBatch({
      tasks: [
        { taskId: 'task-2', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: false,
    })

    await vi.waitFor(() => {
      expect(updateTask).toHaveBeenCalledTimes(2)
    }, { timeout: 3000 })

    expect((statefulManager as any).batches.get(batchId).batchIndex).toBe(2)
    expect(updateTask.mock.calls.map(([batchIndex]) => batchIndex)).toEqual([2, 2])
    expect(updateTask.mock.calls.map(([, taskId]) => taskId)).toEqual(['task-2', 'task-2'])
    expect(updateTask.mock.calls.map(([, , updates]) => updates.status)).toEqual(['running', 'completed'])
    expect(updateTask.mock.calls[1][2]).toEqual({
      status: 'completed',
      result_summary: mockResult.output.summary,
      result_status: mockResult.status,
    })
  })

  it('derives batch index from persisted state instead of an instance counter', async () => {
    const batchId = await statefulManager.dispatchBatch({
      tasks: [
        { taskId: 'task-2', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: false,
    })

    await vi.waitFor(() => {
      expect(updateBatch).toHaveBeenCalledWith(2, { status: 'completed' })
    }, { timeout: 3000 })

    expect((stateManager.get as any)).toHaveBeenCalledTimes(1)
    expect((statefulManager as any).batches.get(batchId).batchIndex).toBe(2)
    expect(updateTask.mock.calls.every(([batchIndex]) => batchIndex === 2)).toBe(true)
    expect(updateBatch.mock.calls.every(([batchIndex]) => batchIndex === 2)).toBe(true)
  })

  it('persists batch completion status', async () => {
    await statefulManager.dispatchBatch({
      tasks: [
        { taskId: 'task-2', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: false,
    })

    await vi.waitFor(() => {
      expect(updateBatch).toHaveBeenCalledWith(2, { status: 'completed' })
    }, { timeout: 3000 })
  })

  it('falls back to the in-memory batch count when state manager is unavailable', async () => {
    const statelessManager = new BatchManager(mockEngine, mockWorktreeManager)

    const firstBatchId = await statelessManager.dispatchBatch({
      tasks: [
        { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: false,
    })
    const secondBatchId = await statelessManager.dispatchBatch({
      tasks: [
        { taskId: 'task-2', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: false,
    })

    expect((statelessManager as any).batches.get(firstBatchId).batchIndex).toBe(0)
    expect((statelessManager as any).batches.get(secondBatchId).batchIndex).toBe(1)
  })
})
