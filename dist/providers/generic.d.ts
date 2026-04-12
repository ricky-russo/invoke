import type { Provider, CommandSpec } from './base.js';
import type { ProviderConfig } from '../types.js';
export declare class ConfigDrivenProvider implements Provider {
    private config;
    name: string;
    constructor(name: string, config: ProviderConfig);
    buildCommand(params: {
        model: string;
        effort: string;
        workDir: string;
        prompt: string;
    }): CommandSpec;
}
//# sourceMappingURL=generic.d.ts.map