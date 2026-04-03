import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/config.js', () => ({
  loadConfig: vi.fn(),
}))

import { loadConfig } from '../../src/config.js'
import type { InvokeConfig } from '../../src/types.js'

const testConfig: InvokeConfig = {
  providers: {
    claude: { cli: 'claude', args: ['--print', '--model', '{{model}}'] },
  },
  roles: {
    builder: {
      default: {
        prompt: '.invoke/roles/builder/default.md',
        providers: [{ provider: 'claude', model: 'claude-sonnet-4-6', effort: 'medium' as const }],
      },
    },
  },
  strategies: {},
  settings: {
    default_strategy: 'tdd',
    agent_timeout: 300,
    commit_style: 'per-batch' as const,
    work_branch_prefix: 'invoke/work',
  },
}

describe('dispatch batch response', () => {
  beforeEach(() => {
    vi.mocked(loadConfig).mockResolvedValue(testConfig)
  })

  it('resolves provider info from current pipeline config', async () => {
    const config = await loadConfig('/tmp/test')
    const tasks = [
      { task_id: 'task-1', role: 'builder', subrole: 'default', task_context: {} },
    ]

    const taskProviders = tasks.map(t => {
      const roleConfig = config.roles[t.role]?.[t.subrole]
      return {
        task_id: t.task_id,
        providers: roleConfig?.providers.map(p => ({
          provider: p.provider,
          model: p.model,
          effort: p.effort,
        })) ?? [],
      }
    })

    expect(taskProviders).toHaveLength(1)
    expect(taskProviders[0].task_id).toBe('task-1')
    expect(taskProviders[0].providers).toHaveLength(1)
    expect(taskProviders[0].providers[0]).toEqual({
      provider: 'claude',
      model: 'claude-sonnet-4-6',
      effort: 'medium',
    })
  })

  it('returns empty providers for unknown role', async () => {
    const config = await loadConfig('/tmp/test')
    const tasks = [
      { task_id: 'task-1', role: 'nonexistent', subrole: 'nope', task_context: {} },
    ]

    const taskProviders = tasks.map(t => {
      const roleConfig = config.roles[t.role]?.[t.subrole]
      return {
        task_id: t.task_id,
        providers: roleConfig?.providers.map(p => ({
          provider: p.provider,
          model: p.model,
          effort: p.effort,
        })) ?? [],
      }
    })

    expect(taskProviders[0].providers).toEqual([])
  })
})
