export type ContentType = 'prose' | 'code'

export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': {
    input: 15 / 1_000_000,
    output: 75 / 1_000_000,
  },
  'claude-sonnet-4-6': {
    input: 3 / 1_000_000,
    output: 15 / 1_000_000,
  },
  'claude-haiku-4-5-20251001': {
    input: 0.8 / 1_000_000,
    output: 4 / 1_000_000,
  },
  'gpt-5.4': {
    input: 2 / 1_000_000,
    output: 8 / 1_000_000,
  },
  'gpt-4.1': {
    input: 2 / 1_000_000,
    output: 8 / 1_000_000,
  },
  'o3-mini': {
    input: 1.1 / 1_000_000,
    output: 4.4 / 1_000_000,
  },
}

const MODEL_NAME_ALIASES: Record<string, string> = {
  'opus-4.6': 'claude-opus-4-6',
  'opus-4-6': 'claude-opus-4-6',
  'sonnet-4.6': 'claude-sonnet-4-6',
  'sonnet-4-6': 'claude-sonnet-4-6',
}

const CHARS_PER_TOKEN: Record<ContentType, number> = {
  prose: 4,
  code: 3,
}

export function normalizeModelName(model: string): string {
  const normalized = model.trim().toLowerCase()
  return MODEL_NAME_ALIASES[normalized] ?? normalized
}

export function charsToTokens(chars: number, contentType: ContentType = 'prose'): number {
  return Math.ceil(chars / CHARS_PER_TOKEN[contentType])
}

export function estimateCost(
  model: string,
  inputChars: number,
  outputChars: number,
  contentType: ContentType = 'prose'
): { input_tokens: number; output_tokens: number; cost_usd: number } | null {
  const pricing = MODEL_PRICING[normalizeModelName(model)]

  if (!pricing) {
    return null
  }

  const inputTokens = charsToTokens(inputChars, contentType)
  const outputTokens = charsToTokens(outputChars, contentType)
  const costUsd = Number(
    (inputTokens * pricing.input + outputTokens * pricing.output).toFixed(6)
  )

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: costUsd,
  }
}

export function getKnownModels(): string[] {
  return Object.keys(MODEL_PRICING)
}
