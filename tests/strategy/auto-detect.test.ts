import { describe, expect, it } from 'vitest'
import { autoDetectStrategy } from '../../src/strategy/auto-detect.js'

describe('autoDetectStrategy', () => {
  it('detects bug-fix with high confidence when multiple bug keywords match', () => {
    const result = autoDetectStrategy('fix the login bug')

    expect(result).toMatchObject({
      strategy: 'bug-fix',
      confidence: 'high',
    })
    expect(result.reason).toContain('bug')
    expect(result.reason).toContain('fix')
  })

  it('detects prototype with medium confidence when one prototype keyword matches', () => {
    expect(autoDetectStrategy('prototype the new dashboard')).toEqual({
      strategy: 'prototype',
      confidence: 'medium',
      reason: 'Task description suggests a prototype (matched: prototype)',
    })
  })

  it('defaults to tdd with low confidence when no keywords match', () => {
    expect(autoDetectStrategy('add user authentication')).toEqual({
      strategy: 'tdd',
      confidence: 'low',
      reason: 'Default strategy — no strong pattern detected',
    })
  })

  it('detects implementation-first with high confidence for refactor-oriented work', () => {
    expect(autoDetectStrategy('refactor and simplify the auth module')).toEqual({
      strategy: 'implementation-first',
      confidence: 'high',
      reason: 'Task description suggests implementation-first work (matched: refactor, simplify)',
    })
  })

  it('matches keywords case-insensitively', () => {
    expect(autoDetectStrategy('CRASH when saving profile')).toEqual({
      strategy: 'bug-fix',
      confidence: 'medium',
      reason: 'Task description suggests a bug fix (matched: crash)',
    })
  })
})
