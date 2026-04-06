import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execSync } from 'child_process'
import { existsSync, realpathSync } from 'fs'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

vi.mock('../../src/config.js', () => ({
  loadConfig: vi.fn(),
}))

import { loadConfig } from '../../src/config.js'
import { SessionManager } from '../../src/session/manager.js'
import { registerSessionTools } from '../../src/tools/session-tools.js'
import type {
  DispatchMetric,
  InvokeConfig,
  PipelineState,
  SessionInfo,
  SessionMetricsSummary,
} from '../../src/types.js'
import { SessionWorktreeManager } from '../../src/worktree/session-worktree.js'

type ToolInput = {
  session_id?: string
  status_filter?: 'complete' | 'stale' | 'all'
  delete_work_branch?: boolean
  withMetrics?: boolean
}

type RegisteredTool = {
  config: {
    inputSchema: {
      safeParse: (input: unknown) => { success: boolean }
    }
  }
  handler: (input: ToolInput) => Promise<{
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
    work_branch_prefix: 'invoke',
    stale_session_days: 3,
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

interface ParsedWorktree {
  worktreePath: string
  branchRef: string | null
}

describe('registerSessionTools', () => {
  let projectDir: string
  let sessionManager: SessionManager
  let sessionWorktreeManager: SessionWorktreeManager
  let registeredTools: Map<string, RegisteredTool>

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

  function parseResponseText<T>(result: Awaited<ReturnType<RegisteredTool['handler']>>): T {
    return JSON.parse(result.content[0].text) as T
  }

  function shellQuote(value: string): string {
    return `"${value.replace(/["\\$`]/g, '\\$&')}"`
  }

  function git(command: string, cwd = projectDir): string {
    return execSync(command, { cwd, stdio: 'pipe' }).toString().trim()
  }

  function branchExists(branch: string): boolean {
    try {
      execSync(`git show-ref --verify --quiet ${shellQuote(`refs/heads/${branch}`)}`, {
        cwd: projectDir,
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

  async function writeSessionState(sessionId: string, state: PipelineState): Promise<void> {
    const sessionDir = path.join(projectDir, '.invoke', 'sessions', sessionId)
    await mkdir(sessionDir, { recursive: true })
    await writeFile(path.join(sessionDir, 'state.json'), JSON.stringify(state, null, 2) + '\n')
  }

  async function writeSessionMetrics(sessionId: string, metrics: DispatchMetric[]): Promise<void> {
    const sessionDir = path.join(projectDir, '.invoke', 'sessions', sessionId)
    await mkdir(sessionDir, { recursive: true })
    await writeFile(path.join(sessionDir, 'metrics.json'), JSON.stringify(metrics, null, 2) + '\n')
  }

  async function createSessionWorktreeState(sessionId: string, overrides: Partial<PipelineState> = {}) {
    const worktree = await sessionWorktreeManager.create(sessionId, 'invoke/sessions', 'main')
    await writeSessionState(
      sessionId,
      createState({
        ...overrides,
        work_branch: worktree.workBranch,
        work_branch_path: worktree.worktreePath,
      })
    )
    return worktree
  }

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-05T12:00:00.000Z'))

    projectDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-session-tools-'))
    execSync('git init', { cwd: projectDir, stdio: 'pipe' })
    execSync('git branch -M main', { cwd: projectDir, stdio: 'pipe' })
    execSync('git config user.email "test@test.com"', { cwd: projectDir, stdio: 'pipe' })
    execSync('git config user.name "Test"', { cwd: projectDir, stdio: 'pipe' })
    await writeFile(path.join(projectDir, 'README.md'), '# Test\n')
    execSync('git add .', { cwd: projectDir, stdio: 'pipe' })
    execSync('git commit -m "initial"', { cwd: projectDir, stdio: 'pipe' })

    sessionManager = new SessionManager(projectDir)
    sessionWorktreeManager = new SessionWorktreeManager(projectDir)
    registeredTools = new Map()
    registerTool.mockClear()
    vi.mocked(loadConfig).mockResolvedValue(TEST_CONFIG)

    registerSessionTools(server, sessionManager, projectDir, sessionWorktreeManager)
  })

  afterEach(async () => {
    try {
      const worktrees = parseWorktreeList(git('git worktree list --porcelain'))
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
          // Missing directories are pruned below.
        }
      }

      try {
        execSync('git worktree prune', { cwd: projectDir, stdio: 'pipe' })
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
          execSync(`git branch -D ${shellQuote(branch)}`, { cwd: projectDir, stdio: 'pipe' })
        } catch {
          // Ignore branches that still cannot be deleted during teardown.
        }
      }
    } finally {
      vi.useRealTimers()
      await rm(projectDir, { recursive: true, force: true })
    }
  })

  it('registers session tool schemas', () => {
    expect(getTool('invoke_list_sessions').config.inputSchema.safeParse({}).success).toBe(true)
    expect(getTool('invoke_list_sessions').config.inputSchema.safeParse({ withMetrics: true }).success).toBe(true)
    expect(getTool('invoke_cleanup_sessions').config.inputSchema.safeParse({}).success).toBe(true)
    expect(
      getTool('invoke_cleanup_sessions').config.inputSchema.safeParse({ status_filter: 'stale' }).success
    ).toBe(true)
    expect(
      getTool('invoke_cleanup_sessions').config.inputSchema.safeParse({ session_id: 'session-1' }).success
    ).toBe(true)
    expect(
      getTool('invoke_cleanup_sessions').config.inputSchema.safeParse({ delete_work_branch: true }).success
    ).toBe(true)
  })

  it('lists sessions with config-aware status metadata', async () => {
    const listSpy = vi.spyOn(sessionManager, 'list')
    const isStaleSpy = vi.spyOn(sessionManager, 'isStale')
    await writeSessionState(
      'session-active',
      createState({
        pipeline_id: 'pipeline-active',
        current_stage: 'review',
        last_updated: '2026-04-04T13:00:00.000Z',
      })
    )
    await writeSessionState(
      'session-complete',
      createState({
        pipeline_id: 'pipeline-complete',
        current_stage: 'complete',
        last_updated: '2026-03-20T13:00:00.000Z',
      })
    )
    await writeSessionState(
      'session-stale',
      createState({
        pipeline_id: 'pipeline-stale',
        current_stage: 'build',
        last_updated: '2026-04-01T11:59:59.000Z',
      })
    )

    const result = await getTool('invoke_list_sessions').handler({})

    expect(result.isError).toBeUndefined()
    expect(listSpy).toHaveBeenCalledWith(3)
    expect(isStaleSpy).not.toHaveBeenCalled()
    expect(parseResponseText<SessionInfo[]>(result)).toEqual([
      {
        session_id: 'session-active',
        pipeline_id: 'pipeline-active',
        current_stage: 'review',
        started: '2026-04-01T08:00:00.000Z',
        last_updated: '2026-04-04T13:00:00.000Z',
        status: 'active',
      },
      {
        session_id: 'session-complete',
        pipeline_id: 'pipeline-complete',
        current_stage: 'complete',
        started: '2026-04-01T08:00:00.000Z',
        last_updated: '2026-03-20T13:00:00.000Z',
        status: 'complete',
      },
      {
        session_id: 'session-stale',
        pipeline_id: 'pipeline-stale',
        current_stage: 'build',
        started: '2026-04-01T08:00:00.000Z',
        last_updated: '2026-04-01T11:59:59.000Z',
        status: 'stale',
      },
    ])
  })

  it('includes per-session metrics summaries when withMetrics is true', async () => {
    await writeSessionState(
      'session-a',
      createState({
        pipeline_id: 'pipeline-a',
        current_stage: 'review',
      })
    )
    await writeSessionState(
      'session-b',
      createState({
        pipeline_id: 'pipeline-b',
        current_stage: 'complete',
      })
    )
    await writeSessionMetrics('session-a', [
      {
        pipeline_id: 'pipeline-a',
        stage: 'build',
        role: 'builder',
        subrole: 'default',
        provider: 'claude',
        model: 'opus-4.6',
        effort: 'medium',
        prompt_size_chars: 100,
        duration_ms: 250,
        status: 'success',
        started_at: '2026-04-04T12:00:00.000Z',
        estimated_cost_usd: 0.05,
      },
      {
        pipeline_id: 'pipeline-a',
        stage: 'review',
        role: 'reviewer',
        subrole: 'default',
        provider: 'codex',
        model: 'gpt-5',
        effort: 'high',
        prompt_size_chars: 80,
        duration_ms: 500,
        status: 'success',
        started_at: '2026-04-04T12:05:00.000Z',
        estimated_cost_usd: 0.1,
      },
    ])
    await writeSessionMetrics('session-b', [
      {
        pipeline_id: 'pipeline-b',
        stage: 'build',
        role: 'builder',
        subrole: 'default',
        provider: 'claude',
        model: 'opus-4.6',
        effort: 'medium',
        prompt_size_chars: 60,
        duration_ms: 120,
        status: 'success',
        started_at: '2026-04-04T12:10:00.000Z',
        estimated_cost_usd: 0.02,
      },
    ])

    const result = await getTool('invoke_list_sessions').handler({ withMetrics: true })
    const sessions = parseResponseText<Array<SessionInfo & { metrics_summary: SessionMetricsSummary }>>(result)

    expect(result.isError).toBeUndefined()
    expect(sessions).toEqual([
      {
        session_id: 'session-a',
        pipeline_id: 'pipeline-a',
        current_stage: 'review',
        started: '2026-04-01T08:00:00.000Z',
        last_updated: '2026-04-05T09:00:00.000Z',
        status: 'active',
        metrics_summary: {
          total_dispatches: 2,
          total_duration_ms: 750,
          total_estimated_cost_usd: 0.15,
        },
      },
      {
        session_id: 'session-b',
        pipeline_id: 'pipeline-b',
        current_stage: 'complete',
        started: '2026-04-01T08:00:00.000Z',
        last_updated: '2026-04-05T09:00:00.000Z',
        status: 'complete',
        metrics_summary: {
          total_dispatches: 1,
          total_duration_ms: 120,
          total_estimated_cost_usd: 0.02,
        },
      },
    ])
  })

  it('cleans completed sessions by default', async () => {
    await writeSessionState('session-active', createState({ current_stage: 'review' }))
    await writeSessionState('session-complete', createState({ current_stage: 'complete' }))
    await writeSessionState(
      'session-stale',
      createState({ last_updated: '2026-04-01T11:59:59.000Z' })
    )

    const result = await getTool('invoke_cleanup_sessions').handler({})

    expect(result.isError).toBeUndefined()
    expect(parseResponseText<string[]>(result)).toEqual(['session-complete'])
    expect(sessionManager.exists('session-active')).toBe(true)
    expect(sessionManager.exists('session-complete')).toBe(false)
    expect(sessionManager.exists('session-stale')).toBe(true)
  })

  it('cleans an explicitly targeted active session by id', async () => {
    await writeSessionState('session-active', createState({ current_stage: 'review' }))

    const result = await getTool('invoke_cleanup_sessions').handler({ session_id: 'session-active' })

    expect(result.isError).toBeUndefined()
    expect(parseResponseText<string[]>(result)).toEqual(['session-active'])
    expect(sessionManager.exists('session-active')).toBe(false)
  })

  it('skips active sessions when cleaning all statuses', async () => {
    await writeSessionState('session-active', createState({ current_stage: 'review' }))
    await writeSessionState('session-complete', createState({ current_stage: 'complete' }))
    await writeSessionState(
      'session-stale',
      createState({ last_updated: '2026-04-01T11:59:59.000Z' })
    )

    const result = await getTool('invoke_cleanup_sessions').handler({ status_filter: 'all' })

    expect(result.isError).toBeUndefined()
    expect(parseResponseText<string[]>(result)).toEqual([
      'session-complete',
      'session-stale',
    ])
    expect(existsSync(path.join(projectDir, '.invoke', 'sessions', 'session-active'))).toBe(true)
    expect(sessionManager.exists('session-complete')).toBe(false)
    expect(sessionManager.exists('session-stale')).toBe(false)
  })

  it('cleans a session worktree and keeps the branch when delete_work_branch is false', async () => {
    const sessionId = 'cleanup-keep-branch'
    const worktree = await createSessionWorktreeState(sessionId)

    const result = await getTool('invoke_cleanup_sessions').handler({
      session_id: sessionId,
      delete_work_branch: false,
    })

    expect(result.isError).toBeUndefined()
    expect(parseResponseText<string[]>(result)).toEqual([sessionId])
    expect(existsSync(worktree.worktreePath)).toBe(false)
    expect(branchExists(worktree.workBranch)).toBe(true)
    expect(sessionManager.exists(sessionId)).toBe(false)
  })

  it('cleans a session worktree and deletes the branch when delete_work_branch is true', async () => {
    const sessionId = 'cleanup-delete-branch'
    const worktree = await createSessionWorktreeState(sessionId)

    const result = await getTool('invoke_cleanup_sessions').handler({
      session_id: sessionId,
      delete_work_branch: true,
    })

    expect(result.isError).toBeUndefined()
    expect(parseResponseText<string[]>(result)).toEqual([sessionId])
    expect(existsSync(worktree.worktreePath)).toBe(false)
    expect(branchExists(worktree.workBranch)).toBe(false)
    expect(sessionManager.exists(sessionId)).toBe(false)
  })

  it('cleans a legacy session without worktree state', async () => {
    const sessionId = 'legacy-session'
    const cleanupSpy = vi.spyOn(sessionWorktreeManager, 'cleanup')
    await writeSessionState(sessionId, createState({ current_stage: 'complete' }))

    const result = await getTool('invoke_cleanup_sessions').handler({ session_id: sessionId })

    expect(result.isError).toBeUndefined()
    expect(parseResponseText<string[]>(result)).toEqual([sessionId])
    expect(cleanupSpy).not.toHaveBeenCalled()
    expect(sessionManager.exists(sessionId)).toBe(false)
  })

  it('continues cleanup when the session worktree directory was already deleted', async () => {
    const sessionId = 'cleanup-missing-worktree-dir'
    const worktree = await createSessionWorktreeState(sessionId)
    await rm(worktree.worktreePath, { recursive: true, force: true })
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const result = await getTool('invoke_cleanup_sessions').handler({ session_id: sessionId })

      expect(result.isError).toBeUndefined()
      expect(parseResponseText<string[]>(result)).toEqual([sessionId])
      expect(sessionManager.exists(sessionId)).toBe(false)
      expect(branchExists(worktree.workBranch)).toBe(true)
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('returns an error when a targeted session does not exist', async () => {
    const result = await getTool('invoke_cleanup_sessions').handler({ session_id: 'missing-session' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe("Session error: Session 'missing-session' does not exist")
  })
})
