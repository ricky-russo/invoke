import { describe, it, expect, afterEach, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'

import {
  branchExists,
  discoverBaseBranchCandidates,
} from '../../src/worktree/base-branch.js'

const tempDirs: string[] = []

function runGit(repoDir: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoDir,
    stdio: 'pipe',
  }).toString().trim()
}

async function createRepo(options?: {
  initialBranch?: string
  withCommit?: boolean
}): Promise<string> {
  const repoDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-base-branch-'))
  tempDirs.push(repoDir)

  runGit(repoDir, ['init'])
  runGit(repoDir, ['config', 'user.email', 'test@test.com'])
  runGit(repoDir, ['config', 'user.name', 'Test User'])

  const initialBranch = options?.initialBranch ?? 'main'
  runGit(repoDir, ['symbolic-ref', 'HEAD', `refs/heads/${initialBranch}`])

  if (options?.withCommit ?? true) {
    await writeFile(path.join(repoDir, 'README.md'), '# Test repo\n')
    runGit(repoDir, ['add', 'README.md'])
    runGit(repoDir, ['commit', '-m', 'initial commit'])
  }

  return repoDir
}

async function createBareRemote(initialBranch = 'main'): Promise<string> {
  const remoteDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-base-branch-remote-'))
  tempDirs.push(remoteDir)

  runGit(remoteDir, ['init', '--bare'])
  runGit(remoteDir, ['symbolic-ref', 'HEAD', `refs/heads/${initialBranch}`])

  return remoteDir
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    tempDirs.splice(0).reverse().map(dir => rm(dir, { recursive: true, force: true }))
  )
})

describe('discoverBaseBranchCandidates', () => {
  it('returns current head, default branch from origin/HEAD, and all local branches', async () => {
    const repoDir = await createRepo()
    const remoteDir = await createBareRemote()

    runGit(repoDir, ['branch', 'feature/test-branch'])
    runGit(repoDir, ['remote', 'add', 'origin', remoteDir])
    runGit(repoDir, ['push', '-u', 'origin', 'main', 'feature/test-branch'])
    runGit(repoDir, ['fetch', 'origin'])
    runGit(repoDir, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'])

    const result = discoverBaseBranchCandidates(repoDir)

    expect(result).toEqual({
      currentHead: 'main',
      defaultBranch: 'main',
      allLocalBranches: ['feature/test-branch', 'main'],
    })
  })

  it('returns null for currentHead when HEAD is detached', async () => {
    const repoDir = await createRepo()

    runGit(repoDir, ['branch', 'feature/test-branch'])
    runGit(repoDir, ['switch', '--detach', 'HEAD'])

    const result = discoverBaseBranchCandidates(repoDir)

    expect(result.currentHead).toBeNull()
    expect(result.defaultBranch).toBe('main')
    expect(result.allLocalBranches).toEqual(['feature/test-branch', 'main'])
  })

  it('falls back to master when main is missing and no origin/HEAD ref exists', async () => {
    const repoDir = await createRepo({ initialBranch: 'master' })

    runGit(repoDir, ['branch', 'release'])

    const result = discoverBaseBranchCandidates(repoDir)

    expect(result).toEqual({
      currentHead: 'master',
      defaultBranch: 'master',
      allLocalBranches: ['master', 'release'],
    })
  })

  it('returns null for the default branch when the repo has no branches yet', async () => {
    const repoDir = await createRepo({ withCommit: false })

    const result = discoverBaseBranchCandidates(repoDir)

    expect(result.currentHead).toBe('main')
    expect(result.defaultBranch).toBeNull()
    expect(result.allLocalBranches).toEqual([])
  })

  it('lists branches with shell-significant characters without escaping', async () => {
    const repoDir = await createRepo()

    runGit(repoDir, ['branch', 'feature$test'])
    runGit(repoDir, ['branch', 'feat"quote'])

    const result = discoverBaseBranchCandidates(repoDir)

    expect(result.currentHead).toBe('main')
    expect(result.defaultBranch).toBe('main')
    expect([...result.allLocalBranches].sort()).toEqual([
      'feat"quote',
      'feature$test',
      'main',
    ])
  })
})

describe('branchExists', () => {
  it('returns true for an existing branch and false for a missing branch', async () => {
    const repoDir = await createRepo()

    runGit(repoDir, ['branch', 'feature/existing'])

    expect(branchExists(repoDir, 'feature/existing')).toBe(true)
    expect(branchExists(repoDir, 'missing-branch')).toBe(false)
  })

  it('passes special-character branch names as raw git args', async () => {
    vi.resetModules()

    const execFileSyncMock = vi.fn((command: string, args: string[]) => {
      if (command === 'git' && args[0] === 'show-ref' && args[1] === '--verify') {
        return Buffer.from('')
      }

      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
    })

    vi.doMock('child_process', () => ({
      execFileSync: execFileSyncMock,
    }))

    try {
      const { branchExists: mockedBranchExists } = await import('../../src/worktree/base-branch.js')

      expect(mockedBranchExists('/tmp/repo', 'feature$test')).toBe(true)
      expect(mockedBranchExists('/tmp/repo', 'feat"quote')).toBe(true)
      expect(execFileSyncMock).toHaveBeenNthCalledWith(
        1,
        'git',
        ['show-ref', '--verify', 'refs/heads/feature$test'],
        {
          cwd: '/tmp/repo',
          stdio: 'pipe',
        }
      )
      expect(execFileSyncMock).toHaveBeenNthCalledWith(
        2,
        'git',
        ['show-ref', '--verify', 'refs/heads/feat"quote'],
        {
          cwd: '/tmp/repo',
          stdio: 'pipe',
        }
      )
    } finally {
      vi.doUnmock('child_process')
      vi.resetModules()
    }
  })
})
