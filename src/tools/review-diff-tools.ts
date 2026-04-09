import { execFileSync } from 'node:child_process'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SessionManager } from '../session/manager.js'
import { sanitizeReviewedSha } from './reviewed-sha.js'
import { StateManager } from './state.js'

export type ReviewDiffResult =
  | { status: 'ok'; reviewed_sha: string; diff: string }
  | { status: 'invalid_reviewed_sha'; message: string }
  | { status: 'commit_not_found'; message: string }
  | { status: 'diff_error'; message: string }
  | { status: 'not_supported'; message: string }

const ReviewDiffInputSchema = z.object({
  session_id: z.string(),
  reviewed_sha: z.string(),
})

const NOT_SUPPORTED_MESSAGE = 'Session has no worktree; review-diff tool requires a per-session worktree'

function ok(result: ReviewDiffResult) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
  }
}

function formatExecError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'stderr' in error) {
    const stderr = (error as { stderr?: unknown }).stderr
    if (Buffer.isBuffer(stderr)) {
      const message = stderr.toString().trim()
      if (message) {
        return message
      }
    } else if (typeof stderr === 'string' && stderr.trim()) {
      return stderr.trim()
    }
  }

  return error instanceof Error ? error.message : String(error)
}

async function resolveWorktreePath(
  sessionManager: SessionManager,
  projectDir: string,
  sessionId: string
): Promise<string | undefined> {
  try {
    const sessionDir = sessionManager.resolve(sessionId)
    const state = await new StateManager(projectDir, sessionDir).get()
    return state?.work_branch_path
  } catch {
    return undefined
  }
}

export function registerReviewDiffTools(
  server: McpServer,
  sessionManager: SessionManager,
  projectDir: string
): void {
  server.registerTool(
    'invoke_compute_review_diff',
    {
      description: 'Compute the diff between a reviewed commit SHA and the current session HEAD.',
      inputSchema: ReviewDiffInputSchema,
    },
    async ({ session_id, reviewed_sha }) => {
      const worktreePath = await resolveWorktreePath(sessionManager, projectDir, session_id)
      if (!worktreePath) {
        return ok({
          status: 'not_supported',
          message: NOT_SUPPORTED_MESSAGE,
        })
      }

      const sanitizedReviewedSha = sanitizeReviewedSha(reviewed_sha)
      if (sanitizedReviewedSha === undefined) {
        return ok({
          status: 'invalid_reviewed_sha',
          message: 'reviewed_sha failed hex validation',
        })
      }

      try {
        execFileSync('git', ['rev-parse', '--verify', `${sanitizedReviewedSha}^{commit}`], {
          cwd: worktreePath,
          stdio: 'pipe',
          timeout: 10000,
        })
      } catch (error) {
        return ok({
          status: 'commit_not_found',
          message: formatExecError(error),
        })
      }

      try {
        const diff = execFileSync('git', ['diff', `${sanitizedReviewedSha}...HEAD`], {
          cwd: worktreePath,
          stdio: 'pipe',
          timeout: 30000,
        }).toString()

        return ok({
          status: 'ok',
          reviewed_sha: sanitizedReviewedSha,
          diff,
        })
      } catch (error) {
        return ok({
          status: 'diff_error',
          message: formatExecError(error),
        })
      }
    }
  )
}
