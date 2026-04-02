import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { WorktreeManager } from '../worktree/manager.js'

export function registerWorktreeTools(server: McpServer, worktreeManager: WorktreeManager): void {
  server.registerTool(
    'invoke_create_worktree',
    {
      description: 'Create an isolated git worktree for a build task.',
      inputSchema: z.object({
        task_id: z.string().describe('Unique task identifier'),
      }),
    },
    async ({ task_id }) => {
      try {
        const info = await worktreeManager.create(task_id)
        return {
          content: [{ type: 'text', text: JSON.stringify(info) }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Worktree error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    }
  )

  server.registerTool(
    'invoke_merge_worktree',
    {
      description: 'Merge a completed worktree back into the work branch.',
      inputSchema: z.object({
        task_id: z.string().describe('Task ID of the worktree to merge'),
      }),
    },
    async ({ task_id }) => {
      try {
        await worktreeManager.merge(task_id)
        await worktreeManager.cleanup(task_id)
        return {
          content: [{ type: 'text', text: JSON.stringify({ task_id, status: 'merged' }) }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Merge error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    }
  )

  server.registerTool(
    'invoke_cleanup_worktrees',
    {
      description: 'Remove all stale/orphaned worktrees.',
      inputSchema: z.object({}),
    },
    async () => {
      const active = worktreeManager.listActive()
      await worktreeManager.cleanupAll()
      return {
        content: [{ type: 'text', text: JSON.stringify({ cleaned: active.length }) }],
      }
    }
  )
}
