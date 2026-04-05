export type ContentType = 'prose' | 'code';
export declare const MODEL_PRICING: Record<string, {
    input: number;
    output: number;
}>;
export declare function normalizeModelName(model: string): string;
export declare function charsToTokens(chars: number, contentType?: ContentType): number;
export declare function estimateCost(model: string, inputChars: number, outputChars: number, contentType?: ContentType): {
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
} | null;
export declare function getKnownModels(): string[];
//# sourceMappingURL=pricing.d.ts.map