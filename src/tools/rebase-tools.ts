import { execFileSync } from 'node:child_process'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SessionManager } from '../session/manager.js'
import { withMergeTargetLock } from '../worktree/repo-lock.js'
import { SESSION_ID_PATTERN } from '../worktree/session-id-validator.js'
import { resolveSessionWorkBranchPath } from './session-path.js'
import { StateManager } from './state.js'

// Conflict markers in `git status --porcelain` (XY fields). We match on the
// two-letter prefix directly (not 'UU ') to tolerate any whitespace variant.
const CONFLICT_STATUS_PREFIXES = ['UU', 'AA', 'DD', 'UA', 'AU', 'UD', 'DU']

// Git environment variables that can redirect config, SSH command, editor,
// pager, external diff tool, or the working tree. Scrubbing them before
// spawning git defends against a compromised parent process env influencing
// git behavior (e.g. a CI job setting GIT_SSH_COMMAND to run arbitrary code).
// GIT_SEQUENCE_EDITOR is applied explicitly after the scrub, so it cannot be
// clobbered by the caller.
const SENSITIVE_GIT_ENV_VARS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_EDITOR',
  'GIT_SEQUENCE_EDITOR',
  'GIT_PAGER',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_EXTERNAL_DIFF',
  'GIT_CONFIG',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_NAMESPACE',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL',
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_ASKPASS',
  'GIT_TERMINAL_PROMPT',
  'GIT_HTTP_USER_AGENT',
]

function sanitizedGitEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (SENSITIVE_GIT_ENV_VARS.includes(key)) continue
    env[key] = value
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      env[key] = value
    }
  }
  return env
}

// Strict git ref-like name: used to validate `base_branch` read from state
// before it reaches git argv. This is not an attempt to implement full
// `git check-ref-format`; it is a conservative allow-list that rules out:
//   - leading `-` (would be parsed as an option)
//   - `..` and `@{` constructs
//   - whitespace and most shell metacharacters
// Combined with execFileSync (no shell) this closes the argv injection gap.
const SAFE_REF_NAME = /^(?![-.])[A-Za-z0-9_.][A-Za-z0-9._/-]{0,254}$/
function validateBaseBranch(baseBranch: string): void {
  if (!SAFE_REF_NAME.test(baseBranch)) {
    throw new Error(
      `Refusing to use base_branch '${baseBranch}': must match a conservative git ref name pattern`
    )
  }
  if (baseBranch.includes('..') || baseBranch.includes('@{')) {
    throw new Error(`Refusing to use base_branch '${baseBranch}': contains '..' or '@{' revspec construct`)
  }
}

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
    execFileSync('git', ['rev-list', '--count', `${baseRef}..HEAD`], {
      cwd,
      stdio: 'pipe',
      env: sanitizedGitEnv(),
    })
      .toString().trim(),
    10,
  )
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', env: sanitizedGitEnv() }).toString()
}

/**
 * Count commits on HEAD whose subject starts with `fixup! ` since baseRef.
 * This is the ground truth for `fixups_absorbed` in autosquash: we count the
 * fixup commits present before the rebase, because autosquash's job is to
 * absorb exactly that many commits into their targets. Computing the delta
 * of total commit counts (commitsBefore - commitsAfter) is an approximation
 * that breaks down when `squash!` commits are mixed in or when the rebase
 * drops a commit for unrelated reasons.
 */
