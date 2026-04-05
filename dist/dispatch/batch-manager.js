import { randomUUID } from 'crypto';
import { buildExecutionLayers } from './dag-scheduler.js';
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
        void this.runBatch(batchId, request, abortController.signal, currentBatchIndex);
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
        if (this.isTerminalBatchStatus(record.status.status))
            return record.status;
        // Snapshot current agent statuses to detect changes
        const snapshot = record.status.agents.map(a => a.status).join(',');
        const deadline = Date.now() + waitSeconds * 1000;
        while (Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            // Batch finished
            if (this.isTerminalBatchStatus(record.status.status))
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
    isTerminalBatchStatus(status) {
        return status === 'completed' || status === 'error' || status === 'cancelled';
    }
    isTerminalAgentStatus(status) {
        return status === 'completed' || status === 'error' || status === 'timeout';
    }
    computeBatchStatus(agents) {
        const allFinished = agents.every(agent => this.isTerminalAgentStatus(agent.status));
        if (allFinished) {
            const anyError = agents.some(agent => agent.status === 'error' || agent.status === 'timeout');
            return anyError ? 'error' : 'completed';
        }
        const anyCompleted = agents.some(agent => agent.status === 'completed');
        return anyCompleted ? 'partial' : 'running';
    }
    async persistBatchStatus(batchIndex, status) {
        if (!this.stateManager || status === 'cancelled')
            return;
        const persistedStatus = status === 'running'
            ? 'in_progress'
            : status;
        try {
            await this.stateManager.updateBatch(batchIndex, {
                status: persistedStatus,
            });
        }
        catch {
            // Non-critical — don't fail dispatch if state persistence fails
        }
    }
    async updateBatchStatus(record) {
        if (record.status.status === 'cancelled')
            return;
        const nextStatus = this.computeBatchStatus(record.status.agents);
        if (record.status.status === nextStatus)
            return;
        record.status.status = nextStatus;
        await this.persistBatchStatus(record.batchIndex, nextStatus);
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
    getTaskDependencies(task) {
        if (task.depends_on && task.depends_on.length > 0) {
            return task.depends_on;
        }
        const rawDependencies = task.taskContext.depends_on;
        if (Array.isArray(rawDependencies)) {
            const dependencies = rawDependencies.filter((dependency) => typeof dependency === 'string');
            return dependencies.length > 0 ? dependencies : undefined;
        }
        if (typeof rawDependencies !== 'string') {
            return undefined;
        }
        const trimmed = rawDependencies.trim();
        if (!trimmed) {
            return undefined;
        }
        if (trimmed.startsWith('[')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) {
                    const dependencies = parsed.filter((dependency) => typeof dependency === 'string');
                    return dependencies.length > 0 ? dependencies : undefined;
                }
            }
            catch {
                // Fall through to comma-separated parsing.
            }
        }
        const dependencies = trimmed
            .split(',')
            .map(dependency => dependency.trim())
            .filter(Boolean);
        return dependencies.length > 0 ? dependencies : undefined;
    }
    async runLayer(tasks, maxParallel, signal, runTask) {
        if (tasks.length === 0)
            return;
        if (maxParallel > 0 && tasks.length > maxParallel) {
            let active = 0;
            let nextIndex = 0;
            await new Promise((resolveAll) => {
                const tryNext = () => {
                    while (active < maxParallel && nextIndex < tasks.length && !signal.aborted) {
                        const task = tasks[nextIndex++];
                        active++;
                        runTask(task).finally(() => {
                            active--;
                            if ((signal.aborted && active === 0) || (nextIndex >= tasks.length && active === 0)) {
                                resolveAll();
                                return;
                            }
                            tryNext();
                        });
                    }
                    if (tasks.length === 0 || (signal.aborted && active === 0) || (nextIndex >= tasks.length && active === 0)) {
                        resolveAll();
                    }
                };
                tryNext();
            });
            return;
        }
        await Promise.allSettled(tasks.map(task => runTask(task)));
    }
    async runBatch(batchId, request, signal, batchIndex) {
        const record = this.batches.get(batchId);
        const maxParallel = request.maxParallel ?? 0; // 0 = unlimited
        const scheduledTasks = request.tasks.map((task, index) => ({
            ...task,
            id: task.taskId,
            index,
            depends_on: this.getTaskDependencies(task),
        }));
        const runTask = async (task) => {
            if (signal.aborted)
                return;
            const agentStatus = record.status.agents[task.index];
            try {
                let workDir;
                if (request.createWorktrees) {
                    agentStatus.status = 'dispatched';
                    await this.persistTaskStatus(batchIndex, task.taskId, 'dispatched');
                    if (signal.aborted)
                        return;
                    const wt = await this.worktreeManager.create(task.taskId);
                    if (signal.aborted)
                        return;
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
                if (signal.aborted)
                    return;
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
                if (signal.aborted)
                    return;
                agentStatus.status = 'completed';
                agentStatus.result = result;
                await this.persistTaskStatus(batchIndex, task.taskId, 'completed', result);
                await this.updateBatchStatus(record);
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
                await this.updateBatchStatus(record);
            }
        };
        try {
            const hasDependencies = scheduledTasks.some(task => (task.depends_on?.length ?? 0) > 0);
            if (hasDependencies) {
                const executionLayers = buildExecutionLayers(scheduledTasks);
                for (const layer of executionLayers) {
                    if (signal.aborted)
                        break;
                    await this.runLayer(layer, maxParallel, signal, runTask);
                }
            }
            else {
                await this.runLayer(scheduledTasks, maxParallel, signal, runTask);
            }
            if (!signal.aborted) {
                await this.updateBatchStatus(record);
            }
        }
        catch {
            if (record.status.status !== 'cancelled') {
                record.status.status = 'error';
                await this.persistBatchStatus(batchIndex, 'error');
            }
        }
    }
}
//# sourceMappingURL=batch-manager.js.map