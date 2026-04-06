import { readFile } from 'fs/promises';
import path from 'path';
export async function getSessionScopedMetrics(metricsManager, pipelineId, sessionDir, options) {
    if (pipelineId === null) {
        return [];
    }
    const rootEntries = await metricsManager.getMetricsByPipelineId(pipelineId, options);
    if (rootEntries.length > 0) {
        return rootEntries;
    }
    // Migration fallback path: older sessions may still carry metrics.json in the
    // session directory until legacy files are cleaned up.
    const legacyEntries = await readLegacySessionMetrics(sessionDir);
    return filterSessionMetrics(legacyEntries, pipelineId, options);
}
async function readLegacySessionMetrics(sessionDir) {
    const metricsPath = path.join(sessionDir, 'metrics.json');
    try {
        const content = await readFile(metricsPath, 'utf-8');
        const parsed = JSON.parse(content);
        if (!Array.isArray(parsed)) {
            throw new Error(`Invalid metrics payload in ${metricsPath}`);
        }
        return parsed;
    }
    catch (error) {
        if (isMissingFileError(error)) {
            return [];
        }
        throw error;
    }
}
function filterSessionMetrics(metrics, pipelineId, options) {
    return metrics.filter(metric => {
        if (metric.pipeline_id !== pipelineId) {
            return false;
        }
        if (options?.stage && metric.stage !== options.stage) {
            return false;
        }
        return true;
    });
}
function isMissingFileError(error) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
//# sourceMappingURL=session-metrics.js.map