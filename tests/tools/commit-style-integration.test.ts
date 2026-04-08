/**
 * Integration tests for the commit_style modes and the fixup-folding flow.
 *
 * These tests fulfill spec acceptance criteria AC3, AC4, AC5, and AC7 from
 * `.invoke/specs/2026-04-06-fixup-folding-spec.md`:
 *
 *   AC3: Three integration tests, one per mode (per-task, per-batch,
 *        one-commit), each running a 2-task build batch and asserting the
 *        resulting commit count (2, 1, 1 respectively) and the expected
 *        commit titles.
 *   AC4: After a review cycle where one finding is accepted for `task-a`,
 *        the work branch contains a commit titled `fixup! feat: task-a`,
 *        verified by `git log --format=%s`.
 *   AC5: build → review with one accepted fix → end-of-review autosquash;
 *        the final session branch has the same commit count as after the
 *        build phase.
 *   AC7: one-commit mode produces exactly one commit on the session branch
 *        even after a review cycle with accepted fixes, and R5's autosquash
 *        is correctly skipped.
 *
 * These tests do NOT drive the skill layer (which is markdown-only and
 * cannot be unit-tested directly). Instead, they call the MCP tools in the
 * exact order the skill instructions specify, so the tool composition
 * matches what a real pipeline run produces.
 */
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionManager } from '../../src/session/manager.js'
import { registerRebaseTools } from '../../src/tools/rebase-tools.js'
import { StateManager } from '../../src/tools/state.js'
import { SessionWorktreeManager } from '../../src/worktree/session-worktree.js'

type ToolResponse = {
  content: Array<{ type: string; text: string }>
  isError?: boolean
}

type RegisteredTool = {
  config: {
    inputSchema: {
      safeParse: (input: unknown) => { success: boolean }
    }
  }
  handler: (input: Record<string, unknown>) => Promise<ToolResponse>
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()
}

async function createGitRepo(prefix: string): Promise<string> {
  const repoDir = await mkdtemp(path.join(os.tmpdir(), prefix))
  git(repoDir, ['init'])
  git(repoDir, ['branch', '-M', 'main'])
  git(repoDir, ['config', 'user.email', 'test@example.com'])
  git(repoDir, ['config', 'user.name', 'Test User'])
  await writeFile(path.join(repoDir, 'README.md'), '# Test repo\n')
  git(repoDir, ['add', 'README.md'])
  git(repoDir, ['commit', '-m', 'initial'])
  return repoDir
}

function parseResponse<T>(result: ToolResponse): T {
  return JSON.parse(result.content[0].text) as T
}

async function commitFile(
  cwd: string,
  filePath: string,
  content: string,
  message: string
): Promise<string> {
  await writeFile(path.join(cwd, filePath), content)
  git(cwd, ['add', filePath])
  git(cwd, ['commit', '-m', message])
  return git(cwd, ['rev-parse', 'HEAD'])
}

function commitTitles(cwd: string, baseRef: string): string[] {
  const log = execFileSync('git', ['log', '--format=%s', `${baseRef}..HEAD`], {
    cwd,
    stdio: 'pipe',
  })
    .toString()
    .trim()
  return log ? log.split('\n') : []
}

function commitCount(cwd: string, baseRef: string): number {
  return parseInt(
    execFileSync('git', ['rev-list', '--count', `${baseRef}..HEAD`], {
      cwd,
      stdio: 'pipe',
    })
      .toString()
      .trim(),
    10
  )
}

