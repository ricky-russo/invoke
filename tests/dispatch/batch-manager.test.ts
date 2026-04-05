import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BatchManager } from '../../src/dispatch/batch-manager.js'
import * as dagScheduler from '../../src/dispatch/dag-scheduler.js'
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

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

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
      expect(status!.status).toBe('partial')
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

  it('runs dependency layers sequentially and parallelizes tasks within each layer', async () => {
    const buildLayersSpy = vi.spyOn(dagScheduler, 'buildExecutionLayers')
    const started: string[] = []
    const deferreds = new Map([
      ['A', createDeferred<AgentResult>()],
      ['B', createDeferred<AgentResult>()],
      ['C', createDeferred<AgentResult>()],
      ['D', createDeferred<AgentResult>()],
    ])
    let currentConcurrent = 0
    let maxConcurrent = 0

    vi.mocked(mockEngine.dispatch).mockImplementation(async (request: any) => {
      const taskName = request.taskContext.task_description
      started.push(taskName)
      currentConcurrent++
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent)

      try {
        return await deferreds.get(taskName)!.promise
      } finally {
        currentConcurrent--
      }
    })

    const batchId = await manager.dispatchBatch({
      tasks: [
        { taskId: 'A', role: 'builder', subrole: 'default', taskContext: { task_description: 'A' } },
        { taskId: 'B', role: 'builder', subrole: 'default', taskContext: { task_description: 'B' }, depends_on: ['A'] },
        { taskId: 'C', role: 'builder', subrole: 'default', taskContext: { task_description: 'C' }, depends_on: ['A'] },
        { taskId: 'D', role: 'builder', subrole: 'default', taskContext: { task_description: 'D' }, depends_on: ['B', 'C'] },
      ],
      createWorktrees: false,
      maxParallel: 2,
    })

    await vi.waitFor(() => {
      expect(started).toEqual(['A'])
    }, { timeout: 2000 })

    expect(buildLayersSpy).toHaveBeenCalledTimes(1)

    deferreds.get('A')!.resolve(mockResult)

    await vi.waitFor(() => {
      expect(started).toEqual(['A', 'B', 'C'])
    }, { timeout: 2000 })

    deferreds.get('B')!.resolve(mockResult)
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(started).toEqual(['A', 'B', 'C'])

    deferreds.get('C')!.resolve(mockResult)

    await vi.waitFor(() => {
      expect(started).toEqual(['A', 'B', 'C', 'D'])
    }, { timeout: 2000 })

    deferreds.get('D')!.resolve(mockResult)

    await vi.waitFor(() => {
      expect(manager.getStatus(batchId)!.status).toBe('completed')
    }, { timeout: 5000 })

    expect(maxConcurrent).toBeLessThanOrEqual(2)
    expect(maxConcurrent).toBe(2)

    buildLayersSpy.mockRestore()
  })

  it('skips the DAG scheduler when no task declares dependencies', async () => {
    const buildLayersSpy = vi.spyOn(dagScheduler, 'buildExecutionLayers')

    const batchId = await manager.dispatchBatch({
      tasks: [
        { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
        { taskId: 'task-2', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: false,
      maxParallel: 2,
    })

    await vi.waitFor(() => {
      expect(manager.getStatus(batchId)!.status).toBe('completed')
    }, { timeout: 5000 })

    expect(buildLayersSpy).not.toHaveBeenCalled()

    buildLayersSpy.mockRestore()
  })

  it('detects dependencies declared in taskContext', async () => {
    const buildLayersSpy = vi.spyOn(dagScheduler, 'buildExecutionLayers')

    const batchId = await manager.dispatchBatch({
      tasks: [
        { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
        {
          taskId: 'task-2',
          role: 'builder',
          subrole: 'default',
          taskContext: { depends_on: 'task-1' },
        },
      ],
      createWorktrees: false,
    })

    await vi.waitFor(() => {
      expect(manager.getStatus(batchId)!.status).toBe('completed')
    }, { timeout: 5000 })

    expect(buildLayersSpy).toHaveBeenCalledTimes(1)

    buildLayersSpy.mockRestore()
  })

  it('marks the batch as partial when some tasks complete before the batch finishes', async () => {
    const deferreds = new Map([
      ['task-1', createDeferred<AgentResult>()],
      ['task-2', createDeferred<AgentResult>()],
    ])

    vi.mocked(mockEngine.dispatch).mockImplementation((request: any) => {
      return deferreds.get(request.taskContext.task_description)!.promise
    })

    const batchId = await manager.dispatchBatch({
      tasks: [
        { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: { task_description: 'task-1' } },
        { taskId: 'task-2', role: 'builder', subrole: 'default', taskContext: { task_description: 'task-2' } },
      ],
      createWorktrees: true,
    })

    deferreds.get('task-1')!.resolve(mockResult)

    await vi.waitFor(() => {
      const status = manager.getStatus(batchId)
      expect(status!.status).toBe('partial')
      expect(status!.agents[0].status).toBe('completed')
      expect(status!.agents[1].status).toBe('running')
    }, { timeout: 2000 })

    deferreds.get('task-2')!.resolve(mockResult)

    await vi.waitFor(() => {
      expect(manager.getStatus(batchId)!.status).toBe('completed')
    }, { timeout: 5000 })
  })

  it('does not schedule later DAG layers after cancellation', async () => {
    const deferred = createDeferred<AgentResult>()
    const started: string[] = []

    vi.mocked(mockEngine.dispatch).mockImplementation(async (request: any) => {
      started.push(request.taskContext.task_description)
      return deferred.promise
    })

    const batchId = await manager.dispatchBatch({
      tasks: [
        { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: { task_description: 'A' } },
        {
          taskId: 'task-2',
          role: 'builder',
          subrole: 'default',
          taskContext: { task_description: 'B' },
          depends_on: ['task-1'],
        },
      ],
      createWorktrees: false,
      maxParallel: 1,
    })

    await vi.waitFor(() => {
      expect(started).toEqual(['A'])
    }, { timeout: 2000 })

    manager.cancel(batchId)
    deferred.resolve(mockResult)

    await vi.waitFor(() => {
      expect(manager.getStatus(batchId)!.status).toBe('cancelled')
    }, { timeout: 2000 })

    await new Promise(resolve => setTimeout(resolve, 25))

    expect(started).toEqual(['A'])
    expect(vi.mocked(mockEngine.dispatch)).toHaveBeenCalledTimes(1)
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

  it('persists partial batch status while work remains', async () => {
    const firstTask = createDeferred<AgentResult>()
    const secondTask = createDeferred<AgentResult>()

    vi.mocked(mockEngine.dispatch).mockImplementation((request: any) => {
      return request.taskContext.task_description === 'task-2'
        ? firstTask.promise
        : secondTask.promise
    })

    await statefulManager.dispatchBatch({
      tasks: [
        { taskId: 'task-2', role: 'builder', subrole: 'default', taskContext: { task_description: 'task-2' } },
        { taskId: 'task-3', role: 'builder', subrole: 'default', taskContext: { task_description: 'task-3' } },
      ],
      createWorktrees: false,
    })

    firstTask.resolve(mockResult)

    await vi.waitFor(() => {
      expect(updateBatch).toHaveBeenCalledWith(2, { status: 'partial' })
    }, { timeout: 3000 })

    secondTask.resolve(mockResult)

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
