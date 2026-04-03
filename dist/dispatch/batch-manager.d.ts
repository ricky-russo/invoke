import type { DispatchEngine } from './engine.js';
import type { WorktreeManager } from '../worktree/manager.js';
import type { StateManager } from '../tools/state.js';
import type { BatchRequest, BatchStatus } from '../types.js';
export declare class BatchManager {
    private engine;
    private worktreeManager;
    private stateManager?;
    private batchIndex;
    private batches;
    constructor(engine: DispatchEngine, worktreeManager: WorktreeManager, stateManager?: StateManager | undefined, batchIndex?: number);
    dispatchBatch(request: BatchRequest): string;
    getStatus(batchId: string): BatchStatus | null;
    waitForStatus(batchId: string, waitSeconds: number): Promise<BatchStatus | null>;
    cancel(batchId: string): void;
    private persistTaskStatus;
    private runBatch;
}
//# sourceMappingURL=batch-manager.d.ts.map