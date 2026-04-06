import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execSync } from 'child_process'
import { existsSync, realpathSync } from 'fs'
import { mkdtemp, rm, symlink, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { buildWorkBranch } from '../../src/worktree/branch-prefix.js'
import { SessionWorktreeManager } from '../../src/worktree/session-worktree.js'

interface ParsedWorktree {
  worktreePath: string
  branchRef: string | null
}

let repoDir: string
let manager: SessionWorktreeManager

function shellQuote(value: string): string {
  return `"${value.replace(/["\\$`]/g, '\\$&')}"`
}

function git(command: string, cwd = repoDir): string {
  return execSync(command, { cwd, stdio: 'pipe' }).toString().trim()
}

function branchExists(branch: string): boolean {
  try {
    execSync(`git show-ref --verify --quiet ${shellQuote(`refs/heads/${branch}`)}`, {
      cwd: repoDir,
      stdio: 'pipe',
    })
    return true
  } catch {
    return false
  }
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

function normalizePath(targetPath: string): string {
  return existsSync(targetPath) ? realpathSync(targetPath) : targetPath
}

function sessionWorktreePathPattern(sessionId: string): RegExp {
  const escapedSessionId = sessionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^invoke-session-${escapedSessionId}-[A-Za-z0-9]{6,}$`)
}

function expectSessionWorktreePath(worktreePath: string, sessionId: string): void {
  const realTmpdir = normalizePath(os.tmpdir())

  expect(worktreePath).toBe(normalizePath(worktreePath))
  expect(path.basename(worktreePath)).toMatch(sessionWorktreePathPattern(sessionId))
  expect(
    worktreePath === realTmpdir || worktreePath.startsWith(realTmpdir + path.sep)
  ).toBe(true)
}

function uniquePath(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
}

beforeEach(async () => {
  repoDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-session-worktree-test-'))
  execSync('git init', { cwd: repoDir, stdio: 'pipe' })
  execSync('git branch -M main', { cwd: repoDir, stdio: 'pipe' })
  execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'pipe' })
  execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'pipe' })
  await writeFile(path.join(repoDir, 'README.md'), '# Test\n')
  execSync('git add .', { cwd: repoDir, stdio: 'pipe' })
  execSync('git commit -m "initial"', { cwd: repoDir, stdio: 'pipe' })
  manager = new SessionWorktreeManager(repoDir)
})

afterEach(async () => {
  try {
    const worktrees = parseWorktreeList(git('git worktree list --porcelain'))
    for (const worktree of worktrees) {
      if (normalizePath(worktree.worktreePath) === normalizePath(repoDir)) {
        continue
      }

      try {
        execSync(`git worktree remove --force ${shellQuote(worktree.worktreePath)}`, {
          cwd: repoDir,
          stdio: 'pipe',
        })
      } catch {
        // Missing directories are cleaned up by prune below.
      }
    }

    try {
      execSync('git worktree prune', { cwd: repoDir, stdio: 'pipe' })
    } catch {
      // Best-effort cleanup for manually deleted directories.
    }

    const branches = git('git for-each-ref --format="%(refname:short)" refs/heads')
      .split('\n')
      .filter(Boolean)

    for (const branch of branches) {
      if (branch === 'main') {
        continue
      }

      try {
        execSync(`git branch -D ${shellQuote(branch)}`, { cwd: repoDir, stdio: 'pipe' })
      } catch {
        // Ignore branches that still cannot be deleted during teardown.
      }
    }
  } finally {
    await rm(repoDir, { recursive: true, force: true })
  }
})

describe('SessionWorktreeManager', () => {
  it('creates a session worktree from main', async () => {
    const sessionId = 'fresh-create'
    const workBranchPrefix = 'invoke/sessions'
    const workBranch = buildWorkBranch(workBranchPrefix, sessionId)

    const info = await manager.create(sessionId, workBranchPrefix, 'main')

    expect(info).toMatchObject({
      sessionId,
      workBranch,
      baseBranch: 'main',
    })
    expectSessionWorktreePath(info.worktreePath, sessionId)
    expect(existsSync(info.worktreePath)).toBe(true)
    expect(existsSync(path.join(info.worktreePath, 'README.md'))).toBe(true)
    expect(git('git branch --show-current', info.worktreePath)).toBe(workBranch)
  })

  it('ignores a pre-existing legacy symlink path when creating a session worktree', async () => {
    const sessionId = `legacy-symlink-${Date.now()}`
    const legacyPath = path.join(os.tmpdir(), `invoke-session-${sessionId}`)
    const externalDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-session-legacy-target-'))

    await symlink(externalDir, legacyPath)

    try {
      const info = await manager.create(sessionId, 'invoke/sessions', 'main')

      expectSessionWorktreePath(info.worktreePath, sessionId)
      expect(info.worktreePath).not.toBe(normalizePath(legacyPath))
      expect(existsSync(path.join(externalDir, 'README.md'))).toBe(false)
    } finally {
      await rm(legacyPath, { force: true })
      await rm(externalDir, { recursive: true, force: true })
    }
  })

  it('is idempotent when create is called twice for the same session', async () => {
    const sessionId = 'idempotent-create'
    const workBranchPrefix = 'invoke/sessions'
    const workBranch = buildWorkBranch(workBranchPrefix, sessionId)

    const first = await manager.create(sessionId, workBranchPrefix, 'main')
    const second = await manager.create(sessionId, workBranchPrefix, 'main')

    expect(second).toEqual(first)

    const matchingWorktrees = parseWorktreeList(git('git worktree list --porcelain'))
      .filter(entry => entry.branchRef === `refs/heads/${workBranch}`)

    expect(matchingWorktrees).toHaveLength(1)
  })

  it('resolves an existing session worktree by work branch', async () => {
    const sessionId = 'resolve-existing'
    const workBranchPrefix = 'invoke/sessions'
    const created = await manager.create(sessionId, workBranchPrefix, 'main')

    const resolved = await manager.resolve(sessionId, created.workBranch)

    expect(resolved).toEqual(created)
  })

  it('returns null when resolving a missing session worktree', async () => {
    const resolved = await manager.resolve('missing-session', 'invoke/sessions/missing-session')

    expect(resolved).toBeNull()
  })

  it('reattaches by returning the existing worktree when it is still present', async () => {
    const sessionId = 'reattach-existing'
    const created = await manager.create(sessionId, 'invoke/sessions', 'main')

    const reattached = await manager.reattach(sessionId, created.workBranch)

    expect(reattached).toEqual(created)
  })

  it('reattaches by recreating the worktree when the directory is missing but the branch exists', async () => {
    const sessionId = 'reattach-missing-dir'
    const created = await manager.create(sessionId, 'invoke/sessions', 'main')

    await rm(created.worktreePath, { recursive: true, force: true })

    const reattached = await manager.reattach(sessionId, created.workBranch)

    expect(reattached).not.toBeNull()
    expect(reattached?.sessionId).toBe(sessionId)
    expect(reattached?.workBranch).toBe(created.workBranch)
    expect(reattached?.baseBranch).toBe('main')
    expect(reattached?.worktreePath).not.toBe(created.worktreePath)
    expectSessionWorktreePath(reattached!.worktreePath, sessionId)
    expect(existsSync(reattached!.worktreePath)).toBe(true)
    expect(git('git branch --show-current', reattached!.worktreePath)).toBe(created.workBranch)
  })

  it('returns null from reattach when both the worktree and branch are gone', async () => {
    const sessionId = 'reattach-both-missing'
    const created = await manager.create(sessionId, 'invoke/sessions', 'main')

    await manager.cleanup(sessionId, created.workBranch, true)

    const reattached = await manager.reattach(sessionId, created.workBranch)

    expect(reattached).toBeNull()
  })

  it('returns null from reattach when the branch exists but is not checked out at the recorded path', async () => {
    const sessionId = 'reattach-wrong-branch'
    const workBranchPrefix = 'invoke/sessions'
    const targetWorkBranch = buildWorkBranch(workBranchPrefix, sessionId)
    const wrongWorkBranch = buildWorkBranch(workBranchPrefix, `${sessionId}-other`)
    const wrongPath = uniquePath('invoke-session-wrong-branch')

    execSync(`git branch ${shellQuote(targetWorkBranch)} main`, { cwd: repoDir, stdio: 'pipe' })
    execSync(
      `git worktree add ${shellQuote(wrongPath)} -b ${shellQuote(wrongWorkBranch)} main`,
      { cwd: repoDir, stdio: 'pipe' }
    )

    const reattached = await manager.reattach(sessionId, targetWorkBranch, wrongPath)

    expect(reattached).toBeNull()
  })

  it('reattaches after cleanup with deleteBranch=false by recreating the worktree', async () => {
    const sessionId = 'reattach-after-cleanup'
    const created = await manager.create(sessionId, 'invoke/sessions', 'main')

    await manager.cleanup(sessionId, created.workBranch, false)

    expect(existsSync(created.worktreePath)).toBe(false)
    expect(branchExists(created.workBranch)).toBe(true)

    const reattached = await manager.reattach(sessionId, created.workBranch)

    expect(reattached).not.toBeNull()
    expect(reattached?.sessionId).toBe(sessionId)
    expect(reattached?.workBranch).toBe(created.workBranch)
    expect(existsSync(reattached!.worktreePath)).toBe(true)
    expect(git('git branch --show-current', reattached!.worktreePath)).toBe(created.workBranch)
  })

  it('cleans up the worktree and keeps the branch when deleteBranch is false', async () => {
    const sessionId = 'cleanup-keep-branch'
    const created = await manager.create(sessionId, 'invoke/sessions', 'main')

    await manager.cleanup(sessionId, created.workBranch, false)

    expect(existsSync(created.worktreePath)).toBe(false)
    expect(branchExists(created.workBranch)).toBe(true)
  })

  it('cleans up the worktree and deletes the branch when deleteBranch is true', async () => {
    const sessionId = 'cleanup-delete-branch'
    const created = await manager.create(sessionId, 'invoke/sessions', 'main')

    await manager.cleanup(sessionId, created.workBranch, true)

    expect(existsSync(created.worktreePath)).toBe(false)
    expect(branchExists(created.workBranch)).toBe(false)
  })

  it('lists only session worktrees identified by session path or known prefix', async () => {
    const workBranchPrefix = 'invoke/sessions'
    const listedByPath = await manager.create('listed-by-path', workBranchPrefix, 'main')
    const listedByBranchId = 'listed-by-branch'
    const listedByBranch = buildWorkBranch(workBranchPrefix, listedByBranchId)
    const listedByBranchPath = uniquePath('prefixed-session-worktree')
    const unrelatedBranch = 'feature/unrelated'
    const unrelatedPath = uniquePath('unrelated-worktree')

    execSync(
      `git worktree add ${shellQuote(listedByBranchPath)} -b ${shellQuote(listedByBranch)} main`,
      { cwd: repoDir, stdio: 'pipe' }
    )
    execSync(
      `git worktree add ${shellQuote(unrelatedPath)} -b ${shellQuote(unrelatedBranch)} main`,
      { cwd: repoDir, stdio: 'pipe' }
    )

    const listed = await manager.listSessionWorktrees()

    expect(listed.map(info => info.workBranch).sort()).toEqual([
      listedByBranch,
      listedByPath.workBranch,
    ].sort())
    expect(listed.find(info => info.workBranch === listedByPath.workBranch)).toEqual(listedByPath)

    const prefixedEntry = listed.find(info => info.workBranch === listedByBranch)
    expect(prefixedEntry).toEqual({
      sessionId: listedByBranchId,
      worktreePath: normalizePath(listedByBranchPath),
      workBranch: listedByBranch,
      baseBranch: null,
    })
    expect(listed.find(info => info.workBranch === unrelatedBranch)).toBeUndefined()
  })
})
