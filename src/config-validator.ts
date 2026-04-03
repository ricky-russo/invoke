import { execSync } from 'child_process'
import { access } from 'fs/promises'
import path from 'path'
import type { InvokeConfig } from './types.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationWarning {
  level: 'error' | 'warning'
  message: string
}

export interface ValidationResult {
  valid: boolean
  warnings: ValidationWarning[]
}

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
}

export const MODEL_SUGGESTIONS: Record<string, string> = {
  'opus-4.6': 'claude-opus-4-6',
  'sonnet-4.6': 'claude-sonnet-4-6',
  'haiku-4.5': 'claude-haiku-4-5',
  'opus-4': 'claude-opus-4',
  'sonnet-4': 'claude-sonnet-4',
  'haiku-3-5': 'claude-haiku-3-5',
}

// ---------------------------------------------------------------------------
// isValidModelForProvider
// ---------------------------------------------------------------------------

export function isValidModelForProvider(provider: string, model: string): boolean {
  const patterns = MODEL_PATTERNS[provider]
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
    execSync(`which ${cli}`, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// suggestModel (private helper)
// ---------------------------------------------------------------------------

function suggestModel(_provider: string, model: string): string | undefined {
  return MODEL_SUGGESTIONS[model]
}

// ---------------------------------------------------------------------------
// validateConfig
// ---------------------------------------------------------------------------

export async function validateConfig(
  config: InvokeConfig,
  projectDir: string,
): Promise<ValidationResult> {
  const warnings: ValidationWarning[] = []

  // 1. CLI existence for each provider
  for (const [providerName, providerConfig] of Object.entries(config.providers)) {
    if (!checkCliExists(providerConfig.cli)) {
      warnings.push({
        level: 'error',
        message: `Provider '${providerName}': CLI '${providerConfig.cli}' not found on PATH`,
      })
    }
  }

  // 2. Default strategy exists in strategies
  const defaultStrategy = config.settings.default_strategy
  if (!config.strategies[defaultStrategy]) {
    const available = Object.keys(config.strategies).join(', ')
    warnings.push({
      level: 'error',
      message: `default_strategy '${defaultStrategy}' is not defined in strategies. Available: ${available || '(none)'}`,
    })
  }

  // 3–5. Per-role checks
  for (const [roleGroup, subroles] of Object.entries(config.roles)) {
    for (const [subroleName, roleConfig] of Object.entries(subroles)) {
      const roleLabel = `${roleGroup}.${subroleName}`

      // 3. Prompt file exists on disk
      const promptPath = path.isAbsolute(roleConfig.prompt)
        ? roleConfig.prompt
        : path.join(projectDir, roleConfig.prompt)

      try {
        await access(promptPath)
      } catch {
        warnings.push({
          level: 'error',
          message: `Role '${roleLabel}': prompt file '${roleConfig.prompt}' does not exist`,
        })
      }

      // 4 & 5. Per-provider-entry checks
      for (const entry of roleConfig.providers) {
        // 4. Provider name exists in config.providers
        if (!config.providers[entry.provider]) {
          const available = Object.keys(config.providers).join(', ')
          warnings.push({
            level: 'error',
            message: `Role '${roleLabel}': provider '${entry.provider}' is not defined in providers. Available: ${available || '(none)'}`,
          })
        }

        // 5. Model matches provider patterns
        if (!isValidModelForProvider(entry.provider, entry.model)) {
          const suggestion = suggestModel(entry.provider, entry.model)
          const hint = suggestion ? ` Did you mean '${suggestion}'?` : ''
          warnings.push({
            level: 'warning',
            message: `Role '${roleLabel}': model '${entry.model}' does not match known patterns for provider '${entry.provider}'.${hint}`,
          })
        }
      }
    }
  }

  const valid = !warnings.some(w => w.level === 'error')

  return { valid, warnings }
}
