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
      safeParse: (input: unknown) =>
        | { success: true; data: Record<string, unknown> }
        | { success: false; error: { issues: Array<{ message: string }> } }
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

  it('accepts legacy-shaped session_id on read schemas and rejects it for invoke_set_state', async () => {
    const legacySessionId = 'legacy session-id'

    expect(
      getTool('invoke_get_state').config.inputSchema.safeParse({ session_id: legacySessionId }).success
    ).toBe(true)
    expect(
      getTool('invoke_get_review_cycle_count').config.inputSchema.safeParse({ session_id: legacySessionId }).success
    ).toBe(true)

    const parsed = getTool('invoke_set_state').config.inputSchema.safeParse({
      session_id: legacySessionId,
    })
    expect(parsed.success).toBe(false)

    const result = await getTool('invoke_set_state').handler({
      session_id: legacySessionId,
    })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('invalid session id format')
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

  it('accepts batch_update and review_cycle_update in invoke_set_state', () => {
    const setStateTool = getTool('invoke_set_state')
    const input = {
      session_id: 'session-1',
      batch_update: {
        id: 1,
        status: 'completed' as const,
        tasks: [{ id: 'task-1', status: 'completed' as const }],
      },
      review_cycle_update: {
        id: 1,
        reviewers: ['reviewer-a'],
        findings: [],
        scope: 'final' as const,
      },
    }

    expect(setStateTool.config.inputSchema.safeParse(input).success).toBe(true)
  })

  it('updates an existing batch in place without affecting other batches', async () => {
    const sessionStateManager = new StateManager(
      TEST_DIR,
      await sessionManager.create('session-1')
    )
    await sessionStateManager.initialize('pipeline-123')
    await sessionStateManager.update({
      batches: [
        {
          id: 1,
          status: 'pending',
          merged_tasks: ['task-0'],
          tasks: [{ id: 'task-1', status: 'pending' }],
        },
        {
          id: 2,
          status: 'in_progress',
          tasks: [{ id: 'task-2', status: 'running' }],
        },
      ],
    })

    const result = await getTool('invoke_set_state').handler({
      session_id: 'session-1',
      work_branch: 'invoke/work-1234',
      batch_update: {
        id: 1,
        status: 'completed',
        tasks: [{ id: 'task-1', status: 'completed' }],
      },
    })

    expect(result.isError).toBeUndefined()

    const state = await sessionStateManager.get()
    expect(state).toMatchObject({
      work_branch: 'invoke/work-1234',
      batches: [
        {
          id: 1,
          status: 'completed',
          merged_tasks: ['task-0'],
          tasks: [{ id: 'task-1', status: 'completed' }],
        },
        {
          id: 2,
          status: 'in_progress',
          tasks: [{ id: 'task-2', status: 'running' }],
        },
      ],
    })
  })

  it('appends a batch when batch_update targets a new id', async () => {
    const sessionStateManager = new StateManager(
      TEST_DIR,
      await sessionManager.create('session-1')
    )
    await sessionStateManager.initialize('pipeline-123')
    await sessionStateManager.update({
      batches: [
        {
          id: 1,
          status: 'pending',
          tasks: [{ id: 'task-1', status: 'pending' }],
        },
      ],
    })

    const result = await getTool('invoke_set_state').handler({
      session_id: 'session-1',
      batch_update: {
        id: 99,
        status: 'pending',
        tasks: [],
      },
    })

    expect(result.isError).toBeUndefined()

    const state = await sessionStateManager.get()
    expect(state?.batches).toEqual([
      {
        id: 1,
        status: 'pending',
        tasks: [{ id: 'task-1', status: 'pending' }],
      },
      {
        id: 99,
        status: 'pending',
        tasks: [],
      },
    ])
  })

  it('clears batches when only an explicit batches array replacement is provided', async () => {
    const sessionStateManager = new StateManager(
      TEST_DIR,
      await sessionManager.create('session-1')
    )
    await sessionStateManager.initialize('pipeline-123')
    await sessionStateManager.update({
      batches: [
        {
          id: 1,
          status: 'pending',
          tasks: [{ id: 'task-1', status: 'pending' }],
        },
      ],
    })

    const result = await getTool('invoke_set_state').handler({
      session_id: 'session-1',
      batches: [],
    })

    expect(result.isError).toBeUndefined()

    const state = await sessionStateManager.get()
    expect(state?.batches).toEqual([])
  })

  it('accepts batches and batch_update in the same invoke_set_state call and explicit batches win', async () => {
    const setStateTool = getTool('invoke_set_state')
    const input = {
      session_id: 'session-1',
      pipeline_id: 'pipeline-123',
      batches: [
        {
          id: 1,
          status: 'completed' as const,
          tasks: [],
        },
      ],
      batch_update: {
        id: 2,
        status: 'pending' as const,
        tasks: [],
      },
    }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const parsed = setStateTool.config.inputSchema.safeParse(input)
      expect(parsed.success).toBe(true)

      const result = await setStateTool.handler(input)
      expect(result.isError).toBeUndefined()
      expect(parseResponseText(result)).toMatchObject({
        batches: [
          {
            id: 1,
            status: 'completed',
            tasks: [],
          },
        ],
      })

      const sessionStateManager = new StateManager(
        TEST_DIR,
        sessionManager.resolve('session-1')
      )
      expect((await sessionStateManager.get())?.batches).toEqual([
        {
          id: 1,
          status: 'completed',
          tasks: [],
        },
      ])
      expect(warnSpy).toHaveBeenCalledWith(
        'invoke_set_state received both batches and batch_update; batch_update will be applied before batches replaces the array'
      )
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('performs batch_update and top-level fields in one atomic invoke_set_state write', async () => {
    const sessionStateManager = new StateManager(
      TEST_DIR,
      await sessionManager.create('session-atomic')
    )
    await sessionStateManager.initialize('pipeline-123')
    await sessionStateManager.update({
      batches: [
        {
          id: 1,
          status: 'pending',
          tasks: [{ id: 'task-1', status: 'pending' }],
        },
      ],
    })

    const capturedWrites: Array<{
      work_branch?: string
      strategy?: string
      batchStatus?: string
    }> = []
    let releaseFirstWrite: (() => void) | null = null
    let markFirstWriteStarted: (() => void) | null = null
    const firstWriteStarted = new Promise<void>(resolve => {
      markFirstWriteStarted = resolve
    })
    const writeAtomic = (StateManager.prototype as any).writeAtomic
    const writeAtomicSpy = vi.spyOn(StateManager.prototype as any, 'writeAtomic').mockImplementation(
      async function (state: {
        work_branch?: string
        strategy?: string
        batches: Array<{ id: number, status: string }>
      }) {
        capturedWrites.push({
          work_branch: state.work_branch,
          strategy: state.strategy,
          batchStatus: state.batches.find(batch => batch.id === 1)?.status,
        })

        if (!releaseFirstWrite) {
          markFirstWriteStarted?.()
          await new Promise<void>(resolve => {
            releaseFirstWrite = resolve
          })
        }

        return writeAtomic.call(this, state)
      }
    )

    try {
      const firstCall = getTool('invoke_set_state').handler({
        session_id: 'session-atomic',
        work_branch: 'invoke/work-atomic',
        batch_update: {
          id: 1,
          status: 'completed',
          tasks: [{ id: 'task-1', status: 'completed' }],
        },
      })

      await firstWriteStarted

      const secondCall = getTool('invoke_set_state').handler({
        session_id: 'session-atomic',
        strategy: 'concurrent',
      })

      releaseFirstWrite?.()
      await Promise.all([firstCall, secondCall])
    } finally {
      writeAtomicSpy.mockRestore()
    }

    expect(capturedWrites).toEqual([
      {
        work_branch: 'invoke/work-atomic',
        batchStatus: 'completed',
      },
      {
        work_branch: 'invoke/work-atomic',
        strategy: 'concurrent',
        batchStatus: 'completed',
      },
    ])
  })

  it('performs a mixed batch_update and batches replacement in one invoke_set_state writeAtomic call', async () => {
    const sessionStateManager = new StateManager(
      TEST_DIR,
      await sessionManager.create('session-atomic-replace')
    )
    await sessionStateManager.initialize('pipeline-123')
    await sessionStateManager.update({
      batches: [
        {
          id: 10,
          status: 'pending',
          tasks: [{ id: 'task-10', status: 'pending' }],
        },
      ],
    })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const writeAtomicSpy = vi.spyOn(StateManager.prototype as any, 'writeAtomic')

    try {
      const result = await getTool('invoke_set_state').handler({
        session_id: 'session-atomic-replace',
        work_branch: 'invoke/work-replace',
        batches: [
          {
            id: 1,
            status: 'completed',
            tasks: [],
          },
        ],
        batch_update: {
          id: 2,
          status: 'pending',
          tasks: [],
        },
      })

      expect(result.isError).toBeUndefined()
      expect(writeAtomicSpy).toHaveBeenCalledTimes(1)
    } finally {
      writeAtomicSpy.mockRestore()
      warnSpy.mockRestore()
    }

    expect(await sessionStateManager.get()).toMatchObject({
      work_branch: 'invoke/work-replace',
      batches: [
        {
          id: 1,
          status: 'completed',
          tasks: [],
        },
      ],
    })
  })

  it('upserts review cycles by id and appends when review_cycle_update is provided', async () => {
    const sessionStateManager = new StateManager(
      TEST_DIR,
      await sessionManager.create('session-1')
    )
    await sessionStateManager.initialize('pipeline-123')
    await sessionStateManager.update({
      review_cycles: [
        { id: 1, reviewers: ['reviewer-a'], findings: [], batch_id: 2, scope: 'batch' },
      ],
    })

    const updateResult = await getTool('invoke_set_state').handler({
      session_id: 'session-1',
      review_cycle_update: {
        id: 1,
        reviewers: ['reviewer-a', 'reviewer-b'],
        findings: [],
        batch_id: 2,
        scope: 'batch',
        tier: 'critical',
      },
    })

    expect(updateResult.isError).toBeUndefined()
    expect((await sessionStateManager.get())?.review_cycles).toEqual([
      {
        id: 1,
        reviewers: ['reviewer-a', 'reviewer-b'],
        findings: [],
        batch_id: 2,
        scope: 'batch',
        tier: 'critical',
      },
    ])

    const appendResult = await getTool('invoke_set_state').handler({
      session_id: 'session-1',
      review_cycle_update: {
        id: 2,
        reviewers: ['reviewer-c'],
        findings: [],
        scope: 'final',
      },
    })

    expect(appendResult.isError).toBeUndefined()
    expect((await sessionStateManager.get())?.review_cycles).toEqual([
      {
        id: 1,
        reviewers: ['reviewer-a', 'reviewer-b'],
        findings: [],
        batch_id: 2,
        scope: 'batch',
        tier: 'critical',
      },
      {
        id: 2,
        reviewers: ['reviewer-c'],
        findings: [],
        scope: 'final',
      },
    ])
  })

  it('clears review_cycles when only an explicit review_cycles array replacement is provided', async () => {
    const sessionStateManager = new StateManager(
      TEST_DIR,
      await sessionManager.create('session-1')
    )
    await sessionStateManager.initialize('pipeline-123')
    await sessionStateManager.update({
      review_cycles: [
        { id: 1, reviewers: ['reviewer-a'], findings: [], batch_id: 2, scope: 'batch' },
      ],
    })

    const clearResult = await getTool('invoke_set_state').handler({
      session_id: 'session-1',
      review_cycles: [],
    })

    expect(clearResult.isError).toBeUndefined()
    expect((await sessionStateManager.get())?.review_cycles).toEqual([])
  })

  it('accepts review_cycles and review_cycle_update in the same invoke_set_state call and explicit review_cycles win', async () => {
    const setStateTool = getTool('invoke_set_state')
    const input = {
      session_id: 'session-1',
      pipeline_id: 'pipeline-123',
      review_cycles: [
        {
          id: 1,
          reviewers: ['reviewer-a', 'reviewer-b'],
          findings: [],
          scope: 'final' as const,
        },
      ],
      review_cycle_update: {
        id: 2,
        reviewers: ['reviewer-a'],
        findings: [],
        scope: 'final' as const,
      },
    }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const parsed = setStateTool.config.inputSchema.safeParse(input)
      expect(parsed.success).toBe(true)

      const result = await setStateTool.handler(input)
      expect(result.isError).toBeUndefined()
      expect(parseResponseText(result)).toMatchObject({
        review_cycles: [
          {
            id: 1,
            reviewers: ['reviewer-a', 'reviewer-b'],
            findings: [],
            scope: 'final',
          },
        ],
      })

      const sessionStateManager = new StateManager(
        TEST_DIR,
        sessionManager.resolve('session-1')
      )
      expect((await sessionStateManager.get())?.review_cycles).toEqual([
        {
          id: 1,
          reviewers: ['reviewer-a', 'reviewer-b'],
          findings: [],
          scope: 'final',
        },
      ])
      expect(warnSpy).toHaveBeenCalledWith(
        'invoke_set_state received both review_cycles and review_cycle_update; review_cycle_update will be applied before review_cycles replaces the array'
      )
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('round-trips valid bug_ids and rejects invalid bug_ids in invoke_set_state', async () => {
    const setStateTool = getTool('invoke_set_state')
    const validInput = {
      session_id: 'session-1',
      pipeline_id: 'pipeline-123',
      bug_ids: ['BUG-001', 'BUG-002'],
    }

    expect(setStateTool.config.inputSchema.safeParse(validInput).success).toBe(true)

    const setResult = await setStateTool.handler(validInput)
    expect(setResult.isError).toBeUndefined()

    const sessionStateManager = new StateManager(
      TEST_DIR,
      sessionManager.resolve('session-1')
    )
    const state = await sessionStateManager.get()
    expect(state?.bug_ids).toEqual(['BUG-001', 'BUG-002'])

    const getResult = await getTool('invoke_get_state').handler({ session_id: 'session-1' })
    expect(getResult.isError).toBeUndefined()
    expect(parseResponseText(getResult)).toMatchObject({
      bug_ids: ['BUG-001', 'BUG-002'],
    })

    const invalidResult = await setStateTool.handler({
      session_id: 'session-1',
      bug_ids: ['invalid-id'],
    })
    expect(invalidResult.isError).toBe(true)
    expect(invalidResult.content[0].text).toBe('bug_ids must be BUG-NNN format')
  })

  it('rejects malformed session_id, work_branch, and work_branch_path in invoke_set_state', async () => {
    const setStateTool = getTool('invoke_set_state')
    const cases = [
      {
        input: { session_id: 'session;rm -rf /' },
        message: 'invalid session id format',
      },
      {
        input: { work_branch: 'invoke/../escape' },
        message: 'invalid work_branch format',
      },
      {
        input: { work_branch: '/tmp/invoke-session-1' },
        message: 'invalid work_branch format',
      },
      {
        input: { work_branch_path: 'relative/invoke-session-1' },
        message: 'work_branch_path must be an absolute path with invoke-session- basename',
      },
      {
        input: { work_branch_path: '/tmp/not-session-1' },
        message: 'work_branch_path must be an absolute path with invoke-session- basename',
      },
    ] as const

    for (const testCase of cases) {
      const parsed = setStateTool.config.inputSchema.safeParse(testCase.input)
      expect(parsed.success).toBe(false)

      const result = await setStateTool.handler(testCase.input as Record<string, unknown>)
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toBe(testCase.message)
    }
  })

  it('rejects traversal-style session_id in invoke_get_state via SessionManager validation', async () => {
    const getStateTool = getTool('invoke_get_state')
    const input = { session_id: 'nested/path' }

    expect(getStateTool.config.inputSchema.safeParse(input).success).toBe(true)

    const result = await getStateTool.handler(input)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe("State error: Invalid session ID: 'nested/path'")
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
