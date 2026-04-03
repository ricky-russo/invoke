import type { Provider } from '../providers/base.js';
import type { Parser } from '../parsers/base.js';
import type { InvokeConfig, DispatchRequest, AgentResult } from '../types.js';
interface DispatchEngineOptions {
    config: InvokeConfig;
    providers: Map<string, Provider>;
    parsers: Map<string, Parser>;
    projectDir: string;
}
export declare class DispatchEngine {
    private config;
    private providers;
    private parsers;
    private projectDir;
    constructor(options: DispatchEngineOptions);
    dispatch(request: DispatchRequest): Promise<AgentResult>;
    private dispatchToProvider;
    private mergeResults;
    private runProcess;
}
export {};
//# sourceMappingURL=engine.d.ts.map