import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { BatchManager } from '../../src/dispatch/batch-manager.js'
import type { DispatchEngine } from '../../src/dispatch/engine.js'
import type { MetricsManager } from '../../src/metrics/manager.js'
import type { SessionManager } from '../../src/session/manager.js'

vi.mock('../../src/config.js', () => ({
  loadConfig: vi.fn(),
}))

import { loadConfig } from '../../src/config.js'
import { StateManager } from '../../src/tools/state.js'
import { registerDispatchTools } from '../../src/tools/dispatch-tools.js'
import type { InvokeConfig } from '../../src/types.js'

type ToolResponse = {
  content: Array<{ type: string; text: string }>
  isError?: boolean
}

type RegisteredTool = {
  config: { inputSchema: { parse: (input: unknown) => unknown } }
  handler: (args: any) => Promise<ToolResponse>
}

function createConfig(overrides: Partial<InvokeConfig> = {}): InvokeConfig {
  const config: InvokeConfig = {
    providers: {
      claude: { cli: 'claude', args: ['--print', '--model', '{{model}}'] },
      codex: { cli: 'codex', args: ['run', '--model', '{{model}}'] },
      gemini: { cli: 'gemini', args: ['--model', '{{model}}'] },
    },
    roles: {
      builder: {
        parallel: {
          prompt: '.invoke/roles/builder/parallel.md',
          providers: [
            { provider: 'claude', model: 'claude-sonnet-4-6', effort: 'medium' },
            { provider: 'codex', model: 'gpt-5', effort: 'high' },
          ],
          provider_mode: 'parallel',
        },
        fallback: {
          prompt: '.invoke/roles/builder/fallback.md',
          providers: [
            { provider: 'claude', model: 'claude-sonnet-4-6', effort: 'medium' },
            { provider: 'codex', model: 'gpt-5', effort: 'high' },
          ],
          provider_mode: 'fallback',
        },
        inherited: {
          prompt: '.invoke/roles/builder/inherited.md',
          providers: [
            { provider: 'claude', model: 'claude-sonnet-4-6', effort: 'medium' },
            { provider: 'gemini', model: 'gemini-2.5-pro', effort: 'low' },
          ],
        },
      },
    },
    strategies: {},
    settings: {
      default_strategy: 'tdd',
      agent_timeout: 300,
      commit_style: 'per-batch',
      work_branch_prefix: 'invoke/work',
      default_provider_mode: 'single',
    },
  }

  return {
    ...config,
    ...overrides,
    providers: overrides.providers ?? config.providers,
    roles: overrides.roles ?? config.roles,
    strategies: overrides.strategies ?? config.strategies,
    settings: {
      ...config.settings,
      ...overrides.settings,
    },
  }
}

function createTestContext({
  metricsManager = { getLimitStatus: vi.fn() } as unknown as MetricsManager,
  sessionManager,
}: {
  metricsManager?: MetricsManager
  sessionManager?: SessionManager
} = {}) {
  const tools = new Map<string, RegisteredTool>()
  let dispatchedStateManager: unknown
  const rootStateManager = new StateManager('/tmp/project')
  const dispatchBatch = vi.fn(function dispatchBatch(this: { stateManager?: unknown }) {
    dispatchedStateManager = this.stateManager
    return Promise.resolve('batch-123')
  })
  const server = {
    registerTool: vi.fn((name: string, config: RegisteredTool['config'], handler: RegisteredTool['handler']) => {
      tools.set(name, { config, handler })
    }),
  } as unknown as McpServer

  const engine = {
    dispatch: vi.fn(),
  } as unknown as DispatchEngine

  const batchManager = {
    dispatchBatch,
    getStatus: vi.fn(),
    waitForStatus: vi.fn(),
    cancel: vi.fn(),
    stateManager: rootStateManager,
  } as unknown as BatchManager

  registerDispatchTools(server, engine, batchManager, '/tmp/project', metricsManager, sessionManager)

  return {
    tools,
    dispatchBatch,
    dispatchedStateManager: () => dispatchedStateManager,
    rootStateManager,
  }
}

