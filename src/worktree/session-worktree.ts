import { execFileSync } from 'child_process'
import { existsSync, lstatSync, mkdtempSync, realpathSync } from 'fs'
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

function isWithinPathRoot(targetPath: string, rootPath: string): boolean {
  return targetPath === rootPath || targetPath.startsWith(rootPath + path.sep)
}

function toKnownPath(worktreePath: string): string {
  return existsSync(worktreePath) ? realpathSync(worktreePath) : worktreePath
}

export class SessionWorktreeManager {
  private readonly baseBranches = new Map<string, string>()
  private readonly knownPrefixes = new Set<string>()
  private readonly repoPath: string
  private readonly realTmpdirPath: string
  private readonly tmpdirPath: string

  constructor(private readonly repoDir: string) {
    this.repoPath = toKnownPath(repoDir)
    this.tmpdirPath = path.resolve(os.tmpdir())
    this.realTmpdirPath = this.resolveTmpdirPath()
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
      const resolvedWorktreePath = this.addWorktree(
        worktreePath,
        ['-b', workBranch, baseBranch]
      )

      return this.rememberInfo({
        sessionId,
        worktreePath: resolvedWorktreePath,
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

    const resolvedWorktreePath = this.safeRealpathUnderTmpdir(entry.worktreePath)
    if (!resolvedWorktreePath) {
      return null
    }

    return this.rememberInfo({
      sessionId,
      worktreePath: resolvedWorktreePath,
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
      const resolvedWorktreePath = this.addWorktree(worktreePath, [workBranch])

      return this.rememberInfo({
        sessionId,
        worktreePath: resolvedWorktreePath,
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

      const resolvedWorktreePath = this.safeRealpathUnderTmpdir(entry.worktreePath)
      if (!resolvedWorktreePath) {
        continue
      }

      if (resolvedWorktreePath === this.repoPath) {
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
        worktreePath: resolvedWorktreePath,
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
    return mkdtempSync(path.join(os.tmpdir(), `invoke-session-${sessionId}-`))
  }

  private reattachWorktreePath(sessionId: string): string {
    return mkdtempSync(path.join(os.tmpdir(), `invoke-session-${sessionId}-`))
  }

  private assertUnderTmpdir(worktreePath: string): void {
    if (existsSync(worktreePath)) {
      const stat = lstatSync(worktreePath)
      if (stat.isSymbolicLink()) {
        throw new Error(`Session worktree path cannot be a symlink: ${worktreePath}`)
      }

      const realWorktreePath = realpathSync(worktreePath)
      if (isWithinPathRoot(realWorktreePath, this.realTmpdirPath)) {
        return
      }

      throw new Error(`Session worktree path escapes tmpdir: ${realWorktreePath}`)
    }

    const resolved = path.resolve(worktreePath)
    if (isWithinPathRoot(resolved, this.tmpdirPath) || isWithinPathRoot(resolved, this.realTmpdirPath)) {
      return
    }

    throw new Error(`Session worktree path escapes tmpdir: ${resolved}`)
  }

  private resolveTmpdirPath(): string {
    try {
      return realpathSync(this.tmpdirPath)
    } catch {
      return this.tmpdirPath
    }
  }

  private addWorktree(worktreePath: string, addArgs: string[]): string {
    this.assertUnderTmpdir(worktreePath)
    execFileSync(
      'git',
      ['worktree', 'add', worktreePath, ...addArgs],
      { cwd: this.repoDir, stdio: 'pipe' }
    )

    try {
      return this.realpathUnderTmpdir(worktreePath)
    } catch (error) {
      try {
        execFileSync(
          'git',
          ['worktree', 'remove', '--force', worktreePath],
          { cwd: this.repoDir, stdio: 'pipe' }
        )
      } catch {
        // Best-effort cleanup of the escaped worktree.
      }

      throw error
    }
  }

  private realpathUnderTmpdir(worktreePath: string): string {
    const resolvedWorktreePath = realpathSync(worktreePath)
    if (isWithinPathRoot(resolvedWorktreePath, this.realTmpdirPath)) {
      return resolvedWorktreePath
    }

    throw new Error(`Session worktree path escapes tmpdir: ${resolvedWorktreePath}`)
  }

  private safeRealpathUnderTmpdir(worktreePath: string): string | null {
    if (!existsSync(worktreePath)) {
      return null
    }

    try {
      return this.realpathUnderTmpdir(worktreePath)
    } catch {
      return null
    }
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
    const match = path.basename(worktreePath).match(/^invoke-session-(.+?)-[A-Za-z0-9]{6,}$/)
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
