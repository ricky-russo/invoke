import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { DispatchEngine } from '../../src/dispatch/engine.js'
import type { InvokeConfig, AgentResult, ProviderEntry } from '../../src/types.js'
import type { Provider } from '../../src/providers/base.js'
import type { Parser, ParseContext } from '../../src/parsers/base.js'

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

vi.mock('../../src/dispatch/prompt-composer.js', () => ({
  composePrompt: vi.fn().mockResolvedValue('mocked prompt content'),
}))

vi.mock('../../src/config.js', () => ({
  loadConfig: vi.fn(),
}))

vi.mock('../../src/metrics/pricing.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/metrics/pricing.js')>(
    '../../src/metrics/pricing.js'
  )

  return {
    ...actual,
    estimateCost: vi.fn(actual.estimateCost),
  }
})

import { spawn } from 'child_process'
import { loadConfig } from '../../src/config.js'
import { estimateCost } from '../../src/metrics/pricing.js'
import { composePrompt } from '../../src/dispatch/prompt-composer.js'

const TEST_PROJECT_DIR = '/tmp/test-project'
const MOCK_PROMPT = 'mocked prompt content'

const CLAUDE_ENTRY: ProviderEntry = {
  provider: 'claude',
  model: 'opus-4.6',
  effort: 'high',
}

const CODEX_ENTRY: ProviderEntry = {
  provider: 'codex',
  model: 'gpt-5.4',
  effort: 'high',
}

interface SpawnBehavior {
  stdout?: string
  stderr?: string
  exitCode?: number | null
  closeOnKill?: boolean
  closeDelayMs?: number
}

function queueSpawnBehaviors(...behaviors: SpawnBehavior[]): void {
  const mockSpawnFn = vi.mocked(spawn)
  mockSpawnFn.mockImplementation(() => {
    const behavior = behaviors.shift()
    if (!behavior) {
      throw new Error('Unexpected spawn call')
    }

    const proc = new EventEmitter() as any
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.pid = 12345
    proc.kill = vi.fn(() => {
      if (behavior.closeOnKill) {
        setTimeout(() => {
          proc.emit('close', behavior.exitCode ?? null)
        }, 0)
      }
      return true
    })

    if (!behavior.closeOnKill) {
      setTimeout(() => {
        if (behavior.stdout) {
          proc.stdout.emit('data', Buffer.from(behavior.stdout))
        }

        if (behavior.stderr) {
          proc.stderr.emit('data', Buffer.from(behavior.stderr))
        }

        proc.emit('close', behavior.exitCode ?? 0)
      }, behavior.closeDelayMs ?? 0)
    }

    return proc
  })
}

function makeConfig(options: {
  role?: string
  subrole?: string
  prompt?: string
  providers?: ProviderEntry[]
  strategies?: InvokeConfig['strategies']
  roleProviderMode?: 'parallel' | 'fallback' | 'single'
  defaultProviderMode?: 'parallel' | 'fallback' | 'single'
  agentTimeout?: number
} = {}): InvokeConfig {
  const role = options.role ?? 'researcher'
  const subrole = options.subrole ?? 'codebase'
  const prompt = options.prompt ?? '.invoke/roles/researcher/codebase.md'
  const providers = structuredClone(options.providers ?? [CLAUDE_ENTRY])

  return {
    providers: {
      claude: { cli: 'claude', args: ['--print', '--model', '{{model}}'] },
      codex: { cli: 'codex', args: ['--model', '{{model}}'] },
    },
    roles: {
      [role]: {
        [subrole]: {
          prompt,
          providers,
          provider_mode: options.roleProviderMode,
        },
      },
    },
    strategies: options.strategies ?? {},
    settings: {
      default_strategy: 'tdd',
      agent_timeout: options.agentTimeout ?? 5,
      commit_style: 'per-batch',
      work_branch_prefix: 'invoke/work',
      default_provider_mode: options.defaultProviderMode,
    },
  }
}

