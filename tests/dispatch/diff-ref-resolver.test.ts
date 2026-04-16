import * as childProcess from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionManager } from '../../src/session/manager.js'
import { StateManager } from '../../src/tools/state.js'
import { SessionWorktreeManager } from '../../src/worktree/session-worktree.js'
import type { DiffRefResult } from '../../src/types.js'

function git(cwd: string, args: string[]): string {
  return childProcess.execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()
}

type ExecFileAsyncResult = {
  stdout: string | Buffer
  stderr: string | Buffer
}

type ExecFileAsyncImpl = (
  file: string,
  args: readonly string[],
  options: childProcess.ExecFileOptions
) => Promise<ExecFileAsyncResult>

async function createGitRepo(prefix: string): Promise<string> {
  const repoDir = await mkdtemp(path.join(os.tmpdir(), prefix))
  git(repoDir, ['init'])
  git(repoDir, ['branch', '-M', 'main'])
  git(repoDir, ['config', 'user.email', 'test@example.com'])
  git(repoDir, ['config', 'user.name', 'Test User'])
  await writeFile(path.join(repoDir, 'README.md'), '# Test repo\n')
  git(repoDir, ['add', 'README.md'])
  git(repoDir, ['commit', '-m', 'initial'])
  return repoDir
}

