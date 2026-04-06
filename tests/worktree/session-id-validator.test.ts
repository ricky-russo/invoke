import { describe, expect, it } from 'vitest'
import { validateSessionId } from '../../src/worktree/session-id-validator.js'

describe('validateSessionId', () => {
  it.each(['session123', 'session.id', 'session-id', 'session_id'])(
    'accepts valid session IDs: %p',
    sessionId => {
      expect(() => validateSessionId(sessionId)).not.toThrow()
    }
  )

  it.each(['', '.', '..', 'nested/path', 'nested\\path'])(
    'rejects invalid session IDs: %p',
    sessionId => {
      expect(() => validateSessionId(sessionId)).toThrow(`Invalid session ID: '${sessionId}'`)
    }
  )
})
