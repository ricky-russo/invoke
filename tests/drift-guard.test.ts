import { describe, it, expect } from 'vitest'
import { estimateCost } from '../src/metrics/pricing.js'
import { isValidModelForProvider } from '../src/config-validator.js'
import { parse as parseYaml } from 'yaml'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

interface ProviderEntry {
  provider: string
  model: string
  effort?: string
  timeout?: number
}

interface SubroleConfig {
  prompt: string
  providers: ProviderEntry[]
  provider_mode?: string
}

interface PipelineConfig {
  providers: Record<string, unknown>
  roles: Record<string, Record<string, SubroleConfig>>
}

function collectProviderEntries(config: PipelineConfig): ProviderEntry[] {
  const entries: ProviderEntry[] = []
  for (const subroles of Object.values(config.roles)) {
    for (const subrole of Object.values(subroles)) {
      for (const entry of subrole.providers) {
        entries.push(entry)
      }
    }
  }
  return entries
}

describe('drift-guard: defaults/pipeline.yaml', () => {
  const yaml = readFileSync(
    path.join(__dirname, '..', 'defaults', 'pipeline.yaml'),
    'utf-8',
  )
  const config = parseYaml(yaml) as PipelineConfig
  const allEntries = collectProviderEntries(config)

  it('every role-referenced model has pricing', () => {
    const uniqueModels = [...new Set(allEntries.map(e => e.model))]
    for (const model of uniqueModels) {
      expect(
        estimateCost(model, 1000, 500),
        `model '${model}' is missing a pricing entry`,
      ).not.toBeNull()
    }
  })

  it('every role-referenced (provider, model) pair passes validation', () => {
    for (const { provider, model } of allEntries) {
      expect(
        isValidModelForProvider(provider, model),
        `model '${model}' is not valid for provider '${provider}'`,
      ).toBe(true)
    }
  })

  it('every role-referenced provider exists in config.providers', () => {
    const configuredProviders = new Set(Object.keys(config.providers))
    for (const { provider } of allEntries) {
      expect(
        configuredProviders.has(provider),
        `provider '${provider}' is referenced in roles but not defined in config.providers`,
      ).toBe(true)
    }
  })
})