function countFixupCommits(cwd: string, baseRef: string): number {
  try {
    const output = git(cwd, ['log', `${baseRef}..HEAD`, '--format=%s'])
    return output
      .split('\n')
      .filter(line => line.startsWith('fixup! '))
      .length
  } catch {
    return 0
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

/**
 * Distinguish a real rebase conflict from a non-conflict rebase failure
 * (detached HEAD, bad ref, corrupt state, etc). We inspect two signals:
 *   1. `conflictingFiles` from `git status --porcelain` — if at least one
 *      file is in a UU/AA/DD/etc state, a real three-way merge conflict
 *      occurred during the rebase.
 *   2. The rebase stderr for classic conflict phrases. This is a fallback
 *      in case the porcelain output is empty (e.g. `git rebase --abort` ran
 *      implicitly before we could read the status).
 *
 * Callers use this to surface `status: "conflict_aborted"` only for real
 * conflicts and `status: "error"` for everything else. The spec explicitly
 * distinguishes these cases in R5.
 */
function isConflictFailure(rebaseError: unknown, conflictingFiles: string[]): boolean {
  if (conflictingFiles.length > 0) return true
  const msg = formatExecError(rebaseError).toLowerCase()
  return (
    msg.includes('could not apply') ||
    msg.includes('merge conflict') ||
    msg.includes('needs merge') ||
    msg.includes('cherry-pick') ||
    msg.includes('resolve all conflicts')
  )
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
      .filter(line => {
        if (line.length < 2) return false
        const xy = line.slice(0, 2)
        return CONFLICT_STATUS_PREFIXES.includes(xy)
      })
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
          // Defense in depth: `base_branch` comes from state.json which is not
          // currently Zod-validated as a ref name. Reject leading `-`, `..`,
          // and `@{` constructs so this can't become an argv-injection sink if
          // the schema is relaxed or state is corrupted.
          validateBaseBranch(baseBranch)
          const mergeBase = git(sessionPath, ['merge-base', baseBranch, 'HEAD']).trim()
          const commitsBefore = countCommitsSince(sessionPath, mergeBase)
          const fixupsBefore = countFixupCommits(sessionPath, mergeBase)
          const preRebaseHead = git(sessionPath, ['rev-parse', 'HEAD']).trim()

          try {
            execFileSync('git', ['rebase', '-i', '--autosquash', mergeBase], {
              cwd: sessionPath,
              stdio: 'pipe',
              env: sanitizedGitEnv({ GIT_SEQUENCE_EDITOR: 'true' }),
            })

            const commitsAfter = countCommitsSince(sessionPath, mergeBase)
            return ok({
              status: 'ok',
              commits_before: commitsBefore,
              commits_after: commitsAfter,
              fixups_absorbed: fixupsBefore,
            })
          } catch (error) {
            const conflictingFiles = collectConflictingFiles(sessionPath)

            // Restore the pre-rebase state before deciding the status. This
            // runs regardless of whether the failure was a conflict or not,
            // because the rebase is already partially applied and must not be
            // left mid-flight.
            let abortFailed = false
            try {
              git(sessionPath, ['rebase', '--abort'])
            } catch {
              try {
                git(sessionPath, ['reset', '--hard', preRebaseHead])
              } catch {
                abortFailed = true
              }
            }

            // R5 of the spec distinguishes conflict_aborted (a real merge
            // conflict) from error (detached HEAD / bad git state / any other
            // non-conflict failure). Only real conflicts are the "append
            // fallback" path the review skill treats as a non-blocking warning.
            if (isConflictFailure(error, conflictingFiles)) {
              return ok({
                status: 'conflict_aborted',
                conflicting_files: conflictingFiles,
                message: formatExecError(error),
              })
            }

            return ok({
              status: 'error',
              message: abortFailed
                ? `${formatExecError(error)} (AND rebase --abort failed; session worktree may be in a mixed state)`
                : formatExecError(error),
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

        // Use `<sha>^{commit}` to force resolution to a commit object, so
        // ambiguous refs or tags can't smuggle non-commit objects through.
        // The `--` separator is defense in depth — the Zod schema already
        // blocks leading `-`, but a future relaxation would make this matter.
        const title = git(sessionPathOrError, [
          'log', '-1', '--format=%s',
          `${commit_sha}^{commit}`,
          '--',
        ]).trim()
        return ok({ title })
      } catch (error) {
        return errorResponse(formatExecError(error))
      }
    }
  )
}
