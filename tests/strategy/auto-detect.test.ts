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

  it('suggests tdd when the task mentions a test and test files already exist', () => {
    expect(autoDetectStrategy('add a test for the auth module', {
      existingFiles: ['src/auth.test.ts', 'src/auth.ts'],
    })).toEqual({
      strategy: 'tdd',
      confidence: 'medium',
      reason: 'Task mentions tests and existing test files were detected',
    })
  })

  it('matches keywords case-insensitively', () => {
    expect(autoDetectStrategy('BROKEN when saving profile')).toEqual({
      strategy: 'bug-fix',
      confidence: 'medium',
      reason: 'Task description suggests a bug fix (matched: broken)',
    })
  })

  it('does not treat refactor-oriented work as implementation-first', () => {
    expect(autoDetectStrategy('refactor and simplify the auth module')).toEqual({
      strategy: 'tdd',
      confidence: 'low',
      reason: 'Default strategy — no strong pattern detected',
    })
  })
})
