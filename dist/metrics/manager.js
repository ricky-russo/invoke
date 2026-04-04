import { existsSync } from 'fs';
import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import path from 'path';
import { StateManager } from '../tools/state.js';
export class MetricsManager {
    projectDir;
    metricsPath;
    tmpPath;
    stateManager;
    beforeExitHandler;
    metrics = [];
    loaded = false;
    loadPromise = null;
    writeChain = Promise.resolve();
    constructor(projectDir) {
        this.projectDir = projectDir;
        this.metricsPath = path.join(projectDir, '.invoke', 'metrics.json');
        this.tmpPath = path.join(projectDir, '.invoke', 'metrics.json.tmp');
        this.stateManager = new StateManager(projectDir);
        this.beforeExitHandler = () => {
            void this.flushPendingWrites();
        };
        process.on('beforeExit', this.beforeExitHandler);
    }
    record(metric) {
        try {
            this.metrics.push(metric);
            this.queueFlush();
        }
        catch (error) {
            this.logWriteError(error);
        }
    }
    async getCurrentPipelineMetrics(opts) {
        await this.ensureLoaded();
        const state = await this.stateManager.get();
        const pipelineId = state?.pipeline_id ?? null;
        return this.metrics.filter(metric => {
            if (metric.pipeline_id !== pipelineId) {
                return false;
            }
            if (opts?.stage && metric.stage !== opts.stage) {
                return false;
            }
            return true;
        });
    }
    async getSummary(opts) {
        const metrics = await this.getCurrentPipelineMetrics(opts);
        const summary = {
            total_dispatches: metrics.length,
            total_prompt_chars: 0,
            total_duration_ms: 0,
            by_stage: {},
            by_provider_model: {},
        };
        for (const metric of metrics) {
            summary.total_prompt_chars += metric.prompt_size_chars;
            summary.total_duration_ms += metric.duration_ms;
            const stageEntry = summary.by_stage[metric.stage] ?? {
                dispatches: 0,
                duration_ms: 0,
                prompt_chars: 0,
            };
            stageEntry.dispatches += 1;
            stageEntry.duration_ms += metric.duration_ms;
            stageEntry.prompt_chars += metric.prompt_size_chars;
            summary.by_stage[metric.stage] = stageEntry;
            const providerModelKey = `${metric.provider}:${metric.model}`;
            const providerEntry = summary.by_provider_model[providerModelKey] ?? {
                dispatches: 0,
                duration_ms: 0,
                prompt_chars: 0,
            };
            providerEntry.dispatches += 1;
            providerEntry.duration_ms += metric.duration_ms;
            providerEntry.prompt_chars += metric.prompt_size_chars;
            summary.by_provider_model[providerModelKey] = providerEntry;
        }
        return summary;
    }
    async getLimitStatus(config) {
        const metrics = await this.getCurrentPipelineMetrics();
        const dispatchesUsed = metrics.length;
        const maxDispatches = config.settings.max_dispatches;
        return {
            dispatches_used: dispatchesUsed,
            max_dispatches: maxDispatches,
            at_limit: maxDispatches !== undefined ? dispatchesUsed >= maxDispatches : false,
        };
    }
    queueFlush() {
        this.writeChain = this.writeChain
            .then(async () => {
            await this.ensureLoaded();
            await this.writeAtomic(this.metrics);
        })
            .catch(error => {
            this.logWriteError(error);
        });
    }
    async flushPendingWrites() {
        try {
            await this.writeChain;
        }
        catch (error) {
            this.logWriteError(error);
        }
    }
    async ensureLoaded() {
        if (this.loaded) {
            return;
        }
        if (!this.loadPromise) {
            this.loadPromise = this.loadFromDisk().finally(() => {
                this.loadPromise = null;
            });
        }
        await this.loadPromise;
    }
    async loadFromDisk() {
        if (!existsSync(this.metricsPath)) {
            this.loaded = true;
            return;
        }
        const content = await readFile(this.metricsPath, 'utf-8');
        const parsed = JSON.parse(content);
        this.metrics = [...parsed, ...this.metrics];
        this.loaded = true;
    }
    async writeAtomic(metrics) {
        await mkdir(path.join(this.projectDir, '.invoke'), { recursive: true });
        const content = JSON.stringify(metrics, null, 2) + '\n';
        await writeFile(this.tmpPath, content);
        await rename(this.tmpPath, this.metricsPath);
    }
    logWriteError(error) {
        console.error(`Failed to write metrics: ${error instanceof Error ? error.message : String(error)}`);
    }
}
//# sourceMappingURL=manager.js.map