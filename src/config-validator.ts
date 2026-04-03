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

// Suppress unused import warning — validateConfig will use InvokeConfig in a later commit
void (undefined as unknown as InvokeConfig)
