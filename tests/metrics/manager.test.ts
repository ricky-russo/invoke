import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'fs'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import { MetricsManager } from '../../src/metrics/manager.js'
import { StateManager } from '../../src/tools/state.js'
import type { DispatchMetric, InvokeConfig } from '../../src/types.js'

function createMetric(overrides: Partial<DispatchMetric> = {}): DispatchMetric {
  return {
    pipeline_id: 'pipeline-123',
    stage: 'build',
    role: 'builder',
    subrole: 'default',
    provider: 'claude',
    model: 'opus-4.6',
    effort: 'medium',
    prompt_size_chars: 100,
    duration_ms: 250,
    status: 'success',
    started_at: '2026-04-04T12:00:00.000Z',
    ...overrides,
  }
}

function createConfig(maxDispatches?: number): InvokeConfig {
  return {
    providers: {},
    roles: {},
    strategies: {},
    settings: {
      default_strategy: 'default',
      agent_timeout: 30,
      commit_style: 'one-commit',
      work_branch_prefix: 'invoke',
      max_dispatches: maxDispatches,
    },
  }
}

describe('MetricsManager', () => {
  let testDir: string
  let metricsPath: string
  let existingBeforeExitListeners: Function[]

  beforeEach(async () => {
    existingBeforeExitListeners = process.listeners('beforeExit')
    testDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-metrics-'))
    metricsPath = path.join(testDir, '.invoke', 'metrics.json')

    await mkdir(path.join(testDir, '.invoke'), { recursive: true })
    const stateManager = new StateManager(testDir)
    await stateManager.initialize('pipeline-123')
  })

  afterEach(async () => {
    vi.restoreAllMocks()

    for (const listener of process.listeners('beforeExit')) {
      if (!existingBeforeExitListeners.includes(listener)) {
        process.off('beforeExit', listener as () => void)
      }
    }

    await rm(testDir, { recursive: true, force: true })
  })

  async function waitForMetricsCount(
    expectedCount: number,
    targetPath = metricsPath
  ): Promise<DispatchMetric[]> {
    let parsed: DispatchMetric[] = []

    await vi.waitFor(async () => {
      parsed = JSON.parse(await readFile(targetPath, 'utf-8')) as DispatchMetric[]
      expect(parsed).toHaveLength(expectedCount)
    }, { timeout: 2000 })

    return parsed
  }

  it('records metrics synchronously and reads them back from disk', async () => {
    const manager = new MetricsManager(testDir)
    const metric = createMetric()

    const result = manager.record(metric)

    expect(result).toBeUndefined()

    const writtenMetrics = await waitForMetricsCount(1)
    expect(writtenMetrics).toEqual([metric])

    const reloadedManager = new MetricsManager(testDir)
    await expect(reloadedManager.getCurrentPipelineMetrics()).resolves.toEqual([metric])
  })

  it('writes metrics to the provided session directory and uses session-scoped state', async () => {
    const sessionDir = path.join(testDir, '.invoke', 'sessions', 'session-1')
    const sessionMetricsPath = path.join(sessionDir, 'metrics.json')
    const sessionStateManager = new StateManager(testDir, sessionDir)
    await sessionStateManager.initialize('session-pipeline-456')

    const manager = new MetricsManager(testDir, sessionDir)
    const metric = createMetric({
      pipeline_id: 'session-pipeline-456',
      started_at: '2026-04-04T12:03:00.000Z',
    })

    manager.record(metric)

    const writtenMetrics = await waitForMetricsCount(1, sessionMetricsPath)
    expect(writtenMetrics).toEqual([metric])
    expect(existsSync(metricsPath)).toBe(false)

    const reloadedManager = new MetricsManager(testDir, sessionDir)
    await expect(reloadedManager.getCurrentPipelineMetrics()).resolves.toEqual([metric])
  })

  it('filters current pipeline metrics by stage', async () => {
    const manager = new MetricsManager(testDir)

    manager.record(createMetric({ stage: 'build', started_at: '2026-04-04T12:00:00.000Z' }))
    manager.record(createMetric({ stage: 'review', started_at: '2026-04-04T12:01:00.000Z' }))
    manager.record(createMetric({ pipeline_id: 'pipeline-999', stage: 'build', started_at: '2026-04-04T12:02:00.000Z' }))

    await waitForMetricsCount(3)

    await expect(manager.getCurrentPipelineMetrics()).resolves.toHaveLength(2)
    await expect(manager.getCurrentPipelineMetrics({ stage: 'review' })).resolves.toEqual([
      createMetric({ stage: 'review', started_at: '2026-04-04T12:01:00.000Z' }),
    ])
  })

  it('computes summary totals and breakdowns', async () => {
    const manager = new MetricsManager(testDir)

    manager.record(
      createMetric({
        stage: 'build',
        provider: 'claude',
        model: 'opus-4.6',
        prompt_size_chars: 100,
        duration_ms: 200,
        estimated_cost_usd: 0.05,
        started_at: '2026-04-04T12:00:00.000Z',
      })
    )
    manager.record(
      createMetric({
        stage: 'build',
        provider: 'codex',
        model: 'gpt-5',
        prompt_size_chars: 150,
        duration_ms: 300,
        estimated_cost_usd: 0.1,
        started_at: '2026-04-04T12:01:00.000Z',
      })
    )
    manager.record(
      createMetric({
        stage: 'review',
        provider: 'claude',
        model: 'opus-4.6',
        prompt_size_chars: 50,
        duration_ms: 400,
        started_at: '2026-04-04T12:02:00.000Z',
      })
    )
    manager.record(
      createMetric({
        pipeline_id: 'pipeline-999',
        stage: 'build',
        prompt_size_chars: 999,
        duration_ms: 999,
        started_at: '2026-04-04T12:03:00.000Z',
      })
    )

    await waitForMetricsCount(4)

    await expect(manager.getSummary()).resolves.toEqual({
      total_dispatches: 3,
      total_prompt_chars: 300,
      total_duration_ms: 900,
      total_estimated_cost_usd: 0.15,
      by_stage: {
        build: { dispatches: 2, duration_ms: 500, prompt_chars: 250, estimated_cost_usd: 0.15 },
        review: { dispatches: 1, duration_ms: 400, prompt_chars: 50, estimated_cost_usd: 0 },
      },
      by_provider_model: {
        'claude:opus-4.6': {
          dispatches: 2,
          duration_ms: 600,
          prompt_chars: 150,
          estimated_cost_usd: 0.05,
        },
        'codex:gpt-5': {
          dispatches: 1,
          duration_ms: 300,
          prompt_chars: 150,
          estimated_cost_usd: 0.1,
        },
      },
    })

    await expect(manager.getSummary({ stage: 'build' })).resolves.toEqual({
      total_dispatches: 2,
      total_prompt_chars: 250,
      total_duration_ms: 500,
      total_estimated_cost_usd: 0.15,
      by_stage: {
        build: { dispatches: 2, duration_ms: 500, prompt_chars: 250, estimated_cost_usd: 0.15 },
      },
      by_provider_model: {
        'claude:opus-4.6': {
          dispatches: 1,
          duration_ms: 200,
          prompt_chars: 100,
          estimated_cost_usd: 0.05,
        },
        'codex:gpt-5': {
          dispatches: 1,
          duration_ms: 300,
          prompt_chars: 150,
          estimated_cost_usd: 0.1,
        },
      },
    })
  })

  it('serializes concurrent record calls without corrupting the metrics file', async () => {
    const manager = new MetricsManager(testDir)

    for (let i = 0; i < 25; i++) {
      manager.record(
        createMetric({
          stage: i % 2 === 0 ? 'build' : 'review',
          subrole: `worker-${i}`,
          prompt_size_chars: i + 1,
          duration_ms: (i + 1) * 10,
          started_at: `2026-04-04T12:${String(i).padStart(2, '0')}:00.000Z`,
        })
      )
    }

    const metrics = await waitForMetricsCount(25)
    expect(new Set(metrics.map(metric => metric.subrole))).toHaveLength(25)

    const files = await readdir(path.join(testDir, '.invoke'))
    expect(files.filter(file => file.endsWith('.tmp'))).toHaveLength(0)
  })

  it('only ensures the metrics directory on the first write', async () => {
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

      const { MetricsManager: MockedMetricsManager } = await import('../../src/metrics/manager.js')
      const manager = new MockedMetricsManager(testDir)

      manager.record(createMetric({ started_at: '2026-04-04T12:10:00.000Z' }))
      manager.record(createMetric({ stage: 'review', started_at: '2026-04-04T12:11:00.000Z' }))

      await waitForMetricsCount(2)

      expect(mkdirSpy).toHaveBeenCalledTimes(1)
      expect(mkdirSpy).toHaveBeenCalledWith(path.join(testDir, '.invoke'), { recursive: true })
    } finally {
      vi.doUnmock('fs/promises')
      vi.resetModules()
    }
  })

  it('catches write errors, logs them, and keeps record synchronous', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const manager = new MetricsManager(testDir)
    const writeAtomicSpy = vi
      .spyOn(manager as any, 'writeAtomic')
      .mockRejectedValueOnce(new Error('disk full'))

    expect(() => {
      manager.record(createMetric())
    }).not.toThrow()

    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('disk full'))
    }, { timeout: 2000 })

    writeAtomicSpy.mockRestore()

    manager.record(createMetric({ started_at: '2026-04-04T12:01:00.000Z' }))

    const metrics = await waitForMetricsCount(2)
    expect(metrics).toHaveLength(2)
  })

  it('flushes pending writes on beforeExit', async () => {
    let releaseWrite: (() => void) | null = null
    const manager = new MetricsManager(testDir)
    const writeAtomic = (manager as any).writeAtomic.bind(manager)
    const flushSpy = vi.spyOn(manager as any, 'flushPendingWrites')

    vi.spyOn(manager as any, 'writeAtomic').mockImplementationOnce(async (...args) => {
      await new Promise<void>(resolve => {
        releaseWrite = resolve
      })
      return writeAtomic(...args)
    })

    manager.record(createMetric())
    await vi.waitFor(() => {
      expect(releaseWrite).not.toBeNull()
    }, { timeout: 2000 })

    process.emit('beforeExit', 0)
    expect(flushSpy).toHaveBeenCalled()
    releaseWrite?.()

    const metrics = await waitForMetricsCount(1)
    expect(metrics).toHaveLength(1)
  })

  it('reports dispatch limit status for the current pipeline', async () => {
    const manager = new MetricsManager(testDir)

    manager.record(createMetric({ started_at: '2026-04-04T12:00:00.000Z' }))
    manager.record(createMetric({ started_at: '2026-04-04T12:01:00.000Z' }))
    manager.record(createMetric({ pipeline_id: 'pipeline-999', started_at: '2026-04-04T12:02:00.000Z' }))

    await waitForMetricsCount(3)

    await expect(manager.getLimitStatus(createConfig(2))).resolves.toEqual({
      dispatches_used: 2,
      max_dispatches: 2,
      at_limit: true,
    })

    await expect(manager.getLimitStatus(createConfig(3))).resolves.toEqual({
      dispatches_used: 2,
      max_dispatches: 3,
      at_limit: false,
    })
  })
})
