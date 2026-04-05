import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function createSerializedLockMock() {
  const heldLocks = new Set<string>()
  const waiters = new Map<string, Array<() => void>>()

  return vi.fn(async <T>(lockPath: string, fn: () => Promise<T>) => {
    while (heldLocks.has(lockPath)) {
      await new Promise<void>(resolve => {
        const queue = waiters.get(lockPath) ?? []
        queue.push(resolve)
        waiters.set(lockPath, queue)
      })
    }

    heldLocks.add(lockPath)

    try {
      return await fn()
    } finally {
      heldLocks.delete(lockPath)
      const queue = waiters.get(lockPath)
      const next = queue?.shift()
      next?.()
    }
  })
}

describe('tool locking', () => {
  let projectDir: string

  beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-tool-locking-'))
    await mkdir(path.join(projectDir, '.invoke'), { recursive: true })
    vi.resetModules()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(projectDir, { recursive: true, force: true })
  })

  it('serializes concurrent artifact saves on the artifact path', async () => {
    const withLock = createSerializedLockMock()
    const events: string[] = []

    let firstWriteStartedResolve!: () => void
    const firstWriteStarted = new Promise<void>(resolve => {
      firstWriteStartedResolve = resolve
    })

    let allowFirstWriteResolve!: () => void
    const allowFirstWrite = new Promise<void>(resolve => {
      allowFirstWriteResolve = resolve
    })

    vi.doMock('../../src/session/lock.js', () => ({
      withLock,
    }))

    vi.doMock('fs/promises', async () => {
      const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises')

      return {
        ...actual,
        writeFile: vi.fn(async (filePath, content, options) => {
          if (content === 'Version 1') {
            events.push('first-write-start')
            firstWriteStartedResolve()
            await allowFirstWrite
            events.push('first-write-end')
          } else if (content === 'Version 2') {
            events.push('second-write-start')
          }

          return actual.writeFile(filePath, content, options)
        }),
      }
    })

    const { ArtifactManager } = await import('../../src/tools/artifacts.js')
    const artifacts = new ArtifactManager(projectDir)
    const artifactPath = path.join(projectDir, '.invoke', 'specs', 'spec.md')

    const firstSave = artifacts.save('specs', 'spec.md', 'Version 1')
    await firstWriteStarted

    const secondSave = artifacts.save('specs', 'spec.md', 'Version 2')

    await sleep(50)
    expect(events).toEqual(['first-write-start'])
    expect(withLock).toHaveBeenNthCalledWith(1, artifactPath, expect.any(Function))
    expect(withLock).toHaveBeenNthCalledWith(2, artifactPath, expect.any(Function))

    allowFirstWriteResolve()

    await expect(Promise.all([firstSave, secondSave])).resolves.toEqual([
      artifactPath,
      artifactPath,
    ])
    expect(events).toEqual(['first-write-start', 'first-write-end', 'second-write-start'])
    await expect(readFile(artifactPath, 'utf-8')).resolves.toBe('Version 2')
  })

  it('does not lock artifact reads, lists, or deletes', async () => {
    const withLock = vi.fn(async <T>(_lockPath: string, fn: () => Promise<T>) => fn())

    vi.doMock('../../src/session/lock.js', () => ({
      withLock,
    }))

    const { ArtifactManager } = await import('../../src/tools/artifacts.js')
    const artifacts = new ArtifactManager(projectDir)

    await artifacts.save('reviews', 'cycle-1.json', '{}')
    withLock.mockClear()

    await expect(artifacts.read('reviews', 'cycle-1.json')).resolves.toBe('{}')
    await expect(artifacts.list('reviews')).resolves.toEqual(['cycle-1.json'])
    await expect(artifacts.delete('reviews', 'cycle-1.json')).resolves.toBeUndefined()

    expect(withLock).not.toHaveBeenCalled()
  })

  it('propagates artifact lock errors', async () => {
    const withLock = vi.fn().mockRejectedValue(new Error('artifact lock failed'))

    vi.doMock('../../src/session/lock.js', () => ({
      withLock,
    }))

    const { ArtifactManager } = await import('../../src/tools/artifacts.js')
    const artifacts = new ArtifactManager(projectDir)

    await expect(artifacts.save('specs', 'spec.md', 'content')).rejects.toThrow(
      'artifact lock failed'
    )
  })

  it('serializes the full context update read-modify-write sequence', async () => {
    const withLock = createSerializedLockMock()
    const events: string[] = []

    let firstWriteStartedResolve!: () => void
    const firstWriteStarted = new Promise<void>(resolve => {
      firstWriteStartedResolve = resolve
    })

    let allowFirstWriteResolve!: () => void
    const allowFirstWrite = new Promise<void>(resolve => {
      allowFirstWriteResolve = resolve
    })

    vi.doMock('../../src/session/lock.js', () => ({
      withLock,
    }))

    vi.doMock('fs/promises', async () => {
      const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises')
      let updateReadCount = 0

      return {
        ...actual,
        readFile: vi.fn(async (filePath, encoding) => {
          if (filePath === path.join(projectDir, '.invoke', 'context.md') && encoding === 'utf-8') {
            updateReadCount += 1
            events.push(updateReadCount === 1 ? 'first-read' : 'second-read')
          }

          return actual.readFile(filePath, encoding as BufferEncoding)
        }),
        writeFile: vi.fn(async (filePath, content, options) => {
          if (
            filePath === path.join(projectDir, '.invoke', 'context.md') &&
            typeof content === 'string' &&
            content.includes('Architecture one')
          ) {
            events.push('first-write-start')
            firstWriteStartedResolve()
            await allowFirstWrite
            events.push('first-write-end')
          } else if (
            filePath === path.join(projectDir, '.invoke', 'context.md') &&
            typeof content === 'string' &&
            content.includes('Architecture two')
          ) {
            events.push('second-write-start')
          }

          return actual.writeFile(filePath, content, options)
        }),
      }
    })

    const { ContextManager } = await import('../../src/tools/context.js')
    const manager = new ContextManager(projectDir)
    const contextPath = path.join(projectDir, '.invoke', 'context.md')

    await writeFile(
      contextPath,
      '# Project Context\n\n## Architecture\n\nOld architecture\n\n## Conventions\n\nOld conventions\n'
    )

    const firstUpdate = manager.updateSection('Architecture', 'Architecture one', 'replace')
    await firstWriteStarted

    const secondUpdate = manager.updateSection('Architecture', 'Architecture two', 'replace')

    await sleep(50)
    expect(events).toEqual(['first-read', 'first-write-start'])
    expect(withLock).toHaveBeenNthCalledWith(1, contextPath, expect.any(Function))
    expect(withLock).toHaveBeenNthCalledWith(2, contextPath, expect.any(Function))

    allowFirstWriteResolve()

    await expect(Promise.all([firstUpdate, secondUpdate])).resolves.toEqual([undefined, undefined])
    expect(events).toEqual([
      'first-read',
      'first-write-start',
      'first-write-end',
      'second-read',
      'second-write-start',
    ])

    await expect(readFile(contextPath, 'utf-8')).resolves.toContain('Architecture two')
  })

  it('locks context initialization and leaves get/exists unlocked', async () => {
    const withLock = vi.fn(async <T>(_lockPath: string, fn: () => Promise<T>) => fn())

    vi.doMock('../../src/session/lock.js', () => ({
      withLock,
    }))

    const { ContextManager } = await import('../../src/tools/context.js')
    const manager = new ContextManager(projectDir)
    const contextPath = path.join(projectDir, '.invoke', 'context.md')

    await manager.initialize('# Project Context\n\n## Overview\n\nTest project\n')
    expect(withLock).toHaveBeenCalledWith(contextPath, expect.any(Function))

    withLock.mockClear()

    await expect(manager.get()).resolves.toContain('Test project')
    expect(manager.exists()).toBe(true)
    expect(withLock).not.toHaveBeenCalled()
  })

  it('propagates context lock errors', async () => {
    const withLock = vi.fn().mockRejectedValue(new Error('context lock failed'))

    vi.doMock('../../src/session/lock.js', () => ({
      withLock,
    }))

    const { ContextManager } = await import('../../src/tools/context.js')
    const manager = new ContextManager(projectDir)

    await expect(manager.initialize('# Project Context')).rejects.toThrow('context lock failed')
  })
})
