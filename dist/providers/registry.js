import { ClaudeProvider } from './claude.js';
import { CodexProvider } from './codex.js';
const PROVIDER_CONSTRUCTORS = {
    claude: ClaudeProvider,
    codex: CodexProvider,
};
export function createProviderRegistry(configs) {
    const registry = new Map();
    for (const [name, config] of Object.entries(configs)) {
        const Constructor = PROVIDER_CONSTRUCTORS[name];
        if (!Constructor) {
            throw new Error(`Unknown provider: ${name}. Available: ${Object.keys(PROVIDER_CONSTRUCTORS).join(', ')}`);
        }
        registry.set(name, new Constructor(config));
    }
    return registry;
}
//# sourceMappingURL=registry.js.map