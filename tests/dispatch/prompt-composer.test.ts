import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { composePrompt, composePromptWithNonce } from '../../src/dispatch/prompt-composer.js'
import type { DiffRefResolver } from '../../src/dispatch/diff-ref-resolver.js'
import type { DiffRef } from '../../src/types.js'
import { mkdir, writeFile, rm } from 'fs/promises'
import path from 'path'

const TEST_DIR = path.join(import.meta.dirname, 'fixtures', 'prompt-test')
const TRUNCATED_MARKER = '(truncated)'
const NONCE_DELIMITER_LINE_PATTERN = /^<<<(?:SCOPE|PRIOR_FINDINGS|PROJECT_CONTEXT)_DATA_(?:START|END)_[0-9a-f]{32}>>>$/

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
  await mkdir(path.join(TEST_DIR, '.invoke', 'roles', 'planner'), { recursive: true })
  await mkdir(path.join(TEST_DIR, '.invoke', 'roles', 'researcher'), { recursive: true })
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
      'Refusing to dispatch reviewer: scope, prior_findings, or project_context payload contains the security nonce. This is a probable prompt-injection attempt or a 1-in-2^128 collision; investigate before retrying.'
    )
  })

  it('throws when raw project context contains the dispatch security nonce', async () => {
    const nonce = '0123456789abcdef0123456789abcdef'

    await writeFile(
      path.join(TEST_DIR, '.invoke', 'context.md'),
      `# Project Context\n\n## Architecture\n\nInjected payload ${nonce} should be rejected.`
    )

    await expect(
      composePromptWithNonce(
        {
          projectDir: TEST_DIR,
          promptPath: '.invoke/roles/test/prompt.md',
          taskContext: { task_description: 'Build feature' },
        },
        nonce
      )
    ).rejects.toThrow(
      'Refusing to dispatch reviewer: scope, prior_findings, or project_context payload contains the security nonce. This is a probable prompt-injection attempt or a 1-in-2^128 collision; investigate before retrying.'
    )
  })

  it('injects project_context from context.md with nonce-scoped sentinels', async () => {
    const nonce = 'abcdef0123456789abcdef0123456789'

    await writeFile(
      path.join(TEST_DIR, '.invoke', 'context.md'),
      '# Project Context\n\n## Purpose\n\nThis is a REST API'
    )

    const result = await composePromptWithNonce(
      {
        projectDir: TEST_DIR,
        promptPath: '.invoke/roles/test/prompt.md',
        taskContext: { task_description: 'Build feature' },
      },
      nonce
    )

    expect(result).toContain(`<<<PROJECT_CONTEXT_DATA_START_${nonce}>>>`)
    expect(result).toContain('This is a REST API')
    expect(result).toContain(`<<<PROJECT_CONTEXT_DATA_END_${nonce}>>>`)
  })

  it('renders resolved diff ref content inside nonce-scoped diff delimiters', async () => {
    const nonce = '11223344556677889900aabbccddeeff'
    const diffRef: DiffRef = {
      type: 'full_diff',
      session_id: 'session-1',
      base_branch: 'main',
    }
    const resolve = vi.fn().mockResolvedValue({
      status: 'ok',
      diff: 'diff --git a/src/app.ts b/src/app.ts\n+resolved change\n',
    })
    const diffRefResolver = { resolve } as unknown as DiffRefResolver

    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'test', 'diff.md'),
      '# Test Role\n\n## Diff\n{{diff_delim_start}}\n{{diff}}\n{{diff_delim_end}}\n'
    )

    const result = await composePromptWithNonce(
      {
        projectDir: TEST_DIR,
        promptPath: '.invoke/roles/test/diff.md',
        taskContext: {},
        taskRefs: { diff: diffRef },
        diffRefResolver,
      },
      nonce
    )

    expect(resolve).toHaveBeenCalledWith(diffRef)
    expect(result).toContain(`<<<DIFF_DATA_START_${nonce}>>>`)
    expect(result).toContain('diff --git a/src/app.ts b/src/app.ts')
    expect(result).toContain('+resolved change')
    expect(result).toContain(`<<<DIFF_DATA_END_${nonce}>>>`)
  })

  it('uses resolved diff refs instead of task_context.diff', async () => {
    const diffRef: DiffRef = {
      type: 'full_diff',
      session_id: 'session-2',
      base_branch: 'main',
    }
    const diffRefResolver = {
      resolve: vi.fn().mockResolvedValue({
        status: 'ok',
        diff: 'resolved diff payload',
      }),
    } as unknown as DiffRefResolver

    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'test', 'diff.md'),
      '# Test Role\n\n## Diff\n{{diff}}\n'
    )

    const result = await composePrompt({
      projectDir: TEST_DIR,
      promptPath: '.invoke/roles/test/diff.md',
      taskContext: {
        diff: 'plain task context diff',
      },
      taskRefs: { diff: diffRef },
      diffRefResolver,
    })

    expect(result).toContain('resolved diff payload')
    expect(result).not.toContain('plain task context diff')
  })

  it('throws when diff ref resolution fails', async () => {
    const diffRef: DiffRef = {
      type: 'full_diff',
      session_id: 'session-2',
      base_branch: 'main',
    }
    const resolve = vi.fn().mockResolvedValue({
      status: 'resolve_error',
      message: 'Session worktree path could not be resolved',
    })
    const diffRefResolver = { resolve } as unknown as DiffRefResolver

    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'test', 'diff.md'),
      '# Test Role\n\n## Diff\n{{diff}}\n'
    )

    await expect(
      composePrompt({
        projectDir: TEST_DIR,
        promptPath: '.invoke/roles/test/diff.md',
        taskContext: {},
        taskRefs: { diff: diffRef },
        diffRefResolver,
      })
    ).rejects.toThrow(
      'Diff resolution failed (resolve_error): Session worktree path could not be resolved'
    )

    expect(resolve).toHaveBeenCalledWith(diffRef)
  })

  it('keeps plain task_context.diff when no diff ref is provided', async () => {
    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'test', 'diff.md'),
      '# Test Role\n\n## Diff\n{{diff}}\n'
    )

    const result = await composePrompt({
      projectDir: TEST_DIR,
      promptPath: '.invoke/roles/test/diff.md',
      taskContext: {
        diff: 'plain task context diff',
      },
    })

    expect(result).toContain('plain task context diff')
  })

  it('throws when inline task_context.diff contains the dispatch security nonce', async () => {
    const nonce = '99887766554433221100ffeeddccbbaa'

    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'test', 'diff.md'),
      '# Test Role\n\n## Diff\n{{diff}}\n'
    )

    await expect(
      composePromptWithNonce(
        {
          projectDir: TEST_DIR,
          promptPath: '.invoke/roles/test/diff.md',
          taskContext: {
            diff: `diff --git a/file.ts b/file.ts\n+${nonce}\n`,
          },
        },
        nonce
      )
    ).rejects.toThrow(
      'Refusing to dispatch: resolved diff contains the security nonce. This is a probable prompt-injection attempt or a 1-in-2^128 collision; investigate before retrying.'
    )
  })

  it('throws when resolved diff contains the dispatch security nonce', async () => {
    const nonce = '99887766554433221100ffeeddccbbaa'
    const diffRef: DiffRef = {
      type: 'delta_diff',
      session_id: 'session-3',
      reviewed_sha: 'abcdef1234567890abcdef1234567890abcdef12',
    }
    const diffRefResolver = {
      resolve: vi.fn().mockResolvedValue({
        status: 'ok',
        diff: `diff --git a/file.ts b/file.ts\n+${nonce}\n`,
      }),
    } as unknown as DiffRefResolver

    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'test', 'diff.md'),
      '# Test Role\n\n## Diff\n{{diff}}\n'
    )

    await expect(
      composePromptWithNonce(
        {
          projectDir: TEST_DIR,
          promptPath: '.invoke/roles/test/diff.md',
          taskContext: {},
          taskRefs: { diff: diffRef },
          diffRefResolver,
        },
        nonce
      )
    ).rejects.toThrow(
      'Refusing to dispatch: resolved diff contains the security nonce. This is a probable prompt-injection attempt or a 1-in-2^128 collision; investigate before retrying.'
    )
  })

  it('substitutes diff delimiter variables in templates', async () => {
    const nonce = 'aabbccddeeff00112233445566778899'

    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'test', 'diff.md'),
      '# Test Role\n\n{{diff_delim_start}}\n{{diff_delim_end}}\n'
    )

    const result = await composePromptWithNonce(
      {
        projectDir: TEST_DIR,
        promptPath: '.invoke/roles/test/diff.md',
        taskContext: {},
      },
      nonce
    )

    expect(result).toContain(`<<<DIFF_DATA_START_${nonce}>>>`)
    expect(result).toContain(`<<<DIFF_DATA_END_${nonce}>>>`)
    expect(result).not.toContain('{{diff_delim_start}}')
    expect(result).not.toContain('{{diff_delim_end}}')
  })

  it('excludes session discoveries for reviewer and researcher even when context is under the size limit', async () => {
    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'reviewer', 'security.md'),
      '# Reviewer\n\n## Context\n{{project_context}}\n'
    )
    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'researcher', 'codebase.md'),
      '# Researcher\n\n## Context\n{{project_context}}\n'
    )
    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'builder', 'default.md'),
      '# Builder\n\n## Context\n{{project_context}}\n'
    )
    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'planner', 'architect.md'),
      '# Planner\n\n## Context\n{{project_context}}\n'
    )

    const smallContext = [
      '# Project Context',
      buildSection('Purpose', 'Ship the next dispatch update.'),
      buildSection('Tech Stack', 'TypeScript, Node.js, and Vitest.'),
      buildSection('Conventions', 'Keep changes small and targeted.'),
      buildSection('Constraints', 'Do not leak restricted context across roles.'),
      buildSection('Session Discoveries', 'Sensitive notes for active implementation work.'),
      buildSection('Known Issues', 'Pending cleanup in the dispatch prompts.'),
    ].join('\n\n')

    expect(smallContext.length).toBeLessThan(4000)

    await writeFile(path.join(TEST_DIR, '.invoke', 'context.md'), smallContext)

    const [reviewerResult, researcherResult, builderResult, plannerResult] = await Promise.all([
      composePrompt({
        projectDir: TEST_DIR,
        promptPath: '.invoke/roles/reviewer/security.md',
        taskContext: { task_description: 'Review the dispatch prompt changes' },
      }),
      composePrompt({
        projectDir: TEST_DIR,
        promptPath: '.invoke/roles/researcher/codebase.md',
        taskContext: { task_description: 'Research the dispatch prompt changes' },
      }),
      composePrompt({
        projectDir: TEST_DIR,
        promptPath: '.invoke/roles/builder/default.md',
        taskContext: { task_description: 'Build the dispatch prompt changes' },
      }),
      composePrompt({
        projectDir: TEST_DIR,
        promptPath: '.invoke/roles/planner/architect.md',
        taskContext: { task_description: 'Plan the dispatch prompt changes' },
      }),
    ])

    const reviewerContext = extractContext(reviewerResult)
    const researcherContext = extractContext(researcherResult)
    const builderContext = extractContext(builderResult)
    const plannerContext = extractContext(plannerResult)

    expect(reviewerContext).not.toContain('## Session Discoveries')
    expect(researcherContext).not.toContain('## Session Discoveries')
    expect(builderContext).toContain('## Session Discoveries\n\nSensitive notes for active implementation work.')
    expect(plannerContext).toContain('## Session Discoveries\n\nSensitive notes for active implementation work.')

    for (const context of [reviewerContext, researcherContext, builderContext, plannerContext]) {
      expect(context).toContain('## Purpose\n\nShip the next dispatch update.')
      expect(context).toContain('## Tech Stack\n\nTypeScript, Node.js, and Vitest.')
      expect(context).toContain('## Conventions\n\nKeep changes small and targeted.')
      expect(context).toContain('## Constraints\n\nDo not leak restricted context across roles.')
    }
  })

  it('filters long builder context to keep architecture, session discoveries, and core sections', async () => {
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
      buildSection('Session Discoveries', 'Recent workflow findings for the current session.'),
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
      expect(context).toContain('## Session Discoveries\n\nRecent workflow findings for the current session.')
      expect(context).not.toContain('## Completed Work')
      expect(context).not.toContain('## Known Issues')
      expect(errorSpy).toHaveBeenCalledWith(
        '[prompt-composer] Filtered project context sections',
        {
          included: ['Purpose', 'Tech Stack', 'Conventions', 'Constraints', 'Architecture', 'Session Discoveries'],
          excluded: ['Completed Work', 'Known Issues'],
        }
      )
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('keeps role-restricted sections for custom roles in short and long contexts', async () => {
    await mkdir(path.join(TEST_DIR, '.invoke', 'roles', 'qa'), { recursive: true })
    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'qa', 'default.md'),
      '# QA\n\n## Task\n{{task_description}}\n\n## Context\n{{project_context}}\n'
    )

    const smallContext = [
      '# Project Context',
      buildSection('Purpose', 'Validate custom role filtering.'),
      buildSection('Architecture', 'System layout details.'),
      buildSection('Completed Work', 'Recent implementation summary.'),
      buildSection('Session Discoveries', 'Current session notes.'),
    ].join('\n\n')

    expect(smallContext.length).toBeLessThan(4000)

    await writeFile(path.join(TEST_DIR, '.invoke', 'context.md'), smallContext)

    const smallResult = await composePrompt({
      projectDir: TEST_DIR,
      promptPath: '.invoke/roles/qa/default.md',
      taskContext: { task_description: 'Validate prompt composition for QA' },
    })

    const smallRenderedContext = extractContext(smallResult)
    expect(smallRenderedContext).toContain('## Architecture\n\nSystem layout details.')
    expect(smallRenderedContext).toContain('## Completed Work\n\nRecent implementation summary.')
    expect(smallRenderedContext).toContain('## Session Discoveries\n\nCurrent session notes.')

    const largeContext = [
      '# Project Context',
      buildSection('Purpose', 'Validate custom role filtering.'),
      buildSection('Tech Stack', 'TypeScript, Node.js, and Vitest.'),
      buildSection('Conventions', 'Keep changes small and targeted.'),
      buildSection('Constraints', 'Do not broaden the requested scope.'),
      buildSection('Architecture', 'System layout details.'),
      buildSection('Completed Work', 'Recent implementation summary.'),
      buildSection('Session Discoveries', 'Current session notes.'),
      buildSection('Known Issues', 'Known issue summary. ' + 'issue '.repeat(700)),
    ].join('\n\n')

    expect(largeContext.length).toBeGreaterThan(4000)

    await writeFile(path.join(TEST_DIR, '.invoke', 'context.md'), largeContext)

    const largeResult = await composePrompt({
      projectDir: TEST_DIR,
      promptPath: '.invoke/roles/qa/default.md',
      taskContext: {
        task_description: 'Review architecture completed work and session discoveries for QA',
      },
    })

    const largeRenderedContext = extractContext(largeResult)
    expect(largeRenderedContext).toContain('## Architecture\n\nSystem layout details.')
    expect(largeRenderedContext).toContain('## Completed Work\n\nRecent implementation summary.')
    expect(largeRenderedContext).toContain('## Session Discoveries\n\nCurrent session notes.')
  })

  it('filters long planner context to keep session discoveries and core sections', async () => {
    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'planner', 'architect.md'),
      '# Planner\n\n## Context\n{{project_context}}\n'
    )

    const longContext = [
      '# Project Context',
      buildSection('Purpose', 'Plan the next architecture update.'),
      buildSection('Tech Stack', 'TypeScript, Node.js, Vitest.'),
      buildSection('Conventions', 'Prefer small focused changes.'),
      buildSection('Constraints', 'Keep the pipeline stable.'),
      buildSection('Architecture', 'Planner, builder, and reviewer stages.'),
      buildSection('Session Discoveries', 'Recent workflow findings for the current session.'),
      buildSection('Completed Work', 'Completed item. ' + 'history '.repeat(700)),
      buildSection('Known Issues', 'Known issue. ' + 'issue '.repeat(700)),
    ].join('\n\n')

    await writeFile(path.join(TEST_DIR, '.invoke', 'context.md'), longContext)

    const result = await composePrompt({
      projectDir: TEST_DIR,
      promptPath: '.invoke/roles/planner/architect.md',
      taskContext: { task_description: 'Plan dashboard routing changes' },
    })

    const context = extractContext(result)
    expect(context).toContain('## Session Discoveries\n\nRecent workflow findings for the current session.')
    expect(context).toContain('## Architecture\n\nPlanner, builder, and reviewer stages.')
    expect(context).not.toContain('## Completed Work')
    expect(context).not.toContain('## Known Issues')
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
      buildSection('Session Discoveries', 'Recent workflow findings for the current session.'),
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
    expect(context).not.toContain('## Session Discoveries')
  })

  it('filters large reviewer context after role exclusions when the original context exceeds the limit', async () => {
    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'reviewer', 'security.md'),
      '# Reviewer\n\n## Task\n{{task_description}}\n\n## Context\n{{project_context}}\n'
    )

    const longArchitecture = 'Architecture notes. ' + 'diagram '.repeat(300)
    const longSessionDiscoveries = 'Session notes. ' + 'discovery '.repeat(300)
    const longContext = [
      '# Project Context',
      buildSection('Purpose', 'Review authentication changes.'),
      buildSection('Tech Stack', 'TypeScript and Node.js.'),
      buildSection('Conventions', 'Keep changes focused.'),
      buildSection('Constraints', 'Do not change public API signatures.'),
      buildSection('Architecture', longArchitecture),
      buildSection('Session Discoveries', longSessionDiscoveries),
      buildSection('Authentication', 'Authentication flow details.'),
      buildSection('Known Issues', 'Known issue summary.'),
    ].join('\n\n')

    const roleFilteredContext = [
      '# Project Context',
      buildSection('Purpose', 'Review authentication changes.'),
      buildSection('Tech Stack', 'TypeScript and Node.js.'),
      buildSection('Conventions', 'Keep changes focused.'),
      buildSection('Constraints', 'Do not change public API signatures.'),
      buildSection('Authentication', 'Authentication flow details.'),
      buildSection('Known Issues', 'Known issue summary.'),
    ].join('\n\n')

    expect(longContext.length).toBeGreaterThan(4000)
    expect(roleFilteredContext.length).toBeLessThan(4000)

    await writeFile(path.join(TEST_DIR, '.invoke', 'context.md'), longContext)

    const result = await composePrompt({
      projectDir: TEST_DIR,
      promptPath: '.invoke/roles/reviewer/security.md',
      taskContext: { task_description: 'Review authentication changes' },
    })

    const context = extractContext(result)
    expect(context).toContain('## Authentication\n\nAuthentication flow details.')
    expect(context).not.toContain('## Architecture')
    expect(context).not.toContain('## Session Discoveries')
    expect(context).not.toContain('## Known Issues')
  })

  it('filters long researcher context to exclude session discoveries without keyword overlap', async () => {
    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'researcher', 'codebase.md'),
      '# Researcher\n\n## Task\n{{task_description}}\n\n## Context\n{{project_context}}\n'
    )

    const longContext = [
      '# Project Context',
      buildSection('Purpose', 'Map the current codebase structure.'),
      buildSection('Tech Stack', 'TypeScript and Node.js.'),
      buildSection('Conventions', 'Prefer direct evidence from source files.'),
      buildSection('Constraints', 'Do not make changes during research.'),
      buildSection('Architecture', 'Core services are split by dispatch layer.'),
      buildSection('Session Discoveries', 'Recent workflow findings for the current session.'),
      buildSection('Authentication', 'Auth flow details. ' + 'auth '.repeat(120)),
      buildSection('Known Issues', 'Known issue summary. ' + 'issue '.repeat(900)),
    ].join('\n\n')

    await writeFile(path.join(TEST_DIR, '.invoke', 'context.md'), longContext)

    const result = await composePrompt({
      projectDir: TEST_DIR,
      promptPath: '.invoke/roles/researcher/codebase.md',
      taskContext: { task_description: 'Research the authentication flow' },
    })

    const context = extractContext(result)
    expect(context).toContain('## Authentication')
    expect(context).not.toContain('## Architecture')
    expect(context).not.toContain('## Session Discoveries')
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

    const context = stripNonceDelimiterLines(extractContext(result)).trimEnd()
    expect(context).toContain(TRUNCATED_MARKER)
    expect(context.length).toBeLessThanOrEqual(4013)
  })

  it('renders empty project_context sentinels when no context.md', async () => {
    const nonce = '00112233445566778899aabbccddeeff'

    const result = await composePromptWithNonce(
      {
        projectDir: TEST_DIR,
        promptPath: '.invoke/roles/test/prompt.md',
        taskContext: { task_description: 'Build feature' },
      },
      nonce
    )

    expect(result).not.toContain('{{project_context}}')
    expect(result).toContain(`<<<PROJECT_CONTEXT_DATA_START_${nonce}>>>`)
    expect(result).toContain(`<<<PROJECT_CONTEXT_DATA_END_${nonce}>>>`)
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
