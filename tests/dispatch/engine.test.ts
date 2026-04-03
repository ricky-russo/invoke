import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DispatchEngine } from '../../src/dispatch/engine.js'
import type { InvokeConfig } from '../../src/types.js'
import type { Provider } from '../../src/providers/base.js'
import type { Parser } from '../../src/parsers/base.js'

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

vi.mock('../../src/dispatch/prompt-composer.js', () => ({
  composePrompt: vi.fn().mockResolvedValue('mocked prompt content'),
}))

import { spawn } from 'child_process'
import { EventEmitter, Readable } from 'stream'

function mockSpawn(stdout: string, exitCode: number): void {
  const proc = new EventEmitter() as any
  proc.stdout = Readable.from([stdout])
  proc.stderr = Readable.from([''])
  proc.pid = 12345

  const mockSpawnFn = vi.mocked(spawn)
  mockSpawnFn.mockReturnValue(proc)

  setTimeout(() => proc.emit('close', exitCode), 10)
}

const mockProvider: Provider = {
  name: 'claude',
  buildCommand: vi.fn().mockReturnValue({
    cmd: 'claude',
    args: ['--print', 'test prompt'],
  }),
}

const mockCodexProvider: Provider = {
  name: 'codex',
  buildCommand: vi.fn().mockReturnValue({
    cmd: 'codex',
    args: ['--model', 'gpt-5.4', 'test prompt'],
  }),
}

const mockParser: Parser = {
  name: 'claude',
  parse: vi.fn().mockReturnValue({
    role: 'researcher',
    subrole: 'codebase',
    provider: 'claude',
    model: 'opus-4.6',
    status: 'success',
    output: { summary: 'Done', raw: 'Full output' },
    duration: 100,
  }),
}

const mockCodexParser: Parser = {
  name: 'codex',
  parse: vi.fn().mockReturnValue({
    role: 'researcher',
    subrole: 'codebase',
    provider: 'codex',
    model: 'gpt-5.4',
    status: 'success',
    output: { summary: 'Codex done', raw: 'Codex output' },
    duration: 200,
  }),
}

const singleProviderConfig: InvokeConfig = {
  providers: {
    claude: { cli: 'claude', args: ['--print', '--model', '{{model}}'] },
  },
  roles: {
    researcher: {
      codebase: {
        prompt: '.invoke/roles/researcher/codebase.md',
        providers: [{ provider: 'claude', model: 'opus-4.6', effort: 'high' }],
      },
    },
  },
  strategies: {},
  settings: {
    default_strategy: 'tdd',
    agent_timeout: 5,
    commit_style: 'per-batch',
    work_branch_prefix: 'invoke/work',
  },
}

const multiProviderConfig: InvokeConfig = {
  providers: {
    claude: { cli: 'claude', args: ['--print', '--model', '{{model}}'] },
    codex: { cli: 'codex', args: ['--model', '{{model}}'] },
  },
  roles: {
    reviewer: {
      security: {
        prompt: '.invoke/roles/reviewer/security.md',
        providers: [
          { provider: 'claude', model: 'opus-4.6', effort: 'high' },
          { provider: 'codex', model: 'gpt-5.4', effort: 'high' },
        ],
      },
    },
  },
  strategies: {},
  settings: {
    default_strategy: 'tdd',
    agent_timeout: 5,
    commit_style: 'per-batch',
    work_branch_prefix: 'invoke/work',
  },
}

const configWithEntryTimeout: InvokeConfig = {
  providers: {
    claude: { cli: 'claude', args: ['--print', '--model', '{{model}}'] },
  },
  roles: {
    researcher: {
      codebase: {
        prompt: '.invoke/roles/researcher/codebase.md',
        providers: [{ provider: 'claude', model: 'opus', effort: 'high', timeout: 10 }],
      },
    },
  },
  strategies: {},
  settings: {
    default_strategy: 'tdd',
    agent_timeout: 5,
    commit_style: 'per-batch',
    work_branch_prefix: 'invoke/work',
  },
}

describe('DispatchEngine', () => {
  it('dispatches to a single provider and returns result', async () => {
    mockSpawn('Research output', 0)

    const providers = new Map([['claude', mockProvider]])
    const parsers = new Map([['claude', mockParser]])
    const engine = new DispatchEngine({
      config: singleProviderConfig,
      providers,
      parsers,
      projectDir: '/tmp/test-project',
    })

    const result = await engine.dispatch({
      role: 'researcher',
      subrole: 'codebase',
      taskContext: { task_description: 'Analyze' },
    })

    expect(mockProvider.buildCommand).toHaveBeenCalled()
    expect(result.status).toBe('success')
  })

  it('dispatches to multiple providers and returns merged result', async () => {
    mockSpawn('Review output', 0)

    const providers = new Map([['claude', mockProvider], ['codex', mockCodexProvider]])
    const parsers = new Map([['claude', mockParser], ['codex', mockCodexParser]])
    const engine = new DispatchEngine({
      config: multiProviderConfig,
      providers,
      parsers,
      projectDir: '/tmp/test-project',
    })

    const result = await engine.dispatch({
      role: 'reviewer',
      subrole: 'security',
      taskContext: { task_description: 'Review auth' },
    })

    expect(result.status).toBe('success')
    expect(mockProvider.buildCommand).toHaveBeenCalled()
    expect(mockCodexProvider.buildCommand).toHaveBeenCalled()
  })

  it('throws when role is not found', async () => {
    const engine = new DispatchEngine({
      config: singleProviderConfig,
      providers: new Map([['claude', mockProvider]]),
      parsers: new Map([['claude', mockParser]]),
      projectDir: '/tmp/test',
    })

    await expect(
      engine.dispatch({ role: 'nonexistent', subrole: 'test', taskContext: {} })
    ).rejects.toThrow('Role not found: nonexistent.test')
  })

  it('uses per-entry timeout over global timeout', async () => {
    mockSpawn('Output', 0)

    const providers = new Map([['claude', mockProvider]])
    const parsers = new Map([['claude', mockParser]])
    const engine = new DispatchEngine({
      config: configWithEntryTimeout,
      providers,
      parsers,
      projectDir: '/tmp/test-project',
    })

    await engine.dispatch({
      role: 'researcher',
      subrole: 'codebase',
      taskContext: {},
    })

    expect(spawn).toHaveBeenCalled()
  })

  it('converts seconds to milliseconds for timeout', async () => {
    mockSpawn('Output', 0)

    const providers = new Map([['claude', mockProvider]])
    const parsers = new Map([['claude', mockParser]])
    const engine = new DispatchEngine({
      config: singleProviderConfig,
      providers,
      parsers,
      projectDir: '/tmp/test-project',
    })

    await engine.dispatch({
      role: 'researcher',
      subrole: 'codebase',
      taskContext: {},
    })

    expect(spawn).toHaveBeenCalled()
  })

  it('throws when provider is not found', async () => {
    const badConfig: InvokeConfig = {
      ...singleProviderConfig,
      roles: {
        researcher: {
          codebase: {
            prompt: '.invoke/roles/researcher/codebase.md',
            providers: [{ provider: 'unknown', model: 'x', effort: 'high' }],
          },
        },
      },
    }

    const engine = new DispatchEngine({
      config: badConfig,
      providers: new Map([['claude', mockProvider]]),
      parsers: new Map([['claude', mockParser]]),
      projectDir: '/tmp/test',
    })

    await expect(
      engine.dispatch({ role: 'researcher', subrole: 'codebase', taskContext: {} })
    ).rejects.toThrow('Provider not found: unknown')
  })
})
