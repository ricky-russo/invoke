import type { Provider } from './base.js'
import type { ProviderConfig } from '../types.js'
import { ClaudeProvider } from './claude.js'
import { CodexProvider } from './codex.js'

const PROVIDER_CONSTRUCTORS: Record<string, new (config: ProviderConfig) => Provider> = {
  claude: ClaudeProvider,
  codex: CodexProvider,
}

export function createProviderRegistry(
  configs: Record<string, ProviderConfig>
): Map<string, Provider> {
  const registry = new Map<string, Provider>()

  for (const [name, config] of Object.entries(configs)) {
    const Constructor = PROVIDER_CONSTRUCTORS[name]
    if (!Constructor) {
      throw new Error(`Unknown provider: ${name}. Available: ${Object.keys(PROVIDER_CONSTRUCTORS).join(', ')}`)
    }
    registry.set(name, new Constructor(config))
  }

  return registry
}
