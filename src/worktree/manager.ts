import { execSync } from 'child_process'
import { existsSync } from 'fs'
import path from 'path'
import os from 'os'

interface WorktreeInfo {
  taskId: string
  worktreePath: string
  branch: string
}

export type MergeResult =
  | { status: 'merged' }
  | { status: 'conflict'; conflictingFiles: string[]; mergeTargetPath: string }

const CONFLICT_STATUS_PREFIXES = ['UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD']

export class WorktreeManager {
  private static repoMutex = new Map<string, Promise<void>>()
  private static mergeTargetMutex = new Map<string, Promise<void>>()

  private worktrees = new Map<string, WorktreeInfo>()

  constructor(private repoDir: string) {}

  static async withRepoLock<T>(repoDir: string, fn: () => Promise<T>): Promise<T> {
    return WorktreeManager.runExclusive(WorktreeManager.repoMutex, repoDir, fn)
  }

  static async withMergeTargetLock<T>(targetPath: string, fn: () => Promise<T>): Promise<T> {
    return WorktreeManager.runExclusive(WorktreeManager.mergeTargetMutex, targetPath, fn)
  }

  private static async runExclusive<T>(
    mutex: Map<string, Promise<void>>,
    key: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const prev = mutex.get(key) ?? Promise.resolve()
    let release!: () => void
    const next = new Promise<void>(resolve => {
      release = resolve
    })
    mutex.set(key, next)
    try {
      await prev
      return await fn()
    } finally {
      release()
      if (mutex.get(key) === next) {
        mutex.delete(key)
      }
    }
  }

  async create(taskId: string): Promise<WorktreeInfo> {
    const branch = `invoke-wt-${taskId}`
    const worktreePath = path.join(os.tmpdir(), `invoke-worktree-${taskId}-${Date.now()}`)

    await WorktreeManager.withRepoLock(this.repoDir, async () => {
      execSync(
        `git worktree add "${worktreePath}" -b "${branch}"`,
        { cwd: this.repoDir, stdio: 'pipe' }
      )
    })

    const info: WorktreeInfo = { taskId, worktreePath, branch }
    this.worktrees.set(taskId, info)
    return info
  }

  async merge(
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
    // (agents in sandboxed environments may not be able to commit)
    try {
      execSync('git add -A', { cwd: info.worktreePath, stdio: 'pipe' })
      execSync(
        `git diff --cached --quiet`,
        { cwd: info.worktreePath, stdio: 'pipe' }
      )
      // If diff --quiet exits 0, there are no staged changes — nothing to commit
    } catch {
      // diff --quiet exits 1 when there ARE staged changes — commit them
      try {
        execSync(
          `git commit -m "agent work: ${taskId}"`,
          { cwd: info.worktreePath, stdio: 'pipe' }
        )
      } catch {
        // Commit might fail if there's truly nothing to commit
      }
    }

    return WorktreeManager.withMergeTargetLock(mergeTargetPath, async () => {
      try {
        execSync(
          `git merge --squash "${info.branch}"`,
          { cwd: mergeTargetPath, stdio: 'pipe' }
        )
      } catch {
        const conflictingFiles = this.collectConflictingFiles(mergeTargetPath)
        // Squash merges do NOT set MERGE_HEAD, so `git merge --abort` is unavailable.
        // Reset the working tree and clean untracked files instead.
        execSync('git reset --hard HEAD', { cwd: mergeTargetPath, stdio: 'pipe' })
        execSync('git clean -fd', { cwd: mergeTargetPath, stdio: 'pipe' })
        return { status: 'conflict', conflictingFiles, mergeTargetPath }
      }

      execSync(
        `git commit -m "${message.replace(/"/g, '\\"')}"`,
        { cwd: mergeTargetPath, stdio: 'pipe' }
      )
      return { status: 'merged' }
    })
  }

  private collectConflictingFiles(targetPath: string): string[] {
    try {
      const status = execSync('git status --porcelain', {
        cwd: targetPath,
        stdio: 'pipe',
      }).toString()
      return status
        .split('\n')
        .filter(line => CONFLICT_STATUS_PREFIXES.some(p => line.startsWith(p)))
        .map(line => line.slice(3))
    } catch {
      return []
    }
  }

  async cleanup(taskId: string): Promise<void> {
    const info = this.worktrees.get(taskId)
    if (!info) return

    if (existsSync(info.worktreePath)) {
      await WorktreeManager.withRepoLock(this.repoDir, async () => {
        execSync(
          `git worktree remove "${info.worktreePath}" --force`,
          { cwd: this.repoDir, stdio: 'pipe' }
        )
      })
    }

    try {
      execSync(
        `git branch -D "${info.branch}"`,
        { cwd: this.repoDir, stdio: 'pipe' }
      )
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
    try {
      const output = execSync('git worktree list --porcelain', {
        cwd: this.repoDir,
        stdio: 'pipe',
      }).toString()

      const orphaned: WorktreeInfo[] = []
      const blocks = output.split('\n\n').filter(Boolean)

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
    } catch {
      return []
    }
  }
}
