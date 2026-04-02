import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ConfigManager } from '../../src/tools/config-manager.js'
import { mkdir, writeFile, rm, readFile } from 'fs/promises'
import path from 'path'

const TEST_DIR = path.join(import.meta.dirname, 'fixtures', 'config-manager-test')

let manager: ConfigManager

const STARTER_CONFIG = `
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

beforeEach(async () => {
  await mkdir(path.join(TEST_DIR, '.invoke'), { recursive: true })
  await writeFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), STARTER_CONFIG)
  manager = new ConfigManager(TEST_DIR)
})

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('ConfigManager', () => {
  describe('add_role', () => {
    it('adds a new sub-role to an existing role group', async () => {
      const result = await manager.execute({
        operation: 'add_role',
        role: 'reviewer',
        subrole: 'psr-compliance',
        config: {
          prompt: '.invoke/roles/reviewer/psr-compliance.md',
          providers: [{ provider: 'claude', model: 'opus-4.6', effort: 'high' }],
        },
      })

      expect(result.roles.reviewer['psr-compliance']).toBeTruthy()
      expect(result.roles.reviewer['psr-compliance'].providers[0].provider).toBe('claude')
      // Original role still exists
      expect(result.roles.reviewer.security).toBeTruthy()
    })

    it('adds a new role group', async () => {
      const result = await manager.execute({
        operation: 'add_role',
        role: 'orchestrator',
        subrole: 'default',
        config: {
          prompt: '.invoke/roles/orchestrator/default.md',
          providers: [{ provider: 'claude', model: 'opus-4.6', effort: 'high' }],
        },
      })

      expect(result.roles.orchestrator.default).toBeTruthy()
    })

    it('rejects duplicate sub-role', async () => {
      await expect(manager.execute({
        operation: 'add_role',
        role: 'reviewer',
        subrole: 'security',
        config: {
          prompt: '.invoke/roles/reviewer/security.md',
          providers: [{ provider: 'claude', model: 'opus-4.6', effort: 'high' }],
        },
      })).rejects.toThrow('already exists')
    })
  })

  describe('remove_role', () => {
    it('removes a sub-role', async () => {
      const result = await manager.execute({
        operation: 'remove_role',
        role: 'reviewer',
        subrole: 'security',
      })

      expect(result.roles.reviewer.security).toBeUndefined()
    })

    it('throws when sub-role does not exist', async () => {
      await expect(manager.execute({
        operation: 'remove_role',
        role: 'reviewer',
        subrole: 'nonexistent',
      })).rejects.toThrow('not found')
    })
  })

  describe('add_strategy', () => {
    it('adds a new strategy', async () => {
      const result = await manager.execute({
        operation: 'add_strategy',
        strategy: 'my-strategy',
        config: { prompt: '.invoke/strategies/my-strategy.md' },
      })

      expect(result.strategies['my-strategy'].prompt).toBe('.invoke/strategies/my-strategy.md')
    })
  })

  describe('remove_strategy', () => {
    it('removes a strategy', async () => {
      const result = await manager.execute({
        operation: 'remove_strategy',
        strategy: 'tdd',
      })

      expect(result.strategies.tdd).toBeUndefined()
    })
  })

  describe('update_settings', () => {
    it('updates specific settings', async () => {
      const result = await manager.execute({
        operation: 'update_settings',
        settings: { default_strategy: 'implementation-first', agent_timeout: 600000 },
      })

      expect(result.settings.default_strategy).toBe('implementation-first')
      expect(result.settings.agent_timeout).toBe(600000)
      // Unchanged settings preserved
      expect(result.settings.commit_style).toBe('per-batch')
    })
  })

  describe('persistence', () => {
    it('writes changes back to pipeline.yaml', async () => {
      await manager.execute({
        operation: 'add_strategy',
        strategy: 'my-strategy',
        config: { prompt: '.invoke/strategies/my-strategy.md' },
      })

      const raw = await readFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), 'utf-8')
      expect(raw).toContain('my-strategy')
    })
  })
})
