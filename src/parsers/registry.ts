import type { Parser } from './base.js'
import { ClaudeParser } from './claude-parser.js'
import { CodexParser } from './codex-parser.js'

const PARSERS: Record<string, new () => Parser> = {
  claude: ClaudeParser,
  codex: CodexParser,
}

export function createParserRegistry(): Map<string, Parser> {
  const registry = new Map<string, Parser>()
  for (const [name, Constructor] of Object.entries(PARSERS)) {
    registry.set(name, new Constructor())
  }
  return registry
}
