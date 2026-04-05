import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { loadConfig } from '../config.js'
import { SessionManager } from '../session/manager.js'
import type { SessionInfo } from '../types.js'

const DEFAULT_STALE_SESSION_DAYS = 7

export function registerSessionTools(
  server: McpServer,
  sessionManager: SessionManager,
  projectDir: string
): void {
  server.registerTool(
    'invoke_list_sessions',
    {
      description: 'List all pipeline sessions.',
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const sessions = await getSessionsWithStatus(sessionManager, projectDir)
        return {
          content: [{ type: 'text', text: JSON.stringify(sessions, null, 2) }],
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
      }),
    },
    async ({ session_id, status_filter }) => {
      try {
        if (session_id) {
          if (!sessionManager.exists(session_id)) {
            throw new Error(`Session '${session_id}' does not exist`)
          }

          await sessionManager.cleanup(session_id)
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

          await sessionManager.cleanup(session.session_id)
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

async function getSessionsWithStatus(
  sessionManager: SessionManager,
  projectDir: string
): Promise<SessionInfo[]> {
  const staleSessionDays = await getStaleSessionDays(projectDir)
  return sessionManager.list(staleSessionDays)
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
