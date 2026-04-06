import { describe, expect, it } from 'vitest'
import {
  validateSessionId,
  validateSessionIdForRead,
} from '../../src/worktree/session-id-validator.js'

describe('validateSessionId', () => {
  it.each([
    'session-1',
    'per-session-branches-2026-04-06',
    'pipeline-1775472260275',
    'a',
    'A1.b_c-d',
  ])(
    'accepts valid session IDs: %p',
    sessionId => {
      expect(() => validateSessionId(sessionId)).not.toThrow()
    }
  )

  it.each([
    '',
    '.',
    '..',
    'nested/path',
    'nested\\path',
    'session\n1',
    'session\u00001',
    'session*1',
    'session?1',
    '-rf',
    'a'.repeat(129),
  ])(
    'rejects invalid session IDs: %p',
    sessionId => {
      expect(() => validateSessionId(sessionId)).toThrow(`Invalid session ID: '${sessionId}'`)
    }
  )
})

describe('validateSessionIdForRead', () => {
  it.each([
    'session-1',
    'session 1',
    '.session',
    '-session',
    'foo*bar',
    'newline\nhere',
  ])(
    'accepts readable legacy session IDs: %p',
    sessionId => {
      expect(() => validateSessionIdForRead(sessionId)).not.toThrow()
    }
  )

  it.each([
    '',
    '.',
    '..',
    'nested/path',
    'nested\\path',
    'session\u0000id',
  ])(
    'rejects traversal-oriented session IDs for read paths: %p',
    sessionId => {
      expect(() => validateSessionIdForRead(sessionId)).toThrow(
        `Invalid session ID: '${sessionId}'`
      )
    }
  )
})
