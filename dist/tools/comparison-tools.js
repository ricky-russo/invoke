import { z } from 'zod';
import { compareSessions, formatComparisonTable } from '../metrics/comparison.js';
import { createEmptySummary, MetricsManager } from '../metrics/manager.js';
import { StateManager } from './state.js';
export function registerComparisonTools(server, projectDir, sessionManager) {
    server.registerTool('invoke_compare_sessions', {
        description: 'Compare dispatch metrics across two or more pipeline sessions.',
        inputSchema: z.object({
            session_ids: z
                .array(z.string())
                .min(2)
                .describe('Two or more session IDs to compare'),
        }),
    }, async ({ session_ids }) => {
        try {
            const metricsManager = new MetricsManager(projectDir);
            const sessionMetrics = new Map();
            const sessionSummaries = new Map();
            const sessionPipelineBindings = await Promise.all(session_ids.map(async (sessionId) => {
                const sessionDir = sessionManager.resolve(sessionId);
                const state = await new StateManager(projectDir, sessionDir).get();
                return {
                    sessionId,
                    pipelineId: state?.pipeline_id ?? null,
                };
            }));
            const summariesByPipelineId = await metricsManager.getSummariesByPipelineIds(sessionPipelineBindings.flatMap(({ pipelineId }) => (pipelineId ? [pipelineId] : [])));
            const metricsBySession = await Promise.all(sessionPipelineBindings.map(async ({ sessionId, pipelineId }) => ({
                sessionId,
                pipelineId,
                metrics: pipelineId
                    ? await metricsManager.getMetricsByPipelineId(pipelineId)
                    : [],
            })));
            for (const { sessionId, pipelineId, metrics } of metricsBySession) {
                sessionMetrics.set(sessionId, metrics);
                sessionSummaries.set(sessionId, pipelineId ? summariesByPipelineId.get(pipelineId) ?? createEmptySummary() : createEmptySummary());
            }
            return {
                content: [{
                        type: 'text',
                        text: formatComparisonTable(compareSessions(sessionMetrics, sessionSummaries)),
                    }],
            };
        }
        catch (err) {
            return {
                content: [{ type: 'text', text: `Comparison error: ${err instanceof Error ? err.message : String(err)}` }],
                isError: true,
            };
        }
    });
}
//# sourceMappingURL=comparison-tools.js.map