import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execSync } from 'child_process'
import { realpathSync } from 'fs'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import {
  isSafeSessionWorkBranchPath,
  isSafeSessionWorktreeTarget,
  resolveGitCommonDir,
} from '../../src/worktree/trusted-session-helpers.js'

async function createGitRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  execSync('git init', { cwd: dir, stdio: 'pipe' })
  execSync('git branch -M main', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' })
  await writeFile(path.join(dir, 'README.md'), '# Test')
  execSync('git add . && git commit -m "initial"', { cwd: dir, stdio: 'pipe' })
  return dir
}

let repoDir: string
const cleanupTargets: string[] = []

beforeEach(async () => {
  repoDir = await createGitRepo('invoke-trusted-helpers-test-')
})

afterEach(async () => {
  for (const target of cleanupTargets.splice(0)) {
    await rm(target, { recursive: true, force: true })
  }
  await rm(repoDir, { recursive: true, force: true })
})

function trackCleanup(p: string): string {
  cleanupTargets.push(p)
  return p
}

describe('resolveGitCommonDir', () => {
  it('returns null for a non-git directory', async () => {
    const nonGitDir = trackCleanup(await mkdtemp(path.join(os.tmpdir(), 'invoke-not-a-repo-')))
    expect(resolveGitCommonDir(nonGitDir)).toBeNull()
  })

  it('returns null when cwd does not exist', () => {
    expect(resolveGitCommonDir('/no/such/path/should/exist/anywhere')).toBeNull()
  })

  it('returns the canonical realpath for a git repo', () => {
    const result = resolveGitCommonDir(repoDir)
    expect(result).not.toBeNull()
    expect(result).toBe(realpathSync(path.join(repoDir, '.git')))
  })

  it('handles relative `.git` output by resolving against cwd', () => {
    // git rev-parse --git-common-dir returns '.git' for a normal repo,
    // which must be resolved against cwd before realpath.
    const result = resolveGitCommonDir(repoDir)
    expect(result).toBe(realpathSync(path.resolve(repoDir, '.git')))
  })
})

describe('isSafeSessionWorkBranchPath', () => {
  it('returns false for undefined', () => {
    expect(isSafeSessionWorkBranchPath(undefined, repoDir)).toBe(false)
  })

  it('returns false for an empty string', () => {
    expect(isSafeSessionWorkBranchPath('', repoDir)).toBe(false)
  })

  it('returns false for a relative path', () => {
    expect(isSafeSessionWorkBranchPath('relative/invoke-session-foo', repoDir)).toBe(false)
  })

  it('returns false for a path outside tmpdir', async () => {
    // Create a session-shaped directory in the user's home — outside tmpdir.
    // We can't use mkdtemp under tmpdir for this test, since paths there
    // would (correctly) pass the location check.
    const outsideDir = trackCleanup(
      await mkdtemp(path.join(os.homedir(), 'invoke-session-outside-'))
    )
    expect(isSafeSessionWorkBranchPath(outsideDir, repoDir)).toBe(false)
  })

  it('returns false for a path under tmpdir but with the wrong basename', async () => {
    const wrongName = trackCleanup(
      await mkdtemp(path.join(os.tmpdir(), 'not-a-session-'))
    )
    expect(isSafeSessionWorkBranchPath(wrongName, repoDir)).toBe(false)
  })

  it('returns false for a session-shaped path that is not actually a worktree', async () => {
    const fakeSession = trackCleanup(
      await mkdtemp(path.join(os.tmpdir(), 'invoke-session-fake-'))
    )
    // No git here at all — resolveGitCommonDir returns null.
    expect(isSafeSessionWorkBranchPath(fakeSession, repoDir)).toBe(false)
  })

  it('returns false for a session-shaped worktree of a different repo', async () => {
    const otherRepo = trackCleanup(await createGitRepo('invoke-trusted-helpers-other-'))
    const otherSessionPath = path.join(
      os.tmpdir(),
      `invoke-session-other-${Date.now()}`
    )
    execSync(
      `git worktree add "${otherSessionPath}" -b "trusted-helpers-other"`,
      { cwd: otherRepo, stdio: 'pipe' }
    )
    trackCleanup(otherSessionPath)

    try {
      expect(isSafeSessionWorkBranchPath(otherSessionPath, repoDir)).toBe(false)
    } finally {
      execSync(`git worktree remove "${otherSessionPath}" --force`, {
        cwd: otherRepo,
        stdio: 'pipe',
      })
      execSync('git branch -D "trusted-helpers-other"', { cwd: otherRepo, stdio: 'pipe' })
    }
  })

  it('returns true for a real session worktree of the test repo', () => {
    const sessionPath = path.join(
      os.tmpdir(),
      `invoke-session-real-${Date.now()}`
    )
    execSync(
      `git worktree add "${sessionPath}" -b "trusted-helpers-session"`,
      { cwd: repoDir, stdio: 'pipe' }
    )
    trackCleanup(sessionPath)

    try {
      expect(isSafeSessionWorkBranchPath(sessionPath, repoDir)).toBe(true)
    } finally {
      execSync(`git worktree remove "${sessionPath}" --force`, {
        cwd: repoDir,
        stdio: 'pipe',
      })
      execSync('git branch -D "trusted-helpers-session"', { cwd: repoDir, stdio: 'pipe' })
    }
  })
})

describe('isSafeSessionWorktreeTarget', () => {
  it('delegates to isSafeSessionWorkBranchPath', () => {
    // Same false case as isSafeSessionWorkBranchPath
    expect(isSafeSessionWorktreeTarget('relative/invoke-session-foo', repoDir)).toBe(false)
  })

  it('returns true for a real session worktree of the test repo', () => {
    const sessionPath = path.join(
      os.tmpdir(),
      `invoke-session-target-${Date.now()}`
    )
    execSync(
      `git worktree add "${sessionPath}" -b "trusted-helpers-target"`,
      { cwd: repoDir, stdio: 'pipe' }
    )
    trackCleanup(sessionPath)

    try {
      expect(isSafeSessionWorktreeTarget(sessionPath, repoDir)).toBe(true)
    } finally {
      execSync(`git worktree remove "${sessionPath}" --force`, {
        cwd: repoDir,
        stdio: 'pipe',
      })
      execSync('git branch -D "trusted-helpers-target"', { cwd: repoDir, stdio: 'pipe' })
    }
  })
})
