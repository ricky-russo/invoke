import type { Parser, ParseContext } from './base.js';
import type { AgentResult } from '../types.js';
export declare class MarkdownFindingParser implements Parser {
    name: string;
    constructor(name: string);
    parse(rawOutput: string, exitCode: number, context: ParseContext): AgentResult;
    private extractFindings;
    private extractField;
    private normalizeSeverity;
}
//# sourceMappingURL=markdown-finding-parser.d.ts.map