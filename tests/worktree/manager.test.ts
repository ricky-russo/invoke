import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WorktreeManager } from '../../src/worktree/manager.js'
import { SessionWorktreeManager } from '../../src/worktree/session-worktree.js'
import { withRepoLock } from '../../src/worktree/repo-lock.js'
import { execFileSync, execSync } from 'child_process'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { existsSync, realpathSync } from 'fs'
import path from 'path'
import os from 'os'

let repoDir: string
let manager: WorktreeManager

async function createGitRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  execSync('git init', { cwd: dir })
  execSync('git branch -M main', { cwd: dir })
  execSync('git config user.email "test@test.com"', { cwd: dir })
  execSync('git config user.name "Test"', { cwd: dir })
  await writeFile(path.join(dir, 'README.md'), '# Test')
  execSync('git add . && git commit -m "initial"', { cwd: dir })
  return dir
}

beforeEach(async () => {
  repoDir = await createGitRepo('invoke-wt-test-')
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

    const result = await manager.merge('task-1')

    expect(result.status).toBe('merged')
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/)
    expect(existsSync(path.join(repoDir, 'new-file.ts'))).toBe(true)

    // Verify squash merge produces a single commit with the default message
    const log = execSync('git log --oneline -1', { cwd: repoDir }).toString().trim()
    expect(log).toContain('feat: task-1')

    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir }).toString().trim()
    expect(result.commitSha).toBe(headSha)

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

    const result = await manager.merge('task-sandbox')

    expect(result.status).toBe('merged')
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/)
    expect(existsSync(path.join(repoDir, 'sandbox-file.ts'))).toBe(true)
  })

  it('uses a custom commit message when provided', async () => {
    execSync('git checkout -b work-branch-custom', { cwd: repoDir })

    const wt = await manager.create('task-custom')
    await writeFile(path.join(wt.worktreePath, 'custom-file.ts'), 'export const y = 2')
    execSync('git add . && git commit -m "add custom file"', { cwd: wt.worktreePath })

    const result = await manager.merge('task-custom', { commitMessage: 'chore: my custom message' })

    expect(result.status).toBe('merged')
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/)
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

describe('WorktreeManager merge with custom target', () => {
  it('merges into a separately-created worktree when mergeTargetPath is provided', async () => {
    // Create a separate "session" worktree manually (bypassing the manager's task-worktree branch convention)
    const sessionWorktreePath = path.join(os.tmpdir(), `invoke-session-target-${Date.now()}`)
    execSync(`git worktree add "${sessionWorktreePath}" -b "session-target"`, {
      cwd: repoDir,
      stdio: 'pipe',
    })

    try {
      const wt = await manager.create('task-target')
      await writeFile(path.join(wt.worktreePath, 'target-file.ts'), 'export const t = 1')
      execSync('git add . && git commit -m "add target file"', { cwd: wt.worktreePath })

      const result = await manager.merge('task-target', { mergeTargetPath: sessionWorktreePath })

      expect(result.status).toBe('merged')
      expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/)
      // File should be present in the session worktree, NOT in the main repo dir
      expect(existsSync(path.join(sessionWorktreePath, 'target-file.ts'))).toBe(true)
      expect(existsSync(path.join(repoDir, 'target-file.ts'))).toBe(false)

      const log = execSync('git log --oneline -1', { cwd: sessionWorktreePath }).toString().trim()
      expect(log).toContain('feat: task-target')
    } finally {
      execSync(`git worktree remove "${sessionWorktreePath}" --force`, {
        cwd: repoDir,
        stdio: 'pipe',
      })
      execSync('git branch -D "session-target"', { cwd: repoDir, stdio: 'pipe' })
    }
  })

  it('returns conflict result and leaves the target clean when squash merge fails', async () => {
    execSync('git checkout -b conflict-base', { cwd: repoDir })
    await writeFile(path.join(repoDir, 'shared.ts'), 'export const s = "base"')
    execSync('git add . && git commit -m "base shared"', { cwd: repoDir })

    // First worktree: changes shared.ts and merges cleanly
    const wt1 = await manager.create('task-a')
    await writeFile(path.join(wt1.worktreePath, 'shared.ts'), 'export const s = "from-a"')
    execSync('git add . && git commit -m "a changes shared"', { cwd: wt1.worktreePath })
    const r1 = await manager.merge('task-a')
    expect(r1.status).toBe('merged')
    expect(r1.commitSha).toMatch(/^[0-9a-f]{40}$/)

    // Second worktree branched off the original base — its change to shared.ts will conflict
    const wt2 = await manager.create('task-b')
    // Reset wt2's branch to the original commit (before task-a's merge)
    execSync('git reset --hard HEAD~1', { cwd: wt2.worktreePath })
    await writeFile(path.join(wt2.worktreePath, 'shared.ts'), 'export const s = "from-b"')
    execSync('git add . && git commit -m "b changes shared"', { cwd: wt2.worktreePath })

    const result = await manager.merge('task-b')

    expect(result.status).toBe('conflict')
    if (result.status === 'conflict') {
      expect(result.conflictingFiles).toContain('shared.ts')
      expect(result.mergeTargetPath).toBe(repoDir)
    }

    // Target should be fully clean after the reset
    const status = execSync('git status --porcelain', { cwd: repoDir }).toString().trim()
    expect(status).toBe('')
  })

  it('refuses destructive cleanup for an unsafe custom merge target and preserves its files', async () => {
    execSync('git checkout -b unsafe-target-base', { cwd: repoDir })
    await writeFile(path.join(repoDir, 'shared.ts'), 'export const s = "base"')
    execSync('git add . && git commit -m "base shared"', { cwd: repoDir })

    const wt = await manager.create('task-unsafe-target')
    await writeFile(path.join(wt.worktreePath, 'shared.ts'), 'export const s = "from-task"')
    execSync('git add . && git commit -m "task changes shared"', { cwd: wt.worktreePath })

    const attackerPath = await mkdtemp(path.join(os.tmpdir(), 'evil-target-'))
    const attackerBranch = 'evil-target-branch'

    execSync(`git worktree add "${attackerPath}" -b "${attackerBranch}"`, {
      cwd: repoDir,
      stdio: 'pipe',
    })

    try {
      await writeFile(path.join(attackerPath, 'shared.ts'), 'export const s = "from-attacker"')
      execSync('git add . && git commit -m "attacker changes shared"', { cwd: attackerPath })

      const untrackedPath = path.join(attackerPath, 'keep.me')
      await writeFile(untrackedPath, 'do not delete')

      await expect(
        manager.merge('task-unsafe-target', { mergeTargetPath: attackerPath })
      ).rejects.toThrow(/Refusing destructive cleanup on unsafe merge target/)

      expect(existsSync(untrackedPath)).toBe(true)

      const status = execSync('git status --porcelain', { cwd: attackerPath }).toString()
      expect(status).toContain('UU shared.ts')
    } finally {
      execSync(`git worktree remove "${attackerPath}" --force`, {
        cwd: repoDir,
        stdio: 'pipe',
      })
      execSync(`git branch -D "${attackerBranch}"`, { cwd: repoDir, stdio: 'pipe' })
    }
  })

  it('allows destructive cleanup for a valid session worktree merge target', async () => {
    execSync('git checkout -b session-target-base', { cwd: repoDir })
    await writeFile(path.join(repoDir, 'shared.ts'), 'export const s = "base"')
    execSync('git add . && git commit -m "base shared"', { cwd: repoDir })

    const wt = await manager.create('task-session-target')
    await writeFile(path.join(wt.worktreePath, 'shared.ts'), 'export const s = "from-task"')
    execSync('git add . && git commit -m "task changes shared"', { cwd: wt.worktreePath })

    const sessionManager = new SessionWorktreeManager(repoDir)
    const sessionInfo = await sessionManager.create('safe-session', 'invoke/sessions', 'session-target-base')

    try {
      await writeFile(path.join(sessionInfo.worktreePath, 'shared.ts'), 'export const s = "from-session"')
      execSync('git add . && git commit -m "session changes shared"', { cwd: sessionInfo.worktreePath })

      const untrackedPath = path.join(sessionInfo.worktreePath, 'scratch.tmp')
      await writeFile(untrackedPath, 'delete me')

      const result = await manager.merge('task-session-target', {
        mergeTargetPath: sessionInfo.worktreePath,
      })

      expect(result.status).toBe('conflict')
      if (result.status === 'conflict') {
        expect(result.conflictingFiles).toContain('shared.ts')
        expect(result.mergeTargetPath).toBe(sessionInfo.worktreePath)
      }

      expect(existsSync(untrackedPath)).toBe(false)

      const status = execSync('git status --porcelain', { cwd: sessionInfo.worktreePath })
        .toString()
        .trim()
      expect(status).toBe('')
    } finally {
      await sessionManager.cleanup(sessionInfo.sessionId, sessionInfo.workBranch, true)
    }
  })

  it('refuses destructive cleanup for a session-shaped merge target from a different repo', async () => {
    const wt = await manager.create('task-cross-repo-session-target')
    await writeFile(path.join(wt.worktreePath, 'cross-repo.ts'), 'export const crossRepo = true')
    execSync('git add . && git commit -m "add cross repo file"', { cwd: wt.worktreePath })

    const otherRepoDir = await createGitRepo('invoke-wt-foreign-')
    const otherSessionManager = new SessionWorktreeManager(otherRepoDir)
    const otherSession = await otherSessionManager.create(
      'foreign-session',
      'invoke/sessions',
      'main'
    )

    try {
      const untrackedPath = path.join(otherSession.worktreePath, 'keep.me')
      await writeFile(untrackedPath, 'do not delete')

      await expect(
        manager.merge('task-cross-repo-session-target', {
          mergeTargetPath: otherSession.worktreePath,
        })
      ).rejects.toThrow(/Refusing destructive cleanup on unsafe merge target/)

      expect(existsSync(untrackedPath)).toBe(true)

      const status = execSync('git status --porcelain', {
        cwd: otherSession.worktreePath,
      })
        .toString()
        .trim()
      expect(status).toContain('?? keep.me')
    } finally {
      await otherSessionManager.cleanup(otherSession.sessionId, otherSession.workBranch, true)
      await rm(otherRepoDir, { recursive: true, force: true })
    }
  })

  it('preserves untracked files in the default repo target when a merge conflicts', async () => {
    execSync('git checkout -b untracked-base', { cwd: repoDir })
    await writeFile(path.join(repoDir, 'shared.ts'), 'export const s = "base"')
    execSync('git add . && git commit -m "base shared"', { cwd: repoDir })

    // Land a clean change so the next worktree, branched from the prior commit,
    // will conflict on shared.ts
    const wt1 = await manager.create('task-untracked-a')
    await writeFile(path.join(wt1.worktreePath, 'shared.ts'), 'export const s = "from-a"')
    execSync('git add . && git commit -m "a changes shared"', { cwd: wt1.worktreePath })
    await manager.merge('task-untracked-a')

    // Create the conflicting worktree
    const wt2 = await manager.create('task-untracked-b')
    execSync('git reset --hard HEAD~1', { cwd: wt2.worktreePath })
    await writeFile(path.join(wt2.worktreePath, 'shared.ts'), 'export const s = "from-b"')
    execSync('git add . && git commit -m "b changes shared"', { cwd: wt2.worktreePath })

    // The user has an untracked scratch file in their repo dir — this MUST survive a conflict.
    const scratchPath = path.join(repoDir, 'scratch.local.txt')
    await writeFile(scratchPath, 'do not delete me')

    const result = await manager.merge('task-untracked-b')
    expect(result.status).toBe('conflict')
    expect(existsSync(scratchPath)).toBe(true)
  })

  it('throws when squash merge fails for a non-conflict reason (dirty target)', async () => {
    execSync('git checkout -b non-conflict-base', { cwd: repoDir })
    await writeFile(path.join(repoDir, 'shared.ts'), 'export const s = "base"')
    execSync('git add . && git commit -m "base shared"', { cwd: repoDir })

    const wt = await manager.create('task-non-conflict')
    await writeFile(path.join(wt.worktreePath, 'shared.ts'), 'export const s = "from-task"')
    execSync('git add . && git commit -m "task changes shared"', { cwd: wt.worktreePath })

    // Dirty the target with an unstaged change to a file the merge wants to overwrite.
    // git merge --squash refuses, but no conflict markers are produced.
    await writeFile(path.join(repoDir, 'shared.ts'), 'export const s = "dirty local edit"')

    await expect(manager.merge('task-non-conflict')).rejects.toThrow(/git merge --squash/)
  })

  it('commits a commit_message containing shell metacharacters literally', async () => {
    execSync('git checkout -b injection-base', { cwd: repoDir })

    const wt = await manager.create('task-injection')
    await writeFile(path.join(wt.worktreePath, 'inj.ts'), 'export const i = 1')
    execSync('git add . && git commit -m "add inj"', { cwd: wt.worktreePath })

    const dangerous = 'feat: $(echo pwned) and `whoami` "quoted" \\backslash'
    const result = await manager.merge('task-injection', { commitMessage: dangerous })
    expect(result.status).toBe('merged')
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/)

    const subject = execSync('git log -1 --pretty=%s', { cwd: repoDir }).toString().trim()
    expect(subject).toBe(dangerous)
  })

  it('serializes concurrent merge() and cleanup() for the same task id', async () => {
    execSync('git checkout -b race-base', { cwd: repoDir })

    const wt = await manager.create('task-race')
    await writeFile(path.join(wt.worktreePath, 'race.ts'), 'export const r = 1')
    execSync('git add . && git commit -m "race add"', { cwd: wt.worktreePath })

    // merge is initiated first; cleanup is initiated immediately after.
    // Without per-task serialization, cleanup could remove the worktree
    // while merge is still squash-merging from it, corrupting either side.
    const mergePromise = manager.merge('task-race')
    const cleanupPromise = manager.cleanup('task-race')

    const [mergeResult, cleanupResult] = await Promise.all([mergePromise, cleanupPromise])

    expect(mergeResult.status).toBe('merged')
    expect(mergeResult.commitSha).toMatch(/^[0-9a-f]{40}$/)
    expect(cleanupResult).toBeUndefined()

    // After both: file landed in repoDir, worktree gone
    expect(existsSync(path.join(repoDir, 'race.ts'))).toBe(true)
    expect(existsSync(wt.worktreePath)).toBe(false)
  })
})

