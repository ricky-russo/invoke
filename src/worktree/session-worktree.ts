import { execFileSync } from 'child_process'
import { existsSync, realpathSync } from 'fs'
import os from 'os'
import path from 'path'
import { buildWorkBranch } from './branch-prefix.js'
import { parsePorcelainWorktrees, type PorcelainWorktreeEntry } from './porcelain.js'
import { withRepoLock } from './repo-lock.js'
import { validateSessionId } from './session-id-validator.js'

export interface SessionWorktreeInfo {
  sessionId: string
  worktreePath: string
  workBranch: string
  baseBranch: string | null
}

function toKnownPath(worktreePath: string): string {
  return existsSync(worktreePath) ? realpathSync(worktreePath) : worktreePath
}

export class SessionWorktreeManager {
  private readonly baseBranches = new Map<string, string>()
  private readonly knownPrefixes = new Set<string>()
  private readonly repoPath: string

  constructor(private readonly repoDir: string) {
    this.repoPath = toKnownPath(repoDir)
  }

  async create(sessionId: string, workBranchPrefix: string, baseBranch: string): Promise<SessionWorktreeInfo> {
    validateSessionId(sessionId)
    const workBranch = buildWorkBranch(workBranchPrefix, sessionId)
    this.rememberPrefix(sessionId, workBranch)
    this.baseBranches.set(workBranch, baseBranch)

    const existing = await this.resolve(sessionId, workBranch)
    if (existing) {
      return this.rememberInfo({ ...existing, baseBranch })
    }

    return withRepoLock(this.repoDir, async () => {
      const lockedExisting = await this.resolve(sessionId, workBranch)
      if (lockedExisting) {
        return this.rememberInfo({ ...lockedExisting, baseBranch })
      }

      const worktreePath = this.defaultWorktreePath(sessionId)
      this.assertUnderTmpdir(worktreePath)
      execFileSync(
        'git',
        ['worktree', 'add', worktreePath, '-b', workBranch, baseBranch],
        { cwd: this.repoDir, stdio: 'pipe' }
      )

      return this.rememberInfo({
        sessionId,
        worktreePath: toKnownPath(worktreePath),
        workBranch,
        baseBranch,
      })
    })
  }

  async resolve(sessionId: string, workBranch: string): Promise<SessionWorktreeInfo | null> {
    validateSessionId(sessionId)
    this.rememberPrefix(sessionId, workBranch)

    const entry = this.listPorcelainWorktrees().find(worktree => worktree.branch === workBranch)

    if (!entry) {
      return null
    }

    return this.rememberInfo({
      sessionId,
      worktreePath: toKnownPath(entry.worktreePath),
      workBranch,
      baseBranch: this.lookupBaseBranch(workBranch),
    })
  }

  async reattach(
    sessionId: string,
    workBranch: string,
    recordedPath?: string
  ): Promise<SessionWorktreeInfo | null> {
    validateSessionId(sessionId)
    this.rememberPrefix(sessionId, workBranch)

    if (recordedPath !== undefined) {
      // Strict mode: the branch must be checked out exactly at the recorded path.
      // The caller can decide what to do (e.g. delete the stale worktree) on null.
      const existing = await this.resolve(sessionId, workBranch)
      if (!existing) {
        return null
      }
      if (toKnownPath(existing.worktreePath) !== toKnownPath(recordedPath)) {
        return null
      }
      if (!existsSync(existing.worktreePath)) {
        return null
      }
      return existing
    }

    const existing = await this.resolve(sessionId, workBranch)
    if (existing && existsSync(existing.worktreePath)) {
      return existing
    }

    if (!this.branchExists(workBranch)) {
      return null
    }

    return withRepoLock(this.repoDir, async () => {
      const lockedExisting = await this.resolve(sessionId, workBranch)
      if (lockedExisting && existsSync(lockedExisting.worktreePath)) {
        return lockedExisting
      }

      if (!this.branchExists(workBranch)) {
        return null
      }

      execFileSync('git', ['worktree', 'prune'], {
        cwd: this.repoDir,
        stdio: 'pipe',
      })

      const worktreePath = this.reattachWorktreePath(sessionId)
      this.assertUnderTmpdir(worktreePath)
      execFileSync(
        'git',
        ['worktree', 'add', worktreePath, workBranch],
        { cwd: this.repoDir, stdio: 'pipe' }
      )

      return this.rememberInfo({
        sessionId,
        worktreePath: toKnownPath(worktreePath),
        workBranch,
        baseBranch: this.lookupBaseBranch(workBranch),
      })
    })
  }

