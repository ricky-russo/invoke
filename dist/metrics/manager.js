import { existsSync } from 'fs';
import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import path from 'path';
const COST_PRECISION = 1_000_000_000;
const FLUSH_DEBOUNCE_MS = 100;
export class MetricsManager {
    projectDir;
    metricsPath;
    tmpPath;
    beforeExitHandler;
    metrics = [];
    metricsByPipelineId = new Map();
    loaded = false;
    loadPromise = null;
    writeChain = Promise.resolve();
    flushTimeout = null;
    dirEnsured = false;
    beforeExitRegistered = false;
    constructor(projectDir, sessionDir) {
        this.projectDir = projectDir;
        const metricsDir = sessionDir ?? path.join(projectDir, '.invoke');
        this.metricsPath = path.join(metricsDir, 'metrics.json');
        this.tmpPath = path.join(metricsDir, 'metrics.json.tmp');
        this.beforeExitHandler = () => {
            void this.flushPendingWrites();
        };
    }
    record(metric) {
        try {
            this.ensureBeforeExitHandler();
            this.metrics.push(metric);
            this.indexMetric(metric);
            this.queueFlush();
        }
        catch (error) {
            this.logWriteError(error);
        }
    }
    async getMetricsByPipelineId(pipelineId, opts) {
        if (pipelineId == null) {
            return [];
        }
        await this.ensureLoaded();
        const bucket = this.metricsByPipelineId.get(pipelineId) ?? [];
        if (!opts?.stage) {
            return [...bucket];
        }
        return bucket.filter(metric => metric.stage === opts.stage);
    }
    async getSummaryByPipelineId(pipelineId, opts) {
        if (pipelineId == null) {
            return createEmptySummary();
        }
        const metrics = await this.getMetricsByPipelineId(pipelineId, opts);
        return this.summarize(metrics);
    }
    async getSummariesByPipelineIds(pipelineIds) {
        await this.ensureLoaded();
        const summaries = new Map();
        for (const pipelineId of new Set(pipelineIds)) {
            const summary = createEmptySummary();
            const bucket = this.metricsByPipelineId.get(pipelineId) ?? [];
            for (const metric of bucket) {
                accumulateMetric(summary, metric);
            }
            summaries.set(pipelineId, summary);
        }
        return summaries;
    }
    summarize(metrics) {
        const summary = createEmptySummary();
        for (const metric of metrics) {
            accumulateMetric(summary, metric);
        }
        return summary;
    }
    async getLimitStatus(config, pipelineId) {
        if (pipelineId == null) {
            return {
                dispatches_used: 0,
                max_dispatches: config.settings.max_dispatches,
                at_limit: false,
            };
        }
        await this.ensureLoaded();
        const dispatchesUsed = (this.metricsByPipelineId.get(pipelineId) ?? []).length;
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
        if (existsSync(this.metricsPath)) {
            const content = await readFile(this.metricsPath, 'utf-8');
            const parsed = JSON.parse(content);
            this.metrics = [...parsed, ...this.metrics];
        }
        this.rebuildIndex();
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
    ensureBeforeExitHandler() {
        if (this.beforeExitRegistered) {
            return;
        }
        process.on('beforeExit', this.beforeExitHandler);
        this.beforeExitRegistered = true;
    }
    indexMetric(metric) {
        const key = metric.pipeline_id ?? null;
        let bucket = this.metricsByPipelineId.get(key);
        if (!bucket) {
            bucket = [];
            this.metricsByPipelineId.set(key, bucket);
        }
        bucket.push(metric);
    }
    rebuildIndex() {
        this.metricsByPipelineId.clear();
        for (const metric of this.metrics) {
            this.indexMetric(metric);
        }
    }
}
function normalizeCost(value) {
    return Math.round(value * COST_PRECISION) / COST_PRECISION;
}
function createEmptySummaryBucket() {
    return {
        dispatches: 0,
        duration_ms: 0,
        prompt_chars: 0,
        estimated_cost_usd: 0,
    };
}
function accumulateMetric(summary, metric) {
    const cost = normalizeCost(metric.estimated_cost_usd ?? 0);
    summary.total_dispatches += 1;
    summary.total_prompt_chars += metric.prompt_size_chars;
    summary.total_duration_ms += metric.duration_ms;
    summary.total_estimated_cost_usd = normalizeCost(summary.total_estimated_cost_usd + cost);
    const stageEntry = summary.by_stage[metric.stage] ?? createEmptySummaryBucket();
    stageEntry.dispatches += 1;
    stageEntry.duration_ms += metric.duration_ms;
    stageEntry.prompt_chars += metric.prompt_size_chars;
    stageEntry.estimated_cost_usd = normalizeCost(stageEntry.estimated_cost_usd + cost);
    summary.by_stage[metric.stage] = stageEntry;
    const providerModelKey = `${metric.provider}:${metric.model}`;
    const providerEntry = summary.by_provider_model[providerModelKey] ?? createEmptySummaryBucket();
    providerEntry.dispatches += 1;
    providerEntry.duration_ms += metric.duration_ms;
    providerEntry.prompt_chars += metric.prompt_size_chars;
    providerEntry.estimated_cost_usd = normalizeCost(providerEntry.estimated_cost_usd + cost);
    summary.by_provider_model[providerModelKey] = providerEntry;
}
export function createEmptySummary() {
    return {
        total_dispatches: 0,
        total_prompt_chars: 0,
        total_duration_ms: 0,
        total_estimated_cost_usd: 0,
        by_stage: {},
        by_provider_model: {},
    };
}
//# sourceMappingURL=manager.js.map