import { describe, it, expect } from 'vitest'
import { mergeFindings } from '../../src/dispatch/merge-findings.js'
import type { Finding } from '../../src/types.js'

describe('mergeFindings', () => {
  it('deduplicates identical findings from multiple providers', () => {
    const findingsA: Finding[] = [
      { issue: 'SQL injection vulnerability', severity: 'high', file: 'src/db.ts', line: 42, suggestion: 'Use parameterized queries' },
    ]
    const findingsB: Finding[] = [
      { issue: 'SQL injection vulnerability', severity: 'high', file: 'src/db.ts', line: 42, suggestion: 'Use prepared statements' },
    ]

    const merged = mergeFindings([
      { provider: 'claude', findings: findingsA },
      { provider: 'codex', findings: findingsB },
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0].agreedBy).toEqual(['claude', 'codex'])
    expect(merged[0].file).toBe('src/db.ts')
    expect(merged[0].line).toBe(42)
  })

  it('keeps unique findings from different providers', () => {
    const findingsA: Finding[] = [
      { issue: 'XSS in template', severity: 'high', file: 'src/view.ts', line: 10, suggestion: 'Escape output' },
    ]
    const findingsB: Finding[] = [
      { issue: 'Memory leak in cache', severity: 'medium', file: 'src/cache.ts', line: 55, suggestion: 'Add eviction' },
    ]

    const merged = mergeFindings([
      { provider: 'claude', findings: findingsA },
      { provider: 'codex', findings: findingsB },
    ])

    expect(merged).toHaveLength(2)
    expect(merged[0].agreedBy).toEqual(['claude'])
    expect(merged[1].agreedBy).toEqual(['codex'])
  })

  it('matches findings by file and high word overlap in issue text', () => {
    const findingsA: Finding[] = [
      { issue: 'Unsanitized user input passed to SQL query', severity: 'high', file: 'src/db.ts', suggestion: 'Sanitize input' },
    ]
    const findingsB: Finding[] = [
      { issue: 'User input is not sanitized before SQL query execution', severity: 'high', file: 'src/db.ts', suggestion: 'Use parameterized queries' },
    ]

    const merged = mergeFindings([
      { provider: 'claude', findings: findingsA },
      { provider: 'codex', findings: findingsB },
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0].agreedBy).toEqual(['claude', 'codex'])
  })

  it('does not match findings in different files', () => {
    const findingsA: Finding[] = [
      { issue: 'SQL injection', severity: 'high', file: 'src/db.ts', line: 42, suggestion: 'Fix it' },
    ]
    const findingsB: Finding[] = [
      { issue: 'SQL injection', severity: 'high', file: 'src/other.ts', line: 42, suggestion: 'Fix it' },
    ]

    const merged = mergeFindings([
      { provider: 'claude', findings: findingsA },
      { provider: 'codex', findings: findingsB },
    ])

    expect(merged).toHaveLength(2)
  })

  it('sorts by severity then by agreement count', () => {
    const findingsA: Finding[] = [
      { issue: 'Low issue', severity: 'low', file: 'a.ts', suggestion: 'Fix' },
      { issue: 'Critical issue', severity: 'critical', file: 'b.ts', suggestion: 'Fix' },
    ]
    const findingsB: Finding[] = [
      { issue: 'Critical issue', severity: 'critical', file: 'b.ts', suggestion: 'Fix' },
      { issue: 'Medium issue', severity: 'medium', file: 'c.ts', suggestion: 'Fix' },
    ]

    const merged = mergeFindings([
      { provider: 'claude', findings: findingsA },
      { provider: 'codex', findings: findingsB },
    ])

    expect(merged[0].severity).toBe('critical')
    expect(merged[0].agreedBy).toEqual(['claude', 'codex'])
    expect(merged[1].severity).toBe('medium')
    expect(merged[2].severity).toBe('low')
  })

  it('handles single provider input', () => {
    const findings: Finding[] = [
      { issue: 'Bug', severity: 'high', file: 'src/a.ts', suggestion: 'Fix' },
    ]

    const merged = mergeFindings([
      { provider: 'claude', findings },
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0].agreedBy).toEqual(['claude'])
  })

  it('handles empty findings', () => {
    const merged = mergeFindings([
      { provider: 'claude', findings: [] },
      { provider: 'codex', findings: [] },
    ])

    expect(merged).toHaveLength(0)
  })
})
