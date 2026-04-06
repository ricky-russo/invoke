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
    /**
     * Apply a composite state update inside a single atomic write.
     *
     * Ordering (load-bearing):
     *   1. batchUpdate (upsert by id)
     *   2. reviewCycleUpdate (upsert by id)
     *   3. partial spread (top-level field replacement)
     *
     * The partial spread is applied last so callers can use
     * `partial.batches` or `partial.review_cycles` to fully replace the
     * upsert results. Invoke-resume redo paths rely on this contract,
     * including clearing batches with `partial.batches: []` (BUG-001).
     *
     * Trade-off: if a caller passes both `batch_update` and
     * `partial.batches`, the array replacement silently clobbers the
     * upserted result. This is intentional per the BUG-001 spec; the
     * cycle-1 mutex rejection was a regression that was reverted in
     * cycle 2 R1. See state-tools.ts for the soft warning that logs when
     * callers send both forms together.
     */
    applyComposite(updates: {
        batchUpdate?: BatchState;
        reviewCycleUpdate?: ReviewCycle;
        partial?: Partial<PipelineState>;
    }): Promise<PipelineState>;
    updateBatch(batchIndex: number, updates: Partial<BatchState>): Promise<PipelineState>;
    updateTask(batchIndex: number, taskId: string, updates: Partial<TaskState>): Promise<PipelineState>;
    getReviewCycleCount(batchId?: number): Promise<number>;
    reset(): Promise<void>;
    private enqueueWrite;
    private writeAtomic;
    private applyBatchUpsert;
    private applyReviewCycleUpsert;
}
//# sourceMappingURL=state.d.ts.map