import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, rm } from 'fs/promises'
import path from 'path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

vi.mock('../../src/config.js', () => ({
  loadConfig: vi.fn(),
}))

import { loadConfig } from '../../src/config.js'
import { StateManager } from '../../src/tools/state.js'
import { registerStateTools } from '../../src/tools/state-tools.js'
import type { InvokeConfig } from '../../src/types.js'

const TEST_DIR = path.join(import.meta.dirname, 'fixtures', 'state-tools-test')

const testConfig: InvokeConfig = {
  providers: {
    claude: { cli: 'claude', args: ['--print', '--model', '{{model}}'] },
  },
  roles: {
    builder: {
      default: {
        prompt: '.invoke/roles/builder/default.md',
        providers: [{ provider: 'claude', model: 'claude-sonnet-4-6', effort: 'medium' }],
      },
    },
  },
  strategies: {},
  settings: {
    default_strategy: 'tdd',
    agent_timeout: 300,
    commit_style: 'per-batch',
    work_branch_prefix: 'invoke/work',
    max_review_cycles: 3,
  },
}

type RegisteredTool = {
  config: {
    inputSchema: {
      safeParse: (input: unknown) => { success: boolean }
    }
  }
  handler: (input: Record<string, unknown>) => Promise<{
    content: Array<{ type: string, text: string }>
    isError?: boolean
  }>
}

let stateManager: StateManager
let registeredTools: Map<string, RegisteredTool>

const registerTool = vi.fn((name: string, config: RegisteredTool['config'], handler: RegisteredTool['handler']) => {
  registeredTools.set(name, { config, handler })
})

const server = { registerTool } as unknown as McpServer

function getTool(name: string): RegisteredTool {
  const tool = registeredTools.get(name)
  if (!tool) {
    throw new Error(`Tool ${name} was not registered`)
  }
  return tool
}

function parseResponseText(result: Awaited<ReturnType<RegisteredTool['handler']>>) {
  return JSON.parse(result.content[0].text) as Record<string, unknown>
}

beforeEach(async () => {
  await mkdir(path.join(TEST_DIR, '.invoke'), { recursive: true })
  stateManager = new StateManager(TEST_DIR)
  registeredTools = new Map()
  registerTool.mockClear()
  vi.mocked(loadConfig).mockResolvedValue(testConfig)
  registerStateTools(server, stateManager, TEST_DIR)
})

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('registerStateTools', () => {
  it('accepts batch_id and scope in invoke_set_state review_cycles', async () => {
    const setStateTool = getTool('invoke_set_state')
    const input = {
      pipeline_id: 'pipeline-123',
      review_cycles: [
        {
          id: 1,
          reviewers: ['reviewer-a'],
          findings: [],
          batch_id: 2,
          scope: 'batch' as const,
          triaged: {
            accepted: [],
            dismissed: [],
          },
        },
      ],
    }

    expect(setStateTool.config.inputSchema.safeParse(input).success).toBe(true)

    const result = await setStateTool.handler(input)
    expect(result.isError).toBeUndefined()

    const state = await stateManager.get()
    expect(state?.review_cycles).toEqual([
      {
        id: 1,
        reviewers: ['reviewer-a'],
        findings: [],
        batch_id: 2,
        scope: 'batch',
        triaged: {
          accepted: [],
          dismissed: [],
        },
      },
    ])
  })

  it('returns the total review cycle count and configured limit', async () => {
    await stateManager.initialize('pipeline-123')
    await stateManager.update({
      review_cycles: [
        { id: 1, reviewers: ['reviewer-a'], findings: [], batch_id: 1, scope: 'batch' },
        { id: 2, reviewers: ['reviewer-b'], findings: [], batch_id: 2, scope: 'batch' },
        { id: 3, reviewers: ['reviewer-c'], findings: [], scope: 'final' },
      ],
    })

    const result = await getTool('invoke_get_review_cycle_count').handler({})
    expect(result.isError).toBeUndefined()
    expect(parseResponseText(result)).toEqual({
      count: 3,
      max_review_cycles: 3,
    })
  })

  it('filters the review cycle count by batch_id', async () => {
    await stateManager.initialize('pipeline-123')
    await stateManager.update({
      review_cycles: [
        { id: 1, reviewers: ['reviewer-a'], findings: [], batch_id: 1, scope: 'batch' },
        { id: 2, reviewers: ['reviewer-b'], findings: [], batch_id: 2, scope: 'batch' },
        { id: 3, reviewers: ['reviewer-c'], findings: [], batch_id: 2, scope: 'batch' },
      ],
    })

    const result = await getTool('invoke_get_review_cycle_count').handler({ batch_id: 2 })
    expect(result.isError).toBeUndefined()
    expect(parseResponseText(result)).toEqual({
      count: 2,
      max_review_cycles: 3,
    })
  })

  it('still returns the count when config loading fails', async () => {
    vi.mocked(loadConfig).mockRejectedValueOnce(new Error('missing config'))
    await stateManager.initialize('pipeline-123')
    await stateManager.update({
      review_cycles: [
        { id: 1, reviewers: ['reviewer-a'], findings: [], batch_id: 4, scope: 'batch' },
      ],
    })

    const result = await getTool('invoke_get_review_cycle_count').handler({ batch_id: 4 })
    expect(result.isError).toBeUndefined()
    expect(parseResponseText(result)).toEqual({ count: 1 })
  })
})
