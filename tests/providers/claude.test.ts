import { describe, it, expect } from 'vitest'
import { ClaudeProvider } from '../../src/providers/claude.js'

describe('ClaudeProvider', () => {
  const provider = new ClaudeProvider({
    cli: 'claude',
    args: ['--print', '--model', '{{model}}'],
  })

  it('has the correct name', () => {
    expect(provider.name).toBe('claude')
  })

  it('builds a command with model substituted', () => {
    const cmd = provider.buildCommand({
      model: 'opus-4.6',
      effort: 'high',
      workDir: '/tmp/worktree-1',
      prompt: 'Build the auth module',
    })

    expect(cmd.cmd).toBe('claude')
    expect(cmd.cmd).toBe('claude')
    expect(cmd.args).toContain('--print')
    expect(cmd.args).toContain('--model')
    expect(cmd.args).toContain('opus-4.6')
    expect(cmd.args).not.toContain('--directory')
    expect(cmd.cwd).toBe('/tmp/worktree-1')
    expect(cmd.args[cmd.args.length - 1]).toBe('Build the auth module')
  })

  it('substitutes all template variables', () => {
    const customProvider = new ClaudeProvider({
      cli: 'claude',
      args: ['--print', '--model', '{{model}}', '--effort', '{{effort}}'],
    })

    const cmd = customProvider.buildCommand({
      model: 'sonnet-4.6',
      effort: 'medium',
      workDir: '/tmp/wt',
      prompt: 'test prompt',
    })

    expect(cmd.args).toContain('sonnet-4.6')
    expect(cmd.args).toContain('medium')
  })
})
