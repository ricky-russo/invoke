import type { Parser } from './base.js'
import { MarkdownFindingParser } from './markdown-finding-parser.js'

export function createParserRegistry(providerNames: string[]): Map<string, Parser> {
  const registry = new Map<string, Parser>()
  for (const name of providerNames) {
    registry.set(name, new MarkdownFindingParser(name))
  }
  return registry
}
