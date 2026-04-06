import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/config.js', () => ({
  loadConfig: vi.fn(),
}))

vi.mock('../../src/tools/state.js', () => ({
  StateManager: vi.fn(),
}))

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { loadConfig } from '../../src/config.js'
import type { MetricsManager } from '../../src/metrics/manager.js'
import type { SessionManager } from '../../src/session/manager.js'
import { registerMetricsTools } from '../../src/tools/metrics-tools.js'
import { StateManager as StateManagerClass } from '../../src/tools/state.js'
import type { DispatchMetric, InvokeConfig, MetricsSummary } from '../../src/types.js'

type RegisteredTool = {
  config: { inputSchema: { parse: (input: unknown) => unknown } }
  handler: (input: {
    stage?: string
    session_id?: string
  }) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>
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
    max_dispatches: 10,
  },
}

const ALL_ENTRIES: DispatchMetric[] = [
  {
    pipeline_id: 'pipeline-123',
    stage: 'build',
    role: 'builder',
    subrole: 'default',
    provider: 'claude',
    model: 'opus-4.6',
    effort: 'medium',
    prompt_size_chars: 120,
    duration_ms: 300,
    status: 'success',
    started_at: '2026-04-04T12:00:00.000Z',
  },
  {
    pipeline_id: 'pipeline-123',
    stage: 'review',
    role: 'reviewer',
    subrole: 'security',
    provider: 'codex',
    model: 'gpt-5',
    effort: 'high',
    prompt_size_chars: 80,
    duration_ms: 500,
    status: 'success',
    started_at: '2026-04-04T12:01:00.000Z',
  },
]

const BUILD_ENTRIES = [ALL_ENTRIES[0]]

const BUILD_SUMMARY: MetricsSummary = {
  total_dispatches: 1,
  total_prompt_chars: 120,
  total_duration_ms: 300,
  total_estimated_cost_usd: 0,
  by_stage: {
    build: {
      dispatches: 1,
      duration_ms: 300,
      prompt_chars: 120,
      estimated_cost_usd: 0,
    },
  },
  by_provider_model: {
    'claude:opus-4.6': {
      dispatches: 1,
      duration_ms: 300,
      prompt_chars: 120,
      estimated_cost_usd: 0,
    },
  },
}

function createServer() {
  const tools = new Map<string, RegisteredTool>()
  const server = {
    registerTool(name: string, config: RegisteredTool['config'], handler: RegisteredTool['handler']) {
      tools.set(name, { config, handler })
    },
  } as unknown as McpServer

  return { server, tools }
}

