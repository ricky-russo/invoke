import { readFile } from 'fs/promises'
import path from 'path'
import { parse } from 'yaml'
import { z } from 'zod'
import type { InvokeConfig } from './types.js'

const ProviderConfigSchema = z.object({
  cli: z.string(),
  args: z.array(z.string()),
})

const RoleConfigSchema = z.object({
  prompt: z.string(),
  provider: z.string(),
  model: z.string(),
  effort: z.enum(['low', 'medium', 'high']),
})

const StrategyConfigSchema = z.object({
  prompt: z.string(),
})

const SettingsSchema = z.object({
  default_strategy: z.string(),
  agent_timeout: z.number().positive(),
  commit_style: z.enum(['one-commit', 'per-batch', 'per-task', 'custom']),
  work_branch_prefix: z.string(),
})

const InvokeConfigSchema = z.object({
  providers: z.record(z.string(), ProviderConfigSchema),
  roles: z.record(z.string(), z.record(z.string(), RoleConfigSchema)),
  strategies: z.record(z.string(), StrategyConfigSchema),
  settings: SettingsSchema,
})

export async function loadConfig(projectDir: string): Promise<InvokeConfig> {
  const configPath = path.join(projectDir, '.invoke', 'pipeline.yaml')
  const content = await readFile(configPath, 'utf-8')
  const raw = parse(content)
  return InvokeConfigSchema.parse(raw)
}
