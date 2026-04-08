import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionManager } from '../../src/session/manager.js'
import { registerRebaseTools } from '../../src/tools/rebase-tools.js'
import { StateManager } from '../../src/tools/state.js'
import { SessionWorktreeManager } from '../../src/worktree/session-worktree.js'

type ToolResponse = {
  content: Array<{ type: string; text: string }>
  isError?: boolean
}

type RegisteredTool = {
  config: {
    inputSchema: {
      safeParse: (input: unknown) => { success: boolean }
    }
  }
  handler: (input: Record<string, unknown>) => Promise<ToolResponse>
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()
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

function parseResponseText<T>(result: ToolResponse): T {
  return JSON.parse(result.content[0].text) as T
}

async function commitFile(cwd: string, filePath: string, content: string, message: string): Promise<string> {
  await writeFile(path.join(cwd, filePath), content)
  git(cwd, ['add', filePath])
  git(cwd, ['commit', '-m', message])
  return git(cwd, ['rev-parse', 'HEAD'])
}

describe('registerRebaseTools', () => {
  let projectDir: string
  let sessionManager: SessionManager
  let sessionWorktreeManager: SessionWorktreeManager
  let registeredTools: Map<string, RegisteredTool>
  let tempDirs: string[]

  const registerTool = vi.fn((name: string, config: RegisteredTool['config'], handler: RegisteredTool['handler']) => {
    registeredTools.set(name, { config, handler })
  })

  const server = { registerTool } as unknown as McpServer

  function getTool(name: string): RegisteredTool {
    const tool = registeredTools.get(name)
    if (!tool) {
      throw new Error(`Tool ${name} was not registered`)
    }
    return tool
  }

  async function createSessionWorktree(sessionId: string, baseBranch = 'main'): Promise<string> {
    const sessionDir = await sessionManager.create(sessionId)
    const stateManager = new StateManager(projectDir, sessionDir)
    await stateManager.initialize(sessionId)
    const worktree = await sessionWorktreeManager.create(sessionId, 'invoke/sessions', baseBranch)
    await stateManager.update({
      base_branch: baseBranch,
      work_branch: worktree.workBranch,
      work_branch_path: worktree.worktreePath,
    })
    tempDirs.push(worktree.worktreePath)
    return worktree.worktreePath
  }

  beforeEach(async () => {
    projectDir = await createGitRepo('invoke-rebase-tools-')
    sessionManager = new SessionManager(projectDir)
    sessionWorktreeManager = new SessionWorktreeManager(projectDir)
    registeredTools = new Map()
    tempDirs = [projectDir]
    registerTool.mockClear()
    registerRebaseTools(server, sessionManager, projectDir)
  })

  afterEach(async () => {
    await Promise.all(
      tempDirs.reverse().map(dir => rm(dir, { recursive: true, force: true }))
    )
  })

  it('returns the commit title for a valid SHA', async () => {
    const worktreePath = await createSessionWorktree('session-title')
    await writeFile(path.join(worktreePath, 'feature.txt'), 'test-1\n')
    git(worktreePath, ['add', 'feature.txt'])
    git(worktreePath, ['commit', '-m', 'feat: test-1'])
    const commitSha = git(worktreePath, ['rev-parse', 'HEAD'])

    const result = await getTool('invoke_get_commit_title').handler({
      session_id: 'session-title',
      commit_sha: commitSha,
    })

    expect(result.isError).toBeUndefined()
    expect(parseResponseText<{ title: string }>(result)).toEqual({
      title: 'feat: test-1',
    })
  })

  it('returns isError with git output when the SHA is unknown', async () => {
    await createSessionWorktree('session-bad-sha')

    const result = await getTool('invoke_get_commit_title').handler({
      session_id: 'session-bad-sha',
      commit_sha: '0123456789abcdef0123456789abcdef01234567',
    })

    expect(result.isError).toBe(true)
    // Different git versions emit different phrases: "unknown revision",
    // "bad object", "bad revision", or "ambiguous argument". All are valid
    // signals that the SHA could not be resolved. The `^{commit}` peel used
    // by the tool to force resolution to a commit object triggers the
    // "bad revision" phrasing on some versions.
    expect(result.content[0].text).toMatch(/unknown revision|bad (object|revision)|ambiguous argument/i)
  })

  it('collapses commits since the provided base SHA into a single commit', async () => {
    const worktreePath = await createSessionWorktree('session-collapse')
    const baseSha = git(worktreePath, ['rev-parse', 'HEAD'])

    await commitFile(worktreePath, 'file-a.txt', 'one\n', 'feat: step-1')
    await commitFile(worktreePath, 'file-b.txt', 'two\n', 'feat: step-2')
    await commitFile(worktreePath, 'file-a.txt', 'three\n', 'feat: step-3')

    const result = await getTool('invoke_collapse_commits').handler({
      session_id: 'session-collapse',
      base_sha: baseSha,
      message: 'feat: collapsed',
    })

    expect(result.isError).toBeUndefined()
    expect(parseResponseText<{ status: string; commit_sha: string }>(result)).toEqual({
      status: 'ok',
      commit_sha: git(worktreePath, ['rev-parse', 'HEAD']),
    })
    expect(git(worktreePath, ['rev-list', '--count', `${baseSha}..HEAD`])).toBe('1')
    expect(git(worktreePath, ['log', '-1', '--format=%s'])).toBe('feat: collapsed')
    await expect(readFile(path.join(worktreePath, 'file-a.txt'), 'utf-8')).resolves.toBe('three\n')
    await expect(readFile(path.join(worktreePath, 'file-b.txt'), 'utf-8')).resolves.toBe('two\n')
    expect(git(worktreePath, ['status', '--porcelain'])).toBe('')
  })

  it('returns an error when collapse base_sha is not an ancestor of HEAD', async () => {
    const worktreePath = await createSessionWorktree('session-collapse-error')
    await commitFile(worktreePath, 'feature.txt', 'session change\n', 'feat: session-work')
    const headBefore = git(worktreePath, ['rev-parse', 'HEAD'])

    git(projectDir, ['checkout', '-b', 'divergent'])
    await commitFile(projectDir, 'divergent.txt', 'divergent\n', 'feat: divergent')
    const badBaseSha = git(projectDir, ['rev-parse', 'HEAD'])
    git(projectDir, ['checkout', 'main'])

    const result = await getTool('invoke_collapse_commits').handler({
      session_id: 'session-collapse-error',
      base_sha: badBaseSha,
      message: 'feat: should-fail',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('base_sha is not an ancestor of HEAD')
    expect(git(worktreePath, ['rev-parse', 'HEAD'])).toBe(headBefore)
  })

  it('autosquashes fixup commits into their target commit', async () => {
    const worktreePath = await createSessionWorktree('session-autosquash')

    await commitFile(worktreePath, 'fileA.ts', 'export const fileA = "a"\n', 'feat: task-a')
    await commitFile(worktreePath, 'fileB.ts', 'export const fileB = "b"\n', 'feat: task-b')
    await commitFile(worktreePath, 'fileA.ts', 'export const fileA = "a-fixed"\n', 'fixup! feat: task-a')

    const result = await getTool('invoke_autosquash_session').handler({
      session_id: 'session-autosquash',
    })

    expect(result.isError).toBeUndefined()
    expect(
      parseResponseText<{
        status: string
        commits_before: number
        commits_after: number
        fixups_absorbed: number
      }>(result)
    ).toEqual({
      status: 'ok',
      commits_before: 3,
      commits_after: 2,
      fixups_absorbed: 1,
    })

    const taskACommit = git(worktreePath, ['log', '--format=%H%x09%s'])
      .split('\n')
      .find(line => line.endsWith('\tfeat: task-a'))
      ?.split('\t')[0]

    expect(taskACommit).toBeTruthy()
    expect(git(worktreePath, ['show', `${taskACommit}:fileA.ts`])).toBe('export const fileA = "a-fixed"')
  })

  it('is idempotent when no fixup commits exist', async () => {
    const worktreePath = await createSessionWorktree('session-autosquash-idempotent')

    await commitFile(worktreePath, 'fileA.ts', 'export const fileA = "a"\n', 'feat: task-a')
    await commitFile(worktreePath, 'fileB.ts', 'export const fileB = "b"\n', 'feat: task-b')
    const headBefore = git(worktreePath, ['rev-parse', 'HEAD'])

    const result = await getTool('invoke_autosquash_session').handler({
      session_id: 'session-autosquash-idempotent',
    })

    expect(result.isError).toBeUndefined()
    expect(
      parseResponseText<{
        status: string
        commits_before: number
        commits_after: number
        fixups_absorbed: number
      }>(result)
    ).toEqual({
      status: 'ok',
      commits_before: 2,
      commits_after: 2,
      fixups_absorbed: 0,
    })
    expect(git(worktreePath, ['rev-parse', 'HEAD'])).toBe(headBefore)
  })

  it('returns not_supported for legacy sessions without state', async () => {
    await sessionManager.create('session-legacy')

    const result = await getTool('invoke_autosquash_session').handler({
      session_id: 'session-legacy',
    })

    expect(result.isError).toBeUndefined()
    expect(parseResponseText<{ status: string; message: string }>(result)).toEqual({
      status: 'not_supported',
      message: 'session has no work_branch_path (legacy)',
    })
  })

  it('aborts autosquash conflicts, reports the conflicting files, and restores HEAD', async () => {
    const worktreePath = await createSessionWorktree('session-autosquash-conflict')

    await commitFile(worktreePath, 'shared.ts', '"a"\n', 'feat: task-a')
    await commitFile(worktreePath, 'shared.ts', '"b"\n', 'feat: task-b')
    await commitFile(worktreePath, 'shared.ts', '"a-fixed"\n', 'fixup! feat: task-a')
    const preRebaseHead = git(worktreePath, ['rev-parse', 'HEAD'])

    const result = await getTool('invoke_autosquash_session').handler({
      session_id: 'session-autosquash-conflict',
    })

    expect(result.isError).toBeUndefined()
    const parsed = parseResponseText<{
      status: string
      conflicting_files: string[]
      message: string
    }>(result)
    expect(parsed.status).toBe('conflict_aborted')
    expect(parsed.conflicting_files).toContain('shared.ts')
    expect(parsed.message).toMatch(/conflict|could not apply/i)
    expect(git(worktreePath, ['rev-parse', 'HEAD'])).toBe(preRebaseHead)
    expect(git(worktreePath, ['status', '--porcelain'])).toBe('')
  })
})
