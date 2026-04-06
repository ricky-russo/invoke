import { realpathSync } from 'fs'
import os from 'os'
import path from 'path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SessionManager } from '../session/manager.js'
import type { WorktreeManager } from '../worktree/manager.js'
import type { InvokeConfig } from '../types.js'
import { runPostMergeCommands } from './post-merge.js'
import { StateManager } from './state.js'

function isSafeSessionWorkBranchPath(workBranchPath: string | undefined): workBranchPath is string {
  if (!workBranchPath || !path.isAbsolute(workBranchPath)) {
    return false
  }

  let canonicalTarget: string
  let canonicalTmp: string

  try {
    canonicalTarget = realpathSync(workBranchPath)
  } catch {
    return false
  }

  try {
    canonicalTmp = realpathSync(os.tmpdir())
  } catch {
    canonicalTmp = os.tmpdir()
  }

  if (canonicalTarget !== canonicalTmp && !canonicalTarget.startsWith(canonicalTmp + path.sep)) {
    return false
  }

  return path.basename(canonicalTarget).startsWith('invoke-session-')
}

async function resolveSessionWorkBranchPath(
  sessionManager: SessionManager,
  projectDir: string | undefined,
  sessionId?: string
): Promise<string | undefined> {
  if (!sessionId) return undefined
  if (!projectDir) {
    throw new Error('Project directory is required when session_id is provided')
  }

  const sessionDir = sessionManager.resolve(sessionId)
  const stateManager = new StateManager(projectDir, sessionDir)
  const state = await stateManager.get()
  const workBranchPath = state?.work_branch_path

  if (workBranchPath === undefined) return undefined
  if (!isSafeSessionWorkBranchPath(workBranchPath)) {
    throw new Error(
      `Refusing to use unsafe session work branch path for session '${sessionId}'`
    )
  }

  return realpathSync(workBranchPath)
}

export function registerWorktreeTools(
  server: McpServer,
  worktreeManager: WorktreeManager,
  sessionManager: SessionManager,
  config?: InvokeConfig,
  projectDir?: string
): void {
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
        commit_message: z.string().optional().describe('Commit message for the squash merge (defaults to "feat: <task_id>")'),
        session_id: z.string().optional().describe('Session ID used to resolve a per-session merge target'),
      }),
    },
    async ({ task_id, commit_message, session_id }) => {
      try {
        const mergeTargetPath = await resolveSessionWorkBranchPath(sessionManager, projectDir, session_id)
        const options = {
          ...(commit_message !== undefined ? { commitMessage: commit_message } : {}),
          ...(mergeTargetPath ? { mergeTargetPath } : {}),
        }
        const result = await worktreeManager.merge(task_id, Object.keys(options).length > 0 ? options : undefined)
        if (result.status === 'conflict') {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                task_id,
                status: 'conflict',
                conflicting_files: result.conflictingFiles,
                merge_target_path: result.mergeTargetPath,
              }),
            }],
          }
        }
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

  server.registerTool(
    'invoke_run_post_merge',
    {
      description: 'Run configured post-merge commands (e.g., composer install, npm install) to regenerate lockfiles after worktree merges.',
      inputSchema: z.object({
        session_id: z.string().optional().describe('Session ID used to resolve the session worktree cwd'),
      }),
    },
    async ({ session_id }) => {
      try {
        if (!config || !projectDir) {
          return {
            content: [{ type: 'text', text: 'No config available — post-merge commands not configured.' }],
          }
        }
        const commands = config.settings.post_merge_commands ?? []
        if (commands.length === 0) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ message: 'No post_merge_commands configured', commands: [] }) }],
          }
        }

        const cwd = await resolveSessionWorkBranchPath(sessionManager, projectDir, session_id)
        const result = runPostMergeCommands(config, projectDir, cwd)
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Post-merge error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    }
  )
}
