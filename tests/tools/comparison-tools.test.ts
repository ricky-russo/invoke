import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SessionManager } from '../../src/session/manager.js'
import { registerComparisonTools } from '../../src/tools/comparison-tools.js'
import type { DispatchMetric, PipelineState } from '../../src/types.js'

type ToolInput = {
  session_ids: string[]
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

describe('registerComparisonTools', () => {
  let projectDir: string
  let sessionManager: SessionManager
  let registeredTools: Map<string, RegisteredTool>

  const registerTool = (name: string, config: RegisteredTool['config'], handler: RegisteredTool['handler']) => {
    registeredTools.set(name, { config, handler })
  }

  const server = { registerTool } as unknown as McpServer

  function getTool(name: string): RegisteredTool {
    const tool = registeredTools.get(name)
    if (!tool) {
      throw new Error(`Tool ${name} was not registered`)
    }
    return tool
  }

  async function writeSessionState(sessionId: string, state: PipelineState): Promise<void> {
    const sessionDir = path.join(projectDir, '.invoke', 'sessions', sessionId)
    await mkdir(sessionDir, { recursive: true })
    await writeFile(path.join(sessionDir, 'state.json'), JSON.stringify(state, null, 2) + '\n')
  }

  async function writeSessionStateRaw(sessionId: string, state: Record<string, unknown>): Promise<void> {
    const sessionDir = path.join(projectDir, '.invoke', 'sessions', sessionId)
    await mkdir(sessionDir, { recursive: true })
    await writeFile(path.join(sessionDir, 'state.json'), JSON.stringify(state, null, 2) + '\n')
  }

  async function writeRootMetrics(metrics: DispatchMetric[]): Promise<void> {
    const invokeDir = path.join(projectDir, '.invoke')
    await mkdir(invokeDir, { recursive: true })
    await writeFile(path.join(invokeDir, 'metrics.json'), JSON.stringify(metrics, null, 2) + '\n')
  }

  beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-comparison-tools-'))
    sessionManager = new SessionManager(projectDir)
    registeredTools = new Map()

    registerComparisonTools(server, projectDir, sessionManager)
  })

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
  })

  it('registers the invoke_compare_sessions schema', () => {
    const tool = getTool('invoke_compare_sessions')

    expect(tool.config.inputSchema.safeParse({ session_ids: ['session-a', 'session-b'] }).success).toBe(true)
    expect(tool.config.inputSchema.safeParse({ session_ids: ['session-a'] }).success).toBe(false)
  })

  it('returns a markdown comparison table for two or more sessions', async () => {
    await writeSessionState('session-a', createState({ pipeline_id: 'pipeline-a' }))
    await writeSessionState('session-b', createState({ pipeline_id: 'pipeline-b' }))
    await writeRootMetrics([
      {
        pipeline_id: 'pipeline-a',
        stage: 'build',
        role: 'builder',
        subrole: 'default',
        provider: 'claude',
        model: 'opus-4.6',
        effort: 'medium',
        prompt_size_chars: 100,
        duration_ms: 200,
        status: 'success',
        started_at: '2026-04-04T12:00:00.000Z',
        estimated_cost_usd: 0.05,
      },
      {
        pipeline_id: 'pipeline-b',
        stage: 'build',
        role: 'builder',
        subrole: 'default',
        provider: 'claude',
        model: 'opus-4.6',
        effort: 'medium',
        prompt_size_chars: 150,
        duration_ms: 350,
        status: 'success',
        started_at: '2026-04-04T12:10:00.000Z',
        estimated_cost_usd: 0.08,
      },
      {
        pipeline_id: 'pipeline-b',
        stage: 'review',
        role: 'reviewer',
        subrole: 'security',
        provider: 'codex',
        model: 'gpt-5',
        effort: 'high',
        prompt_size_chars: 60,
        duration_ms: 150,
        status: 'error',
        started_at: '2026-04-04T12:12:00.000Z',
      },
    ])

    const result = await getTool('invoke_compare_sessions').handler({
      session_ids: ['session-a', 'session-b'],
    })

    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toBe(
      [
        '| Session | Dispatches | Success Rate | Duration | Prompt Chars | Est. Cost |',
        '| --- | ---: | ---: | ---: | ---: | ---: |',
        '| session-a | 1 | 100.0% | 200 | 100 | 0.05 |',
        '| session-b | 2 | 50.0% | 500 | 210 | 0.08 |',
        '| Delta | 1 (100.0%) | -50.0 pts (-50.0%) | 300 (150.0%) | 110 (110.0%) | 0.03 (60.0%) |',
      ].join('\n')
    )
  })

  it('returns an error when any requested session does not exist', async () => {
    await writeSessionState('session-a', createState({ pipeline_id: 'pipeline-a' }))

    const result = await getTool('invoke_compare_sessions').handler({
      session_ids: ['session-a', 'missing-session'],
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe("Comparison error: Session 'missing-session' does not exist")
  })

  it('treats sessions without a bound pipeline_id as having no metrics', async () => {
    await writeSessionStateRaw('session-a', {
      started: '2026-04-01T08:00:00.000Z',
      last_updated: '2026-04-05T09:00:00.000Z',
      current_stage: 'build',
      batches: [],
      review_cycles: [],
    })
    await writeSessionState('session-b', createState({ pipeline_id: 'pipeline-b' }))
    await writeRootMetrics([
      {
        pipeline_id: null,
        stage: 'build',
        role: 'builder',
        subrole: 'default',
        provider: 'claude',
        model: 'opus-4.6',
        effort: 'medium',
        prompt_size_chars: 999,
        duration_ms: 999,
        status: 'success',
        started_at: '2026-04-04T12:00:00.000Z',
      },
      {
        pipeline_id: 'pipeline-b',
        stage: 'build',
        role: 'builder',
        subrole: 'default',
        provider: 'codex',
        model: 'gpt-5',
        effort: 'high',
        prompt_size_chars: 100,
        duration_ms: 200,
        status: 'success',
        started_at: '2026-04-04T12:01:00.000Z',
      },
    ])

    const result = await getTool('invoke_compare_sessions').handler({
      session_ids: ['session-a', 'session-b'],
    })

    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toBe(
      [
        '| Session | Dispatches | Success Rate | Duration | Prompt Chars | Est. Cost |',
        '| --- | ---: | ---: | ---: | ---: | ---: |',
        '| session-a | 0 | 0.0% | 0 | 0 | 0 |',
        '| session-b | 1 | 100.0% | 200 | 100 | 0 |',
        '| Delta | 1 (N/A) | 100.0 pts (N/A) | 200 (N/A) | 100 (N/A) | 0 (0.0%) |',
      ].join('\n')
    )
  })
})
