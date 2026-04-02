import { describe, it, expect } from 'vitest'
import { CodexProvider } from '../../src/providers/codex.js'

describe('CodexProvider', () => {
  const provider = new CodexProvider({
    cli: 'codex',
    args: ['--model', '{{model}}', '--reasoning-effort', '{{effort}}'],
  })

  it('has the correct name', () => {
    expect(provider.name).toBe('codex')
  })

  it('builds a command with model and effort substituted', () => {
    const cmd = provider.buildCommand({
      model: 'gpt-5.4',
      effort: 'high',
      workDir: '/tmp/worktree-2',
      prompt: 'Review for security issues',
    })

    expect(cmd.cmd).toBe('codex')
    expect(cmd.args).toContain('--model')
    expect(cmd.args).toContain('gpt-5.4')
    expect(cmd.args).toContain('--reasoning-effort')
    expect(cmd.args).toContain('high')
    expect(cmd.args).toContain('-C')
    expect(cmd.args).toContain('/tmp/worktree-2')
    expect(cmd.args[cmd.args.length - 1]).toBe('Review for security issues')
  })
})
