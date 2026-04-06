import { describe, it, expect } from 'vitest'
import { createParserRegistry } from '../../src/parsers/registry.js'
import { mergeFindings } from '../../src/dispatch/merge-findings.js'

describe('Output Parsing Integration', () => {
  const parsers = createParserRegistry()

  describe('Claude parser with realistic outputs', () => {
    const claude = parsers.get('claude')!

    it('parses a multi-finding security review', () => {
      const output = `## Security Review

I've reviewed the authentication module. Here are my findings:

### Finding 1
**Severity:** critical
**File:** src/auth/login.ts
**Line:** 23
**Issue:** Password compared using === instead of constant-time comparison, vulnerable to timing attacks
**Suggestion:** Use crypto.timingSafeEqual() for password comparison

### Finding 2
**Severity:** high
**File:** src/auth/token.ts
**Line:** 45
**Issue:** JWT secret is hardcoded in the source file
**Suggestion:** Load JWT_SECRET from environment variables using process.env

### Finding 3
**Severity:** medium
**File:** src/auth/session.ts
**Line:** 12
**Issue:** Session cookies missing HttpOnly and Secure flags
**Suggestion:** Set { httpOnly: true, secure: true, sameSite: 'strict' } on cookie options

### Finding 4
**Severity:** low
**File:** src/auth/login.ts
**Line:** 78
**Issue:** Login error message reveals whether email exists in system
**Suggestion:** Use generic "Invalid credentials" message for both invalid email and password`

      const result = claude.parse(output, 0, {
        role: 'reviewer', subrole: 'security', provider: 'claude', model: 'opus-4.6', duration: 15000,
      })

      expect(result.status).toBe('success')
      expect(result.output.findings).toHaveLength(4)
      expect(result.output.findings![0].severity).toBe('critical')
      expect(result.output.findings![0].issue).toContain('timing attacks')
      expect(result.output.findings![1].severity).toBe('high')
      expect(result.output.findings![2].severity).toBe('medium')
      expect(result.output.findings![3].severity).toBe('low')
    })

    it('parses a clean review with no findings', () => {
      const output = `## Security Review

I've thoroughly reviewed the codebase and found no security vulnerabilities.

The authentication system follows best practices:
- Uses bcrypt for password hashing
- JWT tokens have appropriate expiration
- CORS is properly configured`

      const result = claude.parse(output, 0, {
        role: 'reviewer', subrole: 'security', provider: 'claude', model: 'opus-4.6', duration: 8000,
      })

      expect(result.status).toBe('success')
      expect(result.output.findings).toEqual([])
    })

    it('parses a researcher report', () => {
      const output = `# Codebase Analysis

## Architecture
The project uses a layered architecture with Express.js.

## Key Files
- src/routes/auth.ts — authentication endpoints
- src/middleware/auth.ts — JWT validation middleware
- src/models/user.ts — User model with Prisma

## Patterns
- Repository pattern for data access
- Middleware chain for request validation
- Error handling via express-async-errors`

      const result = claude.parse(output, 0, {
        role: 'researcher', subrole: 'codebase', provider: 'claude', model: 'opus-4.6', duration: 12000,
      })

      expect(result.status).toBe('success')
      expect(result.output.findings).toBeUndefined()
    })
  })

  describe('Codex parser with realistic outputs', () => {
    const codex = parsers.get('codex')!

    it('parses findings from Codex output', () => {
      const output = `## Code Quality Review

### Finding 1
**Severity:** high
**File:** src/utils/validate.ts
**Line:** 34
**Issue:** Function has cyclomatic complexity of 15, making it hard to test and maintain
**Suggestion:** Break into smaller functions, each handling one validation rule

### Finding 2
**Severity:** medium
**File:** src/api/users.ts
**Line:** 89
**Issue:** Duplicate validation logic — same email regex appears in 3 places
**Suggestion:** Extract into a shared validateEmail utility`

      const result = codex.parse(output, 0, {
        role: 'reviewer', subrole: 'code-quality', provider: 'codex', model: 'gpt-5.4', duration: 20000,
      })

      expect(result.status).toBe('success')
      expect(result.output.findings).toHaveLength(2)
      expect(result.output.findings![0].file).toBe('src/utils/validate.ts')
      expect(result.output.findings![1].issue).toContain('Duplicate validation')
    })
  })

  describe('Multi-provider merge with realistic data', () => {
    it('merges overlapping findings from Claude and Codex', () => {
      const claude = parsers.get('claude')!
      const codex = parsers.get('codex')!

      const claudeOutput = `## Review
### Finding 1
**Severity:** high
**File:** src/db/query.ts
**Line:** 42
**Issue:** SQL injection vulnerability in user search query
**Suggestion:** Use parameterized queries

### Finding 2
**Severity:** medium
**File:** src/api/handler.ts
**Line:** 15
**Issue:** Error stack traces exposed to client
**Suggestion:** Sanitize error responses in production`

      const codexOutput = `## Review
### Finding 1
**Severity:** high
**File:** src/db/query.ts
**Line:** 42
**Issue:** SQL injection in user search — unsanitized input concatenated into query string
**Suggestion:** Use prepared statements with parameter binding

### Finding 2
**Severity:** low
**File:** src/config.ts
**Line:** 5
**Issue:** Debug mode enabled by default
**Suggestion:** Set debug to false in production config`

      const claudeResult = claude.parse(claudeOutput, 0, {
        role: 'reviewer', subrole: 'security', provider: 'claude', model: 'opus-4.6', duration: 10000,
      })
      const codexResult = codex.parse(codexOutput, 0, {
        role: 'reviewer', subrole: 'security', provider: 'codex', model: 'gpt-5.4', duration: 12000,
      })

      const merged = mergeFindings([
        { provider: 'claude', findings: claudeResult.output.findings! },
        { provider: 'codex', findings: codexResult.output.findings! },
      ])

      // SQL injection should be merged (same file + same line)
      const sqlFinding = merged.find(f => f.file === 'src/db/query.ts')
      expect(sqlFinding).toBeTruthy()
      expect(sqlFinding!.agreedBy).toEqual(['claude', 'codex'])

      // Other findings should be unique
      const errorFinding = merged.find(f => f.file === 'src/api/handler.ts')
      expect(errorFinding).toBeTruthy()
      expect(errorFinding!.agreedBy).toEqual(['claude'])

      const debugFinding = merged.find(f => f.file === 'src/config.ts')
      expect(debugFinding).toBeTruthy()
      expect(debugFinding!.agreedBy).toEqual(['codex'])

      // Total: 3 unique findings (1 merged + 2 unique)
      expect(merged).toHaveLength(3)

      // Sorted: high (agreed) first, then medium, then low
      expect(merged[0].severity).toBe('high')
      expect(merged[0].agreedBy).toHaveLength(2)
    })
  })
})
