import { describe, expect, it } from 'vitest'
import {
  MODEL_PRICING,
  charsToTokens,
  estimateCost,
  getKnownModels,
  normalizeModelName,
} from '../../src/metrics/pricing.js'

describe('pricing helpers', () => {
  it('contains the expected model pricing map', () => {
    expect(MODEL_PRICING).toEqual({
      'claude-opus-4-6': {
        input: 15 / 1_000_000,
        output: 75 / 1_000_000,
      },
      'claude-sonnet-4-6': {
        input: 3 / 1_000_000,
        output: 15 / 1_000_000,
      },
      'claude-haiku-4-5-20251001': {
        input: 0.8 / 1_000_000,
        output: 4 / 1_000_000,
      },
      'gpt-5.4': {
        input: 2 / 1_000_000,
        output: 8 / 1_000_000,
      },
      'gpt-4.1': {
        input: 2 / 1_000_000,
        output: 8 / 1_000_000,
      },
      'o3-mini': {
        input: 1.1 / 1_000_000,
        output: 4.4 / 1_000_000,
      },
    })
  })

  it('converts characters to tokens using a 4-char heuristic', () => {
    expect(charsToTokens(400)).toBe(100)
    expect(charsToTokens(401)).toBe(101)
  })

  it('uses a 3-char heuristic for code-heavy content', () => {
    expect(charsToTokens(300, 'code')).toBe(100)
    expect(charsToTokens(301, 'code')).toBe(101)
  })

  it('normalizes shorthand model names to their canonical names', () => {
    expect(normalizeModelName('opus-4.6')).toBe('claude-opus-4-6')
    expect(normalizeModelName('sonnet-4.6')).toBe('claude-sonnet-4-6')
    expect(normalizeModelName('gpt-4.1')).toBe('gpt-4.1')
  })

  it('estimates cost for known models', () => {
    expect(estimateCost('gpt-5.4', 400, 800)).toEqual({
      input_tokens: 100,
      output_tokens: 200,
      cost_usd: 0.0018,
    })
  })

  it('estimates cost for shorthand model names and code-heavy content', () => {
    expect(estimateCost('sonnet-4.6', 300, 600, 'code')).toEqual({
      input_tokens: 100,
      output_tokens: 200,
      cost_usd: 0.0033,
    })
  })

  it('rounds cost to 6 decimal places', () => {
    expect(estimateCost('claude-haiku-4-5-20251001', 1, 1)).toEqual({
      input_tokens: 1,
      output_tokens: 1,
      cost_usd: 0.000005,
    })
  })

  it('returns null for unknown models', () => {
    expect(estimateCost('unknown-model', 400, 800)).toBeNull()
  })

  it('returns the known model names', () => {
    expect(getKnownModels()).toEqual(Object.keys(MODEL_PRICING))
  })
})
