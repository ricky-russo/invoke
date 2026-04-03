import type { Provider, CommandSpec } from './base.js';
import type { ProviderConfig } from '../types.js';
export declare class ClaudeProvider implements Provider {
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
//# sourceMappingURL=claude.d.ts.map