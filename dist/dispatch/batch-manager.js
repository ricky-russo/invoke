import { randomUUID } from 'crypto';
export class BatchManager {
    engine;
    worktreeManager;
    stateManager;
    batches = new Map();
    constructor(engine, worktreeManager, stateManager) {
        this.engine = engine;
        this.worktreeManager = worktreeManager;
        this.stateManager = stateManager;
    }
    async dispatchBatch(request) {
        const batchId = randomUUID().slice(0, 8);
        const agents = request.tasks.map(task => ({
            taskId: task.taskId,
            status: 'pending',
        }));
        const abortController = new AbortController();
        const currentBatchIndex = this.stateManager
            ? await this.getPersistedBatchIndex()
            : this.batches.size;
        const record = {
            status: { batchId, status: 'running', agents },
            abortController,
            batchIndex: currentBatchIndex,
        };
        this.batches.set(batchId, record);
        // Fire and forget — dispatch all tasks in parallel
        this.runBatch(batchId, request, abortController.signal, currentBatchIndex);
        return batchId;
    }
    async getPersistedBatchIndex() {
        const state = await this.stateManager?.get();
        return state ? state.batches.length : 0;
    }
    getStatus(batchId) {
        const record = this.batches.get(batchId);
        return record ? record.status : null;
    }
    async waitForStatus(batchId, waitSeconds) {
        const record = this.batches.get(batchId);
        if (!record)
            return null;
        // If already done, return immediately
        if (record.status.status !== 'running')
            return record.status;
        // Snapshot current agent statuses to detect changes
        const snapshot = record.status.agents.map(a => a.status).join(',');
        const deadline = Date.now() + waitSeconds * 1000;
        while (Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            // Batch finished
            if (record.status.status !== 'running')
                return record.status;
            // An agent's status changed (e.g. one completed while others still run)
            const current = record.status.agents.map(a => a.status).join(',');
            if (current !== snapshot)
                return record.status;
        }
        // Timeout — return current status
        return record.status;
    }
    cancel(batchId) {
        const record = this.batches.get(batchId);
        if (!record)
            return;
        record.abortController.abort();
        record.status.status = 'cancelled';
        for (const agent of record.status.agents) {
            if (agent.status === 'pending' || agent.status === 'dispatched' || agent.status === 'running') {
                agent.status = 'error';
            }
        }
    }
    async persistTaskStatus(batchIndex, taskId, status, result) {
        if (!this.stateManager)
            return;
        try {
            await this.stateManager.updateTask(batchIndex, taskId, {
                status: status,
                result_summary: result?.output.summary,
                result_status: result?.status,
            });
        }
        catch {
            // Non-critical — don't fail dispatch if state persistence fails
        }
    }
    async runBatch(batchId, request, signal, batchIndex) {
        const record = this.batches.get(batchId);
        const maxParallel = request.maxParallel ?? 0; // 0 = unlimited
        const runTask = async (task, index) => {
            if (signal.aborted)
                return;
            const agentStatus = record.status.agents[index];
            try {
                let workDir;
                if (request.createWorktrees) {
                    agentStatus.status = 'dispatched';
                    await this.persistTaskStatus(batchIndex, task.taskId, 'dispatched');
                    const wt = await this.worktreeManager.create(task.taskId);
                    workDir = wt.worktreePath;
                    if (this.stateManager) {
                        try {
                            await this.stateManager.updateTask(batchIndex, task.taskId, {
                                worktree_path: wt.worktreePath,
                                worktree_branch: wt.branch,
                            });
                        }
                        catch {
                            // Non-critical
                        }
                    }
                }
                agentStatus.status = 'running';
                await this.persistTaskStatus(batchIndex, task.taskId, 'running');
                if (signal.aborted)
                    return;
                const result = await this.engine.dispatch({
                    role: task.role,
                    subrole: task.subrole,
                    taskContext: task.taskContext,
                    workDir,
                });
                agentStatus.status = 'completed';
                agentStatus.result = result;
                await this.persistTaskStatus(batchIndex, task.taskId, 'completed', result);
            }
            catch (err) {
                const errorResult = {
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
                };
                agentStatus.status = 'error';
                agentStatus.result = errorResult;
                await this.persistTaskStatus(batchIndex, task.taskId, 'error', errorResult);
            }
        };
        if (maxParallel > 0 && request.tasks.length > maxParallel) {
            // Concurrency pool
            let active = 0;
            let nextIndex = 0;
            await new Promise((resolveAll) => {
                const tryNext = () => {
                    while (active < maxParallel && nextIndex < request.tasks.length && !signal.aborted) {
                        const idx = nextIndex++;
                        active++;
                        runTask(request.tasks[idx], idx).finally(() => {
                            active--;
                            if (nextIndex >= request.tasks.length && active === 0) {
                                resolveAll();
                            }
                            else {
                                tryNext();
                            }
                        });
                    }
                    if (request.tasks.length === 0 || (nextIndex >= request.tasks.length && active === 0)) {
                        resolveAll();
                    }
                };
                tryNext();
            });
        }
        else {
            // Unlimited — current behavior
            const promises = request.tasks.map((task, index) => runTask(task, index));
            await Promise.allSettled(promises);
        }
        if (!signal.aborted) {
            const allDone = record.status.agents.every(a => a.status === 'completed' || a.status === 'error' || a.status === 'timeout');
            const anyError = record.status.agents.some(a => a.status === 'error' || a.status === 'timeout');
            record.status.status = allDone
                ? (anyError ? 'error' : 'completed')
                : 'running';
            if (this.stateManager) {
                try {
                    await this.stateManager.updateBatch(batchIndex, {
                        status: record.status.status === 'completed' ? 'completed'
                            : record.status.status === 'error' ? 'error'
                                : 'in_progress',
                    });
                }
                catch {
                    // Non-critical
                }
            }
        }
    }
}
//# sourceMappingURL=batch-manager.js.map