import { randomUUID } from 'crypto';
import { buildExecutionLayers } from './dag-scheduler.js';
const persistedBatchStatusMap = {
    running: 'in_progress',
    partial: 'partial',
    completed: 'completed',
    error: 'error',
};
// Terminal batch records (completed, errored, cancelled) are kept in memory so
// invoke_get_task_result can serve results after a batch finishes. To prevent
// unbounded memory growth, each terminal record is evicted after this duration.
// After eviction, BatchManager.getTaskResult returns `kind: 'batch_not_found'`,
// which invoke_get_task_result surfaces to callers as `Batch not found: <id>`.
// To retain a result beyond this window, save it via invoke_save_artifact
// immediately after dispatch. See docs/troubleshooting.md for details.
const DEFAULT_TERMINAL_RETENTION_MS = 10 * 60 * 1000;
export class BatchManager {
    engine;
    worktreeManager;
    defaultStateManager;
    batches = new Map();
    batchRegistrationQueue = Promise.resolve();
    evictionTimers = new Map();
    isShutdown = false;
    terminalRetentionMs;
    constructor(engine, worktreeManager, defaultStateManager, options = {}) {
        this.engine = engine;
        this.worktreeManager = worktreeManager;
        this.defaultStateManager = defaultStateManager;
        this.terminalRetentionMs = options.terminalRetentionMs ?? DEFAULT_TERMINAL_RETENTION_MS;
    }
    async dispatchBatch(request, options = {}) {
        const batchId = randomUUID().slice(0, 8);
        const stateManager = options.stateManager ?? this.defaultStateManager;
        const agents = request.tasks.map(task => ({
            taskId: task.taskId,
            status: 'pending',
        }));
        const abortController = new AbortController();
        const record = await this.enqueueBatchRegistration(async () => {
            const currentBatchIndex = stateManager
                ? await this.getPersistedBatchIndex(stateManager)
                : this.batches.size;
            const nextRecord = {
                status: { batchId, status: 'running', agents },
                abortController,
                batchIndex: currentBatchIndex,
                ownerSessionId: request.sessionId ?? null,
                tasks: request.tasks.map(task => ({
                    taskId: task.taskId,
                    role: task.role,
                    subrole: task.subrole,
                })),
            };
            await this.addPersistedBatch(stateManager, currentBatchIndex, request);
            this.batches.set(batchId, nextRecord);
            return nextRecord;
        });
        // Fire and forget — run the batch asynchronously.
        void this.runBatch(batchId, request, abortController.signal, record.batchIndex, stateManager);
        return batchId;
    }
    async getPersistedBatchIndex(stateManager) {
        const state = await stateManager?.get();
        return state ? state.batches.length : 0;
    }
    enqueueBatchRegistration(operation) {
        const queuedOperation = this.batchRegistrationQueue.then(operation);
        this.batchRegistrationQueue = queuedOperation.then(() => undefined, () => undefined);
        return queuedOperation;
    }
    getStatus(batchId) {
        const record = this.batches.get(batchId);
        return record ? record.status : null;
    }
    getBatchOwner(batchId) {
        const record = this.batches.get(batchId);
        if (!record) {
            return { kind: 'not_found' };
        }
        if (record.ownerSessionId === null) {
            return { kind: 'unowned' };
        }
        return { kind: 'owned', sessionId: record.ownerSessionId };
    }
    getTaskResult(batchId, taskId) {
        const record = this.batches.get(batchId);
        if (!record) {
            return { kind: 'batch_not_found' };
        }
        const agent = record.status.agents.find(candidate => candidate.taskId === taskId);
        if (!agent) {
            return { kind: 'task_not_found' };
        }
        if (!this.isTerminalAgentStatus(agent.status)) {
            return { kind: 'not_terminal', status: agent.status };
        }
        if (!agent.result) {
            return { kind: 'no_result' };
        }
        return { kind: 'ok', result: agent.result };
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
        if (this.isTerminalBatchStatus(record.status.status))
            return;
        this.clearEvictionTimer(batchId);
        record.abortController.abort();
        record.status.status = 'cancelled';
        for (const agent of record.status.agents) {
            if (!this.isTerminalAgentStatus(agent.status)) {
                agent.status = 'error';
                agent.result = this.createCancelledResult(record, agent.taskId);
            }
        }
        this.scheduleTerminalEviction(batchId);
    }
    shutdown() {
        this.isShutdown = true;
        for (const batchId of this.evictionTimers.keys()) {
            this.clearEvictionTimer(batchId);
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
        const anyFinished = agents.some(agent => this.isTerminalAgentStatus(agent.status));
        return anyFinished ? 'partial' : 'running';
    }
    toPersistedBatchStatus(status) {
        return persistedBatchStatusMap[status];
    }
    async addPersistedBatch(stateManager, batchIndex, request) {
        if (!stateManager)
            return;
        await stateManager.addBatch({
            id: batchIndex,
            status: this.toPersistedBatchStatus('running'),
            tasks: request.tasks.map(task => {
                const dependsOn = this.getTaskDependencies(task);
                return {
                    id: task.taskId,
                    status: 'pending',
                    ...(dependsOn ? { depends_on: dependsOn } : {}),
                };
            }),
        });
    }
    async persistTaskUpdate(stateManager, batchIndex, taskId, updates) {
        if (!stateManager)
            return;
        try {
            await stateManager.updateTask(batchIndex, taskId, updates);
        }
        catch {
            // Non-critical — don't fail dispatch if state persistence fails
        }
    }
    async persistBatchStatus(stateManager, batchIndex, status) {
        if (!stateManager || status === 'cancelled')
            return;
        try {
            await stateManager.updateBatch(batchIndex, {
                status: this.toPersistedBatchStatus(status),
            });
        }
        catch {
            // Non-critical — don't fail dispatch if state persistence fails
        }
    }
    async updateBatchStatus(record, stateManager) {
        if (record.status.status === 'cancelled')
            return;
        const nextStatus = this.computeBatchStatus(record.status.agents);
        if (record.status.status === nextStatus)
            return;
        record.status.status = nextStatus;
        if (this.isTerminalBatchStatus(nextStatus)) {
            this.scheduleTerminalEviction(record.status.batchId);
        }
        await this.persistBatchStatus(stateManager, record.batchIndex, nextStatus);
    }
    createCancelledResult(record, taskId) {
        const task = record.tasks.find(candidate => candidate.taskId === taskId);
        return {
            role: task?.role ?? 'unknown',
            subrole: task?.subrole ?? 'unknown',
            provider: 'unknown',
            model: 'unknown',
            status: 'error',
            output: {
                summary: 'Cancelled',
                raw: '',
            },
            duration: 0,
        };
    }
    clearEvictionTimer(batchId) {
        const timer = this.evictionTimers.get(batchId);
        if (!timer)
            return;
        clearTimeout(timer);
        this.evictionTimers.delete(batchId);
    }
    scheduleTerminalEviction(batchId) {
        const record = this.batches.get(batchId);
        if (this.isShutdown || !record || !this.isTerminalBatchStatus(record.status.status)) {
            return;
        }
        this.clearEvictionTimer(batchId);
        // BUG-003 made raw output survive past terminal status so invoke_get_task_result can serve it.
        // To prevent unbounded memory growth, terminal batch records are now evicted after
        // terminalRetentionMs (default 10 minutes). After eviction, invoke_get_task_result will
        // return kind: batch_not_found with a clear error.
        const timer = setTimeout(() => {
            this.batches.delete(batchId);
            this.evictionTimers.delete(batchId);
        }, this.terminalRetentionMs);
        if (typeof timer === 'object' && timer !== null && 'unref' in timer && typeof timer.unref === 'function') {
            timer.unref();
        }
        this.evictionTimers.set(batchId, timer);
    }
    async persistTaskStatus(stateManager, batchIndex, taskId, status, result) {
        await this.persistTaskUpdate(stateManager, batchIndex, taskId, {
            status,
            result_summary: result?.output.summary,
            result_status: result?.status,
        });
    }
    getTaskDependencies(task) {
        if (task.depends_on && task.depends_on.length > 0) {
            return task.depends_on;
        }
        const rawDependencies = task.taskContext.depends_on;
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
                // Multiple resolveAll() calls below are intentional; resolving an already-settled
                // promise is a no-op and keeps the exit conditions simple.
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
    async runBatch(batchId, request, signal, batchIndex, stateManager) {
        const record = this.batches.get(batchId);
        const maxParallel = request.maxParallel ?? 0; // 0 = unlimited
        let sessionWorkBranch;
        if (request.createWorktrees && request.sessionId && stateManager) {
            const state = await stateManager.get();
            sessionWorkBranch = state?.work_branch;
        }
        const scheduledTasks = request.tasks.map((task, index) => ({
            ...task,
            id: task.taskId,
            index,
            depends_on: this.getTaskDependencies(task),
        }));
        const taskIndexById = new Map(scheduledTasks.map(task => [task.taskId, task.index]));
        const settleTask = async (task, status, result) => {
            const agentStatus = record.status.agents[task.index];
            agentStatus.status = status;
            agentStatus.result = cloneAgentResult(result);
            await this.persistTaskStatus(stateManager, batchIndex, task.taskId, status, result);
            await this.updateBatchStatus(record, stateManager);
        };
        const runTask = async (task) => {
            if (signal.aborted)
                return;
            const failedDependencyId = task.depends_on?.find(dependencyId => {
                const dependencyIndex = taskIndexById.get(dependencyId);
                if (dependencyIndex === undefined) {
                    return true;
                }
                const dependencyStatus = record.status.agents[dependencyIndex];
                return (dependencyStatus.status !== 'completed' || dependencyStatus.result?.status !== 'success');
            });
            if (failedDependencyId) {
                await settleTask(task, 'error', {
                    role: task.role,
                    subrole: task.subrole,
                    provider: 'unknown',
                    model: 'unknown',
                    status: 'error',
                    output: {
                        summary: `Prerequisite ${failedDependencyId} failed`,
                    },
                    duration: 0,
                });
                return;
            }
            const agentStatus = record.status.agents[task.index];
            try {
                let workDir;
                if (request.createWorktrees) {
                    agentStatus.status = 'dispatched';
                    await this.persistTaskStatus(stateManager, batchIndex, task.taskId, 'dispatched');
                    if (signal.aborted)
                        return;
                    const wt = await this.worktreeManager.create(task.taskId, sessionWorkBranch);
                    if (signal.aborted)
                        return;
                    workDir = wt.worktreePath;
                    await this.persistTaskUpdate(stateManager, batchIndex, task.taskId, {
                        worktree_path: wt.worktreePath,
                        worktree_branch: wt.branch,
                    });
                }
                if (signal.aborted)
                    return;
                agentStatus.status = 'running';
                await this.persistTaskStatus(stateManager, batchIndex, task.taskId, 'running');
                if (signal.aborted)
                    return;
                const result = await this.engine.dispatch({
                    role: task.role,
                    subrole: task.subrole,
                    taskContext: task.taskContext,
                    workDir,
                    sessionId: request.sessionId,
                    boundPipelineId: request.boundPipelineId,
                });
                if (signal.aborted)
                    return;
                if (result.status === 'success') {
                    await settleTask(task, 'completed', result);
                    return;
                }
                if (result.status === 'timeout') {
                    await settleTask(task, 'timeout', result);
                    return;
                }
                await settleTask(task, 'error', result);
            }
            catch (err) {
                await settleTask(task, 'error', {
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
                });
            }
        };
        try {
            const hasDependencies = scheduledTasks.some(task => (task.depends_on?.length ?? 0) > 0);
            if (hasDependencies) {
                const executionLayers = buildExecutionLayers(scheduledTasks);
                // Tasks still run with layer barriers; unblocking downstream layers per-task
                // is future work.
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
                await this.updateBatchStatus(record, stateManager);
            }
        }
        catch {
            if (record.status.status !== 'cancelled') {
                record.status.status = 'error';
                this.scheduleTerminalEviction(batchId);
                await this.persistBatchStatus(stateManager, batchIndex, 'error');
            }
        }
    }
}
function cloneAgentResult(result) {
    return {
        ...result,
        output: {
            ...result.output,
        },
    };
}
//# sourceMappingURL=batch-manager.js.map