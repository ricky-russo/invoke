import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BatchManager } from '../../src/dispatch/batch-manager.js'
import * as dagScheduler from '../../src/dispatch/dag-scheduler.js'
import * as sessionPath from '../../src/tools/session-path.js'
import type { DispatchEngine } from '../../src/dispatch/engine.js'
import type { WorktreeManager } from '../../src/worktree/manager.js'
import type { AgentResult, PipelineState } from '../../src/types.js'
import type { StateManager } from '../../src/tools/state.js'

vi.mock('../../src/tools/session-path.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/tools/session-path.js')>(
    '../../src/tools/session-path.js'
  )
  return {
    ...actual,
    resolvePersistedSessionWorkBranchPath: vi.fn(),
  }
})

const mockResult: AgentResult = {
  role: 'builder',
  subrole: 'default',
  provider: 'claude',
  model: 'opus-4.6',
  status: 'success',
  output: { summary: 'Built the thing', raw: 'Full output' },
  duration: 5000,
}

const mockErrorResult: AgentResult = {
  ...mockResult,
  status: 'error',
  output: { summary: 'Build failed', raw: 'Error output' },
}

const mockTimeoutResult: AgentResult = {
  ...mockResult,
  status: 'timeout',
  output: { summary: 'Build timed out', raw: 'Timeout output' },
}

const mockEngine = {
  dispatch: vi.fn().mockResolvedValue(mockResult),
} as unknown as DispatchEngine

