import { execFileSync } from 'node:child_process'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SessionManager } from '../session/manager.js'
import { withMergeTargetLock } from '../worktree/repo-lock.js'
import { SESSION_ID_PATTERN } from '../worktree/session-id-validator.js'
import { resolveSessionWorkBranchPath } from './session-path.js'
import { StateManager } from './state.js'

const CONFLICT_STATUS_PREFIXES = ['UU ', 'AA ', 'DD ', 'UA ', 'AU ', 'UD ', 'DU ']

const AutosquashInputSchema = z.object({
  session_id: z.string().regex(SESSION_ID_PATTERN),
})

const CollapseInputSchema = z.object({
  session_id: z.string().regex(SESSION_ID_PATTERN),
  base_sha: z.string().regex(/^[0-9a-f]{7,40}$/, 'base_sha must be a git SHA'),
  message: z.string().min(1),
})

const GetCommitTitleInputSchema = z.object({
  session_id: z.string().regex(SESSION_ID_PATTERN),
  commit_sha: z.string().regex(/^[0-9a-f]{7,40}$/),
})

function countCommitsSince(cwd: string, baseRef: string): number {
  return parseInt(
    execFileSync('git', ['rev-list', '--count', `${baseRef}..HEAD`], { cwd, stdio: 'pipe' })
      .toString().trim(),
    10,
  )
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()
}

function formatExecError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'stderr' in error) {
    const stderr = error.stderr
    if (Buffer.isBuffer(stderr)) {
      const message = stderr.toString().trim()
      if (message) {
        return message
      }
    }
  }

  return error instanceof Error ? error.message : String(error)
}

function ok(payload: object) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  }
}

function errorResponse(message: string) {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true as const,
  }
}

async function getSessionState(
  projectDir: string,
  sessionManager: SessionManager,
  sessionId: string
) {
  const sessionDir = sessionManager.resolve(sessionId)
  return new StateManager(projectDir, sessionDir).get()
}

function collectConflictingFiles(cwd: string): string[] {
  try {
    return git(cwd, ['status', '--porcelain'])
      .split('\n')
      .filter(line => CONFLICT_STATUS_PREFIXES.some(prefix => line.startsWith(prefix)))
      .map(line => line.slice(3))
  } catch {
    return []
  }
}

function requireSessionPath(
  sessionPath: string | undefined,
  sessionId: string
): string | { content: Array<{ type: 'text'; text: string }>; isError: true } {
  if (sessionPath) {
    return sessionPath
  }

  return errorResponse(
    `Session ${sessionId} has no work_branch_path - was it initialized via invoke_session_init_worktree?`
  )
}

export function registerRebaseTools(
  server: McpServer,
  sessionManager: SessionManager,
  projectDir: string
): void {
  server.registerTool(
    'invoke_autosquash_session',
    {
      description: 'Run git autosquash in the session work branch and cleanly abort on conflicts.',
      inputSchema: AutosquashInputSchema,
    },
    async ({ session_id }) => {
      try {
        const sessionPath = await resolveSessionWorkBranchPath(sessionManager, projectDir, session_id)
        if (!sessionPath) {
          return ok({
            status: 'not_supported',
            message: 'session has no work_branch_path (legacy)',
          })
        }

        return await withMergeTargetLock(sessionPath, async () => {
          const state = await getSessionState(projectDir, sessionManager, session_id)
          const baseBranch = state?.base_branch ?? 'main'
          const mergeBase = git(sessionPath, ['merge-base', baseBranch, 'HEAD']).trim()
          const commitsBefore = countCommitsSince(sessionPath, mergeBase)
          const preRebaseHead = git(sessionPath, ['rev-parse', 'HEAD']).trim()

          try {
            execFileSync('git', ['rebase', '-i', '--autosquash', mergeBase], {
              cwd: sessionPath,
              stdio: 'pipe',
              env: {
                ...process.env,
                GIT_SEQUENCE_EDITOR: 'true',
              },
            })

            const commitsAfter = countCommitsSince(sessionPath, mergeBase)
            return ok({
              status: 'ok',
              commits_before: commitsBefore,
              commits_after: commitsAfter,
              fixups_absorbed: Math.max(0, commitsBefore - commitsAfter),
            })
          } catch (error) {
            const conflictingFiles = collectConflictingFiles(sessionPath)

            try {
              git(sessionPath, ['rebase', '--abort'])
            } catch {
              git(sessionPath, ['reset', '--hard', preRebaseHead])
            }

            return ok({
              status: 'conflict_aborted',
              conflicting_files: conflictingFiles,
              message: formatExecError(error),
            })
          }
        })
      } catch (error) {
        return errorResponse(formatExecError(error))
      }
    }
  )

  server.registerTool(
    'invoke_collapse_commits',
    {
      description: 'Collapse all commits after a base SHA into a single commit in the session work branch.',
      inputSchema: CollapseInputSchema,
    },
    async ({ session_id, base_sha, message }) => {
      try {
        const sessionPathOrError = requireSessionPath(
          await resolveSessionWorkBranchPath(sessionManager, projectDir, session_id),
          session_id
        )
        if (typeof sessionPathOrError !== 'string') {
          return sessionPathOrError
        }

        return await withMergeTargetLock(sessionPathOrError, async () => {
          try {
            try {
              git(sessionPathOrError, ['merge-base', '--is-ancestor', base_sha, 'HEAD'])
            } catch {
              throw new Error('base_sha is not an ancestor of HEAD')
            }

            git(sessionPathOrError, ['reset', '--soft', base_sha])
            git(sessionPathOrError, ['commit', '-m', message])
            const commitSha = git(sessionPathOrError, ['rev-parse', 'HEAD']).trim()

            return ok({
              status: 'ok',
              commit_sha: commitSha,
            })
          } catch (error) {
            return errorResponse(formatExecError(error))
          }
        })
      } catch (error) {
        return errorResponse(formatExecError(error))
      }
    }
  )

  server.registerTool(
    'invoke_get_commit_title',
    {
      description: 'Read a commit title from the session work branch.',
      inputSchema: GetCommitTitleInputSchema,
    },
    async ({ session_id, commit_sha }) => {
      try {
        const sessionPathOrError = requireSessionPath(
          await resolveSessionWorkBranchPath(sessionManager, projectDir, session_id),
          session_id
        )
        if (typeof sessionPathOrError !== 'string') {
          return sessionPathOrError
        }

        const title = git(sessionPathOrError, ['log', '-1', '--format=%s', commit_sha]).trim()
        return ok({ title })
      } catch (error) {
        return errorResponse(formatExecError(error))
      }
    }
  )
}
