import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execSync } from 'child_process'
import { existsSync, realpathSync } from 'fs'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SessionManager } from '../../src/session/manager.js'
import { registerSessionInitTools } from '../../src/tools/session-init-tools.js'
import { StateManager } from '../../src/tools/state.js'
import type { InvokeConfig, PipelineState } from '../../src/types.js'
import { buildWorkBranch } from '../../src/worktree/branch-prefix.js'
import { SessionWorktreeManager } from '../../src/worktree/session-worktree.js'

type RegisteredTool = {
  config: {
    inputSchema: {
      safeParse: (input: unknown) =>
        | { success: true; data: Record<string, unknown> }
        | { success: false; error: { issues: Array<{ message: string }> } }
    }
  }
  handler: (input: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text: string }>
    isError?: boolean
  }>
}

const TEST_CONFIG: InvokeConfig = {
  providers: {},
  roles: {},
  strategies: {},
  settings: {
    default_strategy: 'default',
    agent_timeout: 60,
    commit_style: 'one-commit',
    work_branch_prefix: 'invoke/work',
  },
}

let projectDir: string
let sessionManager: SessionManager
let sessionWorktreeManager: SessionWorktreeManager
let registeredTools: Map<string, RegisteredTool>

const registerTool = vi.fn((name: string, config: RegisteredTool['config'], handler: RegisteredTool['handler']) => {
  registeredTools.set(name, {
    config,
    handler: async (input: Record<string, unknown>) => {
      const parsed = config.inputSchema.safeParse(input)
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: parsed.error.issues[0]?.message ?? 'Invalid input' }],
          isError: true,
        }
      }

      return handler(parsed.data)
    },
  })
})

const server = { registerTool } as unknown as McpServer

function shellQuote(value: string): string {
  return `"${value.replace(/["\\$`]/g, '\\$&')}"`
}

function git(command: string, cwd = projectDir): string {
  return execSync(command, { cwd, stdio: 'pipe' }).toString().trim()
}

function normalizePath(targetPath: string): string {
  return existsSync(targetPath) ? realpathSync(targetPath) : targetPath
}

function parseWorktreePaths(): Array<{ worktreePath: string; branchRef: string | null }> {
  const output = git('git worktree list --porcelain')
  if (output.length === 0) {
    return []
  }

  return output
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
    .filter((entry): entry is { worktreePath: string; branchRef: string | null } => entry !== null)
}

function getTool(name: string): RegisteredTool {
  const tool = registeredTools.get(name)
  if (!tool) {
    throw new Error(`Tool ${name} was not registered`)
  }
  return tool
}

function parseResponseText<T>(result: Awaited<ReturnType<RegisteredTool['handler']>>): T {
  return JSON.parse(result.content[0].text) as T
}

async function initializeSessionState(sessionId: string, pipelineId = sessionId): Promise<PipelineState> {
  const sessionDir = await sessionManager.create(sessionId)
  const stateManager = new StateManager(projectDir, sessionDir)
  return stateManager.initialize(pipelineId)
}

beforeEach(async () => {
  projectDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-session-init-tools-'))
  git('git init')
  git('git branch -M main')
  git('git config user.email "test@test.com"')
  git('git config user.name "Test User"')
  await writeFile(path.join(projectDir, 'README.md'), '# Test repo\n')
  git('git add README.md')
  git('git commit -m "initial commit"')
  git('git branch feature/test-branch')

  sessionManager = new SessionManager(projectDir)
  sessionWorktreeManager = new SessionWorktreeManager(projectDir)
  registeredTools = new Map()
  registerTool.mockClear()

  registerSessionInitTools(
    server,
    sessionWorktreeManager,
    sessionManager,
    () => TEST_CONFIG,
    projectDir
  )
})

