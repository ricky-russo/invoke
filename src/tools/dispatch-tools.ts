import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { DispatchEngine } from '../dispatch/engine.js'
import type { BatchManager } from '../dispatch/batch-manager.js'
import type { InvokeConfig } from '../types.js'
import { loadConfig } from '../config.js'

export function registerDispatchTools(
  server: McpServer,
  engine: DispatchEngine,
  batchManager: BatchManager,
  projectDir: string
): void {
  server.registerTool(
    'invoke_dispatch',
    {
      description: 'Dispatch a single agent by role and subrole. Blocks until the agent completes.',
      inputSchema: z.object({
        role: z.string().describe('Top-level role group (e.g. researcher, reviewer, builder)'),
        subrole: z.string().describe('Specific sub-role (e.g. security, codebase, default)'),
        task_context: z.record(z.string(), z.string()).describe('Template variables to inject into the prompt'),
        work_dir: z.string().optional().describe('Override working directory for the agent'),
      }),
    },
    async ({ role, subrole, task_context, work_dir }) => {
      try {
        const result = await engine.dispatch({
          role,
          subrole,
          taskContext: task_context,
          workDir: work_dir,
        })
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Dispatch error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    }
  )

  server.registerTool(
    'invoke_dispatch_batch',
    {
      description: 'Dispatch a batch of agents in parallel. Returns immediately with a batch_id for polling.',
      inputSchema: z.object({
        tasks: z.array(z.object({
          task_id: z.string(),
          role: z.string(),
          subrole: z.string(),
          task_context: z.record(z.string(), z.string()),
        })),
        create_worktrees: z.boolean().describe('Whether to create git worktrees for each task'),
      }),
    },
    async ({ tasks, create_worktrees }) => {
      // Read current config to report accurate provider info
      let taskProviders: { task_id: string; providers: { provider: string; model: string; effort: string }[] }[] = []
      let config: InvokeConfig | undefined
      try {
        config = await loadConfig(projectDir)
        taskProviders = tasks.map(t => {
          const roleConfig = config!.roles[t.role]?.[t.subrole]
          return {
            task_id: t.task_id,
            providers: roleConfig?.providers.map(p => ({
              provider: p.provider,
              model: p.model,
              effort: p.effort,
            })) ?? [],
          }
        })
      } catch {
        // Config read failed — return without provider info
      }

      const maxParallel = config?.settings?.max_parallel_agents

      const batchId = batchManager.dispatchBatch({
        tasks: tasks.map(t => ({
          taskId: t.task_id,
          role: t.role,
          subrole: t.subrole,
          taskContext: t.task_context,
        })),
        createWorktrees: create_worktrees,
        maxParallel,
      })

      return {
        content: [{ type: 'text', text: JSON.stringify({
          batch_id: batchId,
          status: 'dispatched',
          tasks: taskProviders,
        }) }],
      }
    }
  )

  server.registerTool(
    'invoke_get_batch_status',
    {
      description: 'Get the status of a dispatched batch. Waits up to `wait` seconds (default 60) for a status change before returning. Returns immediately if the batch is already complete or if any agent status changes.',
      inputSchema: z.object({
        batch_id: z.string().describe('The batch ID returned by invoke_dispatch_batch'),
        wait: z.number().optional().describe('Max seconds to wait for a status change (default 60, 0 for immediate)'),
      }),
    },
    async ({ batch_id, wait }) => {
      const waitSeconds = wait ?? 60

      const status = waitSeconds > 0
        ? await batchManager.waitForStatus(batch_id, waitSeconds)
        : batchManager.getStatus(batch_id)

      if (!status) {
        return {
          content: [{ type: 'text', text: `Batch not found: ${batch_id}` }],
          isError: true,
        }
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
      }
    }
  )

  server.registerTool(
    'invoke_cancel_batch',
    {
      description: 'Cancel a running batch and kill its agents.',
      inputSchema: z.object({
        batch_id: z.string().describe('The batch ID to cancel'),
      }),
    },
    async ({ batch_id }) => {
      batchManager.cancel(batch_id)
      return {
        content: [{ type: 'text', text: JSON.stringify({ batch_id, status: 'cancelled' }) }],
      }
    }
  )
}
