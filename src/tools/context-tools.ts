import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ContextManager } from './context.js'

export function registerContextTools(server: McpServer, contextManager: ContextManager): void {
  server.registerTool(
    'invoke_get_context',
    {
      description: 'Read the project context document (.invoke/context.md). Returns null if not yet initialized.',
      inputSchema: z.object({}),
    },
    async () => {
      const content = await contextManager.get()
      return {
        content: [{ type: 'text', text: content ?? 'No context.md found. Use invoke-scope to initialize project context.' }],
      }
    }
  )

  server.registerTool(
    'invoke_update_context',
    {
      description: 'Update a specific section in context.md by heading name.',
      inputSchema: z.object({
        section: z.string().describe('Section heading name (e.g. "Architecture", "Completed Work")'),
        content: z.string().describe('New content for the section'),
        mode: z.enum(['replace', 'append']).describe('"replace" overwrites the section, "append" adds to the end'),
      }),
    },
    async ({ section, content, mode }) => {
      try {
        await contextManager.updateSection(section, content, mode)
        return {
          content: [{ type: 'text', text: JSON.stringify({ updated: section, mode }) }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Context error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    }
  )

  server.registerTool(
    'invoke_init_context',
    {
      description: 'Initialize the project context document with the given content. Used during first-time project setup.',
      inputSchema: z.object({
        content: z.string().describe('Full markdown content for context.md'),
      }),
    },
    async ({ content }) => {
      try {
        await contextManager.initialize(content)
        return {
          content: [{ type: 'text', text: JSON.stringify({ initialized: true }) }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Init error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    }
  )
}