function makeParsedResult(
  context: ParseContext,
  rawOutput: string,
  exitCode: number
): AgentResult {
  if (exitCode !== 0) {
    return {
      role: context.role,
      subrole: context.subrole,
      provider: context.provider,
      model: context.model,
      status: 'error',
      output: {
        summary: `Agent exited with code ${exitCode}`,
        raw: rawOutput,
      },
      duration: context.duration,
    }
  }

  return {
    role: context.role,
    subrole: context.subrole,
    provider: context.provider,
    model: context.model,
    status: 'success',
    output: {
      summary: `${context.provider} done`,
      findings: context.role === 'reviewer' ? [] : undefined,
      raw: rawOutput,
    },
    duration: context.duration,
  }
}

function makeProvider(name: string): { provider: Provider; buildCommand: ReturnType<typeof vi.fn> } {
  const buildCommand = vi.fn().mockImplementation(({ prompt }: { prompt: string }) => ({
    cmd: name,
    args: ['--prompt', prompt],
  }))

  return {
    provider: {
      name,
      buildCommand,
    },
    buildCommand,
  }
}

function makeParser(name: string): { parser: Parser; parse: ReturnType<typeof vi.fn> } {
  const parse = vi.fn((rawOutput: string, exitCode: number, context: ParseContext) =>
    makeParsedResult(context, rawOutput, exitCode)
  )

  return {
    parser: {
      name,
      parse,
    },
    parse,
  }
}

function createEngine(
  config: InvokeConfig,
  options: {
    onDispatchComplete?: (metric: any) => void
    providers?: Map<string, Provider>
    parsers?: Map<string, Parser>
  } = {}
) {
  vi.mocked(loadConfig).mockResolvedValue(config)

  const claudeProvider = makeProvider('claude')
  const codexProvider = makeProvider('codex')
  const claudeParser = makeParser('claude')
  const codexParser = makeParser('codex')

  const providers = options.providers ?? new Map([
    ['claude', claudeProvider.provider],
    ['codex', codexProvider.provider],
  ])

  const parsers = options.parsers ?? new Map([
    ['claude', claudeParser.parser],
    ['codex', codexParser.parser],
  ])

  const engine = new DispatchEngine({
    providers,
    parsers,
    projectDir: TEST_PROJECT_DIR,
    onDispatchComplete: options.onDispatchComplete,
  })

  return {
    engine,
    claudeBuildCommand: claudeProvider.buildCommand,
    codexBuildCommand: codexProvider.buildCommand,
    claudeParse: claudeParser.parse,
    codexParse: codexParser.parse,
  }
}

