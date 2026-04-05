import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'fs'
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

type ToolInput = {
  session_id?: string
  status_filter?: 'complete' | 'stale' | 'all'
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

describe('registerSessionTools', () => {
  let projectDir: string
  let sessionManager: SessionManager
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

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-05T12:00:00.000Z'))

    projectDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-session-tools-'))
    sessionManager = new SessionManager(projectDir)
    registeredTools = new Map()
    registerTool.mockClear()
    vi.mocked(loadConfig).mockResolvedValue(TEST_CONFIG)

    registerSessionTools(server, sessionManager, projectDir)
  })

  afterEach(async () => {
    vi.useRealTimers()
    await rm(projectDir, { recursive: true, force: true })
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

  it('returns an error when a targeted session does not exist', async () => {
    const result = await getTool('invoke_cleanup_sessions').handler({ session_id: 'missing-session' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe("Session error: Session 'missing-session' does not exist")
  })
})
