import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm } from 'fs/promises'
import path from 'path'
import { stringify } from 'yaml'
import { DispatchEngine } from '../../src/dispatch/engine.js'
import { ClaudeParser } from '../../src/parsers/claude-parser.js'
import type { Provider, CommandSpec } from '../../src/providers/base.js'
import type { InvokeConfig } from '../../src/types.js'

const TEST_DIR = path.join(import.meta.dirname, 'fixtures', 'cli-spawn-test')

// Helper to build InvokeConfig with a custom provider name
function makeConfig(providerName: string, timeoutSeconds = 5): InvokeConfig {
  return {
    providers: {
      [providerName]: { cli: 'echo', args: [] },
    },
    roles: {
      researcher: {
        default: {
          prompt: '.invoke/roles/researcher/default.md',
          providers: [{ provider: providerName, model: 'fake-model', effort: 'low' }],
        },
      },
      reviewer: {
        security: {
          prompt: '.invoke/roles/reviewer/security.md',
          providers: [{ provider: providerName, model: 'fake-model', effort: 'low' }],
        },
      },
    },
    strategies: {},
    settings: {
      default_strategy: 'tdd',
      agent_timeout: timeoutSeconds,
      commit_style: 'per-batch',
      work_branch_prefix: 'invoke/work',
    },
  }
}

// Custom provider that wraps a fixed command spec
class FakeProvider implements Provider {
  constructor(
    public name: string,
    private spec: CommandSpec
  ) {}

  buildCommand(_params: { model: string; effort: string; workDir: string; prompt: string }): CommandSpec {
    return this.spec
  }
}

async function setupTestDir(extraDirs: string[] = []): Promise<void> {
  await mkdir(path.join(TEST_DIR, '.invoke', 'roles', 'researcher'), { recursive: true })
  await mkdir(path.join(TEST_DIR, '.invoke', 'roles', 'reviewer'), { recursive: true })
  for (const dir of extraDirs) {
    await mkdir(path.join(TEST_DIR, dir), { recursive: true })
  }
  await writeFile(
    path.join(TEST_DIR, '.invoke', 'roles', 'researcher', 'default.md'),
    '# Research\n\n{{task_description}}'
  )
  await writeFile(
    path.join(TEST_DIR, '.invoke', 'roles', 'reviewer', 'security.md'),
    '# Security Review\n\n{{task_description}}'
  )
}

async function writeConfigToDisk(config: InvokeConfig): Promise<void> {
  await writeFile(
    path.join(TEST_DIR, '.invoke', 'pipeline.yaml'),
    stringify(config)
  )
}

