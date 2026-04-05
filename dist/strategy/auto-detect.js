function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function createKeywordPattern(keyword) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(keyword)}([^a-z0-9]|$)`, 'i');
}
const STRATEGY_PATTERNS = [
    {
        keywords: ['fix', 'bug', 'regression', 'broken'],
        strategy: 'bug-fix',
        description: 'Task description suggests a bug fix',
        matchers: ['fix', 'bug', 'regression', 'broken'].map(keyword => ({
            keyword,
            pattern: createKeywordPattern(keyword),
        })),
    },
    {
        keywords: ['prototype', 'spike', 'mvp', 'quickly', 'urgent'],
        strategy: 'prototype',
        description: 'Task description suggests a prototype',
        matchers: ['prototype', 'spike', 'mvp', 'quickly', 'urgent'].map(keyword => ({
            keyword,
            pattern: createKeywordPattern(keyword),
        })),
    },
];
const TEST_MENTION_PATTERN = createKeywordPattern('test');
const TEST_FILE_PATTERNS = [
    /(^|[/\\])__tests__([/\\]|$)/i,
    /(^|[/\\])tests?([/\\]|$)/i,
    /\.test\.[^/\\]+$/i,
    /\.spec\.[^/\\]+$/i,
];
function hasExistingTestFiles(existingFiles) {
    return existingFiles.some(filePath => TEST_FILE_PATTERNS.some(pattern => pattern.test(filePath)));
}
export function autoDetectStrategy(text, options = {}) {
    for (const pattern of STRATEGY_PATTERNS) {
        const matchedKeywords = pattern.matchers
            .filter(({ pattern: keywordPattern }) => keywordPattern.test(text))
            .map(({ keyword }) => keyword);
        if (matchedKeywords.length === 0) {
            continue;
        }
        return {
            strategy: pattern.strategy,
            confidence: matchedKeywords.length >= 2 ? 'high' : 'medium',
            reason: `${pattern.description} (matched: ${matchedKeywords.join(', ')})`,
        };
    }
    if (TEST_MENTION_PATTERN.test(text) && hasExistingTestFiles(options.existingFiles ?? [])) {
        return {
            strategy: 'tdd',
            confidence: 'medium',
            reason: 'Task mentions tests and existing test files were detected',
        };
    }
    return {
        strategy: 'tdd',
        confidence: 'low',
        reason: 'Default strategy — no strong pattern detected',
    };
}
//# sourceMappingURL=auto-detect.js.map