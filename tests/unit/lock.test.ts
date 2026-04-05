import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import path from 'path'
import os from 'os'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

let testDir: string
let lockFilePath: string

beforeEach(async () => {
  testDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-lock-test-'))
  lockFilePath = path.join(testDir, 'session.json')
  await writeFile(lockFilePath, '{}')
  vi.resetModules()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(testDir, { recursive: true, force: true })
})

describe('withLock', () => {
  it('passes the expected stale and retry options to proper-lockfile', async () => {
    const release = vi.fn().mockResolvedValue(undefined)
    const lock = vi.fn().mockResolvedValue(release)

    vi.doMock('proper-lockfile', () => ({
      default: { lock },
    }))

    const { withLock } = await import('../../src/session/lock.js')

    await expect(withLock(lockFilePath, async () => 'ok')).resolves.toBe('ok')
    expect(lock).toHaveBeenCalledWith(lockFilePath, {
      realpath: false,
      stale: 30000,
      retries: { retries: 5, minTimeout: 100, maxTimeout: 1000 },
    })
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('releases the lock even when the callback throws', async () => {
    const release = vi.fn().mockResolvedValue(undefined)
    const lock = vi.fn().mockResolvedValue(release)

    vi.doMock('proper-lockfile', () => ({
      default: { lock },
    }))

    const { withLock } = await import('../../src/session/lock.js')

    await expect(
      withLock(lockFilePath, async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')

    expect(release).toHaveBeenCalledTimes(1)
  })

  it('serializes concurrent calls for the same file', async () => {
    const heldLocks = new Set<string>()
    const waiters = new Map<string, Array<() => void>>()

    vi.doMock('proper-lockfile', () => ({
      default: {
        lock: vi.fn(async (filePath: string) => {
          while (heldLocks.has(filePath)) {
            await new Promise<void>(resolve => {
              const queue = waiters.get(filePath) ?? []
              queue.push(resolve)
              waiters.set(filePath, queue)
            })
          }

          heldLocks.add(filePath)

          return async () => {
            heldLocks.delete(filePath)
            const queue = waiters.get(filePath)
            const next = queue?.shift()
            next?.()
          }
        }),
      },
    }))

    const { withLock } = await import('../../src/session/lock.js')
    const events: string[] = []

    let firstEnteredResolve!: () => void
    const firstEntered = new Promise<void>(resolve => {
      firstEnteredResolve = resolve
    })

    let allowFirstResolve!: () => void
    const allowFirstToFinish = new Promise<void>(resolve => {
      allowFirstResolve = resolve
    })

    const first = withLock(lockFilePath, async () => {
      events.push('first-start')
      firstEnteredResolve()
      await allowFirstToFinish
      events.push('first-end')
      return 'first'
    })

    await firstEntered

    const second = withLock(lockFilePath, async () => {
      events.push('second-start')
      return 'second'
    })

    await sleep(50)
    expect(events).toEqual(['first-start'])

    allowFirstResolve()

    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second'])
    expect(events).toEqual(['first-start', 'first-end', 'second-start'])
  })
})
