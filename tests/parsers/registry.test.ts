import { describe, it, expect } from 'vitest'
import { createParserRegistry } from '../../src/parsers/registry.js'
import { MarkdownFindingParser } from '../../src/parsers/markdown-finding-parser.js'

describe('createParserRegistry', () => {
  it('returns a MarkdownFindingParser for each provider name', () => {
    const registry = createParserRegistry(['claude', 'codex', 'gemini'])
    expect(registry.get('claude')).toBeInstanceOf(MarkdownFindingParser)
    expect(registry.get('codex')).toBeInstanceOf(MarkdownFindingParser)
    expect(registry.get('gemini')).toBeInstanceOf(MarkdownFindingParser)
  })

  it('registry size matches input array length', () => {
    const names = ['claude', 'codex', 'gemini']
    const registry = createParserRegistry(names)
    expect(registry.size).toBe(3)
  })

  it('each parser.name matches the provider name', () => {
    const names = ['claude', 'codex', 'gemini']
    const registry = createParserRegistry(names)
    for (const name of names) {
      expect(registry.get(name)!.name).toBe(name)
    }
  })

  it('returns empty map for empty input', () => {
    const registry = createParserRegistry([])
    expect(registry.size).toBe(0)
  })

  it('works with a single provider', () => {
    const registry = createParserRegistry(['claude'])
    expect(registry.size).toBe(1)
    expect(registry.get('claude')!.name).toBe('claude')
  })
})
