import { describe, it, expect } from 'vitest'
import { ConfigDrivenProvider } from '../../src/providers/generic.js'

describe('ConfigDrivenProvider', () => {
  it('uses the constructor name', () => {
    const provider = new ConfigDrivenProvider('gemini', {
      cli: 'gemini',
      args: ['--model', '{{model}}'],
    })

    expect(provider.name).toBe('gemini')
  })

  it('substitutes {{model}} in args', () => {
    const provider = new ConfigDrivenProvider('generic', {
      cli: 'custom-cli',
      args: ['--model', '{{model}}'],
    })

    const cmd = provider.buildCommand({
      model: 'gemini-2.5-pro',
      effort: 'medium',
      workDir: '/tmp/worktree-generic-model',
      prompt: 'Review the patch',
    })

    expect(cmd.args).toEqual(['--model', 'gemini-2.5-pro', 'Review the patch'])
  })

  it('substitutes {{effort}} in args', () => {
    const provider = new ConfigDrivenProvider('generic', {
      cli: 'custom-cli',
      args: ['--effort', '{{effort}}'],
    })

    const cmd = provider.buildCommand({
      model: 'unused-model',
      effort: 'high',
      workDir: '/tmp/worktree-generic-effort',
      prompt: 'Investigate the bug',
    })

    expect(cmd.args).toEqual(['--effort', 'high', 'Investigate the bug'])
  })

  it('appends the prompt as the last arg', () => {
    const provider = new ConfigDrivenProvider('generic', {
      cli: 'custom-cli',
      args: ['run'],
    })

    const cmd = provider.buildCommand({
      model: 'unused-model',
      effort: 'low',
      workDir: '/tmp/worktree-generic-prompt',
      prompt: 'Write the changelog',
    })

    expect(cmd.args[cmd.args.length - 1]).toBe('Write the changelog')
  })

  it('sets cwd to workDir', () => {
    const provider = new ConfigDrivenProvider('generic', {
      cli: 'custom-cli',
      args: ['run'],
    })

    const cmd = provider.buildCommand({
      model: 'unused-model',
      effort: 'low',
      workDir: '/tmp/worktree-generic-cwd',
      prompt: 'Ship it',
    })

    expect(cmd.cwd).toBe('/tmp/worktree-generic-cwd')
  })

  it('round-trips the Gemini default args', () => {
    const provider = new ConfigDrivenProvider('gemini', {
      cli: 'gemini',
      args: ['--model', '{{model}}', '--yolo'],
    })

    const cmd = provider.buildCommand({
      model: 'gemini-2.5-pro',
      effort: 'medium',
      workDir: '/tmp/worktree-gemini',
      prompt: 'Summarize the changes',
    })

    expect(cmd.cmd).toBe('gemini')
    expect(cmd.args).toEqual(['--model', 'gemini-2.5-pro', '--yolo', 'Summarize the changes'])
  })

  it('passes through args without placeholders unchanged', () => {
    const provider = new ConfigDrivenProvider('generic', {
      cli: 'custom-cli',
      args: ['run', '--plain'],
    })

    const cmd = provider.buildCommand({
      model: 'unused-model',
      effort: 'medium',
      workDir: '/tmp/worktree-generic-pass-through',
      prompt: 'Document the API',
    })

    expect(cmd.args).toEqual(['run', '--plain', 'Document the API'])
  })
})
