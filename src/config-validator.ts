import { execFileSync } from 'child_process'
import { access, readdir } from 'fs/promises'
import path from 'path'
import type { InvokeConfig } from './types.js'
import { getDefaultsDir } from './defaults-path.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationWarning {
  level: 'error' | 'warning'
  path: string
  message: string
  suggestion?: string
}

export interface ValidationResult {
  valid: boolean
  warnings: ValidationWarning[]
}

const DEFAULT_PRESETS_DIR = path.join(getDefaultsDir(), 'presets')

// ---------------------------------------------------------------------------
// Model Patterns
// ---------------------------------------------------------------------------

const MODEL_PATTERNS: Record<string, RegExp[]> = {
  claude: [
    /^claude-[a-z]+-[\d-]+$/,
    /^(opus|sonnet|haiku)$/,
  ],
  codex: [
    /^o\d+(-\w+)?$/,
    /^gpt-[\w.-]+$/,
    /^codex-[\w.-]+$/,
  ],
  gemini: [
    /^gemini-[\w.-]+$/,
  ],
}

const MODEL_SUGGESTIONS: Record<string, Record<string, string>> = {
  claude: {
    'opus-4.6': 'claude-opus-4-6',
    'opus-4-6': 'claude-opus-4-6',
    'sonnet-4.6': 'claude-sonnet-4-6',
    'sonnet-4-6': 'claude-sonnet-4-6',
    'haiku-4.5': 'claude-haiku-4-5-20251001',
    'claude opus': 'opus',
    'claude sonnet': 'sonnet',
  },
  codex: {
    'gpt-5.4': 'gpt-4.1',
  },
  gemini: {
    'gemini-pro': 'gemini-2.5-pro',
    'gemini-flash': 'gemini-2.5-flash',
  },
}

function getCliBaseName(cli: string): string {
  const parts = cli.split(/[\\/]/)
  return parts[parts.length - 1] || cli
}

function resolveModelProvider(provider: string, cli?: string): string {
  const cliBaseName = cli ? getCliBaseName(cli) : undefined
  if (cliBaseName && MODEL_PATTERNS[cliBaseName]) {
    return cliBaseName
  }

  return provider
}

// ---------------------------------------------------------------------------
// isValidModelForProvider
// ---------------------------------------------------------------------------

export function isValidModelForProvider(provider: string, model: string, cli?: string): boolean {
  const patterns = MODEL_PATTERNS[resolveModelProvider(provider, cli)]
  if (!patterns) {
    // Unknown provider — allow any model
    return true
  }
  return patterns.some(pattern => pattern.test(model))
}

// ---------------------------------------------------------------------------
// checkCliExists
// ---------------------------------------------------------------------------

