import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { composePrompt, composePromptWithNonce } from '../../src/dispatch/prompt-composer.js'
import { mkdir, writeFile, rm } from 'fs/promises'
import path from 'path'

const TEST_DIR = path.join(import.meta.dirname, 'fixtures', 'prompt-test')
const TRUNCATED_MARKER = '(truncated)'
const NONCE_DELIMITER_LINE_PATTERN = /^<<<(?:SCOPE|PRIOR_FINDINGS)_DATA_(?:START|END)_[0-9a-f]{32}>>>$/

function buildSection(header: string, content: string): string {
  return `## ${header}\n\n${content}`
}

function extractContext(result: string): string {
  return result.split('## Context\n')[1] ?? ''
}

function stripNonceDelimiterLines(result: string): string {
  return result
    .split('\n')
    .filter(line => !NONCE_DELIMITER_LINE_PATTERN.test(line))
    .join('\n')
}

beforeEach(async () => {
  await mkdir(path.join(TEST_DIR, '.invoke', 'roles', 'reviewer'), { recursive: true })
  await mkdir(path.join(TEST_DIR, '.invoke', 'roles', 'builder'), { recursive: true })
  await mkdir(path.join(TEST_DIR, '.invoke', 'roles', 'test'), { recursive: true })
  await mkdir(path.join(TEST_DIR, '.invoke', 'strategies'), { recursive: true })
  await writeFile(
    path.join(TEST_DIR, '.invoke', 'roles', 'test', 'prompt.md'),
    '# Test Role\n\n## Task\n{{task_description}}\n\n## Context\n{{project_context}}\n'
  )
})

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('composePrompt', () => {
  it('loads a role prompt and injects task context variables', async () => {
    const template = `# Security Review

## Task
{{task_description}}

## Files to Review
{{relevant_files}}

Review for OWASP top 10 vulnerabilities.`

    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'reviewer', 'security.md'),
      template
    )

    const result = await composePrompt({
      projectDir: TEST_DIR,
      promptPath: '.invoke/roles/reviewer/security.md',
      taskContext: {
        task_description: 'Review the auth module for security issues',
        relevant_files: 'src/auth/token.ts, src/auth/session.ts',
      },
    })

    expect(result).toContain('Review the auth module for security issues')
    expect(result).toContain('src/auth/token.ts, src/auth/session.ts')
    expect(result).toContain('Review for OWASP top 10 vulnerabilities.')
    expect(result).not.toContain('{{task_description}}')
    expect(result).not.toContain('{{relevant_files}}')
  })

  it('composes role prompt with strategy prompt when provided', async () => {
    const roleTemplate = `# Builder

## Task
{{task_description}}
`
    const strategyTemplate = `# TDD Strategy

## Instructions
1. Write a failing test first
2. Implement the minimum code
3. Refactor
`
    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'reviewer', 'security.md'),
      roleTemplate
    )
    await writeFile(
      path.join(TEST_DIR, '.invoke', 'strategies', 'tdd.md'),
      strategyTemplate
    )

    const result = await composePrompt({
      projectDir: TEST_DIR,
      promptPath: '.invoke/roles/reviewer/security.md',
      strategyPath: '.invoke/strategies/tdd.md',
      taskContext: {
        task_description: 'Build the token validator',
      },
    })

    expect(result).toContain('Build the token validator')
    expect(result).toContain('Write a failing test first')
  })

  it('reads absolute prompt and strategy paths without joining them to projectDir', async () => {
    const rolePath = path.join(TEST_DIR, '.invoke', 'roles', 'reviewer', 'absolute.md')
    const strategyPath = path.join(TEST_DIR, '.invoke', 'strategies', 'absolute.md')

    await writeFile(rolePath, '# Absolute Role\n\n{{task_description}}\n')
    await writeFile(strategyPath, '# Absolute Strategy\n\nUse a focused plan.\n')

    const result = await composePrompt({
      projectDir: TEST_DIR,
      promptPath: rolePath,
      strategyPath,
      taskContext: {
        task_description: 'Handle an absolute prompt path',
      },
    })

    expect(result).toContain('Handle an absolute prompt path')
    expect(result).toContain('Use a focused plan.')
  })

  it('uses a unique nonce for each dispatch while keeping the rest of the rendered prompt stable', async () => {
    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'reviewer', 'security.md'),
      `# Reviewer

## Scope
{{scope_delim_start}}
{{scope}}
{{scope_delim_end}}

## Prior Findings
{{prior_findings_delim_start}}
{{prior_findings}}
{{prior_findings_delim_end}}
`
    )

    const options = {
      projectDir: TEST_DIR,
      promptPath: '.invoke/roles/reviewer/security.md',
      taskContext: {
        scope: 'Review auth changes.',
        prior_findings: 'No prior findings.',
      },
    }

    const firstResult = await composePrompt(options)
    const secondResult = await composePrompt(options)

    expect(firstResult).not.toBe(secondResult)
    expect(stripNonceDelimiterLines(firstResult)).toBe(stripNonceDelimiterLines(secondResult))
  })

  it('leaves unmatched variables as-is', async () => {
    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'reviewer', 'security.md'),
      'Review {{task_description}} and check {{unknown_var}}'
    )

    const result = await composePrompt({
      projectDir: TEST_DIR,
      promptPath: '.invoke/roles/reviewer/security.md',
      taskContext: {
        task_description: 'the auth module',
      },
    })

    expect(result).toContain('the auth module')
    expect(result).toContain('{{unknown_var}}')
  })

  it('does not re-process placeholders inside task context values', async () => {
    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'reviewer', 'security.md'),
      'Task: {{task_description}}\nFiles: {{relevant_files}}'
    )

    const result = await composePrompt({
      projectDir: TEST_DIR,
      promptPath: '.invoke/roles/reviewer/security.md',
      taskContext: {
        task_description: 'Investigate {{relevant_files}} handling',
        relevant_files: 'src/auth/token.ts',
      },
    })

    expect(result).toContain('Task: Investigate {{relevant_files}} handling')
    expect(result).toContain('Files: src/auth/token.ts')
  })

  it('throws when prompt file is missing', async () => {
    await expect(
      composePrompt({
        projectDir: TEST_DIR,
        promptPath: '.invoke/roles/nonexistent.md',
        taskContext: {},
      })
    ).rejects.toThrow()
  })

  it('throws when scope contains the dispatch security nonce', async () => {
    const nonce = '0123456789abcdef0123456789abcdef'

    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'reviewer', 'security.md'),
      `# Reviewer

## Scope
{{scope_delim_start}}
{{scope}}
{{scope_delim_end}}
`
    )

    await expect(
      composePromptWithNonce(
        {
          projectDir: TEST_DIR,
          promptPath: '.invoke/roles/reviewer/security.md',
          taskContext: {
            scope: `Injected payload ${nonce} should be rejected.`,
            prior_findings: '',
          },
        },
        nonce
      )
    ).rejects.toThrow(
      'Refusing to dispatch reviewer: scope or prior_findings payload contains the security nonce. This is a probable prompt-injection attempt or a 1-in-2^128 collision; investigate before retrying.'
    )
  })

  it('injects project_context from context.md when available', async () => {
    await writeFile(
      path.join(TEST_DIR, '.invoke', 'context.md'),
      '# Project Context\n\n## Architecture\n\nThis is a REST API'
    )

    const result = await composePrompt({
      projectDir: TEST_DIR,
      promptPath: '.invoke/roles/test/prompt.md',
      taskContext: { task_description: 'Build feature' },
    })

    expect(result).toContain('This is a REST API')
  })

  it('filters long builder context to keep architecture and core sections', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'builder', 'default.md'),
      '# Builder\n\n## Context\n{{project_context}}\n'
    )

    const longContext = [
      '# Project Context',
      'Shared intro',
      buildSection('Purpose', 'Build an internal API gateway.'),
      buildSection('Tech Stack', 'TypeScript, Node.js, Vitest.'),
      buildSection('Conventions', 'Prefer ESM modules and descriptive names.'),
      buildSection('Constraints', 'Keep the CLI interface stable.'),
      buildSection('Architecture', 'Dispatcher, provider, and parser layers.'),
      buildSection('Completed Work', 'Completed item. ' + 'history '.repeat(700)),
      buildSection('Known Issues', 'Known issue. ' + 'issue '.repeat(700)),
    ].join('\n\n')

    await writeFile(path.join(TEST_DIR, '.invoke', 'context.md'), longContext)

    try {
      const result = await composePrompt({
        projectDir: TEST_DIR,
        promptPath: '.invoke/roles/builder/default.md',
        taskContext: { task_description: 'Implement dashboard routing' },
      })

      const context = extractContext(result)
      expect(context).toContain('## Purpose\n\nBuild an internal API gateway.')
      expect(context).toContain('## Tech Stack\n\nTypeScript, Node.js, Vitest.')
      expect(context).toContain('## Conventions\n\nPrefer ESM modules and descriptive names.')
      expect(context).toContain('## Constraints\n\nKeep the CLI interface stable.')
      expect(context).toContain('## Architecture\n\nDispatcher, provider, and parser layers.')
      expect(context).not.toContain('## Completed Work')
      expect(context).not.toContain('## Known Issues')
      expect(errorSpy).toHaveBeenCalledWith(
        '[prompt-composer] Filtered project context sections',
        {
          included: ['Purpose', 'Tech Stack', 'Conventions', 'Constraints', 'Architecture'],
          excluded: ['Completed Work', 'Known Issues'],
        }
      )
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('filters long reviewer context to keep completed work and matching sections', async () => {
    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'reviewer', 'security.md'),
      '# Reviewer\n\n## Task\n{{task_description}}\n\n## Context\n{{project_context}}\n'
    )

    const longContext = [
      '# Project Context',
      buildSection('Purpose', 'Review critical auth changes.'),
      buildSection('Tech Stack', 'TypeScript and Node.js.'),
      buildSection('Conventions', 'Use small pure helpers when possible.'),
      buildSection('Constraints', 'Do not change public API signatures.'),
      buildSection('Architecture', 'Core services are split by dispatch layer.'),
      buildSection('Completed Work', 'Delivered feature summary. ' + 'delivery '.repeat(150)),
      buildSection('Authentication', 'Auth flow details. ' + 'auth '.repeat(120)),
      buildSection('Known Issues', 'Known issue summary. ' + 'issue '.repeat(900)),
    ].join('\n\n')

    await writeFile(path.join(TEST_DIR, '.invoke', 'context.md'), longContext)

    const result = await composePrompt({
      projectDir: TEST_DIR,
      promptPath: '.invoke/roles/reviewer/security.md',
      taskContext: { task_description: 'Review authentication flow changes' },
    })

    const context = extractContext(result)
    expect(context).toContain('## Purpose\n\nReview critical auth changes.')
    expect(context).toContain('## Tech Stack\n\nTypeScript and Node.js.')
    expect(context).toContain('## Conventions\n\nUse small pure helpers when possible.')
    expect(context).toContain('## Constraints\n\nDo not change public API signatures.')
    expect(context).toContain('## Completed Work')
    expect(context).toContain('## Authentication')
    expect(context).not.toContain('## Architecture')
  })

  it('truncates after filtering when the selected sections still exceed the limit', async () => {
    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'builder', 'default.md'),
      '# Builder\n\n## Context\n{{project_context}}\n'
    )

    const longContext = [
      '# Project Context',
      buildSection('Purpose', 'Purpose details. ' + 'purpose '.repeat(900)),
      buildSection('Tech Stack', 'Stack details. ' + 'typescript '.repeat(900)),
      buildSection('Conventions', 'Convention details. ' + 'convention '.repeat(900)),
      buildSection('Constraints', 'Constraint details. ' + 'constraint '.repeat(900)),
      buildSection('Architecture', 'Architecture details. ' + 'architecture '.repeat(900)),
      buildSection('Completed Work', 'Completed work.'),
    ].join('\n\n')

    await writeFile(path.join(TEST_DIR, '.invoke', 'context.md'), longContext)

    const result = await composePrompt({
      projectDir: TEST_DIR,
      promptPath: '.invoke/roles/builder/default.md',
      taskContext: { task_description: 'Implement reporting flow' },
    })

    const context = extractContext(result).trimEnd()
    expect(context).toContain(TRUNCATED_MARKER)
    expect(context.length).toBeLessThanOrEqual(4013)
  })

  it('sets project_context to empty string when no context.md', async () => {
    const result = await composePrompt({
      projectDir: TEST_DIR,
      promptPath: '.invoke/roles/test/prompt.md',
      taskContext: { task_description: 'Build feature' },
    })

    expect(result).not.toContain('{{project_context}}')
  })

  it('renders nonce-scoped reviewer delimiters when a fixed nonce is provided', async () => {
    const nonce = 'fedcba9876543210fedcba9876543210'

    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'reviewer', 'security.md'),
      `# Reviewer

## Scope
{{scope_delim_start}}
{{scope}}
{{scope_delim_end}}

## Prior Findings
{{prior_findings_delim_start}}
{{prior_findings}}
{{prior_findings_delim_end}}
`
    )

    const result = await composePromptWithNonce(
      {
        projectDir: TEST_DIR,
        promptPath: '.invoke/roles/reviewer/security.md',
        taskContext: {
          scope: 'Review auth changes.',
          prior_findings: 'No prior findings.',
        },
      },
      nonce
    )

    expect(result).toContain(`<<<SCOPE_DATA_START_${nonce}>>>`)
    expect(result).toContain(`<<<SCOPE_DATA_END_${nonce}>>>`)
    expect(result).toContain(`<<<PRIOR_FINDINGS_DATA_START_${nonce}>>>`)
    expect(result).toContain(`<<<PRIOR_FINDINGS_DATA_END_${nonce}>>>`)
  })
})
