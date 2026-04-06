import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { loadConfig } from '../config.js'
import { createEmptySummary, MetricsManager } from '../metrics/manager.js'
import type { SessionManager } from '../session/manager.js'
import type { DispatchMetric, MetricsSummary } from '../types.js'
import { StateManager } from './state.js'

type MetricsLimits = { dispatches_used: number; max_dispatches?: number; at_limit: boolean }

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
      let pipelineId: string | null = null

      if (session_id) {
        if (!sessionManager) {
          throw new Error('Session manager is required for session-scoped metrics')
        }

        // Session-scoped metrics read pipeline_id from session state and rely on
        // the state layer to preserve that binding once initialized.
        const sessionStateManager = new StateManager(projectDir, sessionManager.resolve(session_id))
        const sessionState = await sessionStateManager.get()
        pipelineId = sessionState?.pipeline_id ?? null

        if (!pipelineId) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(
                createMetricsResponse(
                  [],
                  createEmptySummary(),
                  {
                    dispatches_used: 0,
                    at_limit: false,
                  }
                ),
                null,
                2
              ),
            }],
          }
        }
      }

      try {
        const pipelineEntries = await metricsManager.getMetricsByPipelineId(pipelineId)
        const entries = filterEntriesByStage(pipelineEntries, stage)
        const summary = metricsManager.summarize(entries)

        let limits: { dispatches_used: number; max_dispatches?: number; at_limit: boolean }

        try {
          const config = await loadConfig(projectDir)
          limits = createLimitStatus(
            pipelineEntries.length,
            config.settings.max_dispatches
          )
        } catch {
          limits = {
            dispatches_used: pipelineEntries.length,
            at_limit: false,
          }
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(createMetricsResponse(entries, summary, limits), null, 2) }],
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

function createMetricsResponse(
  entries: unknown[],
  summary: MetricsSummary,
  limits: MetricsLimits
): {
  entries: unknown[]
  summary: MetricsSummary
  limits: MetricsLimits
} {
  return { entries, summary, limits }
}

function filterEntriesByStage(
  entries: DispatchMetric[],
  stage?: string
): DispatchMetric[] {
  if (!stage) {
    return [...entries]
  }

  return entries.filter(entry => entry.stage === stage)
}

function createLimitStatus(
  dispatchesUsed: number,
  maxDispatches?: number
): MetricsLimits {
  return {
    dispatches_used: dispatchesUsed,
    max_dispatches: maxDispatches,
    at_limit: maxDispatches !== undefined ? dispatchesUsed >= maxDispatches : false,
  }
}