describe('WorktreeManager mutex helpers', () => {
  it('withRepoLock serializes 3 concurrent calls for the same key', async () => {
    const events: string[] = []
    let active = 0
    let maxActive = 0

    const make = (label: string) =>
      withRepoLock(repoDir, async () => {
        active++
        maxActive = Math.max(maxActive, active)
        events.push(`start:${label}`)
        await new Promise(resolve => setTimeout(resolve, 20))
        events.push(`end:${label}`)
        active--
        return label
      })

    const results = await Promise.all([make('a'), make('b'), make('c')])

    expect(results).toEqual(['a', 'b', 'c'])
    expect(maxActive).toBe(1)
    expect(events).toEqual([
      'start:a',
      'end:a',
      'start:b',
      'end:b',
      'start:c',
      'end:c',
    ])
  })

  it('withMergeTargetLock serializes 3 concurrent merges into the same target', async () => {
    execSync('git checkout -b mutex-merge-base', { cwd: repoDir })

    const wt1 = await manager.create('mtask-1')
    await writeFile(path.join(wt1.worktreePath, 'm1.ts'), 'export const a = 1')
    execSync('git add . && git commit -m "m1"', { cwd: wt1.worktreePath })

    const wt2 = await manager.create('mtask-2')
    await writeFile(path.join(wt2.worktreePath, 'm2.ts'), 'export const b = 2')
    execSync('git add . && git commit -m "m2"', { cwd: wt2.worktreePath })

    const wt3 = await manager.create('mtask-3')
    await writeFile(path.join(wt3.worktreePath, 'm3.ts'), 'export const c = 3')
    execSync('git add . && git commit -m "m3"', { cwd: wt3.worktreePath })

    const results = await Promise.all([
      manager.merge('mtask-1'),
      manager.merge('mtask-2'),
      manager.merge('mtask-3'),
    ])

    for (const r of results) {
      expect(r.status).toBe('merged')
      expect(r.commitSha).toMatch(/^[0-9a-f]{40}$/)
    }
    expect(new Set(results.map(r => r.commitSha)).size).toBe(3)

    // All three files should be present in the main repo dir
    expect(existsSync(path.join(repoDir, 'm1.ts'))).toBe(true)
    expect(existsSync(path.join(repoDir, 'm2.ts'))).toBe(true)
    expect(existsSync(path.join(repoDir, 'm3.ts'))).toBe(true)

    // We should see exactly 3 new commits beyond the initial state
    const log = execSync('git log --oneline', { cwd: repoDir }).toString().trim().split('\n')
    const featCommits = log.filter(line => line.includes('feat: mtask-'))
    expect(featCommits).toHaveLength(3)
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
