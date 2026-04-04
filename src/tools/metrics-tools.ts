import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { loadConfig } from '../config.js'
import type { MetricsManager } from '../metrics/manager.js'

export function registerMetricsTools(
  server: McpServer,
  metricsManager: MetricsManager,
  projectDir: string
): void {
  server.registerTool(
    'invoke_get_metrics',
    {
      description: 'Get dispatch metrics, summary totals, and pipeline dispatch limit status.',
      inputSchema: z.object({
        stage: z.string().optional().describe('Optional stage filter (e.g. build, review)'),
      }),
    },
    async ({ stage }) => {
      const options = { stage }

      try {
        const entries = await metricsManager.getCurrentPipelineMetrics(options)
        const summary = await metricsManager.getSummary(options)

        let limits: { dispatches_used: number; max_dispatches?: number; at_limit: boolean }

        try {
          const config = await loadConfig(projectDir)
          limits = await metricsManager.getLimitStatus(config)
        } catch {
          const pipelineEntries = await metricsManager.getCurrentPipelineMetrics()
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
