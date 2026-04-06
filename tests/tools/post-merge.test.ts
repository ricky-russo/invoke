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
})