describe('DispatchEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('dispatches to a single provider and returns the parsed result', async () => {
    queueSpawnBehaviors({ stdout: 'Research output', exitCode: 0 })
    const config = makeConfig()
    const { engine, claudeBuildCommand } = createEngine(config)

    const result = await engine.dispatch({
      role: 'researcher',
      subrole: 'codebase',
      taskContext: { task_description: 'Analyze' },
    })

    expect(claudeBuildCommand).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('success')
    expect(result.provider).toBe('claude')
  })

  it('passes the configured strategy prompt to composePrompt when taskContext.strategy is set', async () => {
    queueSpawnBehaviors({ stdout: 'Research output', exitCode: 0 })
    const config = makeConfig({
      strategies: {
        tdd: {
          prompt: '.invoke/strategies/tdd.md',
        },
      },
    })
    const { engine } = createEngine(config)

    await engine.dispatch({
      role: 'researcher',
      subrole: 'codebase',
      taskContext: {
        task_description: 'Analyze',
        strategy: 'tdd',
      },
    })

    expect(composePrompt).toHaveBeenCalledWith({
      projectDir: TEST_PROJECT_DIR,
      promptPath: '.invoke/roles/researcher/codebase.md',
      strategyPath: '.invoke/strategies/tdd.md',
      taskContext: {
        task_description: 'Analyze',
        strategy: 'tdd',
      },
    })
  })

  it('dispatches to multiple providers in parallel and merges the results', async () => {
    queueSpawnBehaviors(
      { stdout: 'Claude review', exitCode: 0, closeDelayMs: 5 },
      { stdout: 'Codex review', exitCode: 0 }
    )

    const config = makeConfig({
      role: 'reviewer',
      subrole: 'security',
      prompt: '.invoke/roles/reviewer/security.md',
      providers: [CLAUDE_ENTRY, CODEX_ENTRY],
    })
    const { engine, claudeBuildCommand, codexBuildCommand } = createEngine(config)

    const result = await engine.dispatch({
      role: 'reviewer',
      subrole: 'security',
      taskContext: { task_description: 'Review auth' },
    })

    expect(result.status).toBe('success')
    expect(result.provider).toBe('claude+codex')
    expect(claudeBuildCommand).toHaveBeenCalledTimes(1)
    expect(codexBuildCommand).toHaveBeenCalledTimes(1)
  })

  it('populates provider_counts on merged multi-provider results with divergence', async () => {
    queueSpawnBehaviors(
      { stdout: 'Claude review', exitCode: 0, closeDelayMs: 5 },
      { stdout: 'Codex review', exitCode: 0 }
    )

    const reviewerParsers = new Map<string, Parser>([
      [
        'claude',
        {
          name: 'claude',
          parse: vi.fn((rawOutput: string, exitCode: number, context: ParseContext): AgentResult => ({
            role: context.role,
            subrole: context.subrole,
            provider: context.provider,
            model: context.model,
            status: exitCode === 0 ? 'success' : 'error',
            output: {
              summary: 'claude done',
              findings: [],
              raw: rawOutput,
            },
            duration: context.duration,
          })),
        },
      ],
      [
        'codex',
        {
          name: 'codex',
          parse: vi.fn((rawOutput: string, exitCode: number, context: ParseContext): AgentResult => ({
            role: context.role,
            subrole: context.subrole,
            provider: context.provider,
            model: context.model,
            status: exitCode === 0 ? 'success' : 'error',
            output: {
              summary: 'codex done',
              findings: [
                {
                  issue: 'Missing authz check',
                  severity: 'high',
                  file: 'src/auth.ts',
                  line: 12,
                  suggestion: 'Validate permissions before action',
                },
                {
                  issue: 'Token leak in logs',
                  severity: 'medium',
                  file: 'src/logger.ts',
                  line: 28,
                  suggestion: 'Redact tokens before logging',
                },
              ],
              raw: rawOutput,
            },
            duration: context.duration,
          })),
        },
      ],
    ])
    const config = makeConfig({
      role: 'reviewer',
      subrole: 'security',
      prompt: '.invoke/roles/reviewer/security.md',
      providers: [CLAUDE_ENTRY, CODEX_ENTRY],
    })
    const { engine } = createEngine(config, { parsers: reviewerParsers })

    const result = await engine.dispatch({
      role: 'reviewer',
      subrole: 'security',
      taskContext: { task_description: 'Review auth' },
    })

    expect(result.output.provider_counts).toEqual({ claude: 0, codex: 2 })
    expect(result.output.findings).toHaveLength(2)
  })

  it('populates provider_counts on multi-provider merged results when all providers return zero findings', async () => {
    queueSpawnBehaviors(
      { stdout: 'Claude review', exitCode: 0, closeDelayMs: 5 },
      { stdout: 'Codex review', exitCode: 0 }
    )

    const reviewerParsers = new Map<string, Parser>([
      [
        'claude',
        {
          name: 'claude',
          parse: vi.fn((rawOutput: string, exitCode: number, context: ParseContext): AgentResult => ({
            role: context.role,
            subrole: context.subrole,
            provider: context.provider,
            model: context.model,
            status: exitCode === 0 ? 'success' : 'error',
            output: {
              summary: 'claude done',
              findings: [],
              raw: rawOutput,
            },
            duration: context.duration,
          })),
        },
      ],
      [
        'codex',
        {
          name: 'codex',
          parse: vi.fn((rawOutput: string, exitCode: number, context: ParseContext): AgentResult => ({
            role: context.role,
            subrole: context.subrole,
            provider: context.provider,
            model: context.model,
            status: exitCode === 0 ? 'success' : 'error',
            output: {
              summary: 'codex done',
              findings: [],
              raw: rawOutput,
            },
            duration: context.duration,
          })),
        },
      ],
    ])
    const config = makeConfig({
      role: 'reviewer',
      subrole: 'security',
      prompt: '.invoke/roles/reviewer/security.md',
      providers: [CLAUDE_ENTRY, CODEX_ENTRY],
    })
    const { engine } = createEngine(config, { parsers: reviewerParsers })

    const result = await engine.dispatch({
      role: 'reviewer',
      subrole: 'security',
      taskContext: { task_description: 'Review auth' },
    })

    expect(result.output.provider_counts).toEqual({ claude: 0, codex: 0 })
  })

  it('omits provider_counts on single-provider dispatch', async () => {
    queueSpawnBehaviors({ stdout: 'Claude review', exitCode: 0 })

    const config = makeConfig({
      role: 'reviewer',
      subrole: 'security',
      prompt: '.invoke/roles/reviewer/security.md',
      providers: [CLAUDE_ENTRY],
    })
    const { engine } = createEngine(config)

    const result = await engine.dispatch({
      role: 'reviewer',
      subrole: 'security',
      taskContext: { task_description: 'Review auth' },
    })

    expect(result.output.provider_counts).toBeUndefined()
  })

  it('uses settings default single mode by dispatching only to providers[0]', async () => {
    queueSpawnBehaviors({ stdout: 'Claude only', exitCode: 0 })

    const config = makeConfig({
      providers: [CLAUDE_ENTRY, CODEX_ENTRY],
      defaultProviderMode: 'single',
    })
    const { engine, claudeBuildCommand, codexBuildCommand } = createEngine(config)

    const result = await engine.dispatch({
      role: 'researcher',
      subrole: 'codebase',
      taskContext: { task_description: 'Analyze' },
    })

    expect(result.provider).toBe('claude')
    expect(claudeBuildCommand).toHaveBeenCalledTimes(1)
    expect(codexBuildCommand).not.toHaveBeenCalled()
  })

  it('stops fallback dispatch after the first successful provider', async () => {
    queueSpawnBehaviors({ stdout: 'Claude success', exitCode: 0 })

    const config = makeConfig({
      providers: [CLAUDE_ENTRY, CODEX_ENTRY],
      roleProviderMode: 'fallback',
    })
    const { engine, claudeBuildCommand, codexBuildCommand } = createEngine(config)

    const result = await engine.dispatch({
      role: 'researcher',
      subrole: 'codebase',
      taskContext: { task_description: 'Analyze' },
    })

    expect(result.provider).toBe('claude')
    expect(claudeBuildCommand).toHaveBeenCalledTimes(1)
    expect(codexBuildCommand).not.toHaveBeenCalled()
  })

  it('advances fallback dispatch to the next provider on error', async () => {
    queueSpawnBehaviors(
      { stdout: 'Claude failed', exitCode: 1 },
      { stdout: 'Codex success', exitCode: 0 }
    )

    const config = makeConfig({
      providers: [CLAUDE_ENTRY, CODEX_ENTRY],
      roleProviderMode: 'fallback',
    })
    const { engine, claudeBuildCommand, codexBuildCommand } = createEngine(config)

    const result = await engine.dispatch({
      role: 'researcher',
      subrole: 'codebase',
      taskContext: { task_description: 'Analyze' },
    })

    expect(result.status).toBe('success')
    expect(result.provider).toBe('codex')
    expect(claudeBuildCommand).toHaveBeenCalledTimes(1)
    expect(codexBuildCommand).toHaveBeenCalledTimes(1)
  })

  it('advances fallback dispatch to the next provider on timeout', async () => {
    queueSpawnBehaviors(
      { closeOnKill: true },
      { stdout: 'Codex success', exitCode: 0 }
    )

    const config = makeConfig({
      providers: [
        { ...CLAUDE_ENTRY, timeout: 0.01 },
        CODEX_ENTRY,
      ],
      roleProviderMode: 'fallback',
    })
    const { engine, claudeParse, codexBuildCommand } = createEngine(config)

    const result = await engine.dispatch({
      role: 'researcher',
      subrole: 'codebase',
      taskContext: { task_description: 'Analyze' },
    })

    expect(result.status).toBe('success')
    expect(result.provider).toBe('codex')
    expect(claudeParse).not.toHaveBeenCalled()
    expect(codexBuildCommand).toHaveBeenCalledTimes(1)
  })

  it('returns the last failure result when all fallback providers fail', async () => {
    queueSpawnBehaviors(
      { stdout: 'Claude failed', exitCode: 1 },
      { stdout: 'Codex failed', exitCode: 1 }
    )

    const config = makeConfig({
      providers: [CLAUDE_ENTRY, CODEX_ENTRY],
      roleProviderMode: 'fallback',
    })
    const { engine } = createEngine(config)

    const result = await engine.dispatch({
      role: 'researcher',
      subrole: 'codebase',
      taskContext: { task_description: 'Analyze' },
    })

    expect(result.status).toBe('error')
    expect(result.provider).toBe('codex')
    expect(result.output.summary).toContain('1')
  })

  it('classifies timed out dispatches explicitly as timeout', async () => {
    queueSpawnBehaviors({ closeOnKill: true })

    const config = makeConfig({
      providers: [{ ...CLAUDE_ENTRY, timeout: 0.01 }],
    })
    const { engine, claudeParse } = createEngine(config)

    const result = await engine.dispatch({
      role: 'researcher',
      subrole: 'codebase',
      taskContext: { task_description: 'Analyze' },
    })

    expect(result.status).toBe('timeout')
    expect(result.output.summary).toContain('10ms')
    expect(claudeParse).not.toHaveBeenCalled()
  })

  it('calls onDispatchComplete after each provider dispatch completes', async () => {
    queueSpawnBehaviors(
      { stdout: 'Claude review', exitCode: 0, closeDelayMs: 5 },
      { stdout: 'Codex review', exitCode: 0 }
    )

    const onDispatchComplete = vi.fn()
    const config = makeConfig({
      role: 'reviewer',
      subrole: 'security',
      prompt: '.invoke/roles/reviewer/security.md',
      providers: [CLAUDE_ENTRY, CODEX_ENTRY],
    })
    const { engine } = createEngine(config, { onDispatchComplete })

    await engine.dispatch({
      role: 'reviewer',
      subrole: 'security',
      taskContext: {
        task_description: 'Review auth',
        pipeline_id: 'pipeline-123',
        stage: 'review',
      },
    })

    expect(onDispatchComplete).toHaveBeenCalledTimes(2)
    expect(estimateCost).toHaveBeenCalledTimes(2)
    expect(vi.mocked(estimateCost).mock.calls).toEqual(
      expect.arrayContaining([
        ['opus-4.6', MOCK_PROMPT.length, 'Claude review'.length],
        ['gpt-5.4', MOCK_PROMPT.length, 'Codex review'.length],
      ])
    )

    const metrics = onDispatchComplete.mock.calls.map(([metric]) => metric)
    expect(metrics.map(metric => metric.provider).sort()).toEqual(['claude', 'codex'])

    const claudeMetric = metrics.find(metric => metric.provider === 'claude')
    expect(claudeMetric).toMatchObject({
      pipeline_id: 'pipeline-123',
      stage: 'review',
      role: 'reviewer',
      subrole: 'security',
      provider: 'claude',
      model: 'opus-4.6',
      effort: 'high',
      prompt_size_chars: MOCK_PROMPT.length,
      output_size_chars: 'Claude review'.length,
      estimated_input_tokens: 6,
      estimated_output_tokens: 4,
      estimated_cost_usd: 0.00039,
      status: 'success',
    })
    expect(claudeMetric.duration_ms).toEqual(expect.any(Number))
    expect(claudeMetric.started_at).toEqual(expect.any(String))

    const codexMetric = metrics.find(metric => metric.provider === 'codex')
    expect(codexMetric).toMatchObject({
      pipeline_id: 'pipeline-123',
      stage: 'review',
      role: 'reviewer',
      subrole: 'security',
      provider: 'codex',
      model: 'gpt-5.4',
      effort: 'high',
      prompt_size_chars: MOCK_PROMPT.length,
      output_size_chars: 'Codex review'.length,
      estimated_input_tokens: 6,
      estimated_output_tokens: 3,
      estimated_cost_usd: 0.000036,
      status: 'success',
    })
    expect(codexMetric.duration_ms).toEqual(expect.any(Number))
    expect(codexMetric.started_at).toEqual(expect.any(String))
  })

  it('prefers boundPipelineId over taskContext.pipeline_id for session metric writes', async () => {
    queueSpawnBehaviors({ stdout: 'Bound output', exitCode: 0 })

    const onDispatchComplete = vi.fn()
    const { engine } = createEngine(makeConfig(), { onDispatchComplete })

    await engine.dispatch({
      role: 'researcher',
      subrole: 'codebase',
      taskContext: {
        task_description: 'Analyze',
        pipeline_id: 'attacker-pipe',
      },
      sessionId: 'session-bound',
      boundPipelineId: 'real-pipe',
    })

    expect(onDispatchComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        pipeline_id: 'real-pipe',
      })
    )
    expect(onDispatchComplete).not.toHaveBeenCalledWith(
      expect.objectContaining({
        pipeline_id: 'attacker-pipe',
      })
    )
  })

  it('skips metric recording and warns when a session dispatch has no bound pipeline id', async () => {
    queueSpawnBehaviors({ stdout: 'Bootstrap work', exitCode: 0 })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onDispatchComplete = vi.fn()
    const { engine } = createEngine(makeConfig(), { onDispatchComplete })

    try {
      await engine.dispatch({
        role: 'researcher',
        subrole: 'codebase',
        taskContext: { task_description: 'Bootstrap session' },
        sessionId: 'session-bootstrap',
        boundPipelineId: null,
      })

      expect(onDispatchComplete).not.toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalledWith(
        'Skipping metric record - session dispatch missing bound pipeline_id'
      )
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('skips metric recording when a session dispatch has no bound pipeline id and taskContext supplies one', async () => {
    queueSpawnBehaviors({ stdout: 'Bootstrap work', exitCode: 0 })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onDispatchComplete = vi.fn()
    const { engine } = createEngine(makeConfig(), { onDispatchComplete })

    try {
      await engine.dispatch({
        role: 'researcher',
        subrole: 'codebase',
        taskContext: {
          task_description: 'Bootstrap session',
          pipeline_id: 'attacker-pipe',
        },
        sessionId: 'session-bootstrap',
        boundPipelineId: null,
      })

      expect(onDispatchComplete).not.toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalledWith(
        'Skipping metric record - session dispatch missing bound pipeline_id'
      )
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('skips metric recording without warning for non-session dispatches that have no pipeline id', async () => {
    queueSpawnBehaviors({ stdout: 'Bootstrap work', exitCode: 0 })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onDispatchComplete = vi.fn()
    const { engine } = createEngine(makeConfig(), { onDispatchComplete })

    try {
      await engine.dispatch({
        role: 'researcher',
        subrole: 'codebase',
        taskContext: { task_description: 'Bootstrap dispatch' },
      })

      expect(onDispatchComplete).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('uses parsed raw output length for metrics and cost estimation when available', async () => {
    queueSpawnBehaviors({ stderr: 'stderr diagnostics', exitCode: 1 })

    const rawOutput = 'normalized stderr'
    const parse = vi.fn((_: string, __: number, context: ParseContext): AgentResult => ({
      role: context.role,
      subrole: context.subrole,
      provider: context.provider,
      model: context.model,
      status: 'error',
      output: {
        summary: 'parsed stderr',
        raw: rawOutput,
      },
      duration: context.duration,
    }))
    const onDispatchComplete = vi.fn()
    const parsers = new Map<string, Parser>([
      ['claude', { name: 'claude', parse }],
      ['codex', { name: 'codex', parse: vi.fn() }],
    ])
    const { engine } = createEngine(makeConfig(), {
      onDispatchComplete,
      parsers,
    })

    await engine.dispatch({
      role: 'researcher',
      subrole: 'codebase',
      taskContext: {
        task_description: 'Analyze',
        pipeline_id: 'pipeline-output-size',
      },
      sessionId: 'session-output-size',
      boundPipelineId: 'pipeline-output-size',
    })

    expect(parse).toHaveBeenCalledWith(
      '[stderr] stderr diagnostics',
      1,
      expect.objectContaining({
        provider: 'claude',
        model: 'opus-4.6',
      })
    )
    expect(estimateCost).toHaveBeenCalledWith('opus-4.6', MOCK_PROMPT.length, rawOutput.length)
    expect(onDispatchComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        output_size_chars: rawOutput.length,
      })
    )
  })

  it('resolveProviderMode uses role config before settings default before parallel', () => {
    const { engine } = createEngine(makeConfig())

    const explicitFallback = makeConfig({
      providers: [CLAUDE_ENTRY, CODEX_ENTRY],
      roleProviderMode: 'fallback',
      defaultProviderMode: 'single',
    })
    expect(
      (engine as any).resolveProviderMode(explicitFallback.roles.researcher.codebase, explicitFallback)
    ).toBe('fallback')

    const defaultSingle = makeConfig({
      providers: [CLAUDE_ENTRY, CODEX_ENTRY],
      defaultProviderMode: 'single',
    })
    expect(
      (engine as any).resolveProviderMode(defaultSingle.roles.researcher.codebase, defaultSingle)
    ).toBe('single')

    const implicitParallel = makeConfig({
      providers: [CLAUDE_ENTRY, CODEX_ENTRY],
    })
    expect(
      (engine as any).resolveProviderMode(implicitParallel.roles.researcher.codebase, implicitParallel)
    ).toBe('parallel')
  })

  it('resolveProviderMode returns single when there is only one provider', () => {
    const { engine } = createEngine(makeConfig())
    const singleProviderConfig = makeConfig({
      providers: [CLAUDE_ENTRY],
      roleProviderMode: 'parallel',
      defaultProviderMode: 'fallback',
    })

    expect(
      (engine as any).resolveProviderMode(singleProviderConfig.roles.researcher.codebase, singleProviderConfig)
    ).toBe('single')
  })

  it('throws when role is not found', async () => {
    const { engine } = createEngine(makeConfig())

    await expect(
      engine.dispatch({ role: 'nonexistent', subrole: 'test', taskContext: {} })
    ).rejects.toThrow('Role not found: nonexistent.test')
  })

  it('throws when provider is not found', async () => {
    const config = makeConfig({
      providers: [{ provider: 'unknown', model: 'x', effort: 'high' }],
    })
    const { engine } = createEngine(config)

    await expect(
      engine.dispatch({ role: 'researcher', subrole: 'codebase', taskContext: {} })
    ).rejects.toThrow('Provider not found: unknown')
  })

  it('re-reads config on each dispatch to pick up mid-session edits', async () => {
    queueSpawnBehaviors(
      { stdout: 'First output', exitCode: 0 },
      { stdout: 'Second output', exitCode: 0 }
    )

    const firstConfig = makeConfig()
    const updatedConfig = makeConfig({
      providers: [{ ...CLAUDE_ENTRY, model: 'claude-opus-4-6' }],
    })

    vi.mocked(loadConfig)
      .mockResolvedValueOnce(firstConfig)
      .mockResolvedValueOnce(updatedConfig)

    const { engine, claudeBuildCommand } = createEngine(firstConfig)

    await engine.dispatch({
      role: 'researcher',
      subrole: 'codebase',
      taskContext: { task_description: 'First' },
    })

    await engine.dispatch({
      role: 'researcher',
      subrole: 'codebase',
      taskContext: { task_description: 'Second' },
    })

    expect(loadConfig).toHaveBeenCalledWith(TEST_PROJECT_DIR)
    expect(loadConfig).toHaveBeenCalledTimes(2)
    expect(claudeBuildCommand).toHaveBeenCalledTimes(2)
  })
})
