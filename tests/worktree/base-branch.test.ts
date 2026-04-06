import { describe, it, expect, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'

import {
  branchExists,
  discoverBaseBranchCandidates,
} from '../../src/worktree/base-branch.js'

const tempDirs: string[] = []

function runGit(repoDir: string, command: string): string {
  return execSync(command, {
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

  runGit(repoDir, 'git init')
  runGit(repoDir, 'git config user.email "test@test.com"')
  runGit(repoDir, 'git config user.name "Test User"')

  const initialBranch = options?.initialBranch ?? 'main'
  runGit(repoDir, `git symbolic-ref HEAD refs/heads/${initialBranch}`)

  if (options?.withCommit ?? true) {
    await writeFile(path.join(repoDir, 'README.md'), '# Test repo\n')
    runGit(repoDir, 'git add README.md')
    runGit(repoDir, 'git commit -m "initial commit"')
  }

  return repoDir
}

async function createBareRemote(initialBranch = 'main'): Promise<string> {
  const remoteDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-base-branch-remote-'))
  tempDirs.push(remoteDir)

  runGit(remoteDir, 'git init --bare')
  runGit(remoteDir, `git symbolic-ref HEAD refs/heads/${initialBranch}`)

  return remoteDir
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).reverse().map(dir => rm(dir, { recursive: true, force: true }))
  )
})

describe('discoverBaseBranchCandidates', () => {
  it('returns current head, default branch from origin/HEAD, and all local branches', async () => {
    const repoDir = await createRepo()
    const remoteDir = await createBareRemote()

    runGit(repoDir, 'git branch feature/test-branch')
    runGit(repoDir, `git remote add origin "${remoteDir}"`)
    runGit(repoDir, 'git push -u origin main feature/test-branch')
    runGit(repoDir, 'git fetch origin')
    runGit(repoDir, 'git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main')

    const result = discoverBaseBranchCandidates(repoDir)

    expect(result).toEqual({
      currentHead: 'main',
      defaultBranch: 'main',
      allLocalBranches: ['feature/test-branch', 'main'],
    })
  })

  it('returns null for currentHead when HEAD is detached', async () => {
    const repoDir = await createRepo()

    runGit(repoDir, 'git branch feature/test-branch')
    runGit(repoDir, 'git switch --detach HEAD')

    const result = discoverBaseBranchCandidates(repoDir)

    expect(result.currentHead).toBeNull()
    expect(result.defaultBranch).toBe('main')
    expect(result.allLocalBranches).toEqual(['feature/test-branch', 'main'])
  })

  it('falls back to master when main is missing and no origin/HEAD ref exists', async () => {
    const repoDir = await createRepo({ initialBranch: 'master' })

    runGit(repoDir, 'git branch release')

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
})

describe('branchExists', () => {
  it('returns true for an existing branch and false for a missing branch', async () => {
    const repoDir = await createRepo()

    runGit(repoDir, 'git branch feature/existing')

    expect(branchExists(repoDir, 'feature/existing')).toBe(true)
    expect(branchExists(repoDir, 'missing-branch')).toBe(false)
  })
})