export function checkCliExists(cli: string): boolean {
  try {
    execFileSync('which', [cli], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// suggestModel (private helper)
// ---------------------------------------------------------------------------

function suggestModel(provider: string, model: string, cli?: string): string | undefined {
  const suggestions = MODEL_SUGGESTIONS[resolveModelProvider(provider, cli)]
  if (!suggestions) return undefined
  return suggestions[model]
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function toPresetFileName(presetName: string): string {
  return /\.(ya?ml)$/i.test(presetName) ? presetName : `${presetName}.yaml`
}

async function listAvailablePresets(projectDir: string): Promise<string[]> {
  const presetDirs = [
    DEFAULT_PRESETS_DIR,
    path.join(projectDir, '.invoke', 'presets'),
  ]
  const presetNames = new Set<string>()

  for (const presetDir of presetDirs) {
    if (!await pathExists(presetDir)) {
      continue
    }

    const entries = await readdir(presetDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!/\.(ya?ml)$/i.test(entry.name)) continue
      presetNames.add(path.basename(entry.name, path.extname(entry.name)))
    }
  }

  return [...presetNames].sort()
}

async function presetFileExists(projectDir: string, presetName: string): Promise<boolean> {
  const presetFileName = toPresetFileName(presetName)
  const presetPaths = [
    path.join(DEFAULT_PRESETS_DIR, presetFileName),
    path.join(projectDir, '.invoke', 'presets', presetFileName),
  ]

  for (const presetPath of presetPaths) {
    if (await pathExists(presetPath)) {
      return true
    }
  }

  return false
}

function getReferencedProviders(config: InvokeConfig): Set<string> {
  const referencedProviders = new Set<string>()

  for (const subroles of Object.values(config.roles)) {
    for (const roleConfig of Object.values(subroles)) {
      for (const providerEntry of roleConfig.providers) {
        referencedProviders.add(providerEntry.provider)
      }
    }
  }

  return referencedProviders
}

// ---------------------------------------------------------------------------
// validateConfig
// ---------------------------------------------------------------------------

export async function validateConfig(
  config: InvokeConfig,
  projectDir: string,
): Promise<ValidationResult> {
  const warnings: ValidationWarning[] = []
  const reviewerSubroles = new Set(Object.keys(config.roles.reviewer ?? {}))
  const availablePresetNames = await listAvailablePresets(projectDir)
  const referencedProviders = getReferencedProviders(config)

  // 1. CLI existence for each provider
  for (const [providerName, providerConfig] of Object.entries(config.providers)) {
    if (!referencedProviders.has(providerName)) {
      continue
    }

    if (!checkCliExists(providerConfig.cli)) {
      warnings.push({
        level: 'error',
        path: `providers.${providerName}.cli`,
        message: `CLI '${providerConfig.cli}' not found on PATH.`,
        suggestion: `Install '${providerConfig.cli}' or update the provider config.`,
      })
    }
  }

  // 2. Default strategy exists in strategies
  const defaultStrategy = config.settings.default_strategy
  if (!config.strategies[defaultStrategy]) {
    const available = Object.keys(config.strategies).join(', ')
    warnings.push({
      level: 'error',
      path: 'settings.default_strategy',
      message: `Default strategy '${defaultStrategy}' not found in strategies.`,
      suggestion: `Available strategies: ${available}`,
    })
  }

  // 3. Settings limits are sane when present
  if (config.settings.max_review_cycles !== undefined && config.settings.max_review_cycles < 0) {
    warnings.push({
      level: 'error',
      path: 'settings.max_review_cycles',
      message: 'max_review_cycles must be greater than or equal to 0.',
    })
  }

  if (config.settings.max_dispatches !== undefined && config.settings.max_dispatches < 1) {
    warnings.push({
      level: 'error',
      path: 'settings.max_dispatches',
      message: 'max_dispatches must be greater than or equal to 1.',
    })
  }

  // 4–7. Per-role checks
  for (const [roleGroup, subroles] of Object.entries(config.roles)) {
    for (const [subroleName, roleConfig] of Object.entries(subroles)) {
      const rolePath = `roles.${roleGroup}.${subroleName}`

      // 4. Prompt file exists on disk
      const promptPath = path.isAbsolute(roleConfig.prompt)
        ? roleConfig.prompt
        : path.join(projectDir, roleConfig.prompt)

      if (!await pathExists(promptPath)) {
        warnings.push({
          level: 'error',
          path: `${rolePath}.prompt`,
          message: `Prompt file '${roleConfig.prompt}' not found.`,
        })
      }

      // Multiple providers without an explicit mode will fan out implicitly.
      if (roleConfig.providers.length > 1 && !roleConfig.provider_mode) {
        warnings.push({
          level: 'warning',
          path: `${rolePath}.provider_mode`,
          message: `Role '${roleGroup}.${subroleName}' has multiple providers and no explicit provider_mode.`,
          suggestion: "Set provider_mode to 'parallel', 'fallback', or 'single' to avoid implicit parallel fan-out.",
        })
      }

      // 5 & 6. Per-provider-entry checks
      for (let i = 0; i < roleConfig.providers.length; i++) {
        const entry = roleConfig.providers[i]
        const entryPath = `${rolePath}.providers[${i}]`

        // 5. Provider name exists in config.providers
        if (!config.providers[entry.provider]) {
          warnings.push({
            level: 'error',
            path: `${entryPath}.provider`,
            message: `Provider '${entry.provider}' is not defined in providers.`,
            suggestion: `Available providers: ${Object.keys(config.providers).join(', ')}`,
          })
        }

        // 6. Model matches provider patterns
        const providerCli = config.providers[entry.provider]?.cli
        if (!isValidModelForProvider(entry.provider, entry.model, providerCli)) {
          const suggestion = suggestModel(entry.provider, entry.model, providerCli)
          warnings.push({
            level: 'warning',
            path: `${entryPath}.model`,
            message: `Model '${entry.model}' is not a recognized ${entry.provider} model format.`,
            suggestion: suggestion ? `Did you mean '${suggestion}'?` : undefined,
          })
        }

        // Check for suspiciously large timeout (likely milliseconds instead of seconds)
        if (entry.timeout !== undefined && entry.timeout > 3600) {
          warnings.push({
            level: 'warning',
            path: `${entryPath}.timeout`,
            message: `Timeout ${entry.timeout} seems too large — values are in seconds, not milliseconds.`,
            suggestion: `Did you mean ${Math.round(entry.timeout / 1000)} seconds?`,
          })
        }
      }
    }
  }

  // 8. Review tiers reference existing reviewer subroles
  for (const [tierIndex, tier] of (config.settings.review_tiers ?? []).entries()) {
    for (const [reviewerIndex, reviewerName] of tier.reviewers.entries()) {
      if (reviewerSubroles.has(reviewerName)) {
        continue
      }

      warnings.push({
        level: 'warning',
        path: `settings.review_tiers[${tierIndex}].reviewers[${reviewerIndex}]`,
        message: `Review tier '${tier.name}' references reviewer '${reviewerName}', but roles.reviewer.${reviewerName} is not configured.`,
        suggestion: `Add roles.reviewer.${reviewerName} to .invoke/pipeline.yaml or update the reviewers listed for tier '${tier.name}'.`,
      })
    }
  }

  // 9. Active preset references resolve to an inline preset or a preset file
  const activePreset = config.settings.preset
  if (
    activePreset
    && !config.presets?.[activePreset]
    && !await presetFileExists(projectDir, activePreset)
  ) {
    const presetFileName = toPresetFileName(activePreset)
    warnings.push({
      level: 'warning',
      path: 'settings.preset',
      message: `Preset '${activePreset}' does not have a matching inline preset or file in defaults/presets or .invoke/presets.`,
      suggestion: availablePresetNames.length > 0
        ? `Define presets.${activePreset} inline, create '.invoke/presets/${presetFileName}', or rename settings.preset to one of: ${availablePresetNames.join(', ')}.`
        : `Define presets.${activePreset} inline, create '.invoke/presets/${presetFileName}', or add the preset file to defaults/presets.`,
    })
  }

  const valid = !warnings.some(w => w.level === 'error')

  return { valid, warnings }
}
