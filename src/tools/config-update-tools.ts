import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { ConfigManager } from './config-manager.js'

const ProviderEntrySchema = z.object({
  provider: z.string(),
  model: z.string(),
  effort: z.enum(['low', 'medium', 'high']),
})

export function registerConfigUpdateTools(server: McpServer, projectDir: string): void {
  const configManager = new ConfigManager(projectDir)

  server.registerTool(
    'invoke_update_config',
    {
      description: 'Update pipeline.yaml configuration. Supports adding/removing roles, strategies, and updating settings.',
      inputSchema: z.discriminatedUnion('operation', [
        z.object({
          operation: z.literal('add_role'),
          role: z.string().describe('Role group (e.g. reviewer, researcher, builder, planner)'),
          subrole: z.string().describe('Sub-role name (e.g. psr-compliance, security)'),
          config: z.object({
            prompt: z.string().describe('Path to the prompt .md file'),
            providers: z.array(ProviderEntrySchema).describe('Provider configurations'),
          }),
        }),
        z.object({
          operation: z.literal('remove_role'),
          role: z.string().describe('Role group'),
          subrole: z.string().describe('Sub-role name to remove'),
        }),
        z.object({
          operation: z.literal('add_strategy'),
          strategy: z.string().describe('Strategy name'),
          config: z.object({
            prompt: z.string().describe('Path to the strategy prompt .md file'),
          }),
        }),
        z.object({
          operation: z.literal('remove_strategy'),
          strategy: z.string().describe('Strategy name to remove'),
        }),
        z.object({
          operation: z.literal('update_settings'),
          settings: z.record(z.string(), z.unknown()).describe('Settings fields to update'),
        }),
      ]),
    },
    async (input) => {
      try {
        const result = await configManager.execute(input)
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Config update error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    }
  )
}