describe('registerMetricsTools', () => {
  let metricsManager: Pick<
    MetricsManager,
    'getMetricsByPipelineId' | 'getSummaryByPipelineId' | 'getLimitStatus' | 'summarize'
  >
  let sessionManager: Pick<SessionManager, 'resolve'>
  let getState: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetAllMocks()
    metricsManager = {
      getMetricsByPipelineId: vi.fn(),
      getSummaryByPipelineId: vi.fn(),
      getLimitStatus: vi.fn(),
      summarize: vi.fn(),
    }
    getState = vi.fn()
    sessionManager = {
      resolve: vi.fn((sessionId: string) => `/tmp/resolved/${sessionId}`),
    }
    vi.mocked(StateManagerClass).mockImplementation(function MockedStateManager() {
      return {
        get: getState,
      } as unknown as InstanceType<typeof StateManagerClass>
    })
  })

  it('registers invoke_get_metrics and returns filtered metrics with limits', async () => {
    vi.mocked(loadConfig).mockResolvedValue(TEST_CONFIG)
    vi.mocked(metricsManager.getMetricsByPipelineId).mockResolvedValue(ALL_ENTRIES)
    vi.mocked(metricsManager.summarize).mockReturnValue(BUILD_SUMMARY)

    const { server, tools } = createServer()
    registerMetricsTools(server, metricsManager as MetricsManager, '/tmp/project')

    const tool = tools.get('invoke_get_metrics')
    expect(tool).toBeDefined()
    expect(tool!.config.inputSchema.parse({})).toEqual({})
    expect(tool!.config.inputSchema.parse({ stage: 'build' })).toEqual({ stage: 'build' })
    expect(tool!.config.inputSchema.parse({ session_id: 'session-1' })).toEqual({
      session_id: 'session-1',
    })

    const response = await tool!.handler({ stage: 'build' })

    expect(StateManagerClass).not.toHaveBeenCalled()
    expect(metricsManager.getMetricsByPipelineId).toHaveBeenCalledWith(null)
    expect(metricsManager.summarize).toHaveBeenCalledWith(BUILD_ENTRIES)
    expect(metricsManager.getSummaryByPipelineId).not.toHaveBeenCalled()
    expect(loadConfig).toHaveBeenCalledWith('/tmp/project')
    expect(metricsManager.getLimitStatus).not.toHaveBeenCalled()
    expect(response.isError).toBeUndefined()
    expect(JSON.parse(response.content[0].text)).toEqual({
      entries: BUILD_ENTRIES,
      summary: BUILD_SUMMARY,
      limits: {
        dispatches_used: 2,
        max_dispatches: 10,
        at_limit: false,
      },
    })
  })

  it('falls back to non-limited status when config cannot be loaded', async () => {
    vi.mocked(loadConfig).mockRejectedValue(new Error('missing config'))
    vi.mocked(metricsManager.getMetricsByPipelineId).mockResolvedValue(ALL_ENTRIES)
    vi.mocked(metricsManager.summarize).mockReturnValue(BUILD_SUMMARY)

    const { server, tools } = createServer()
    registerMetricsTools(server, metricsManager as MetricsManager, '/tmp/project')

    const response = await tools.get('invoke_get_metrics')!.handler({ stage: 'build' })

    expect(metricsManager.getMetricsByPipelineId).toHaveBeenCalledTimes(1)
    expect(metricsManager.getMetricsByPipelineId).toHaveBeenCalledWith(null)
    expect(metricsManager.summarize).toHaveBeenCalledWith(BUILD_ENTRIES)
    expect(metricsManager.getSummaryByPipelineId).not.toHaveBeenCalled()
    expect(metricsManager.getLimitStatus).not.toHaveBeenCalled()
    expect(JSON.parse(response.content[0].text)).toEqual({
      entries: BUILD_ENTRIES,
      summary: BUILD_SUMMARY,
      limits: {
        dispatches_used: 2,
        at_limit: false,
      },
    })
  })

  it('reads session pipeline_id and uses the root metrics manager when session_id is provided', async () => {
    vi.mocked(loadConfig).mockResolvedValue(TEST_CONFIG)
    getState.mockResolvedValue({ pipeline_id: 'pipeline-123' })
    vi.mocked(metricsManager.getMetricsByPipelineId).mockResolvedValue(BUILD_ENTRIES)
    vi.mocked(metricsManager.summarize).mockReturnValue(BUILD_SUMMARY)

    const { server, tools } = createServer()
    registerMetricsTools(
      server,
      metricsManager as MetricsManager,
      '/tmp/project',
      sessionManager as SessionManager
    )

    const response = await tools.get('invoke_get_metrics')!.handler({
      stage: 'build',
      session_id: 'session-42',
    })

    expect(sessionManager.resolve).toHaveBeenCalledWith('session-42')
    expect(StateManagerClass).toHaveBeenCalledWith('/tmp/project', '/tmp/resolved/session-42')
    expect(getState).toHaveBeenCalledTimes(1)
    expect(metricsManager.getMetricsByPipelineId).toHaveBeenCalledWith('pipeline-123')
    expect(metricsManager.summarize).toHaveBeenCalledWith(BUILD_ENTRIES)
    expect(metricsManager.getSummaryByPipelineId).not.toHaveBeenCalled()
    expect(metricsManager.getLimitStatus).not.toHaveBeenCalled()
    expect(JSON.parse(response.content[0].text)).toEqual({
      entries: BUILD_ENTRIES,
      summary: BUILD_SUMMARY,
      limits: {
        dispatches_used: 1,
        max_dispatches: 10,
        at_limit: false,
      },
    })
  })

  it('returns an empty response when the session has no bound pipeline_id', async () => {
    getState.mockResolvedValue({})

    const { server, tools } = createServer()
    registerMetricsTools(
      server,
      metricsManager as MetricsManager,
      '/tmp/project',
      sessionManager as SessionManager
    )

    const response = await tools.get('invoke_get_metrics')!.handler({
      stage: 'build',
      session_id: 'session-unbound',
    })

    expect(sessionManager.resolve).toHaveBeenCalledWith('session-unbound')
    expect(metricsManager.getMetricsByPipelineId).not.toHaveBeenCalled()
    expect(metricsManager.getSummaryByPipelineId).not.toHaveBeenCalled()
    expect(metricsManager.summarize).not.toHaveBeenCalled()
    expect(metricsManager.getLimitStatus).not.toHaveBeenCalled()
    expect(loadConfig).not.toHaveBeenCalled()
    expect(JSON.parse(response.content[0].text)).toEqual({
      entries: [],
      summary: {
        total_dispatches: 0,
        total_prompt_chars: 0,
        total_duration_ms: 0,
        total_estimated_cost_usd: 0,
        by_stage: {},
        by_provider_model: {},
      },
      limits: {
        dispatches_used: 0,
        at_limit: false,
      },
    })
  })

  it('resolves the session state on each request and does not cache session metrics managers', async () => {
    vi.mocked(loadConfig).mockResolvedValue(TEST_CONFIG)
    getState.mockResolvedValue({ pipeline_id: 'pipeline-123' })
    vi.mocked(metricsManager.getMetricsByPipelineId).mockResolvedValue(BUILD_ENTRIES)
    vi.mocked(metricsManager.summarize).mockReturnValue(BUILD_SUMMARY)

    const { server, tools } = createServer()
    registerMetricsTools(
      server,
      metricsManager as MetricsManager,
      '/tmp/project',
      sessionManager as SessionManager
    )

    const handler = tools.get('invoke_get_metrics')!.handler
    await handler({ session_id: 'session-cache-1' })
    await handler({ session_id: 'session-cache-1' })

    expect(StateManagerClass).toHaveBeenCalledTimes(2)
    expect(sessionManager.resolve).toHaveBeenCalledTimes(2)
    expect(sessionManager.resolve).toHaveBeenCalledWith('session-cache-1')
    expect(StateManagerClass).toHaveBeenCalledWith('/tmp/project', '/tmp/resolved/session-cache-1')
    expect(metricsManager.getMetricsByPipelineId).toHaveBeenCalledTimes(2)
    expect(metricsManager.summarize).toHaveBeenCalledTimes(2)
    expect(metricsManager.getSummaryByPipelineId).not.toHaveBeenCalled()
    expect(metricsManager.getLimitStatus).not.toHaveBeenCalled()
  })

  it('returns isError when metrics cannot be read', async () => {
    vi.mocked(metricsManager.getMetricsByPipelineId).mockRejectedValue(new Error('metrics unavailable'))

    const { server, tools } = createServer()
    registerMetricsTools(server, metricsManager as MetricsManager, '/tmp/project')

    const response = await tools.get('invoke_get_metrics')!.handler({})

    expect(response.isError).toBe(true)
    expect(response.content[0].text).toContain('Metrics error: metrics unavailable')
    expect(loadConfig).not.toHaveBeenCalled()
  })
})
