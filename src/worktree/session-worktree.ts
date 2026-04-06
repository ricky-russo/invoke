import { execSync } from 'child_process'
import { existsSync, realpathSync } from 'fs'
import os from 'os'
import path from 'path'
import { buildWorkBranch } from '../worktree/branch-prefix.js'

export interface SessionWorktreeInfo {
  sessionId: string
  worktreePath: string
  workBranch: string
  baseBranch: string
}

interface ParsedWorktree {
  worktreePath: string
  branchRef: string | null
}

const repoLocks = new Map<string, Promise<void>>()

async function withRepoLock<T>(repoDir: string, fn: () => Promise<T>): Promise<T> {
  const previous = repoLocks.get(repoDir) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>(resolve => {
    release = resolve
  })
  const tail = previous.catch(() => undefined).then(() => current)

  repoLocks.set(repoDir, tail)
  await previous.catch(() => undefined)

  try {
    return await fn()
  } finally {
    release()
    if (repoLocks.get(repoDir) === tail) {
      repoLocks.delete(repoDir)
    }
  }
}

function shellQuote(value: string): string {
  return `"${value.replace(/["\\$`]/g, '\\$&')}"`
}

function parseWorktreeList(output: string): ParsedWorktree[] {
  if (output.trim().length === 0) {
    return []
  }

  return output
    .trim()
    .split('\n\n')
    .filter(Boolean)
    .map(block => {
      const lines = block.split('\n')
      const worktreeLine = lines.find(line => line.startsWith('worktree '))
      const branchLine = lines.find(line => line.startsWith('branch '))

      if (!worktreeLine) {
        return null
      }

      return {
        worktreePath: worktreeLine.replace('worktree ', ''),
        branchRef: branchLine ? branchLine.replace('branch ', '') : null,
      }
    })
    .filter((entry): entry is ParsedWorktree => entry !== null)
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
      execSync(
        `git worktree add ${shellQuote(worktreePath)} -b ${shellQuote(workBranch)} ${shellQuote(baseBranch)}`,
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
    this.rememberPrefix(sessionId, workBranch)

    const entry = this.listPorcelainWorktrees()
      .find(worktree => worktree.branchRef === `refs/heads/${workBranch}`)

    if (!entry) {
      return null
    }

    return this.rememberInfo({
      sessionId,
      worktreePath: toKnownPath(entry.worktreePath),
      workBranch,
      baseBranch: this.baseBranches.get(workBranch) ?? '',
    })
  }

  async reattach(sessionId: string, workBranch: string): Promise<SessionWorktreeInfo | null> {
    this.rememberPrefix(sessionId, workBranch)

    const existing = await this.resolve(sessionId, workBranch)
    if (!existing) {
      return this.branchExists(workBranch) ? null : null
    }

    if (existsSync(existing.worktreePath)) {
      return existing
    }

    if (!this.branchExists(workBranch)) {
      return null
    }

    return withRepoLock(this.repoDir, async () => {
      const lockedExisting = await this.resolve(sessionId, workBranch)
      if (!lockedExisting) {
        return this.branchExists(workBranch) ? null : null
      }

      if (existsSync(lockedExisting.worktreePath)) {
        return lockedExisting
      }

      if (!this.branchExists(workBranch)) {
        return null
      }

      execSync('git worktree prune', {
        cwd: this.repoDir,
        stdio: 'pipe',
      })

      const worktreePath = this.reattachWorktreePath(sessionId)
      execSync(
        `git worktree add ${shellQuote(worktreePath)} ${shellQuote(workBranch)}`,
        { cwd: this.repoDir, stdio: 'pipe' }
      )

      return this.rememberInfo({
        sessionId,
        worktreePath: toKnownPath(worktreePath),
        workBranch,
        baseBranch: this.baseBranches.get(workBranch) ?? '',
      })
    })
  }

  async cleanup(sessionId: string, workBranch: string, deleteBranch: boolean): Promise<void> {
    this.rememberPrefix(sessionId, workBranch)

    const existing = await this.resolve(sessionId, workBranch)
    if (existing) {
      await withRepoLock(this.repoDir, async () => {
        execSync(
          `git worktree remove --force ${shellQuote(existing.worktreePath)}`,
          { cwd: this.repoDir, stdio: 'pipe' }
        )
      })
    }

    if (deleteBranch) {
      try {
        execSync(
          `git branch -D ${shellQuote(workBranch)}`,
          { cwd: this.repoDir, stdio: 'pipe' }
        )
      } catch {
        // Branch may already be absent.
      }
      this.baseBranches.delete(workBranch)
    }
  }

  async listSessionWorktrees(): Promise<SessionWorktreeInfo[]> {
    const sessionWorktrees: SessionWorktreeInfo[] = []

    for (const entry of this.listPorcelainWorktrees()) {
      if (!entry.branchRef?.startsWith('refs/heads/')) {
        continue
      }

      if (toKnownPath(entry.worktreePath) === this.repoPath) {
        continue
      }

      const workBranch = entry.branchRef.replace('refs/heads/', '')
      const matchingPrefix = this.matchingPrefix(workBranch)
      const isSessionPath = entry.worktreePath.includes('invoke-session-')

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
        baseBranch: this.baseBranches.get(workBranch) ?? '',
      }))
    }

    return sessionWorktrees
  }

  private listPorcelainWorktrees(): ParsedWorktree[] {
    try {
      const output = execSync('git worktree list --porcelain', {
        cwd: this.repoDir,
        stdio: 'pipe',
      }).toString()
      return parseWorktreeList(output)
    } catch {
      return []
    }
  }

  private branchExists(workBranch: string): boolean {
    try {
      execSync(
        `git show-ref --verify --quiet ${shellQuote(`refs/heads/${workBranch}`)}`,
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
    this.baseBranches.set(info.workBranch, info.baseBranch)
    this.rememberPrefix(info.sessionId, info.workBranch)
    return info
  }
}
