import type { DispatchMetric, InvokeConfig, MetricsSummary } from '../types.js';
export declare class MetricsManager {
    private readonly projectDir;
    private readonly metricsPath;
    private readonly tmpPath;
    private readonly beforeExitHandler;
    private metrics;
    private metricsByPipelineId;
    private loaded;
    private loadPromise;
    private writeChain;
    private flushTimeout;
    private dirEnsured;
    private beforeExitRegistered;
    constructor(projectDir: string, sessionDir?: string);
    record(metric: DispatchMetric): void;
    getMetricsByPipelineId(pipelineId: string | null, opts?: {
        stage?: string;
    }): Promise<DispatchMetric[]>;
    getSummaryByPipelineId(pipelineId: string | null, opts?: {
        stage?: string;
    }): Promise<MetricsSummary>;
    getSummariesByPipelineIds(pipelineIds: string[]): Promise<Map<string, MetricsSummary>>;
    summarize(metrics: DispatchMetric[]): MetricsSummary;
    getLimitStatus(config: InvokeConfig, pipelineId: string | null): Promise<{
        dispatches_used: number;
        max_dispatches?: number;
        at_limit: boolean;
    }>;
    private queueFlush;
    private enqueueFlush;
    private flushPendingWrites;
    private ensureLoaded;
    private loadFromDisk;
    private writeAtomic;
    private logWriteError;
    private ensureBeforeExitHandler;
    private indexMetric;
    private rebuildIndex;
}
export declare function createEmptySummary(): MetricsSummary;
//# sourceMappingURL=manager.d.ts.map