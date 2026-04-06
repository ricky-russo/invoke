import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'fs'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import type { PipelineState, SessionInfo } from '../src/types.js'

type RegisteredTool = {
  config: {
    inputSchema: {
      safeParse: (input: unknown) => { success: boolean }
    }
  }
  handler: (input: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text: string }>
    isError?: boolean
  }>
}

const mocks = vi.hoisted(() => ({
  serverInstances: [] as Array<{
    options: unknown
    tools: Map<string, RegisteredTool>
    registerTool: ReturnType<typeof vi.fn>
    connect: ReturnType<typeof vi.fn>
  }>,
  transportInstances: [] as unknown[],
  validateConfig: vi.fn(),
  checkForNewDefaults: vi.fn(),
}))

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {
    options: unknown
    tools = new Map<string, RegisteredTool>()
    registerTool = vi.fn((name: string, config: RegisteredTool['config'], handler: RegisteredTool['handler']) => {
      this.tools.set(name, { config, handler })
    })
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

vi.mock('../src/config-validator.js', () => ({
  validateConfig: mocks.validateConfig,
}))

vi.mock('../src/defaults-checker.js', () => ({
  checkForNewDefaults: mocks.checkForNewDefaults,
}))

const TEST_CONFIG = `
providers:
  claude:
    cli: claude
    args: ["--print", "--model", "{{model}}"]

roles:
  builder:
    default:
      prompt: .invoke/roles/builder/default.md
      providers:
        - provider: claude
          model: opus-4.6
          effort: medium

strategies:
  tdd:
    prompt: .invoke/strategies/tdd.md

settings:
  default_strategy: tdd
  agent_timeout: 60
  commit_style: one-commit
  work_branch_prefix: invoke
`

const LEGACY_STATE: PipelineState = {
  pipeline_id: 'legacy-pipeline',
  started: '2026-04-01T08:00:00.000Z',
  last_updated: '2026-04-05T09:00:00.000Z',
  current_stage: 'build',
  batches: [],
  review_cycles: [],
}

describe.sequential('index bootstrap smoke', () => {
  let projectDir: string

  beforeEach(async () => {
    vi.resetModules()
    mocks.serverInstances.length = 0
    mocks.transportInstances.length = 0
    mocks.validateConfig.mockResolvedValue({ warnings: [] })
    mocks.checkForNewDefaults.mockResolvedValue([])

    projectDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-bootstrap-smoke-'))
    await mkdir(path.join(projectDir, '.invoke'), { recursive: true })
    await writeFile(path.join(projectDir, '.invoke', 'pipeline.yaml'), TEST_CONFIG)
    await writeFile(path.join(projectDir, '.invoke', 'state.json'), JSON.stringify(LEGACY_STATE, null, 2))

    vi.spyOn(process, 'cwd').mockReturnValue(projectDir)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(projectDir, { recursive: true, force: true })
  })

  it('starts the server, migrates legacy state, and registers the full tool set', async () => {
    await import('../src/index.js')

    await vi.waitFor(() => {
      expect(mocks.serverInstances).toHaveLength(1)
      expect(mocks.transportInstances).toHaveLength(1)
    })

    const server = mocks.serverInstances[0]
    const toolNames = [...server.tools.keys()].sort()

    expect(server.connect).toHaveBeenCalledTimes(1)
    expect(console.error).toHaveBeenCalledWith('Migrated legacy state to session: legacy-pipeline')
    expect(console.error).toHaveBeenCalledWith('invoke-mcp server running on stdio')
    expect(toolNames).toEqual([
      'invoke_cancel_batch',
      'invoke_cleanup_sessions',
      'invoke_cleanup_worktrees',
      'invoke_compare_sessions',
      'invoke_create_worktree',
      'invoke_delete_artifact',
      'invoke_dispatch',
      'invoke_dispatch_batch',
      'invoke_get_base_branch_candidates',
      'invoke_get_batch_status',
      'invoke_get_config',
      'invoke_get_context',
      'invoke_get_metrics',
      'invoke_get_review_cycle_count',
      'invoke_get_state',
      'invoke_init_context',
      'invoke_init_project',
      'invoke_list_bugs',
      'invoke_list_sessions',
      'invoke_merge_worktree',
      'invoke_pr_create',
      'invoke_read_artifact',
      'invoke_report_bug',
      'invoke_run_post_merge',
      'invoke_save_artifact',
      'invoke_session_init_worktree',
      'invoke_session_reattach_worktree',
      'invoke_set_state',
      'invoke_update_bug',
      'invoke_update_config',
      'invoke_update_context',
      'invoke_validate_config',
    ])

    const listSessions = server.tools.get('invoke_list_sessions')
    const compareSessions = server.tools.get('invoke_compare_sessions')
    const getConfig = server.tools.get('invoke_get_config')

    expect(listSessions).toBeTruthy()
    expect(compareSessions).toBeTruthy()
    expect(getConfig).toBeTruthy()
    expect(listSessions!.config.inputSchema.safeParse({}).success).toBe(true)
    expect(
      compareSessions!.config.inputSchema.safeParse({
        session_ids: ['legacy-pipeline', 'another-session'],
      }).success
    ).toBe(true)
    expect(getConfig!.config.inputSchema.safeParse({}).success).toBe(true)

    const sessionsResult = await listSessions!.handler({})
    const configResult = await getConfig!.handler({})
    const sessions = JSON.parse(sessionsResult.content[0].text) as SessionInfo[]
    const config = JSON.parse(configResult.content[0].text) as { settings: { default_strategy: string } }

    expect(sessionsResult.isError).toBeUndefined()
    expect(configResult.isError).toBeUndefined()
    expect(sessions).toEqual([
      {
        session_id: 'legacy-pipeline',
        pipeline_id: 'legacy-pipeline',
        current_stage: 'build',
        started: '2026-04-01T08:00:00.000Z',
        last_updated: '2026-04-05T09:00:00.000Z',
        status: 'active',
      },
    ])
    expect(config.settings.default_strategy).toBe('tdd')
    expect(existsSync(path.join(projectDir, '.invoke', 'state.json'))).toBe(false)
    expect(existsSync(path.join(projectDir, '.invoke', 'sessions', 'legacy-pipeline', 'state.json'))).toBe(true)
  })
})
