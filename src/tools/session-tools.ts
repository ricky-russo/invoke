import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { loadConfig } from '../config.js'
import { MetricsManager } from '../metrics/manager.js'
import { SessionManager } from '../session/manager.js'
import { StateManager } from './state.js'
import type {
  MetricsSummary,
  PipelineState,
  SessionInfo,
  SessionMetricsSummary,
} from '../types.js'
import { isSafeSessionWorkBranchPath } from '../worktree/trusted-session-helpers.js'
import type { SessionWorktreeManager } from '../worktree/session-worktree.js'

const DEFAULT_STALE_SESSION_DAYS = 7

function isSafeWorkBranch(
  workBranch: string | undefined,
  sessionId: string,
  prefix: string
): workBranch is string {
  if (!workBranch) {
    return false
  }

  return workBranch === `${prefix}/${sessionId}`
}

export function registerSessionTools(
  server: McpServer,
  sessionManager: SessionManager,
  projectDir: string,
  sessionWorktreeManager?: SessionWorktreeManager
): void {
  server.registerTool(
    'invoke_list_sessions',
    {
      description: 'List all pipeline sessions.',
      inputSchema: z.object({
        withMetrics: z
          .boolean()
          .optional()
          .describe('Include dispatch count, duration, and estimated cost per session'),
      }),
    },
    async ({ withMetrics }) => {
      try {
        const sessions = await getSessionsWithStatus(sessionManager, projectDir)
        const responseSessions = withMetrics
          ? await addSessionMetricsSummaries(sessions, sessionManager, projectDir)
          : sessions
        return {
          content: [{ type: 'text', text: JSON.stringify(responseSessions, null, 2) }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Session error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    }
  )

  server.registerTool(
    'invoke_cleanup_sessions',
    {
      description: 'Remove completed or stale pipeline sessions.',
      inputSchema: z.object({
        session_id: z.string().optional(),
        status_filter: z.enum(['complete', 'stale', 'all']).optional(),
        delete_work_branch: z.boolean().optional(),
      }),
    },
    async ({ session_id, status_filter, delete_work_branch }) => {
      try {
        const deleteWorkBranch = delete_work_branch ?? false

        if (session_id) {
          if (!sessionManager.exists(session_id)) {
            throw new Error(`Session '${session_id}' does not exist`)
          }

          await cleanupSession(
            session_id,
            sessionManager,
            sessionWorktreeManager,
            projectDir,
            deleteWorkBranch
          )
          return {
            content: [{ type: 'text', text: JSON.stringify([session_id], null, 2) }],
          }
        }

        const sessions = await getSessionsWithStatus(sessionManager, projectDir)
        const filter = status_filter ?? 'complete'
        const cleanedSessionIds: string[] = []

        for (const session of sessions) {
          if (!matchesCleanupFilter(session, filter)) {
            continue
          }

          await cleanupSession(
            session.session_id,
            sessionManager,
            sessionWorktreeManager,
            projectDir,
            deleteWorkBranch
          )
          cleanedSessionIds.push(session.session_id)
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(cleanedSessionIds, null, 2) }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Session error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    }
  )
}

async function cleanupSession(
  sessionId: string,
  sessionManager: SessionManager,
  sessionWorktreeManager: SessionWorktreeManager | undefined,
  projectDir: string,
  deleteWorkBranch: boolean
): Promise<void> {
  if (sessionWorktreeManager) {
    const state = await readSessionState(sessionId, sessionManager, projectDir)
    const workBranch = state?.work_branch
    const workBranchPath = state?.work_branch_path

    if (workBranch && workBranchPath) {
      let prefix = 'invoke/work'

      try {
        const config = await loadConfig(projectDir)
        prefix = config.settings.work_branch_prefix ?? 'invoke/work'
      } catch {
        // Fall back to the default prefix if config cannot be read.
      }

      if (!isSafeWorkBranch(workBranch, sessionId, prefix)) {
        console.error(
          `Session ${sessionId} has unexpected work_branch '${workBranch}'; skipping branch cleanup.`
        )
      } else if (!isSafeSessionWorkBranchPath(workBranchPath, projectDir)) {
        console.error(
          `Session ${sessionId} has unsafe work_branch_path; skipping worktree cleanup.`
        )
      } else {
        try {
          await sessionWorktreeManager.cleanup(sessionId, workBranch, deleteWorkBranch)
        } catch (error) {
          console.error(
            `Failed to clean up session worktree for '${sessionId}': ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
    }
  }

  await sessionManager.cleanup(sessionId)
}

async function readSessionState(
  sessionId: string,
  sessionManager: SessionManager,
  projectDir: string
): Promise<PipelineState | null> {
  let sessionDir: string

  try {
    sessionDir = sessionManager.resolve(sessionId)
  } catch {
    return null
  }

  return new StateManager(projectDir, sessionDir).get()
}

async function getSessionsWithStatus(
  sessionManager: SessionManager,
  projectDir: string
): Promise<SessionInfo[]> {
  const staleSessionDays = await getStaleSessionDays(projectDir)
  return sessionManager.list(staleSessionDays)
}

async function addSessionMetricsSummaries(
  sessions: SessionInfo[],
  sessionManager: SessionManager,
  projectDir: string
): Promise<SessionInfo[]> {
  const metricsManager = new MetricsManager(projectDir)
  const sessionPipelineBindings = await Promise.all(
    sessions.map(async session => ({
      session,
      pipelineId: await getSessionPipelineId(session.session_id, sessionManager, projectDir),
    }))
  )
  const summariesByPipelineId = await metricsManager.getSummariesByPipelineIds(
    sessionPipelineBindings.flatMap(({ pipelineId }) => (pipelineId ? [pipelineId] : []))
  )

  return sessionPipelineBindings.map(({ session, pipelineId }) => ({
    ...session,
    metrics_summary: toSessionMetricsSummary(
      pipelineId ? summariesByPipelineId.get(pipelineId) : undefined
    ),
  }))
}

async function getSessionPipelineId(
  sessionId: string,
  sessionManager: SessionManager,
  projectDir: string
): Promise<string | null> {
  const sessionState = await new StateManager(projectDir, sessionManager.resolve(sessionId)).get()
  return sessionState?.pipeline_id ?? null
}

function toSessionMetricsSummary(summary?: MetricsSummary): SessionMetricsSummary {
  return {
    total_dispatches: summary?.total_dispatches ?? 0,
    total_duration_ms: summary?.total_duration_ms ?? 0,
    total_estimated_cost_usd: summary?.total_estimated_cost_usd ?? 0,
  }
}

async function getStaleSessionDays(projectDir: string): Promise<number> {
  try {
    const config = await loadConfig(projectDir)
    return config.settings.stale_session_days ?? DEFAULT_STALE_SESSION_DAYS
  } catch {
    return DEFAULT_STALE_SESSION_DAYS
  }
}

function matchesCleanupFilter(
  session: SessionInfo,
  filter: 'complete' | 'stale' | 'all'
): boolean {
  switch (filter) {
    case 'complete':
      return session.status === 'complete'
    case 'stale':
      return session.status === 'stale'
    case 'all':
      return session.status !== 'active'
  }
}
