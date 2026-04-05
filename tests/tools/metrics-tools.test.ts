import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/config.js', () => ({
  loadConfig: vi.fn(),
}))

vi.mock('../../src/metrics/manager.js', () => ({
  MetricsManager: vi.fn(),
}))

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { loadConfig } from '../../src/config.js'
import { MetricsManager as MetricsManagerClass } from '../../src/metrics/manager.js'
import type { MetricsManager } from '../../src/metrics/manager.js'
import type { SessionManager } from '../../src/session/manager.js'
import { registerMetricsTools } from '../../src/tools/metrics-tools.js'
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
  let metricsManager: Pick<MetricsManager, 'getCurrentPipelineMetrics' | 'getSummary' | 'getLimitStatus'>
  let sessionMetricsManager: Pick<MetricsManager, 'getCurrentPipelineMetrics' | 'getSummary' | 'getLimitStatus'>
  let sessionManager: Pick<SessionManager, 'resolve'>

  beforeEach(() => {
    vi.resetAllMocks()
    metricsManager = {
      getCurrentPipelineMetrics: vi.fn(),
      getSummary: vi.fn(),
      getLimitStatus: vi.fn(),
    }
    sessionMetricsManager = {
      getCurrentPipelineMetrics: vi.fn(),
      getSummary: vi.fn(),
      getLimitStatus: vi.fn(),
    }
    sessionManager = {
      resolve: vi.fn((sessionId: string) => `/tmp/resolved/${sessionId}`),
    }
  })

  it('registers invoke_get_metrics and returns filtered metrics with limits', async () => {
    vi.mocked(loadConfig).mockResolvedValue(TEST_CONFIG)
    vi.mocked(metricsManager.getCurrentPipelineMetrics).mockResolvedValue(BUILD_ENTRIES)
    vi.mocked(metricsManager.getSummary).mockResolvedValue(BUILD_SUMMARY)
    vi.mocked(metricsManager.getLimitStatus).mockResolvedValue({
      dispatches_used: 2,
      max_dispatches: 10,
      at_limit: false,
    })

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

    expect(MetricsManagerClass).not.toHaveBeenCalled()
    expect(metricsManager.getCurrentPipelineMetrics).toHaveBeenCalledWith({ stage: 'build' })
    expect(metricsManager.getSummary).toHaveBeenCalledWith({ stage: 'build' })
    expect(loadConfig).toHaveBeenCalledWith('/tmp/project')
    expect(metricsManager.getLimitStatus).toHaveBeenCalledWith(TEST_CONFIG)
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
    vi.mocked(metricsManager.getCurrentPipelineMetrics)
      .mockResolvedValueOnce(BUILD_ENTRIES)
      .mockResolvedValueOnce(ALL_ENTRIES)
    vi.mocked(metricsManager.getSummary).mockResolvedValue(BUILD_SUMMARY)

    const { server, tools } = createServer()
    registerMetricsTools(server, metricsManager as MetricsManager, '/tmp/project')

    const response = await tools.get('invoke_get_metrics')!.handler({ stage: 'build' })

    expect(metricsManager.getCurrentPipelineMetrics).toHaveBeenNthCalledWith(1, { stage: 'build' })
    expect(metricsManager.getCurrentPipelineMetrics).toHaveBeenNthCalledWith(2)
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

  it('creates a session-scoped metrics manager when session_id is provided', async () => {
    vi.mocked(loadConfig).mockResolvedValue(TEST_CONFIG)
    vi.mocked(MetricsManagerClass).mockImplementation(function MockedMetricsManager() {
      return sessionMetricsManager as MetricsManager
    })
    vi.mocked(sessionMetricsManager.getCurrentPipelineMetrics).mockResolvedValue(BUILD_ENTRIES)
    vi.mocked(sessionMetricsManager.getSummary).mockResolvedValue(BUILD_SUMMARY)
    vi.mocked(sessionMetricsManager.getLimitStatus).mockResolvedValue({
      dispatches_used: 1,
      max_dispatches: 10,
      at_limit: false,
    })

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
    expect(MetricsManagerClass).toHaveBeenCalledWith('/tmp/project', '/tmp/resolved/session-42')
    expect(metricsManager.getCurrentPipelineMetrics).not.toHaveBeenCalled()
    expect(sessionMetricsManager.getCurrentPipelineMetrics).toHaveBeenCalledWith({ stage: 'build' })
    expect(sessionMetricsManager.getSummary).toHaveBeenCalledWith({ stage: 'build' })
    expect(sessionMetricsManager.getLimitStatus).toHaveBeenCalledWith(TEST_CONFIG)
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

  it('reuses the same session-scoped metrics manager for repeated requests', async () => {
    vi.mocked(loadConfig).mockResolvedValue(TEST_CONFIG)
    vi.mocked(MetricsManagerClass).mockImplementation(function MockedMetricsManager() {
      return sessionMetricsManager as MetricsManager
    })
    vi.mocked(sessionMetricsManager.getCurrentPipelineMetrics).mockResolvedValue(BUILD_ENTRIES)
    vi.mocked(sessionMetricsManager.getSummary).mockResolvedValue(BUILD_SUMMARY)
    vi.mocked(sessionMetricsManager.getLimitStatus).mockResolvedValue({
      dispatches_used: 1,
      max_dispatches: 10,
      at_limit: false,
    })

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

    expect(MetricsManagerClass).toHaveBeenCalledTimes(1)
    expect(sessionManager.resolve).toHaveBeenCalledTimes(1)
    expect(sessionManager.resolve).toHaveBeenCalledWith('session-cache-1')
    expect(MetricsManagerClass).toHaveBeenCalledWith('/tmp/project', '/tmp/resolved/session-cache-1')
    expect(sessionMetricsManager.getCurrentPipelineMetrics).toHaveBeenCalledTimes(2)
    expect(sessionMetricsManager.getSummary).toHaveBeenCalledTimes(2)
    expect(sessionMetricsManager.getLimitStatus).toHaveBeenCalledTimes(2)
  })

  it('returns isError when metrics cannot be read', async () => {
    vi.mocked(metricsManager.getCurrentPipelineMetrics).mockRejectedValue(new Error('metrics unavailable'))

    const { server, tools } = createServer()
    registerMetricsTools(server, metricsManager as MetricsManager, '/tmp/project')

    const response = await tools.get('invoke_get_metrics')!.handler({})

    expect(response.isError).toBe(true)
    expect(response.content[0].text).toContain('Metrics error: metrics unavailable')
    expect(loadConfig).not.toHaveBeenCalled()
  })
})
