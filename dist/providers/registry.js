import { ClaudeProvider } from './claude.js';
import { CodexProvider } from './codex.js';
import { ConfigDrivenProvider } from './generic.js';
const KNOWN_PROVIDERS = {
    claude: ClaudeProvider,
    codex: CodexProvider,
};
const KNOWN_CLI_MAP = {
    claude: ClaudeProvider,
    codex: CodexProvider,
};
export function createProviderRegistry(configs) {
    const registry = new Map();
    for (const [name, config] of Object.entries(configs)) {
        const Constructor = KNOWN_PROVIDERS[name] ?? KNOWN_CLI_MAP[config.cli];
        if (Constructor) {
            registry.set(name, new Constructor(config));
        }
        else {
            registry.set(name, new ConfigDrivenProvider(name, config));
        }
    }
    return registry;
}
//# sourceMappingURL=registry.js.map