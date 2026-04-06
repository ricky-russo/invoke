import type { PipelineState, BatchState, ReviewCycle, TaskState } from '../types.js';
export declare class StateManager {
    private statePath;
    private tmpPath;
    private storageDir;
    private dirEnsured;
    private writeQueue;
    constructor(projectDir: string, sessionDir?: string);
    get(): Promise<PipelineState | null>;
    initialize(pipelineId: string): Promise<PipelineState>;
    update(updates: Partial<PipelineState>): Promise<PipelineState>;
    addBatch(batch: BatchState): Promise<PipelineState>;
    batchUpsert(batch: BatchState): Promise<PipelineState>;
    applyComposite(updates: {
        batchUpdate?: BatchState;
        reviewCycleUpdate?: ReviewCycle;
        partial?: Partial<PipelineState>;
    }): Promise<PipelineState>;
    updateBatch(batchIndex: number, updates: Partial<BatchState>): Promise<PipelineState>;
    updateTask(batchIndex: number, taskId: string, updates: Partial<TaskState>): Promise<PipelineState>;
    reviewCycleUpsert(cycle: ReviewCycle): Promise<PipelineState>;
    getReviewCycleCount(batchId?: number): Promise<number>;
    reset(): Promise<void>;
    private enqueueWrite;
    private writeAtomic;
    private applyBatchUpsert;
    private applyReviewCycleUpsert;
}
//# sourceMappingURL=state.d.ts.map