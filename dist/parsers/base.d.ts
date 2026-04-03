import type { AgentResult } from '../types.js';
export interface ParseContext {
    role: string;
    subrole: string;
    provider: string;
    model: string;
    duration: number;
}
export interface Parser {
    name: string;
    parse(rawOutput: string, exitCode: number, context: ParseContext): AgentResult;
}
//# sourceMappingURL=base.d.ts.map