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
})