describe('registerDispatchTools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('includes provider_mode in the batch response and estimates dispatches by mode without metrics', async () => {
    vi.mocked(loadConfig).mockResolvedValue(createConfig({
      settings: {
        default_strategy: 'tdd',
        agent_timeout: 300,
        commit_style: 'per-batch',
        work_branch_prefix: 'invoke/work',
        default_provider_mode: 'single',
        max_parallel_agents: 4,
      },
    }))

    const { tools, dispatchBatch } = createTestContext()
    const invokeDispatchBatch = tools.get('invoke_dispatch_batch')

    expect(invokeDispatchBatch).toBeDefined()
    expect(invokeDispatchBatch!.config.inputSchema.parse({ session_id: 'session-1', tasks: [], create_worktrees: false }))
      .toEqual({ session_id: 'session-1', tasks: [], create_worktrees: false })

    const response = await invokeDispatchBatch!.handler({
      tasks: [
        { task_id: 'task-1', role: 'builder', subrole: 'parallel', task_context: {} },
        { task_id: 'task-2', role: 'builder', subrole: 'fallback', task_context: {} },
        { task_id: 'task-3', role: 'builder', subrole: 'inherited', task_context: {} },
      ],
      create_worktrees: true,
    })

    expect(dispatchBatch).toHaveBeenCalledWith({
      tasks: [
        { taskId: 'task-1', role: 'builder', subrole: 'parallel', taskContext: {} },
        { taskId: 'task-2', role: 'builder', subrole: 'fallback', taskContext: {} },
        { taskId: 'task-3', role: 'builder', subrole: 'inherited', taskContext: {} },
      ],
      createWorktrees: true,
      maxParallel: 4,
    })

    const payload = JSON.parse(response.content[0].text)

    expect(payload).toEqual({
      batch_id: 'batch-123',
      status: 'dispatched',
      tasks: [
        {
          task_id: 'task-1',
          providers: [
            { provider: 'claude', model: 'claude-sonnet-4-6', effort: 'medium' },
            { provider: 'codex', model: 'gpt-5', effort: 'high' },
          ],
          provider_mode: 'parallel',
        },
        {
          task_id: 'task-2',
          providers: [
            { provider: 'claude', model: 'claude-sonnet-4-6', effort: 'medium' },
            { provider: 'codex', model: 'gpt-5', effort: 'high' },
          ],
          provider_mode: 'fallback',
        },
        {
          task_id: 'task-3',
          providers: [
            { provider: 'claude', model: 'claude-sonnet-4-6', effort: 'medium' },
            { provider: 'gemini', model: 'gemini-2.5-pro', effort: 'low' },
          ],
          provider_mode: 'single',
        },
      ],
      dispatch_estimate: 4,
    })
  })

  it('adds an approaching max_dispatches warning when the projected usage exceeds 80 percent', async () => {
    const config = createConfig({
      settings: {
        default_strategy: 'tdd',
        agent_timeout: 300,
        commit_style: 'per-batch',
        work_branch_prefix: 'invoke/work',
        default_provider_mode: 'parallel',
        max_dispatches: 10,
      },
    })
    const metricsManager = {
      getLimitStatus: vi.fn().mockResolvedValue({
        dispatches_used: 7,
        max_dispatches: 10,
        at_limit: false,
      }),
    } as unknown as MetricsManager

    vi.mocked(loadConfig).mockResolvedValue(config)

    const { tools } = createTestContext({ metricsManager })
    const response = await tools.get('invoke_dispatch_batch')!.handler({
      tasks: [
        { task_id: 'task-1', role: 'builder', subrole: 'parallel', task_context: {} },
      ],
      create_worktrees: false,
    })

    expect(metricsManager.getLimitStatus).toHaveBeenCalledWith(config)

    const payload = JSON.parse(response.content[0].text)
    expect(payload.dispatch_estimate).toBe(2)
    expect(payload.warning).toBe('Approaching max_dispatches limit (9/10)')
  })

  it('adds an exceeding max_dispatches warning when the projected usage exceeds the limit', async () => {
    const metricsManager = {
      getLimitStatus: vi.fn().mockResolvedValue({
        dispatches_used: 9,
        max_dispatches: 10,
        at_limit: false,
      }),
    } as unknown as MetricsManager

    vi.mocked(loadConfig).mockResolvedValue(createConfig({
      settings: {
        default_strategy: 'tdd',
        agent_timeout: 300,
        commit_style: 'per-batch',
        work_branch_prefix: 'invoke/work',
        default_provider_mode: 'parallel',
        max_dispatches: 10,
      },
    }))

    const { tools } = createTestContext({ metricsManager })
    const response = await tools.get('invoke_dispatch_batch')!.handler({
      tasks: [
        { task_id: 'task-1', role: 'builder', subrole: 'parallel', task_context: {} },
      ],
      create_worktrees: false,
    })

    const payload = JSON.parse(response.content[0].text)
    expect(payload.dispatch_estimate).toBe(2)
    expect(payload.warning).toBe('Exceeding max_dispatches limit (11/10)')
  })

  it('does not query metrics or include a warning when max_dispatches is not configured', async () => {
    const metricsManager = {
      getLimitStatus: vi.fn(),
    } as unknown as MetricsManager

    vi.mocked(loadConfig).mockResolvedValue(createConfig({
      settings: {
        default_strategy: 'tdd',
        agent_timeout: 300,
        commit_style: 'per-batch',
        work_branch_prefix: 'invoke/work',
        default_provider_mode: 'parallel',
      },
    }))

    const { tools } = createTestContext({ metricsManager })
    const response = await tools.get('invoke_dispatch_batch')!.handler({
      tasks: [
        { task_id: 'task-1', role: 'builder', subrole: 'parallel', task_context: {} },
      ],
      create_worktrees: false,
    })

    expect(metricsManager.getLimitStatus).not.toHaveBeenCalled()

    const payload = JSON.parse(response.content[0].text)
    expect(payload).not.toHaveProperty('warning')
  })

  it('uses a session-scoped state manager when session_id is provided', async () => {
    vi.mocked(loadConfig).mockResolvedValue(createConfig())
    const sessionManager = {
      resolve: vi.fn().mockReturnValue('/tmp/validated/session-9'),
    } as unknown as SessionManager

    const { tools, dispatchBatch, dispatchedStateManager, rootStateManager } = createTestContext({
      sessionManager,
    })
    const response = await tools.get('invoke_dispatch_batch')!.handler({
      tasks: [
        { task_id: 'task-1', role: 'builder', subrole: 'parallel', task_context: {} },
      ],
      create_worktrees: true,
      session_id: 'session-9',
    })

    expect(dispatchBatch).toHaveBeenCalledTimes(1)
    expect(sessionManager.resolve).toHaveBeenCalledWith('session-9')
    expect(dispatchedStateManager()).toBeInstanceOf(StateManager)
    expect(dispatchedStateManager()).not.toBe(rootStateManager)
    expect((dispatchedStateManager() as { storageDir: string }).storageDir).toBe(
      '/tmp/validated/session-9'
    )
    expect(JSON.parse(response.content[0].text)).toMatchObject({
      batch_id: 'batch-123',
      status: 'dispatched',
    })
  })
})
