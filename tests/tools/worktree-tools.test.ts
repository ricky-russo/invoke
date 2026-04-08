import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execSync } from 'child_process'
import { realpathSync } from 'fs'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

const postMergeMocks = vi.hoisted(() => ({
  runPostMergeCommands: vi.fn(),
}))

vi.mock('../../src/tools/post-merge.js', () => ({
  runPostMergeCommands: postMergeMocks.runPostMergeCommands,
}))

import { SessionManager } from '../../src/session/manager.js'
import { registerWorktreeTools } from '../../src/tools/worktree-tools.js'
import type { InvokeConfig, PipelineState } from '../../src/types.js'
import type { WorktreeManager } from '../../src/worktree/manager.js'
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

const TEST_CONFIG: InvokeConfig = {
  providers: {},
  roles: {},
  strategies: {},
  settings: {
    default_strategy: 'default',
    agent_timeout: 60,
    commit_style: 'one-commit',
    work_branch_prefix: 'invoke',
    post_merge_commands: ['npm install'],
  },
}

function createState(overrides: Partial<PipelineState> = {}): PipelineState {
  return {
    pipeline_id: 'pipeline-123',
    started: '2026-04-01T08:00:00.000Z',
    last_updated: '2026-04-05T09:00:00.000Z',
    current_stage: 'build',
    batches: [],
    review_cycles: [],
    ...overrides,
  }
}

async function createGitRepo(prefix: string): Promise<string> {
  const repoDir = await mkdtemp(path.join(os.tmpdir(), prefix))
  execSync('git init', { cwd: repoDir, stdio: 'pipe' })
  execSync('git branch -M main', { cwd: repoDir, stdio: 'pipe' })
  execSync('git config user.email "test@example.com"', { cwd: repoDir, stdio: 'pipe' })
  execSync('git config user.name "Test User"', { cwd: repoDir, stdio: 'pipe' })
  await writeFile(path.join(repoDir, 'README.md'), '# Test repo\n')
  execSync('git add .', { cwd: repoDir, stdio: 'pipe' })
  execSync('git commit -m "initial"', { cwd: repoDir, stdio: 'pipe' })
  return repoDir
}

