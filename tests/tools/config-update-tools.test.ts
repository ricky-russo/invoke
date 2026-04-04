import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, rm, writeFile, readFile } from 'fs/promises'
import path from 'path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerConfigUpdateTools } from '../../src/tools/config-update-tools.js'

const TEST_DIR = path.join(import.meta.dirname, 'fixtures', 'config-update-tools-test')

const STARTER_CONFIG = `
providers:
  claude:
    cli: claude
    args: ["--print", "--model", "{{model}}"]
  codex:
    cli: codex
    args: ["exec", "--model", "{{model}}"]

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

type ToolResponse = {
  content: Array<{ type: string; text: string }>
  isError?: boolean
}

type RegisteredTool = {
  config: {
    inputSchema: {
      parse: (input: unknown) => any
    }
  }
  handler: (input: Record<string, unknown>) => Promise<ToolResponse>
}

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

beforeEach(async () => {
  await mkdir(path.join(TEST_DIR, '.invoke'), { recursive: true })
  await writeFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), STARTER_CONFIG)
  registeredTools = new Map()
  registerTool.mockClear()
  registerConfigUpdateTools(server, TEST_DIR)
})

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('registerConfigUpdateTools', () => {
  it('accepts provider_mode for add_role and writes it through', async () => {
    const tool = getTool('invoke_update_config')
    const input = tool.config.inputSchema.parse({
      operation: 'add_role',
      role: 'reviewer',
      subrole: 'performance',
      config: {
        prompt: '.invoke/roles/reviewer/performance.md',
        providers: [
          { provider: 'claude', model: 'claude-sonnet-4-6', effort: 'medium' },
          { provider: 'codex', model: 'gpt-5', effort: 'high' },
        ],
        provider_mode: 'fallback',
      },
    })

    const result = await tool.handler(input)

    expect(result.isError).toBeUndefined()
    const payload = JSON.parse(result.content[0].text)
    expect(payload.roles.reviewer.performance.provider_mode).toBe('fallback')

    const raw = await readFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), 'utf-8')
    expect(raw).toContain('provider_mode: fallback')
  })

  it('accepts and writes new update_settings fields', async () => {
    const tool = getTool('invoke_update_config')
    const input = tool.config.inputSchema.parse({
      operation: 'update_settings',
      settings: {
        default_provider_mode: 'parallel',
        max_dispatches: 8,
        max_review_cycles: 3,
      },
    })

    const result = await tool.handler(input)

    expect(result.isError).toBeUndefined()
    const payload = JSON.parse(result.content[0].text)
    expect(payload.settings.default_provider_mode).toBe('parallel')
    expect(payload.settings.max_dispatches).toBe(8)
    expect(payload.settings.max_review_cycles).toBe(3)

    const raw = await readFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), 'utf-8')
    expect(raw).toContain('default_provider_mode: parallel')
    expect(raw).toContain('max_dispatches: 8')
    expect(raw).toContain('max_review_cycles: 3')
  })
})
