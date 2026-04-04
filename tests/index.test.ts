import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DispatchMetric, InvokeConfig } from '../src/types.js'

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  validateConfig: vi.fn(),
  createProviderRegistry: vi.fn(),
  createParserRegistry: vi.fn(),
  registerConfigTools: vi.fn(),
  registerDispatchTools: vi.fn(),
  registerWorktreeTools: vi.fn(),
  registerStateTools: vi.fn(),
  registerArtifactTools: vi.fn(),
  registerConfigUpdateTools: vi.fn(),
  registerContextTools: vi.fn(),
  registerMetricsTools: vi.fn(),
  checkForNewDefaults: vi.fn(),
  writeFile: vi.fn(),
  serverInstances: [] as any[],
  transportInstances: [] as any[],
  dispatchEngineInstances: [] as any[],
  batchManagerInstances: [] as any[],
  worktreeManagerInstances: [] as any[],
  stateManagerInstances: [] as any[],
  artifactManagerInstances: [] as any[],
  contextManagerInstances: [] as any[],
  metricsManagerInstances: [] as any[],
}))

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {
    options: unknown
    registerTool = vi.fn()
    connect = vi.fn().mockResolvedValue(undefined)

    constructor(options: unknown) {
      this.options = options
      mocks.serverInstances.push(this)
    }
  },
}))

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {
    constructor() {
      mocks.transportInstances.push(this)
    }
  },
}))

vi.mock('../src/config.js', () => ({
  loadConfig: mocks.loadConfig,
}))

vi.mock('../src/config-validator.js', () => ({
  validateConfig: mocks.validateConfig,
}))

vi.mock('../src/providers/registry.js', () => ({
  createProviderRegistry: mocks.createProviderRegistry,
}))

vi.mock('../src/parsers/registry.js', () => ({
  createParserRegistry: mocks.createParserRegistry,
}))

vi.mock('../src/dispatch/engine.js', () => ({
  DispatchEngine: class {
    options: unknown

    constructor(options: unknown) {
      this.options = options
      mocks.dispatchEngineInstances.push(this)
    }
  },
}))

vi.mock('../src/dispatch/batch-manager.js', () => ({
  BatchManager: class {
    args: unknown[]

    constructor(...args: unknown[]) {
      this.args = args
      mocks.batchManagerInstances.push(this)
    }
  },
}))

vi.mock('../src/worktree/manager.js', () => ({
  WorktreeManager: class {
    projectDir: string

    constructor(projectDir: string) {
      this.projectDir = projectDir
      mocks.worktreeManagerInstances.push(this)
    }
  },
}))

vi.mock('../src/tools/state.js', () => ({
  StateManager: class {
    projectDir: string

    constructor(projectDir: string) {
      this.projectDir = projectDir
      mocks.stateManagerInstances.push(this)
    }
  },
}))

vi.mock('../src/tools/artifacts.js', () => ({
  ArtifactManager: class {
    projectDir: string

    constructor(projectDir: string) {
      this.projectDir = projectDir
      mocks.artifactManagerInstances.push(this)
    }
  },
}))

vi.mock('../src/tools/context.js', () => ({
  ContextManager: class {
    projectDir: string

    constructor(projectDir: string) {
      this.projectDir = projectDir
      mocks.contextManagerInstances.push(this)
    }
  },
}))

vi.mock('../src/metrics/manager.js', () => ({
  MetricsManager: class {
    projectDir: string
    record = vi.fn()

    constructor(projectDir: string) {
      this.projectDir = projectDir
      mocks.metricsManagerInstances.push(this)
    }
  },
}))

vi.mock('../src/tools/config-tool.js', () => ({
  registerConfigTools: mocks.registerConfigTools,
}))

vi.mock('../src/tools/dispatch-tools.js', () => ({
  registerDispatchTools: mocks.registerDispatchTools,
}))

vi.mock('../src/tools/worktree-tools.js', () => ({
  registerWorktreeTools: mocks.registerWorktreeTools,
}))

vi.mock('../src/tools/state-tools.js', () => ({
  registerStateTools: mocks.registerStateTools,
}))

