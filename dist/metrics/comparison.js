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
    const summary = {
        session_id: sessionId,
        total_dispatches: metrics.length,
        total_duration_ms: 0,
        total_prompt_chars: 0,
        total_estimated_cost_usd: 0,
        by_stage: {},
    };
    for (const metric of metrics) {
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
    }
    return summary;
}
function createDelta(sessionA, sessionB) {
    return {
        dispatches: sessionB.total_dispatches - sessionA.total_dispatches,
        duration_ms: sessionB.total_duration_ms - sessionA.total_duration_ms,
        prompt_chars: sessionB.total_prompt_chars - sessionA.total_prompt_chars,
        estimated_cost_usd: normalizeCost(sessionB.total_estimated_cost_usd - sessionA.total_estimated_cost_usd),
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
//# sourceMappingURL=comparison.js.map