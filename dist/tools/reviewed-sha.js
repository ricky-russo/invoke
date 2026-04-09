export const REVIEWED_SHA_PATTERN = /^[0-9a-f]{7,40}$/;
export function sanitizeReviewedSha(value) {
    return typeof value === 'string' && REVIEWED_SHA_PATTERN.test(value) ? value : undefined;
}
//# sourceMappingURL=reviewed-sha.js.map