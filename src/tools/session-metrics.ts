import { readFile } from 'fs/promises'
import path from 'path'
import type { MetricsManager } from '../metrics/manager.js'
import type { DispatchMetric } from '../types.js'

type SessionMetricsOptions = {
  stage?: string
}

type SessionMetricsReader = Pick<MetricsManager, 'getMetricsByPipelineId'>

export async function getSessionScopedMetrics(
  metricsManager: SessionMetricsReader,
  pipelineId: string | null,
  sessionDir: string,
  options?: SessionMetricsOptions
): Promise<DispatchMetric[]> {
  if (pipelineId === null) {
    return []
  }

  const rootEntries = await metricsManager.getMetricsByPipelineId(pipelineId, options)
  if (rootEntries.length > 0) {
    return rootEntries
  }

  // Migration fallback path: older sessions may still carry metrics.json in the
  // session directory until legacy files are cleaned up.
  const legacyEntries = await readLegacySessionMetrics(sessionDir)
  return filterSessionMetrics(legacyEntries, pipelineId, options)
}

async function readLegacySessionMetrics(sessionDir: string): Promise<DispatchMetric[]> {
  const metricsPath = path.join(sessionDir, 'metrics.json')

  try {
    const content = await readFile(metricsPath, 'utf-8')
    const parsed = JSON.parse(content) as unknown

    if (!Array.isArray(parsed)) {
      throw new Error(`Invalid metrics payload in ${metricsPath}`)
    }

    return parsed as DispatchMetric[]
  } catch (error) {
    if (isMissingFileError(error)) {
      return []
    }

    throw error
  }
}

function filterSessionMetrics(
  metrics: DispatchMetric[],
  pipelineId: string,
  options?: SessionMetricsOptions
): DispatchMetric[] {
  return metrics.filter(metric => {
    if (metric.pipeline_id !== pipelineId) {
      return false
    }

    if (options?.stage && metric.stage !== options.stage) {
      return false
    }

    return true
  })
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
