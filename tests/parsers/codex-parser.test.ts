import { describe, it, expect } from 'vitest'
import { CodexParser } from '../../src/parsers/codex-parser.js'

describe('CodexParser', () => {
  const parser = new CodexParser()

  it('parses successful output into AgentResult', () => {
    const output = 'Analysis complete. The codebase follows RESTful patterns.'

    const result = parser.parse(output, 0, {
      role: 'researcher',
      subrole: 'codebase',
      provider: 'codex',
      model: 'gpt-5.4',
      duration: 15000,
    })

    expect(result.status).toBe('success')
    expect(result.provider).toBe('codex')
    expect(result.output.report).toBe(output)
    expect(result.output.raw).toBe(output)
  })

  it('preserves full report output for non-researcher roles', () => {
    const output = 'Updated the batch behavior to keep the full builder response.'

    const result = parser.parse(output, 0, {
      role: 'builder',
      subrole: 'default',
      provider: 'codex',
      model: 'gpt-5.4',
      duration: 4000,
    })

    expect(result.status).toBe('success')
    expect(result.output.report).toBe(output)
    expect(result.output.findings).toBeUndefined()
    expect(result.output.raw).toBe(output)
  })

  it('parses non-zero exit code as error', () => {
    const result = parser.parse('Error occurred', 1, {
      role: 'builder',
      subrole: 'default',
      provider: 'codex',
      model: 'gpt-5.4',
      duration: 2000,
    })

    expect(result.status).toBe('error')
  })

  it('extracts findings from reviewer output', () => {
    const output = `## Security Review

### Finding 1
**Severity:** critical
**File:** src/db/query.ts
**Line:** 88
**Issue:** Unsanitized user input in SQL query
**Suggestion:** Use prepared statements

### Finding 2
**Severity:** low
**File:** src/utils/log.ts
**Issue:** Sensitive data in log output
**Suggestion:** Redact PII before logging`

    const result = parser.parse(output, 0, {
      role: 'reviewer',
      subrole: 'security',
      provider: 'codex',
      model: 'gpt-5.4',
      duration: 25000,
    })

    expect(result.status).toBe('success')
    expect(result.output.findings).toHaveLength(2)
    expect(result.output.report).toBe(output)
    expect(result.output.findings![0].severity).toBe('critical')
    expect(result.output.findings![1].line).toBeUndefined()
  })
})
