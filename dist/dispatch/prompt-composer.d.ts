interface ComposeOptions {
    projectDir: string;
    promptPath: string;
    strategyPath?: string;
    taskContext: Record<string, string>;
}
export declare function composePrompt(options: ComposeOptions): Promise<string>;
export {};
//# sourceMappingURL=prompt-composer.d.ts.map