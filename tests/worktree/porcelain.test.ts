import { describe, expect, it } from 'vitest'
import { parsePorcelainWorktrees } from '../../src/worktree/porcelain.js'

describe('parsePorcelainWorktrees', () => {
  it('parses normal, detached, bare, prunable, and headless entries', () => {
    const output = [
      'worktree /repo/main',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /repo/detached',
      'HEAD def456',
      'detached',
      '',
      'worktree /repo/bare',
      'HEAD 123456',
      'bare',
      '',
      'worktree /repo/prunable',
      'HEAD fedcba',
      'branch refs/heads/feature/demo',
      'prunable gitdir file points to non-existent location',
      '',
      'worktree /repo/headless',
      'branch refs/heads/topic',
    ].join('\n')

    expect(parsePorcelainWorktrees(output)).toEqual([
      {
        worktreePath: '/repo/main',
        branch: 'main',
        head: 'abc123',
        detached: false,
        bare: false,
        prunable: false,
      },
      {
        worktreePath: '/repo/detached',
        branch: null,
        head: 'def456',
        detached: true,
        bare: false,
        prunable: false,
      },
      {
        worktreePath: '/repo/bare',
        branch: null,
        head: '123456',
        detached: false,
        bare: true,
        prunable: false,
      },
      {
        worktreePath: '/repo/prunable',
        branch: 'feature/demo',
        head: 'fedcba',
        detached: false,
        bare: false,
        prunable: true,
      },
      {
        worktreePath: '/repo/headless',
        branch: 'topic',
        head: '',
        detached: false,
        bare: false,
        prunable: false,
      },
    ])
  })

  it('treats a bare prunable marker without a reason as prunable', () => {
    const output = ['worktree /repo/prunable', 'HEAD 123abc', 'prunable'].join('\n')

    expect(parsePorcelainWorktrees(output)).toEqual([
      {
        worktreePath: '/repo/prunable',
        branch: null,
        head: '123abc',
        detached: false,
        bare: false,
        prunable: true,
      },
    ])
  })

  it('returns an empty array for empty porcelain output', () => {
    expect(parsePorcelainWorktrees('')).toEqual([])
    expect(parsePorcelainWorktrees('\n\n')).toEqual([])
  })

  it('ignores malformed blocks without a worktree line', () => {
    const output = [
      'HEAD badbad',
      'branch refs/heads/ignored',
      '',
      'worktree /repo/valid',
      'HEAD goodgood',
    ].join('\n')

    expect(parsePorcelainWorktrees(output)).toEqual([
      {
        worktreePath: '/repo/valid',
        branch: null,
        head: 'goodgood',
        detached: false,
        bare: false,
        prunable: false,
      },
    ])
  })
})
