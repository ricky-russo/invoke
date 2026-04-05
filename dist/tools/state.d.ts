import type { PipelineState, BatchState, TaskState } from '../types.js';
export declare class StateManager {
    private statePath;
    private tmpPath;
    private storageDir;
    constructor(projectDir: string, sessionDir?: string);
    get(): Promise<PipelineState | null>;
    initialize(pipelineId: string): Promise<PipelineState>;
    update(updates: Partial<PipelineState>): Promise<PipelineState>;
    addBatch(batch: BatchState): Promise<PipelineState>;
    updateBatch(batchIndex: number, updates: Partial<BatchState>): Promise<PipelineState>;
    updateTask(batchIndex: number, taskId: string, updates: Partial<TaskState>): Promise<PipelineState>;
    getReviewCycleCount(batchId?: number): Promise<number>;
    reset(): Promise<void>;
    private writeAtomic;
}
//# sourceMappingURL=state.d.ts.map