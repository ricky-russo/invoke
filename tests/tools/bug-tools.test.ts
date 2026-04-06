import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { BugManager } from '../../src/bugs/manager.js'
import { registerBugTools } from '../../src/tools/bug-tools.js'

type RegisteredTool = {
  config: {
    inputSchema: {
      safeParse: (input: unknown) =>
        | { success: true; data: Record<string, unknown> }
        | { success: false }
    }
  }
  handler: (input: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text: string }>
    isError?: boolean
  }>
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

function parseToolInput(tool: RegisteredTool, input: Record<string, unknown>) {
  const parsed = tool.config.inputSchema.safeParse(input)
  expect(parsed.success).toBe(true)

  if (!parsed.success) {
    throw new Error('Tool input should have parsed successfully')
  }

  return parsed.data
}

function parseResponseText(result: Awaited<ReturnType<RegisteredTool['handler']>>) {
  return JSON.parse(result.content[0].text) as Record<string, unknown> | Array<Record<string, unknown>>
}

describe('registerBugTools', () => {
  let bugManager: BugManager
  let report: ReturnType<typeof vi.fn>
  let list: ReturnType<typeof vi.fn>
  let update: ReturnType<typeof vi.fn>
  let consoleError: ReturnType<typeof vi.spyOn>

  afterEach(() => {
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    registeredTools = new Map()
    registerTool.mockClear()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    report = vi.fn()
    list = vi.fn()
    update = vi.fn()
    bugManager = {
      report,
      list,
      update,
    } as unknown as BugManager

    registerBugTools(server, bugManager)
  })

  it('registers report, list, and update bug tools with expected schemas and defaults', () => {
    const reportTool = getTool('invoke_report_bug')
    const listTool = getTool('invoke_list_bugs')
    const updateTool = getTool('invoke_update_bug')

    const parsedReport = reportTool.config.inputSchema.safeParse({
      title: 'Crash',
      description: 'App crashes on startup',
    })
    expect(parsedReport.success).toBe(true)
    if (!parsedReport.success) {
      throw new Error('Report tool schema rejected valid input')
    }
    expect(parsedReport.data).toMatchObject({
      severity: 'medium',
      labels: [],
    })

    const parsedList = listTool.config.inputSchema.safeParse({})
    expect(parsedList.success).toBe(true)
    if (!parsedList.success) {
      throw new Error('List tool schema rejected valid input')
    }
    expect(parsedList.data).toMatchObject({
      status: 'open',
    })

    expect(updateTool.config.inputSchema.safeParse({ bug_id: 'BUG-001' }).success).toBe(true)
  })

  it('calls bugManager.report() and returns the JSON result', async () => {
    const tool = getTool('invoke_report_bug')
    const bug = {
      id: 'BUG-001',
      title: 'Crash',
      description: 'App crashes on startup',
      status: 'open',
      severity: 'medium',
      file: 'src/main.ts',
      line: 12,
      labels: ['startup'],
      session_id: 'session-1',
      created: '2026-04-06T10:00:00.000Z',
      updated: '2026-04-06T10:00:00.000Z',
      resolution: null,
      resolved_by_session: null,
    }
    report.mockResolvedValue(bug)

    const input = parseToolInput(tool, {
      title: 'Crash',
      description: 'App crashes on startup',
      file: 'src/main.ts',
      line: 12,
      labels: ['startup'],
      session_id: 'session-1',
    })
    const result = await tool.handler(input)

    expect(report).toHaveBeenCalledWith({
      title: 'Crash',
      description: 'App crashes on startup',
      severity: 'medium',
      file: 'src/main.ts',
      line: 12,
      labels: ['startup'],
      session_id: 'session-1',
    })
    expect(result.isError).toBeUndefined()
    expect(parseResponseText(result)).toEqual(bug)
  })

  it('calls bugManager.list() and returns the JSON result', async () => {
    const tool = getTool('invoke_list_bugs')
    const bugs = [{
      id: 'BUG-002',
      title: 'Broken save',
      description: 'Saving fails',
      status: 'open',
      severity: 'high',
      file: null,
      line: null,
      labels: [],
      session_id: null,
      created: '2026-04-06T10:00:00.000Z',
      updated: '2026-04-06T10:00:00.000Z',
      resolution: null,
      resolved_by_session: null,
    }]
    list.mockResolvedValue(bugs)

    const input = parseToolInput(tool, { severity: 'high' })
    const result = await tool.handler(input)

    expect(list).toHaveBeenCalledWith({
      status: 'open',
      severity: 'high',
    })
    expect(result.isError).toBeUndefined()
    expect(parseResponseText(result)).toEqual(bugs)
  })

  it('calls bugManager.update() and returns the JSON result', async () => {
    const tool = getTool('invoke_update_bug')
    const bug = {
      id: 'BUG-003',
      title: 'Fixed issue',
      description: 'This bug is fixed',
      status: 'resolved',
      severity: 'low',
      file: null,
      line: null,
      labels: [],
      session_id: 'session-1',
      created: '2026-04-06T10:00:00.000Z',
      updated: '2026-04-06T11:00:00.000Z',
      resolution: 'Added the missing guard',
      resolved_by_session: 'session-2',
    }
    update.mockResolvedValue(bug)

    const input = parseToolInput(tool, {
      bug_id: 'BUG-003',
      status: 'resolved',
      resolution: 'Added the missing guard',
      session_id: 'session-2',
    })
    const result = await tool.handler(input)

    expect(update).toHaveBeenCalledWith('BUG-003', {
      status: 'resolved',
      resolution: 'Added the missing guard',
      session_id: 'session-2',
    })
    expect(result.isError).toBeUndefined()
    expect(parseResponseText(result)).toEqual(bug)
  })

  it('returns isError when bugManager.report() throws', async () => {
    const tool = getTool('invoke_report_bug')
    const error = new Error('EACCES: permission denied, open /tmp/project/.invoke/bugs.yaml')
    report.mockRejectedValue(error)

    const input = parseToolInput(tool, {
      title: 'Crash',
      description: 'App crashes on startup',
    })
    const result = await tool.handler(input)

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Failed to report bug' }],
      isError: true,
    })
    expect(consoleError).toHaveBeenCalledWith('[bug-tools] invoke_report_bug failed', error)
  })

  it('returns isError when bugManager.list() throws', async () => {
    const tool = getTool('invoke_list_bugs')
    const error = new Error('YAMLParseError: Missing , or ] in flow sequence at line 4')
    list.mockRejectedValue(error)

    const input = parseToolInput(tool, {})
    const result = await tool.handler(input)

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Failed to list bugs' }],
      isError: true,
    })
    expect(consoleError).toHaveBeenCalledWith('[bug-tools] invoke_list_bugs failed', error)
  })

  it('returns isError when bugManager.update() throws', async () => {
    const tool = getTool('invoke_update_bug')
    const error = new Error('Lock file exists: /tmp/project/.invoke/bugs.yaml.lock')
    update.mockRejectedValue(error)

    const input = parseToolInput(tool, { bug_id: 'BUG-999' })
    const result = await tool.handler(input)

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Failed to update bug' }],
      isError: true,
    })
    expect(consoleError).toHaveBeenCalledWith('[bug-tools] invoke_update_bug failed', error)
  })

  it('returns a useful message when bugManager.update() cannot find the bug', async () => {
    const tool = getTool('invoke_update_bug')
    const error = new Error("Bug 'BUG-999' not found")
    update.mockRejectedValue(error)

    const input = parseToolInput(tool, { bug_id: 'BUG-999' })
    const result = await tool.handler(input)

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Bug not found: BUG-999' }],
      isError: true,
    })
    expect(consoleError).toHaveBeenCalledWith('[bug-tools] invoke_update_bug failed', error)
  })
})
