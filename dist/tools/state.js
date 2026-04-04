import { readFile, writeFile, rename } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
export class StateManager {
    projectDir;
    statePath;
    tmpPath;
    constructor(projectDir) {
        this.projectDir = projectDir;
        this.statePath = path.join(projectDir, '.invoke', 'state.json');
        this.tmpPath = path.join(projectDir, '.invoke', 'state.json.tmp');
    }
    async get() {
        if (!existsSync(this.statePath)) {
            return null;
        }
        const content = await readFile(this.statePath, 'utf-8');
        return JSON.parse(content);
    }
    async initialize(pipelineId) {
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
    }
    async update(updates) {
        const current = await this.get();
        if (!current) {
            throw new Error('No active pipeline. Call initialize() first.');
        }
        const updated = { ...current, ...updates, last_updated: new Date().toISOString() };
        await this.writeAtomic(updated);
        return updated;
    }
    async addBatch(batch) {
        const current = await this.get();
        if (!current) {
            throw new Error('No active pipeline. Call initialize() first.');
        }
        current.batches.push(batch);
        current.last_updated = new Date().toISOString();
        await this.writeAtomic(current);
        return current;
    }
    async updateBatch(batchIndex, updates) {
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
    }
    async updateTask(batchIndex, taskId, updates) {
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
        if (existsSync(this.statePath)) {
            const { unlink } = await import('fs/promises');
            await unlink(this.statePath);
        }
    }
    async writeAtomic(state) {
        const content = JSON.stringify(state, null, 2) + '\n';
        await writeFile(this.tmpPath, content);
        await rename(this.tmpPath, this.statePath);
    }
}
//# sourceMappingURL=state.js.map