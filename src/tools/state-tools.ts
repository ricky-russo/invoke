import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { loadConfig } from '../config.js'
import { SessionManager } from '../session/manager.js'
import { StateManager } from './state.js'

export function registerStateTools(
  server: McpServer,
  stateManager: StateManager,
  projectDir: string,
  sessionManager: SessionManager
): void {
  function resolveStateManager(sessionId?: string): StateManager {
    if (!sessionId) {
      return stateManager
    }

    return new StateManager(projectDir, sessionManager.resolve(sessionId))
  }

  async function resolveWritableStateManager(sessionId?: string): Promise<StateManager> {
    if (!sessionId) {
      return stateManager
    }

    const sessionDir = sessionManager.exists(sessionId)
      ? sessionManager.resolve(sessionId)
      : await sessionManager.create(sessionId)

    return new StateManager(projectDir, sessionDir)
  }

  server.registerTool(
    'invoke_get_state',
    {
      description: 'Get the current pipeline state.',
      inputSchema: z.object({
        session_id: z.string().optional(),
      }),
    },
    async ({ session_id }) => {
      try {
        const scopedStateManager = resolveStateManager(session_id)
        const state = await scopedStateManager.get()

        if (!session_id && !state) {
          return {
            content: [{
              type: 'text',
              text: 'No session_id provided. Use invoke_list_sessions to see available sessions.',
            }],
            isError: true,
          }
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(state, null, 2) }],
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
    'invoke_set_state',
    {
      description: 'Update pipeline state fields. Pass only the fields to update. Supports nested batches and review_cycles.',
      inputSchema: z.object({
        session_id: z.string().optional(),
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
        const { session_id, ...stateUpdates } = updates
        const scopedStateManager = await resolveWritableStateManager(session_id)
        let state = await scopedStateManager.get()
        if (!state) {
          state = await scopedStateManager.initialize(
            stateUpdates.pipeline_id ?? `pipeline-${Date.now()}`
          )
        }
        const updated = await scopedStateManager.update(stateUpdates)
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
        session_id: z.string().optional(),
        batch_id: z.number().optional(),
      }),
    },
    async ({ session_id, batch_id }) => {
      try {
        const scopedStateManager = resolveStateManager(session_id)
        const count = await scopedStateManager.getReviewCycleCount(batch_id)
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
