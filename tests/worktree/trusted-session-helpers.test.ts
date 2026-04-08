import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execSync } from 'child_process'
import { realpathSync } from 'fs'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import {
  INVOKE_SESSION_BASENAME_PREFIX,
  isSafeSessionWorkBranchPath,
  isSafeWorkBranch,
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
    const realTmpdir = os.tmpdir()
    const mockedTmpdir = trackCleanup(
      await mkdtemp(path.join(realTmpdir, 'invoke-mocked-tmpdir-'))
    )
    const outsideDir = trackCleanup(
      await mkdtemp(path.join(realTmpdir, 'invoke-session-outside-'))
    )
    const tmpdirSpy = vi.spyOn(os, 'tmpdir').mockReturnValue(mockedTmpdir)

    try {
      const canonicalOutside = realpathSync(outsideDir)
      const canonicalMockedTmpdir = realpathSync(mockedTmpdir)
      expect(canonicalOutside.startsWith(canonicalMockedTmpdir + path.sep)).toBe(false)
      expect(isSafeSessionWorkBranchPath(outsideDir, repoDir)).toBe(false)
    } finally {
      tmpdirSpy.mockRestore()
    }
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

describe('INVOKE_SESSION_BASENAME_PREFIX', () => {
  it('is exported and equals the canonical session basename prefix', () => {
    expect(INVOKE_SESSION_BASENAME_PREFIX).toBe('invoke-session-')
  })
})

describe('isSafeWorkBranch', () => {
  it('returns true when workBranch matches `${prefix}/${sessionId}` exactly', () => {
    expect(isSafeWorkBranch('invoke/work/sess-abc', 'sess-abc', 'invoke/work')).toBe(true)
  })

  it('returns false for undefined workBranch', () => {
    expect(isSafeWorkBranch(undefined, 'sess-abc', 'invoke/work')).toBe(false)
  })

  it('returns false for an empty workBranch', () => {
    expect(isSafeWorkBranch('', 'sess-abc', 'invoke/work')).toBe(false)
  })

  it('returns false when the prefix differs', () => {
    expect(isSafeWorkBranch('other/prefix/sess-abc', 'sess-abc', 'invoke/work')).toBe(false)
  })

  it('returns false when the sessionId differs', () => {
    expect(isSafeWorkBranch('invoke/work/sess-xyz', 'sess-abc', 'invoke/work')).toBe(false)
  })

  it('returns false for a partial match (prefix without sessionId)', () => {
    expect(isSafeWorkBranch('invoke/work', 'sess-abc', 'invoke/work')).toBe(false)
  })
})

describe('resolveGitCommonDir memoization', () => {
  it('does NOT cache successful resolutions between calls without an explicit memo', async () => {
    // Regression guard for the removed module-scoped cache (security finding:
    // the old global cache was a "poisoned-on-first-read" hazard — if an
    // attacker swapped the path after a benign first read, the cache kept
    // approving the swapped path). Successive calls without a memo must now
    // re-resolve every time so path changes are visible immediately.
    const freshRepo = trackCleanup(
      await createGitRepo('invoke-trusted-helpers-no-cache-')
    )
    const expected = realpathSync(path.join(freshRepo, '.git'))

    const first = resolveGitCommonDir(freshRepo)
    expect(first).toBe(expected)

    // Tear down .git. With the module-scoped cache removed, a second call
    // must observe the teardown and return null.
    await rm(path.join(freshRepo, '.git'), { recursive: true, force: true })

    const second = resolveGitCommonDir(freshRepo)
    expect(second).toBeNull()
  })

  it('honors an explicit per-call memo so one logical check only runs git once per cwd', async () => {
    // The per-call memo scopes caching to a single invocation of
    // `resolveSafeSessionWorkBranchPath` (or any other caller that opts in).
    // Within that memo, repeated lookups for the same cwd reuse the resolved
    // value — which is important because that function does two common-dir
    // lookups (target + repo) that almost always hit overlapping cwds.
    const freshRepo = trackCleanup(
      await createGitRepo('invoke-trusted-helpers-memo-')
    )
    const expected = realpathSync(path.join(freshRepo, '.git'))

    const memo = new Map<string, string>()
    const first = resolveGitCommonDir(freshRepo, memo)
    expect(first).toBe(expected)
    expect(memo.get(freshRepo)).toBe(expected)

    // Tear down .git and confirm the memo still returns the cached value
    // (this is the whole point of the per-call memo — within one safety
    // check we treat the filesystem as stable).
    await rm(path.join(freshRepo, '.git'), { recursive: true, force: true })

    const second = resolveGitCommonDir(freshRepo, memo)
    expect(second).toBe(expected)
  })
})
