import type { Parser, ParseContext } from './base.js';
import type { AgentResult } from '../types.js';
export declare class CodexParser implements Parser {
    name: string;
    parse(rawOutput: string, exitCode: number, context: ParseContext): AgentResult;
    private extractFindings;
    private extractField;
    private normalizeSeverity;
}
//# sourceMappingURL=codex-parser.d.ts.map