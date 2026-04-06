import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { chmod, mkdtemp, rm, symlink, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/config.js', () => ({
  loadConfig: vi.fn(),
}))

import { loadConfig } from '../../src/config.js'
import { SessionManager } from '../../src/session/manager.js'
import { registerPrTools } from '../../src/tools/pr-tools.js'
import type { InvokeConfig, PipelineState } from '../../src/types.js'

type ToolInput = {
  session_id: string
  base_branch: string
  title?: string
  body?: string
  mode: 'create_pr' | 'push_only'
}

type ToolResult = {
  content: Array<{ type: string; text: string }>
  isError?: boolean
}

type RegisteredTool = {
  config: {
    inputSchema: {
      safeParse: (input: unknown) => { success: boolean }
    }
  }
  handler: (input: ToolInput) => Promise<ToolResult>
}

type GitRepo = {
  repoDir: string
  originDir: string
  workBranch: string
}

const ORIGINAL_ENV = { ...process.env }
const TEST_CONFIG: InvokeConfig = {
  providers: {},
  roles: {},
  strategies: {},
  settings: {
    default_strategy: 'default',
    agent_timeout: 60,
    commit_style: 'one-commit',
    work_branch_prefix: 'invoke/sessions',
  },
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()
}

function parseResponseText<T>(result: ToolResult): T {
  return JSON.parse(result.content[0].text) as T
}

async function createGitRepoForSession(sessionId: string, remoteUrl?: string): Promise<GitRepo> {
  const repoDir = await mkdtemp(path.join(os.tmpdir(), `invoke-session-${sessionId}-`))
  const originDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-pr-tools-origin-'))

  git(originDir, ['init', '--bare'])
  git(originDir, ['symbolic-ref', 'HEAD', 'refs/heads/main'])

  git(repoDir, ['init'])
  git(repoDir, ['branch', '-M', 'main'])
  git(repoDir, ['config', 'user.email', 'test@example.com'])
  git(repoDir, ['config', 'user.name', 'Test User'])

  await writeFile(path.join(repoDir, 'README.md'), '# Test repo\n')
  git(repoDir, ['add', 'README.md'])
  git(repoDir, ['commit', '-m', 'initial commit'])

  git(repoDir, ['remote', 'add', 'origin', remoteUrl ?? originDir])
  if (remoteUrl) {
    git(repoDir, ['remote', 'set-url', '--push', 'origin', originDir])
  }

  git(repoDir, ['push', '-u', 'origin', 'main'])

  const workBranch = `${TEST_CONFIG.settings.work_branch_prefix}/${sessionId}`
  git(repoDir, ['switch', '-c', workBranch])
  await writeFile(path.join(repoDir, 'feature.txt'), 'feature work\n')
  git(repoDir, ['add', 'feature.txt'])
  git(repoDir, ['commit', '-m', 'add feature'])

  return { repoDir, originDir, workBranch }
}

async function createBinDir(withGh: boolean): Promise<string> {
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-pr-tools-bin-'))
  const gitPath = execFileSync('which', ['git'], { stdio: 'pipe' }).toString().trim()
  const whichPath = execFileSync('which', ['which'], { stdio: 'pipe' }).toString().trim()

  await symlink(gitPath, path.join(binDir, 'git'))
  await symlink(whichPath, path.join(binDir, 'which'))

  if (withGh) {
    const ghScriptPath = path.join(binDir, 'gh')
    await writeFile(
      ghScriptPath,
      `#!/bin/sh
if [ -n "\${GH_LOG_FILE:-}" ]; then
  printf '%s\n' "$*" >> "$GH_LOG_FILE"
fi

case "$1 $2" in
  "auth status")
    if [ -n "\${GH_AUTH_STATUS_OUTPUT:-}" ]; then
      printf '%s' "$GH_AUTH_STATUS_OUTPUT"
    fi
    exit "\${GH_AUTH_STATUS_EXIT_CODE:-0}"
    ;;
  "pr view")
    if [ -n "\${GH_PR_VIEW_OUTPUT:-}" ]; then
      printf '%s' "$GH_PR_VIEW_OUTPUT"
    fi
    exit "\${GH_PR_VIEW_EXIT_CODE:-0}"
    ;;
  "pr create")
    if [ -n "\${GH_PR_CREATE_OUTPUT:-}" ]; then
      printf '%s' "$GH_PR_CREATE_OUTPUT"
    fi
    exit "\${GH_PR_CREATE_EXIT_CODE:-0}"
    ;;
  *)
    printf 'unexpected gh invocation: %s\\n' "$*" >&2
    exit 99
    ;;
esac
`
    )
    await chmod(ghScriptPath, 0o755)
  }

  return binDir
}

