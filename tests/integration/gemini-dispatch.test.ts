import { describe, it, expect } from 'vitest'
import { ConfigDrivenProvider } from '../../src/providers/generic.js'
import { MarkdownFindingParser } from '../../src/parsers/markdown-finding-parser.js'
import { createProviderRegistry } from '../../src/providers/registry.js'
import { createParserRegistry } from '../../src/parsers/registry.js'

const GEMINI_CONFIG = {
  cli: 'gemini',
  args: ['-y', '--output-format', 'text', '-m', '{{model}}', '-p'],
}

describe('Gemini Dispatch Chain Integration', () => {
  it('ConfigDrivenProvider builds correct command for Gemini config', () => {
    const provider = new ConfigDrivenProvider('gemini', GEMINI_CONFIG)

    const cmd = provider.buildCommand({
      model: 'gemini-2.5-pro',
      effort: 'high',
      workDir: '/tmp/test',
      prompt: 'Review this code',
    })

    expect(cmd.cmd).toBe('gemini')
    expect(cmd.args).toEqual(['-y', '--output-format', 'text', '-m', 'gemini-2.5-pro', '-p', 'Review this code'])
    expect(cmd.cwd).toBe('/tmp/test')
    expect(cmd.stdinPrompt).toBe('Review this code')
  })

  it('MarkdownFindingParser parses Gemini reviewer output with findings', () => {
    const parser = new MarkdownFindingParser('gemini')

    const rawOutput = `### Finding 1
**Severity:** high
**File:** a.ts
**Issue:** bug
**Suggestion:** fix it`

    const result = parser.parse(rawOutput, 0, {
      role: 'reviewer',
      subrole: 'security',
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      duration: 100,
    })

    expect(result.status).toBe('success')
    expect(result.output.findings).toHaveLength(1)
    expect(result.output.findings![0].severity).toBe('high')
    expect(result.output.findings![0].file).toBe('a.ts')
    expect(result.output.findings![0].issue).toBe('bug')
    expect(result.output.findings![0].suggestion).toBe('fix it')
  })

  it('provider registry round-trip returns a usable Gemini provider', () => {
    const registry = createProviderRegistry({
      gemini: GEMINI_CONFIG,
    })

    const provider = registry.get('gemini')
    expect(provider).toBeTruthy()
    expect(provider!.name).toBe('gemini')

    const cmd = provider!.buildCommand({
      model: 'gemini-2.5-pro',
      effort: 'high',
      workDir: '/tmp/wt',
      prompt: 'Check this',
    })
    expect(cmd.cmd).toBe('gemini')
    expect(cmd.args).toContain('gemini-2.5-pro')
    expect(cmd.stdinPrompt).toBe('Check this')
    expect(cmd.args).toContain('Check this')
  })

  it('parser registry round-trip returns MarkdownFindingParser with name gemini', () => {
    const registry = createParserRegistry(['gemini'])

    const parser = registry.get('gemini')
    expect(parser).toBeTruthy()
    expect(parser!.name).toBe('gemini')
  })

  it('provider and parser work together in the engine resolution pattern', () => {
    const providers = createProviderRegistry({ gemini: GEMINI_CONFIG })
    const parsers = createParserRegistry(['gemini'])

    const provider = providers.get('gemini')
    expect(provider).toBeTruthy()

    const parser = parsers.get('gemini')
    expect(parser).toBeTruthy()

    const prompt = 'Review the auth module for security issues'
    const commandSpec = provider!.buildCommand({
      model: 'gemini-2.5-pro',
      effort: 'high',
      workDir: '/tmp/worktree',
      prompt,
    })

    expect(commandSpec.cmd).toBe('gemini')
    expect(commandSpec.stdinPrompt).toBe(prompt)
    expect(commandSpec.args).toContain(prompt)
    expect(commandSpec.cwd).toBe('/tmp/worktree')

    const simulatedOutput = `### Finding 1
**Severity:** critical
**File:** src/auth/login.ts
**Line:** 42
**Issue:** Password stored in plaintext
**Suggestion:** Use bcrypt for password hashing`

    const result = parser!.parse(simulatedOutput, 0, {
      role: 'reviewer',
      subrole: 'security',
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      duration: 5000,
    })

    expect(result.status).toBe('success')
    expect(result.provider).toBe('gemini')
    expect(result.model).toBe('gemini-2.5-pro')
    expect(result.output.findings).toHaveLength(1)
    expect(result.output.findings![0].severity).toBe('critical')
    expect(result.output.findings![0].file).toBe('src/auth/login.ts')
    expect(result.output.findings![0].line).toBe(42)
  })
})
