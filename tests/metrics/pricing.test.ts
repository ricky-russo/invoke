import { describe, expect, it } from 'vitest'
import {
  MODEL_PRICING,
  charsToTokens,
  estimateCost,
  getKnownModels,
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

  it('estimates cost for known models', () => {
    expect(estimateCost('gpt-5.4', 400, 800)).toEqual({
      input_tokens: 100,
      output_tokens: 200,
      cost_usd: 0.0018,
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
