import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DispatchEngine } from '../../src/dispatch/engine.js'
import type { InvokeConfig } from '../../src/types.js'
import type { Provider } from '../../src/providers/base.js'
import type { Parser } from '../../src/parsers/base.js'

// Mock child_process.spawn
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

// Mock composePrompt so tests don't try to read real files
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

  // Emit exit after a tick
  setTimeout(() => proc.emit('close', exitCode), 10)
}

const mockProvider: Provider = {
  name: 'claude',
  buildCommand: vi.fn().mockReturnValue({
    cmd: 'claude',
    args: ['--print', 'test prompt'],
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

const mockConfig: InvokeConfig = {
  providers: {
    claude: { cli: 'claude', args: ['--print', '--model', '{{model}}'] },
  },
  roles: {
    researcher: {
      codebase: {
        prompt: '.invoke/roles/researcher/codebase.md',
        provider: 'claude',
        model: 'opus-4.6',
        effort: 'high',
      },
    },
  },
  strategies: {},
  settings: {
    default_strategy: 'tdd',
    agent_timeout: 5000,
    commit_style: 'per-batch',
    work_branch_prefix: 'invoke/work',
  },
}

describe('DispatchEngine', () => {
  let engine: DispatchEngine

  beforeEach(() => {
    const providers = new Map([['claude', mockProvider]])
    const parsers = new Map([['claude', mockParser]])
    engine = new DispatchEngine({
      config: mockConfig,
      providers,
      parsers,
      projectDir: '/tmp/test-project',
    })
  })

  it('dispatches a single agent and returns a result', async () => {
    mockSpawn('Research output here', 0)

    const result = await engine.dispatch({
      role: 'researcher',
      subrole: 'codebase',
      taskContext: { task_description: 'Analyze the codebase' },
    })

    expect(mockProvider.buildCommand).toHaveBeenCalled()
    expect(result.status).toBe('success')
  })

  it('returns error when role is not found in config', async () => {
    await expect(
      engine.dispatch({
        role: 'nonexistent',
        subrole: 'test',
        taskContext: {},
      })
    ).rejects.toThrow('Role not found: nonexistent.test')
  })

  it('returns error when provider is not found', async () => {
    const badConfig = {
      ...mockConfig,
      roles: {
        researcher: {
          codebase: {
            ...mockConfig.roles.researcher.codebase,
            provider: 'unknown',
          },
        },
      },
    }
    const providers = new Map([['claude', mockProvider]])
    const parsers = new Map([['claude', mockParser]])
    const badEngine = new DispatchEngine({
      config: badConfig,
      providers,
      parsers,
      projectDir: '/tmp/test-project',
    })

    await expect(
      badEngine.dispatch({
        role: 'researcher',
        subrole: 'codebase',
        taskContext: {},
      })
    ).rejects.toThrow('Provider not found: unknown')
  })
})
