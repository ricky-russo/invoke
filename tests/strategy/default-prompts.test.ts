import { describe, expect, it } from 'vitest'
import { readFile } from 'fs/promises'
import path from 'path'

const STRATEGY_DIR = path.join(import.meta.dirname, '..', '..', 'defaults', 'strategies')

interface StrategyExpectation {
  file: string
  title: string
  enforcement: string
  antiPatterns: string[]
  preservedText: string[]
}

const STRATEGIES: StrategyExpectation[] = [
  {
    file: 'tdd.md',
    title: '# Test-Driven Development Strategy',
    enforcement: 'If you write implementation code before a failing test exists, you are violating this strategy. STOP and write the test first. The cycle is RED (failing test) → GREEN (minimum code to pass) → REFACTOR → REPEAT.',
    antiPatterns: [
      'DO NOT write tests after implementation and claim TDD.',
      'DO NOT write tests that verify implementation details instead of behavior.',
      'DO NOT skip the refactor step.',
    ],
    preservedText: [
      'Follow the TDD cycle strictly:',
      '- Never write implementation code without a failing test first.',
    ],
  },
  {
    file: 'implementation-first.md',
    title: '# Implementation-First Strategy',
    enforcement: 'Implement first, but tests are NOT optional. You must write tests before marking the task complete.',
    antiPatterns: [
      'DO NOT skip tests entirely.',
      'DO NOT leave test writing for later.',
      'DO NOT write only happy-path tests.',
    ],
    preservedText: [
      '1. **Implement** — Build the feature to meet all acceptance criteria. Focus on correctness and clarity.',
      '- Implement the full feature before writing tests.',
    ],
  },
  {
    file: 'prototype.md',
    title: '# Prototype Strategy',
    enforcement: 'Speed over quality. Hardcode values, skip error handling, focus on the happy path. Mark everything as prototype/spike.',
    antiPatterns: [
      'DO NOT optimize prematurely.',
      'DO NOT add configuration for hypothetical future needs.',
      'DO NOT write tests (this is a spike).',
    ],
    preservedText: [
      '1. **Build fast** — Get a working version as quickly as possible. Skip tests, skip edge cases, skip error handling.',
      '- No tests required. This is a spike.',
    ],
  },
  {
    file: 'bug-fix.md',
    title: '# Bug-Fix Strategy',
    enforcement: 'Write a failing test that reproduces the bug FIRST. Then fix the root cause, not the symptom.',
    antiPatterns: [
      'DO NOT fix symptoms without understanding root cause.',
      'DO NOT expand scope to related improvements.',
      'DO NOT modify tests to make them pass instead of fixing the code.',
    ],
    preservedText: [
      '1. **Reproduce** — Write a failing test that demonstrates the bug. The test should pass once the bug is fixed.',
      '- Always write the failing test before attempting a fix.',
    ],
  },
]

function extractSection(content: string, header: string): string {
  const sectionMatch = content.match(new RegExp(`## ${header}\\n\\n([\\s\\S]*?)(?=\\n## |$)`))
  return sectionMatch?.[1].trim() ?? ''
}

describe('default strategy prompts', () => {
  for (const strategy of STRATEGIES) {
    it(`keeps ${strategy.file} instructions and adds stronger enforcement`, async () => {
      const content = await readFile(path.join(STRATEGY_DIR, strategy.file), 'utf-8')
      const antiPatternSection = extractSection(content, 'Anti-Patterns')
      const antiPatternMatches = antiPatternSection.match(/^- DO NOT .+/gm) ?? []

      expect(content).toContain(strategy.title)
      expect(content).toContain('## Enforcement')
      expect(content).toContain(strategy.enforcement)
      expect(content).toContain('## Anti-Patterns')
      expect(antiPatternMatches.length).toBeGreaterThanOrEqual(3)

      for (const antiPattern of strategy.antiPatterns) {
        expect(antiPatternSection).toContain(antiPattern)
      }

      for (const preservedText of strategy.preservedText) {
        expect(content).toContain(preservedText)
      }
    })
  }
})
