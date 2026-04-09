import { describe, expect, it } from 'vitest'
import { formatPriorFindingsForBuilder } from '../../src/dispatch/prior-findings.js'
import type { ReviewCycle } from '../../src/types.js'

function createCycleWithAcceptedFindings(accepted: NonNullable<ReviewCycle['triaged']>['accepted']): ReviewCycle {
  return {
    id: 1,
    reviewers: ['reviewer'],
    findings: [],
    triaged: {
      accepted,
      dismissed: [],
    },
  }
}

describe('formatPriorFindingsForBuilder', () => {
  it('returns an empty string for an undefined cycle', () => {
    expect(formatPriorFindingsForBuilder(undefined)).toBe('')
  })

  it('returns an empty string when triaged is missing', () => {
    const cycle: ReviewCycle = {
      id: 1,
      reviewers: ['reviewer'],
      findings: [],
    }

    expect(formatPriorFindingsForBuilder(cycle)).toBe('')
  })

  it('returns an empty string when triaged.accepted is empty', () => {
    const cycle: ReviewCycle = {
      id: 1,
      reviewers: ['reviewer'],
      findings: [],
      triaged: {
        accepted: [],
        dismissed: [],
      },
    }

    expect(formatPriorFindingsForBuilder(cycle)).toBe('')
  })

  it('formats a single in-scope finding as one numbered block', () => {
    const cycle: ReviewCycle = {
      id: 1,
      reviewers: ['reviewer'],
      findings: [],
      triaged: {
        accepted: [
          {
            issue: 'Null pointer dereference remains reachable from the parser entrypoint',
            severity: 'high',
            file: 'src/parser.ts',
            line: 42,
            suggestion: 'Guard the nullable branch before dereferencing the node',
          },
        ],
        dismissed: [],
      },
    }

    expect(formatPriorFindingsForBuilder(cycle)).toBe(
      '1. [HIGH] src/parser.ts:42 — Null pointer dereference remains reachable from the parser entrypoint\n' +
      '   Fix: Guard the nullable branch before dereferencing the node'
    )
  })

  it('keeps multiple findings in input order and uppercases severities', () => {
    const cycle: ReviewCycle = {
      id: 1,
      reviewers: ['reviewer'],
      findings: [],
      triaged: {
        accepted: [
          {
            issue: 'Critical auth bypass in token verification',
            severity: 'high',
            file: 'src/auth.ts',
            line: 10,
            suggestion: 'Reject unsigned tokens before claim parsing',
          },
          {
            issue: 'Pagination endpoint allocates an unbounded array',
            severity: 'medium',
            file: 'src/api.ts',
            line: 88,
            suggestion: 'Apply the configured page-size cap before allocation',
          },
          {
            issue: 'Unused branch keeps dead code around',
            severity: 'low',
            file: 'src/ui.ts',
            line: 5,
            suggestion: 'Remove the branch and its unreachable helper',
          },
        ],
        dismissed: [],
      },
    }

    expect(formatPriorFindingsForBuilder(cycle)).toBe(
      '1. [HIGH] src/auth.ts:10 — Critical auth bypass in token verification\n' +
      '   Fix: Reject unsigned tokens before claim parsing\n' +
      '2. [MEDIUM] src/api.ts:88 — Pagination endpoint allocates an unbounded array\n' +
      '   Fix: Apply the configured page-size cap before allocation\n' +
      '3. [LOW] src/ui.ts:5 — Unused branch keeps dead code around\n' +
      '   Fix: Remove the branch and its unreachable helper'
    )
  })

  it('returns an empty string when all accepted findings are out of scope', () => {
    const cycle: ReviewCycle = {
      id: 1,
      reviewers: ['reviewer'],
      findings: [],
      triaged: {
        accepted: [
          {
            issue: 'Known style issue',
            severity: 'low',
            file: 'src/style.ts',
            suggestion: 'Ignore',
            out_of_scope: true,
          },
        ],
        dismissed: [],
      },
    }

    expect(formatPriorFindingsForBuilder(cycle)).toBe('')
  })

  it('filters out-of-scope findings and renumbers the remaining checklist contiguously', () => {
    const cycle: ReviewCycle = {
      id: 1,
      reviewers: ['reviewer'],
      findings: [],
      triaged: {
        accepted: [
          {
            issue: 'First accepted finding',
            severity: 'medium',
            file: 'src/keep-a.ts',
            line: 3,
            suggestion: 'Apply fix A',
          },
          {
            issue: 'Should not appear',
            severity: 'high',
            file: 'src/skip.ts',
            line: 9,
            suggestion: 'Skip this',
            out_of_scope: true,
          },
          {
            issue: 'Second accepted finding',
            severity: 'low',
            file: 'src/keep-b.ts',
            line: 7,
            suggestion: 'Apply fix B',
          },
        ],
        dismissed: [],
      },
    }

    expect(formatPriorFindingsForBuilder(cycle)).toBe(
      '1. [MEDIUM] src/keep-a.ts:3 — First accepted finding\n' +
      '   Fix: Apply fix A\n' +
      '2. [LOW] src/keep-b.ts:7 — Second accepted finding\n' +
      '   Fix: Apply fix B'
    )
  })

  it('renders the file without a colon when line is missing', () => {
    const cycle: ReviewCycle = {
      id: 1,
      reviewers: ['reviewer'],
      findings: [],
      triaged: {
        accepted: [
          {
            issue: 'Configuration drift between environments',
            severity: 'medium',
            file: 'config/runtime.json',
            suggestion: 'Normalize the generated config before writing it',
          },
        ],
        dismissed: [],
      },
    }

    expect(formatPriorFindingsForBuilder(cycle)).toBe(
      '1. [MEDIUM] config/runtime.json — Configuration drift between environments\n' +
      '   Fix: Normalize the generated config before writing it'
    )
  })

  it('limits the checklist to 20 entries and appends an overflow marker', () => {
    const cycle: ReviewCycle = {
      id: 1,
      reviewers: ['reviewer'],
      findings: [],
      triaged: {
        accepted: Array.from({ length: 25 }, (_, index) => ({
          issue: `Issue ${index + 1}`,
          severity: 'low' as const,
          file: `src/file-${index + 1}.ts`,
          line: index + 1,
          suggestion: `Fix ${index + 1}`,
        })),
        dismissed: [],
      },
    }

    const result = formatPriorFindingsForBuilder(cycle)

    expect(result).toContain('1. [LOW] src/file-1.ts:1 — Issue 1')
    expect(result).toContain('20. [LOW] src/file-20.ts:20 — Issue 20')
    expect(result).not.toContain('21. [LOW] src/file-21.ts:21 — Issue 21')
    expect(result.endsWith(
      '(5 more prior findings truncated — review the delta diff for full context)'
    )).toBe(true)
  })

  it('truncates pathologically long content at the character cap and reports the remaining count', () => {
    const cycle: ReviewCycle = {
      id: 1,
      reviewers: ['reviewer'],
      findings: [],
      triaged: {
        accepted: [
          {
            issue: 'A'.repeat(4100),
            severity: 'high',
            file: 'src/too-long.ts',
            line: 12,
            suggestion: 'Short fix',
          },
        ],
        dismissed: [],
      },
    }

    expect(formatPriorFindingsForBuilder(cycle)).toBe(
      '(1 more prior findings truncated — review the delta diff for full context)'
    )
  })

  it('reserves space for the overflow marker when truncation happens near the 4000 character cap', () => {
    const cycle = createCycleWithAcceptedFindings(
      Array.from({ length: 5 }, (_, index) => ({
        issue: 'I'.repeat(925),
        severity: 'low' as const,
        file: `src/file-${index + 1}.ts`,
        line: index + 1,
        suggestion: 'S'.repeat(20),
      }))
    )

    const result = formatPriorFindingsForBuilder(cycle)

    expect(result).toContain('truncated — review the delta diff for full context')
    expect(result.length).toBeLessThanOrEqual(4000)
  })

  it('does not append the overflow marker when all accepted findings fit under the cap', () => {
    const cycle = createCycleWithAcceptedFindings(
      Array.from({ length: 5 }, (_, index) => ({
        issue: `Small issue ${index + 1}`,
        severity: 'medium' as const,
        file: `src/small-${index + 1}.ts`,
        line: index + 1,
        suggestion: `Small fix ${index + 1}`,
      }))
    )

    const result = formatPriorFindingsForBuilder(cycle)

    expect(result.length).toBeLessThan(4000)
    expect(result).not.toContain('truncated — review the delta diff for full context')
  })

  it('ignores dismissed and deferred findings when accepted findings are present', () => {
    const cycle: ReviewCycle = {
      id: 1,
      reviewers: ['reviewer'],
      findings: [],
      triaged: {
        accepted: [
          {
            issue: 'Accepted issue',
            severity: 'medium',
            file: 'src/accepted.ts',
            line: 4,
            suggestion: 'Fix accepted issue',
          },
        ],
        dismissed: [
          {
            issue: 'Dismissed issue',
            severity: 'high',
            file: 'src/dismissed.ts',
            line: 5,
            suggestion: 'Should not appear',
          },
        ],
        deferred: [
          {
            issue: 'Deferred issue',
            severity: 'low',
            file: 'src/deferred.ts',
            line: 6,
            suggestion: 'Should not appear either',
          },
        ],
      },
    }

    const result = formatPriorFindingsForBuilder(cycle)

    expect(result).toBe(
      '1. [MEDIUM] src/accepted.ts:4 — Accepted issue\n' +
      '   Fix: Fix accepted issue'
    )
    expect(result).not.toContain('Dismissed issue')
    expect(result).not.toContain('Deferred issue')
  })

  it('renders critical severity in uppercase', () => {
    const cycle: ReviewCycle = {
      id: 1,
      reviewers: ['reviewer'],
      findings: [],
      triaged: {
        accepted: [
          {
            issue: 'Remote code execution path',
            severity: 'critical',
            file: 'src/runtime.ts',
            line: 99,
            suggestion: 'Remove dynamic evaluation from the request path',
          },
        ],
        dismissed: [],
      },
    }

    expect(formatPriorFindingsForBuilder(cycle)).toBe(
      '1. [CRITICAL] src/runtime.ts:99 — Remote code execution path\n' +
      '   Fix: Remove dynamic evaluation from the request path'
    )
  })
})
