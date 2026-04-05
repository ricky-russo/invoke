import { randomUUID } from 'crypto'
import type { DispatchEngine } from './engine.js'
import { buildExecutionLayers } from './dag-scheduler.js'
import type { WorktreeManager } from '../worktree/manager.js'
import type { StateManager } from '../tools/state.js'
import type {
  BatchRequest,
  BatchTask,
  BatchStatus,
  BatchState,
  AgentStatus,
  AgentResult,
  TaskState,
} from '../types.js'

type PersistableBatchStatus = Exclude<BatchStatus['status'], 'cancelled'>

const persistedBatchStatusMap: Record<PersistableBatchStatus, BatchState['status']> = {
  running: 'in_progress',
  partial: 'partial',
  completed: 'completed',
  error: 'error',
}

interface BatchRecord {
  status: BatchStatus
  abortController: AbortController
  batchIndex: number
}

interface ScheduledBatchTask extends BatchTask {
  id: string
  index: number
}

export class BatchManager {
  private batches = new Map<string, BatchRecord>()

  constructor(
    private engine: DispatchEngine,
    private worktreeManager: WorktreeManager,
    private stateManager?: StateManager
  ) {}

  async dispatchBatch(request: BatchRequest): Promise<string> {
    const batchId = randomUUID().slice(0, 8)
    const agents: AgentStatus[] = request.tasks.map(task => ({
      taskId: task.taskId,
      status: 'pending' as const,
    }))

    const abortController = new AbortController()
    const currentBatchIndex = this.stateManager
      ? await this.getPersistedBatchIndex()
      : this.batches.size
    const record: BatchRecord = {
      status: { batchId, status: 'running', agents },
      abortController,
      batchIndex: currentBatchIndex,
    }

    await this.addPersistedBatch(currentBatchIndex, request)
    this.batches.set(batchId, record)

    // Fire and forget — dispatch all tasks in parallel
    void this.runBatch(batchId, request, abortController.signal, currentBatchIndex)

    return batchId
  }

  private async getPersistedBatchIndex(): Promise<number> {
    const state = await this.stateManager?.get()
    return state ? state.batches.length : 0
  }

  getStatus(batchId: string): BatchStatus | null {
    const record = this.batches.get(batchId)
    return record ? record.status : null
  }

  async waitForStatus(batchId: string, waitSeconds: number): Promise<BatchStatus | null> {
    const record = this.batches.get(batchId)
    if (!record) return null

    // If already done, return immediately
    if (this.isTerminalBatchStatus(record.status.status)) return record.status

    // Snapshot current agent statuses to detect changes
    const snapshot = record.status.agents.map(a => a.status).join(',')

    const deadline = Date.now() + waitSeconds * 1000
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Batch finished
      if (this.isTerminalBatchStatus(record.status.status)) return record.status

      // An agent's status changed (e.g. one completed while others still run)
      const current = record.status.agents.map(a => a.status).join(',')
      if (current !== snapshot) return record.status
    }

