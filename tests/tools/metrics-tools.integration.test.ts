import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

vi.mock('../../src/config.js', () => ({
  loadConfig: vi.fn(),
}))

import { loadConfig } from '../../src/config.js'
import { MetricsManager } from '../../src/metrics/manager.js'
import { SessionManager } from '../../src/session/manager.js'
import { registerMetricsTools } from '../../src/tools/metrics-tools.js'
import { StateManager } from '../../src/tools/state.js'
import type { DispatchMetric, InvokeConfig } from '../../src/types.js'

type RegisteredTool = {
  handler: (input: { stage?: string; session_id?: string }) => Promise<{
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
    max_dispatches: 1,
  },
}

function createMetric(
  pipelineId: string | null,
  overrides: Partial<DispatchMetric> = {}
): DispatchMetric {
  return {
    pipeline_id: pipelineId,
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
    ...overrides,
  }
}

describe('invoke_get_metrics session reads', () => {
  let projectDir: string
  let sessionManager: SessionManager
  let tools: Map<string, RegisteredTool>

  beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-metrics-tools-'))
    sessionManager = new SessionManager(projectDir)
    tools = new Map()

    vi.mocked(loadConfig).mockResolvedValue(TEST_CONFIG)

    const server = {
      registerTool(name: string, _config: unknown, handler: RegisteredTool['handler']) {
        tools.set(name, { handler })
      },
    } as unknown as McpServer

    registerMetricsTools(server, new MetricsManager(projectDir), projectDir, sessionManager)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(projectDir, { recursive: true, force: true })
  })

  it('returns session metrics from root metrics.json using the session pipeline_id', async () => {
    const sessionDir = await sessionManager.create('session-1')
    await new StateManager(projectDir, sessionDir).initialize('pipeline-session')

    const allMetrics = [
      createMetric('pipeline-session', { started_at: '2026-04-04T12:00:00.000Z' }),
      createMetric('pipeline-session', {
        stage: 'review',
        role: 'reviewer',
        subrole: 'security',
        provider: 'codex',
        model: 'gpt-5',
        effort: 'high',
        prompt_size_chars: 80,
        duration_ms: 500,
        started_at: '2026-04-04T12:01:00.000Z',
      }),
      createMetric('other-pipeline', {
        started_at: '2026-04-04T12:02:00.000Z',
      }),
    ]

    const invokeDir = path.join(projectDir, '.invoke')
    await mkdir(invokeDir, { recursive: true })
    await writeFile(path.join(invokeDir, 'metrics.json'), JSON.stringify(allMetrics, null, 2) + '\n')

    const tool = tools.get('invoke_get_metrics')
    expect(tool).toBeDefined()

    const response = await tool!.handler({ session_id: 'session-1' })
    const payload = JSON.parse(response.content[0].text) as {
      entries: DispatchMetric[]
      summary: { total_dispatches: number }
      limits: { dispatches_used: number; max_dispatches?: number; at_limit: boolean }
    }

    const persistedMetrics = JSON.parse(
      await readFile(path.join(projectDir, '.invoke', 'metrics.json'), 'utf-8')
    ) as DispatchMetric[]
    const expectedEntries = persistedMetrics.filter(metric => metric.pipeline_id === 'pipeline-session')

    expect(payload.entries).toEqual(expectedEntries)
    expect(payload.entries).toHaveLength(2)
    expect(payload.summary.total_dispatches).toBe(2)
    expect(payload.limits).toEqual({
      dispatches_used: 2,
      max_dispatches: 1,
      at_limit: true,
    })
  })
})
