import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { SessionManager } from '../../src/session/manager.js'
import type { PipelineState, SessionInfo } from '../../src/types.js'

function createState(overrides: Partial<PipelineState> = {}): PipelineState {
  return {
    pipeline_id: 'pipeline-123',
    started: '2026-04-05T08:00:00.000Z',
    last_updated: '2026-04-05T09:00:00.000Z',
    current_stage: 'build',
    batches: [],
    review_cycles: [],
    ...overrides,
  }
}

describe('SessionManager', () => {
  let projectDir: string
  let manager: SessionManager

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-05T12:00:00.000Z'))

    projectDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-session-manager-'))
    manager = new SessionManager(projectDir)
  })

  afterEach(async () => {
    vi.useRealTimers()
    await rm(projectDir, { recursive: true, force: true })
  })

  async function writeSessionState(sessionId: string, state: PipelineState): Promise<string> {
    const sessionDir = path.join(projectDir, '.invoke', 'sessions', sessionId)
    await mkdir(sessionDir, { recursive: true })
    await writeFile(path.join(sessionDir, 'state.json'), JSON.stringify(state, null, 2) + '\n')
    return sessionDir
  }

  it('creates a session directory recursively and returns its path', async () => {
    const sessionDir = await manager.create('session-1')

    expect(sessionDir).toBe(path.join(projectDir, '.invoke', 'sessions', 'session-1'))
    expect(existsSync(sessionDir)).toBe(true)
  })

  it('resolves an existing session and throws for a missing session', async () => {
    await manager.create('session-1')

    expect(manager.resolve('session-1')).toBe(
      path.join(projectDir, '.invoke', 'sessions', 'session-1')
    )
    expect(() => manager.resolve('missing-session')).toThrow(
      "Session 'missing-session' does not exist"
    )
  })

  it.each(['session-1', 'Session_2', 's.third-4'])(
    'accepts allow-listed session IDs: %p',
    async sessionId => {
      const sessionDir = await manager.create(sessionId)

      expect(sessionDir).toBe(path.join(projectDir, '.invoke', 'sessions', sessionId))
      expect(manager.resolve(sessionId)).toBe(sessionDir)
      expect(manager.exists(sessionId)).toBe(true)
    }
  )

  it.each([
    '',
    '.',
    '..',
    '../evil',
    'nested/path',
    'nested\\path',
    'session*1',
    'session 1',
    '.session',
    '-session',
  ])(
    'rejects invalid session IDs on create: %p',
    async sessionId => {
      await expect(manager.create(sessionId)).rejects.toThrow(`Invalid session ID: '${sessionId}'`)
    }
  )

  it.each([
    '',
    '.',
    '..',
    '../evil',
    'nested/path',
    'nested\\path',
  ])(
    'rejects traversal-oriented session IDs on read paths: %p',
    async sessionId => {
      expect(() => manager.resolve(sessionId)).toThrow(`Invalid session ID: '${sessionId}'`)
      await expect(manager.cleanup(sessionId)).rejects.toThrow(
        `Invalid session ID: '${sessionId}'`
      )
      expect(() => manager.exists(sessionId)).toThrow(`Invalid session ID: '${sessionId}'`)
      await expect(manager.isStale(sessionId)).rejects.toThrow(
        `Invalid session ID: '${sessionId}'`
      )
    }
  )

  it('reads and cleans up a manually-created legacy session directory', async () => {
    const sessionId = 'legacy session-id'
    const sessionDir = await writeSessionState(
      sessionId,
      createState({
        pipeline_id: sessionId,
        last_updated: '2026-03-20T12:00:00.000Z',
      })
    )

    expect(manager.resolve(sessionId)).toBe(sessionDir)
    expect(manager.exists(sessionId)).toBe(true)
    await expect(manager.isStale(sessionId)).resolves.toBe(true)

    await manager.cleanup(sessionId)

    expect(manager.exists(sessionId)).toBe(false)
    expect(existsSync(sessionDir)).toBe(false)
  })

  it('rejects creating a legacy-shaped session ID', async () => {
    await expect(manager.create('legacy session-id')).rejects.toThrow(
      "Invalid session ID: 'legacy session-id'"
    )
  })

  it('rejects a legacy pipeline_id that is invalid during migration', async () => {
    const invokeDir = path.join(projectDir, '.invoke')
    const legacyState = createState({ pipeline_id: '.' })

    await mkdir(invokeDir, { recursive: true })
    await writeFile(path.join(invokeDir, 'state.json'), JSON.stringify(legacyState, null, 2) + '\n')

    await expect(manager.migrate()).resolves.toEqual({ migrated: false })

    expect(existsSync(path.join(invokeDir, 'state.json'))).toBe(true)
    expect(existsSync(path.join(projectDir, '.invoke', 'sessions', '.'))).toBe(false)
  })

  it('lists session info by reading session state files', async () => {
    await writeSessionState(
      'session-active',
      createState({
        pipeline_id: 'pipeline-active',
        current_stage: 'review',
        last_updated: '2026-04-05T11:00:00.000Z',
      })
    )
    await writeSessionState(
      'session-complete',
      createState({
        pipeline_id: 'pipeline-complete',
        current_stage: 'complete',
        last_updated: '2026-04-05T10:30:00.000Z',
      })
    )
    await writeSessionState(
      'session-stale',
      createState({
        pipeline_id: 'pipeline-stale',
        current_stage: 'build',
        last_updated: '2026-03-20T12:00:00.000Z',
      })
    )

    const sessions = await manager.list()
    const typedSessions: SessionInfo[] = sessions

    expect(typedSessions).toEqual([
      {
        session_id: 'session-active',
        pipeline_id: 'pipeline-active',
        current_stage: 'review',
        started: '2026-04-05T08:00:00.000Z',
        last_updated: '2026-04-05T11:00:00.000Z',
        status: 'active',
      },
      {
        session_id: 'session-complete',
        pipeline_id: 'pipeline-complete',
        current_stage: 'complete',
        started: '2026-04-05T08:00:00.000Z',
        last_updated: '2026-04-05T10:30:00.000Z',
        status: 'complete',
      },
      {
        session_id: 'session-stale',
        pipeline_id: 'pipeline-stale',
        current_stage: 'build',
        started: '2026-04-05T08:00:00.000Z',
        last_updated: '2026-03-20T12:00:00.000Z',
        status: 'stale',
      },
    ])
  })

  it('applies a custom stale threshold when listing sessions', async () => {
    await writeSessionState(
      'session-aging',
      createState({
        pipeline_id: 'pipeline-aging',
        current_stage: 'build',
        last_updated: '2026-04-01T11:59:59.000Z',
      })
    )

    await expect(manager.list()).resolves.toMatchObject([
      { session_id: 'session-aging', status: 'active' },
    ])
    await expect(manager.list(3)).resolves.toMatchObject([
      { session_id: 'session-aging', status: 'stale' },
    ])
  })

  it('detects stale sessions using the default and custom thresholds', async () => {
    await writeSessionState(
      'session-1',
      createState({
        last_updated: '2026-03-29T11:59:59.000Z',
      })
    )
    await writeSessionState(
      'session-2',
      createState({
        last_updated: '2026-03-31T12:00:00.000Z',
      })
    )

    await expect(manager.isStale('session-1')).resolves.toBe(true)
    await expect(manager.isStale('session-2')).resolves.toBe(false)
    await expect(manager.isStale('session-2', 4)).resolves.toBe(true)
  })

  it('cleans up a session directory recursively', async () => {
    const sessionDir = await manager.create('session-1')
    await writeFile(path.join(sessionDir, 'state.json'), JSON.stringify(createState()) + '\n')
    await writeFile(path.join(sessionDir, 'metrics.json'), JSON.stringify({ total: 1 }) + '\n')

    expect(manager.exists('session-1')).toBe(true)

    await manager.cleanup('session-1')

    expect(manager.exists('session-1')).toBe(false)
    expect(existsSync(sessionDir)).toBe(false)
  })

  it('migrates legacy root state and metrics into a session directory', async () => {
    const invokeDir = path.join(projectDir, '.invoke')
    const legacyState = createState({ pipeline_id: 'legacy session-id' })

    await mkdir(invokeDir, { recursive: true })
    await writeFile(path.join(invokeDir, 'state.json'), JSON.stringify(legacyState, null, 2) + '\n')
    await writeFile(path.join(invokeDir, 'metrics.json'), JSON.stringify([{ total: 1 }], null, 2) + '\n')

    await expect(manager.migrate()).resolves.toEqual({
      migrated: true,
      sessionId: 'legacy session-id',
    })

    const sessionDir = path.join(projectDir, '.invoke', 'sessions', 'legacy session-id')
    expect(existsSync(path.join(invokeDir, 'state.json'))).toBe(false)
    expect(existsSync(path.join(invokeDir, 'metrics.json'))).toBe(false)
    expect(JSON.parse(await readFile(path.join(sessionDir, 'state.json'), 'utf-8'))).toEqual(legacyState)
    expect(JSON.parse(await readFile(path.join(sessionDir, 'metrics.json'), 'utf-8'))).toEqual([
      { total: 1 },
    ])
  })

  it('returns migrated false when no legacy root state exists', async () => {
    await expect(manager.migrate()).resolves.toEqual({ migrated: false })
  })

  it('returns migrated false when legacy state disappears before rename', async () => {
    const invokeDir = path.join(projectDir, '.invoke')
    const renameError = new Error('state.json missing') as NodeJS.ErrnoException
    renameError.code = 'ENOENT'

    await mkdir(invokeDir, { recursive: true })
    await writeFile(
      path.join(invokeDir, 'state.json'),
      JSON.stringify(createState({ pipeline_id: 'race-pipeline' }), null, 2) + '\n'
    )

    vi.resetModules()
    vi.doMock('fs/promises', async importOriginal => {
      const actual = await importOriginal<typeof import('fs/promises')>()
      return {
        ...actual,
        rename: vi.fn().mockRejectedValueOnce(renameError),
      }
    })

    const { SessionManager: MockedSessionManager } = await import('../../src/session/manager.js')
    const raceManager = new MockedSessionManager(projectDir)

    await expect(raceManager.migrate()).resolves.toEqual({ migrated: false })

    vi.doUnmock('fs/promises')
    vi.resetModules()
  })
})
