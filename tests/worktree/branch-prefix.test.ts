import { describe, expect, it } from 'vitest'
import {
  buildWorkBranch,
  validateWorkBranchPrefix,
} from '../../src/worktree/branch-prefix.js'

describe('validateWorkBranchPrefix', () => {
  it.each([
    'invoke/work',
    'work',
    'foo.bar/baz',
    'a-b_c',
  ])('accepts valid prefix %s', prefix => {
    expect(() => validateWorkBranchPrefix(prefix)).not.toThrow()
  })

  it.each([
    'invoke work',
    'invoke@work',
    'invoke#work',
    'invoke?work',
  ])('throws for invalid characters in %s', prefix => {
    expect(() => validateWorkBranchPrefix(prefix)).toThrow(
      /may only contain letters, numbers, dots, underscores, dashes, and slashes/i
    )
  })

  it('throws for an empty prefix', () => {
    expect(() => validateWorkBranchPrefix('')).toThrow(/must not be empty/i)
  })

  it('throws for a leading slash', () => {
    expect(() => validateWorkBranchPrefix('/invoke/work')).toThrow(
      /must not start or end with/i
    )
  })

  it('throws for a trailing slash', () => {
    expect(() => validateWorkBranchPrefix('invoke/work/')).toThrow(
      /must not start or end with/i
    )
  })
})

describe('buildWorkBranch', () => {
  it('composes the branch from prefix and session id', () => {
    expect(buildWorkBranch('invoke/work', 'session-123')).toBe(
      'invoke/work/session-123'
    )
  })
})
