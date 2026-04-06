import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, rm } from 'fs/promises'
import path from 'path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

vi.mock('../../src/config.js', () => ({
  loadConfig: vi.fn(),
}))

import { loadConfig } from '../../src/config.js'
import { SessionManager } from '../../src/session/manager.js'
import { StateManager } from '../../src/tools/state.js'
import { registerStateTools } from '../../src/tools/state-tools.js'
import type { InvokeConfig } from '../../src/types.js'

const TEST_DIR = path.join(import.meta.dirname, 'fixtures', 'state-tools-test')

const testConfig: InvokeConfig = {
  providers: {
    claude: { cli: 'claude', args: ['--print', '--model', '{{model}}'] },
  },
  roles: {
    builder: {
      default: {
        prompt: '.invoke/roles/builder/default.md',
        providers: [{ provider: 'claude', model: 'claude-sonnet-4-6', effort: 'medium' }],
      },
    },
  },
  strategies: {},
  settings: {
    default_strategy: 'tdd',
    agent_timeout: 300,
    commit_style: 'per-batch',
    work_branch_prefix: 'invoke/work',
    max_review_cycles: 3,
  },
}

type RegisteredTool = {
  config: {
    inputSchema: {
      safeParse: (input: unknown) => { success: boolean }
    }
  }
  handler: (input: Record<string, unknown>) => Promise<{
    content: Array<{ type: string, text: string }>
    isError?: boolean
  }>
}

let stateManager: StateManager
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

function parseResponseText(result: Awaited<ReturnType<RegisteredTool['handler']>>) {
  return JSON.parse(result.content[0].text) as Record<string, unknown>
}

