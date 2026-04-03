import type { Provider, CommandSpec } from './base.js';
import type { ProviderConfig } from '../types.js';
export declare class CodexProvider implements Provider {
    private config;
    name: string;
    constructor(config: ProviderConfig);
    buildCommand(params: {
        model: string;
        effort: string;
        workDir: string;
        prompt: string;
    }): CommandSpec;
}
//# sourceMappingURL=codex.d.ts.map