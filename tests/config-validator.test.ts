import { describe, it, expect } from 'vitest'
import { isValidModelForProvider } from '../src/config-validator.js'

// ---------------------------------------------------------------------------
// Task 1: isValidModelForProvider
// ---------------------------------------------------------------------------

describe('isValidModelForProvider', () => {
  describe('claude provider', () => {
    it('accepts claude-opus-4-6', () => {
      expect(isValidModelForProvider('claude', 'claude-opus-4-6')).toBe(true)
    })

    it('accepts claude-sonnet-4-6', () => {
      expect(isValidModelForProvider('claude', 'claude-sonnet-4-6')).toBe(true)
    })

    it('accepts claude-haiku-4-5-20251001', () => {
      expect(isValidModelForProvider('claude', 'claude-haiku-4-5-20251001')).toBe(true)
    })

    it('accepts opus (short alias)', () => {
      expect(isValidModelForProvider('claude', 'opus')).toBe(true)
    })

    it('accepts sonnet (short alias)', () => {
      expect(isValidModelForProvider('claude', 'sonnet')).toBe(true)
    })

    it('accepts haiku (short alias)', () => {
      expect(isValidModelForProvider('claude', 'haiku')).toBe(true)
    })

    it('rejects opus-4.6 (missing claude- prefix)', () => {
      expect(isValidModelForProvider('claude', 'opus-4.6')).toBe(false)
    })

    it('rejects gpt-4 (wrong provider pattern)', () => {
      expect(isValidModelForProvider('claude', 'gpt-4')).toBe(false)
    })

    it('rejects "claude opus" (space not allowed)', () => {
      expect(isValidModelForProvider('claude', 'claude opus')).toBe(false)
    })
  })

  describe('codex provider', () => {
    it('accepts o3', () => {
      expect(isValidModelForProvider('codex', 'o3')).toBe(true)
    })

    it('accepts o4-mini', () => {
      expect(isValidModelForProvider('codex', 'o4-mini')).toBe(true)
    })

    it('accepts gpt-4o', () => {
      expect(isValidModelForProvider('codex', 'gpt-4o')).toBe(true)
    })

    it('accepts gpt-4.1', () => {
      expect(isValidModelForProvider('codex', 'gpt-4.1')).toBe(true)
    })

    it('accepts codex-mini', () => {
      expect(isValidModelForProvider('codex', 'codex-mini')).toBe(true)
    })

    it('rejects opus-4.6 (claude model)', () => {
      expect(isValidModelForProvider('codex', 'opus-4.6')).toBe(false)
    })

    it('rejects claude-sonnet-4-6 (wrong provider)', () => {
      expect(isValidModelForProvider('codex', 'claude-sonnet-4-6')).toBe(false)
    })
  })

  describe('unknown provider', () => {
    it('accepts any model string for unknown provider', () => {
      expect(isValidModelForProvider('some-future-provider', 'any-model-name')).toBe(true)
    })
  })
})
