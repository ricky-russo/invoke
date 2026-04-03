import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { composePrompt } from '../../src/dispatch/prompt-composer.js'
import { mkdir, writeFile, rm } from 'fs/promises'
import path from 'path'

const TEST_DIR = path.join(import.meta.dirname, 'fixtures', 'prompt-test')

beforeEach(async () => {
  await mkdir(path.join(TEST_DIR, '.invoke', 'roles', 'reviewer'), { recursive: true })
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

  it('throws when prompt file is missing', async () => {
    await expect(
      composePrompt({
        projectDir: TEST_DIR,
        promptPath: '.invoke/roles/nonexistent.md',
        taskContext: {},
      })
    ).rejects.toThrow()
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

  it('sets project_context to empty string when no context.md', async () => {
    const result = await composePrompt({
      projectDir: TEST_DIR,
      promptPath: '.invoke/roles/test/prompt.md',
      taskContext: { task_description: 'Build feature' },
    })

    expect(result).not.toContain('{{project_context}}')
  })
})
