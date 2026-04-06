import { describe, it, expect } from 'vitest'
import { ClaudeParser } from '../../src/parsers/claude-parser.js'

describe('ClaudeParser', () => {
  const parser = new ClaudeParser()

  it('parses successful output into AgentResult', () => {
    const output = 'Here is my analysis of the codebase.\n\nThe auth module uses JWT tokens stored in HttpOnly cookies.'

    const result = parser.parse(output, 0, {
      role: 'researcher',
      subrole: 'codebase',
      provider: 'claude',
      model: 'opus-4.6',
      duration: 12000,
    })

    expect(result.status).toBe('success')
    expect(result.role).toBe('researcher')
    expect(result.subrole).toBe('codebase')
    expect(result.output.summary).toBeTruthy()
    expect(result.output.report).toBe(output)
    expect(result.output.raw).toBe(output)
    expect(result.duration).toBe(12000)
  })

  it('preserves full report output for non-researcher roles', () => {
    const output = 'Implemented the parser fix and updated the tests.'

    const result = parser.parse(output, 0, {
      role: 'builder',
      subrole: 'default',
      provider: 'claude',
      model: 'opus-4.6',
      duration: 8000,
    })

    expect(result.status).toBe('success')
    expect(result.output.report).toBe(output)
    expect(result.output.findings).toBeUndefined()
    expect(result.output.raw).toBe(output)
  })

  it('parses non-zero exit code as error', () => {
    const result = parser.parse('Something went wrong', 1, {
      role: 'builder',
      subrole: 'default',
      provider: 'claude',
      model: 'opus-4.6',
      duration: 5000,
    })

    expect(result.status).toBe('error')
    expect(result.output.raw).toBe('Something went wrong')
  })

  it('extracts findings from reviewer output', () => {
    const output = `## Security Review

### Finding 1
**Severity:** high
**File:** src/auth/token.ts
**Line:** 42
**Issue:** SQL injection vulnerability in query parameter
**Suggestion:** Use parameterized queries instead of string concatenation

### Finding 2
**Severity:** medium
**File:** src/auth/session.ts
**Line:** 15
**Issue:** Session token stored in localStorage
**Suggestion:** Use HttpOnly cookies for session storage`

    const result = parser.parse(output, 0, {
      role: 'reviewer',
      subrole: 'security',
      provider: 'claude',
      model: 'opus-4.6',
      duration: 30000,
    })

    expect(result.status).toBe('success')
    expect(result.output.findings).toHaveLength(2)
    expect(result.output.report).toBe(output)
    expect(result.output.findings![0].severity).toBe('high')
    expect(result.output.findings![0].file).toBe('src/auth/token.ts')
    expect(result.output.findings![0].line).toBe(42)
    expect(result.output.findings![1].severity).toBe('medium')
  })

  it('returns raw output when findings cannot be parsed', () => {
    const output = 'Everything looks good, no issues found.'

    const result = parser.parse(output, 0, {
      role: 'reviewer',
      subrole: 'security',
      provider: 'claude',
      model: 'opus-4.6',
      duration: 10000,
    })

    expect(result.status).toBe('success')
    expect(result.output.findings).toEqual([])
    expect(result.output.report).toBe(output)
    expect(result.output.raw).toBe(output)
  })
})
