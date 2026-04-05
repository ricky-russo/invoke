import { existsSync } from 'fs';
import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import path from 'path';
import { StateManager } from '../tools/state.js';
const COST_PRECISION = 1_000_000_000;
const FLUSH_DEBOUNCE_MS = 100;
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
    flushTimeout = null;
    dirEnsured = false;
    constructor(projectDir, sessionDir) {
        this.projectDir = projectDir;
        const metricsDir = sessionDir ?? path.join(projectDir, '.invoke');
        this.metricsPath = path.join(metricsDir, 'metrics.json');
        this.tmpPath = path.join(metricsDir, 'metrics.json.tmp');
        this.stateManager = new StateManager(projectDir, sessionDir);
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
            total_estimated_cost_usd: 0,
            by_stage: {},
            by_provider_model: {},
        };
        for (const metric of metrics) {
            const cost = normalizeCost(metric.estimated_cost_usd ?? 0);
            summary.total_prompt_chars += metric.prompt_size_chars;
            summary.total_duration_ms += metric.duration_ms;
            summary.total_estimated_cost_usd = normalizeCost(summary.total_estimated_cost_usd + cost);
            const stageEntry = summary.by_stage[metric.stage] ?? {
                dispatches: 0,
                duration_ms: 0,
                prompt_chars: 0,
                estimated_cost_usd: 0,
            };
            stageEntry.dispatches += 1;
            stageEntry.duration_ms += metric.duration_ms;
            stageEntry.prompt_chars += metric.prompt_size_chars;
            stageEntry.estimated_cost_usd = normalizeCost(stageEntry.estimated_cost_usd + cost);
            summary.by_stage[metric.stage] = stageEntry;
            const providerModelKey = `${metric.provider}:${metric.model}`;
            const providerEntry = summary.by_provider_model[providerModelKey] ?? {
                dispatches: 0,
                duration_ms: 0,
                prompt_chars: 0,
                estimated_cost_usd: 0,
            };
            providerEntry.dispatches += 1;
            providerEntry.duration_ms += metric.duration_ms;
            providerEntry.prompt_chars += metric.prompt_size_chars;
            providerEntry.estimated_cost_usd = normalizeCost(providerEntry.estimated_cost_usd + cost);
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
        if (this.flushTimeout) {
            clearTimeout(this.flushTimeout);
        }
        this.flushTimeout = setTimeout(() => {
            this.flushTimeout = null;
            this.enqueueFlush();
        }, FLUSH_DEBOUNCE_MS);
    }
    enqueueFlush() {
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
        if (this.flushTimeout) {
            clearTimeout(this.flushTimeout);
            this.flushTimeout = null;
            this.enqueueFlush();
        }
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
        if (!this.dirEnsured) {
            await mkdir(path.dirname(this.metricsPath), { recursive: true });
            this.dirEnsured = true;
        }
        const content = JSON.stringify(metrics, null, 2) + '\n';
        await writeFile(this.tmpPath, content);
        await rename(this.tmpPath, this.metricsPath);
    }
    logWriteError(error) {
        console.error(`Failed to write metrics: ${error instanceof Error ? error.message : String(error)}`);
    }
}
function normalizeCost(value) {
    return Math.round(value * COST_PRECISION) / COST_PRECISION;
}
//# sourceMappingURL=manager.js.map