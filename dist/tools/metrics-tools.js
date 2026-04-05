import path from 'path';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import { MetricsManager } from '../metrics/manager.js';
const sessionMetricsCache = new Map();
export function registerMetricsTools(server, metricsManager, projectDir) {
    server.registerTool('invoke_get_metrics', {
        description: 'Get dispatch metrics, summary totals, and pipeline dispatch limit status.',
        inputSchema: z.object({
            stage: z.string().optional().describe('Optional stage filter (e.g. build, review)'),
            session_id: z.string().optional().describe('Optional session id for session-scoped metrics'),
        }),
    }, async ({ stage, session_id }) => {
        let activeMetricsManager = metricsManager;
        if (session_id) {
            if (!sessionMetricsCache.has(session_id)) {
                sessionMetricsCache.set(session_id, new MetricsManager(projectDir, path.join(projectDir, '.invoke', 'sessions', session_id)));
            }
            activeMetricsManager = sessionMetricsCache.get(session_id);
        }
        const options = { stage };
        try {
            const entries = await activeMetricsManager.getCurrentPipelineMetrics(options);
            const summary = await activeMetricsManager.getSummary(options);
            let limits;
            try {
                const config = await loadConfig(projectDir);
                limits = await activeMetricsManager.getLimitStatus(config);
            }
            catch {
                const pipelineEntries = await activeMetricsManager.getCurrentPipelineMetrics();
                limits = {
                    dispatches_used: pipelineEntries.length,
                    at_limit: false,
                };
            }
            return {
                content: [{ type: 'text', text: JSON.stringify({ entries, summary, limits }, null, 2) }],
            };
        }
        catch (err) {
            return {
                content: [{ type: 'text', text: `Metrics error: ${err instanceof Error ? err.message : String(err)}` }],
                isError: true,
            };
        }
    });
}
//# sourceMappingURL=metrics-tools.js.map