beforeEach(async () => {
  await mkdir(path.join(TEST_DIR, '.invoke'), { recursive: true })
  stateManager = new StateManager(TEST_DIR)
  sessionManager = new SessionManager(TEST_DIR)
  registeredTools = new Map()
  registerTool.mockClear()
  vi.mocked(loadConfig).mockResolvedValue(testConfig)
  registerStateTools(server, stateManager, TEST_DIR, sessionManager)
})

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('registerStateTools', () => {
  it('accepts session_id in all state tool schemas', () => {
    expect(getTool('invoke_get_state').config.inputSchema.safeParse({ session_id: 'session-1' }).success).toBe(true)
    expect(getTool('invoke_set_state').config.inputSchema.safeParse({ session_id: 'session-1' }).success).toBe(true)
    expect(
      getTool('invoke_get_review_cycle_count').config.inputSchema.safeParse({ session_id: 'session-1' }).success
    ).toBe(true)
  })

  it('accepts batch_id, scope, and tier in invoke_set_state review_cycles', async () => {
    const createSpy = vi.spyOn(sessionManager, 'create')
    const setStateTool = getTool('invoke_set_state')
    const input = {
      session_id: 'session-1',
      pipeline_id: 'pipeline-123',
      review_cycles: [
        {
          id: 1,
          reviewers: ['reviewer-a'],
          findings: [],
          batch_id: 2,
          scope: 'batch' as const,
          tier: 'critical',
          triaged: {
            accepted: [],
            dismissed: [],
          },
        },
      ],
    }

    expect(setStateTool.config.inputSchema.safeParse(input).success).toBe(true)

    const result = await setStateTool.handler(input)
    expect(result.isError).toBeUndefined()
    expect(createSpy).toHaveBeenCalledWith('session-1')

    const sessionStateManager = new StateManager(
      TEST_DIR,
      sessionManager.resolve('session-1')
    )
    const state = await sessionStateManager.get()
    expect(state?.review_cycles).toEqual([
      {
        id: 1,
        reviewers: ['reviewer-a'],
        findings: [],
        batch_id: 2,
        scope: 'batch',
        tier: 'critical',
        triaged: {
          accepted: [],
          dismissed: [],
        },
      },
    ])
    await expect(stateManager.get()).resolves.toBeNull()
  })

  it('accepts partial batch state and merged task flags in invoke_set_state', async () => {
    const setStateTool = getTool('invoke_set_state')
    const input = {
      session_id: 'session-1',
      pipeline_id: 'pipeline-123',
      tasks: 'plans/2026-04-06-auth-middleware-tasks.json',
      batches: [
        {
          id: 1,
          status: 'partial' as const,
          merged_tasks: ['task-1'],
          tasks: [
            {
              id: 'task-1',
              status: 'completed' as const,
              result_status: 'success' as const,
              merged: true,
            },
            {
              id: 'task-2',
              status: 'running' as const,
            },
          ],
        },
      ],
    }

    expect(setStateTool.config.inputSchema.safeParse(input).success).toBe(true)

    const result = await setStateTool.handler(input)
    expect(result.isError).toBeUndefined()

    const sessionStateManager = new StateManager(
      TEST_DIR,
      sessionManager.resolve('session-1')
    )
    const state = await sessionStateManager.get()
    expect(state?.tasks).toBe('plans/2026-04-06-auth-middleware-tasks.json')
    expect(state?.batches).toEqual([
      {
        id: 1,
        status: 'partial',
        merged_tasks: ['task-1'],
        tasks: [
          {
            id: 'task-1',
            status: 'completed',
            result_status: 'success',
            merged: true,
          },
          {
            id: 'task-2',
            status: 'running',
          },
        ],
      },
    ])
  })

  it('returns session-scoped state when session_id is provided to invoke_get_state', async () => {
    const resolveSpy = vi.spyOn(sessionManager, 'resolve')
    const sessionStateManager = new StateManager(TEST_DIR, await sessionManager.create('session-1'))
    await sessionStateManager.initialize('pipeline-session')

    const result = await getTool('invoke_get_state').handler({ session_id: 'session-1' })
    expect(result.isError).toBeUndefined()
    expect(resolveSpy).toHaveBeenCalledWith('session-1')
    expect(parseResponseText(result)).toMatchObject({
      pipeline_id: 'pipeline-session',
    })
  })

  it('returns the legacy root state when no session_id is provided and root state exists', async () => {
    await stateManager.initialize('pipeline-root')

    const result = await getTool('invoke_get_state').handler({})
    expect(result.isError).toBeUndefined()
    expect(parseResponseText(result)).toMatchObject({
      pipeline_id: 'pipeline-root',
    })
  })

  it('returns a helpful error when no session_id is provided and no root state exists', async () => {
    const result = await getTool('invoke_get_state').handler({})

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe(
      'No session_id provided. Use invoke_list_sessions to see available sessions.'
    )
  })

  it('returns the total review cycle count and configured limit', async () => {
    await stateManager.initialize('pipeline-123')
    await stateManager.update({
      review_cycles: [
        { id: 1, reviewers: ['reviewer-a'], findings: [], batch_id: 1, scope: 'batch' },
        { id: 2, reviewers: ['reviewer-b'], findings: [], batch_id: 2, scope: 'batch' },
        { id: 3, reviewers: ['reviewer-c'], findings: [], scope: 'final' },
      ],
    })

    const result = await getTool('invoke_get_review_cycle_count').handler({})
    expect(result.isError).toBeUndefined()
    expect(parseResponseText(result)).toEqual({
      count: 3,
      max_review_cycles: 3,
    })
  })

  it('filters the review cycle count by batch_id', async () => {
    await stateManager.initialize('pipeline-123')
    await stateManager.update({
      review_cycles: [
        { id: 1, reviewers: ['reviewer-a'], findings: [], batch_id: 1, scope: 'batch' },
        { id: 2, reviewers: ['reviewer-b'], findings: [], batch_id: 2, scope: 'batch' },
        { id: 3, reviewers: ['reviewer-c'], findings: [], batch_id: 2, scope: 'batch' },
      ],
    })

    const result = await getTool('invoke_get_review_cycle_count').handler({ batch_id: 2 })
    expect(result.isError).toBeUndefined()
    expect(parseResponseText(result)).toEqual({
      count: 2,
      max_review_cycles: 3,
    })
  })

  it('reads the review cycle count from session-scoped state when session_id is provided', async () => {
    const sessionStateManager = new StateManager(
      TEST_DIR,
      path.join(TEST_DIR, '.invoke', 'sessions', 'session-2')
    )
    await sessionStateManager.initialize('pipeline-123')
    await sessionStateManager.update({
      review_cycles: [
        { id: 1, reviewers: ['reviewer-a'], findings: [], batch_id: 2, scope: 'batch' },
        { id: 2, reviewers: ['reviewer-b'], findings: [], batch_id: 2, scope: 'batch' },
      ],
    })

    const result = await getTool('invoke_get_review_cycle_count').handler({
      session_id: 'session-2',
      batch_id: 2,
    })

    expect(result.isError).toBeUndefined()
    expect(parseResponseText(result)).toEqual({
      count: 2,
      max_review_cycles: 3,
    })
  })

  it('still returns the count when config loading fails', async () => {
    vi.mocked(loadConfig).mockRejectedValueOnce(new Error('missing config'))
    await stateManager.initialize('pipeline-123')
    await stateManager.update({
      review_cycles: [
        { id: 1, reviewers: ['reviewer-a'], findings: [], batch_id: 4, scope: 'batch' },
      ],
    })

    const result = await getTool('invoke_get_review_cycle_count').handler({ batch_id: 4 })
    expect(result.isError).toBeUndefined()
    expect(parseResponseText(result)).toEqual({ count: 1 })
  })
})
