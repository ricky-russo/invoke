import { realpathSync } from 'fs'
import type { SessionManager } from '../session/manager.js'
import { isSafeSessionWorkBranchPath } from '../worktree/trusted-session-helpers.js'
import { StateManager } from './state.js'

export async function resolveSessionWorkBranchPath(
  sessionManager: SessionManager,
  projectDir: string | undefined,
  sessionId?: string
): Promise<string | undefined> {
  if (!sessionId) return undefined
  if (!projectDir) {
    throw new Error('Project directory is required when session_id is provided')
  }

  const sessionDir = sessionManager.resolve(sessionId)
  const stateManager = new StateManager(projectDir, sessionDir)
  const state = await stateManager.get()
  const workBranchPath = state?.work_branch_path

  if (workBranchPath === undefined) return undefined
  if (!isSafeSessionWorkBranchPath(workBranchPath, projectDir)) {
    throw new Error(
      `Refusing to use unsafe session work branch path for session '${sessionId}'`
    )
  }

  return realpathSync(workBranchPath)
}
