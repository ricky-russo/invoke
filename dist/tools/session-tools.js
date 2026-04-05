import { z } from 'zod';
import { loadConfig } from '../config.js';
import { MetricsManager } from '../metrics/manager.js';
const DEFAULT_STALE_SESSION_DAYS = 7;
export function registerSessionTools(server, sessionManager, projectDir) {
    server.registerTool('invoke_list_sessions', {
        description: 'List all pipeline sessions.',
        inputSchema: z.object({
            withMetrics: z
                .boolean()
                .optional()
                .describe('Include dispatch count, duration, and estimated cost per session'),
        }),
    }, async ({ withMetrics }) => {
        try {
            const sessions = await getSessionsWithStatus(sessionManager, projectDir);
            const responseSessions = withMetrics
                ? await addSessionMetricsSummaries(sessions, sessionManager, projectDir)
                : sessions;
            return {
                content: [{ type: 'text', text: JSON.stringify(responseSessions, null, 2) }],
            };
        }
        catch (err) {
            return {
                content: [{ type: 'text', text: `Session error: ${err instanceof Error ? err.message : String(err)}` }],
                isError: true,
            };
        }
    });
    server.registerTool('invoke_cleanup_sessions', {
        description: 'Remove completed or stale pipeline sessions.',
        inputSchema: z.object({
            session_id: z.string().optional(),
            status_filter: z.enum(['complete', 'stale', 'all']).optional(),
        }),
    }, async ({ session_id, status_filter }) => {
        try {
            if (session_id) {
                if (!sessionManager.exists(session_id)) {
                    throw new Error(`Session '${session_id}' does not exist`);
                }
                await sessionManager.cleanup(session_id);
                return {
                    content: [{ type: 'text', text: JSON.stringify([session_id], null, 2) }],
                };
            }
            const sessions = await getSessionsWithStatus(sessionManager, projectDir);
            const filter = status_filter ?? 'complete';
            const cleanedSessionIds = [];
            for (const session of sessions) {
                if (!matchesCleanupFilter(session, filter)) {
                    continue;
                }
                await sessionManager.cleanup(session.session_id);
                cleanedSessionIds.push(session.session_id);
            }
            return {
                content: [{ type: 'text', text: JSON.stringify(cleanedSessionIds, null, 2) }],
            };
        }
        catch (err) {
            return {
                content: [{ type: 'text', text: `Session error: ${err instanceof Error ? err.message : String(err)}` }],
                isError: true,
            };
        }
    });
}
async function getSessionsWithStatus(sessionManager, projectDir) {
    const staleSessionDays = await getStaleSessionDays(projectDir);
    return sessionManager.list(staleSessionDays);
}
async function addSessionMetricsSummaries(sessions, sessionManager, projectDir) {
    return Promise.all(sessions.map(async (session) => ({
        ...session,
        metrics_summary: await getSessionMetricsSummary(session.session_id, sessionManager, projectDir),
    })));
}
async function getSessionMetricsSummary(sessionId, sessionManager, projectDir) {
    const metricsManager = new MetricsManager(projectDir, sessionManager.resolve(sessionId));
    const summary = await metricsManager.getSummary();
    return {
        total_dispatches: summary.total_dispatches,
        total_duration_ms: summary.total_duration_ms,
        total_estimated_cost_usd: summary.total_estimated_cost_usd,
    };
}
async function getStaleSessionDays(projectDir) {
    try {
        const config = await loadConfig(projectDir);
        return config.settings.stale_session_days ?? DEFAULT_STALE_SESSION_DAYS;
    }
    catch {
        return DEFAULT_STALE_SESSION_DAYS;
    }
}
function matchesCleanupFilter(session, filter) {
    switch (filter) {
        case 'complete':
            return session.status === 'complete';
        case 'stale':
            return session.status === 'stale';
        case 'all':
            return session.status !== 'active';
    }
}
//# sourceMappingURL=session-tools.js.map