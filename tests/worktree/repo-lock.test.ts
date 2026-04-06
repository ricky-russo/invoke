import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import { withMergeTargetLock, withRepoLock } from '../../src/worktree/repo-lock.js'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

let testDir: string

beforeEach(async () => {
  testDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-repo-lock-test-'))
})

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true })
})

describe('repo-lock', () => {
  it('serializes 3 concurrent calls on the same repo key', async () => {
    const repoDir = path.join(testDir, 'repo')
    await mkdir(repoDir)

    const events: string[] = []
    let active = 0
    let maxActive = 0

    const makeCall = (label: string) =>
      withRepoLock(repoDir, async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        events.push(`start:${label}`)
        await sleep(20)
        events.push(`end:${label}`)
        active -= 1
        return label
      })

    await expect(Promise.all([makeCall('a'), makeCall('b'), makeCall('c')])).resolves.toEqual([
      'a',
      'b',
      'c',
    ])
    expect(maxActive).toBe(1)
    expect(events).toEqual([
      'start:a',
      'end:a',
      'start:b',
      'end:b',
      'start:c',
      'end:c',
    ])
  })

  it('allows parallel calls on different repo keys', async () => {
    const repoA = path.join(testDir, 'repo-a')
    const repoB = path.join(testDir, 'repo-b')
    await Promise.all([mkdir(repoA), mkdir(repoB)])

    let active = 0
    let maxActive = 0
    let releaseA!: () => void
    let releaseB!: () => void
    let enteredA!: () => void
    let enteredB!: () => void

    const waitForA = new Promise<void>(resolve => {
      releaseA = resolve
    })
    const waitForB = new Promise<void>(resolve => {
      releaseB = resolve
    })
    const startedA = new Promise<void>(resolve => {
      enteredA = resolve
    })
    const startedB = new Promise<void>(resolve => {
      enteredB = resolve
    })

    const first = withRepoLock(repoA, async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      enteredA()
      await waitForA
      active -= 1
      return 'a'
    })

    const second = withRepoLock(repoB, async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      enteredB()
      await waitForB
      active -= 1
      return 'b'
    })

    await Promise.all([startedA, startedB])
    expect(maxActive).toBe(2)

    releaseA()
    releaseB()

    await expect(Promise.all([first, second])).resolves.toEqual(['a', 'b'])
  })

  it('releases the merge-target lock when the callback throws', async () => {
    const targetPath = path.join(testDir, 'merge-target')
    await mkdir(targetPath)

    const events: string[] = []

    const first = withMergeTargetLock(targetPath, async () => {
      events.push('first')
      throw new Error('boom')
    })

    const second = withMergeTargetLock(targetPath, async () => {
      events.push('second')
      return 'ok'
    })

    await expect(first).rejects.toThrow('boom')
    await expect(second).resolves.toBe('ok')
    expect(events).toEqual(['first', 'second'])
  })

  it('canonicalizes path variants to the same lock key', async () => {
    const targetPath = path.join(testDir, 'canonical-target')
    const nestedDir = path.join(targetPath, 'nested')
    await mkdir(nestedDir, { recursive: true })

    const alternatePath = path.join(targetPath, 'nested', '..')
    const events: string[] = []
    let releaseFirst!: () => void
    let firstEntered!: () => void

    const allowFirstToFinish = new Promise<void>(resolve => {
      releaseFirst = resolve
    })
    const firstStarted = new Promise<void>(resolve => {
      firstEntered = resolve
    })

    const first = withMergeTargetLock(targetPath, async () => {
      events.push('first-start')
      firstEntered()
      await allowFirstToFinish
      events.push('first-end')
      return 'first'
    })

    await firstStarted

    const second = withMergeTargetLock(alternatePath, async () => {
      events.push('second-start')
      return 'second'
    })

    await sleep(20)
    expect(events).toEqual(['first-start'])

    releaseFirst()

    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second'])
    expect(events).toEqual(['first-start', 'first-end', 'second-start'])
  })
})
