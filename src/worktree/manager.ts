import { execSync } from 'child_process'
import { existsSync } from 'fs'
import path from 'path'
import os from 'os'

interface WorktreeInfo {
  taskId: string
  worktreePath: string
  branch: string
}

export class WorktreeManager {
  private worktrees = new Map<string, WorktreeInfo>()

  constructor(private repoDir: string) {}

  async create(taskId: string): Promise<WorktreeInfo> {
    const branch = `invoke-wt-${taskId}`
    const worktreePath = path.join(os.tmpdir(), `invoke-worktree-${taskId}-${Date.now()}`)

    execSync(
      `git worktree add "${worktreePath}" -b "${branch}"`,
      { cwd: this.repoDir, stdio: 'pipe' }
    )

    const info: WorktreeInfo = { taskId, worktreePath, branch }
    this.worktrees.set(taskId, info)
    return info
  }

  async merge(taskId: string): Promise<void> {
    const info = this.worktrees.get(taskId)
    if (!info) {
      throw new Error(`No worktree found for task: ${taskId}`)
    }

    execSync(
      `git merge "${info.branch}" --no-edit`,
      { cwd: this.repoDir, stdio: 'pipe' }
    )
  }

  async cleanup(taskId: string): Promise<void> {
    const info = this.worktrees.get(taskId)
    if (!info) return

    if (existsSync(info.worktreePath)) {
      execSync(
        `git worktree remove "${info.worktreePath}" --force`,
        { cwd: this.repoDir, stdio: 'pipe' }
      )
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
}