async function writeSessionState(
  sessionManager: SessionManager,
  sessionId: string,
  state: PipelineState,
): Promise<void> {
  const sessionDir = await sessionManager.create(sessionId)
  await writeFile(path.join(sessionDir, 'state.json'), JSON.stringify(state, null, 2) + '\n')
}

function createState(overrides: Partial<PipelineState> = {}): PipelineState {
  return {
    pipeline_id: 'pipeline-123',
    started: '2026-04-06T08:00:00.000Z',
    last_updated: '2026-04-06T08:05:00.000Z',
    current_stage: 'build',
    batches: [],
    review_cycles: [],
    ...overrides,
  }
}

describe('registerPrTools', () => {
  let projectDir: string
  let sessionManager: SessionManager
  let registeredTools: Map<string, RegisteredTool>
  let tempDirs: string[]

  const registerTool = vi.fn((name: string, config: RegisteredTool['config'], handler: RegisteredTool['handler']) => {
    registeredTools.set(name, { config, handler })
  })

  const server = { registerTool } as unknown as McpServer

  function getTool(name: string): RegisteredTool {
    const tool = registeredTools.get(name)
    if (!tool) {
      throw new Error(`Tool ${name} was not registered`)
    }
    return tool
  }

  beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-pr-tools-project-'))
    sessionManager = new SessionManager(projectDir)
    registeredTools = new Map()
    tempDirs = [projectDir]
    registerTool.mockClear()
    vi.mocked(loadConfig).mockResolvedValue(TEST_CONFIG)
    registerPrTools(server, sessionManager, projectDir)
  })

  afterEach(async () => {
    process.env.PATH = ORIGINAL_ENV.PATH
    delete process.env.GH_AUTH_STATUS_OUTPUT
    delete process.env.GH_AUTH_STATUS_EXIT_CODE
    delete process.env.GH_PR_VIEW_OUTPUT
    delete process.env.GH_PR_VIEW_EXIT_CODE
    delete process.env.GH_PR_CREATE_OUTPUT
    delete process.env.GH_PR_CREATE_EXIT_CODE
    delete process.env.GH_LOG_FILE

    await Promise.all(
      tempDirs.reverse().map(dir => rm(dir, { recursive: true, force: true }))
    )
  })

  it('pushes in push_only mode, returns a GitHub compare URL, and does not invoke gh', async () => {
    const sessionId = 'session-1'
    const repo = await createGitRepoForSession(sessionId, 'https://github.com/owner/repo.git')
    tempDirs.push(repo.repoDir, repo.originDir)

    await writeSessionState(
      sessionManager,
      sessionId,
      createState({
        work_branch: repo.workBranch,
        work_branch_path: repo.repoDir,
      })
    )

    const binDir = await createBinDir(true)
    tempDirs.push(binDir)
    const ghLogFile = path.join(projectDir, 'gh.log')
    process.env.PATH = binDir
    process.env.GH_LOG_FILE = ghLogFile

    const result = await getTool('invoke_pr_create').handler({
      session_id: sessionId,
      base_branch: 'main',
      mode: 'push_only',
    })

    expect(result.isError).toBeUndefined()
    expect(parseResponseText(result)).toEqual({
      status: 'pushed',
      work_branch: repo.workBranch,
      base_branch: 'main',
      compare_url: `https://github.com/owner/repo/compare/main...${repo.workBranch}?expand=1`,
      gh_available: false,
      pr_url: null,
    })
    expect(git(repo.originDir, ['branch', '--list', repo.workBranch])).toBe(repo.workBranch)
    expect(existsSync(ghLogFile)).toBe(false)
  })

  it('falls back to push plus compare URL when gh is missing', async () => {
    const sessionId = 'session-2'
    const repo = await createGitRepoForSession(sessionId, 'git@github.com:owner/repo.git')
    tempDirs.push(repo.repoDir, repo.originDir)

    await writeSessionState(
      sessionManager,
      sessionId,
      createState({
        work_branch: repo.workBranch,
        work_branch_path: repo.repoDir,
      })
    )

    const binDir = await createBinDir(false)
    tempDirs.push(binDir)
    process.env.PATH = binDir

    const result = await getTool('invoke_pr_create').handler({
      session_id: sessionId,
      base_branch: 'main',
      mode: 'create_pr',
    })

    expect(result.isError).toBeUndefined()
    expect(parseResponseText(result)).toEqual({
      status: 'pushed',
      work_branch: repo.workBranch,
      base_branch: 'main',
      compare_url: `https://github.com/owner/repo/compare/main...${repo.workBranch}?expand=1`,
      gh_available: false,
      pr_url: null,
      note: 'gh not installed; use compare_url to open a PR manually.',
    })
  })

  it('creates a PR when gh is available, authenticated, and no PR exists', async () => {
    const sessionId = 'session-3'
    const repo = await createGitRepoForSession(sessionId, 'https://github.com/owner/repo.git')
    tempDirs.push(repo.repoDir, repo.originDir)

    await writeSessionState(
      sessionManager,
      sessionId,
      createState({
        work_branch: repo.workBranch,
        work_branch_path: repo.repoDir,
      })
    )

    const binDir = await createBinDir(true)
    tempDirs.push(binDir)
    process.env.PATH = binDir
    process.env.GH_AUTH_STATUS_EXIT_CODE = '0'
    process.env.GH_PR_VIEW_EXIT_CODE = '1'
    process.env.GH_PR_CREATE_EXIT_CODE = '0'
    process.env.GH_PR_CREATE_OUTPUT = 'https://github.com/owner/repo/pull/42\n'

    const result = await getTool('invoke_pr_create').handler({
      session_id: sessionId,
      base_branch: 'main',
      title: 'feat: add feature',
      body: 'Body from tool',
      mode: 'create_pr',
    })

    expect(result.isError).toBeUndefined()
    expect(parseResponseText(result)).toEqual({
      status: 'pr_created',
      pr_url: 'https://github.com/owner/repo/pull/42',
      work_branch: repo.workBranch,
      base_branch: 'main',
      compare_url: `https://github.com/owner/repo/compare/main...${repo.workBranch}?expand=1`,
      gh_available: true,
    })
  })

  it('falls back to push plus compare URL when gh is present but unauthenticated', async () => {
    const sessionId = 'session-unauth'
    const repo = await createGitRepoForSession(sessionId, 'https://github.com/owner/repo.git')
    tempDirs.push(repo.repoDir, repo.originDir)

    await writeSessionState(
      sessionManager,
      sessionId,
      createState({
        work_branch: repo.workBranch,
        work_branch_path: repo.repoDir,
      })
    )

    const binDir = await createBinDir(true)
    tempDirs.push(binDir)
    process.env.PATH = binDir
    process.env.GH_AUTH_STATUS_EXIT_CODE = '1'

    const result = await getTool('invoke_pr_create').handler({
      session_id: sessionId,
      base_branch: 'main',
      mode: 'create_pr',
    })

    expect(result.isError).toBeUndefined()
    expect(parseResponseText(result)).toEqual({
      status: 'pushed',
      work_branch: repo.workBranch,
      base_branch: 'main',
      compare_url: `https://github.com/owner/repo/compare/main...${repo.workBranch}?expand=1`,
      gh_available: false,
      pr_url: null,
      note: 'gh not authenticated; use compare_url to open a PR manually.',
    })
  })

  it('returns an existing PR URL when gh pr view succeeds', async () => {
    const sessionId = 'session-4'
    const repo = await createGitRepoForSession(sessionId, 'https://github.com/owner/repo.git')
    tempDirs.push(repo.repoDir, repo.originDir)

    await writeSessionState(
      sessionManager,
      sessionId,
      createState({
        work_branch: repo.workBranch,
        work_branch_path: repo.repoDir,
      })
    )

    const binDir = await createBinDir(true)
    tempDirs.push(binDir)
    process.env.PATH = binDir
    process.env.GH_AUTH_STATUS_EXIT_CODE = '0'
    process.env.GH_PR_VIEW_EXIT_CODE = '0'
    process.env.GH_PR_VIEW_OUTPUT = '{"number":7,"url":"https://github.com/owner/repo/pull/7"}'
    process.env.GH_PR_CREATE_EXIT_CODE = '0'
    process.env.GH_PR_CREATE_OUTPUT = 'https://github.com/owner/repo/pull/99\n'

    const result = await getTool('invoke_pr_create').handler({
      session_id: sessionId,
      base_branch: 'main',
      mode: 'create_pr',
    })

    expect(result.isError).toBeUndefined()
    expect(parseResponseText(result)).toEqual({
      status: 'pr_exists',
      pr_url: 'https://github.com/owner/repo/pull/7',
      work_branch: repo.workBranch,
      base_branch: 'main',
      compare_url: `https://github.com/owner/repo/compare/main...${repo.workBranch}?expand=1`,
      gh_available: true,
    })
  })

  it('returns an error when the session has no work branch metadata', async () => {
    await writeSessionState(sessionManager, 'session-5', createState())

    const result = await getTool('invoke_pr_create').handler({
      session_id: 'session-5',
      base_branch: 'main',
      mode: 'create_pr',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe(
      'Session session-5 has no work_branch - was it initialized via invoke_session_init_worktree?'
    )
  })

  it('returns an error when git push fails', async () => {
    const sessionId = 'session-6'
    const repoDir = await mkdtemp(path.join(os.tmpdir(), `invoke-session-${sessionId}-`))
    tempDirs.push(repoDir)

    git(repoDir, ['init'])
    git(repoDir, ['branch', '-M', 'main'])
    git(repoDir, ['config', 'user.email', 'test@example.com'])
    git(repoDir, ['config', 'user.name', 'Test User'])
    await writeFile(path.join(repoDir, 'README.md'), '# Test repo\n')
    git(repoDir, ['add', 'README.md'])
    git(repoDir, ['commit', '-m', 'initial commit'])
    git(repoDir, ['switch', '-c', `${TEST_CONFIG.settings.work_branch_prefix}/${sessionId}`])

    await writeSessionState(
      sessionManager,
      sessionId,
      createState({
        work_branch: `${TEST_CONFIG.settings.work_branch_prefix}/${sessionId}`,
        work_branch_path: repoDir,
      })
    )

    const binDir = await createBinDir(false)
    tempDirs.push(binDir)
    process.env.PATH = binDir

    const result = await getTool('invoke_pr_create').handler({
      session_id: sessionId,
      base_branch: 'main',
      mode: 'push_only',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Failed to push:')
  })

  it('returns null compare_url for a non-GitHub remote', async () => {
    const sessionId = 'session-7'
    const repo = await createGitRepoForSession(sessionId, 'https://gitlab.com/owner/repo.git')
    tempDirs.push(repo.repoDir, repo.originDir)

    await writeSessionState(
      sessionManager,
      sessionId,
      createState({
        work_branch: repo.workBranch,
        work_branch_path: repo.repoDir,
      })
    )

    const binDir = await createBinDir(false)
    tempDirs.push(binDir)
    process.env.PATH = binDir

    const result = await getTool('invoke_pr_create').handler({
      session_id: sessionId,
      base_branch: 'main',
      mode: 'push_only',
    })

    expect(result.isError).toBeUndefined()
    expect(parseResponseText(result)).toEqual({
      status: 'pushed',
      work_branch: repo.workBranch,
      base_branch: 'main',
      compare_url: null,
      gh_available: false,
      pr_url: null,
    })
  })

  it('returns an error when the session work_branch_path is unsafe', async () => {
    const sessionId = 'session-unsafe-path'

    await writeSessionState(
      sessionManager,
      sessionId,
      createState({
        work_branch: `${TEST_CONFIG.settings.work_branch_prefix}/${sessionId}`,
        work_branch_path: projectDir,
      })
    )

    const result = await getTool('invoke_pr_create').handler({
      session_id: sessionId,
      base_branch: 'main',
      mode: 'push_only',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe(
      `Session ${sessionId} has an unsafe work_branch_path`
    )
  })

  it('returns an error when the session work_branch does not match the expected prefix and session id', async () => {
    const sessionId = 'session-bad-branch'
    const repo = await createGitRepoForSession(sessionId, 'https://github.com/owner/repo.git')
    tempDirs.push(repo.repoDir, repo.originDir)

    await writeSessionState(
      sessionManager,
      sessionId,
      createState({
        work_branch: 'invoke/sessions/other-session',
        work_branch_path: repo.repoDir,
      })
    )

    const result = await getTool('invoke_pr_create').handler({
      session_id: sessionId,
      base_branch: 'main',
      mode: 'push_only',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe(
      `Session ${sessionId} has an unexpected work_branch — expected ${TEST_CONFIG.settings.work_branch_prefix}/${sessionId}`
    )
    expect(git(repo.originDir, ['branch', '--list', repo.workBranch])).toBe('')
  })
})
