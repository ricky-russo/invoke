import { randomUUID } from 'crypto'
import type { DispatchEngine } from './engine.js'
import type { WorktreeManager } from '../worktree/manager.js'
import type { BatchRequest, BatchStatus, AgentStatus, AgentResult } from '../types.js'

interface BatchRecord {
  status: BatchStatus
  abortController: AbortController
}

export class BatchManager {
  private batches = new Map<string, BatchRecord>()

  constructor(
    private engine: DispatchEngine,
    private worktreeManager: WorktreeManager
  ) {}

  dispatchBatch(request: BatchRequest): string {
    const batchId = randomUUID().slice(0, 8)
    const agents: AgentStatus[] = request.tasks.map(task => ({
      taskId: task.taskId,
      status: 'pending' as const,
    }))

    const abortController = new AbortController()
    const record: BatchRecord = {
      status: { batchId, status: 'running', agents },
      abortController,
    }

    this.batches.set(batchId, record)

    // Fire and forget — dispatch all tasks in parallel
    this.runBatch(batchId, request, abortController.signal)

    return batchId
  }

  getStatus(batchId: string): BatchStatus | null {
    const record = this.batches.get(batchId)
    return record ? record.status : null
  }

  async waitForStatus(batchId: string, waitSeconds: number): Promise<BatchStatus | null> {
    const record = this.batches.get(batchId)
    if (!record) return null

    // If already done, return immediately
    if (record.status.status !== 'running') return record.status

    // Snapshot current agent statuses to detect changes
    const snapshot = record.status.agents.map(a => a.status).join(',')

    const deadline = Date.now() + waitSeconds * 1000
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Batch finished
      if (record.status.status !== 'running') return record.status

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
  }

  private async runBatch(
    batchId: string,
    request: BatchRequest,
    signal: AbortSignal
  ): Promise<void> {
    const record = this.batches.get(batchId)!

    const promises = request.tasks.map(async (task, index) => {
      if (signal.aborted) return

      const agentStatus = record.status.agents[index]

      try {
        let workDir: string | undefined

        if (request.createWorktrees) {
          agentStatus.status = 'dispatched'
          const wt = await this.worktreeManager.create(task.taskId)
          workDir = wt.worktreePath
        }

        agentStatus.status = 'running'

        if (signal.aborted) return

        const result = await this.engine.dispatch({
          role: task.role,
          subrole: task.subrole,
          taskContext: task.taskContext,
          workDir,
        })

        agentStatus.status = 'completed'
        agentStatus.result = result
      } catch (err) {
        agentStatus.status = 'error'
        agentStatus.result = {
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
      }
    })

    await Promise.allSettled(promises)

    if (!signal.aborted) {
      const allDone = record.status.agents.every(
        a => a.status === 'completed' || a.status === 'error' || a.status === 'timeout'
      )
      const anyError = record.status.agents.some(a => a.status === 'error' || a.status === 'timeout')

      record.status.status = allDone
        ? (anyError ? 'error' : 'completed')
        : 'running'
    }
  }
}
