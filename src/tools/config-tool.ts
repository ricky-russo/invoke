import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { loadConfig } from '../config.js'
import { validateConfig } from '../config-validator.js'

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

  server.registerTool(
    'invoke_validate_config',
    {
      description: 'Validate the pipeline.yaml configuration. Checks CLI existence, model formats, prompt file existence, provider references, and strategy references. Returns warnings with suggestions.',
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const config = await loadConfig(projectDir)
        const result = await validateConfig(config, projectDir)
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
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
