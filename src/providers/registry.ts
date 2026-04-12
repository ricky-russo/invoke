import type { Provider } from './base.js'
import type { ProviderConfig } from '../types.js'
import { ClaudeProvider } from './claude.js'
import { CodexProvider } from './codex.js'
import { ConfigDrivenProvider } from './generic.js'

const KNOWN_PROVIDERS: Record<string, new (config: ProviderConfig) => Provider> = {
  claude: ClaudeProvider,
  codex: CodexProvider,
}

const KNOWN_CLI_MAP: Record<string, new (config: ProviderConfig) => Provider> = {
  claude: ClaudeProvider,
  codex: CodexProvider,
}

export function createProviderRegistry(
  configs: Record<string, ProviderConfig>
): Map<string, Provider> {
  const registry = new Map<string, Provider>()

  for (const [name, config] of Object.entries(configs)) {
    const Constructor = KNOWN_PROVIDERS[name] ?? KNOWN_CLI_MAP[config.cli]
    if (Constructor) {
      registry.set(name, new Constructor(config))
    } else {
      registry.set(name, new ConfigDrivenProvider(name, config))
    }
  }

  return registry
}