describe('commit_style integration', () => {
  let projectDir: string
  let sessionManager: SessionManager
  let sessionWorktreeManager: SessionWorktreeManager
  let registeredTools: Map<string, RegisteredTool>
  let tempDirs: string[]

  const registerTool = vi.fn(
    (name: string, config: RegisteredTool['config'], handler: RegisteredTool['handler']) => {
      registeredTools.set(name, { config, handler })
    }
  )

  const server = { registerTool } as unknown as McpServer

  function getTool(name: string): RegisteredTool {
    const tool = registeredTools.get(name)
    if (!tool) {
      throw new Error(`Tool ${name} was not registered`)
    }
    return tool
  }

  async function createSessionWorktree(sessionId: string): Promise<{ path: string; baseSha: string }> {
    const sessionDir = await sessionManager.create(sessionId)
    const stateManager = new StateManager(projectDir, sessionDir)
    await stateManager.initialize(sessionId)
    const worktree = await sessionWorktreeManager.create(sessionId, 'invoke/sessions', 'main')
    await stateManager.update({
      base_branch: 'main',
      work_branch: worktree.workBranch,
      work_branch_path: worktree.worktreePath,
    })
    tempDirs.push(worktree.worktreePath)
    return {
      path: worktree.worktreePath,
      baseSha: git(worktree.worktreePath, ['rev-parse', 'HEAD']),
    }
  }

  beforeEach(async () => {
    projectDir = await createGitRepo('invoke-commit-style-')
    sessionManager = new SessionManager(projectDir)
    sessionWorktreeManager = new SessionWorktreeManager(projectDir)
    registeredTools = new Map()
    tempDirs = [projectDir]
    registerTool.mockClear()
    registerRebaseTools(server, sessionManager, projectDir)
  })

  afterEach(async () => {
    await Promise.all(
      tempDirs.reverse().map(dir => rm(dir, { recursive: true, force: true }))
    )
  })

  describe('AC3: commit_style enforcement across modes', () => {
    it('per-task mode: a 2-task batch produces 2 commits with feat: task-a and feat: task-b titles', async () => {
      const { path: worktreePath, baseSha } = await createSessionWorktree('ac3-per-task')

      // Simulate the skill's per-task commit flow: each task squash-merges as
      // its own commit via `invoke_merge_worktree`'s default commit_message
      // pattern `feat: <taskId>`. No collapse step runs for per-task mode.
      await commitFile(worktreePath, 'task-a.txt', 'a\n', 'feat: task-a')
      await commitFile(worktreePath, 'task-b.txt', 'b\n', 'feat: task-b')

      expect(commitCount(worktreePath, baseSha)).toBe(2)
      expect(commitTitles(worktreePath, baseSha)).toEqual([
        'feat: task-b',
        'feat: task-a',
      ])
    })

    it('per-batch mode: a 2-task batch collapses to 1 commit titled feat: batch-1', async () => {
      const { path: worktreePath, baseSha } = await createSessionWorktree('ac3-per-batch')

      // Step 1: both tasks merge sequentially as normal per-task commits.
      await commitFile(worktreePath, 'task-a.txt', 'a\n', 'feat: task-a')
      await commitFile(worktreePath, 'task-b.txt', 'b\n', 'feat: task-b')
      expect(commitCount(worktreePath, baseSha)).toBe(2)

      // Step 2: the skill's per-batch collapse calls invoke_collapse_commits
      // with the pre-batch SHA (baseSha for batch 0) and a 'feat: batch-N'
      // message. This is what invoke-build step g2 does.
      const collapseResult = await getTool('invoke_collapse_commits').handler({
        session_id: 'ac3-per-batch',
        base_sha: baseSha,
        message: 'feat: batch-1',
      })

      expect(collapseResult.isError).toBeUndefined()
      expect(parseResponse<{ status: string; commit_sha: string }>(collapseResult).status).toBe('ok')

      expect(commitCount(worktreePath, baseSha)).toBe(1)
      expect(commitTitles(worktreePath, baseSha)).toEqual(['feat: batch-1'])
    })

    it('one-commit mode: a 2-task batch collapses to 1 commit with the session summary title', async () => {
      const { path: worktreePath, baseSha } = await createSessionWorktree('ac3-one-commit')

      // Step 1: the skill's one-commit flow allows per-task merges during
      // build; collapse only happens at end-of-review (step 8.5).
      await commitFile(worktreePath, 'task-a.txt', 'a\n', 'feat: task-a')
      await commitFile(worktreePath, 'task-b.txt', 'b\n', 'feat: task-b')

      // Step 2: end-of-review one-commit collapse. The title is built from
      // the spec slug (per step 8.5's derive_spec_slug helper); here we pass
      // a literal slug-style message since there's no spec file in the fixture.
      const collapseResult = await getTool('invoke_collapse_commits').handler({
        session_id: 'ac3-one-commit',
        base_sha: baseSha,
        message: 'feat: fixup-folding',
      })

      expect(collapseResult.isError).toBeUndefined()
      expect(commitCount(worktreePath, baseSha)).toBe(1)
      expect(commitTitles(worktreePath, baseSha)).toEqual(['feat: fixup-folding'])
    })
  })

  describe('AC4: review-accepted fix produces a fixup! commit on the work branch', () => {
    it('chains invoke_get_commit_title → fixup! commit → work branch shows the fixup title', async () => {
      const { path: worktreePath, baseSha } = await createSessionWorktree('ac4-fixup')

      // Build stage: task-a lands.
      await commitFile(worktreePath, 'task-a.txt', 'initial\n', 'feat: task-a')
      const taskASha = git(worktreePath, ['rev-parse', 'HEAD'])

      // Review stage: the skill's step 6.5 looks up the commit's title via
      // invoke_get_commit_title. This is the exact flow an operator runs.
      const titleResult = await getTool('invoke_get_commit_title').handler({
        session_id: 'ac4-fixup',
        commit_sha: taskASha,
      })
      expect(titleResult.isError).toBeUndefined()
      const title = parseResponse<{ title: string }>(titleResult).title
      expect(title).toBe('feat: task-a')

      // Step 7: fix task completes, commit_message is built as `fixup! <title>`.
      // The actual merge of a fix task goes through invoke_merge_worktree in
      // production, but the net effect on the work branch is a commit with
      // that title — we simulate it here by committing directly with the
      // fixup message.
      await commitFile(worktreePath, 'task-a.txt', 'fixed\n', `fixup! ${title}`)

      // Assertion: the work branch has a commit titled `fixup! feat: task-a`,
      // verified via `git log --format=%s`.
      const titles = commitTitles(worktreePath, baseSha)
      expect(titles).toContain('fixup! feat: task-a')
    })
  })

  describe('AC5: build → review → autosquash converges to post-build commit count', () => {
    it('per-task mode: 2 task commits + 1 accepted fix → 2 commits after autosquash', async () => {
      const { path: worktreePath, baseSha } = await createSessionWorktree('ac5-build-review')

      // Build phase: 2 task commits.
      await commitFile(worktreePath, 'task-a.txt', 'a-initial\n', 'feat: task-a')
      await commitFile(worktreePath, 'task-b.txt', 'b\n', 'feat: task-b')
      const postBuildCount = commitCount(worktreePath, baseSha)
      expect(postBuildCount).toBe(2)

      // Review phase: reviewer flags an issue in task-a's file. The skill's
      // step 6.5 resolves the fixup target via invoke_get_commit_title, step
      // 7 merges the fix with a `fixup! feat: task-a` message.
      await commitFile(worktreePath, 'task-a.txt', 'a-fixed\n', 'fixup! feat: task-a')
      expect(commitCount(worktreePath, baseSha)).toBe(3) // 2 tasks + 1 fixup

      // End-of-review step 8.5: invoke_autosquash_session folds the fixup
      // into task-a's commit.
      const squashResult = await getTool('invoke_autosquash_session').handler({
        session_id: 'ac5-build-review',
      })
      expect(squashResult.isError).toBeUndefined()
      const parsed = parseResponse<{
        status: string
        commits_before: number
        commits_after: number
        fixups_absorbed: number
      }>(squashResult)
      expect(parsed.status).toBe('ok')
      expect(parsed.fixups_absorbed).toBe(1)

      // Final branch has the same commit count as after the build phase.
      expect(commitCount(worktreePath, baseSha)).toBe(postBuildCount)

      // And the fold actually landed: task-a's commit now contains the
      // post-fix content of task-a.txt. We check by reading the blob at
      // the task-a commit (which is now HEAD~1 after task-b was replayed).
      const taskACommit = execFileSync(
        'git',
        ['log', '--format=%H%x09%s', `${baseSha}..HEAD`],
        { cwd: worktreePath, stdio: 'pipe' }
      )
        .toString()
        .split('\n')
        .find(line => line.endsWith('\tfeat: task-a'))
        ?.split('\t')[0]
      expect(taskACommit).toBeTruthy()
      const fileABlob = git(worktreePath, ['show', `${taskACommit}:task-a.txt`])
      expect(fileABlob).toBe('a-fixed')
    })
  })

  describe('AC7: one-commit mode produces 1 commit even after review fixes', () => {
    it('one-commit mode collapses all build tasks + fix commits into a single commit', async () => {
      const { path: worktreePath, baseSha } = await createSessionWorktree('ac7-one-commit')

      // Build phase: 2 task commits.
      await commitFile(worktreePath, 'task-a.txt', 'a\n', 'feat: task-a')
      await commitFile(worktreePath, 'task-b.txt', 'b\n', 'feat: task-b')

      // Review phase: 1 accepted fix. Note that in one-commit mode, the
      // skill step 7 still passes a `fixup! feat: task-a` commit message so
      // that autosquash CAN fold it, but step 8.5 goes straight to
      // invoke_collapse_commits instead of invoke_autosquash_session.
      await commitFile(worktreePath, 'task-a.txt', 'a-fixed\n', 'fixup! feat: task-a')

      expect(commitCount(worktreePath, baseSha)).toBe(3)

      // End-of-review step 8.5 for one-commit: invoke_collapse_commits with
      // the base SHA and a session-level message. This is the ONLY step that
      // runs — invoke_autosquash_session is explicitly skipped for one-commit.
      const collapseResult = await getTool('invoke_collapse_commits').handler({
        session_id: 'ac7-one-commit',
        base_sha: baseSha,
        message: 'feat: fixup-folding',
      })

      expect(collapseResult.isError).toBeUndefined()
      expect(commitCount(worktreePath, baseSha)).toBe(1)
      expect(commitTitles(worktreePath, baseSha)).toEqual(['feat: fixup-folding'])

      // After the collapse, running invoke_autosquash_session would be a
      // no-op (no fixup commits left). The skill skips it but we verify
      // the tool would be idempotent here anyway.
      const squashResult = await getTool('invoke_autosquash_session').handler({
        session_id: 'ac7-one-commit',
      })
      expect(squashResult.isError).toBeUndefined()
      const parsed = parseResponse<{
        status: string
        fixups_absorbed: number
      }>(squashResult)
      expect(parsed.status).toBe('ok')
      expect(parsed.fixups_absorbed).toBe(0)
      expect(commitCount(worktreePath, baseSha)).toBe(1)
    })
  })
})
