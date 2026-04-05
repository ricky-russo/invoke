import type { DispatchEngine } from './engine.js';
import type { WorktreeManager } from '../worktree/manager.js';
import type { StateManager } from '../tools/state.js';
import type { BatchRequest, BatchStatus } from '../types.js';
export declare class BatchManager {
    private engine;
    private worktreeManager;
    private stateManager?;
    private batches;
    constructor(engine: DispatchEngine, worktreeManager: WorktreeManager, stateManager?: StateManager | undefined);
    dispatchBatch(request: BatchRequest): Promise<string>;
    private getPersistedBatchIndex;
    getStatus(batchId: string): BatchStatus | null;
    waitForStatus(batchId: string, waitSeconds: number): Promise<BatchStatus | null>;
    cancel(batchId: string): void;
    private isTerminalBatchStatus;
    private isTerminalAgentStatus;
    private computeBatchStatus;
    private persistBatchStatus;
    private updateBatchStatus;
    private persistTaskStatus;
    private getTaskDependencies;
    private runLayer;
    private runBatch;
}
//# sourceMappingURL=batch-manager.d.ts.map