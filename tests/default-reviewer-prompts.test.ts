import { describe, it, expect } from 'vitest'
import { readFile } from 'fs/promises'
import path from 'path'

type ReviewerPromptExpectation = {
  file: string
  nothingFound: string
  antiPatterns: string[]
  preservedCoreText: string[]
}

const REVIEWER_PROMPTS: ReviewerPromptExpectation[] = [
  {
    file: 'spec-compliance.md',
    nothingFound: 'If no spec compliance issues found, output exactly: No spec compliance issues found. Do not pad with praise or caveats.',
    antiPatterns: [
      'DO NOT flag missing features that the spec explicitly marks as out-of-scope, deferred, or future work.',
      'DO NOT flag code quality, naming, refactoring, or style issues.',
      'DO NOT invent implied requirements that are not written in the spec.',
    ],
    preservedCoreText: [
      'Your job is to catch hallucinated features, missing requirements, and scope drift.',
      'Be strict. The spec is the source of truth. If it\'s not in the spec, it shouldn\'t be in the code.',
    ],
  },
  {
    file: 'security.md',
    nothingFound: 'If no security issues found, output exactly: No security issues found. Do not pad with praise or caveats.',
    antiPatterns: [
      'DO NOT flag theoretical risks that lack a concrete exploit path in the reviewed code.',
      'DO NOT flag code quality, maintainability, or style issues.',
      'DO NOT cite vague "security best practices" when the issue is not aligned to a real vulnerability class such as the OWASP Top 10.',
    ],
    preservedCoreText: [
      'You are reviewing code for security vulnerabilities.',
      'Be precise. Only report real vulnerabilities, not hypothetical concerns.',
    ],
  },
  {
    file: 'code-quality.md',
    nothingFound: 'If no quality issues found, output exactly: No quality issues found. Do not pad with praise or caveats.',
    antiPatterns: [
      'DO NOT flag style or formatting issues; the linter or formatter handles those.',
      'DO NOT suggest complete rewrites when a targeted fix suffices.',
      'DO NOT report speculative cleanup opportunities with no concrete correctness, maintainability, or testing impact.',
    ],
    preservedCoreText: [
      'You are reviewing code for quality, maintainability, and correctness.',
      'Focus on issues that matter. Don\'t nitpick formatting or style preferences.',
    ],
  },
  {
    file: 'performance.md',
    nothingFound: 'If no performance issues found, output exactly: No performance issues found. Do not pad with praise or caveats.',
    antiPatterns: [
      'DO NOT flag micro-optimizations with negligible user or system impact.',
      'DO NOT flag algorithmic complexity concerns when the input is clearly tiny or fixed-size.',
      'DO NOT recommend caching, memoization, batching, or concurrency without evidence of a real bottleneck or hot path.',
    ],
    preservedCoreText: [
      'You are reviewing code for performance issues.',
      'Only flag real performance issues, not micro-optimizations. Consider the actual scale and context.',
    ],
  },
  {
    file: 'ux.md',
    nothingFound: 'If no UX issues found, output exactly: No UX issues found. Do not pad with praise or caveats.',
    antiPatterns: [
      'DO NOT flag aesthetic preferences such as color taste, spacing taste, or visual style choices that do not affect usability.',
      'DO NOT flag copy tone preferences unless the text is unclear, misleading, or blocks task completion.',
      'DO NOT invent edge cases or personas that are unsupported by the product context or code.',
    ],
    preservedCoreText: [
      'You are reviewing code for user experience issues.',
      'Focus on issues that affect real users. Consider the context and typical usage patterns.',
    ],
  },
  {
    file: 'accessibility.md',
    nothingFound: 'If no accessibility issues found, output exactly: No accessibility issues found. Do not pad with praise or caveats.',
    antiPatterns: [
      'DO NOT omit the WCAG 2.1 conformance level from a finding when citing an accessibility issue.',
      'DO NOT flag aesthetic preferences that are unrelated to accessibility outcomes.',
      'DO NOT speculate about contrast, announcements, focus order, or screen reader behavior without evidence in the reviewed code.',
    ],
    preservedCoreText: [
      'You are reviewing code for accessibility issues.',
      'Reference WCAG guidelines where applicable (e.g., WCAG 2.1 SC 1.4.3 for contrast).',
    ],
  },
]

describe('default reviewer prompts', () => {
  it.each(REVIEWER_PROMPTS)('includes guardrails, anti-patterns, few-shot examples, and nothing-found handling in $file', async ({ file, nothingFound, antiPatterns, preservedCoreText }) => {
    const promptPath = path.join(import.meta.dirname, '..', 'plugin', 'defaults', 'roles', 'reviewer', file)
    const content = await readFile(promptPath, 'utf-8')

    expect(content).toContain('## Behavioral Guardrails')
    expect(content).toContain('## Project Context')
    expect(content).toContain('You MUST NOT flag issues outside your specialty scope — other reviewers handle those areas. Cross-scope flagging creates noise.')
    expect(content).toContain('## Anti-Patterns')
    expect(content).toContain('## Few-Shot Example')
    expect(content).toContain('## Nothing Found')
    expect(content).toContain('### Finding 1')
    expect(content).toContain('**Severity:**')
    expect(content).toContain('**File:**')
    expect(content).toContain('**Line:**')
    expect(content).toContain('**Issue:**')
    expect(content).toContain('**Suggestion:**')
    expect(content).toContain('## Scope')
    expect(content).toContain('{{project_context}}')
    expect(content).toContain('{{scope}}')
    expect(content).toContain('## Prior Findings')
    expect(content).toContain('{{prior_findings}}')
    expect(content).toContain('**Out-of-Scope:**')
    // Anti-prompt-injection sentinel wrappers around untrusted template content
    expect(content).toContain('{{scope_delim_start}}')
    expect(content).toContain('{{scope_delim_end}}')
    expect(content).toContain('{{diff_delim_start}}')
    expect(content).toContain('{{diff_delim_end}}')
    expect(content).toContain('{{project_context_delim_start}}')
    expect(content).toContain('{{project_context_delim_end}}')
    expect(content).toContain('{{prior_findings_delim_start}}')
    expect(content).toContain('{{prior_findings_delim_end}}')
    expect(content).toContain('untrusted data')
    expect(content).toContain(nothingFound)

    for (const antiPattern of antiPatterns) {
      expect(content).toContain(antiPattern)
    }

    for (const line of preservedCoreText) {
      expect(content).toContain(line)
    }

    const doNotMatches = content.match(/^- DO NOT /gm) ?? []
    expect(doNotMatches.length).toBeGreaterThanOrEqual(3)
  })

  // Drift guard: the runtime reviewer dispatch path reads from .invoke/roles/reviewer/,
  // not defaults/. If the .invoke/ tree drifts from defaults/, this dogfeeding repo's
  // reviews silently regress on every change. This test asserts byte-for-byte equality
  // between the two trees so any drift breaks CI immediately.
  it.each(REVIEWER_PROMPTS)('.invoke/ reviewer prompt is byte-for-byte identical to defaults/: $file', async ({ file }) => {
    const defaultsPath = path.join(import.meta.dirname, '..', 'plugin', 'defaults', 'roles', 'reviewer', file)
    const invokePath = path.join(import.meta.dirname, '..', '.invoke', 'roles', 'reviewer', file)
    const defaultsContent = await readFile(defaultsPath, 'utf-8')
    const invokeContent = await readFile(invokePath, 'utf-8')
    expect(invokeContent).toBe(defaultsContent)
  })
})