describe('registerWorktreeTools', () => {
  let projectDir: string
  let sessionManager: SessionManager
  let registeredTools: Map<string, RegisteredTool>
  let worktreeManager: WorktreeManager
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

  function parseResponseText<T>(result: ToolResponse): T {
    return JSON.parse(result.content[0].text) as T
  }

  async function writeSessionState(sessionId: string, state: PipelineState): Promise<void> {
    const sessionDir = await sessionManager.create(sessionId)
    await writeFile(path.join(sessionDir, 'state.json'), JSON.stringify(state, null, 2) + '\n')
  }

  async function createSafeSessionWorktreePath(
    sessionId: string,
    repoDir = projectDir
  ): Promise<{ path: string; workBranch: string }> {
    const sessionWorktreeManager = new SessionWorktreeManager(repoDir)
    const worktree = await sessionWorktreeManager.create(sessionId, 'invoke/sessions', 'main')
    tempDirs.push(worktree.worktreePath)
    return {
      path: realpathSync(worktree.worktreePath),
      workBranch: worktree.workBranch,
    }
  }

  beforeEach(async () => {
    projectDir = await createGitRepo('invoke-worktree-tools-')
    sessionManager = new SessionManager(projectDir)
    registeredTools = new Map()
    tempDirs = [projectDir]
    registerTool.mockClear()
    postMergeMocks.runPostMergeCommands.mockReset()
    worktreeManager = {
      create: vi.fn(),
      merge: vi.fn(),
      cleanup: vi.fn().mockResolvedValue(undefined),
      listActive: vi.fn().mockReturnValue([]),
      cleanupAll: vi.fn().mockResolvedValue(undefined),
    } as unknown as WorktreeManager
  })

  afterEach(async () => {
    await Promise.all(
      tempDirs.reverse().map(dir => rm(dir, { recursive: true, force: true }))
    )
  })

  it('accepts optional session_id in merge and post-merge schemas', () => {
    registerWorktreeTools(server, worktreeManager, sessionManager, TEST_CONFIG, projectDir)

    expect(
      getTool('invoke_merge_worktree').config.inputSchema.safeParse({
        task_id: 'task-1',
        session_id: 'session-1',
      }).success
    ).toBe(true)
    expect(
      getTool('invoke_run_post_merge').config.inputSchema.safeParse({
        session_id: 'session-1',
      }).success
    ).toBe(true)
  })

  it('resolves session work_branch_path and passes it as mergeTargetPath', async () => {
    const { path: worktreePath, workBranch } = await createSafeSessionWorktreePath('session-1')
    await writeSessionState('session-1', createState({
      work_branch_path: worktreePath,
      work_branch: workBranch,
    }))
    vi.mocked(worktreeManager.merge).mockResolvedValue({
      status: 'merged',
      commitSha: '0123456789abcdef0123456789abcdef01234567',
    })

    registerWorktreeTools(server, worktreeManager, sessionManager, TEST_CONFIG, projectDir)

    const result = await getTool('invoke_merge_worktree').handler({
      task_id: 'task-1',
      session_id: 'session-1',
    })

    expect(worktreeManager.merge).toHaveBeenCalledWith('task-1', {
      mergeTargetPath: worktreePath,
    })
    expect(worktreeManager.cleanup).toHaveBeenCalledWith('task-1')
    const parsed = parseResponseText<{
      task_id: string
      status: string
      commit_sha: string
    }>(result)
    expect(parsed.task_id).toBe('task-1')
    expect(parsed.status).toBe('merged')
    expect(parsed.commit_sha).toMatch(/^[0-9a-f]{40}$/)
  })

  it('merges into the repo dir when session_id is omitted', async () => {
    vi.mocked(worktreeManager.merge).mockResolvedValue({
      status: 'merged',
      commitSha: '0123456789abcdef0123456789abcdef01234567',
    })

    registerWorktreeTools(server, worktreeManager, sessionManager, TEST_CONFIG, projectDir)

    await getTool('invoke_merge_worktree').handler({ task_id: 'task-legacy' })

    expect(worktreeManager.merge).toHaveBeenCalledWith('task-legacy', undefined)
    expect(worktreeManager.cleanup).toHaveBeenCalledWith('task-legacy')
  })

  it('falls back to the repo dir for legacy sessions without work_branch_path', async () => {
    await writeSessionState('legacy-session', createState())
    vi.mocked(worktreeManager.merge).mockResolvedValue({
      status: 'merged',
      commitSha: '0123456789abcdef0123456789abcdef01234567',
    })

    registerWorktreeTools(server, worktreeManager, sessionManager, TEST_CONFIG, projectDir)

    await getTool('invoke_merge_worktree').handler({
      task_id: 'task-legacy-session',
      session_id: 'legacy-session',
    })

    expect(worktreeManager.merge).toHaveBeenCalledWith('task-legacy-session', undefined)
  })

  it('returns a structured conflict response without cleanup', async () => {
    vi.mocked(worktreeManager.merge).mockResolvedValue({
      status: 'conflict',
      conflictingFiles: ['shared.ts'],
      mergeTargetPath: '/tmp/session-worktree',
    })

    registerWorktreeTools(server, worktreeManager, sessionManager, TEST_CONFIG, projectDir)

    const result = await getTool('invoke_merge_worktree').handler({ task_id: 'task-conflict' })

    expect(worktreeManager.cleanup).not.toHaveBeenCalled()
    expect(result.isError).toBeUndefined()
    expect(
      parseResponseText<{
        task_id: string
        status: string
        conflicting_files: string[]
        merge_target_path: string
      }>(result)
    ).toEqual({
      task_id: 'task-conflict',
      status: 'conflict',
      conflicting_files: ['shared.ts'],
      merge_target_path: '/tmp/session-worktree',
    })
  })

  it('runs post-merge commands in the session worktree dir', async () => {
    const { path: worktreePath, workBranch } = await createSafeSessionWorktreePath('session-1')
    await writeSessionState('session-1', createState({
      work_branch_path: worktreePath,
      work_branch: workBranch,
    }))
    postMergeMocks.runPostMergeCommands.mockReturnValue({
      commands: [{ command: 'npm install', success: true, output: 'ok' }],
    })

    registerWorktreeTools(server, worktreeManager, sessionManager, TEST_CONFIG, projectDir)

    const result = await getTool('invoke_run_post_merge').handler({ session_id: 'session-1' })

    expect(postMergeMocks.runPostMergeCommands).toHaveBeenCalledWith(
      TEST_CONFIG,
      projectDir,
      worktreePath
    )
    expect(parseResponseText<{ commands: Array<{ command: string; success: boolean; output: string }> }>(result)).toEqual({
      commands: [{ command: 'npm install', success: true, output: 'ok' }],
    })
  })

  it('returns an error and does not merge when the session work_branch_path is unsafe', async () => {
    await writeSessionState('session-unsafe', createState({ work_branch_path: os.homedir() }))

    registerWorktreeTools(server, worktreeManager, sessionManager, TEST_CONFIG, projectDir)

    const result = await getTool('invoke_merge_worktree').handler({
      task_id: 'task-unsafe',
      session_id: 'session-unsafe',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain(
      "Merge error: Refusing to use unsafe session work branch path for session 'session-unsafe'"
    )
    expect(worktreeManager.merge).not.toHaveBeenCalled()
  })

  it('returns an error for post-merge when the session work_branch_path is unsafe', async () => {
    await writeSessionState('session-unsafe', createState({ work_branch_path: os.homedir() }))

    registerWorktreeTools(server, worktreeManager, sessionManager, TEST_CONFIG, projectDir)

    const result = await getTool('invoke_run_post_merge').handler({ session_id: 'session-unsafe' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain(
      "Post-merge error: Refusing to use unsafe session work branch path for session 'session-unsafe'"
    )
    expect(postMergeMocks.runPostMergeCommands).not.toHaveBeenCalled()
  })

  it('rejects invoke_merge_worktree when the session work_branch_path belongs to a different repo', async () => {
    const externalRepoDir = await createGitRepo('invoke-worktree-tools-external-')
    tempDirs.push(externalRepoDir)
    const { path: foreignWorktreePath } = await createSafeSessionWorktreePath('foreign-session', externalRepoDir)
    await writeSessionState('session-cross-repo', createState({ work_branch_path: foreignWorktreePath }))

    registerWorktreeTools(server, worktreeManager, sessionManager, TEST_CONFIG, projectDir)

    const result = await getTool('invoke_merge_worktree').handler({
      task_id: 'task-cross-repo',
      session_id: 'session-cross-repo',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain(
      "Merge error: Refusing to use unsafe session work branch path for session 'session-cross-repo'"
    )
    expect(worktreeManager.merge).not.toHaveBeenCalled()
  })

  it('rejects invoke_run_post_merge when the session work_branch_path belongs to a different repo', async () => {
    const externalRepoDir = await createGitRepo('invoke-worktree-tools-external-')
    tempDirs.push(externalRepoDir)
    const { path: foreignWorktreePath } = await createSafeSessionWorktreePath('foreign-session', externalRepoDir)
    await writeSessionState('session-cross-repo', createState({ work_branch_path: foreignWorktreePath }))

    registerWorktreeTools(server, worktreeManager, sessionManager, TEST_CONFIG, projectDir)

    const result = await getTool('invoke_run_post_merge').handler({
      session_id: 'session-cross-repo',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain(
      "Post-merge error: Refusing to use unsafe session work branch path for session 'session-cross-repo'"
    )
    expect(postMergeMocks.runPostMergeCommands).not.toHaveBeenCalled()
  })
})
