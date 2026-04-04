import type { Provider } from '../providers/base.js';
import type { Parser } from '../parsers/base.js';
import type { DispatchRequest, AgentResult, DispatchMetric } from '../types.js';
interface DispatchEngineOptions {
    providers: Map<string, Provider>;
    parsers: Map<string, Parser>;
    projectDir: string;
    onDispatchComplete?: (metric: DispatchMetric) => void;
}
export declare class DispatchEngine {
    private providers;
    private parsers;
    private projectDir;
    private onDispatchComplete?;
    constructor(options: DispatchEngineOptions);
    dispatch(request: DispatchRequest): Promise<AgentResult>;
    private resolveProviderMode;
    private dispatchParallel;
    private dispatchFallback;
    private dispatchToProvider;
    private mergeResults;
    private runProcess;
}
export {};
//# sourceMappingURL=engine.d.ts.map