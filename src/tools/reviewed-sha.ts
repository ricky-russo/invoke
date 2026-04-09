export const REVIEWED_SHA_PATTERN: RegExp = /^[0-9a-f]{7,40}$/

export function sanitizeReviewedSha(value: unknown): string | undefined {
  return typeof value === 'string' && REVIEWED_SHA_PATTERN.test(value) ? value : undefined
}
