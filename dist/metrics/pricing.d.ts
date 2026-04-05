export declare const MODEL_PRICING: Record<string, {
    input: number;
    output: number;
}>;
export declare function charsToTokens(chars: number): number;
export declare function estimateCost(model: string, inputChars: number, outputChars: number): {
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
} | null;
export declare function getKnownModels(): string[];
//# sourceMappingURL=pricing.d.ts.map