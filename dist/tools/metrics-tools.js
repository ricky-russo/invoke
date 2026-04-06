import { z } from 'zod';
import { loadConfig } from '../config.js';
import { createEmptySummary } from '../metrics/manager.js';
import { StateManager } from './state.js';
export function registerMetricsTools(server, metricsManager, projectDir, sessionManager) {
    server.registerTool('invoke_get_metrics', {
        description: 'Get dispatch metrics, summary totals, and pipeline dispatch limit status.',
        inputSchema: z.object({
            stage: z.string().optional().describe('Optional stage filter (e.g. build, review)'),
            session_id: z.string().optional().describe('Optional session id for session-scoped metrics'),
        }),
    }, async ({ stage, session_id }) => {
        try {
            let pipelineId = null;
            if (session_id) {
                if (!sessionManager) {
                    throw new Error('Session manager is required for session-scoped metrics');
                }
                // Session-scoped metrics read pipeline_id from session state and rely on
                // the state layer to preserve that binding once initialized.
                const sessionStateManager = new StateManager(projectDir, sessionManager.resolve(session_id));
                const sessionState = await sessionStateManager.get();
                pipelineId = sessionState?.pipeline_id ?? null;
                if (!pipelineId) {
                    return {
                        content: [{
                                type: 'text',
                                text: JSON.stringify(createMetricsResponse([], createEmptySummary(), {
                                    dispatches_used: 0,
                                    at_limit: false,
                                }), null, 2),
                            }],
                    };
                }
            }
            const pipelineEntries = await metricsManager.getMetricsByPipelineId(pipelineId);
            const entries = filterEntriesByStage(pipelineEntries, stage);
            const summary = metricsManager.summarize(entries);
            let limits;
            try {
                const config = await loadConfig(projectDir);
                limits = createLimitStatus(pipelineEntries.length, config.settings.max_dispatches);
            }
            catch {
                limits = {
                    dispatches_used: pipelineEntries.length,
                    at_limit: false,
                };
            }
            return {
                content: [{ type: 'text', text: JSON.stringify(createMetricsResponse(entries, summary, limits), null, 2) }],
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
function createMetricsResponse(entries, summary, limits) {
    return { entries, summary, limits };
}
function filterEntriesByStage(entries, stage) {
    if (!stage) {
        return [...entries];
    }
    return entries.filter(entry => entry.stage === stage);
}
function createLimitStatus(dispatchesUsed, maxDispatches) {
    return {
        dispatches_used: dispatchesUsed,
        max_dispatches: maxDispatches,
        at_limit: maxDispatches !== undefined ? dispatchesUsed >= maxDispatches : false,
    };
}
//# sourceMappingURL=metrics-tools.js.map