vi.mock('../src/tools/artifact-tools.js', () => ({
  registerArtifactTools: mocks.registerArtifactTools,
}))

vi.mock('../src/tools/config-update-tools.js', () => ({
  registerConfigUpdateTools: mocks.registerConfigUpdateTools,
}))

vi.mock('../src/tools/context-tools.js', () => ({
  registerContextTools: mocks.registerContextTools,
}))

vi.mock('../src/tools/metrics-tools.js', () => ({
  registerMetricsTools: mocks.registerMetricsTools,
}))

vi.mock('../src/defaults-checker.js', () => ({
  checkForNewDefaults: mocks.checkForNewDefaults,
}))

vi.mock('fs/promises', () => ({
  writeFile: mocks.writeFile,
}))

const TEST_CONFIG: InvokeConfig = {
  providers: {
    claude: {
      cli: 'claude',
      args: ['--print'],
    },
  },
  roles: {
    builder: {
      default: {
        prompt: '.invoke/roles/builder/default.md',
        providers: [{ provider: 'claude', model: 'opus-4.6', effort: 'medium' }],
      },
    },
  },
  strategies: {},
  settings: {
    default_strategy: 'default',
    agent_timeout: 60,
    commit_style: 'one-commit',
    work_branch_prefix: 'invoke',
  },
}

describe('index bootstrap', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()

    mocks.serverInstances.length = 0
    mocks.transportInstances.length = 0
    mocks.dispatchEngineInstances.length = 0
    mocks.batchManagerInstances.length = 0
    mocks.worktreeManagerInstances.length = 0
    mocks.stateManagerInstances.length = 0
    mocks.artifactManagerInstances.length = 0
    mocks.contextManagerInstances.length = 0
    mocks.metricsManagerInstances.length = 0

    mocks.validateConfig.mockResolvedValue({ warnings: [] })
    mocks.createProviderRegistry.mockReturnValue(new Map())
    mocks.createParserRegistry.mockReturnValue(new Map())
    mocks.checkForNewDefaults.mockResolvedValue([])
    mocks.writeFile.mockResolvedValue(undefined)

    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('instantiates MetricsManager, wires onDispatchComplete, and passes it to tool registration', async () => {
    mocks.loadConfig.mockResolvedValue(TEST_CONFIG)

    await import('../src/index.js')

    await vi.waitFor(() => {
      expect(mocks.registerMetricsTools).toHaveBeenCalledTimes(1)
      expect(mocks.registerDispatchTools).toHaveBeenCalledTimes(1)
    })

    const server = mocks.serverInstances[0]
    const metricsManager = mocks.metricsManagerInstances[0]
    const dispatchEngine = mocks.dispatchEngineInstances[0]
    const batchManager = mocks.batchManagerInstances[0]

    expect(metricsManager.projectDir).toBe(process.cwd())
    expect(mocks.registerMetricsTools).toHaveBeenCalledWith(server, metricsManager, process.cwd())
    expect(mocks.registerDispatchTools).toHaveBeenCalledWith(
      server,
      dispatchEngine,
      batchManager,
      process.cwd(),
      metricsManager
    )

    const metric: DispatchMetric = {
      pipeline_id: 'pipeline-123',
      stage: 'build',
      role: 'builder',
      subrole: 'default',
      provider: 'claude',
      model: 'opus-4.6',
      effort: 'medium',
      prompt_size_chars: 100,
      duration_ms: 250,
      status: 'success',
      started_at: '2026-04-04T12:00:00.000Z',
    }

    ;(dispatchEngine.options as { onDispatchComplete: (metric: DispatchMetric) => void }).onDispatchComplete(metric)
    expect(metricsManager.record).toHaveBeenCalledWith(metric)
  })

  it('registers metrics tools even when config loading fails', async () => {
    mocks.loadConfig.mockRejectedValue(new Error('missing pipeline config'))

    await import('../src/index.js')

    await vi.waitFor(() => {
      expect(mocks.registerMetricsTools).toHaveBeenCalledTimes(1)
    })

    expect(mocks.registerDispatchTools).not.toHaveBeenCalled()
    expect(mocks.metricsManagerInstances).toHaveLength(1)
  })
})
