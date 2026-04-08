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
    expect(result.output.raw).toBe(output)
    expect(result.duration).toBe(12000)
  })

  it('preserves full raw output for non-researcher roles', () => {
    const output = 'Implemented the parser fix and updated the tests.'

    const result = parser.parse(output, 0, {
      role: 'builder',
      subrole: 'default',
      provider: 'claude',
      model: 'opus-4.6',
      duration: 8000,
    })

    expect(result.status).toBe('success')
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
    expect(result.output.findings![0].severity).toBe('high')
    expect(result.output.findings![0].file).toBe('src/auth/token.ts')
    expect(result.output.findings![0].line).toBe(42)
    expect(result.output.findings![1].severity).toBe('medium')
  })

  it('extracts out_of_scope from **Out-of-Scope:** field', () => {
    const output = `## Security Review

### Finding 1
**Severity:** low
**File:** src/auth/token.ts
**Line:** 42
**Issue:** Missing input validation
**Suggestion:** Validate the token input before processing
**Out-of-Scope:** no

### Finding 2
**Severity:** high
**File:** src/auth/session.ts
**Line:** 15
**Issue:** Session token stored in localStorage
**Suggestion:** Use HttpOnly cookies for session storage
**Out-of-Scope:** yes

### Finding 3
**Severity:** medium
**File:** src/auth/cache.ts
**Line:** 8
**Issue:** Cache key uses predictable data
**Suggestion:** Add a server-side secret to the cache key`

    const result = parser.parse(output, 0, {
      role: 'reviewer',
      subrole: 'security',
      provider: 'claude',
      model: 'opus-4.6',
      duration: 30000,
    })

    const findings = result.output.findings as Array<{ out_of_scope?: boolean }>

    expect(findings).toHaveLength(3)
    expect(findings[0].out_of_scope).toBe(false)
    expect(findings[1].out_of_scope).toBe(true)
    // Reviewer omitted the field — parser preserves undefined to distinguish
    // "reviewer said in-scope" (false) from "reviewer didn't say" (undefined)
    expect(findings[2].out_of_scope).toBeUndefined()
  })

  it('treats **Out-of-Scope:** case-insensitively and trims whitespace', () => {
    const output = `## Security Review

### Finding 1
**Severity:** low
**File:** src/auth/token.ts
**Line:** 42
**Issue:** Missing input validation
**Suggestion:** Validate the token input before processing
**Out-of-Scope:** YES

### Finding 2
**Severity:** medium
**File:** src/auth/session.ts
**Line:** 15
**Issue:** Session token stored in localStorage
**Suggestion:** Use HttpOnly cookies for session storage
**Out-of-Scope:** Yes

### Finding 3
**Severity:** high
**File:** src/auth/cache.ts
**Line:** 8
**Issue:** Cache key uses predictable data
**Suggestion:** Add a server-side secret to the cache key
**Out-of-Scope:**  yes   `

    const result = parser.parse(output, 0, {
      role: 'reviewer',
      subrole: 'security',
      provider: 'claude',
      model: 'opus-4.6',
      duration: 30000,
    })

    const findings = result.output.findings as Array<{ out_of_scope?: boolean }>

    expect(findings).toHaveLength(3)
    expect(findings[0].out_of_scope).toBe(true)
    expect(findings[1].out_of_scope).toBe(true)
    expect(findings[2].out_of_scope).toBe(true)
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
    expect(result.output.raw).toBe(output)
  })
})
