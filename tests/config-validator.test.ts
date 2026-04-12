import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isValidModelForProvider, checkCliExists, validateConfig } from '../src/config-validator.js'
import type { InvokeConfig } from '../src/types.js'
import { chmod, mkdir, writeFile, rm } from 'fs/promises'
import path from 'path'
import os from 'os'

// ---------------------------------------------------------------------------
// Task 1: isValidModelForProvider
// ---------------------------------------------------------------------------

describe('isValidModelForProvider', () => {
  describe('claude provider', () => {
    it('accepts claude-opus-4-6', () => {
      expect(isValidModelForProvider('claude', 'claude-opus-4-6')).toBe(true)
    })

    it('accepts claude-sonnet-4-6', () => {
      expect(isValidModelForProvider('claude', 'claude-sonnet-4-6')).toBe(true)
    })

    it('accepts claude-haiku-4-5-20251001', () => {
      expect(isValidModelForProvider('claude', 'claude-haiku-4-5-20251001')).toBe(true)
    })

    it('accepts opus (short alias)', () => {
      expect(isValidModelForProvider('claude', 'opus')).toBe(true)
    })

    it('accepts sonnet (short alias)', () => {
      expect(isValidModelForProvider('claude', 'sonnet')).toBe(true)
    })

    it('accepts haiku (short alias)', () => {
      expect(isValidModelForProvider('claude', 'haiku')).toBe(true)
    })

    it('rejects opus-4.6 (missing claude- prefix)', () => {
      expect(isValidModelForProvider('claude', 'opus-4.6')).toBe(false)
    })

    it('rejects gpt-4 (wrong provider pattern)', () => {
      expect(isValidModelForProvider('claude', 'gpt-4')).toBe(false)
    })

    it('rejects "claude opus" (space not allowed)', () => {
      expect(isValidModelForProvider('claude', 'claude opus')).toBe(false)
    })
  })

  describe('codex provider', () => {
    it('accepts o3', () => {
      expect(isValidModelForProvider('codex', 'o3')).toBe(true)
    })

    it('accepts o4-mini', () => {
      expect(isValidModelForProvider('codex', 'o4-mini')).toBe(true)
    })

    it('accepts gpt-4o', () => {
      expect(isValidModelForProvider('codex', 'gpt-4o')).toBe(true)
    })

    it('accepts gpt-4.1', () => {
      expect(isValidModelForProvider('codex', 'gpt-4.1')).toBe(true)
    })

    it('accepts codex-mini', () => {
      expect(isValidModelForProvider('codex', 'codex-mini')).toBe(true)
    })

    it('rejects opus-4.6 (claude model)', () => {
      expect(isValidModelForProvider('codex', 'opus-4.6')).toBe(false)
    })

    it('rejects claude-sonnet-4-6 (wrong provider)', () => {
      expect(isValidModelForProvider('codex', 'claude-sonnet-4-6')).toBe(false)
    })
  })

  describe('gemini provider', () => {
    it('accepts gemini-2.5-pro', () => {
      expect(isValidModelForProvider('gemini', 'gemini-2.5-pro')).toBe(true)
    })

    it('accepts gemini-2.5-flash', () => {
      expect(isValidModelForProvider('gemini', 'gemini-2.5-flash')).toBe(true)
    })

    it('rejects claude-opus-4-6', () => {
      expect(isValidModelForProvider('gemini', 'claude-opus-4-6')).toBe(false)
    })

    it('rejects gemini without a model suffix', () => {
      expect(isValidModelForProvider('gemini', 'gemini')).toBe(false)
    })
  })

  describe('unknown provider', () => {
    it('accepts any model string for unknown provider', () => {
      expect(isValidModelForProvider('some-future-provider', 'any-model-name')).toBe(true)
    })

    it('uses CLI basename patterns for aliased providers', () => {
      expect(isValidModelForProvider('my-codex', 'gpt-4.1', '/usr/local/bin/codex')).toBe(true)
      expect(isValidModelForProvider('my-codex', 'claude-sonnet-4-6', '/usr/local/bin/codex')).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// Task 2: checkCliExists
// ---------------------------------------------------------------------------

describe('checkCliExists', () => {
  it('returns true for node (always on PATH)', () => {
    expect(checkCliExists('node')).toBe(true)
  })

  it('returns false for a nonexistent CLI', () => {
    expect(checkCliExists('nonexistent-cli-that-does-not-exist-xyz')).toBe(false)
  })

  it('does not execute shell metacharacters embedded in the CLI name', () => {
    expect(checkCliExists('node; echo injected')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Task 3: validateConfig
// ---------------------------------------------------------------------------

const TEST_DIR = path.join(os.tmpdir(), 'invoke-config-validator-test')
const ORIGINAL_PATH = process.env.PATH

// Base config used across tests — uses 'node' as the CLI so it is always on PATH
const baseConfig: InvokeConfig = {
  providers: {
    claude: {
      cli: 'node',
      args: ['--print', '--model', '{{model}}'],
    },
  },
  roles: {
    reviewer: {
      security: {
        prompt: '.invoke/roles/reviewer/security.md',
        providers: [
          { provider: 'claude', model: 'claude-opus-4-6', effort: 'high' },
        ],
      },
    },
  },
  strategies: {
    tdd: { prompt: '.invoke/strategies/tdd.md' },
  },
  settings: {
    default_strategy: 'tdd',
    agent_timeout: 300000,
    commit_style: 'per-batch',
    work_branch_prefix: 'invoke/work',
  },
}

describe('validateConfig', () => {
  beforeEach(async () => {
    // Create fixture directory structure and required prompt files
    await mkdir(path.join(TEST_DIR, '.invoke', 'roles', 'reviewer'), { recursive: true })
    await mkdir(path.join(TEST_DIR, '.invoke', 'strategies'), { recursive: true })
    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'reviewer', 'security.md'),
      '# Security Reviewer\nYou are a security reviewer.',
    )
    await writeFile(
      path.join(TEST_DIR, '.invoke', 'strategies', 'tdd.md'),
      '# TDD Strategy',
    )
  })

  afterEach(async () => {
    process.env.PATH = ORIGINAL_PATH
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  it('returns valid: true for a fully valid config', async () => {
    const result = await validateConfig(baseConfig, TEST_DIR)
    expect(result.valid).toBe(true)
    expect(result.warnings).toHaveLength(0)
  })

  it('warns when a review tier references an unknown reviewer subrole', async () => {
    const config = structuredClone(baseConfig)
    config.settings.review_tiers = [
      {
        name: 'final',
        reviewers: ['security', 'architecture'],
      },
    ]

    const result = await validateConfig(config, TEST_DIR)

    expect(result.valid).toBe(true)
    expect(result.warnings).toContainEqual(expect.objectContaining({
      level: 'warning',
      path: 'settings.review_tiers[0].reviewers[1]',
      message: expect.stringContaining("roles.reviewer.architecture"),
      suggestion: expect.stringContaining("Add roles.reviewer.architecture"),
    }))
  })

  it('does not warn when review tiers only reference configured reviewer subroles', async () => {
    const config = structuredClone(baseConfig)
    config.roles.reviewer['code-quality'] = {
      prompt: '.invoke/roles/reviewer/code-quality.md',
      providers: [
        { provider: 'claude', model: 'claude-sonnet-4-6', effort: 'medium' },
      ],
    }
    config.settings.review_tiers = [
      {
        name: 'default',
        reviewers: ['security', 'code-quality'],
      },
    ]

    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'reviewer', 'code-quality.md'),
      '# Code Quality Reviewer\nYou are a code quality reviewer.',
    )

    const result = await validateConfig(config, TEST_DIR)
    const reviewTierWarnings = result.warnings.filter(w => w.path.includes('review_tiers'))

    expect(reviewTierWarnings).toHaveLength(0)
  })

  it('does not warn when a preset key is defined inline', async () => {
    const config = structuredClone(baseConfig)
    config.presets = {
      nonexistent: {},
    }

    const result = await validateConfig(config, TEST_DIR)
    const presetWarnings = result.warnings.filter(w => w.path.startsWith('presets.'))

    expect(result.valid).toBe(true)
    expect(presetWarnings).toHaveLength(0)
  })

  it('warns when settings.preset does not match an inline or file preset', async () => {
    const config = structuredClone(baseConfig)
    config.settings.preset = 'nonexistent'

    const result = await validateConfig(config, TEST_DIR)

    expect(result.valid).toBe(true)
    expect(result.warnings).toContainEqual(expect.objectContaining({
      level: 'warning',
      path: 'settings.preset',
      message: expect.stringContaining('matching inline preset or file'),
      suggestion: expect.stringContaining(".invoke/presets/nonexistent.yaml"),
    }))
  })

  it('does not warn when settings.preset matches a built-in preset file', async () => {
    const config = structuredClone(baseConfig)
    config.settings.preset = 'quick'

    const result = await validateConfig(config, TEST_DIR)
    const presetWarnings = result.warnings.filter(w => w.path === 'settings.preset')

    expect(presetWarnings).toHaveLength(0)
  })

  it('does not warn when settings.preset matches a project preset file', async () => {
    const config = structuredClone(baseConfig)
    config.settings.preset = 'custom'

    await mkdir(path.join(TEST_DIR, '.invoke', 'presets'), { recursive: true })
    await writeFile(
      path.join(TEST_DIR, '.invoke', 'presets', 'custom.yaml'),
      'name: custom\ndescription: Project preset\n',
    )

    const result = await validateConfig(config, TEST_DIR)
    const presetWarnings = result.warnings.filter(w => w.path === 'settings.preset')

    expect(presetWarnings).toHaveLength(0)
  })

  it('does not warn when settings.preset matches an inline preset', async () => {
    const config = structuredClone(baseConfig)
    config.settings.preset = 'custom'
    config.presets = {
      custom: {},
    }

    const result = await validateConfig(config, TEST_DIR)
    const presetWarnings = result.warnings.filter(w => w.path === 'settings.preset')

    expect(presetWarnings).toHaveLength(0)
  })

  it('warns when a multi-provider role has no explicit provider_mode', async () => {
    const config = structuredClone(baseConfig)
    config.providers.codex = {
      cli: 'node',
      args: ['--model', '{{model}}'],
    }
    config.roles.reviewer.security.providers.push({
      provider: 'codex',
      model: 'gpt-4.1',
      effort: 'medium',
    })

    const result = await validateConfig(config, TEST_DIR)

    expect(result.valid).toBe(true)
    expect(result.warnings).toContainEqual(expect.objectContaining({
      level: 'warning',
      path: 'roles.reviewer.security.provider_mode',
      message: expect.stringContaining('multiple providers'),
      suggestion: expect.stringContaining("provider_mode"),
    }))
  })

  it('returns a warning with suggestion for opus-4.6 model', async () => {
    const config = structuredClone(baseConfig)
    config.roles.reviewer.security.providers[0].model = 'opus-4.6'

    const result = await validateConfig(config, TEST_DIR)
    expect(result.valid).toBe(true) // warnings don't invalidate
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toEqual(expect.objectContaining({
      level: 'warning',
      path: 'roles.reviewer.security.providers[0].model',
      suggestion: "Did you mean 'claude-opus-4-6'?",
    }))
  })

  it('uses aliased provider CLI names for model validation', async () => {
    const config = structuredClone(baseConfig)
    const fakeClaudePath = path.join(TEST_DIR, 'claude')

    await writeFile(fakeClaudePath, '#!/bin/sh\nexit 0\n')
    await chmod(fakeClaudePath, 0o755)

    config.providers = {
      'my-claude': {
        cli: fakeClaudePath,
        args: ['--print', '--model', '{{model}}'],
      },
    }
    config.roles.reviewer.security.providers[0] = {
      provider: 'my-claude',
      model: 'gpt-4.1',
      effort: 'high',
    }

    const result = await validateConfig(config, TEST_DIR)

    expect(result.valid).toBe(true)
    expect(result.warnings).toContainEqual(expect.objectContaining({
      level: 'warning',
      path: 'roles.reviewer.security.providers[0].model',
      message: expect.stringContaining('gpt-4.1'),
    }))
  })

  it('returns an error for a missing prompt file', async () => {
    const config = structuredClone(baseConfig)
    config.roles.reviewer.security.prompt = '.invoke/roles/reviewer/missing-prompt.md'

    const result = await validateConfig(config, TEST_DIR)
    expect(result.valid).toBe(false)
    expect(result.warnings).toContainEqual(expect.objectContaining({
      level: 'error',
      path: 'roles.reviewer.security.prompt',
    }))
  })

  it('returns an error for an undefined provider reference in a role', async () => {
    const config = structuredClone(baseConfig)
    config.roles.reviewer.security.providers[0].provider = 'nonexistent-provider'

    const result = await validateConfig(config, TEST_DIR)
    expect(result.valid).toBe(false)
    expect(result.warnings).toContainEqual(expect.objectContaining({
      level: 'error',
      path: 'roles.reviewer.security.providers[0].provider',
      message: expect.stringContaining('nonexistent-provider'),
    }))
  })

  it('returns an error for an invalid default_strategy', async () => {
    const config = structuredClone(baseConfig)
    config.settings.default_strategy = 'nonexistent-strategy'

    const result = await validateConfig(config, TEST_DIR)
    expect(result.valid).toBe(false)
    expect(result.warnings).toContainEqual(expect.objectContaining({
      level: 'error',
      path: 'settings.default_strategy',
    }))
  })

  it('returns an error for a missing CLI', async () => {
    const config = structuredClone(baseConfig)
    config.providers.claude.cli = 'nonexistent-cli-that-does-not-exist-xyz'

    const result = await validateConfig(config, TEST_DIR)
    expect(result.valid).toBe(false)
    expect(result.warnings).toContainEqual(expect.objectContaining({
      level: 'error',
      path: 'providers.claude.cli',
    }))
  })

  it('does not return an error for a missing CLI on an unused provider', async () => {
    const config = structuredClone(baseConfig)
    config.providers.gemini = {
      cli: 'nonexistent-cli-that-does-not-exist-xyz',
      args: ['--model', '{{model}}'],
    }

    const result = await validateConfig(config, TEST_DIR)
    const cliWarnings = result.warnings.filter(w => w.path === 'providers.gemini.cli')

    expect(result.valid).toBe(true)
    expect(cliWarnings).toHaveLength(0)
  })

  it('warns on suspiciously large timeout (likely milliseconds)', async () => {
    const config = structuredClone(baseConfig)
    config.roles.reviewer.security.providers[0].timeout = 300000
    const result = await validateConfig(config, TEST_DIR)
    expect(result.warnings).toContainEqual(expect.objectContaining({
      level: 'warning',
      path: 'roles.reviewer.security.providers[0].timeout',
    }))
  })

  it('does not warn on reasonable timeout', async () => {
    const config = structuredClone(baseConfig)
    config.roles.reviewer.security.providers[0].timeout = 600
    const result = await validateConfig(config, TEST_DIR)
    const timeoutWarnings = result.warnings.filter(w => w.path.includes('timeout'))
    expect(timeoutWarnings).toHaveLength(0)
  })

  it('returns errors when max_review_cycles is negative or max_dispatches is less than 1', async () => {
    const config = structuredClone(baseConfig)
    config.settings.max_review_cycles = -1
    config.settings.max_dispatches = 0

    const result = await validateConfig(config, TEST_DIR)

    expect(result.valid).toBe(false)
    expect(result.warnings).toContainEqual(expect.objectContaining({
      level: 'error',
      path: 'settings.max_review_cycles',
      message: expect.stringContaining('greater than or equal to 0'),
    }))
    expect(result.warnings).toContainEqual(expect.objectContaining({
      level: 'error',
      path: 'settings.max_dispatches',
      message: expect.stringContaining('greater than or equal to 1'),
    }))
  })

  it('does not error when max_review_cycles is 0', async () => {
    const config = structuredClone(baseConfig)
    config.settings.max_review_cycles = 0

    const result = await validateConfig(config, TEST_DIR)
    const maxReviewWarnings = result.warnings.filter(w => w.path === 'settings.max_review_cycles')

    expect(maxReviewWarnings).toHaveLength(0)
  })
})
