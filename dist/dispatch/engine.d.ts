import type { Provider } from '../providers/base.js';
import type { Parser } from '../parsers/base.js';
import type { DispatchRequest, AgentResult } from '../types.js';
interface DispatchEngineOptions {
    providers: Map<string, Provider>;
    parsers: Map<string, Parser>;
    projectDir: string;
}
export declare class DispatchEngine {
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