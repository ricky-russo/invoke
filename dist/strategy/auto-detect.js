const STRATEGY_PATTERNS = [
    {
        keywords: ['bug', 'fix', 'broken', 'regression', 'error', 'crash', 'issue'],
        strategy: 'bug-fix',
        description: 'Task description suggests a bug fix',
    },
    {
        keywords: ['prototype', 'spike', 'poc', 'proof of concept', 'experiment', 'hack'],
        strategy: 'prototype',
        description: 'Task description suggests a prototype',
    },
    {
        keywords: ['refactor', 'clean up', 'restructure', 'reorganize', 'simplify'],
        strategy: 'implementation-first',
        description: 'Task description suggests implementation-first work',
    },
];
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function matchesKeyword(text, keyword) {
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(keyword)}([^a-z0-9]|$)`, 'i');
    return pattern.test(text);
}
export function autoDetectStrategy(text) {
    for (const pattern of STRATEGY_PATTERNS) {
        const matchedKeywords = pattern.keywords.filter((keyword) => matchesKeyword(text, keyword));
        if (matchedKeywords.length === 0) {
            continue;
        }
        return {
            strategy: pattern.strategy,
            confidence: matchedKeywords.length >= 2 ? 'high' : 'medium',
            reason: `${pattern.description} (matched: ${matchedKeywords.join(', ')})`,
        };
    }
    return {
        strategy: 'tdd',
        confidence: 'low',
        reason: 'Default strategy — no strong pattern detected',
    };
}
//# sourceMappingURL=auto-detect.js.map