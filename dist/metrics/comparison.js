const COST_PRECISION = 1_000_000_000;
export function compareSessions(sessionMetrics, sessionSummaries) {
    const sessions = Array.from(sessionMetrics.entries(), ([sessionId, metrics]) => summarizeSession(sessionId, metrics, sessionSummaries?.get(sessionId)));
    return {
        sessions,
        delta: sessions.length === 2 ? createDelta(sessions[0], sessions[1]) : null,
    };
}
export function formatComparisonTable(comparison) {
    const lines = [
        '| Session | Dispatches | Success Rate | Duration | Prompt Chars | Est. Cost |',
        '| --- | ---: | ---: | ---: | ---: | ---: |',
        ...comparison.sessions.map(session => formatStandardRow(session.session_id, session.total_dispatches.toString(), formatSuccessRate(session.success_rate), session.total_duration_ms.toString(), session.total_prompt_chars.toString(), formatCost(session.total_estimated_cost_usd))),
    ];
    if (comparison.delta) {
        lines.push(formatDeltaRow(comparison.sessions[0], comparison.sessions[1], comparison.delta));
    }
    return lines.join('\n');
}
function summarizeSession(sessionId, metrics, metricsSummary) {
    let successfulDispatches = 0;
    const summary = {
        session_id: sessionId,
        total_dispatches: metricsSummary?.total_dispatches ?? metrics.length,
        success_rate: 0,
        total_duration_ms: metricsSummary?.total_duration_ms ?? 0,
        total_prompt_chars: metricsSummary?.total_prompt_chars ?? 0,
        total_estimated_cost_usd: metricsSummary?.total_estimated_cost_usd ?? 0,
        by_stage: cloneBreakdown(metricsSummary?.by_stage),
        by_provider_model: cloneBreakdown(metricsSummary?.by_provider_model),
    };
    for (const metric of metrics) {
        if (metric.status === 'success') {
            successfulDispatches += 1;
        }
        if (metricsSummary) {
            continue;
        }
        const cost = normalizeCost(metric.estimated_cost_usd ?? 0);
        summary.total_duration_ms += metric.duration_ms;
        summary.total_prompt_chars += metric.prompt_size_chars;
        summary.total_estimated_cost_usd = normalizeCost(summary.total_estimated_cost_usd + cost);
        const stageSummary = summary.by_stage[metric.stage] ?? {
            dispatches: 0,
            duration_ms: 0,
            prompt_chars: 0,
            estimated_cost_usd: 0,
        };
        stageSummary.dispatches += 1;
        stageSummary.duration_ms += metric.duration_ms;
        stageSummary.prompt_chars += metric.prompt_size_chars;
        stageSummary.estimated_cost_usd = normalizeCost(stageSummary.estimated_cost_usd + cost);
        summary.by_stage[metric.stage] = stageSummary;
        const providerModelKey = `${metric.provider}:${metric.model}`;
        const providerModelSummary = summary.by_provider_model[providerModelKey] ?? {
            dispatches: 0,
            duration_ms: 0,
            prompt_chars: 0,
            estimated_cost_usd: 0,
        };
        providerModelSummary.dispatches += 1;
        providerModelSummary.duration_ms += metric.duration_ms;
        providerModelSummary.prompt_chars += metric.prompt_size_chars;
        providerModelSummary.estimated_cost_usd = normalizeCost(providerModelSummary.estimated_cost_usd + cost);
        summary.by_provider_model[providerModelKey] = providerModelSummary;
    }
    summary.success_rate =
        summary.total_dispatches === 0 ? 0 : successfulDispatches / summary.total_dispatches;
    return summary;
}
function cloneBreakdown(breakdown) {
    if (!breakdown) {
        return {};
    }
    return Object.fromEntries(Object.entries(breakdown).map(([key, value]) => [
        key,
        {
            dispatches: value.dispatches,
            duration_ms: value.duration_ms,
            prompt_chars: value.prompt_chars,
            estimated_cost_usd: normalizeCost(value.estimated_cost_usd),
        },
    ]));
}
function createDelta(sessionA, sessionB) {
    return {
        dispatches: sessionB.total_dispatches - sessionA.total_dispatches,
        dispatches_percentage: formatPercentageChange(sessionA.total_dispatches, sessionB.total_dispatches),
        duration_ms: sessionB.total_duration_ms - sessionA.total_duration_ms,
        duration_ms_percentage: formatPercentageChange(sessionA.total_duration_ms, sessionB.total_duration_ms),
        prompt_chars: sessionB.total_prompt_chars - sessionA.total_prompt_chars,
        prompt_chars_percentage: formatPercentageChange(sessionA.total_prompt_chars, sessionB.total_prompt_chars),
        estimated_cost_usd: normalizeCost(sessionB.total_estimated_cost_usd - sessionA.total_estimated_cost_usd),
        estimated_cost_usd_percentage: formatPercentageChange(sessionA.total_estimated_cost_usd, sessionB.total_estimated_cost_usd),
    };
}
function formatStandardRow(label, dispatches, successRate, durationMs, promptChars, estimatedCostUsd) {
    return `| ${escapeTableCell(label)} | ${dispatches} | ${successRate} | ${durationMs} | ${promptChars} | ${estimatedCostUsd} |`;
}
function formatDeltaRow(sessionA, sessionB, delta) {
    return formatStandardRow('Delta', formatDeltaValue(delta.dispatches.toString(), delta.dispatches_percentage), formatDeltaValue(formatSuccessRateDelta(sessionA.success_rate, sessionB.success_rate), formatPercentageChange(sessionA.success_rate, sessionB.success_rate)), formatDeltaValue(delta.duration_ms.toString(), delta.duration_ms_percentage), formatDeltaValue(delta.prompt_chars.toString(), delta.prompt_chars_percentage), formatDeltaValue(formatCost(delta.estimated_cost_usd), delta.estimated_cost_usd_percentage));
}
function escapeTableCell(value) {
    return value.replaceAll('|', '\\|');
}
function formatCost(value) {
    const normalized = normalizeCost(value);
    if (Number.isInteger(normalized)) {
        return normalized.toString();
    }
    return normalized.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}
function normalizeCost(value) {
    return Math.round(value * COST_PRECISION) / COST_PRECISION;
}
function formatSuccessRate(value) {
    return `${(value * 100).toFixed(1)}%`;
}
function formatSuccessRateDelta(a, b) {
    const deltaPoints = (b - a) * 100;
    const normalizedDeltaPoints = Math.abs(deltaPoints) < 0.05 ? 0 : deltaPoints;
    return `${normalizedDeltaPoints.toFixed(1)} pts`;
}
function formatDeltaValue(value, percentage) {
    return `${value} (${percentage})`;
}
function formatPercentageChange(a, b) {
    if (a === 0) {
        return b === 0 ? '0.0%' : 'N/A';
    }
    return `${(((b - a) / a) * 100).toFixed(1)}%`;
}
//# sourceMappingURL=comparison.js.map