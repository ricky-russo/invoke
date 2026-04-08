interface ComposeOptions {
    projectDir: string;
    promptPath: string;
    strategyPath?: string;
    taskContext: Record<string, string>;
}
export declare function composePrompt(options: ComposeOptions): Promise<string>;
export declare function generateDispatchNonce(): string;
export declare function composePromptWithNonce(options: ComposeOptions, nonce: string): Promise<string>;
export {};
//# sourceMappingURL=prompt-composer.d.ts.map