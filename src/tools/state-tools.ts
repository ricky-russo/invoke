import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { StateManager } from './state.js'

export function registerStateTools(server: McpServer, stateManager: StateManager): void {
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
      description: 'Update pipeline state fields. Pass only the fields to update.',
      inputSchema: z.object({
        pipeline_id: z.string().optional(),
        current_stage: z.enum(['scope', 'plan', 'orchestrate', 'build', 'review', 'complete']).optional(),
        work_branch: z.string().optional(),
        spec: z.string().optional(),
        plan: z.string().optional(),
        strategy: z.string().optional(),
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
}
