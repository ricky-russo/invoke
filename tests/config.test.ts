import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig } from '../src/config.js'
import { mkdir, writeFile, rm } from 'fs/promises'
import path from 'path'

const TEST_DIR = path.join(import.meta.dirname, 'fixtures', 'config-test')

beforeEach(async () => {
  await mkdir(path.join(TEST_DIR, '.invoke'), { recursive: true })
})

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('loadConfig', () => {
  it('loads single-provider shorthand and normalizes to providers array', async () => {
    const yaml = `
providers:
  claude:
    cli: claude
    args: ["--print", "--model", "{{model}}"]

roles:
  reviewer:
    security:
      prompt: .invoke/roles/reviewer/security.md
      provider: claude
      model: opus-4.6
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
    await writeFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), yaml)

    const config = await loadConfig(TEST_DIR)

    expect(config.roles.reviewer.security.providers).toHaveLength(1)
    expect(config.roles.reviewer.security.providers[0].provider).toBe('claude')
    expect(config.roles.reviewer.security.providers[0].model).toBe('opus-4.6')
    expect(config.roles.reviewer.security.providers[0].effort).toBe('high')
    expect(config.roles.reviewer.security.prompt).toBe('.invoke/roles/reviewer/security.md')
  })

  it('loads multi-provider format directly', async () => {
    const yaml = `
providers:
  claude:
    cli: claude
    args: ["--print", "--model", "{{model}}"]
  codex:
    cli: codex
    args: ["--model", "{{model}}"]

roles:
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
    await writeFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), yaml)

    const config = await loadConfig(TEST_DIR)

    expect(config.roles.reviewer.security.providers).toHaveLength(2)
    expect(config.roles.reviewer.security.providers[0].provider).toBe('claude')
    expect(config.roles.reviewer.security.providers[1].provider).toBe('codex')
    expect(config.roles.reviewer.security.providers[1].model).toBe('gpt-5.4')
  })

  it('loads provider_mode and new optional settings fields', async () => {
    const yaml = `
providers:
  claude:
    cli: claude
    args: ["--print", "--model", "{{model}}"]

roles:
  reviewer:
    security:
      prompt: .invoke/roles/reviewer/security.md
      provider: claude
      model: opus-4.6
      effort: high
      provider_mode: single

strategies:
  tdd:
    prompt: .invoke/strategies/tdd.md

settings:
  default_strategy: tdd
  agent_timeout: 300000
  commit_style: per-batch
  work_branch_prefix: invoke/work
  default_provider_mode: fallback
  stale_session_days: 14
  max_dispatches: 8
  max_review_cycles: 3
`
    await writeFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), yaml)

    const config = await loadConfig(TEST_DIR)

    expect(config.roles.reviewer.security.provider_mode).toBe('single')
    expect(config.settings.default_provider_mode).toBe('fallback')
    expect(config.settings.stale_session_days).toBe(14)
    expect(config.settings.max_dispatches).toBe(8)
    expect(config.settings.max_review_cycles).toBe(3)
  })

  it('accepts presets and review_tiers in the config schema', async () => {
    const yaml = `
providers:
  claude:
    cli: claude
    args: ["--print", "--model", "{{model}}"]

roles:
  reviewer:
    security:
      prompt: .invoke/roles/reviewer/security.md
      provider: claude
      model: opus-4.6
      effort: high

strategies:
  tdd:
    prompt: .invoke/strategies/tdd.md

settings:
  default_strategy: tdd
  agent_timeout: 300000
  commit_style: per-batch
  work_branch_prefix: invoke/work
  review_tiers:
    critical:
      - security
    quality:
      - spec-compliance

presets:
  quick:
    name: quick
    description: Fast path
    settings:
      max_review_cycles: 1
    researcher_selection:
      - codebase
    reviewer_selection:
      - security
    strategy_selection:
      - tdd
`
    await writeFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), yaml)

    const config = await loadConfig(TEST_DIR)

    expect(config.settings.review_tiers).toEqual([
      {
        name: 'critical',
        reviewers: ['security'],
      },
      {
        name: 'quality',
        reviewers: ['spec-compliance'],
      },
    ])
    expect(config.presets).toEqual({
      quick: {
        name: 'quick',
        description: 'Fast path',
        settings: {
          max_review_cycles: 1,
        },
        researcher_selection: ['codebase'],
        reviewer_selection: ['security'],
        strategy_selection: ['tdd'],
      },
    })
  })

  it('loads and merges a default preset when settings.preset is set', async () => {
    const yaml = `
providers:
  claude:
    cli: claude
    args: ["--print", "--model", "{{model}}"]

roles:
  reviewer:
    security:
      prompt: .invoke/roles/reviewer/security.md
      provider: claude
      model: opus-4.6
      effort: high

strategies:
  tdd:
    prompt: .invoke/strategies/tdd.md
  implementation-first:
    prompt: .invoke/strategies/implementation-first.md
  bug-fix:
    prompt: .invoke/strategies/bug-fix.md

settings:
  preset: quick
  agent_timeout: 300000
  commit_style: per-batch
  work_branch_prefix: invoke/work
`
    await writeFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), yaml)

    const config = await loadConfig(TEST_DIR)

    expect(config.settings.preset).toBe('quick')
    expect(config.settings.default_strategy).toBe('implementation-first')
    expect(config.settings.max_review_cycles).toBe(1)
    expect(config.settings.max_parallel_agents).toBe(2)
    expect(config.presets?.quick).toEqual({
      name: 'quick',
      description: 'Fast pipeline preset for small changes with limited review coverage.',
      settings: {
        default_strategy: 'implementation-first',
        max_review_cycles: 1,
        max_parallel_agents: 2,
      },
      researcher_selection: ['codebase'],
      reviewer_selection: ['spec-compliance', 'security'],
      strategy_selection: ['implementation-first', 'bug-fix'],
    })
  })

  it('prefers an inline preset over preset files when settings.preset is set', async () => {
    await mkdir(path.join(TEST_DIR, '.invoke', 'presets'), { recursive: true })

    const presetYaml = `
name: quick
description: File preset
settings:
  default_strategy: implementation-first
  max_parallel_agents: 1
`
    await writeFile(path.join(TEST_DIR, '.invoke', 'presets', 'quick.yaml'), presetYaml)

    const yaml = `
providers:
  claude:
    cli: claude
    args: ["--print", "--model", "{{model}}"]

roles:
  reviewer:
    security:
      prompt: .invoke/roles/reviewer/security.md
      provider: claude
      model: opus-4.6
      effort: high

strategies:
  tdd:
    prompt: .invoke/strategies/tdd.md
  implementation-first:
    prompt: .invoke/strategies/implementation-first.md

settings:
  preset: quick
  agent_timeout: 300000
  commit_style: per-batch
  work_branch_prefix: invoke/work

presets:
  quick:
    name: quick
    description: Inline preset
    settings:
      default_strategy: tdd
      max_parallel_agents: 4
`
    await writeFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), yaml)

    const config = await loadConfig(TEST_DIR)

    expect(config.settings.default_strategy).toBe('tdd')
    expect(config.settings.max_parallel_agents).toBe(4)
    expect(config.presets?.quick).toEqual({
      name: 'quick',
      description: 'Inline preset',
      settings: {
        default_strategy: 'tdd',
        max_parallel_agents: 4,
      },
    })
  })

  it('prefers user config values over preset values and replaces arrays', async () => {
    await mkdir(path.join(TEST_DIR, '.invoke', 'presets'), { recursive: true })

    const presetYaml = `
name: quick
settings:
  default_strategy: implementation-first
  max_parallel_agents: 1
  post_merge_commands:
    - npm install
  review_tiers:
    - name: quick-pass
      reviewers:
        - security
`
    await writeFile(path.join(TEST_DIR, '.invoke', 'presets', 'quick.yaml'), presetYaml)

    const yaml = `
providers:
  claude:
    cli: claude
    args: ["--print", "--model", "{{model}}"]

roles:
  reviewer:
    security:
      prompt: .invoke/roles/reviewer/security.md
      provider: claude
      model: opus-4.6
      effort: high

strategies:
  tdd:
    prompt: .invoke/strategies/tdd.md
  implementation-first:
    prompt: .invoke/strategies/implementation-first.md

settings:
  preset: quick
  default_strategy: tdd
  agent_timeout: 300000
  commit_style: per-batch
  work_branch_prefix: invoke/work
  post_merge_commands:
    - pnpm install
  review_tiers:
    - name: full-pass
      reviewers:
        - spec-compliance
        - security
`
    await writeFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), yaml)

    const config = await loadConfig(TEST_DIR)

    expect(config.settings.default_strategy).toBe('tdd')
    expect(config.settings.max_parallel_agents).toBe(1)
    expect(config.settings.post_merge_commands).toEqual(['pnpm install'])
    expect(config.settings.review_tiers).toEqual([
      {
        name: 'full-pass',
        reviewers: ['spec-compliance', 'security'],
      },
    ])
  })

  it('loads the prototype preset with max_review_cycles set to 0', async () => {
    const yaml = `
providers:
  claude:
    cli: claude
    args: ["--print", "--model", "{{model}}"]

roles:
  reviewer:
    security:
      prompt: .invoke/roles/reviewer/security.md
      provider: claude
      model: opus-4.6
      effort: high

strategies:
  prototype:
    prompt: .invoke/strategies/prototype.md

settings:
  preset: prototype
  agent_timeout: 300000
  commit_style: per-batch
  work_branch_prefix: invoke/work
`
    await writeFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), yaml)

    const config = await loadConfig(TEST_DIR)

    expect(config.settings.preset).toBe('prototype')
    expect(config.settings.default_strategy).toBe('prototype')
    expect(config.settings.max_review_cycles).toBe(0)
  })

  it('leaves provider_mode undefined when it is omitted', async () => {
    const yaml = `
providers:
  claude:
    cli: claude
    args: ["--print", "--model", "{{model}}"]
  codex:
    cli: codex
    args: ["--model", "{{model}}"]

roles:
  reviewer:
    security:
      prompt: .invoke/roles/reviewer/security.md
      providers:
        - provider: claude
          model: opus-4.6
          effort: high
        - provider: codex
          model: gpt-5.4
          effort: medium

strategies:
  tdd:
    prompt: .invoke/strategies/tdd.md

settings:
  default_strategy: tdd
  agent_timeout: 300000
  commit_style: per-batch
  work_branch_prefix: invoke/work
`
    await writeFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), yaml)

    const config = await loadConfig(TEST_DIR)

    expect(config.roles.reviewer.security.provider_mode).toBeUndefined()
  })

  it('handles mixed formats in same config', async () => {
    const yaml = `
providers:
  claude:
    cli: claude
    args: ["--print", "--model", "{{model}}"]

roles:
  reviewer:
    security:
      prompt: .invoke/roles/reviewer/security.md
      providers:
        - provider: claude
          model: opus-4.6
          effort: high
    code-quality:
      prompt: .invoke/roles/reviewer/code-quality.md
      provider: claude
      model: opus-4.6
      effort: medium

strategies:
  tdd:
    prompt: .invoke/strategies/tdd.md

settings:
  default_strategy: tdd
  agent_timeout: 300000
  commit_style: per-batch
  work_branch_prefix: invoke/work
`
    await writeFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), yaml)

    const config = await loadConfig(TEST_DIR)

    expect(config.roles.reviewer.security.providers).toHaveLength(1)
    expect(config.roles.reviewer['code-quality'].providers).toHaveLength(1)
    expect(config.roles.reviewer['code-quality'].providers[0].provider).toBe('claude')
  })

  it('throws if pipeline.yaml is missing', async () => {
    await expect(loadConfig(TEST_DIR + '/nonexistent')).rejects.toThrow()
  })

  it('throws if config is missing required fields', async () => {
    await writeFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), 'providers: {}')
    await expect(loadConfig(TEST_DIR)).rejects.toThrow()
  })

  it('throws a clear error when work_branch_prefix is invalid', async () => {
    const yaml = `
providers:
  claude:
    cli: claude
    args: ["--print", "--model", "{{model}}"]

roles:
  reviewer:
    security:
      prompt: .invoke/roles/reviewer/security.md
      provider: claude
      model: opus-4.6
      effort: high

strategies:
  tdd:
    prompt: .invoke/strategies/tdd.md

settings:
  default_strategy: tdd
  agent_timeout: 300000
  commit_style: per-batch
  work_branch_prefix: /invoke/work
`
    await writeFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), yaml)

    await expect(loadConfig(TEST_DIR)).rejects.toThrow(
      /work_branch_prefix must contain only letters, numbers, dots, underscores, dashes, and slashes, and must not be empty or start\/end with '\//i
    )
  })

  it('throws a clear error when a referenced preset file is missing', async () => {
    const yaml = `
providers:
  claude:
    cli: claude
    args: ["--print", "--model", "{{model}}"]

roles:
  reviewer:
    security:
      prompt: .invoke/roles/reviewer/security.md
      provider: claude
      model: opus-4.6
      effort: high

strategies:
  tdd:
    prompt: .invoke/strategies/tdd.md

settings:
  preset: missing
  default_strategy: tdd
  agent_timeout: 300000
  commit_style: per-batch
  work_branch_prefix: invoke/work
`
    await writeFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), yaml)

    await expect(loadConfig(TEST_DIR)).rejects.toThrow(/Preset 'missing' not found/)
  })
})