  async cleanup(sessionId: string, workBranch: string, deleteBranch: boolean): Promise<void> {
    validateSessionId(sessionId)
    this.rememberPrefix(sessionId, workBranch)

    const existing = await this.resolve(sessionId, workBranch)
    if (existing) {
      await withRepoLock(this.repoDir, async () => {
        execFileSync(
          'git',
          ['worktree', 'remove', '--force', existing.worktreePath],
          { cwd: this.repoDir, stdio: 'pipe' }
        )
      })
    }

    if (deleteBranch) {
      try {
        execFileSync(
          'git',
          ['branch', '-D', workBranch],
          { cwd: this.repoDir, stdio: 'pipe' }
        )
      } catch {
        // Branch may already be absent.
      }
    }

    this.baseBranches.delete(workBranch)
  }

  async listSessionWorktrees(): Promise<SessionWorktreeInfo[]> {
    const sessionWorktrees: SessionWorktreeInfo[] = []

    for (const entry of this.listPorcelainWorktrees()) {
      if (!entry.branch) {
        continue
      }

      if (toKnownPath(entry.worktreePath) === this.repoPath) {
        continue
      }

      const workBranch = entry.branch
      const matchingPrefix = this.matchingPrefix(workBranch)
      const isSessionPath = path.basename(entry.worktreePath).startsWith('invoke-session-')

      if (!isSessionPath && !matchingPrefix) {
        continue
      }

      const sessionId = matchingPrefix
        ? workBranch.slice(matchingPrefix.length + 1)
        : this.sessionIdFromPath(entry.worktreePath)

      if (!sessionId) {
        continue
      }

      sessionWorktrees.push(this.rememberInfo({
        sessionId,
        worktreePath: toKnownPath(entry.worktreePath),
        workBranch,
        baseBranch: this.lookupBaseBranch(workBranch),
      }))
    }

    return sessionWorktrees
  }

  private listPorcelainWorktrees(): PorcelainWorktreeEntry[] {
    try {
      const output = execFileSync('git', ['worktree', 'list', '--porcelain'], {
        cwd: this.repoDir,
        stdio: 'pipe',
      }).toString()
      return parsePorcelainWorktrees(output)
    } catch {
      return []
    }
  }

  private branchExists(workBranch: string): boolean {
    try {
      execFileSync(
        'git',
        ['show-ref', '--verify', '--quiet', `refs/heads/${workBranch}`],
        { cwd: this.repoDir, stdio: 'pipe' }
      )
      return true
    } catch {
      return false
    }
  }

  private defaultWorktreePath(sessionId: string): string {
    return path.join(os.tmpdir(), `invoke-session-${sessionId}`)
  }

  private reattachWorktreePath(sessionId: string): string {
    return path.join(os.tmpdir(), `invoke-session-${sessionId}-reattach-${Date.now()}`)
  }

  private assertUnderTmpdir(worktreePath: string): void {
    const tmpdir = os.tmpdir()
    let canonicalRoot = tmpdir
    try {
      canonicalRoot = realpathSync(tmpdir)
    } catch {
      // Fall back to the literal tmpdir below.
    }

    const resolved = path.resolve(worktreePath)
    for (const root of [tmpdir, canonicalRoot]) {
      if (resolved === root || resolved.startsWith(root + path.sep)) {
        return
      }
    }

    throw new Error(`Session worktree path escapes tmpdir: ${resolved}`)
  }

  private lookupBaseBranch(workBranch: string): string | null {
    return this.baseBranches.get(workBranch) ?? null
  }

  private rememberPrefix(sessionId: string, workBranch: string): void {
    const suffix = `/${sessionId}`
    if (!workBranch.endsWith(suffix)) {
      return
    }

    this.knownPrefixes.add(workBranch.slice(0, -suffix.length))
  }

  private matchingPrefix(workBranch: string): string | null {
    let match: string | null = null

    for (const prefix of this.knownPrefixes) {
      if (!workBranch.startsWith(`${prefix}/`)) {
        continue
      }

      if (!match || prefix.length > match.length) {
        match = prefix
      }
    }

    return match
  }

  private sessionIdFromPath(worktreePath: string): string | null {
    const match = path.basename(worktreePath).match(/^invoke-session-(.+?)(?:-reattach-\d+)?$/)
    return match?.[1] ?? null
  }

  private rememberInfo(info: SessionWorktreeInfo): SessionWorktreeInfo {
    if (info.baseBranch !== null) {
      this.baseBranches.set(info.workBranch, info.baseBranch)
    }
    this.rememberPrefix(info.sessionId, info.workBranch)
    return info
  }
}
