import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { ConfigManager } from './config-manager.js'
import type { ConfigOperation } from './config-manager.js'

const ProviderModeSchema = z.enum(['parallel', 'fallback', 'single'])

const ProviderEntrySchema = z.object({
  provider: z.string(),
  model: z.string(),
  effort: z.enum(['low', 'medium', 'high']),
})

const SettingsUpdateSchema = z.object({
  default_strategy: z.string().optional(),
  agent_timeout: z.number().positive().optional(),
  commit_style: z.enum(['one-commit', 'per-batch', 'per-task', 'custom']).optional(),
  work_branch_prefix: z.string().optional(),
  post_merge_commands: z.array(z.string()).optional(),
  max_parallel_agents: z.number().positive().optional(),
  default_provider_mode: ProviderModeSchema.optional(),
  max_dispatches: z.number().positive().optional(),
  max_review_cycles: z.number().positive().optional(),
}).catchall(z.unknown())

export function registerConfigUpdateTools(server: McpServer, projectDir: string): void {
  const configManager = new ConfigManager(projectDir)

  server.registerTool(
    'invoke_update_config',
    {
      description: 'Update pipeline.yaml configuration. Supports: add_role, remove_role, add_strategy, remove_strategy, update_settings.',
      inputSchema: z.object({
        operation: z.enum(['add_role', 'remove_role', 'add_strategy', 'remove_strategy', 'update_settings'])
          .describe('The operation to perform'),
        role: z.string().optional()
          .describe('Role group (for add_role/remove_role, e.g. reviewer, researcher, builder, planner)'),
        subrole: z.string().optional()
          .describe('Sub-role name (for add_role/remove_role, e.g. psr-compliance, security)'),
        strategy: z.string().optional()
          .describe('Strategy name (for add_strategy/remove_strategy)'),
        config: z.object({
          prompt: z.string().describe('Path to the prompt .md file'),
          providers: z.array(ProviderEntrySchema).optional().describe('Provider configurations (for add_role)'),
          provider_mode: ProviderModeSchema.optional()
            .describe('Provider dispatch mode (for add_role)'),
        }).optional()
          .describe('Configuration for add_role or add_strategy'),
        settings: SettingsUpdateSchema.optional()
          .describe('Settings fields to update (for update_settings)'),
      }),
    },
    async (input) => {
      try {
        const op = buildOperation(input)
        const result = await configManager.execute(op)
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

function buildOperation(input: {
  operation: string
  role?: string
  subrole?: string
  strategy?: string
  config?: {
    prompt: string
    providers?: Array<{ provider: string; model: string; effort: string }>
    provider_mode?: 'parallel' | 'fallback' | 'single'
  }
  settings?: Record<string, unknown>
}): ConfigOperation {
  switch (input.operation) {
    case 'add_role': {
      if (!input.role || !input.subrole || !input.config?.providers) {
        throw new Error('add_role requires: role, subrole, config.prompt, config.providers')
      }
      return {
        operation: 'add_role',
        role: input.role,
        subrole: input.subrole,
        config: {
          prompt: input.config.prompt,
          providers: input.config.providers.map(p => ({
            provider: p.provider,
            model: p.model,
            effort: p.effort as 'low' | 'medium' | 'high',
          })),
          provider_mode: input.config.provider_mode,
        },
      }
    }
    case 'remove_role': {
      if (!input.role || !input.subrole) {
        throw new Error('remove_role requires: role, subrole')
      }
      return { operation: 'remove_role', role: input.role, subrole: input.subrole }
    }
    case 'add_strategy': {
      if (!input.strategy || !input.config) {
        throw new Error('add_strategy requires: strategy, config.prompt')
      }
      return {
        operation: 'add_strategy',
        strategy: input.strategy,
        config: { prompt: input.config.prompt },
      }
    }
    case 'remove_strategy': {
      if (!input.strategy) {
        throw new Error('remove_strategy requires: strategy')
      }
      return { operation: 'remove_strategy', strategy: input.strategy }
    }
    case 'update_settings': {
      if (!input.settings) {
        throw new Error('update_settings requires: settings')
      }
      return { operation: 'update_settings', settings: input.settings }
    }
    default:
      throw new Error(`Unknown operation: ${input.operation}`)
  }
}
