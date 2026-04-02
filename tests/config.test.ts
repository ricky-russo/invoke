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
  it('loads and parses a valid pipeline.yaml', async () => {
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

    expect(config.providers.claude.cli).toBe('claude')
    expect(config.providers.claude.args).toEqual(['--print', '--model', '{{model}}'])
    expect(config.roles.reviewer.security.provider).toBe('claude')
    expect(config.roles.reviewer.security.effort).toBe('high')
    expect(config.strategies.tdd.prompt).toBe('.invoke/strategies/tdd.md')
    expect(config.settings.default_strategy).toBe('tdd')
    expect(config.settings.agent_timeout).toBe(300000)
  })

  it('throws if pipeline.yaml is missing', async () => {
    await expect(loadConfig(TEST_DIR + '/nonexistent')).rejects.toThrow()
  })

  it('throws if config is missing required fields', async () => {
    await writeFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), 'providers: {}')
    await expect(loadConfig(TEST_DIR)).rejects.toThrow()
  })
})
