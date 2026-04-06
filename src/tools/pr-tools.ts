import { execFileSync } from 'child_process'
import { realpathSync } from 'fs'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { loadConfig } from '../config.js'
import { checkCliExists } from '../config-validator.js'
import type { SessionManager } from '../session/manager.js'
import { isSafeSessionWorkBranchPath, isSafeWorkBranch } from '../worktree/trusted-session-helpers.js'
import { StateManager } from './state.js'

export function registerPrTools(
  server: McpServer,
  sessionManager: SessionManager,
  projectDir: string,
): void {
  server.registerTool(
    'invoke_pr_create',
    {
      description:
        'Push the session work branch to origin and optionally open a PR via gh. Detects gh availability and degrades gracefully.',
      inputSchema: z.object({
        session_id: z.string(),
        base_branch: z.string(),
        title: z.string().optional(),
        body: z.string().optional(),
        mode: z.enum(['create_pr', 'push_only']),
      }),
    },
    async ({ session_id, base_branch, title, body, mode }) => {
      try {
        const sessionDir = sessionManager.resolve(session_id)
        const stateManager = new StateManager(projectDir, sessionDir)
        const state = await stateManager.get()
        if (!state?.work_branch || !state.work_branch_path) {
          return errorResponse(
            `Session ${session_id} has no work_branch - was it initialized via invoke_session_init_worktree?`
          )
        }

        const config = await loadConfig(projectDir)
        const workBranchPrefix = config.settings.work_branch_prefix ?? 'invoke/work'

        if (!isSafeWorkBranch(state.work_branch, session_id, workBranchPrefix)) {
          return errorResponse(
            `Session ${session_id} has an unexpected work_branch — expected ${workBranchPrefix}/${session_id}`
          )
        }
        if (!isSafeSessionWorkBranchPath(state.work_branch_path, projectDir)) {
          return errorResponse(
            `Session ${session_id} has an unsafe work_branch_path`
          )
        }

        const workBranch = state.work_branch
        const cwd = realpathSync(state.work_branch_path)
        const effectiveTitle = title ?? `feat: ${workBranch}`
        const effectiveBody = body ?? ''

        try {
          execFileSync('git', ['push', '-u', 'origin', workBranch], {
            cwd,
            stdio: 'pipe',
          })
        } catch (err) {
          return errorResponse(`Failed to push: ${err instanceof Error ? err.message : String(err)}`)
        }

        const compareUrl = computeCompareUrl(cwd, base_branch, workBranch)

        if (mode === 'push_only') {
          return ok({
            status: 'pushed',
            work_branch: workBranch,
            base_branch,
            compare_url: compareUrl,
            gh_available: false,
            pr_url: null,
          })
        }

        const ghAvailable = checkCliExists('gh')
        if (!ghAvailable) {
          return ok({
            status: 'pushed',
            work_branch: workBranch,
            base_branch,
            compare_url: compareUrl,
            gh_available: false,
            pr_url: null,
            note: 'gh not installed; use compare_url to open a PR manually.',
          })
        }

        try {
          execFileSync('gh', ['auth', 'status'], { cwd, stdio: 'pipe' })
        } catch {
          return ok({
            status: 'pushed',
            work_branch: workBranch,
            base_branch,
            compare_url: compareUrl,
            gh_available: false,
            pr_url: null,
            note: 'gh not authenticated; use compare_url to open a PR manually.',
          })
        }

        try {
          const existing = execFileSync(
            'gh',
            ['pr', 'view', workBranch, '--json', 'number,url'],
            { cwd, stdio: 'pipe' }
          ).toString()
          const parsed = JSON.parse(existing) as { url?: string }
          if (parsed.url) {
            return ok({
              status: 'pr_exists',
              pr_url: parsed.url,
              work_branch: workBranch,
              base_branch,
              compare_url: compareUrl,
              gh_available: true,
            })
          }
        } catch {
          // gh pr view exits non-zero when no PR exists.
        }

        try {
          const output = execFileSync(
            'gh',
            [
              'pr',
              'create',
              '--base',
              base_branch,
              '--head',
              workBranch,
              '--title',
              effectiveTitle,
              '--body',
              effectiveBody,
            ],
            { cwd, stdio: 'pipe' }
          ).toString()
          const urlMatch = output.match(/https:\/\/github\.com\/[^\s]+/)
          const prUrl = urlMatch?.[0] ?? null

          return ok({
            status: 'pr_created',
            pr_url: prUrl,
            work_branch: workBranch,
            base_branch,
            compare_url: compareUrl,
            gh_available: true,
          })
        } catch (err) {
          return errorResponse(
            `gh pr create failed: ${err instanceof Error ? err.message : String(err)}`
          )
        }
      } catch (err) {
        return errorResponse(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  )
}

function ok(payload: object) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] }
}

function errorResponse(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }], isError: true }
}

function computeCompareUrl(cwd: string, baseBranch: string, headBranch: string): string | null {
  try {
    const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd,
      stdio: 'pipe',
    })
      .toString()
      .trim()

    let owner: string | null = null
    let repo: string | null = null

    const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/.]+)(\.git)?$/)
    const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+)\/([^/.]+)(\.git)?$/)

    if (httpsMatch) {
      owner = httpsMatch[1]
      repo = httpsMatch[2]
    } else if (sshMatch) {
      owner = sshMatch[1]
      repo = sshMatch[2]
    }

    if (!owner || !repo) {
      return null
    }

    return `https://github.com/${owner}/${repo}/compare/${baseBranch}...${headBranch}?expand=1`
  } catch {
    return null
  }
}
