import type { DispatchMetric, InvokeConfig, MetricsSummary } from '../types.js';
export declare class MetricsManager {
    private readonly projectDir;
    private readonly metricsPath;
    private readonly tmpPath;
    private readonly stateManager;
    private readonly beforeExitHandler;
    private metrics;
    private loaded;
    private loadPromise;
    private writeChain;
    constructor(projectDir: string);
    record(metric: DispatchMetric): void;
    getCurrentPipelineMetrics(opts?: {
        stage?: string;
    }): Promise<DispatchMetric[]>;
    getSummary(opts?: {
        stage?: string;
    }): Promise<MetricsSummary>;
    getLimitStatus(config: InvokeConfig): Promise<{
        dispatches_used: number;
        max_dispatches?: number;
        at_limit: boolean;
    }>;
    private queueFlush;
    private flushPendingWrites;
    private ensureLoaded;
    private loadFromDisk;
    private writeAtomic;
    private logWriteError;
}
//# sourceMappingURL=manager.d.ts.map