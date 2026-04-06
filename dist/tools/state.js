import { mkdir, readFile, writeFile, rename } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
export class StateManager {
    statePath;
    tmpPath;
    storageDir;
    dirEnsured = false;
    writeQueue = Promise.resolve();
    constructor(projectDir, sessionDir) {
        this.storageDir = sessionDir ?? path.join(projectDir, '.invoke');
        this.statePath = path.join(this.storageDir, 'state.json');
        this.tmpPath = path.join(this.storageDir, 'state.json.tmp');
    }
    async get() {
        if (!existsSync(this.statePath)) {
            return null;
        }
        const content = await readFile(this.statePath, 'utf-8');
        return JSON.parse(content);
    }
    async initialize(pipelineId) {
        return this.enqueueWrite(async () => {
            const now = new Date().toISOString();
            const state = {
                pipeline_id: pipelineId,
                started: now,
                last_updated: now,
                current_stage: 'scope',
                batches: [],
                review_cycles: [],
            };
            await this.writeAtomic(state);
            return state;
        });
    }
    async update(updates) {
        return this.applyComposite({ partial: updates });
    }
    async addBatch(batch) {
        return this.enqueueWrite(async () => {
            const current = await this.get();
            if (!current) {
                throw new Error('No active pipeline. Call initialize() first.');
            }
            current.batches.push(batch);
            current.last_updated = new Date().toISOString();
            await this.writeAtomic(current);
            return current;
        });
    }
    async batchUpsert(batch) {
        return this.applyComposite({ batchUpdate: batch });
    }
    async applyComposite(updates) {
        return this.enqueueWrite(async () => {
            const current = await this.get();
            if (!current) {
                throw new Error('No active pipeline. Call initialize() first.');
            }
            let next = { ...current };
            if (updates.batchUpdate) {
                this.applyBatchUpsert(next, updates.batchUpdate);
            }
            if (updates.reviewCycleUpdate) {
                this.applyReviewCycleUpsert(next, updates.reviewCycleUpdate);
            }
            if (updates.partial) {
                next = { ...next, ...updates.partial };
            }
            next.last_updated = new Date().toISOString();
            await this.writeAtomic(next);
            return next;
        });
    }
    async updateBatch(batchIndex, updates) {
        return this.enqueueWrite(async () => {
            const current = await this.get();
            if (!current) {
                throw new Error('No active pipeline. Call initialize() first.');
            }
            if (batchIndex >= current.batches.length) {
                throw new Error(`Batch index ${batchIndex} out of range (${current.batches.length} batches)`);
            }
            current.batches[batchIndex] = { ...current.batches[batchIndex], ...updates };
            current.last_updated = new Date().toISOString();
            await this.writeAtomic(current);
            return current;
        });
    }
    async updateTask(batchIndex, taskId, updates) {
        return this.enqueueWrite(async () => {
            const current = await this.get();
            if (!current) {
                throw new Error('No active pipeline. Call initialize() first.');
            }
            if (batchIndex >= current.batches.length) {
                throw new Error(`Batch index ${batchIndex} out of range (${current.batches.length} batches)`);
            }
            const task = current.batches[batchIndex].tasks.find(t => t.id === taskId);
            if (!task) {
                throw new Error(`Task '${taskId}' not found in batch ${batchIndex}`);
            }
            Object.assign(task, updates);
            current.last_updated = new Date().toISOString();
            await this.writeAtomic(current);
            return current;
        });
    }
    async reviewCycleUpsert(cycle) {
        return this.applyComposite({ reviewCycleUpdate: cycle });
    }
    async getReviewCycleCount(batchId) {
        const state = await this.get();
        if (!state)
            return 0;
        if (batchId !== undefined) {
            return state.review_cycles.filter(rc => rc.batch_id === batchId).length;
        }
        return state.review_cycles.length;
    }
    async reset() {
        await this.enqueueWrite(async () => {
            if (existsSync(this.statePath)) {
                const { unlink } = await import('fs/promises');
                await unlink(this.statePath);
            }
        });
    }
    enqueueWrite(operation) {
        const queuedOperation = this.writeQueue.then(operation);
        this.writeQueue = queuedOperation.then(() => undefined, () => undefined);
        return queuedOperation;
    }
    async writeAtomic(state) {
        if (!this.dirEnsured) {
            await mkdir(this.storageDir, { recursive: true });
            this.dirEnsured = true;
        }
        const content = JSON.stringify(state, null, 2) + '\n';
        await writeFile(this.tmpPath, content);
        await rename(this.tmpPath, this.statePath);
    }
    applyBatchUpsert(state, batch) {
        const batches = [...state.batches];
        const existingIndex = batches.findIndex(existingBatch => existingBatch.id === batch.id);
        if (existingIndex >= 0) {
            batches[existingIndex] = { ...batches[existingIndex], ...batch };
        }
        else {
            batches.push(batch);
        }
        state.batches = batches;
    }
    applyReviewCycleUpsert(state, cycle) {
        const reviewCycles = [...state.review_cycles];
        const existingIndex = reviewCycles.findIndex(existingCycle => existingCycle.id === cycle.id);
        if (existingIndex >= 0) {
            reviewCycles[existingIndex] = {
                ...reviewCycles[existingIndex],
                ...cycle,
            };
        }
        else {
            reviewCycles.push(cycle);
        }
        state.review_cycles = reviewCycles;
    }
}
//# sourceMappingURL=state.js.map