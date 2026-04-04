import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { loadConfig } from '../config.js'
import type { StateManager } from './state.js'

export function registerStateTools(server: McpServer, stateManager: StateManager, projectDir: string): void {
  server.registerTool(
    'invoke_get_state',
    {
      description: 'Get the current pipeline state.',
      inputSchema: z.object({}),
    },
    async () => {
      const state = await stateManager.get()
      return {
        content: [{ type: 'text', text: JSON.stringify(state, null, 2) }],
      }
    }
  )

  server.registerTool(
    'invoke_set_state',
    {
      description: 'Update pipeline state fields. Pass only the fields to update. Supports nested batches and review_cycles.',
      inputSchema: z.object({
        pipeline_id: z.string().optional(),
        current_stage: z.enum(['scope', 'plan', 'orchestrate', 'build', 'review', 'complete']).optional(),
        work_branch: z.string().optional(),
        spec: z.string().optional(),
        plan: z.string().optional(),
        strategy: z.string().optional(),
        batches: z.array(z.object({
          id: z.number(),
          status: z.enum(['pending', 'in_progress', 'completed', 'error']),
          tasks: z.array(z.object({
            id: z.string(),
            status: z.enum(['pending', 'dispatched', 'running', 'completed', 'error', 'timeout']),
            worktree_path: z.string().optional(),
            worktree_branch: z.string().optional(),
            result_summary: z.string().optional(),
            result_status: z.enum(['success', 'error', 'timeout']).optional(),
          })),
        })).optional(),
        review_cycles: z.array(z.object({
          id: z.number(),
          reviewers: z.array(z.string()),
          findings: z.array(z.any()),
          batch_id: z.number().optional(),
          scope: z.enum(['batch', 'final']).optional(),
          triaged: z.object({
            accepted: z.array(z.any()),
            dismissed: z.array(z.any()),
          }).optional(),
        })).optional(),
      }),
    },
    async (updates) => {
      try {
        let state = await stateManager.get()
        if (!state) {
          state = await stateManager.initialize(updates.pipeline_id ?? `pipeline-${Date.now()}`)
        }
        const updated = await stateManager.update(updates)
        return {
          content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `State error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    }
  )

  server.registerTool(
    'invoke_get_review_cycle_count',
    {
      description: 'Get the number of recorded review cycles, optionally filtered to a batch, plus the configured max review cycle limit when available.',
      inputSchema: z.object({
        batch_id: z.number().optional(),
      }),
    },
    async ({ batch_id }) => {
      try {
        const count = await stateManager.getReviewCycleCount(batch_id)
        let maxReviewCycles: number | undefined

        try {
          const config = await loadConfig(projectDir)
          maxReviewCycles = config.settings.max_review_cycles
        } catch {
          // Counting review cycles should still work when config is absent or invalid.
        }

        const result = maxReviewCycles === undefined
          ? { count }
          : { count, max_review_cycles: maxReviewCycles }

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `State error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    }
  )
}
