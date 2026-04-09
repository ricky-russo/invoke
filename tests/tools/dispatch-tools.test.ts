import { mkdtemp, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
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
import type { AgentResult, InvokeConfig, PipelineState } from '../../src/types.js'

type ToolResponse = {
  content: Array<{ type: string; text: string }>
  isError?: boolean
}

type RegisteredTool = {
  config: { inputSchema: { parse: (input: unknown) => unknown } }
  handler: (args: any) => Promise<ToolResponse>
}

function ownedBatch(sessionId: string) {
  return { kind: 'owned' as const, sessionId }
}

function unownedBatch() {
  return { kind: 'unowned' as const }
}

function missingBatch() {
  return { kind: 'not_found' as const }
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
  metricsManager = {
    getLimitStatus: vi.fn(),
    getMetricsByPipelineId: vi.fn(),
  } as unknown as MetricsManager,
  sessionManager,
  projectDir = '/tmp/project',
}: {
  metricsManager?: MetricsManager
  sessionManager?: SessionManager
  projectDir?: string
} = {}) {
  const tools = new Map<string, RegisteredTool>()
  const dispatchedStateManagers: unknown[] = []
  const rootStateManager = new StateManager(projectDir)
  const dispatchBatch = vi.fn((_request: unknown, options?: { stateManager?: unknown }) => {
    dispatchedStateManagers.push(options?.stateManager)
    return Promise.resolve('batch-123')
  })
  const getBatchOwner = vi.fn()
  const getStatus = vi.fn()
  const waitForStatus = vi.fn()
  const getTaskResult = vi.fn()
  const cancel = vi.fn()
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
    getBatchOwner,
    getStatus,
    waitForStatus,
    getTaskResult,
    cancel,
  } as unknown as BatchManager

  registerDispatchTools(server, engine, batchManager, projectDir, metricsManager, sessionManager)

  return {
    tools,
    dispatchBatch,
    getBatchOwner,
    getStatus,
    waitForStatus,
    getTaskResult,
    cancel,
    dispatchedStateManager: () => dispatchedStateManagers[dispatchedStateManagers.length - 1],
    dispatchedStateManagers: () => [...dispatchedStateManagers],
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
    }, {
      stateManager: undefined,
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

    expect(metricsManager.getLimitStatus).toHaveBeenCalledWith(config, null)

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

  it('blocks dispatch when max_dispatches has already been reached', async () => {
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
        dispatches_used: 10,
        max_dispatches: 10,
        at_limit: true,
      }),
    } as unknown as MetricsManager
    const getStateSpy = vi
      .spyOn(StateManager.prototype, 'get')
      .mockResolvedValue({ pipeline_id: 'blocked-pipeline' } as any)

    vi.mocked(loadConfig).mockResolvedValue(config)

    try {
      const { tools, dispatchBatch } = createTestContext({ metricsManager })
      const response = await tools.get('invoke_dispatch_batch')!.handler({
        tasks: [
          { task_id: 'task-1', role: 'builder', subrole: 'parallel', task_context: {} },
        ],
        create_worktrees: false,
      })

      expect(metricsManager.getLimitStatus).toHaveBeenCalledWith(config, 'blocked-pipeline')
      expect(dispatchBatch).not.toHaveBeenCalled()
      expect(response.isError).toBe(true)
      expect(response.content[0].text).toBe(
        'Dispatch blocked: pipeline blocked-pipeline has reached the max_dispatches limit (10/10 dispatches used).'
      )
    } finally {
      getStateSpy.mockRestore()
    }
  })

  it('fails closed when dispatch limit evaluation throws', async () => {
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
      getLimitStatus: vi.fn().mockRejectedValue(new Error('metrics unavailable')),
      getMetricsByPipelineId: vi.fn(),
    } as unknown as MetricsManager
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.mocked(loadConfig).mockResolvedValue(config)

    try {
      const { tools, dispatchBatch } = createTestContext({ metricsManager })
      const response = await tools.get('invoke_dispatch_batch')!.handler({
        tasks: [
          { task_id: 'task-1', role: 'builder', subrole: 'parallel', task_context: {} },
        ],
        create_worktrees: false,
      })

      expect(response.isError).toBe(true)
      expect(response.content[0].text).toBe('Dispatch blocked: failed to evaluate dispatch limit')
      expect(dispatchBatch).not.toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to evaluate dispatch limit — failing closed',
        expect.any(Error)
      )
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('reads pipeline_id from the root state manager for legacy max_dispatches warnings', async () => {
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
    const getStateSpy = vi
      .spyOn(StateManager.prototype, 'get')
      .mockResolvedValue({ pipeline_id: 'legacy-pipeline' } as any)

    vi.mocked(loadConfig).mockResolvedValue(config)

    try {
      const { tools } = createTestContext({ metricsManager })
      await tools.get('invoke_dispatch_batch')!.handler({
        tasks: [
          { task_id: 'task-1', role: 'builder', subrole: 'parallel', task_context: {} },
        ],
        create_worktrees: false,
      })

      expect(metricsManager.getLimitStatus).toHaveBeenCalledWith(config, 'legacy-pipeline')
    } finally {
      getStateSpy.mockRestore()
    }
  })

  it('reads pipeline_id from the session state manager for session max_dispatches warnings', async () => {
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
    const sessionManager = {
      exists: vi.fn().mockReturnValue(true),
      resolve: vi.fn().mockReturnValue('/tmp/validated/session-limit'),
    } as unknown as SessionManager
    const getStateSpy = vi
      .spyOn(StateManager.prototype, 'get')
      .mockResolvedValue({ pipeline_id: 'session-pipeline' } as any)

    vi.mocked(loadConfig).mockResolvedValue(config)

    try {
      const { tools } = createTestContext({ metricsManager, sessionManager })
      await tools.get('invoke_dispatch_batch')!.handler({
        tasks: [
          { task_id: 'task-1', role: 'builder', subrole: 'parallel', task_context: {} },
        ],
        create_worktrees: false,
        session_id: 'session-limit',
      })

      expect(sessionManager.resolve).toHaveBeenCalledWith('session-limit')
      expect(metricsManager.getLimitStatus).toHaveBeenCalledWith(config, 'session-pipeline')
    } finally {
      getStateSpy.mockRestore()
    }
  })

  it('falls back to legacy session metrics when the root metrics store is empty', async () => {
    const config = createConfig({
      settings: {
        default_strategy: 'tdd',
        agent_timeout: 300,
        commit_style: 'per-batch',
        work_branch_prefix: 'invoke/work',
        default_provider_mode: 'parallel',
        max_dispatches: 2,
      },
    })
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), 'dispatch-tools-session-'))
    const metricsManager = {
      getLimitStatus: vi.fn().mockResolvedValue({
        dispatches_used: 0,
        max_dispatches: 2,
        at_limit: false,
      }),
      getMetricsByPipelineId: vi.fn().mockResolvedValue([]),
    } as unknown as MetricsManager
    const sessionManager = {
      exists: vi.fn().mockReturnValue(true),
      resolve: vi.fn().mockReturnValue(sessionDir),
    } as unknown as SessionManager
    const getStateSpy = vi
      .spyOn(StateManager.prototype, 'get')
      .mockResolvedValue({ pipeline_id: 'legacy-pipeline' } as any)

    await writeFile(path.join(sessionDir, 'metrics.json'), JSON.stringify([
      {
        pipeline_id: 'legacy-pipeline',
        stage: 'build',
        role: 'builder',
        subrole: 'parallel',
        provider: 'claude',
        model: 'claude-sonnet-4-6',
        effort: 'medium',
        prompt_size_chars: 10,
        duration_ms: 20,
        status: 'success',
        started_at: '2025-01-01T00:00:00.000Z',
      },
      {
        pipeline_id: 'legacy-pipeline',
        stage: 'build',
        role: 'builder',
        subrole: 'parallel',
        provider: 'codex',
        model: 'gpt-5',
        effort: 'high',
        prompt_size_chars: 10,
        duration_ms: 20,
        status: 'success',
        started_at: '2025-01-01T00:00:01.000Z',
      },
    ], null, 2))

    vi.mocked(loadConfig).mockResolvedValue(config)

    try {
      const { tools, dispatchBatch } = createTestContext({ metricsManager, sessionManager })
      const response = await tools.get('invoke_dispatch_batch')!.handler({
        tasks: [
          { task_id: 'task-1', role: 'builder', subrole: 'parallel', task_context: {} },
        ],
        create_worktrees: false,
        session_id: 'session-legacy',
      })

      expect(metricsManager.getLimitStatus).toHaveBeenCalledWith(config, 'legacy-pipeline')
      expect(metricsManager.getMetricsByPipelineId).toHaveBeenCalledWith('legacy-pipeline', undefined)
      expect(dispatchBatch).not.toHaveBeenCalled()
      expect(response.isError).toBe(true)
      expect(response.content[0].text).toBe(
        'Dispatch blocked: pipeline legacy-pipeline has reached the max_dispatches limit (2/2 dispatches used).'
      )
    } finally {
      getStateSpy.mockRestore()
      await rm(sessionDir, { recursive: true, force: true })
    }
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
      exists: vi.fn().mockReturnValue(true),
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
    expect(dispatchBatch).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-9',
      boundPipelineId: null,
    }), expect.objectContaining({
      stateManager: expect.any(StateManager),
    }))
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

  it('reads pipeline_id from session state and passes it as boundPipelineId', async () => {
    vi.mocked(loadConfig).mockResolvedValue(createConfig())
    const sessionManager = {
      exists: vi.fn().mockReturnValue(true),
      resolve: vi.fn().mockReturnValue('/tmp/validated/session-bound'),
    } as unknown as SessionManager
    const getStateSpy = vi
      .spyOn(StateManager.prototype, 'get')
      .mockResolvedValue({ pipeline_id: 'real-pipe' } as any)

    try {
      const { tools, dispatchBatch } = createTestContext({ sessionManager })

      await tools.get('invoke_dispatch_batch')!.handler({
        tasks: [
          { task_id: 'task-1', role: 'builder', subrole: 'parallel', task_context: {} },
        ],
        create_worktrees: false,
        session_id: 'session-bound',
      })

      expect(dispatchBatch).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'session-bound',
        boundPipelineId: 'real-pipe',
      }), expect.objectContaining({
        stateManager: expect.any(StateManager),
      }))
    } finally {
      getStateSpy.mockRestore()
    }
  })

  it('formats the most recent review cycle for builder re-dispatch', async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), 'dispatch-tools-prior-findings-'))
    const sessionManager = {
      exists: vi.fn().mockReturnValue(true),
      resolve: vi.fn().mockReturnValue(sessionDir),
    } as unknown as SessionManager
    const state: PipelineState = {
      pipeline_id: 'pipeline-1',
      started: '2026-04-01T00:00:00.000Z',
      last_updated: '2026-04-01T00:00:00.000Z',
      current_stage: 'review',
      batches: [],
      review_cycles: [
        {
          id: 1,
          reviewers: ['reviewer-a'],
          findings: [],
          triaged: {
            accepted: [
              {
                issue: 'Older finding',
                severity: 'low',
                file: 'src/older.ts',
                line: 1,
                suggestion: 'Old fix',
              },
            ],
            dismissed: [],
          },
        },
        {
          id: 2,
          reviewers: ['reviewer-b'],
          findings: [],
          triaged: {
            accepted: [
              {
                issue: 'Keep this accepted finding',
                severity: 'high',
                file: 'src/current.ts',
                line: 12,
                suggestion: 'Apply the fix before re-dispatching the builder',
              },
            ],
            dismissed: [
              {
                issue: 'Ignore dismissed finding',
                severity: 'medium',
                file: 'src/ignored.ts',
                line: 7,
                suggestion: 'Should not appear',
              },
            ],
            deferred: [
              {
                issue: 'Ignore deferred finding',
                severity: 'low',
                file: 'src/deferred.ts',
                line: 8,
                suggestion: 'Should not appear',
              },
            ],
          },
        },
      ],
    }

    await writeFile(path.join(sessionDir, 'state.json'), JSON.stringify(state, null, 2))

    try {
      const { tools } = createTestContext({ sessionManager })
      const tool = tools.get('invoke_get_prior_findings_for_builder')

      expect(tool).toBeDefined()
      expect(tool!.config.inputSchema.parse({ session_id: 'session-1' })).toEqual({
        session_id: 'session-1',
      })

      const response = await tool!.handler({ session_id: 'session-1' })

      expect(response.isError).toBeUndefined()
      expect(response.content[0].text).toBe(
        '1. [HIGH] src/current.ts:12 — Keep this accepted finding\n' +
        '   Fix: Apply the fix before re-dispatching the builder'
      )
    } finally {
      await rm(sessionDir, { recursive: true, force: true })
    }
  })

  it('uses the most recent cycle matching batch_id when provided', async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), 'dispatch-tools-prior-findings-batch-'))
    const sessionManager = {
      exists: vi.fn().mockReturnValue(true),
      resolve: vi.fn().mockReturnValue(sessionDir),
    } as unknown as SessionManager
    const state: PipelineState = {
      pipeline_id: 'pipeline-1',
      started: '2026-04-01T00:00:00.000Z',
      last_updated: '2026-04-01T00:00:00.000Z',
      current_stage: 'review',
      batches: [],
      review_cycles: [
        {
          id: 1,
          batch_id: 7,
          reviewers: ['reviewer-a'],
          findings: [],
          triaged: {
            accepted: [
              {
                issue: 'Old batch finding',
                severity: 'medium',
                file: 'src/old-batch.ts',
                line: 2,
                suggestion: 'Old batch fix',
              },
            ],
            dismissed: [],
          },
        },
        {
          id: 2,
          batch_id: 4,
          reviewers: ['reviewer-b'],
          findings: [],
          triaged: {
            accepted: [
              {
                issue: 'Different batch finding',
                severity: 'high',
                file: 'src/other-batch.ts',
                line: 5,
                suggestion: 'Other batch fix',
              },
            ],
            dismissed: [],
          },
        },
        {
          id: 3,
          batch_id: 7,
          reviewers: ['reviewer-c'],
          findings: [],
          triaged: {
            accepted: [
              {
                issue: 'Newest batch-specific finding',
                severity: 'critical',
                file: 'src/new-batch.ts',
                line: 9,
                suggestion: 'Use the newest matching batch cycle',
              },
            ],
            dismissed: [],
          },
        },
      ],
    }

    await writeFile(path.join(sessionDir, 'state.json'), JSON.stringify(state, null, 2))

    try {
      const { tools } = createTestContext({ sessionManager })
      const response = await tools.get('invoke_get_prior_findings_for_builder')!.handler({
        session_id: 'session-1',
        batch_id: 7,
      })

      expect(response.isError).toBeUndefined()
      expect(response.content[0].text).toBe(
        '1. [CRITICAL] src/new-batch.ts:9 — Newest batch-specific finding\n' +
        '   Fix: Use the newest matching batch cycle'
      )
    } finally {
      await rm(sessionDir, { recursive: true, force: true })
    }
  })

  it('returns an empty string when there is no matching review cycle for the requested batch', async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), 'dispatch-tools-prior-findings-empty-'))
    const sessionManager = {
      exists: vi.fn().mockReturnValue(true),
      resolve: vi.fn().mockReturnValue(sessionDir),
    } as unknown as SessionManager
    const state: PipelineState = {
      pipeline_id: 'pipeline-1',
      started: '2026-04-01T00:00:00.000Z',
      last_updated: '2026-04-01T00:00:00.000Z',
      current_stage: 'review',
      batches: [],
      review_cycles: [
        {
          id: 1,
          batch_id: 3,
          reviewers: ['reviewer-a'],
          findings: [],
          triaged: {
            accepted: [
              {
                issue: 'Only batch 3 finding',
                severity: 'low',
                file: 'src/batch-3.ts',
                line: 4,
                suggestion: 'Fix batch 3',
              },
            ],
            dismissed: [],
          },
        },
      ],
    }

    await writeFile(path.join(sessionDir, 'state.json'), JSON.stringify(state, null, 2))

    try {
      const { tools } = createTestContext({ sessionManager })
      const response = await tools.get('invoke_get_prior_findings_for_builder')!.handler({
        session_id: 'session-1',
        batch_id: 99,
      })

      expect(response.isError).toBeUndefined()
      expect(response.content[0].text).toBe('')
    } finally {
      await rm(sessionDir, { recursive: true, force: true })
    }
  })

  it('returns an error when the prior-findings tool is called with a session_id that does not exist', async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), 'dispatch-tools-prior-findings-missing-'))
    const sessionManager = {
      exists: vi.fn().mockReturnValue(false),
      resolve: vi.fn(),
      create: vi.fn().mockResolvedValue(sessionDir),
    } as unknown as SessionManager

    try {
      const { tools } = createTestContext({ sessionManager })
      const response = await tools.get('invoke_get_prior_findings_for_builder')!.handler({
        session_id: 'missing-session',
      })

      expect(response.isError).toBe(true)
      expect(response.content[0].text).toBe('Session not found: missing-session')
      expect(sessionManager.create).not.toHaveBeenCalled()
      expect(sessionManager.resolve).not.toHaveBeenCalled()
    } finally {
      await rm(sessionDir, { recursive: true, force: true })
    }
  })

  it('returns a tool error when session-scoped dispatch support is unavailable', async () => {
    const { tools } = createTestContext()
    const response = await tools.get('invoke_get_prior_findings_for_builder')!.handler({
      session_id: 'session-1',
    })

    expect(response.isError).toBe(true)
    expect(response.content[0].text).toBe(
      'Assembly error: Session manager is required for session-scoped dispatch'
    )
  })

  it('caches session-scoped state managers by session directory', async () => {
    vi.mocked(loadConfig).mockResolvedValue(createConfig())
    const sessionManager = {
      exists: vi.fn().mockReturnValue(true),
      resolve: vi.fn().mockReturnValue('/tmp/validated/session-cache'),
    } as unknown as SessionManager

    const { tools, dispatchedStateManagers } = createTestContext({ sessionManager })
    const handler = tools.get('invoke_dispatch_batch')!.handler

    await handler({
      tasks: [
        { task_id: 'task-1', role: 'builder', subrole: 'parallel', task_context: {} },
      ],
      create_worktrees: false,
      session_id: 'session-cache',
    })
    await handler({
      tasks: [
        { task_id: 'task-2', role: 'builder', subrole: 'parallel', task_context: {} },
      ],
      create_worktrees: false,
      session_id: 'session-cache',
    })

    const [firstStateManager, secondStateManager] = dispatchedStateManagers()
    expect(firstStateManager).toBeInstanceOf(StateManager)
    expect(secondStateManager).toBe(firstStateManager)
  })

  it('returns batch status without embedding agent results', async () => {
    const batchStatus = {
      batchId: 'batch-123',
      status: 'partial',
      agents: [
        {
          taskId: 'task-1',
          status: 'completed',
          result: {
            role: 'builder',
            subrole: 'default',
            provider: 'claude',
            model: 'claude-sonnet-4-6',
            status: 'success',
            output: {
              summary: 'done',
              raw: 'full output',
            },
            duration: 1000,
          },
        },
        {
          taskId: 'task-2',
          status: 'running',
        },
      ],
    }
    const { tools, getBatchOwner, waitForStatus } = createTestContext()
    getBatchOwner.mockReturnValue(ownedBatch('session-A'))
    waitForStatus.mockResolvedValue(batchStatus)

    const response = await tools.get('invoke_get_batch_status')!.handler({
      batch_id: 'batch-123',
      wait: 5,
      session_id: 'session-A',
    })

    expect(waitForStatus).toHaveBeenCalledWith('batch-123', 5)
    expect(JSON.parse(response.content[0].text)).toEqual({
      batchId: 'batch-123',
      status: 'partial',
      agents: [
        { taskId: 'task-1', status: 'completed' },
        { taskId: 'task-2', status: 'running' },
      ],
    })
  })

  it.each([
    {
      name: 'rejects a different session owner',
      owner: ownedBatch('session-A'),
      sessionId: 'session-B',
      isError: true,
      errorText: 'Batch batch-123 is not owned by session session-B',
    },
    {
      name: 'allows the owning session',
      owner: ownedBatch('session-A'),
      sessionId: 'session-A',
      isError: false,
    },
    {
      name: 'rejects session-owned batches when session_id is omitted',
      owner: ownedBatch('session-A'),
      sessionId: undefined,
      isError: true,
      errorText: 'Batch batch-123 is owned by a session and requires session_id parameter',
    },
    {
      name: 'allows legacy unowned batches when session_id is omitted',
      owner: unownedBatch(),
      sessionId: undefined,
      isError: false,
    },
    {
      name: 'allows legacy unowned batches from any session',
      owner: unownedBatch(),
      sessionId: 'session-B',
      isError: false,
    },
  ])('invoke_get_batch_status $name', async ({ owner, sessionId, isError, errorText }) => {
    const batchStatus = {
      batchId: 'batch-123',
      status: 'completed' as const,
      agents: [{ taskId: 'task-1', status: 'completed' as const }],
    }
    const { tools, getBatchOwner, getStatus } = createTestContext()
    const tool = tools.get('invoke_get_batch_status')!

    expect(
      tool.config.inputSchema.parse({
        batch_id: 'batch-123',
        wait: 0,
        session_id: 'session-A',
      })
    ).toEqual({
      batch_id: 'batch-123',
      wait: 0,
      session_id: 'session-A',
    })

    getBatchOwner.mockReturnValue(owner)
    getStatus.mockReturnValue(batchStatus)

    const response = await tool.handler({
      batch_id: 'batch-123',
      wait: 0,
      ...(sessionId !== undefined ? { session_id: sessionId } : {}),
    })

    expect(getBatchOwner).toHaveBeenCalledWith('batch-123')

    if (isError) {
      expect(response.isError).toBe(true)
      expect(response.content[0].text).toBe(errorText)
      expect(getStatus).not.toHaveBeenCalled()
      return
    }

    expect(response.isError).toBeUndefined()
    expect(getStatus).toHaveBeenCalledWith('batch-123')
    expect(JSON.parse(response.content[0].text)).toEqual(batchStatus)
  })

  it('returns the full terminal task result from invoke_get_task_result', async () => {
    const taskResult: AgentResult = {
      role: 'builder',
      subrole: 'default',
      provider: 'claude',
      model: 'claude-sonnet-4-6',
      status: 'success',
      output: {
        summary: 'done',
        raw: 'full output',
      },
      duration: 1000,
    }
    const { tools, getBatchOwner, getTaskResult } = createTestContext()
    const invokeGetTaskResult = tools.get('invoke_get_task_result')

    getBatchOwner.mockReturnValue(ownedBatch('session-A'))
    getTaskResult.mockReturnValue({ kind: 'ok', result: taskResult })

    expect(
      invokeGetTaskResult!.config.inputSchema.parse({
        batch_id: 'batch-123',
        task_id: 'task-1',
        session_id: 'session-A',
      })
    ).toEqual({
      batch_id: 'batch-123',
      task_id: 'task-1',
      session_id: 'session-A',
    })

    const response = await invokeGetTaskResult!.handler({
      batch_id: 'batch-123',
      task_id: 'task-1',
      session_id: 'session-A',
    })

    expect(getTaskResult).toHaveBeenCalledWith('batch-123', 'task-1')
    expect(JSON.parse(response.content[0].text)).toEqual(taskResult)
  })

  it.each([
    {
      name: 'rejects a different session owner',
      owner: ownedBatch('session-A'),
      sessionId: 'session-B',
      isError: true,
      errorText: 'Batch batch-123 is not owned by session session-B',
    },
    {
      name: 'allows the owning session',
      owner: ownedBatch('session-A'),
      sessionId: 'session-A',
      isError: false,
    },
    {
      name: 'rejects session-owned batches when session_id is omitted',
      owner: ownedBatch('session-A'),
      sessionId: undefined,
      isError: true,
      errorText: 'Batch batch-123 is owned by a session and requires session_id parameter',
    },
    {
      name: 'allows legacy unowned batches when session_id is omitted',
      owner: unownedBatch(),
      sessionId: undefined,
      isError: false,
    },
    {
      name: 'allows legacy unowned batches from any session',
      owner: unownedBatch(),
      sessionId: 'session-B',
      isError: false,
    },
  ])('invoke_get_task_result $name', async ({ owner, sessionId, isError, errorText }) => {
    const taskResult: AgentResult = {
      role: 'builder',
      subrole: 'default',
      provider: 'claude',
      model: 'claude-sonnet-4-6',
      status: 'success',
      output: {
        summary: 'done',
        raw: 'full output',
      },
      duration: 1000,
    }
    const { tools, getBatchOwner, getTaskResult } = createTestContext()
    const tool = tools.get('invoke_get_task_result')!

    getBatchOwner.mockReturnValue(owner)
    getTaskResult.mockReturnValue({ kind: 'ok', result: taskResult })

    const response = await tool.handler({
      batch_id: 'batch-123',
      task_id: 'task-1',
      ...(sessionId !== undefined ? { session_id: sessionId } : {}),
    })

    expect(getBatchOwner).toHaveBeenCalledWith('batch-123')

    if (isError) {
      expect(response.isError).toBe(true)
      expect(response.content[0].text).toBe(errorText)
      expect(getTaskResult).not.toHaveBeenCalled()
      return
    }

    expect(response.isError).toBeUndefined()
    expect(getTaskResult).toHaveBeenCalledWith('batch-123', 'task-1')
    expect(JSON.parse(response.content[0].text)).toEqual(taskResult)
  })

  it('returns clear invoke_get_task_result errors for missing, incomplete, or unavailable tasks', async () => {
    const { tools, getBatchOwner, getTaskResult } = createTestContext()
    const invokeGetTaskResult = tools.get('invoke_get_task_result')!

    getBatchOwner.mockReturnValue(ownedBatch('session-A'))
    getBatchOwner.mockReturnValueOnce(missingBatch())
    const batchNotFound = await invokeGetTaskResult.handler({
      batch_id: 'missing-batch',
      task_id: 'task-1',
    })
    expect(getTaskResult).not.toHaveBeenCalled()

    getTaskResult.mockReturnValueOnce({ kind: 'task_not_found' })
    const taskNotFound = await invokeGetTaskResult.handler({
      batch_id: 'batch-123',
      task_id: 'missing-task',
      session_id: 'session-A',
    })

    getTaskResult.mockReturnValueOnce({ kind: 'not_terminal', status: 'running' })
    const notTerminal = await invokeGetTaskResult.handler({
      batch_id: 'batch-123',
      task_id: 'task-1',
      session_id: 'session-A',
    })

    getTaskResult.mockReturnValueOnce({ kind: 'no_result' })
    const noResult = await invokeGetTaskResult.handler({
      batch_id: 'batch-123',
      task_id: 'task-2',
      session_id: 'session-A',
    })

    expect(batchNotFound.isError).toBe(true)
    expect(batchNotFound.content[0].text).toBe('Batch not found: missing-batch')
    expect(taskNotFound.isError).toBe(true)
    expect(taskNotFound.content[0].text).toBe('Task not found in batch batch-123: missing-task')
    expect(notTerminal.isError).toBe(true)
    expect(notTerminal.content[0].text).toBe(
      'Task not in terminal state; keep polling (current status: running)'
    )
    expect(noResult.isError).toBe(true)
    expect(noResult.content[0].text).toBe(
      'Task reached terminal state without a stored result in batch batch-123: task-2'
    )
  })

  it('rejects session-owned invoke_cancel_batch calls when session_id is missing', async () => {
    const { tools, getBatchOwner, cancel } = createTestContext()
    const tool = tools.get('invoke_cancel_batch')!

    getBatchOwner.mockReturnValue(ownedBatch('session-A'))

    const response = await tool.handler({
      batch_id: 'batch-123',
    })

    expect(response.isError).toBe(true)
    expect(response.content[0].text).toBe(
      'Batch batch-123 is owned by a session and requires session_id parameter'
    )
    expect(cancel).not.toHaveBeenCalled()
  })

  it('allows invoke_cancel_batch for legacy unowned batches without session_id', async () => {
    const { tools, getBatchOwner, cancel } = createTestContext()
    const tool = tools.get('invoke_cancel_batch')!

    getBatchOwner.mockReturnValue(unownedBatch())

    const response = await tool.handler({
      batch_id: 'batch-123',
    })

    expect(response.isError).toBeUndefined()
    expect(cancel).toHaveBeenCalledWith('batch-123')
    expect(JSON.parse(response.content[0].text)).toEqual({
      batch_id: 'batch-123',
      status: 'cancelled',
    })
  })

  it('enforces session ownership on invoke_cancel_batch for mismatched and matching sessions', async () => {
    const { tools, getBatchOwner, cancel } = createTestContext()
    const tool = tools.get('invoke_cancel_batch')!

    expect(tool.config.inputSchema.parse({ batch_id: 'batch-123', session_id: 'session-A' })).toEqual({
      batch_id: 'batch-123',
      session_id: 'session-A',
    })

    getBatchOwner.mockReturnValue(ownedBatch('session-A'))

    const forbidden = await tool.handler({
      batch_id: 'batch-123',
      session_id: 'session-B',
    })

    expect(forbidden.isError).toBe(true)
    expect(forbidden.content[0].text).toBe('Batch batch-123 is not owned by session session-B')
    expect(cancel).not.toHaveBeenCalled()

    const allowed = await tool.handler({
      batch_id: 'batch-123',
      session_id: 'session-A',
    })

    expect(allowed.isError).toBeUndefined()
    expect(cancel).toHaveBeenCalledWith('batch-123')
    expect(JSON.parse(allowed.content[0].text)).toEqual({
      batch_id: 'batch-123',
      status: 'cancelled',
    })
  })
})
