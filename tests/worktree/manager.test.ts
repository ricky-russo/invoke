import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WorktreeManager } from '../../src/worktree/manager.js'
import { execSync } from 'child_process'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
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

  it('merges a worktree back into the work branch', async () => {
    execSync('git checkout -b work-branch', { cwd: repoDir })

    const wt = await manager.create('task-1')
    await writeFile(path.join(wt.worktreePath, 'new-file.ts'), 'export const x = 1')
    execSync('git add . && git commit -m "add new file"', { cwd: wt.worktreePath })

    await manager.merge('task-1')

    expect(existsSync(path.join(repoDir, 'new-file.ts'))).toBe(true)
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
