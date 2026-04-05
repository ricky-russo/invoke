import type { StrategyDetection } from '../types.js'

interface StrategyPattern {
  keywords: string[]
  strategy: StrategyDetection['strategy']
  description: string
}

const STRATEGY_PATTERNS: StrategyPattern[] = [
  {
    keywords: ['bug', 'fix', 'broken', 'regression', 'error', 'crash', 'issue'],
    strategy: 'bug-fix',
    description: 'Task description suggests a bug fix',
  },
  {
    keywords: ['prototype', 'spike', 'poc', 'proof of concept', 'experiment', 'hack'],
    strategy: 'prototype',
    description: 'Task description suggests a prototype',
  },
  {
    keywords: ['refactor', 'clean up', 'restructure', 'reorganize', 'simplify'],
    strategy: 'implementation-first',
    description: 'Task description suggests implementation-first work',
  },
]

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function matchesKeyword(text: string, keyword: string): boolean {
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(keyword)}([^a-z0-9]|$)`, 'i')
  return pattern.test(text)
}

export function autoDetectStrategy(text: string): StrategyDetection {
  for (const pattern of STRATEGY_PATTERNS) {
    const matchedKeywords = pattern.keywords.filter((keyword) => matchesKeyword(text, keyword))

    if (matchedKeywords.length === 0) {
      continue
    }

    return {
      strategy: pattern.strategy,
      confidence: matchedKeywords.length >= 2 ? 'high' : 'medium',
      reason: `${pattern.description} (matched: ${matchedKeywords.join(', ')})`,
    }
  }

  return {
    strategy: 'tdd',
    confidence: 'low',
    reason: 'Default strategy — no strong pattern detected',
  }
}
