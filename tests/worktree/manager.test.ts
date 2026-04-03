import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WorktreeManager } from '../../src/worktree/manager.js'
import { execSync } from 'child_process'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { existsSync, realpathSync } from 'fs'
import path from 'path'
import os from 'os'

let repoDir: string
let manager: WorktreeManager

beforeEach(async () => {
  repoDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-wt-test-'))
  execSync('git init', { cwd: repoDir })
  execSync('git config user.email "test@test.com"', { cwd: repoDir })
  execSync('git config user.name "Test"', { cwd: repoDir })
  await writeFile(path.join(repoDir, 'README.md'), '# Test')
  execSync('git add . && git commit -m "initial"', { cwd: repoDir })
  manager = new WorktreeManager(repoDir)
})

afterEach(async () => {
  await manager.cleanupAll()
  await rm(repoDir, { recursive: true, force: true })
})

describe('WorktreeManager', () => {
  it('creates a worktree and returns its path', async () => {
    const result = await manager.create('task-1')

    expect(result.worktreePath).toBeTruthy()
    expect(result.branch).toContain('task-1')
    expect(existsSync(result.worktreePath)).toBe(true)
    expect(existsSync(path.join(result.worktreePath, 'README.md'))).toBe(true)
  })

  it('creates multiple worktrees', async () => {
    const wt1 = await manager.create('task-1')
    const wt2 = await manager.create('task-2')

    expect(wt1.worktreePath).not.toBe(wt2.worktreePath)
    expect(existsSync(wt1.worktreePath)).toBe(true)
    expect(existsSync(wt2.worktreePath)).toBe(true)
  })

  it('squash merges a worktree back into the work branch', async () => {
    execSync('git checkout -b work-branch', { cwd: repoDir })

    const wt = await manager.create('task-1')
    await writeFile(path.join(wt.worktreePath, 'new-file.ts'), 'export const x = 1')
    execSync('git add . && git commit -m "add new file"', { cwd: wt.worktreePath })

    await manager.merge('task-1')

    expect(existsSync(path.join(repoDir, 'new-file.ts'))).toBe(true)

    // Verify squash merge produces a single commit with the default message
    const log = execSync('git log --oneline -1', { cwd: repoDir }).toString().trim()
    expect(log).toContain('feat: task-1')

    // Verify it is NOT a merge commit (squash merge has only one parent)
    const parentCount = execSync('git cat-file -p HEAD', { cwd: repoDir })
      .toString()
      .split('\n')
      .filter(line => line.startsWith('parent')).length
    expect(parentCount).toBe(1)
  })

  it('auto-commits uncommitted worktree changes before merge (sandbox agents)', async () => {
    execSync('git checkout -b work-branch-sandbox', { cwd: repoDir })

    const wt = await manager.create('task-sandbox')
    // Simulate agent writing a file without committing (sandbox restriction)
    await writeFile(path.join(wt.worktreePath, 'sandbox-file.ts'), 'export const z = 3')

    await manager.merge('task-sandbox')

    expect(existsSync(path.join(repoDir, 'sandbox-file.ts'))).toBe(true)
  })

  it('uses a custom commit message when provided', async () => {
    execSync('git checkout -b work-branch-custom', { cwd: repoDir })

    const wt = await manager.create('task-custom')
    await writeFile(path.join(wt.worktreePath, 'custom-file.ts'), 'export const y = 2')
    execSync('git add . && git commit -m "add custom file"', { cwd: wt.worktreePath })

    await manager.merge('task-custom', 'chore: my custom message')

    const log = execSync('git log --oneline -1', { cwd: repoDir }).toString().trim()
    expect(log).toContain('chore: my custom message')
  })

  it('removes a worktree on cleanup', async () => {
    const wt = await manager.create('task-1')
    expect(existsSync(wt.worktreePath)).toBe(true)

    await manager.cleanup('task-1')
    expect(existsSync(wt.worktreePath)).toBe(false)
  })

  it('lists active worktrees', async () => {
    await manager.create('task-1')
    await manager.create('task-2')

    const active = manager.listActive()
    expect(active).toHaveLength(2)
    expect(active.map(a => a.taskId)).toContain('task-1')
    expect(active.map(a => a.taskId)).toContain('task-2')
  })
})

describe('discoverOrphaned', () => {
  it('returns empty array when no invoke worktrees exist', async () => {
    const orphaned = await manager.discoverOrphaned()
    expect(orphaned).toEqual([])
  })

  it('returns worktrees on disk not tracked in memory', async () => {
    const wt = await manager.create('task-orphan')
    const worktreePath = wt.worktreePath

    // Simulate orphan: remove from in-memory tracking without cleaning up disk
    await manager.cleanup('task-orphan')

    // Re-create the worktree directly via git (bypassing the manager) to simulate orphan
    execSync(
      `git worktree add "${worktreePath}" -b "invoke-wt-task-orphan"`,
      { cwd: repoDir, stdio: 'pipe' }
    )

    try {
      const orphaned = await manager.discoverOrphaned()
      expect(orphaned).toHaveLength(1)
      expect(orphaned[0].taskId).toBe('task-orphan')
      expect(orphaned[0].branch).toBe('invoke-wt-task-orphan')
      expect(realpathSync(orphaned[0].worktreePath)).toBe(realpathSync(worktreePath))
    } finally {
      execSync(`git worktree remove "${worktreePath}" --force`, { cwd: repoDir, stdio: 'pipe' })
      execSync('git branch -D "invoke-wt-task-orphan"', { cwd: repoDir, stdio: 'pipe' })
    }
  })

  it('does not return worktrees already tracked in memory', async () => {
    await manager.create('task-tracked')

    const orphaned = await manager.discoverOrphaned()
    expect(orphaned.find(o => o.taskId === 'task-tracked')).toBeUndefined()
  })
})