beforeEach(async () => {
  await setupTestDir()
})

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('CLI Spawn Integration Tests', () => {
  it('real process spawn captures stdout correctly', async () => {
    // Use `echo hello world` as the fake CLI — it writes to stdout and exits 0
    const provider = new FakeProvider('echo', {
      cmd: 'echo',
      args: ['hello', 'world'],
    })

    const config = makeConfig('echo')
    const parser = new ClaudeParser()
    // Map provider name 'echo' to the claude parser
    const parsers = new Map([['echo', parser]])
    const providers = new Map([['echo', provider]])

    const engine = new DispatchEngine({
      providers,
      parsers,
      projectDir: TEST_DIR,
    })

    await writeConfigToDisk(config)
    const result = await engine.dispatch({
      role: 'researcher',
      subrole: 'default',
      taskContext: { task_description: 'Test echo output' },
    })

    expect(result.status).toBe('success')
    expect(result.output.raw).toContain('hello world')
    expect(result.provider).toBe('echo')
    expect(result.model).toBe('fake-model')
    expect(result.duration).toBeGreaterThanOrEqual(0)
  })

  it('structured reviewer output from real process gets parsed into findings', async () => {
    // Use `printf` to emit markdown with the Finding format the claude parser understands
    const findingOutput = [
      '## Security Review',
      '',
      '### Finding 1',
      '**Severity:** high',
      '**File:** src/auth/login.ts',
      '**Line:** 42',
      '**Issue:** SQL injection via unsanitized input',
      '**Suggestion:** Use parameterized queries',
      '',
      '### Finding 2',
      '**Severity:** medium',
      '**File:** src/api/handler.ts',
      '**Line:** 15',
      '**Issue:** Missing rate limiting',
      '**Suggestion:** Add rate limiting middleware',
    ].join('\\n')

    const provider = new FakeProvider('printf', {
      cmd: 'printf',
      args: [findingOutput],
    })

    const config = makeConfig('printf')
    const parser = new ClaudeParser()
    const parsers = new Map([['printf', parser]])
    const providers = new Map([['printf', provider]])

    const engine = new DispatchEngine({
      providers,
      parsers,
      projectDir: TEST_DIR,
    })

    await writeConfigToDisk(config)
    const result = await engine.dispatch({
      role: 'reviewer',
      subrole: 'security',
      taskContext: { task_description: 'Review auth module' },
    })

    expect(result.status).toBe('success')
    expect(result.output.findings).toBeDefined()
    expect(result.output.findings!.length).toBeGreaterThanOrEqual(2)

    const highFinding = result.output.findings!.find(f => f.severity === 'high')
    expect(highFinding).toBeDefined()
    expect(highFinding!.file).toBe('src/auth/login.ts')
    expect(highFinding!.line).toBe(42)
    expect(highFinding!.issue).toContain('SQL injection')

    const mediumFinding = result.output.findings!.find(f => f.severity === 'medium')
    expect(mediumFinding).toBeDefined()
    expect(mediumFinding!.file).toBe('src/api/handler.ts')
  })

  it('non-zero exit codes are captured as errors', async () => {
    // Use `sh -c "echo error msg && exit 1"` — prints to stdout then exits with code 1
    const provider = new FakeProvider('sh', {
      cmd: 'sh',
      args: ['-c', 'echo "agent error occurred" && exit 1'],
    })

    const config = makeConfig('sh')
    const parser = new ClaudeParser()
    const parsers = new Map([['sh', parser]])
    const providers = new Map([['sh', provider]])

    const engine = new DispatchEngine({
      providers,
      parsers,
      projectDir: TEST_DIR,
    })

    await writeConfigToDisk(config)
    const result = await engine.dispatch({
      role: 'researcher',
      subrole: 'default',
      taskContext: { task_description: 'Test error handling' },
    })

    expect(result.status).toBe('error')
    expect(result.output.raw).toContain('agent error occurred')
    expect(result.output.summary).toContain('exit')
    expect(result.output.summary).toContain('1')
  })

  it('timeout kills long-running processes and result reflects the timeout', async () => {
    // Use `sleep 10` which will run far beyond our 500ms timeout
    const provider = new FakeProvider('sleep', {
      cmd: 'sleep',
      args: ['10'],
    })

    // 1 second timeout (engine converts to 1000ms)
    const config = makeConfig('sleep', 1)
    const parser = new ClaudeParser()
    const parsers = new Map([['sleep', parser]])
    const providers = new Map([['sleep', provider]])

    const engine = new DispatchEngine({
      providers,
      parsers,
      projectDir: TEST_DIR,
    })

    await writeConfigToDisk(config)
    const start = Date.now()
    const result = await engine.dispatch({
      role: 'researcher',
      subrole: 'default',
      taskContext: { task_description: 'Test timeout' },
    })
    const elapsed = Date.now() - start

    // The process should have been killed well before 10 seconds
    expect(elapsed).toBeLessThan(3000)

    // Engine resolves with exitCode -1 on timeout, which claude parser treats as error
    expect(result.status).toBe('error')
    // The raw output should contain the timeout message or be empty
    // (engine sets stdout to timeout message when stdout was empty)
    const raw = result.output.raw ?? ''
    const summary = result.output.summary ?? ''
    const hasTimeoutSignal = raw.includes('timed out') || raw.includes('1000') || summary.includes('exit') || summary.includes('-1')
    expect(hasTimeoutSignal).toBe(true)
  })
})
