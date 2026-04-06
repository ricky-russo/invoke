import type { MetricsManager } from '../metrics/manager.js';
import type { DispatchMetric } from '../types.js';
type SessionMetricsOptions = {
    stage?: string;
};
type SessionMetricsReader = Pick<MetricsManager, 'getMetricsByPipelineId'>;
export declare function getSessionScopedMetrics(metricsManager: SessionMetricsReader, pipelineId: string | null, sessionDir: string, options?: SessionMetricsOptions): Promise<DispatchMetric[]>;
export {};
//# sourceMappingURL=session-metrics.d.ts.map