    // Timeout — return current status
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
    this.stripRawOutput(record.status.agents)
  }

  private isTerminalBatchStatus(status: BatchStatus['status']): boolean {
    return status === 'completed' || status === 'error' || status === 'cancelled'
  }

  private isTerminalAgentStatus(status: AgentStatus['status']): boolean {
    return status === 'completed' || status === 'error' || status === 'timeout'
  }

  private computeBatchStatus(agents: AgentStatus[]): BatchStatus['status'] {
    const allFinished = agents.every(agent => this.isTerminalAgentStatus(agent.status))
    if (allFinished) {
      const anyError = agents.some(agent => agent.status === 'error' || agent.status === 'timeout')
      return anyError ? 'error' : 'completed'
    }

    const anyFinished = agents.some(agent => this.isTerminalAgentStatus(agent.status))
    return anyFinished ? 'partial' : 'running'
  }

  private toPersistedBatchStatus(status: PersistableBatchStatus): BatchState['status'] {
    return persistedBatchStatusMap[status]
  }

  private async addPersistedBatch(batchIndex: number, request: BatchRequest): Promise<void> {
    if (!this.stateManager) return

    await this.stateManager.addBatch({
      id: batchIndex,
      status: this.toPersistedBatchStatus('running'),
      tasks: request.tasks.map(task => {
        const dependsOn = this.getTaskDependencies(task)
        return {
          id: task.taskId,
          status: 'pending',
          ...(dependsOn ? { depends_on: dependsOn } : {}),
        }
      }),
    })
  }

  private async persistTaskUpdate(
    batchIndex: number,
    taskId: string,
    updates: Partial<TaskState>
  ): Promise<void> {
    if (!this.stateManager) return

    try {
      await this.stateManager.updateTask(batchIndex, taskId, updates)
    } catch {
      // Non-critical — don't fail dispatch if state persistence fails
    }
  }

  private async persistBatchStatus(
    batchIndex: number,
    status: BatchStatus['status']
  ): Promise<void> {
    if (!this.stateManager || status === 'cancelled') return

    try {
      await this.stateManager.updateBatch(batchIndex, {
        status: this.toPersistedBatchStatus(status),
      })
    } catch {
      // Non-critical — don't fail dispatch if state persistence fails
    }
  }

  private async updateBatchStatus(record: BatchRecord): Promise<void> {
    if (record.status.status === 'cancelled') return

    const nextStatus = this.computeBatchStatus(record.status.agents)
    if (record.status.status === nextStatus) return

    record.status.status = nextStatus
    if (this.isTerminalBatchStatus(nextStatus)) {
      this.stripRawOutput(record.status.agents)
    }
    await this.persistBatchStatus(record.batchIndex, nextStatus)
  }

  private async persistTaskStatus(
    batchIndex: number,
    taskId: string,
    status: TaskState['status'],
    result?: AgentResult
  ): Promise<void> {
    await this.persistTaskUpdate(batchIndex, taskId, {
      status,
      result_summary: result?.output.summary,
      result_status: result?.status,
    })
  }

  private getTaskDependencies(task: BatchTask): string[] | undefined {
    if (task.depends_on && task.depends_on.length > 0) {
      return task.depends_on
    }

    const rawDependencies = task.taskContext.depends_on
    if (typeof rawDependencies !== 'string') {
      return undefined
    }

    const trimmed = rawDependencies.trim()
    if (!trimmed) {
      return undefined
    }

    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) {
          const dependencies = parsed.filter(
            (dependency): dependency is string => typeof dependency === 'string'
          )
          return dependencies.length > 0 ? dependencies : undefined
        }
      } catch {
        // Fall through to comma-separated parsing.
      }
    }

    const dependencies = trimmed
      .split(',')
      .map(dependency => dependency.trim())
      .filter(Boolean)

    return dependencies.length > 0 ? dependencies : undefined
  }

  private async mergeTaskWorktree(batchIndex: number, taskId: string): Promise<void> {
    await this.worktreeManager.merge(taskId)
    await this.persistTaskUpdate(batchIndex, taskId, { merged: true })
  }

  private async runLayer<T>(
    tasks: T[],
    maxParallel: number,
    signal: AbortSignal,
    runTask: (task: T) => Promise<void>
  ): Promise<void> {
    if (tasks.length === 0) return

    if (maxParallel > 0 && tasks.length > maxParallel) {
      let active = 0
      let nextIndex = 0

      await new Promise<void>((resolveAll) => {
        const tryNext = () => {
          while (active < maxParallel && nextIndex < tasks.length && !signal.aborted) {
            const task = tasks[nextIndex++]
            active++
            runTask(task).finally(() => {
              active--
              if ((signal.aborted && active === 0) || (nextIndex >= tasks.length && active === 0)) {
                resolveAll()
                return
              }
              tryNext()
            })
          }

          if (tasks.length === 0 || (signal.aborted && active === 0) || (nextIndex >= tasks.length && active === 0)) {
            resolveAll()
          }
        }

        tryNext()
      })

      return
    }

    await Promise.allSettled(tasks.map(task => runTask(task)))
  }

  private async runBatch(
    batchId: string,
    request: BatchRequest,
    signal: AbortSignal,
    batchIndex: number
  ): Promise<void> {
    const record = this.batches.get(batchId)!
    const maxParallel = request.maxParallel ?? 0 // 0 = unlimited

    const scheduledTasks: ScheduledBatchTask[] = request.tasks.map((task, index) => ({
      ...task,
      id: task.taskId,
      index,
      depends_on: this.getTaskDependencies(task),
    }))

    const runTask = async (task: ScheduledBatchTask) => {
      if (signal.aborted) return

      const agentStatus = record.status.agents[task.index]

      try {
        let workDir: string | undefined

        if (request.createWorktrees) {
          agentStatus.status = 'dispatched'
          await this.persistTaskStatus(batchIndex, task.taskId, 'dispatched')

          if (signal.aborted) return

          const wt = await this.worktreeManager.create(task.taskId)
          if (signal.aborted) return

          workDir = wt.worktreePath
          await this.persistTaskUpdate(batchIndex, task.taskId, {
            worktree_path: wt.worktreePath,
            worktree_branch: wt.branch,
          })
        }

        if (signal.aborted) return

        agentStatus.status = 'running'
        await this.persistTaskStatus(batchIndex, task.taskId, 'running')

        if (signal.aborted) return

        const result = await this.engine.dispatch({
          role: task.role,
          subrole: task.subrole,
          taskContext: task.taskContext,
          workDir,
        })

        if (signal.aborted) return

        agentStatus.status = 'completed'
        agentStatus.result = cloneAgentResult(result)
        await this.persistTaskStatus(batchIndex, task.taskId, 'completed', result)
        if (request.createWorktrees) {
          await this.mergeTaskWorktree(batchIndex, task.taskId)
        }
        await this.updateBatchStatus(record)
      } catch (err) {
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
        agentStatus.status = 'error'
        agentStatus.result = cloneAgentResult(errorResult)
        await this.persistTaskStatus(batchIndex, task.taskId, 'error', errorResult)
        await this.updateBatchStatus(record)
      }
    }

    try {
      const hasDependencies = scheduledTasks.some(task => (task.depends_on?.length ?? 0) > 0)

      if (hasDependencies) {
        const executionLayers = buildExecutionLayers(scheduledTasks)
        // Tasks still run with layer barriers. Completed tasks can merge immediately
        // within a layer, but unblocking downstream layers per-task is future work.
        for (const layer of executionLayers) {
          if (signal.aborted) break
          await this.runLayer(layer, maxParallel, signal, runTask)
        }
      } else {
        await this.runLayer(scheduledTasks, maxParallel, signal, runTask)
      }

      if (!signal.aborted) {
        await this.updateBatchStatus(record)
      }
    } catch {
      if (record.status.status !== 'cancelled') {
        record.status.status = 'error'
        this.stripRawOutput(record.status.agents)
        await this.persistBatchStatus(batchIndex, 'error')
      }
    }
  }

  private stripRawOutput(agents: AgentStatus[]): void {
    for (const agent of agents) {
      if (agent.result) {
        agent.result.output.raw = undefined
      }
    }
  }
}

function cloneAgentResult(result: AgentResult): AgentResult {
  return {
    ...result,
    output: {
      ...result.output,
    },
  }
}
