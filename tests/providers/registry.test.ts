import { describe, it, expect } from 'vitest'
import { createProviderRegistry } from '../../src/providers/registry.js'
import { ClaudeProvider } from '../../src/providers/claude.js'
import { CodexProvider } from '../../src/providers/codex.js'
import { ConfigDrivenProvider } from '../../src/providers/generic.js'

describe('createProviderRegistry', () => {
  const baseConfig = {
    claude: { cli: 'claude', args: ['--print', '--model', '{{model}}'] },
    codex: { cli: 'codex', args: ['exec', '--model', '{{model}}'] },
  }

  it('returns ClaudeProvider for "claude" key', () => {
    const registry = createProviderRegistry({ claude: baseConfig.claude })
    expect(registry.get('claude')).toBeInstanceOf(ClaudeProvider)
  })

  it('returns CodexProvider for "codex" key', () => {
    const registry = createProviderRegistry({ codex: baseConfig.codex })
    expect(registry.get('codex')).toBeInstanceOf(CodexProvider)
  })

  it('returns ClaudeProvider for aliased keys when cli is "claude"', () => {
    const registry = createProviderRegistry({ 'my-claude': baseConfig.claude })
    expect(registry.get('my-claude')).toBeInstanceOf(ClaudeProvider)
  })

  it('returns CodexProvider for aliased keys when cli is "codex"', () => {
    const registry = createProviderRegistry({ 'my-codex': baseConfig.codex })
    expect(registry.get('my-codex')).toBeInstanceOf(CodexProvider)
  })

  it('returns ConfigDrivenProvider for unknown key like "gemini"', () => {
    const geminiConfig = { cli: 'gemini', args: ['--model', '{{model}}'] }
    const registry = createProviderRegistry({ gemini: geminiConfig })
    expect(registry.get('gemini')).toBeInstanceOf(ConfigDrivenProvider)
    expect(registry.get('gemini')!.name).toBe('gemini')
  })

  it('returns ConfigDrivenProvider for aliased keys with unknown cli values', () => {
    const unknownConfig = { cli: 'my-tool', args: ['--model', '{{model}}'] }
    const registry = createProviderRegistry({ 'my-unknown': unknownConfig })
    expect(registry.get('my-unknown')).toBeInstanceOf(ConfigDrivenProvider)
    expect(registry.get('my-unknown')!.name).toBe('my-unknown')
  })

  it('does not throw on unknown provider keys', () => {
    const unknownConfig = { cli: 'some-cli', args: ['--model', '{{model}}'] }
    expect(() => createProviderRegistry({ custom: unknownConfig })).not.toThrow()
  })

  it('handles a mix of known and unknown providers', () => {
    const configs = {
      claude: baseConfig.claude,
      codex: baseConfig.codex,
      gemini: { cli: 'gemini', args: ['--model', '{{model}}'] },
    }
    const registry = createProviderRegistry(configs)
    expect(registry.get('claude')).toBeInstanceOf(ClaudeProvider)
    expect(registry.get('codex')).toBeInstanceOf(CodexProvider)
    expect(registry.get('gemini')).toBeInstanceOf(ConfigDrivenProvider)
    expect(registry.size).toBe(3)
  })
})
