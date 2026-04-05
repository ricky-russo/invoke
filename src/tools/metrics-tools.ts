import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { loadConfig } from '../config.js'
import { MetricsManager } from '../metrics/manager.js'
import type { SessionManager } from '../session/manager.js'

const sessionMetricsCache = new Map<string, MetricsManager>()

export function registerMetricsTools(
  server: McpServer,
  metricsManager: MetricsManager,
  projectDir: string,
  sessionManager?: SessionManager
): void {
  server.registerTool(
    'invoke_get_metrics',
    {
      description: 'Get dispatch metrics, summary totals, and pipeline dispatch limit status.',
      inputSchema: z.object({
        stage: z.string().optional().describe('Optional stage filter (e.g. build, review)'),
        session_id: z.string().optional().describe('Optional session id for session-scoped metrics'),
      }),
    },
    async ({ stage, session_id }) => {
      let activeMetricsManager = metricsManager
      if (session_id) {
        if (!sessionManager) {
          throw new Error('Session manager is required for session-scoped metrics')
        }

        if (!sessionMetricsCache.has(session_id)) {
          sessionMetricsCache.set(
            session_id,
            new MetricsManager(projectDir, sessionManager.resolve(session_id))
          )
        }
        activeMetricsManager = sessionMetricsCache.get(session_id)!
      }
      const options = { stage }

      try {
        const entries = await activeMetricsManager.getCurrentPipelineMetrics(options)
        const summary = await activeMetricsManager.getSummary(options)

        let limits: { dispatches_used: number; max_dispatches?: number; at_limit: boolean }

        try {
          const config = await loadConfig(projectDir)
          limits = await activeMetricsManager.getLimitStatus(config)
        } catch {
          const pipelineEntries = await activeMetricsManager.getCurrentPipelineMetrics()
          limits = {
            dispatches_used: pipelineEntries.length,
            at_limit: false,
          }
        }

        return {
          content: [{ type: 'text', text: JSON.stringify({ entries, summary, limits }, null, 2) }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Metrics error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    }
  )
}
