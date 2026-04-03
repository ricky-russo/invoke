import { execSync } from 'child_process'
import { access } from 'fs/promises'
import path from 'path'
import type { InvokeConfig } from './types.js'

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

function suggestModel(provider: string, model: string): string | undefined {
  const suggestions = MODEL_SUGGESTIONS[provider]
  if (!suggestions) return undefined
  return suggestions[model]
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

  // 3–5. Per-role checks
  for (const [roleGroup, subroles] of Object.entries(config.roles)) {
    for (const [subroleName, roleConfig] of Object.entries(subroles)) {
      const rolePath = `roles.${roleGroup}.${subroleName}`

      // 3. Prompt file exists on disk
      const promptPath = path.isAbsolute(roleConfig.prompt)
        ? roleConfig.prompt
        : path.join(projectDir, roleConfig.prompt)

      try {
        await access(promptPath)
      } catch {
        warnings.push({
          level: 'error',
          path: `${rolePath}.prompt`,
          message: `Prompt file '${roleConfig.prompt}' not found.`,
        })
      }

      // 4 & 5. Per-provider-entry checks
      for (let i = 0; i < roleConfig.providers.length; i++) {
        const entry = roleConfig.providers[i]
        const entryPath = `${rolePath}.providers[${i}]`

        // 4. Provider name exists in config.providers
        if (!config.providers[entry.provider]) {
          warnings.push({
            level: 'error',
            path: `${entryPath}.provider`,
            message: `Provider '${entry.provider}' is not defined in providers.`,
            suggestion: `Available providers: ${Object.keys(config.providers).join(', ')}`,
          })
        }

        // 5. Model matches provider patterns
        if (!isValidModelForProvider(entry.provider, entry.model)) {
          const suggestion = suggestModel(entry.provider, entry.model)
          warnings.push({
            level: 'warning',
            path: `${entryPath}.model`,
            message: `Model '${entry.model}' is not a recognized ${entry.provider} model format.`,
            suggestion: suggestion ? `Did you mean '${suggestion}'?` : undefined,
          })
        }
      }
    }
  }

  const valid = !warnings.some(w => w.level === 'error')

  return { valid, warnings }
}
