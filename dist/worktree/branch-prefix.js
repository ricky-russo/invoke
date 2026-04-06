const WORK_BRANCH_PREFIX_PATTERN = /^[A-Za-z0-9._/-]+$/;
export function validateWorkBranchPrefix(prefix) {
    if (prefix.length === 0) {
        throw new Error('Work branch prefix must not be empty.');
    }
    if (!WORK_BRANCH_PREFIX_PATTERN.test(prefix)) {
        throw new Error('Work branch prefix may only contain letters, numbers, dots, underscores, dashes, and slashes.');
    }
    if (prefix.startsWith('/') || prefix.endsWith('/')) {
        throw new Error("Work branch prefix must not start or end with '/'.");
    }
}
export function buildWorkBranch(prefix, sessionId) {
    validateWorkBranchPrefix(prefix);
    return `${prefix}/${sessionId}`;
}
//# sourceMappingURL=branch-prefix.js.map