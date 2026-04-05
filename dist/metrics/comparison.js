const COST_PRECISION = 1_000_000_000;
export function compareSessions(sessionMetrics) {
    const sessions = Array.from(sessionMetrics.entries(), ([sessionId, metrics]) => summarizeSession(sessionId, metrics));
    return {
        sessions,
        delta: sessions.length === 2 ? createDelta(sessions[0], sessions[1]) : null,
    };
}
export function formatComparisonTable(comparison) {
    const lines = [
        '| Session | Dispatches | Duration | Prompt Chars | Est. Cost |',
        '| --- | ---: | ---: | ---: | ---: |',
        ...comparison.sessions.map(session => formatRow(session.session_id, session.total_dispatches, session.total_duration_ms, session.total_prompt_chars, session.total_estimated_cost_usd)),
    ];
    if (comparison.delta) {
        lines.push(formatRow('Delta', comparison.delta.dispatches, comparison.delta.duration_ms, comparison.delta.prompt_chars, comparison.delta.estimated_cost_usd));
    }
    return lines.join('\n');
}
function summarizeSession(sessionId, metrics) {
    let successfulDispatches = 0;
    const summary = {
        session_id: sessionId,
        total_dispatches: metrics.length,
        success_rate: 0,
        total_duration_ms: 0,
        total_prompt_chars: 0,
        total_estimated_cost_usd: 0,
        by_stage: {},
        by_provider_model: {},
    };
    for (const metric of metrics) {
        const cost = normalizeCost(metric.estimated_cost_usd ?? 0);
        if (metric.status === 'success') {
            successfulDispatches += 1;
        }
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
function formatRow(label, dispatches, durationMs, promptChars, estimatedCostUsd) {
    return `| ${escapeTableCell(label)} | ${dispatches} | ${durationMs} | ${promptChars} | ${formatCost(estimatedCostUsd)} |`;
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
function formatPercentageChange(a, b) {
    return `${(((b - a) / a) * 100).toFixed(1)}%`;
}
//# sourceMappingURL=comparison.js.map