import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { loadConfig } from '../config.js'

export function registerConfigTools(server: McpServer, projectDir: string): void {
  server.registerTool(
    'invoke_get_config',
    {
      description: 'Read and return the parsed pipeline.yaml configuration',
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const config = await loadConfig(projectDir)
        return {
          content: [{ type: 'text', text: JSON.stringify(config, null, 2) }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error loading config: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    }
  )
}
