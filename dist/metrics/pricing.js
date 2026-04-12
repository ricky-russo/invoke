export const MODEL_PRICING = {
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
    'gemini-2.5-pro': {
        input: 1.25 / 1_000_000,
        output: 10 / 1_000_000,
    },
    'gemini-2.5-flash': {
        input: 0.15 / 1_000_000,
        output: 0.6 / 1_000_000,
    },
};
const MODEL_NAME_ALIASES = {
    'opus-4.6': 'claude-opus-4-6',
    'opus-4-6': 'claude-opus-4-6',
    'sonnet-4.6': 'claude-sonnet-4-6',
    'sonnet-4-6': 'claude-sonnet-4-6',
    'haiku-4.5': 'claude-haiku-4-5-20251001',
    'haiku-4-5': 'claude-haiku-4-5-20251001',
};
const CHARS_PER_TOKEN = {
    prose: 4,
    code: 3,
};
export function normalizeModelName(model) {
    const normalized = model.trim().toLowerCase();
    return MODEL_NAME_ALIASES[normalized] ?? normalized;
}
export function charsToTokens(chars, contentType = 'prose') {
    return Math.ceil(chars / CHARS_PER_TOKEN[contentType]);
}
export function estimateCost(model, inputChars, outputChars, contentType = 'prose') {
    const pricing = MODEL_PRICING[normalizeModelName(model)];
    if (!pricing) {
        return null;
    }
    const inputTokens = charsToTokens(inputChars, contentType);
    const outputTokens = charsToTokens(outputChars, contentType);
    const costUsd = Number((inputTokens * pricing.input + outputTokens * pricing.output).toFixed(6));
    return {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: costUsd,
    };
}
export function getKnownModels() {
    return Object.keys(MODEL_PRICING);
}
//# sourceMappingURL=pricing.js.map