const mockWorktreeManager = {
  create: vi.fn().mockImplementation(async (taskId: string, _baseBranch?: string) => ({
    taskId,
    worktreePath: `/tmp/wt-${taskId}`,
    branch: `invoke-wt-${taskId}`,
  })),
  merge: vi.fn().mockResolvedValue(undefined),
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
    vi.mocked(mockEngine.dispatch).mockReset()
    vi.mocked(mockEngine.dispatch).mockResolvedValue(mockResult)
    manager = new BatchManager(mockEngine, mockWorktreeManager, undefined)
  })

  afterEach(() => {
    manager.shutdown()
    vi.useRealTimers()
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

  it('stores the owning session ID on the batch record when a session-owned worktree batch is dispatched', async () => {
    const batchId = await manager.dispatchBatch({
      tasks: [
        { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: true,
      sessionId: 'session-A',
    })

    expect(manager.getBatchOwner(batchId)).toEqual({ kind: 'owned', sessionId: 'session-A' })
  })

  it('passes boundPipelineId through to the engine dispatch request', async () => {
    await manager.dispatchBatch({
      tasks: [
        { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: false,
      sessionId: 'session-A',
      boundPipelineId: 'real-pipe',
    })

    await vi.waitFor(() => {
      expect(mockEngine.dispatch).toHaveBeenCalledWith(expect.objectContaining({
        role: 'builder',
        subrole: 'default',
        taskContext: {},
        sessionId: 'session-A',
        boundPipelineId: 'real-pipe',
      }))
    }, { timeout: 2000 })
  })

  it('passes taskRefs through to the engine dispatch request', async () => {
    const taskRefs = {
      diff: {
        type: 'delta_diff' as const,
        session_id: 'session-A',
        reviewed_sha: 'abcdef1234567890abcdef1234567890abcdef12',
      },
    }

    await manager.dispatchBatch({
      tasks: [
        {
          taskId: 'task-1',
          role: 'builder',
          subrole: 'default',
          taskContext: {},
          taskRefs,
        },
      ],
      createWorktrees: false,
    })

    await vi.waitFor(() => {
      expect(mockEngine.dispatch).toHaveBeenCalledWith(expect.objectContaining({
        role: 'builder',
        subrole: 'default',
        taskContext: {},
        taskRefs,
      }))
    }, { timeout: 2000 })
  })

  it('stores a null owner when a batch is dispatched without a session', async () => {
    const batchId = await manager.dispatchBatch({
      tasks: [
        { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: false,
    })

    expect(manager.getBatchOwner(batchId)).toEqual({ kind: 'unowned' })
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
    expect(mockResult.output.raw).toBe('Full output')
  })

  it('keeps raw output after an errored batch reaches terminal status', async () => {
    vi.mocked(mockEngine.dispatch).mockRejectedValueOnce(new Error('boom'))

    const batchId = await manager.dispatchBatch({
      tasks: [
        { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: false,
    })

    await vi.waitFor(() => {
      expect(manager.getStatus(batchId)!.status).toBe('error')
    }, { timeout: 2000 })

    const finalStatus = manager.getStatus(batchId)
    expect(finalStatus!.agents[0].status).toBe('error')
    expect(finalStatus!.agents[0].result?.output.summary).toBe('boom')
    expect(finalStatus!.agents[0].result?.output.raw).toBe('Error: boom')
  })

  it('treats resolved error results as task errors and skips merging', async () => {
    vi.mocked(mockEngine.dispatch).mockResolvedValueOnce(mockErrorResult)

    const batchId = await manager.dispatchBatch({
      tasks: [
        { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: true,
    })

    await vi.waitFor(() => {
      expect(manager.getStatus(batchId)!.status).toBe('error')
    }, { timeout: 2000 })

    const finalStatus = manager.getStatus(batchId)
    expect(finalStatus!.agents[0].status).toBe('error')
    expect(finalStatus!.agents[0].result).toEqual(mockErrorResult)
    expect(mockWorktreeManager.merge).not.toHaveBeenCalled()
  })

  it('treats resolved timeout results as task timeouts and skips merging', async () => {
    vi.mocked(mockEngine.dispatch).mockResolvedValueOnce(mockTimeoutResult)

    const batchId = await manager.dispatchBatch({
      tasks: [
        { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: true,
    })

    await vi.waitFor(() => {
      expect(manager.getStatus(batchId)!.status).toBe('error')
    }, { timeout: 2000 })

    const finalStatus = manager.getStatus(batchId)
    expect(finalStatus!.agents[0].status).toBe('timeout')
    expect(finalStatus!.agents[0].result).toEqual(mockTimeoutResult)
    expect(mockWorktreeManager.merge).not.toHaveBeenCalled()
  })

  it('creates worktrees when requested', async () => {
    await manager.dispatchBatch({
      tasks: [
        { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: true,
    })

    await vi.waitFor(() => {
      expect(mockWorktreeManager.create).toHaveBeenCalledWith('task-1', undefined)
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

  describe('getTaskResult', () => {
    it('returns batch_not_found for an unknown batch', () => {
      expect(manager.getTaskResult('nonexistent', 'task-1')).toEqual({ kind: 'batch_not_found' })
    })

    it('returns task_not_found when the task does not exist in the batch', async () => {
      const batchId = await manager.dispatchBatch({
        tasks: [
          { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
        ],
        createWorktrees: false,
      })

      expect(manager.getTaskResult(batchId, 'task-2')).toEqual({ kind: 'task_not_found' })
    })

    it('returns not_terminal while the task is still running', async () => {
      const neverResolve = new Promise<AgentResult>(() => {})
      vi.mocked(mockEngine.dispatch).mockReturnValueOnce(neverResolve)

      const batchId = await manager.dispatchBatch({
        tasks: [
          { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
        ],
        createWorktrees: false,
      })

      await vi.waitFor(() => {
        expect(manager.getStatus(batchId)!.agents[0].status).toBe('running')
      }, { timeout: 2000 })

      expect(manager.getTaskResult(batchId, 'task-1')).toEqual({
        kind: 'not_terminal',
        status: 'running',
      })
    })

    it('returns the full terminal task result once the task completes', async () => {
      const batchId = await manager.dispatchBatch({
        tasks: [
          { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
        ],
        createWorktrees: false,
      })

      await vi.waitFor(() => {
        expect(manager.getStatus(batchId)!.status).toBe('completed')
      }, { timeout: 2000 })

      expect(manager.getTaskResult(batchId, 'task-1')).toEqual({
        kind: 'ok',
        result: mockResult,
      })
    })

    it('returns a synthetic cancelled result after cancelling an in-flight task', async () => {
      const neverResolve = new Promise<AgentResult>(() => {})
      vi.mocked(mockEngine.dispatch).mockReturnValueOnce(neverResolve)

      const batchId = await manager.dispatchBatch({
        tasks: [
          { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
        ],
        createWorktrees: false,
      })

      await vi.waitFor(() => {
        expect(manager.getStatus(batchId)!.agents[0].status).toBe('running')
      }, { timeout: 2000 })

      manager.cancel(batchId)

      expect(manager.getTaskResult(batchId, 'task-1')).toEqual({
        kind: 'ok',
        result: {
          role: 'builder',
          subrole: 'default',
          provider: 'unknown',
          model: 'unknown',
          status: 'error',
          output: {
            summary: 'Cancelled',
            raw: '',
          },
          duration: 0,
        },
      })
    })

    it('returns no_result when a task is terminal without a stored result', () => {
      ;(manager as any).batches.set('batch-123', {
        status: {
          batchId: 'batch-123',
          status: 'error',
          agents: [{ taskId: 'task-1', status: 'error' }],
        },
        abortController: new AbortController(),
        batchIndex: 0,
        ownerSessionId: null,
        tasks: [{ taskId: 'task-1', role: 'builder', subrole: 'default' }],
      })

      expect(manager.getTaskResult('batch-123', 'task-1')).toEqual({ kind: 'no_result' })
    })
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

  it('evicts terminal batches after the retention TTL', async () => {
    vi.useFakeTimers()
    manager = new BatchManager(mockEngine, mockWorktreeManager, undefined, {
      terminalRetentionMs: 10 * 60 * 1000,
    })

    const batchId = 'batch-123'
    ;(manager as any).batches.set(batchId, {
      status: {
        batchId,
        status: 'completed',
        agents: [
          {
            taskId: 'task-1',
            status: 'completed',
            result: mockResult,
          },
        ],
      },
      abortController: new AbortController(),
      batchIndex: 0,
      ownerSessionId: null,
      tasks: [{ taskId: 'task-1', role: 'builder', subrole: 'default' }],
    })

    ;(manager as any).scheduleTerminalEviction(batchId)

    expect(manager.getTaskResult(batchId, 'task-1')).toEqual({
      kind: 'ok',
      result: mockResult,
    })

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)

    expect(manager.getTaskResult(batchId, 'task-1')).toEqual({ kind: 'batch_not_found' })
  })

  it('does not reset terminal eviction when cancel is called on an already-terminal batch', async () => {
    vi.useFakeTimers()
    manager = new BatchManager(mockEngine, mockWorktreeManager, undefined, {
      terminalRetentionMs: 1000,
    })

    const batchId = 'batch-123'
    ;(manager as any).batches.set(batchId, {
      status: {
        batchId,
        status: 'completed',
        agents: [
          {
            taskId: 'task-1',
            status: 'completed',
            result: mockResult,
          },
        ],
      },
      abortController: new AbortController(),
      batchIndex: 0,
      ownerSessionId: null,
      tasks: [{ taskId: 'task-1', role: 'builder', subrole: 'default' }],
    })

    ;(manager as any).scheduleTerminalEviction(batchId)

    await vi.advanceTimersByTimeAsync(900)
    manager.cancel(batchId)
    await vi.advanceTimersByTimeAsync(100)

    expect(manager.getTaskResult(batchId, 'task-1')).toEqual({ kind: 'batch_not_found' })
  })
})

describe('max_parallel_agents', () => {
  let manager: BatchManager

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(mockEngine.dispatch).mockReset()
    vi.mocked(mockEngine.dispatch).mockImplementation(() =>
      new Promise(resolve => setTimeout(() => resolve(mockResult), 50))
    )
    manager = new BatchManager(mockEngine, mockWorktreeManager, undefined)
  })

  afterEach(() => {
    manager.shutdown()
    vi.useRealTimers()
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

  it('marks dependent DAG tasks as errored when a prerequisite fails', async () => {
    vi.mocked(mockEngine.dispatch).mockResolvedValueOnce(mockErrorResult)

    const batchId = await manager.dispatchBatch({
      tasks: [
        { taskId: 'A', role: 'builder', subrole: 'default', taskContext: { task_description: 'A' } },
        { taskId: 'B', role: 'builder', subrole: 'default', taskContext: { task_description: 'B' }, depends_on: ['A'] },
      ],
      createWorktrees: false,
      maxParallel: 1,
    })

    await vi.waitFor(() => {
      expect(manager.getStatus(batchId)!.status).toBe('error')
    }, { timeout: 2000 })

    const finalStatus = manager.getStatus(batchId)
    expect(finalStatus!.agents[0].status).toBe('error')
    expect(finalStatus!.agents[1].status).toBe('error')
    expect(finalStatus!.agents[1].result?.status).toBe('error')
    expect(finalStatus!.agents[1].result?.output.summary).toBe('Prerequisite A failed')
    expect(vi.mocked(mockEngine.dispatch)).toHaveBeenCalledTimes(1)
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

  it('parses JSON-encoded dependencies declared in taskContext', async () => {
    const buildLayersSpy = vi.spyOn(dagScheduler, 'buildExecutionLayers')

    const batchId = await manager.dispatchBatch({
      tasks: [
        { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
        {
          taskId: 'task-2',
          role: 'builder',
          subrole: 'default',
          taskContext: { depends_on: '["task-1"]' },
        },
      ],
      createWorktrees: false,
    })

    await vi.waitFor(() => {
      expect(manager.getStatus(batchId)!.status).toBe('completed')
    }, { timeout: 5000 })

    expect(buildLayersSpy).toHaveBeenCalledTimes(1)
    expect(buildLayersSpy.mock.calls[0][0][1].depends_on).toEqual(['task-1'])

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

  it('marks the batch as partial when a task errors while work remains', async () => {
    const neverResolve = new Promise<AgentResult>(() => {})
    vi.mocked(mockEngine.dispatch)
      .mockRejectedValueOnce(new Error('boom'))
      .mockReturnValueOnce(neverResolve)

    const batchId = await manager.dispatchBatch({
      tasks: [
        { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
        { taskId: 'task-2', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: false,
    })

    await vi.waitFor(() => {
      const status = manager.getStatus(batchId)
      expect(status!.status).toBe('partial')
      expect(status!.agents[0].status).toBe('error')
      expect(status!.agents[1].status).toBe('running')
    }, { timeout: 2000 })
  })

  it('does not auto-merge completed worktrees within a DAG layer', async () => {
    const started: string[] = []
    const deferreds = new Map([
      ['A', createDeferred<AgentResult>()],
      ['B', createDeferred<AgentResult>()],
      ['C', createDeferred<AgentResult>()],
    ])

    vi.mocked(mockEngine.dispatch).mockImplementation((request: any) => {
      const taskName = request.taskContext.task_description
      started.push(taskName)
      return deferreds.get(taskName)!.promise
    })

    const batchId = await manager.dispatchBatch({
      tasks: [
        { taskId: 'A', role: 'builder', subrole: 'default', taskContext: { task_description: 'A' } },
        { taskId: 'B', role: 'builder', subrole: 'default', taskContext: { task_description: 'B' }, depends_on: ['A'] },
        { taskId: 'C', role: 'builder', subrole: 'default', taskContext: { task_description: 'C' }, depends_on: ['A'] },
      ],
      createWorktrees: true,
      maxParallel: 2,
    })

    await vi.waitFor(() => {
      expect(started).toEqual(['A'])
    }, { timeout: 2000 })

    deferreds.get('A')!.resolve(mockResult)

    await vi.waitFor(() => {
      expect(started).toEqual(['A', 'B', 'C'])
    }, { timeout: 2000 })
    expect(mockWorktreeManager.merge).not.toHaveBeenCalled()

    deferreds.get('B')!.resolve(mockResult)
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(mockWorktreeManager.merge).not.toHaveBeenCalled()

    deferreds.get('C')!.resolve(mockResult)

    await vi.waitFor(() => {
      expect(manager.getStatus(batchId)!.status).toBe('completed')
    }, { timeout: 5000 })

    expect(mockWorktreeManager.merge).not.toHaveBeenCalled()
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
  let addBatch: ReturnType<typeof vi.fn>
  let updateTask: ReturnType<typeof vi.fn>
  let updateBatch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(mockEngine.dispatch).mockResolvedValue(mockResult)
    vi.mocked(sessionPath.resolvePersistedSessionWorkBranchPath).mockReset()
    vi.mocked(sessionPath.resolvePersistedSessionWorkBranchPath).mockImplementation(
      ({ workBranchPath }) => workBranchPath
    )
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
    addBatch = vi.fn().mockImplementation(async (batch) => {
      persistedState = {
        ...persistedState,
        last_updated: new Date().toISOString(),
        batches: [...persistedState.batches, { ...batch, tasks: batch.tasks.map(task => ({ ...task })) }],
      }
      return persistedState
    })
    updateTask = vi.fn().mockImplementation(async (batchIndex, taskId, updates) => {
      const batch = persistedState.batches[batchIndex]
      if (!batch) {
        throw new Error(`Batch index ${batchIndex} out of range (${persistedState.batches.length} batches)`)
      }

      const task = batch.tasks.find(t => t.id === taskId)
      if (!task) {
        throw new Error(`Task '${taskId}' not found in batch ${batchIndex}`)
      }

      Object.assign(task, updates)
      persistedState = {
        ...persistedState,
        last_updated: new Date().toISOString(),
      }
      return persistedState
    })
    updateBatch = vi.fn().mockImplementation(async (batchIndex, updates) => {
      const batch = persistedState.batches[batchIndex]
      if (!batch) {
        throw new Error(`Batch index ${batchIndex} out of range (${persistedState.batches.length} batches)`)
      }

      Object.assign(batch, updates)
      persistedState = {
        ...persistedState,
        last_updated: new Date().toISOString(),
      }
      return persistedState
    })
    stateManager = {
      get: vi.fn().mockImplementation(async () => persistedState),
      addBatch,
      updateTask,
      updateBatch,
    } as unknown as StateManager
    statefulManager = new BatchManager(mockEngine, mockWorktreeManager, stateManager, {
      repoDir: '/repo/project',
    })
  })

  afterEach(() => {
    statefulManager.shutdown()
    vi.useRealTimers()
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

    expect(addBatch).toHaveBeenCalledWith({
      id: 2,
      status: 'in_progress',
      tasks: [{ id: 'task-2', status: 'pending' }],
    })
    expect((statefulManager as any).batches.get(batchId).batchIndex).toBe(2)
    expect(addBatch.mock.invocationCallOrder[0]).toBeLessThan(updateTask.mock.invocationCallOrder[0])
    expect(updateTask.mock.calls.map(([batchIndex]) => batchIndex)).toEqual([2, 2])
    expect(updateTask.mock.calls.map(([, taskId]) => taskId)).toEqual(['task-2', 'task-2'])
    expect(updateTask.mock.calls.map(([, , updates]) => updates.status)).toEqual(['running', 'completed'])
    expect(updateTask.mock.calls[1][2]).toEqual({
      status: 'completed',
      result_summary: mockResult.output.summary,
      result_status: mockResult.status,
    })
  })

  it('passes the session work branch to each worktree creation when available', async () => {
    persistedState = {
      ...persistedState,
      work_branch: 'invoke/work/session-A',
    }

    const batchId = await statefulManager.dispatchBatch({
      tasks: [
        { taskId: 'task-2', role: 'builder', subrole: 'default', taskContext: {} },
        { taskId: 'task-3', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: true,
      sessionId: 'session-A',
    })

    await vi.waitFor(() => {
      expect(statefulManager.getStatus(batchId)!.status).toBe('completed')
    }, { timeout: 3000 })

    expect(mockWorktreeManager.create).toHaveBeenNthCalledWith(1, 'task-2', 'invoke/work/session-A')
    expect(mockWorktreeManager.create).toHaveBeenNthCalledWith(2, 'task-3', 'invoke/work/session-A')
    expect((stateManager.get as any)).toHaveBeenCalledTimes(2)
  })

  it('resolves reviewer workDir from state.work_branch_path when createWorktrees=false', async () => {
    persistedState = {
      ...persistedState,
      work_branch: 'invoke/work/session-A',
      work_branch_path: '/tmp/invoke-session-session-A-xyz',
    }

    await statefulManager.dispatchBatch({
      tasks: [
        { taskId: 'task-2', role: 'reviewer', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: false,
      sessionId: 'session-A',
    })

    await vi.waitFor(() => {
      expect(mockEngine.dispatch).toHaveBeenCalledWith(expect.objectContaining({
        role: 'reviewer',
        subrole: 'default',
        workDir: '/tmp/invoke-session-session-A-xyz',
        sessionId: 'session-A',
      }))
    }, { timeout: 3000 })

    expect(sessionPath.resolvePersistedSessionWorkBranchPath).toHaveBeenCalledWith({
      sessionId: 'session-A',
      projectDir: '/repo/project',
      workBranch: 'invoke/work/session-A',
      workBranchPath: '/tmp/invoke-session-session-A-xyz',
    })
    expect((stateManager.get as any)).toHaveBeenCalledTimes(2)
  })

  it('leaves reviewer workDir undefined when state.work_branch_path is missing', async () => {
    persistedState = {
      ...persistedState,
      work_branch_path: undefined,
    }

    await statefulManager.dispatchBatch({
      tasks: [
        { taskId: 'task-2', role: 'reviewer', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: false,
      sessionId: 'session-A',
    })

    await vi.waitFor(() => {
      expect(mockEngine.dispatch).toHaveBeenCalledWith(expect.objectContaining({
        role: 'reviewer',
        subrole: 'default',
        workDir: undefined,
        sessionId: 'session-A',
      }))
    }, { timeout: 3000 })

    expect((stateManager.get as any)).toHaveBeenCalledTimes(2)
  })

  it('warns when createWorktrees=true but state.work_branch is missing', async () => {
    persistedState = {
      ...persistedState,
      work_branch: undefined,
    }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await statefulManager.dispatchBatch({
      tasks: [
        { taskId: 'task-2', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: true,
      sessionId: 'session-A',
    })

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        '[invoke] BatchManager: createWorktrees=true but state.work_branch is unset ' +
        'for sessionId=session-A. Builder worktrees will branch from main. ' +
        'This will produce incorrect diffs — ensure invoke_session_init_worktree ran.'
      )
    }, { timeout: 3000 })
  })

  it('warns when createWorktrees=true and sessionId is undefined', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await statefulManager.dispatchBatch({
      tasks: [
        { taskId: 'task-2', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: true,
    })

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        '[invoke] BatchManager: createWorktrees=true but state.work_branch is unset ' +
        'for sessionId=<no session_id>. Builder worktrees will branch from main. ' +
        'This will produce incorrect diffs — ensure invoke_session_init_worktree ran.'
      )
    }, { timeout: 3000 })
  })

  it('rejects unsafe reviewer workDir from state.work_branch_path when createWorktrees=false', async () => {
    persistedState = {
      ...persistedState,
      work_branch: 'invoke/work/session-A',
      work_branch_path: '/Users/attacker/invoke-session-session-B-hijacked',
    }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(sessionPath.resolvePersistedSessionWorkBranchPath).mockImplementationOnce(() => {
      throw new Error('Refusing to use unsafe session work branch path for session \'session-A\'')
    })

    await statefulManager.dispatchBatch({
      tasks: [
        { taskId: 'task-2', role: 'reviewer', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: false,
      sessionId: 'session-A',
    })

    await vi.waitFor(() => {
      expect(mockEngine.dispatch).toHaveBeenCalledWith(expect.objectContaining({
        role: 'reviewer',
        subrole: 'default',
        workDir: undefined,
        sessionId: 'session-A',
      }))
    }, { timeout: 3000 })

    expect(sessionPath.resolvePersistedSessionWorkBranchPath).toHaveBeenCalledWith({
      sessionId: 'session-A',
      projectDir: '/repo/project',
      workBranch: 'invoke/work/session-A',
      workBranchPath: '/Users/attacker/invoke-session-session-B-hijacked',
    })
    expect(warnSpy).toHaveBeenCalledWith(
      "[invoke] BatchManager: rejected unsafe work_branch_path for sessionId=session-A: " +
      "Refusing to use unsafe session work branch path for session 'session-A'"
    )
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
    expect(addBatch.mock.calls.every(([batch]) => batch.id === 2)).toBe(true)
    expect(updateTask.mock.calls.every(([batchIndex]) => batchIndex === 2)).toBe(true)
    expect(updateBatch.mock.calls.every(([batchIndex]) => batchIndex === 2)).toBe(true)
  })

  it('serializes concurrent batch registration so persisted batch indexes stay unique', async () => {
    const gate = createDeferred<void>()
    let firstAddBatch = true

    addBatch.mockImplementation(async (batch) => {
      if (firstAddBatch) {
        firstAddBatch = false
        await gate.promise
      }

      persistedState = {
        ...persistedState,
        last_updated: new Date().toISOString(),
        batches: [...persistedState.batches, { ...batch, tasks: batch.tasks.map(task => ({ ...task })) }],
      }
      return persistedState
    })

    const firstDispatch = statefulManager.dispatchBatch({
      tasks: [
        { taskId: 'task-2', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: false,
    })
    const secondDispatch = statefulManager.dispatchBatch({
      tasks: [
        { taskId: 'task-3', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: false,
    })

    await vi.waitFor(() => {
      expect(addBatch).toHaveBeenCalledTimes(1)
    }, { timeout: 2000 })

    gate.resolve()

    const [firstBatchId, secondBatchId] = await Promise.all([firstDispatch, secondDispatch])

    await vi.waitFor(() => {
      expect(addBatch).toHaveBeenCalledTimes(2)
    }, { timeout: 3000 })

    expect(addBatch.mock.calls.map(([batch]) => batch.id)).toEqual([2, 3])
    expect((statefulManager as any).batches.get(firstBatchId).batchIndex).toBe(2)
    expect((statefulManager as any).batches.get(secondBatchId).batchIndex).toBe(3)
  })

  it('serializes concurrent same-session batch registration on the root manager', async () => {
    const rootManager = new BatchManager(mockEngine, mockWorktreeManager)
    const gate = createDeferred<void>()
    let firstAddBatch = true

    addBatch.mockImplementation(async (batch) => {
      if (firstAddBatch) {
        firstAddBatch = false
        await gate.promise
      }

      persistedState = {
        ...persistedState,
        last_updated: new Date().toISOString(),
        batches: [...persistedState.batches, { ...batch, tasks: batch.tasks.map(task => ({ ...task })) }],
      }
      return persistedState
    })

    const firstDispatch = rootManager.dispatchBatch({
      tasks: [
        { taskId: 'task-2', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: false,
      sessionId: 'session-A',
    }, {
      stateManager,
    })
    const secondDispatch = rootManager.dispatchBatch({
      tasks: [
        { taskId: 'task-3', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: false,
      sessionId: 'session-A',
    }, {
      stateManager,
    })

    await vi.waitFor(() => {
      expect(addBatch).toHaveBeenCalledTimes(1)
    }, { timeout: 2000 })

    gate.resolve()

    const [firstBatchId, secondBatchId] = await Promise.all([firstDispatch, secondDispatch])

    await vi.waitFor(() => {
      expect(addBatch).toHaveBeenCalledTimes(2)
    }, { timeout: 3000 })

    expect(addBatch.mock.calls.map(([batch]) => batch.id)).toEqual([2, 3])
    expect(rootManager.getBatchOwner(firstBatchId)).toEqual({ kind: 'owned', sessionId: 'session-A' })
    expect(rootManager.getBatchOwner(secondBatchId)).toEqual({ kind: 'owned', sessionId: 'session-A' })
    expect((rootManager as any).batches.size).toBe(2)
    expect((rootManager as any).batches.has(firstBatchId)).toBe(true)
    expect((rootManager as any).batches.has(secondBatchId)).toBe(true)

    rootManager.shutdown()
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

  it('persists partial batch status when a task errors while work remains', async () => {
    const neverResolve = new Promise<AgentResult>(() => {})
    vi.mocked(mockEngine.dispatch)
      .mockRejectedValueOnce(new Error('boom'))
      .mockReturnValueOnce(neverResolve)

    await statefulManager.dispatchBatch({
      tasks: [
        { taskId: 'task-2', role: 'builder', subrole: 'default', taskContext: {} },
        { taskId: 'task-3', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: false,
    })

    await vi.waitFor(() => {
      expect(updateBatch).toHaveBeenCalledWith(2, { status: 'partial' })
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
    statelessManager.shutdown()
  })
})
