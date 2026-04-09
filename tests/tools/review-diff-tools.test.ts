import * as childProcess from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionManager } from '../../src/session/manager.js'
import { StateManager } from '../../src/tools/state.js'
import { SessionWorktreeManager } from '../../src/worktree/session-worktree.js'

type ToolResponse = {
  content: Array<{ type: string; text: string }>
  isError?: boolean
}

type ReviewDiffResult =
  | { status: 'ok'; reviewed_sha: string; diff: string }
  | { status: 'invalid_reviewed_sha'; message: string }
  | { status: 'commit_not_found'; message: string }
  | { status: 'diff_error'; message: string }
  | { status: 'not_supported'; message: string }

type RegisteredTool = {
  config: {
    inputSchema: {
      safeParse: (input: unknown) => { success: boolean }
    }
  }
  handler: (input: Record<string, unknown>) => Promise<ToolResponse>
}

function git(cwd: string, args: string[]): string {
  return childProcess.execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()
}

function parseResponse(result: ToolResponse): ReviewDiffResult {
  return JSON.parse(result.content[0].text) as ReviewDiffResult
}

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

describe('registerReviewDiffTools', () => {
  let tempDirs: string[]

  beforeEach(() => {
    vi.resetModules()
    vi.doUnmock('node:child_process')
    tempDirs = []
  })

  afterEach(async () => {
    vi.doUnmock('node:child_process')
    vi.restoreAllMocks()
    await Promise.all(
      tempDirs.reverse().map(dir => rm(dir, { recursive: true, force: true }))
    )
  })

  async function registerTool(
    projectDir: string,
    sessionManager: SessionManager,
    execFileSyncImpl?: typeof childProcess.execFileSync
  ): Promise<{ execFileSyncMock: ReturnType<typeof vi.fn>; tool: RegisteredTool }> {
    const registeredTools = new Map<string, RegisteredTool>()
    const registerTool = vi.fn((name: string, config: RegisteredTool['config'], handler: RegisteredTool['handler']) => {
      registeredTools.set(name, { config, handler })
    })
    const server = { registerTool } as unknown as McpServer
    const actualChildProcess = await vi.importActual<typeof import('node:child_process')>('node:child_process')
    const execFileSyncMock = vi.fn(execFileSyncImpl ?? actualChildProcess.execFileSync)

    vi.doMock('node:child_process', () => ({
      ...actualChildProcess,
      execFileSync: execFileSyncMock,
    }))

    const { registerReviewDiffTools } = await import('../../src/tools/review-diff-tools.js')

    registerReviewDiffTools(server, sessionManager, projectDir)

    const tool = registeredTools.get('invoke_compute_review_diff')
    if (!tool) {
      throw new Error('Tool invoke_compute_review_diff was not registered')
    }
    return { execFileSyncMock, tool }
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

  it('passes exact git argv tokens for rev-parse and diff', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-review-diff-unit-'))
    const worktreePath = await mkdtemp(path.join(os.tmpdir(), 'invoke-review-diff-worktree-'))
    tempDirs.push(projectDir, worktreePath)
    const sessionManager = await createSessionState(projectDir, 'session-review-diff', {
      work_branch: 'invoke/sessions/session-review-diff',
      work_branch_path: worktreePath,
      base_branch: 'main',
    })
    const execImpl = vi
      .fn<typeof childProcess.execFileSync>()
      .mockReturnValueOnce(Buffer.from('abc1234\n'))
      .mockReturnValueOnce(Buffer.from('diff --git a/file.txt b/file.txt\n'))

    const { execFileSyncMock, tool } = await registerTool(projectDir, sessionManager, execImpl)
    const result = await tool.handler({
      session_id: 'session-review-diff',
      reviewed_sha: 'abc1234',
    })

    expect(execFileSyncMock).toHaveBeenNthCalledWith(
      1,
      'git',
      ['rev-parse', '--verify', 'abc1234^{commit}'],
      { cwd: worktreePath, stdio: 'pipe', timeout: 10000 }
    )
    expect(execFileSyncMock).toHaveBeenNthCalledWith(
      2,
      'git',
      ['diff', 'abc1234...HEAD'],
      { cwd: worktreePath, stdio: 'pipe', timeout: 30000 }
    )
    expect(parseResponse(result)).toEqual({
      status: 'ok',
      reviewed_sha: 'abc1234',
      diff: 'diff --git a/file.txt b/file.txt\n',
    })
  })

  it("rejects '; rm -rf ~' before invoking git", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-review-diff-unit-'))
    const worktreePath = await mkdtemp(path.join(os.tmpdir(), 'invoke-review-diff-worktree-'))
    tempDirs.push(projectDir, worktreePath)
    const sessionManager = await createSessionState(projectDir, 'session-bad-sha-1', {
      work_branch: 'invoke/sessions/session-bad-sha-1',
      work_branch_path: worktreePath,
      base_branch: 'main',
    })
    const { execFileSyncMock, tool } = await registerTool(projectDir, sessionManager)

    const result = await tool.handler({
      session_id: 'session-bad-sha-1',
      reviewed_sha: '; rm -rf ~',
    })

    expect(parseResponse(result)).toEqual({
      status: 'invalid_reviewed_sha',
      message: 'reviewed_sha failed hex validation',
    })
    expect(execFileSyncMock).not.toHaveBeenCalled()
  })

  it("rejects '$(evil)' before invoking git", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-review-diff-unit-'))
    const worktreePath = await mkdtemp(path.join(os.tmpdir(), 'invoke-review-diff-worktree-'))
    tempDirs.push(projectDir, worktreePath)
    const sessionManager = await createSessionState(projectDir, 'session-bad-sha-2', {
      work_branch: 'invoke/sessions/session-bad-sha-2',
      work_branch_path: worktreePath,
      base_branch: 'main',
    })
    const { execFileSyncMock, tool } = await registerTool(projectDir, sessionManager)

    const result = await tool.handler({
      session_id: 'session-bad-sha-2',
      reviewed_sha: '$(evil)',
    })

    expect(parseResponse(result)).toEqual({
      status: 'invalid_reviewed_sha',
      message: 'reviewed_sha failed hex validation',
    })
    expect(execFileSyncMock).not.toHaveBeenCalled()
  })

  it('returns the diff between a reviewed commit and HEAD in a real git repo', async () => {
    const projectDir = await createGitRepo('invoke-review-diff-integration-')
    tempDirs.push(projectDir)
    const sessionManager = new SessionManager(projectDir)
    const sessionWorktreeManager = new SessionWorktreeManager(projectDir)
    const sessionDir = await sessionManager.create('session-integration')
    const stateManager = new StateManager(projectDir, sessionDir)
    await stateManager.initialize('session-integration')
    const worktree = await sessionWorktreeManager.create('session-integration', 'invoke/sessions', 'main')
    tempDirs.push(worktree.worktreePath)
    await stateManager.update({
      base_branch: 'main',
      work_branch: worktree.workBranch,
      work_branch_path: worktree.worktreePath,
    })

    const firstSha = git(worktree.worktreePath, ['rev-parse', 'HEAD'])
    await writeFile(path.join(worktree.worktreePath, 'feature.txt'), 'line one\nline two\n')
    git(worktree.worktreePath, ['add', 'feature.txt'])
    git(worktree.worktreePath, ['commit', '-m', 'feat: add feature'])

    const { tool } = await registerTool(projectDir, sessionManager)
    const result = await tool.handler({
      session_id: 'session-integration',
      reviewed_sha: firstSha,
    })

    const parsed = parseResponse(result)
    expect(parsed.status).toBe('ok')
    expect(parsed.reviewed_sha).toBe(firstSha)
    expect(parsed.diff).toContain('diff --git a/feature.txt b/feature.txt')
    expect(parsed.diff).toContain('+line one')
    expect(parsed.diff).toContain('+line two')
  })

  it('returns not_supported when the session state has no worktree path', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-review-diff-unit-'))
    tempDirs.push(projectDir)
    const sessionManager = await createSessionState(projectDir, 'session-legacy')
    const { execFileSyncMock, tool } = await registerTool(projectDir, sessionManager)

    const result = await tool.handler({
      session_id: 'session-legacy',
      reviewed_sha: 'abc1234',
    })

    expect(parseResponse(result)).toEqual({
      status: 'not_supported',
      message: 'Session has no worktree; review-diff tool requires a per-session worktree',
    })
    expect(execFileSyncMock).not.toHaveBeenCalled()
  })
})
