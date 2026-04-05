import { z } from 'zod';
import { compareSessions, formatComparisonTable } from '../metrics/comparison.js';
import { MetricsManager } from '../metrics/manager.js';
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
            const sessionMetrics = new Map();
            for (const sessionId of session_ids) {
                const sessionDir = sessionManager.resolve(sessionId);
                const metricsManager = new MetricsManager(projectDir, sessionDir);
                sessionMetrics.set(sessionId, await metricsManager.getCurrentPipelineMetrics());
            }
            return {
                content: [{ type: 'text', text: formatComparisonTable(compareSessions(sessionMetrics)) }],
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