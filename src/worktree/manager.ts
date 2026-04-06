import { execFileSync } from 'child_process'
import { existsSync, realpathSync } from 'fs'
import path from 'path'
import os from 'os'
import { withMergeTargetLock, withRepoLock, withTaskLock } from './repo-lock.js'

interface WorktreeInfo {
  taskId: string
  worktreePath: string
  branch: string
}

export type MergeResult =
  | { status: 'merged' }
  | { status: 'conflict'; conflictingFiles: string[]; mergeTargetPath: string }

const CONFLICT_STATUS_PREFIXES = ['UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD']

function resolveGitCommonDir(cwd: string): string {
  const canonicalCwd = realpathSync(cwd)
  const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    cwd: canonicalCwd,
    stdio: 'pipe',
  })
    .toString()
    .trim()

  return realpathSync(path.resolve(canonicalCwd, commonDir))
}

function isSafeSessionWorktreeTarget(targetPath: string, repoDir: string): boolean {
  let canonicalTarget: string
  let canonicalTmp: string

  try {
    canonicalTarget = realpathSync(targetPath)
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

  if (!path.basename(canonicalTarget).startsWith('invoke-session-')) {
    return false
  }

  try {
    return resolveGitCommonDir(canonicalTarget) === resolveGitCommonDir(repoDir)
  } catch {
    return false
  }
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()
}

function tryGit(cwd: string, args: string[]): { ok: true; stdout: string } | { ok: false; error: unknown } {
  try {
    return { ok: true, stdout: git(cwd, args) }
  } catch (error) {
    return { ok: false, error }
  }
}

export class WorktreeManager {
  private worktrees = new Map<string, WorktreeInfo>()

  constructor(private repoDir: string) {}

  async create(taskId: string): Promise<WorktreeInfo> {
    const branch = `invoke-wt-${taskId}`
    const worktreePath = path.join(os.tmpdir(), `invoke-worktree-${taskId}-${Date.now()}`)

    await withRepoLock(this.repoDir, async () => {
      git(this.repoDir, ['worktree', 'add', worktreePath, '-b', branch])
    })

    const info: WorktreeInfo = { taskId, worktreePath, branch }
    this.worktrees.set(taskId, info)
    return info
  }

  async merge(
    taskId: string,
    options?: { commitMessage?: string; mergeTargetPath?: string }
  ): Promise<MergeResult> {
    return withTaskLock(taskId, () => this.mergeLocked(taskId, options))
  }

  private async mergeLocked(
    taskId: string,
    options?: { commitMessage?: string; mergeTargetPath?: string }
  ): Promise<MergeResult> {
    const info = this.worktrees.get(taskId)
    if (!info) {
      throw new Error(`No worktree found for task: ${taskId}`)
    }

    const mergeTargetPath = options?.mergeTargetPath ?? this.repoDir
    const message = options?.commitMessage ?? `feat: ${taskId}`

    // Auto-commit any uncommitted changes in the worktree
    // (agents in sandboxed environments may not be able to commit).
    // Stage everything first — staging failures are real and must throw.
    git(info.worktreePath, ['add', '-A'])

    // `git diff --cached --quiet` exits 0 when there are no staged changes,
    // and exits 1 when there ARE staged changes. Any other exit code is an error.
    const diff = tryGit(info.worktreePath, ['diff', '--cached', '--quiet'])
    if (!diff.ok) {
      // Exit code 1 means there are staged changes to commit. Exit code >1 is a real error.
      const code = (diff.error as { status?: number })?.status
      if (code !== 1) {
        throw new Error(
          `Failed to inspect staged changes in ${info.worktreePath}: ${(diff.error as Error)?.message ?? diff.error}`
        )
      }
      try {
        git(info.worktreePath, ['commit', '-m', `agent work: ${taskId}`])
      } catch (commitError) {
        throw new Error(
          `Failed to auto-commit agent work for task ${taskId}: ${(commitError as Error)?.message ?? commitError}`
        )
      }
    }

    return withMergeTargetLock(mergeTargetPath, async () => {
      const mergeAttempt = tryGit(mergeTargetPath, ['merge', '--squash', info.branch])
      if (!mergeAttempt.ok) {
        const conflictingFiles = this.collectConflictingFiles(mergeTargetPath)

        if (mergeTargetPath !== this.repoDir && !isSafeSessionWorktreeTarget(mergeTargetPath, this.repoDir)) {
          const original = mergeAttempt.error as Error
          throw new Error(
            `Refusing destructive cleanup on unsafe merge target ${mergeTargetPath}: ${original?.message ?? original}`
          )
        }

        // Squash merges do NOT set MERGE_HEAD, so `git merge --abort` is unavailable.
        // Reset the working tree to discard the half-applied merge.
        git(mergeTargetPath, ['reset', '--hard', 'HEAD'])

        // Only run `git clean -fd` against merge targets that invoke owns
        // (i.e. session worktrees). The default target is the user's repo
        // directory, which may contain untracked files belonging to the user;
        // wiping them would be data loss.
        if (mergeTargetPath !== this.repoDir) {
          git(mergeTargetPath, ['clean', '-fd'])
        }

        if (conflictingFiles.length === 0) {
          // The merge failed for a reason other than file conflicts (e.g.
          // dirty target, missing ref, broken filesystem). Surface it.
          const original = mergeAttempt.error as Error
          throw new Error(
            `git merge --squash ${info.branch} into ${mergeTargetPath} failed: ${original?.message ?? original}`
          )
        }

        return { status: 'conflict', conflictingFiles, mergeTargetPath }
      }

      git(mergeTargetPath, ['commit', '-m', message])
      return { status: 'merged' }
    })
  }

  private collectConflictingFiles(targetPath: string): string[] {
    const result = tryGit(targetPath, ['status', '--porcelain'])
    if (!result.ok) {
      return []
    }
    return result.stdout
      .split('\n')
      .filter(line => CONFLICT_STATUS_PREFIXES.some(p => line.startsWith(p)))
      .map(line => line.slice(3))
  }

  async cleanup(taskId: string): Promise<void> {
    return withTaskLock(taskId, () => this.cleanupLocked(taskId))
  }

  private async cleanupLocked(taskId: string): Promise<void> {
    const info = this.worktrees.get(taskId)
    if (!info) return

    if (existsSync(info.worktreePath)) {
      await withRepoLock(this.repoDir, async () => {
        git(this.repoDir, ['worktree', 'remove', info.worktreePath, '--force'])
      })
    }

    try {
      git(this.repoDir, ['branch', '-D', info.branch])
    } catch {
      // Branch may already be deleted
    }

    this.worktrees.delete(taskId)
  }

  async cleanupAll(): Promise<void> {
    for (const taskId of [...this.worktrees.keys()]) {
      await this.cleanup(taskId)
    }
  }

  listActive(): WorktreeInfo[] {
    return [...this.worktrees.values()]
  }

  async discoverOrphaned(): Promise<WorktreeInfo[]> {
    const result = tryGit(this.repoDir, ['worktree', 'list', '--porcelain'])
    if (!result.ok) {
      return []
    }

    const orphaned: WorktreeInfo[] = []
    const blocks = result.stdout.split('\n\n').filter(Boolean)

    for (const block of blocks) {
      const lines = block.split('\n')
      const worktreeLine = lines.find(l => l.startsWith('worktree '))
      const branchLine = lines.find(l => l.startsWith('branch '))

      if (!worktreeLine || !branchLine) continue

      const worktreePath = worktreeLine.replace('worktree ', '')
      const fullBranch = branchLine.replace('branch ', '')
      const branch = fullBranch.replace('refs/heads/', '')

      if (!branch.startsWith('invoke-wt-')) continue

      const taskId = branch.replace('invoke-wt-', '')

      if (this.worktrees.has(taskId)) continue

      orphaned.push({ taskId, worktreePath, branch })
    }

    return orphaned
  }
}
