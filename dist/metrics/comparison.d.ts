import type { DispatchMetric, MetricsSummary, SessionComparison } from '../types.js';
export declare function compareSessions(sessionMetrics: Map<string, DispatchMetric[]>, sessionSummaries?: Map<string, MetricsSummary>): SessionComparison;
export declare function formatComparisonTable(comparison: SessionComparison): string;
//# sourceMappingURL=comparison.d.ts.map