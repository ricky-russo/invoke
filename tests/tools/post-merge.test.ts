import { beforeEach, describe, expect, it, vi } from 'vitest'

const childProcessMocks = vi.hoisted(() => ({
  execSync: vi.fn(),
}))

vi.mock('child_process', () => ({
  execSync: childProcessMocks.execSync,
}))

import { runPostMergeCommands } from '../../src/tools/post-merge.js'
import type { InvokeConfig } from '../../src/types.js'

const TEST_CONFIG: InvokeConfig = {
  providers: {},
  roles: {},
  strategies: {},
  settings: {
    default_strategy: 'default',
    agent_timeout: 60,
    commit_style: 'one-commit',
    work_branch_prefix: 'invoke',
    post_merge_commands: ['npm install'],
  },
}

describe('runPostMergeCommands', () => {
  beforeEach(() => {
    childProcessMocks.execSync.mockReset()
  })

  it('uses projectDir as the default cwd', () => {
    childProcessMocks.execSync.mockReturnValue(Buffer.from('ok'))

    const result = runPostMergeCommands(TEST_CONFIG, '/tmp/project')

    expect(childProcessMocks.execSync).toHaveBeenCalledWith('npm install', {
      cwd: '/tmp/project',
      stdio: 'pipe',
      timeout: 60000,
    })
    expect(result).toEqual({
      commands: [{ command: 'npm install', success: true, output: 'ok' }],
    })
  })

  it('uses the explicit cwd when provided', () => {
    childProcessMocks.execSync.mockReturnValue(Buffer.from('ok'))

    runPostMergeCommands(TEST_CONFIG, '/tmp/project', '/tmp/session-worktree')

    expect(childProcessMocks.execSync).toHaveBeenCalledWith('npm install', {
      cwd: '/tmp/session-worktree',
      stdio: 'pipe',
      timeout: 60000,
    })
  })

  it('runs all configured post-merge commands in order', () => {
    const config = structuredClone(TEST_CONFIG)
    config.settings.post_merge_commands = ['npm install', 'npm run test', 'npm run build']
    childProcessMocks.execSync
      .mockReturnValueOnce(Buffer.from('install ok'))
      .mockReturnValueOnce(Buffer.from('test ok'))
      .mockReturnValueOnce(Buffer.from('build ok'))

    const result = runPostMergeCommands(config, '/tmp/project')

    expect(childProcessMocks.execSync).toHaveBeenNthCalledWith(1, 'npm install', {
      cwd: '/tmp/project',
      stdio: 'pipe',
      timeout: 60000,
    })
    expect(childProcessMocks.execSync).toHaveBeenNthCalledWith(2, 'npm run test', {
      cwd: '/tmp/project',
      stdio: 'pipe',
      timeout: 60000,
    })
    expect(childProcessMocks.execSync).toHaveBeenNthCalledWith(3, 'npm run build', {
      cwd: '/tmp/project',
      stdio: 'pipe',
      timeout: 60000,
    })
    expect(result).toEqual({
      commands: [
        { command: 'npm install', success: true, output: 'install ok' },
        { command: 'npm run test', success: true, output: 'test ok' },
        { command: 'npm run build', success: true, output: 'build ok' },
      ],
    })
  })
})
