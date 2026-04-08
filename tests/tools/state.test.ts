import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { StateManager } from '../../src/tools/state.js'
import { SessionManager } from '../../src/session/manager.js'
import { registerStateTools } from '../../src/tools/state-tools.js'
import { mkdir, rm, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { PipelineState } from '../../src/types.js'

const TEST_DIR = path.join(import.meta.dirname, 'fixtures', 'state-test')
const BUG013_PIPELINE_ID = 'pipeline-1775865600000'
const BUG013_BRANCH_FIXTURE = {
  work_branch: 'invoke/work/pipeline-1775865600000',
  work_branch_path:
    '/private/var/folders/c4/q0tszkjs27b424l4fgbkz4400000gn/T/invoke-session-pipeline-1775865600000-zLeqrR',
  base_branch: 'main',
} satisfies Partial<PipelineState>
const BUG013_PERSIST_ONCE_FIXTURE = {
  ...BUG013_BRANCH_FIXTURE,
  spec: 'Scope spec',
  plan: 'Execution plan',
  tasks: 'Task breakdown',
  strategy: 'tdd',
  bug_ids: ['BUG-001', 'BUG-002'],
} satisfies Partial<PipelineState>
const BUG013_BUG_IDS = [
  'BUG-001',
  'BUG-002',
  'BUG-003',
  'BUG-004',
  'BUG-005',
  'BUG-006',
  'BUG-007',
  'BUG-008',
  'BUG-009',
  'BUG-010',
]

let stateManager: StateManager
let sessionManager: SessionManager
let registeredTools: Map<string, RegisteredTool>

type RegisteredTool = {
  config: {
    inputSchema: {
      safeParse: (input: unknown) =>
        | { success: true; data: Record<string, unknown> }
        | { success: false; error: { issues: Array<{ message: string, path: Array<string | number> }> } }
    }
  }
  handler: (input: Record<string, unknown>) => Promise<{
    content: Array<{ type: string, text: string }>
    isError?: boolean
  }>
}

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

async function initializeWithPersistOnceFields(
  overrides: Partial<PipelineState> = {}
): Promise<void> {
  await stateManager.initialize(BUG013_PIPELINE_ID)
  await stateManager.update({
    ...BUG013_PERSIST_ONCE_FIXTURE,
    ...overrides,
  })
}

beforeEach(async () => {
  await mkdir(path.join(TEST_DIR, '.invoke'), { recursive: true })
  stateManager = new StateManager(TEST_DIR)
  sessionManager = new SessionManager(TEST_DIR)
  registeredTools = new Map()
  registerTool.mockClear()
  registerStateTools(server, stateManager, TEST_DIR, sessionManager)
})

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('StateManager', () => {
  it('returns null when no state file exists', async () => {
    const state = await stateManager.get()
    expect(state).toBeNull()
  })

  it('creates initial state', async () => {
    await stateManager.initialize('pipeline-123')

    const state = await stateManager.get()
    expect(state).not.toBeNull()
    expect(state!.pipeline_id).toBe('pipeline-123')
    expect(state!.current_stage).toBe('scope')
    expect(state!.batches).toEqual([])
    expect(state!.review_cycles).toEqual([])
  })

  it('updates specific fields', async () => {
    await stateManager.initialize('pipeline-123')
    await stateManager.update({
      current_stage: 'build',
      work_branch: 'invoke/work-1234',
      strategy: 'tdd',
    })

    const state = await stateManager.get()
    expect(state!.current_stage).toBe('build')
    expect(state!.work_branch).toBe('invoke/work-1234')
    expect(state!.strategy).toBe('tdd')
    expect(state!.pipeline_id).toBe('pipeline-123')
  })

  it('writes state as formatted JSON', async () => {
    await stateManager.initialize('pipeline-123')

    const raw = await readFile(
      path.join(TEST_DIR, '.invoke', 'state.json'),
      'utf-8'
    )
    const parsed = JSON.parse(raw)
    expect(parsed.pipeline_id).toBe('pipeline-123')
    expect(raw).toContain('\n') // formatted, not minified
  })

  it('writes session-scoped state when sessionDir is provided', async () => {
    const sessionDir = path.join(TEST_DIR, '.invoke', 'sessions', 'session-123')
    const sessionStateManager = new StateManager(TEST_DIR, sessionDir)

    await sessionStateManager.initialize('pipeline-123')

    const raw = await readFile(path.join(sessionDir, 'state.json'), 'utf-8')
    expect(JSON.parse(raw).pipeline_id).toBe('pipeline-123')
    expect(existsSync(path.join(TEST_DIR, '.invoke', 'state.json'))).toBe(false)
  })

  it('uses the legacy root state path when sessionDir is omitted', async () => {
    await stateManager.initialize('pipeline-123')

    expect(existsSync(path.join(TEST_DIR, '.invoke', 'state.json'))).toBe(true)
  })

  it('resets state', async () => {
    await stateManager.initialize('pipeline-123')
    await stateManager.update({ current_stage: 'build' })
    await stateManager.reset()

    const state = await stateManager.get()
    expect(state).toBeNull()
  })

  it('sets last_updated on initialize', async () => {
    const state = await stateManager.initialize('pipeline-123')
    expect(state.last_updated).toBeTruthy()
    expect(new Date(state.last_updated).getTime()).toBeGreaterThan(0)
  })

  it('sets last_updated on every update', async () => {
    await stateManager.initialize('pipeline-123')
    const before = (await stateManager.get())!.last_updated
    await new Promise(r => setTimeout(r, 10))
    await stateManager.update({ current_stage: 'plan' })
    const after = (await stateManager.get())!.last_updated
    expect(after).not.toBe(before)
  })

  it('returns zero review cycles when state does not exist', async () => {
    await expect(stateManager.getReviewCycleCount()).resolves.toBe(0)
    await expect(stateManager.getReviewCycleCount(1)).resolves.toBe(0)
  })

  it('adds a batch via addBatch', async () => {
    await stateManager.initialize('pipeline-123')
    await stateManager.addBatch({
      id: 1,
      status: 'pending',
      tasks: [
        { id: 'task-1', status: 'pending' },
        { id: 'task-2', status: 'pending' },
      ],
    })
    const state = await stateManager.get()
    expect(state!.batches).toHaveLength(1)
    expect(state!.batches[0].tasks).toHaveLength(2)
  })

  it('upserts an existing batch by id without truncating other batches', async () => {
    await stateManager.initialize('pipeline-123')
    await stateManager.update({
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

    await stateManager.applyComposite({
      batchUpdate: {
        id: 1,
        status: 'completed',
        tasks: [{ id: 'task-1', status: 'completed' }],
      },
    })

    const state = await stateManager.get()
    expect(state?.batches).toEqual([
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
    ])
  })

  it('appends a batch when batchUpdate does not find a matching id', async () => {
    await stateManager.initialize('pipeline-123')
    await stateManager.update({
      batches: [
        {
          id: 1,
          status: 'pending',
          tasks: [{ id: 'task-1', status: 'pending' }],
        },
      ],
    })

    await stateManager.applyComposite({
      batchUpdate: {
        id: 99,
        status: 'pending',
        tasks: [],
      },
    })

    const state = await stateManager.get()
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

  it('applies batch, review cycle, and top-level updates in a single composite write', async () => {
    await stateManager.initialize('pipeline-123')
    await stateManager.update({
      batches: [
        {
          id: 1,
          status: 'pending',
          tasks: [{ id: 'task-1', status: 'pending' }],
        },
      ],
      review_cycles: [
        { id: 1, reviewers: ['reviewer-a'], findings: [], batch_id: 1, scope: 'batch' },
      ],
    })

    const writeAtomicSpy = vi.spyOn(stateManager as any, 'writeAtomic')

    await stateManager.applyComposite({
      batchUpdate: {
        id: 1,
        status: 'completed',
        tasks: [{ id: 'task-1', status: 'completed' }],
      },
      reviewCycleUpdate: {
        id: 1,
        reviewers: ['reviewer-a', 'reviewer-b'],
        findings: [],
        batch_id: 1,
        scope: 'batch',
        tier: 'critical',
      },
      partial: {
        work_branch: 'invoke/work-1234',
        strategy: 'tdd',
      },
    })

    expect(writeAtomicSpy).toHaveBeenCalledTimes(1)
    expect(await stateManager.get()).toMatchObject({
      work_branch: 'invoke/work-1234',
      strategy: 'tdd',
      batches: [
        {
          id: 1,
          status: 'completed',
          tasks: [{ id: 'task-1', status: 'completed' }],
        },
      ],
      review_cycles: [
        {
          id: 1,
          reviewers: ['reviewer-a', 'reviewer-b'],
          findings: [],
          batch_id: 1,
          scope: 'batch',
          tier: 'critical',
        },
      ],
    })
  })

  it('applies upserts before explicit batch and review cycle replacements in a single composite write', async () => {
    await stateManager.initialize('pipeline-123')
    await stateManager.update({
      batches: [
        {
          id: 10,
          status: 'pending',
          tasks: [{ id: 'task-10', status: 'pending' }],
        },
      ],
      review_cycles: [
        { id: 10, reviewers: ['reviewer-a'], findings: [], batch_id: 10, scope: 'batch' },
      ],
    })

    const writeAtomicSpy = vi.spyOn(stateManager as any, 'writeAtomic')

    await stateManager.applyComposite({
      batchUpdate: {
        id: 2,
        status: 'pending',
        tasks: [],
      },
      reviewCycleUpdate: {
        id: 2,
        reviewers: ['reviewer-b'],
        findings: [],
        scope: 'final',
      },
      partial: {
        batches: [
          {
            id: 1,
            status: 'completed',
            tasks: [],
          },
        ],
        review_cycles: [
          {
            id: 1,
            reviewers: ['reviewer-c'],
            findings: [],
            scope: 'final',
          },
        ],
      },
    })

    expect(writeAtomicSpy).toHaveBeenCalledTimes(1)
    expect(await stateManager.get()).toMatchObject({
      batches: [
        {
          id: 1,
          status: 'completed',
          tasks: [],
        },
      ],
      review_cycles: [
        {
          id: 1,
          reviewers: ['reviewer-c'],
          findings: [],
          scope: 'final',
        },
      ],
    })
  })

  it('preserves all persist-once fields when a composite partial only updates current_stage', async () => {
    await initializeWithPersistOnceFields()

    await stateManager.applyComposite({
      partial: { current_stage: 'review' },
    })

    expect(await stateManager.get()).toMatchObject({
      current_stage: 'review',
      ...BUG013_PERSIST_ONCE_FIXTURE,
    })
  })

  it('preserves work_branch when a composite partial carries work_branch as undefined', async () => {
    await initializeWithPersistOnceFields()

    await stateManager.applyComposite({
      partial: { work_branch: undefined },
    })

    expect((await stateManager.get())?.work_branch).toBe(BUG013_BRANCH_FIXTURE.work_branch)
  })

  it('preserves work_branch when a composite partial carries work_branch as null', async () => {
    await initializeWithPersistOnceFields()

    await stateManager.applyComposite({
      partial: { work_branch: null } as Partial<PipelineState>,
    })

    expect((await stateManager.get())?.work_branch).toBe(BUG013_BRANCH_FIXTURE.work_branch)
  })

  it('spreads an empty string persist-once value instead of preserving the previous spec', async () => {
    await initializeWithPersistOnceFields()

    await stateManager.applyComposite({
      partial: { spec: '' },
    })

    expect((await stateManager.get())?.spec).toBe('')
  })

  it('preserves persisted branch fields when a later composite update adds only bug_ids', async () => {
    await stateManager.initialize(BUG013_PIPELINE_ID)
    await stateManager.update({
      ...BUG013_BRANCH_FIXTURE,
      spec: 'Scope spec',
      plan: 'Execution plan',
      tasks: 'Task breakdown',
      strategy: 'tdd',
    })

    await stateManager.applyComposite({
      partial: { bug_ids: BUG013_BUG_IDS },
    })

    expect(await stateManager.get()).toMatchObject({
      ...BUG013_BRANCH_FIXTURE,
      spec: 'Scope spec',
      plan: 'Execution plan',
      tasks: 'Task breakdown',
      strategy: 'tdd',
      bug_ids: BUG013_BUG_IDS,
    })
  })

  it('updates a batch via updateBatch', async () => {
    await stateManager.initialize('pipeline-123')
    await stateManager.addBatch({
      id: 1,
      status: 'pending',
      tasks: [{ id: 'task-1', status: 'pending' }],
    })
    await stateManager.updateBatch(0, { status: 'in_progress' })
    const state = await stateManager.get()
    expect(state!.batches[0].status).toBe('in_progress')
  })

  it('updates a specific task via updateTask', async () => {
    await stateManager.initialize('pipeline-123')
    await stateManager.addBatch({
      id: 1,
      status: 'in_progress',
      tasks: [
        { id: 'task-1', status: 'pending' },
        { id: 'task-2', status: 'pending' },
      ],
    })
    await stateManager.updateTask(0, 'task-2', {
      status: 'running',
      worktree_path: '/tmp/invoke-worktree-task-2',
      worktree_branch: 'invoke-wt-task-2',
    })
    const state = await stateManager.get()
    expect(state!.batches[0].tasks[0].status).toBe('pending')
    expect(state!.batches[0].tasks[1].status).toBe('running')
    expect(state!.batches[0].tasks[1].worktree_path).toBe('/tmp/invoke-worktree-task-2')
  })

  it('serializes concurrent updateTask calls so task updates are not lost', async () => {
    await stateManager.initialize('pipeline-123')
    await stateManager.addBatch({
      id: 1,
      status: 'in_progress',
      tasks: [
        { id: 'task-1', status: 'pending' },
        { id: 'task-2', status: 'pending' },
      ],
    })

    let releaseFirstWrite: (() => void) | null = null
    let markFirstWriteStarted: (() => void) | null = null
    const firstWriteStarted = new Promise<void>(resolve => {
      markFirstWriteStarted = resolve
    })
    const writeAtomic = (stateManager as any).writeAtomic.bind(stateManager)

    vi.spyOn(stateManager as any, 'writeAtomic').mockImplementation(async (state: unknown) => {
      if (!releaseFirstWrite) {
        markFirstWriteStarted?.()
        await new Promise<void>(resolve => {
          releaseFirstWrite = resolve
        })
      }

      return writeAtomic(state)
    })

    const firstUpdate = stateManager.updateTask(0, 'task-1', { status: 'running' })
    await firstWriteStarted
    const secondUpdate = stateManager.updateTask(0, 'task-2', { status: 'completed' })

    releaseFirstWrite?.()
    await Promise.all([firstUpdate, secondUpdate])

    const state = await stateManager.get()
    expect(state!.batches[0].tasks[0].status).toBe('running')
    expect(state!.batches[0].tasks[1].status).toBe('completed')
  })

  it('throws when updating task in nonexistent batch', async () => {
    await stateManager.initialize('pipeline-123')
    await expect(
      stateManager.updateTask(5, 'task-1', { status: 'running' })
    ).rejects.toThrow()
  })

  it('throws when updating nonexistent task', async () => {
    await stateManager.initialize('pipeline-123')
    await stateManager.addBatch({
      id: 1,
      status: 'in_progress',
      tasks: [{ id: 'task-1', status: 'pending' }],
    })
    await expect(
      stateManager.updateTask(0, 'nonexistent', { status: 'running' })
    ).rejects.toThrow()
  })

  it('writes atomically (no leftover tmp files)', async () => {
    await stateManager.initialize('pipeline-123')
    const { readdirSync } = await import('fs')
    const files = readdirSync(path.join(TEST_DIR, '.invoke'))
    const tmpFiles = files.filter((f: string) => f.endsWith('.tmp'))
    expect(tmpFiles).toHaveLength(0)
  })

  it('only ensures the storage directory on the first write', async () => {
    vi.resetModules()
    const mkdirSpy = vi.fn().mockResolvedValue(undefined)

    try {
      vi.doMock('fs/promises', async importOriginal => {
        const actual = await importOriginal<typeof import('fs/promises')>()
        return {
          ...actual,
          mkdir: mkdirSpy,
        }
      })

      const { StateManager: MockedStateManager } = await import('../../src/tools/state.js')
      const mockedStateManager = new MockedStateManager(TEST_DIR)

      await mockedStateManager.initialize('pipeline-123')
      await mockedStateManager.update({ current_stage: 'build' })

      expect(mkdirSpy).toHaveBeenCalledTimes(1)
      expect(mkdirSpy).toHaveBeenCalledWith(path.join(TEST_DIR, '.invoke'), { recursive: true })
    } finally {
      vi.doUnmock('fs/promises')
      vi.resetModules()
    }
  })

  it('counts review cycles across the whole pipeline and per batch', async () => {
    await stateManager.initialize('pipeline-123')
    await stateManager.update({
      review_cycles: [
        { id: 1, reviewers: ['reviewer-a'], findings: [], batch_id: 1, scope: 'batch' },
        { id: 2, reviewers: ['reviewer-b'], findings: [], batch_id: 2, scope: 'batch' },
        { id: 3, reviewers: ['reviewer-c'], findings: [], batch_id: 2, scope: 'final' },
      ],
    })

    await expect(stateManager.getReviewCycleCount()).resolves.toBe(3)
    await expect(stateManager.getReviewCycleCount(1)).resolves.toBe(1)
    await expect(stateManager.getReviewCycleCount(2)).resolves.toBe(2)
    await expect(stateManager.getReviewCycleCount(99)).resolves.toBe(0)
  })

  it('upserts review cycles by id and appends when the cycle is new', async () => {
    await stateManager.initialize('pipeline-123')
    await stateManager.update({
      review_cycles: [
        { id: 1, reviewers: ['reviewer-a'], findings: [], batch_id: 1, scope: 'batch' },
      ],
    })

    await stateManager.applyComposite({
      reviewCycleUpdate: {
        id: 1,
        reviewers: ['reviewer-a', 'reviewer-b'],
        findings: [],
        batch_id: 1,
        scope: 'batch',
        tier: 'critical',
      },
    })
    await stateManager.applyComposite({
      reviewCycleUpdate: {
        id: 2,
        reviewers: ['reviewer-c'],
        findings: [],
        scope: 'final',
      },
    })

    const state = await stateManager.get()
    expect(state?.review_cycles).toEqual([
      {
        id: 1,
        reviewers: ['reviewer-a', 'reviewer-b'],
        findings: [],
        batch_id: 1,
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

  it('merges batch_update.tasks by id, preserving sibling tasks not in the partial array', async () => {
    await stateManager.initialize('pipeline-123')
    await stateManager.update({
      batches: [
        {
          id: 1,
          status: 'in_progress',
          tasks: [
            { id: 'task-1', status: 'running' },
            { id: 'task-2', status: 'completed', merged: true },
            { id: 'task-3', status: 'pending' },
          ],
        },
      ],
    })

    // Send only the changed task — task-1 transitions to conflict.
    await stateManager.applyComposite({
      batchUpdate: {
        id: 1,
        status: 'in_progress',
        tasks: [
          {
            id: 'task-1',
            status: 'conflict',
            conflict_attempts: 1,
            conflicting_files: ['src/foo.ts'],
          },
        ],
      },
    })

    const state = await stateManager.get()
    expect(state?.batches[0].tasks).toEqual([
      {
        id: 'task-1',
        status: 'conflict',
        conflict_attempts: 1,
        conflicting_files: ['src/foo.ts'],
      },
      { id: 'task-2', status: 'completed', merged: true },
      { id: 'task-3', status: 'pending' },
    ])
  })

  it('appends new tasks via batch_update merge when the id does not exist', async () => {
    await stateManager.initialize('pipeline-123')
    await stateManager.update({
      batches: [
        {
          id: 1,
          status: 'in_progress',
          tasks: [{ id: 'task-1', status: 'running' }],
        },
      ],
    })

    await stateManager.applyComposite({
      batchUpdate: {
        id: 1,
        status: 'in_progress',
        tasks: [{ id: 'task-2', status: 'pending' }],
      },
    })

    const state = await stateManager.get()
    expect(state?.batches[0].tasks).toEqual([
      { id: 'task-1', status: 'running' },
      { id: 'task-2', status: 'pending' },
    ])
  })

  it('caches state in memory after a write so subsequent get() does not re-read disk', async () => {
    await stateManager.initialize('pipeline-123')

    // Delete the file out from under the manager. If get() still returns
    // state, it must be coming from the in-memory cache.
    const { unlink } = await import('fs/promises')
    await unlink(path.join(TEST_DIR, '.invoke', 'state.json'))
    expect(existsSync(path.join(TEST_DIR, '.invoke', 'state.json'))).toBe(false)

    const cached = await stateManager.get()
    expect(cached?.pipeline_id).toBe('pipeline-123')

    // A subsequent write through the manager must keep the cache in sync
    // with the new state — and recreate the file via the atomic write.
    await stateManager.update({ current_stage: 'build' })
    const updated = await stateManager.get()
    expect(updated?.current_stage).toBe('build')
    expect(existsSync(path.join(TEST_DIR, '.invoke', 'state.json'))).toBe(true)
  })

  it('invalidates the in-memory cache on reset()', async () => {
    await stateManager.initialize('pipeline-123')
    expect(await stateManager.get()).not.toBeNull()

    await stateManager.reset()
    expect(await stateManager.get()).toBeNull()
  })

  it('throws when applyComposite is called without an active pipeline', async () => {
    await expect(
      stateManager.applyComposite({ partial: { current_stage: 'build' } })
    ).rejects.toThrow('No active pipeline. Call initialize() first.')
    await expect(
      stateManager.applyComposite({
        batchUpdate: { id: 1, status: 'pending', tasks: [] },
      })
    ).rejects.toThrow('No active pipeline. Call initialize() first.')
    await expect(
      stateManager.applyComposite({
        reviewCycleUpdate: { id: 1, reviewers: ['reviewer-a'], findings: [] },
      })
    ).rejects.toThrow('No active pipeline. Call initialize() first.')
  })
})

describe('invoke_set_state schema alignment', () => {
  it('persists base_branch and work_branch_path and round-trips them via invoke_get_state', async () => {
    const setStateTool = getTool('invoke_set_state')
    const workBranchPath = '/tmp/invoke-session-1'
    const input = {
      session_id: 'session-1',
      pipeline_id: 'pipeline-123',
      base_branch: 'main',
      work_branch_path: workBranchPath,
    }

    expect(setStateTool.config.inputSchema.safeParse(input).success).toBe(true)

    const setResult = await setStateTool.handler(input)
    expect(setResult.isError).toBeUndefined()

    const storedState = await new StateManager(
      TEST_DIR,
      sessionManager.resolve('session-1')
    ).get()
    expect(storedState).toMatchObject({
      pipeline_id: 'pipeline-123',
      base_branch: 'main',
      work_branch_path: workBranchPath,
    })

    const getResult = await getTool('invoke_get_state').handler({ session_id: 'session-1' })
    expect(getResult.isError).toBeUndefined()
    expect(parseResponseText(getResult)).toMatchObject({
      pipeline_id: 'pipeline-123',
      base_branch: 'main',
      work_branch_path: workBranchPath,
    })
  })

  it('accepts conflict status and conflict_attempts for tasks', async () => {
    const setStateTool = getTool('invoke_set_state')
    const input = {
      session_id: 'session-1',
      pipeline_id: 'pipeline-123',
      batches: [
        {
          id: 1,
          status: 'pending',
          tasks: [
            {
              id: 'task-1',
              status: 'conflict',
              conflict_attempts: 2,
            },
          ],
        },
      ],
    }

    expect(setStateTool.config.inputSchema.safeParse(input).success).toBe(true)

    const result = await setStateTool.handler(input)
    expect(result.isError).toBeUndefined()

    const storedState = await new StateManager(
      TEST_DIR,
      sessionManager.resolve('session-1')
    ).get()
    expect(storedState?.batches[0].tasks[0]).toMatchObject({
      id: 'task-1',
      status: 'conflict',
      conflict_attempts: 2,
    })
  })

  it('remains backward compatible when the new fields are omitted', async () => {
    const setStateTool = getTool('invoke_set_state')
    const input = {
      session_id: 'session-1',
      pipeline_id: 'pipeline-123',
      work_branch: 'invoke/work-1234',
      batches: [
        {
          id: 1,
          status: 'pending',
          tasks: [
            {
              id: 'task-1',
              status: 'running',
            },
          ],
        },
      ],
    }

    expect(setStateTool.config.inputSchema.safeParse(input).success).toBe(true)

    const result = await setStateTool.handler(input)
    expect(result.isError).toBeUndefined()

    const getResult = await getTool('invoke_get_state').handler({ session_id: 'session-1' })
    expect(getResult.isError).toBeUndefined()
    expect(parseResponseText(getResult)).toMatchObject({
      pipeline_id: 'pipeline-123',
      work_branch: 'invoke/work-1234',
      batches: [
        {
          id: 1,
          status: 'pending',
          tasks: [
            {
              id: 'task-1',
              status: 'running',
            },
          ],
        },
      ],
    })
  })

  it('rejects invalid task status values', () => {
    const result = getTool('invoke_set_state').config.inputSchema.safeParse({
      session_id: 'session-1',
      pipeline_id: 'pipeline-123',
      batches: [
        {
          id: 1,
          status: 'pending',
          tasks: [
            {
              id: 'task-1',
              status: 'foo',
            },
          ],
        },
      ],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some(issue => issue.path.join('.') === 'batches.0.tasks.0.status')).toBe(true)
    }
  })
})