describe('DiffRefResolver', () => {
  let tempDirs: string[]

  beforeEach(() => {
    vi.resetModules()
    vi.doUnmock('node:child_process')
    vi.doUnmock('node:util')
    vi.doUnmock('../../src/tools/session-path.js')
    tempDirs = []
  })

  afterEach(async () => {
    vi.doUnmock('node:child_process')
    vi.doUnmock('node:util')
    vi.doUnmock('../../src/tools/session-path.js')
    vi.restoreAllMocks()
    await Promise.all(
      tempDirs.reverse().map(dir => rm(dir, { recursive: true, force: true }))
    )
  })

  async function loadResolver(
    projectDir: string,
    sessionManager: SessionManager,
    execFileAsyncImpl?: ExecFileAsyncImpl,
    sessionPathResolverStub?: (
      sm: SessionManager,
      pd: string | undefined,
      sid?: string
    ) => Promise<string | undefined>
  ) {
    let execFileAsyncMock: ReturnType<typeof vi.fn<ExecFileAsyncImpl>> | undefined

    if (execFileAsyncImpl) {
      const actualUtil = await vi.importActual<typeof import('node:util')>('node:util')
      execFileAsyncMock = vi.fn(execFileAsyncImpl)
      vi.doMock('node:util', () => ({
        ...actualUtil,
        promisify: vi.fn(() => execFileAsyncMock),
      }))
    }

    if (sessionPathResolverStub) {
      const actualSessionPath = await vi.importActual<typeof import('../../src/tools/session-path.js')>(
        '../../src/tools/session-path.js'
      )
      vi.doMock('../../src/tools/session-path.js', () => ({
        ...actualSessionPath,
        resolveSessionWorkBranchPath: sessionPathResolverStub,
      }))
    }

    const { DiffRefResolver } = await import('../../src/dispatch/diff-ref-resolver.js')
    return {
      execFileAsyncMock,
      resolver: new DiffRefResolver(sessionManager, projectDir),
    }
  }

  async function createSessionState(
    projectDir: string,
    sessionId: string,
    updates?: { work_branch?: string; work_branch_path?: string; base_branch?: string }
  ): Promise<SessionManager> {
    const sessionManager = new SessionManager(projectDir)
    const sessionDir = await sessionManager.create(sessionId)
    const stateManager = new StateManager(projectDir, sessionDir)
    await stateManager.initialize(sessionId)
    if (updates) {
      await stateManager.update(updates)
    }
    return sessionManager
  }

  it('returns the full diff from the session merge-base to HEAD in a real git repo', async () => {
    const projectDir = await createGitRepo('invoke-diff-ref-full-')
    tempDirs.push(projectDir)

    const sessionManager = new SessionManager(projectDir)
    const sessionWorktreeManager = new SessionWorktreeManager(projectDir)
    const sessionDir = await sessionManager.create('session-full-diff')
    const stateManager = new StateManager(projectDir, sessionDir)
    await stateManager.initialize('session-full-diff')
    const worktree = await sessionWorktreeManager.create('session-full-diff', 'invoke/sessions', 'main')
    tempDirs.push(worktree.worktreePath)
    await stateManager.update({
      base_branch: 'main',
      work_branch: worktree.workBranch,
      work_branch_path: worktree.worktreePath,
    })

    await writeFile(path.join(worktree.worktreePath, 'feature.txt'), 'line one\nline two\n')
    git(worktree.worktreePath, ['add', 'feature.txt'])
    git(worktree.worktreePath, ['commit', '-m', 'feat: add feature'])

    const { resolver } = await loadResolver(projectDir, sessionManager)
    const result = await resolver.resolve({
      type: 'full_diff',
      session_id: 'session-full-diff',
      base_branch: 'main',
    })

    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.diff).toContain('diff --git a/feature.txt b/feature.txt')
      expect(result.diff).toContain('+line one')
      expect(result.diff).toContain('+line two')
    }
  })

  it('uses the session state base branch instead of the caller-provided full_diff branch', async () => {
    const projectDir = await createGitRepo('invoke-diff-ref-session-base-')
    tempDirs.push(projectDir)

    const sessionManager = new SessionManager(projectDir)
    const sessionWorktreeManager = new SessionWorktreeManager(projectDir)
    const sessionDir = await sessionManager.create('session-state-base-branch')
    const stateManager = new StateManager(projectDir, sessionDir)
    await stateManager.initialize('session-state-base-branch')
    const worktree = await sessionWorktreeManager.create(
      'session-state-base-branch',
      'invoke/sessions',
      'main'
    )
    tempDirs.push(worktree.worktreePath)
    await stateManager.update({
      base_branch: 'main',
      work_branch: worktree.workBranch,
      work_branch_path: worktree.worktreePath,
    })

    await writeFile(path.join(worktree.worktreePath, 'feature.txt'), 'line one\n')
    git(worktree.worktreePath, ['add', 'feature.txt'])
    git(worktree.worktreePath, ['commit', '-m', 'feat: add feature'])

    const { resolver } = await loadResolver(projectDir, sessionManager)
    const result = await resolver.resolve({
      type: 'full_diff',
      session_id: 'session-state-base-branch',
      base_branch: 'missing-branch',
    })

    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.diff).toContain('diff --git a/feature.txt b/feature.txt')
      expect(result.diff).toContain('+line one')
    }
  })

  it('returns the delta diff from the reviewed commit to HEAD in a real git repo', async () => {
    const projectDir = await createGitRepo('invoke-diff-ref-delta-')
    tempDirs.push(projectDir)

    const sessionManager = new SessionManager(projectDir)
    const sessionWorktreeManager = new SessionWorktreeManager(projectDir)
    const sessionDir = await sessionManager.create('session-delta-diff')
    const stateManager = new StateManager(projectDir, sessionDir)
    await stateManager.initialize('session-delta-diff')
    const worktree = await sessionWorktreeManager.create('session-delta-diff', 'invoke/sessions', 'main')
    tempDirs.push(worktree.worktreePath)
    await stateManager.update({
      base_branch: 'main',
      work_branch: worktree.workBranch,
      work_branch_path: worktree.worktreePath,
    })

    await writeFile(path.join(worktree.worktreePath, 'feature-one.txt'), 'first\n')
    git(worktree.worktreePath, ['add', 'feature-one.txt'])
    git(worktree.worktreePath, ['commit', '-m', 'feat: first change'])
    const reviewedSha = git(worktree.worktreePath, ['rev-parse', 'HEAD'])

    await writeFile(path.join(worktree.worktreePath, 'feature-two.txt'), 'second\n')
    git(worktree.worktreePath, ['add', 'feature-two.txt'])
    git(worktree.worktreePath, ['commit', '-m', 'feat: second change'])

    const { resolver } = await loadResolver(projectDir, sessionManager)
    const result = await resolver.resolve({
      type: 'delta_diff',
      session_id: 'session-delta-diff',
      reviewed_sha: reviewedSha,
    })

    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.diff).toContain('diff --git a/feature-two.txt b/feature-two.txt')
      expect(result.diff).toContain('+second')
      expect(result.diff).not.toContain('feature-one.txt')
    }
  })

  it('returns resolve_error when reviewed_sha fails validation', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-diff-ref-invalid-sha-'))
    const worktreePath = await mkdtemp(path.join(os.tmpdir(), 'invoke-diff-ref-worktree-'))
    tempDirs.push(projectDir, worktreePath)
    const sessionManager = await createSessionState(projectDir, 'session-invalid-sha', {
      work_branch: 'invoke/sessions/session-invalid-sha',
      work_branch_path: worktreePath,
      base_branch: 'main',
    })

    const execImpl = vi.fn<ExecFileAsyncImpl>().mockResolvedValue({
      stdout: '',
      stderr: '',
    })

    const { execFileAsyncMock, resolver } = await loadResolver(
      projectDir,
      sessionManager,
      execImpl,
      async () => worktreePath
    )
    const result = await resolver.resolve({
      type: 'delta_diff',
      session_id: 'session-invalid-sha',
      reviewed_sha: '; rm -rf ~',
    })

    expect(result).toEqual({
      status: 'resolve_error',
      message: 'reviewed_sha failed hex validation',
    })
    expect(execFileAsyncMock).not.toHaveBeenCalled()
  })

  it('returns commit_not_found when the reviewed commit does not exist', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-diff-ref-missing-commit-'))
    const worktreePath = await mkdtemp(path.join(os.tmpdir(), 'invoke-diff-ref-worktree-'))
    tempDirs.push(projectDir, worktreePath)
    const sessionManager = await createSessionState(projectDir, 'session-missing-commit', {
      work_branch: 'invoke/sessions/session-missing-commit',
      work_branch_path: worktreePath,
      base_branch: 'main',
    })

    const execImpl = vi.fn<ExecFileAsyncImpl>().mockRejectedValue(
      Object.assign(new Error('fatal: Needed a single revision'), {
        stderr: Buffer.from('fatal: Needed a single revision\n'),
      })
    )

    const { resolver } = await loadResolver(
      projectDir,
      sessionManager,
      execImpl,
      async () => worktreePath
    )
    const result = await resolver.resolve({
      type: 'delta_diff',
      session_id: 'session-missing-commit',
      reviewed_sha: 'abcdef1',
    })

    expect(result).toEqual({
      status: 'commit_not_found',
      message: 'fatal: Needed a single revision',
    })
  })

  it('returns resolve_error when the session worktree path cannot be resolved', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-diff-ref-no-worktree-'))
    tempDirs.push(projectDir)
    const sessionManager = await createSessionState(projectDir, 'session-no-worktree')

    const execImpl = vi.fn<ExecFileAsyncImpl>().mockResolvedValue({
      stdout: '',
      stderr: '',
    })

    const { execFileAsyncMock, resolver } = await loadResolver(
      projectDir,
      sessionManager,
      execImpl,
      async () => undefined
    )
    const result = await resolver.resolve({
      type: 'full_diff',
      session_id: 'session-no-worktree',
      base_branch: 'main',
    })

    expect(result).toEqual({
      status: 'resolve_error',
      message: 'Session worktree path could not be resolved',
    })
    expect(execFileAsyncMock).not.toHaveBeenCalled()
  })

  it('returns diff_too_large when git diff output exceeds the warn threshold', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-diff-ref-large-diff-'))
    const worktreePath = await mkdtemp(path.join(os.tmpdir(), 'invoke-diff-ref-worktree-'))
    tempDirs.push(projectDir, worktreePath)
    const sessionManager = await createSessionState(projectDir, 'session-large-diff', {
      work_branch: 'invoke/sessions/session-large-diff',
      work_branch_path: worktreePath,
      base_branch: 'main',
    })

    const execImpl = vi
      .fn<ExecFileAsyncImpl>()
      .mockResolvedValueOnce({
        stdout: 'abc1234\n',
        stderr: '',
      })
      .mockResolvedValueOnce({
        stdout: 'x'.repeat(49 * 1024 * 1024),
        stderr: '',
      })

    const { resolver } = await loadResolver(
      projectDir,
      sessionManager,
      execImpl,
      async () => worktreePath
    )
    const result = await resolver.resolve({
      type: 'full_diff',
      session_id: 'session-large-diff',
      base_branch: 'main',
    })

    expect(result.status).toBe('diff_too_large')
    if (result.status === 'diff_too_large') {
      expect(result.message).toContain('bytes')
      expect(result.message).toContain('threshold')
    }
  })

  it('returns resolve_error when resolving the session worktree path throws', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-diff-ref-resolve-error-'))
    tempDirs.push(projectDir)
    const sessionManager = await createSessionState(projectDir, 'session-resolve-error')

    const execImpl = vi.fn<ExecFileAsyncImpl>().mockResolvedValue({
      stdout: '',
      stderr: '',
    })

    const { execFileAsyncMock, resolver } = await loadResolver(
      projectDir,
      sessionManager,
      execImpl,
      async () => {
        throw new Error('boom')
      }
    )
    const result = await resolver.resolve({
      type: 'full_diff',
      session_id: 'session-resolve-error',
      base_branch: 'main',
    })

    expect(result).toEqual({
      status: 'resolve_error',
      message: 'boom',
    } satisfies DiffRefResult)
    expect(execFileAsyncMock).not.toHaveBeenCalled()
  })

  it('allows concurrent resolve calls to overlap while git commands are pending', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-diff-ref-overlap-'))
    const worktreePath = await mkdtemp(path.join(os.tmpdir(), 'invoke-diff-ref-worktree-'))
    tempDirs.push(projectDir, worktreePath)
    const sessionManager = await createSessionState(projectDir, 'session-overlap', {
      work_branch: 'invoke/sessions/session-overlap',
      work_branch_path: worktreePath,
      base_branch: 'main',
    })

    const pendingMergeBaseResolvers: Array<(result: ExecFileAsyncResult) => void> = []
    const pendingDiffResolvers: Array<(result: ExecFileAsyncResult) => void> = []

    const execImpl = vi.fn<ExecFileAsyncImpl>().mockImplementation((_file, args, _options) => {
      return new Promise((resolve, reject) => {
        if (args[0] === 'merge-base') {
          pendingMergeBaseResolvers.push(resolve)
        } else if (args[0] === 'diff') {
          pendingDiffResolvers.push(resolve)
        } else {
          reject(new Error(`unexpected git command: ${args[0]}`))
        }
      })
    })

    const { resolver } = await loadResolver(
      projectDir,
      sessionManager,
      execImpl,
      async () => worktreePath
    )

    const firstResolve = resolver.resolve({
      type: 'full_diff',
      session_id: 'session-overlap',
      base_branch: 'ignored-1',
    })

    await vi.waitFor(() => {
      expect(pendingMergeBaseResolvers).toHaveLength(1)
    })

    const secondResolve = resolver.resolve({
      type: 'full_diff',
      session_id: 'session-overlap',
      base_branch: 'ignored-2',
    })

    await vi.waitFor(() => {
      expect(pendingMergeBaseResolvers).toHaveLength(2)
    })

    for (const resolve of pendingMergeBaseResolvers.splice(0)) {
      resolve({ stdout: 'abc1234\n', stderr: '' })
    }

    await vi.waitFor(() => {
      expect(pendingDiffResolvers).toHaveLength(2)
    })

    for (const resolve of pendingDiffResolvers.splice(0)) {
      resolve({ stdout: 'diff --git a/file.txt b/file.txt\n+line\n', stderr: '' })
    }

    await expect(Promise.all([firstResolve, secondResolve])).resolves.toEqual([
      {
        status: 'ok',
        diff: 'diff --git a/file.txt b/file.txt\n+line\n',
      },
      {
        status: 'ok',
        diff: 'diff --git a/file.txt b/file.txt\n+line\n',
      },
    ])
  })
})
