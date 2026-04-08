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
    expect(result.output.raw).toBe(output)
  })

  it('preserves full raw output for non-researcher roles', () => {
    const output = 'Updated the batch behavior to keep the full builder response.'

    const result = parser.parse(output, 0, {
      role: 'builder',
      subrole: 'default',
      provider: 'codex',
      model: 'gpt-5.4',
      duration: 4000,
    })

    expect(result.status).toBe('success')
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
    expect(result.output.findings![0].severity).toBe('critical')
    expect(result.output.findings![1].line).toBeUndefined()
  })

  it('extracts out_of_scope from **Out-of-Scope:** field', () => {
    const output = `## Security Review

### Finding 1
**Severity:** critical
**File:** src/db/query.ts
**Line:** 88
**Issue:** Unsanitized user input in SQL query
**Suggestion:** Use prepared statements
**Out-of-Scope:** no

### Finding 2
**Severity:** high
**File:** src/auth/session.ts
**Line:** 24
**Issue:** Session token is logged in plaintext
**Suggestion:** Remove token values from logs
**Out-of-Scope:** yes

### Finding 3
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
    expect(result.output.findings).toHaveLength(3)
    expect(result.output.findings![0].out_of_scope).toBe(false)
    expect(result.output.findings![1].out_of_scope).toBe(true)
    // Reviewer omitted the field — parser preserves undefined to distinguish
    // "reviewer said in-scope" (false) from "reviewer didn't say" (undefined)
    expect(result.output.findings![2].out_of_scope).toBeUndefined()
  })

  it('treats **Out-of-Scope:** case-insensitively and trims whitespace', () => {
    const output = `## Security Review

### Finding 1
**Severity:** critical
**File:** src/db/query.ts
**Line:** 88
**Issue:** Unsanitized user input in SQL query
**Suggestion:** Use prepared statements
**Out-of-Scope:** YES

### Finding 2
**Severity:** high
**File:** src/auth/session.ts
**Line:** 24
**Issue:** Session token is logged in plaintext
**Suggestion:** Remove token values from logs
**Out-of-Scope:**   yEs   

### Finding 3
**Severity:** low
**File:** src/utils/log.ts
**Issue:** Sensitive data in log output
**Suggestion:** Redact PII before logging
**Out-of-Scope:** Yes`

    const result = parser.parse(output, 0, {
      role: 'reviewer',
      subrole: 'security',
      provider: 'codex',
      model: 'gpt-5.4',
      duration: 25000,
    })

    expect(result.status).toBe('success')
    expect(result.output.findings).toHaveLength(3)
    expect(result.output.findings![0].out_of_scope).toBe(true)
    expect(result.output.findings![1].out_of_scope).toBe(true)
    expect(result.output.findings![2].out_of_scope).toBe(true)
  })
})
