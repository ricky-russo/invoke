import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { SessionManager } from '../session/manager.js'
import type { DiffRef, DiffRefResult } from '../types.js'
import { sanitizeReviewedSha } from '../tools/reviewed-sha.js'
import { resolveSessionWorkBranchPath } from '../tools/session-path.js'

const MAX_DIFF_BUFFER_BYTES = 50 * 1024 * 1024
const DIFF_SIZE_WARN_BYTES = 48 * 1024 * 1024
const execFileAsync = promisify(execFile)

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

export class DiffRefResolver {
  constructor(
    private readonly sessionManager: SessionManager,
    private readonly projectDir: string
  ) {}

  async resolve(ref: DiffRef): Promise<DiffRefResult> {
    switch (ref.type) {
      case 'full_diff':
        return this.resolveFullDiff(ref)
      case 'delta_diff':
        return this.resolveDeltaDiff(ref)
    }
  }

  async resolveFullDiff(ref: Extract<DiffRef, { type: 'full_diff' }>): Promise<DiffRefResult> {
    const worktreePath = await this.resolveWorktreePath(ref.session_id)
    if (typeof worktreePath !== 'string') {
      return worktreePath
    }

    const baseBranch = await this.resolveBaseBranch(ref.session_id)
    if (typeof baseBranch !== 'string') {
      return baseBranch
    }

    let mergeBase: string
    try {
      const { stdout } = await execFileAsync('git', ['merge-base', baseBranch, 'HEAD'], {
        cwd: worktreePath,
        timeout: 10000,
        maxBuffer: MAX_DIFF_BUFFER_BYTES,
      })
      mergeBase = stdout.toString().trim()
    } catch (error) {
      return {
        status: 'commit_not_found',
        message: formatExecError(error),
      }
    }

    return this.computeDiff(worktreePath, [`${mergeBase}...HEAD`])
  }

  async resolveDeltaDiff(ref: Extract<DiffRef, { type: 'delta_diff' }>): Promise<DiffRefResult> {
    const sanitizedReviewedSha = sanitizeReviewedSha(ref.reviewed_sha)
    if (sanitizedReviewedSha === undefined) {
      return {
        status: 'resolve_error',
        message: 'reviewed_sha failed hex validation',
      }
    }

    const worktreePath = await this.resolveWorktreePath(ref.session_id)
    if (typeof worktreePath !== 'string') {
      return worktreePath
    }

    try {
      await execFileAsync('git', ['rev-parse', '--verify', `${sanitizedReviewedSha}^{commit}`], {
        cwd: worktreePath,
        timeout: 10000,
        maxBuffer: MAX_DIFF_BUFFER_BYTES,
      })
    } catch (error) {
      return {
        status: 'commit_not_found',
        message: formatExecError(error),
      }
    }

    return this.computeDiff(worktreePath, [`${sanitizedReviewedSha}...HEAD`])
  }

  private async resolveWorktreePath(sessionId: string): Promise<string | DiffRefResult> {
    try {
      const worktreePath = await resolveSessionWorkBranchPath(
        this.sessionManager,
        this.projectDir,
        sessionId
      )
      if (!worktreePath) {
        return {
          status: 'resolve_error',
          message: 'Session worktree path could not be resolved',
        }
      }
      return worktreePath
    } catch (error) {
      return {
        status: 'resolve_error',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async resolveBaseBranch(sessionId: string): Promise<string | DiffRefResult> {
    try {
      const state = await this.sessionManager.readState(sessionId)
      if (!state.base_branch) {
        return {
          status: 'resolve_error',
          message: 'Session base branch could not be resolved',
        }
      }
      return state.base_branch
    } catch (error) {
      return {
        status: 'resolve_error',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async computeDiff(worktreePath: string, args: string[]): Promise<DiffRefResult> {
    let diff: string
    try {
      const { stdout } = await execFileAsync('git', ['diff', ...args], {
        cwd: worktreePath,
        timeout: 30000,
        maxBuffer: MAX_DIFF_BUFFER_BYTES,
      })
      diff = stdout.toString()
    } catch (error) {
      return {
        status: 'diff_error',
        message: formatExecError(error),
      }
    }

    const diffBytes = Buffer.byteLength(diff)
    if (diffBytes > DIFF_SIZE_WARN_BYTES) {
      return {
        status: 'diff_too_large',
        message: `Diff is ${diffBytes} bytes (threshold ${DIFF_SIZE_WARN_BYTES})`,
      }
    }

    return {
      status: 'ok',
      diff,
    }
  }
}