afterEach(async () => {
  try {
    const worktrees = parseWorktreePaths()
    for (const worktree of worktrees) {
      if (normalizePath(worktree.worktreePath) === normalizePath(projectDir)) {
        continue
      }

      try {
        execSync(`git worktree remove --force ${shellQuote(worktree.worktreePath)}`, {
          cwd: projectDir,
          stdio: 'pipe',
        })
      } catch {
        // Best-effort cleanup.
      }
    }

    try {
      git('git worktree prune')
    } catch {
      // Ignore prune failures during teardown.
    }

    const branches = git('git for-each-ref --format="%(refname:short)" refs/heads')
      .split('\n')
      .filter(Boolean)

    for (const branch of branches) {
      if (branch === 'main' || branch === 'feature/test-branch') {
        continue
      }

      try {
        execSync(`git branch -D ${shellQuote(branch)}`, {
          cwd: projectDir,
          stdio: 'pipe',
        })
      } catch {
        // Ignore branch cleanup failures during teardown.
      }
    }
  } finally {
    await rm(projectDir, { recursive: true, force: true })
  }
})

describe('registerSessionInitTools', () => {
  it('returns current_head, default_branch, and all_local_branches', async () => {
    const result = await getTool('invoke_get_base_branch_candidates').handler({})

    expect(result.isError).toBeUndefined()
    expect(parseResponseText<{
      current_head: string | null
      default_branch: string | null
      all_local_branches: string[]
    }>(result)).toEqual({
      current_head: 'main',
      default_branch: 'main',
      all_local_branches: ['feature/test-branch', 'main'],
    })
  })

  it('creates the session worktree, persists state, and returns the info', async () => {
    const sessionId = 'session-init-create'
    await initializeSessionState(sessionId, 'pipeline-create')

    const result = await getTool('invoke_session_init_worktree').handler({
      session_id: sessionId,
      base_branch: 'main',
    })

    expect(result.isError).toBeUndefined()

    const response = parseResponseText<{
      session_id: string
      work_branch: string
      base_branch: string
      work_branch_path: string
    }>(result)

    expect(response).toEqual({
      session_id: sessionId,
      work_branch: buildWorkBranch(TEST_CONFIG.settings.work_branch_prefix, sessionId),
      base_branch: 'main',
      work_branch_path: normalizePath(path.join(os.tmpdir(), `invoke-session-${sessionId}`)),
    })
    expect(existsSync(response.work_branch_path)).toBe(true)
    expect(git('git branch --show-current', response.work_branch_path)).toBe(response.work_branch)

    const stateManager = new StateManager(projectDir, sessionManager.resolve(sessionId))
    const state = await stateManager.get()

    expect(state).toMatchObject({
      pipeline_id: 'pipeline-create',
      work_branch: response.work_branch,
      base_branch: 'main',
      work_branch_path: response.work_branch_path,
    })
  })

  it('returns an error when base_branch does not exist', async () => {
    const sessionId = 'session-init-missing-base'
    await initializeSessionState(sessionId, 'pipeline-missing-base')

    const result = await getTool('invoke_session_init_worktree').handler({
      session_id: sessionId,
      base_branch: 'missing-branch',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe("Base branch 'missing-branch' does not exist in this repository.")
  })

  it('is idempotent and does not duplicate the worktree', async () => {
    const sessionId = 'session-init-idempotent'
    await initializeSessionState(sessionId, 'pipeline-idempotent')

    const first = await getTool('invoke_session_init_worktree').handler({
      session_id: sessionId,
      base_branch: 'main',
    })
    const second = await getTool('invoke_session_init_worktree').handler({
      session_id: sessionId,
      base_branch: 'main',
    })

    expect(first.isError).toBeUndefined()
    expect(second.isError).toBeUndefined()
    expect(parseResponseText(first)).toEqual(parseResponseText(second))

    const workBranch = buildWorkBranch(TEST_CONFIG.settings.work_branch_prefix, sessionId)
    const matchingWorktrees = parseWorktreePaths()
      .filter(entry => entry.branchRef === `refs/heads/${workBranch}`)

    expect(matchingWorktrees).toHaveLength(1)
  })
})
