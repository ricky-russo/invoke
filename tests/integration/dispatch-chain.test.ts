import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig } from '../../src/config.js'
import { createProviderRegistry } from '../../src/providers/registry.js'
import { createParserRegistry } from '../../src/parsers/registry.js'
import { composePrompt } from '../../src/dispatch/prompt-composer.js'
import { mkdir, writeFile, rm } from 'fs/promises'
import path from 'path'

const TEST_DIR = path.join(import.meta.dirname, 'fixtures', 'dispatch-chain-test')

beforeEach(async () => {
  await mkdir(path.join(TEST_DIR, '.invoke', 'roles', 'reviewer'), { recursive: true })
  await mkdir(path.join(TEST_DIR, '.invoke', 'roles', 'researcher'), { recursive: true })
  await mkdir(path.join(TEST_DIR, '.invoke', 'strategies'), { recursive: true })

  const config = `
providers:
  claude:
    cli: claude
    args: ["--print", "--model", "{{model}}"]
  codex:
    cli: codex
    args: ["exec", "--model", "{{model}}", "--full-auto", "-c", "reasoning_effort={{effort}}"]

roles:
  researcher:
    codebase:
      prompt: .invoke/roles/researcher/codebase.md
      provider: claude
      model: opus-4.6
      effort: high
  reviewer:
    security:
      prompt: .invoke/roles/reviewer/security.md
      providers:
        - provider: claude
          model: opus-4.6
          effort: high
        - provider: codex
          model: gpt-5.4
          effort: high

strategies:
  tdd:
    prompt: .invoke/strategies/tdd.md

settings:
  default_strategy: tdd
  agent_timeout: 300000
  commit_style: per-batch
  work_branch_prefix: invoke/work
`
  await writeFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), config)

  await writeFile(
    path.join(TEST_DIR, '.invoke', 'roles', 'reviewer', 'security.md'),
    '# Security Review\n\n## Task\n{{task_description}}\n\n## Diff\n{{diff}}\n\nReview for vulnerabilities.'
  )
  await writeFile(
    path.join(TEST_DIR, '.invoke', 'roles', 'researcher', 'codebase.md'),
    '# Codebase Research\n\n## Task\n{{task_description}}\n\nAnalyze the codebase.'
  )
  await writeFile(
    path.join(TEST_DIR, '.invoke', 'strategies', 'tdd.md'),
    '# TDD\n\nWrite tests first.'
  )
})

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('Dispatch Chain Integration', () => {
  it('loads config with single-provider role and normalizes to providers array', async () => {
    const config = await loadConfig(TEST_DIR)

    expect(config.roles.researcher.codebase.providers).toHaveLength(1)
    expect(config.roles.researcher.codebase.providers[0].provider).toBe('claude')
  })

  it('loads config with multi-provider role', async () => {
    const config = await loadConfig(TEST_DIR)

    expect(config.roles.reviewer.security.providers).toHaveLength(2)
    expect(config.roles.reviewer.security.providers[0].provider).toBe('claude')
    expect(config.roles.reviewer.security.providers[1].provider).toBe('codex')
  })

  it('creates provider registry from config', async () => {
    const config = await loadConfig(TEST_DIR)
    const providers = createProviderRegistry(config.providers)

    expect(providers.get('claude')).toBeTruthy()
    expect(providers.get('codex')).toBeTruthy()
  })

  it('builds correct CLI command for Claude', async () => {
    const config = await loadConfig(TEST_DIR)
    const providers = createProviderRegistry(config.providers)
    const claude = providers.get('claude')!

    const entry = config.roles.researcher.codebase.providers[0]
    const cmd = claude.buildCommand({
      model: entry.model,
      effort: entry.effort,
      workDir: '/tmp/worktree',
      prompt: 'Test prompt',
    })

    expect(cmd.cmd).toBe('claude')
    expect(cmd.args).toContain('--print')
    expect(cmd.args).toContain('--model')
    expect(cmd.args).toContain('opus-4.6')
    expect(cmd.cwd).toBe('/tmp/worktree')
    expect(cmd.args[cmd.args.length - 1]).toBe('Test prompt')
  })

  it('builds correct CLI command for Codex', async () => {
    const config = await loadConfig(TEST_DIR)
    const providers = createProviderRegistry(config.providers)
    const codex = providers.get('codex')!

    const entry = config.roles.reviewer.security.providers[1]
    const cmd = codex.buildCommand({
      model: entry.model,
      effort: entry.effort,
      workDir: '/tmp/worktree',
      prompt: 'Review prompt',
    })

    expect(cmd.cmd).toBe('codex')
    expect(cmd.args).toContain('--model')
    expect(cmd.args).toContain('gpt-5.4')
    expect(cmd.args).toContain('--skip-git-repo-check')
    expect(cmd.cwd).toBe('/tmp/worktree')
    expect(cmd.args[cmd.args.length - 1]).toBe('Review prompt')
  })

  it('composes prompt with template variables injected', async () => {
    const prompt = await composePrompt({
      projectDir: TEST_DIR,
      promptPath: '.invoke/roles/reviewer/security.md',
      taskContext: {
        task_description: 'Review auth module',
        diff: '+ new code here',
      },
    })

    expect(prompt).toContain('Review auth module')
    expect(prompt).toContain('+ new code here')
    expect(prompt).not.toContain('{{task_description}}')
    expect(prompt).not.toContain('{{diff}}')
    expect(prompt).toContain('Review for vulnerabilities.')
  })

  it('composes prompt with strategy appended', async () => {
    const prompt = await composePrompt({
      projectDir: TEST_DIR,
      promptPath: '.invoke/roles/researcher/codebase.md',
      strategyPath: '.invoke/strategies/tdd.md',
      taskContext: {
        task_description: 'Analyze the auth system',
      },
    })

    expect(prompt).toContain('Analyze the auth system')
    expect(prompt).toContain('Write tests first.')
  })

  it('parsers produce correct AgentResult shape from reviewer output', () => {
    const parsers = createParserRegistry(['claude', 'codex'])
    const claude = parsers.get('claude')!

    const reviewOutput = `## Security Review

### Finding 1
**Severity:** high
**File:** src/auth/token.ts
**Line:** 42
**Issue:** SQL injection in query
**Suggestion:** Use parameterized queries

### Finding 2
**Severity:** medium
**File:** src/auth/session.ts
**Line:** 15
**Issue:** Token stored in localStorage
**Suggestion:** Use HttpOnly cookies`

    const result = claude.parse(reviewOutput, 0, {
      role: 'reviewer',
      subrole: 'security',
      provider: 'claude',
      model: 'opus-4.6',
      duration: 5000,
    })

    expect(result.status).toBe('success')
    expect(result.role).toBe('reviewer')
    expect(result.output.findings).toHaveLength(2)
    expect(result.output.findings![0].severity).toBe('high')
    expect(result.output.findings![0].file).toBe('src/auth/token.ts')
    expect(result.output.findings![0].line).toBe(42)
    expect(result.output.findings![1].severity).toBe('medium')
  })

  it('parsers produce correct AgentResult shape from researcher output', () => {
    const parsers = createParserRegistry(['claude', 'codex'])
    const claude = parsers.get('claude')!

    const researchOutput = 'The codebase uses Express with TypeScript.\n\nKey modules: auth, api, db.'

    const result = claude.parse(researchOutput, 0, {
      role: 'researcher',
      subrole: 'codebase',
      provider: 'claude',
      model: 'opus-4.6',
      duration: 3000,
    })

    expect(result.status).toBe('success')
    expect(result.output.findings).toBeUndefined()
  })

  it('parsers handle error exit codes', () => {
    const parsers = createParserRegistry(['claude', 'codex'])
    const codex = parsers.get('codex')!

    const result = codex.parse('Something broke', 1, {
      role: 'builder',
      subrole: 'default',
      provider: 'codex',
      model: 'gpt-5.4',
      duration: 1000,
    })

    expect(result.status).toBe('error')
    expect(result.output.raw).toBe('Something broke')
  })

  it('full chain: config → role lookup → compose → command → parse', async () => {
    const config = await loadConfig(TEST_DIR)
    const providers = createProviderRegistry(config.providers)
    const parsers = createParserRegistry(['claude', 'codex'])

    const roleConfig = config.roles.reviewer.security
    expect(roleConfig).toBeTruthy()
    expect(roleConfig.providers).toHaveLength(2)

    const prompt = await composePrompt({
      projectDir: TEST_DIR,
      promptPath: roleConfig.prompt,
      taskContext: { task_description: 'Review login flow', diff: 'code changes' },
    })
    expect(prompt).toContain('Review login flow')

    for (const entry of roleConfig.providers) {
      const provider = providers.get(entry.provider)!
      const cmd = provider.buildCommand({
        model: entry.model,
        effort: entry.effort,
        workDir: '/tmp/wt',
        prompt,
      })
      expect(cmd.cmd).toBeTruthy()
      expect(cmd.args.length).toBeGreaterThan(0)
      expect(cmd.args[cmd.args.length - 1]).toBe(prompt)

      const parser = parsers.get(entry.provider)!
      const result = parser.parse('No issues found.', 0, {
        role: 'reviewer',
        subrole: 'security',
        provider: entry.provider,
        model: entry.model,
        duration: 2000,
      })
      expect(result.status).toBe('success')
      expect(result.provider).toBe(entry.provider)
    }
  })
})
