const SEVERITY_ORDER = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
};
export function mergeFindings(providerResults) {
    const merged = [];
    for (const { provider, findings } of providerResults) {
        for (const finding of findings) {
            const match = merged.find(m => isSameFinding(m, finding));
            if (match) {
                match.agreedBy.push(provider);
                // Keep the higher severity if they disagree
                if (SEVERITY_ORDER[finding.severity] < SEVERITY_ORDER[match.severity]) {
                    match.severity = finding.severity;
                }
            }
            else {
                merged.push({
                    ...finding,
                    agreedBy: [provider],
                });
            }
        }
    }
    return merged.sort((a, b) => {
        const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
        if (sevDiff !== 0)
            return sevDiff;
        return b.agreedBy.length - a.agreedBy.length;
    });
}
function isSameFinding(a, b) {
    if (a.file !== b.file)
        return false;
    // Same file + same line = match
    if (a.line != null && b.line != null && a.line === b.line)
        return true;
    // Same file + sufficient word overlap in issue text = match
    return wordOverlap(a.issue, b.issue) > 0.3;
}
function wordOverlap(textA, textB) {
    const wordsA = new Set(textA.toLowerCase().trim().split(/\s+/));
    const wordsB = new Set(textB.toLowerCase().trim().split(/\s+/));
    let intersection = 0;
    for (const word of wordsA) {
        if (wordsB.has(word))
            intersection++;
    }
    const union = new Set([...wordsA, ...wordsB]).size;
    if (union === 0)
        return 0;
    return intersection / union;
}
//# sourceMappingURL=merge-findings.js.map