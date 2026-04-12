import { MarkdownFindingParser } from './markdown-finding-parser.js';
export function createParserRegistry(providerNames) {
    const registry = new Map();
    for (const name of providerNames) {
        registry.set(name, new MarkdownFindingParser(name));
    }
    return registry;
}
//# sourceMappingURL=registry.js.map