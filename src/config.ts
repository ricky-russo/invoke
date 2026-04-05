import { readFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { parse } from 'yaml'
import { z } from 'zod'
import type { InvokeConfig } from './types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.join(__dirname, '..')

const ProviderConfigSchema = z.object({
  cli: z.string(),
  args: z.array(z.string()),
})

const ProviderEntrySchema = z.object({
  provider: z.string(),
  model: z.string(),
  effort: z.enum(['low', 'medium', 'high']),
  timeout: z.number().positive().optional(),
})

const ProviderModeSchema = z.enum(['parallel', 'fallback', 'single'])

// Accept either single-provider shorthand or providers array
const RawRoleConfigSchema = z.object({
  prompt: z.string(),
  // Single-provider shorthand fields (optional)
  provider: z.string().optional(),
  model: z.string().optional(),
  effort: z.enum(['low', 'medium', 'high']).optional(),
  // Multi-provider array (optional)
  providers: z.array(ProviderEntrySchema).optional(),
  provider_mode: ProviderModeSchema.optional(),
})

const StrategyConfigSchema = z.object({
  prompt: z.string(),
})

const ReviewTierSchema = z.object({
  name: z.string(),
  reviewers: z.array(z.string()),
})

const SettingsSchema = z.object({
  default_strategy: z.string(),
  agent_timeout: z.number().positive(),
  commit_style: z.enum(['one-commit', 'per-batch', 'per-task', 'custom']),
  work_branch_prefix: z.string(),
  preset: z.string().optional(),
  stale_session_days: z.number().positive().optional(),
  post_merge_commands: z.array(z.string()).optional(),
  max_parallel_agents: z.number().positive().optional(),
  default_provider_mode: ProviderModeSchema.optional(),
  max_dispatches: z.number().positive().optional(),
  max_review_cycles: z.number().positive().optional(),
  review_tiers: z.array(ReviewTierSchema).optional(),
})

const PresetConfigSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  settings: SettingsSchema.partial().optional(),
  reviewer_selection: z.array(z.string()).optional(),
  strategy_selection: z.array(z.string()).optional(),
})

const RawInvokeConfigSchema = z.object({
  providers: z.record(z.string(), ProviderConfigSchema),
  roles: z.record(z.string(), z.record(z.string(), RawRoleConfigSchema)),
  strategies: z.record(z.string(), StrategyConfigSchema),
  settings: SettingsSchema.partial(),
  presets: z.record(z.string(), PresetConfigSchema).optional(),
})

const InvokeConfigSchema = RawInvokeConfigSchema.extend({
  settings: SettingsSchema,
})

type RawInvokeConfig = z.infer<typeof RawInvokeConfigSchema>
type ResolvedInvokeConfig = z.infer<typeof InvokeConfigSchema>
type PresetConfig = z.infer<typeof PresetConfigSchema>

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override
  }

  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override
  }

  const merged: Record<string, unknown> = { ...base }

  for (const [key, value] of Object.entries(override)) {
    merged[key] = key in merged ? deepMerge(merged[key], value) : value
  }

  return merged
}

async function loadPresetConfig(projectDir: string, presetName: string): Promise<PresetConfig> {
  const presetPaths = [
    path.join(projectDir, '.invoke', 'presets', `${presetName}.yaml`),
    path.join(PACKAGE_ROOT, 'defaults', 'presets', `${presetName}.yaml`),
  ]

  for (const presetPath of presetPaths) {
    try {
      const content = await readFile(presetPath, 'utf-8')
      return PresetConfigSchema.parse(parse(content))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        continue
      }

      throw new Error(
        `Failed to load preset '${presetName}' from ${presetPath}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  throw new Error(
    `Preset '${presetName}' not found. Checked ${presetPaths.join(' and ')}.`
  )
}

function normalizeConfig(raw: ResolvedInvokeConfig): InvokeConfig {
  const roles: InvokeConfig['roles'] = {}

  for (const [roleGroup, subroles] of Object.entries(raw.roles)) {
    roles[roleGroup] = {}
    for (const [subroleName, subrole] of Object.entries(subroles)) {
      if (subrole.providers && subrole.providers.length > 0) {
        roles[roleGroup][subroleName] = {
          prompt: subrole.prompt,
          providers: subrole.providers,
          provider_mode: subrole.provider_mode,
        }
      } else if (subrole.provider && subrole.model && subrole.effort) {
        roles[roleGroup][subroleName] = {
          prompt: subrole.prompt,
          providers: [{
            provider: subrole.provider,
            model: subrole.model,
            effort: subrole.effort,
          }],
          provider_mode: subrole.provider_mode,
        }
      } else {
        throw new Error(
          `Role ${roleGroup}.${subroleName} must have either 'providers' array or 'provider'/'model'/'effort' fields`
        )
      }
    }
  }

  return {
    providers: raw.providers,
    roles,
    strategies: raw.strategies,
    settings: raw.settings,
    presets: raw.presets,
  }
}

export async function loadConfig(projectDir: string): Promise<InvokeConfig> {
  const configPath = path.join(projectDir, '.invoke', 'pipeline.yaml')
  const content = await readFile(configPath, 'utf-8')
  const raw = RawInvokeConfigSchema.parse(parse(content))

  let mergedConfig: RawInvokeConfig = raw

  if (raw.settings.preset) {
    const preset = await loadPresetConfig(projectDir, raw.settings.preset)
    mergedConfig = deepMerge(
      {
        settings: preset.settings ?? {},
        presets: { [raw.settings.preset]: preset },
      },
      raw,
    ) as RawInvokeConfig
  }

  const validated = InvokeConfigSchema.parse(mergedConfig)
  return normalizeConfig(validated)
}
