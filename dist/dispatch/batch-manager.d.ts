import type { DispatchEngine } from './engine.js';
import type { WorktreeManager } from '../worktree/manager.js';
import type { StateManager } from '../tools/state.js';
import type { BatchRequest, BatchStatus, AgentStatus, AgentResult } from '../types.js';
interface BatchManagerOptions {
    terminalRetentionMs?: number;
}
type DispatchBatchOptions = {
    stateManager?: StateManager;
};
type BatchOwner = {
    kind: 'not_found';
} | {
    kind: 'unowned';
} | {
    kind: 'owned';
    sessionId: string;
};
export declare class BatchManager {
    private engine;
    private worktreeManager;
    private defaultStateManager?;
    private batches;
    private batchRegistrationQueue;
    private evictionTimers;
    private isShutdown;
    private readonly terminalRetentionMs;
    constructor(engine: DispatchEngine, worktreeManager: WorktreeManager, defaultStateManager?: StateManager | undefined, options?: BatchManagerOptions);
    dispatchBatch(request: BatchRequest, options?: DispatchBatchOptions): Promise<string>;
    private getPersistedBatchIndex;
    private enqueueBatchRegistration;
    getStatus(batchId: string): BatchStatus | null;
    getBatchOwner(batchId: string): BatchOwner;
    getTaskResult(batchId: string, taskId: string): {
        kind: 'batch_not_found';
    } | {
        kind: 'task_not_found';
    } | {
        kind: 'not_terminal';
        status: AgentStatus['status'];
    } | {
        kind: 'no_result';
    } | {
        kind: 'ok';
        result: AgentResult;
    };
    waitForStatus(batchId: string, waitSeconds: number): Promise<BatchStatus | null>;
    cancel(batchId: string): void;
    shutdown(): void;
    private isTerminalBatchStatus;
    private isTerminalAgentStatus;
    private computeBatchStatus;
    private toPersistedBatchStatus;
    private addPersistedBatch;
    private persistTaskUpdate;
    private persistBatchStatus;
    private updateBatchStatus;
    private createCancelledResult;
    private clearEvictionTimer;
    private scheduleTerminalEviction;
    private persistTaskStatus;
    private getTaskDependencies;
    private runLayer;
    private runBatch;
}
export {};
//# sourceMappingURL=batch-manager.d.ts.map