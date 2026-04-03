import { ClaudeParser } from './claude-parser.js';
import { CodexParser } from './codex-parser.js';
const PARSERS = {
    claude: ClaudeParser,
    codex: CodexParser,
};
export function createParserRegistry() {
    const registry = new Map();
    for (const [name, Constructor] of Object.entries(PARSERS)) {
        registry.set(name, new Constructor());
    }
    return registry;
}
//# sourceMappingURL=registry.js.map