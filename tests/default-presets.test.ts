import { describe, expect, it } from 'vitest'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import path from 'path'
import { parse } from 'yaml'

const PRESETS_DIR = path.join(import.meta.dirname, '..', 'defaults', 'presets')

const expectedPresets = {
  quick: {
    name: 'quick',
    description: 'Fast pipeline preset for small changes with limited review coverage.',
    settings: {
      default_strategy: 'implementation-first',
      max_review_cycles: 1,
      max_parallel_agents: 2,
    },
    reviewer_selection: ['spec-compliance', 'security'],
    strategy_selection: ['implementation-first', 'bug-fix'],
  },
  thorough: {
    name: 'thorough',
    description: 'Full pipeline preset with maximum review and strategy coverage.',
    settings: {
      default_strategy: 'tdd',
      max_review_cycles: 5,
    },
    reviewer_selection: [
      'spec-compliance',
      'security',
      'code-quality',
      'performance',
      'ux',
      'accessibility',
    ],
    strategy_selection: ['tdd', 'implementation-first', 'bug-fix'],
  },
  prototype: {
    name: 'prototype',
    description: 'Rapid iteration preset with minimal review overhead.',
    settings: {
      default_strategy: 'prototype',
      max_review_cycles: 0,
    },
    reviewer_selection: [],
    strategy_selection: ['prototype'],
  },
} as const

describe('default pipeline presets', () => {
  it('includes the presets directory', () => {
    expect(existsSync(PRESETS_DIR)).toBe(true)
  })

  for (const [presetName, expectedPreset] of Object.entries(expectedPresets)) {
    it(`defines ${presetName}.yaml as a valid preset config`, async () => {
      const raw = await readFile(path.join(PRESETS_DIR, `${presetName}.yaml`), 'utf-8')
      const parsed = parse(raw)

      expect(parsed).toEqual(expectedPreset)
    })
  }
})
