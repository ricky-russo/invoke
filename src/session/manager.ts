import { existsSync } from 'fs'
import { mkdir, readFile, readdir, rename, rm } from 'fs/promises'
import path from 'path'
import type { PipelineState, SessionInfo } from '../types.js'
import {
  validateSessionId,
  validateSessionIdForRead,
} from '../worktree/session-id-validator.js'

const MS_PER_DAY = 24 * 60 * 60 * 1000

export class SessionManager {
  private readonly invokeDir: string
  private readonly sessionsDir: string

  constructor(projectDir: string) {
    this.invokeDir = path.resolve(projectDir, '.invoke')
    this.sessionsDir = path.join(this.invokeDir, 'sessions')
  }

  async create(sessionId: string): Promise<string> {
    validateSessionId(sessionId)
    const sessionDir = this.getSessionDir(sessionId)
    await mkdir(sessionDir, { recursive: true })
    return sessionDir
  }

  resolve(sessionId: string): string {
    validateSessionIdForRead(sessionId)
    const sessionDir = this.getSessionDir(sessionId)
    if (!existsSync(sessionDir)) {
      throw new Error(`Session '${sessionId}' does not exist`)
    }
    return sessionDir
  }

  async list(staleDays = 7): Promise<SessionInfo[]> {
    if (!existsSync(this.sessionsDir)) {
      return []
    }

    const entries = await readdir(this.sessionsDir, { withFileTypes: true })
    const sessions = await Promise.all(
      entries
        .filter(entry => entry.isDirectory())
        .map(async entry => this.readSessionInfo(entry.name, staleDays))
    )

    return sessions
      .filter((session): session is SessionInfo => session !== null)
      .sort((left, right) => left.session_id.localeCompare(right.session_id))
  }

  async isStale(sessionId: string, staleDays = 7): Promise<boolean> {
    validateSessionIdForRead(sessionId)
    const state = await this.readState(sessionId)
    return this.isStateStale(state, staleDays)
  }

  async migrate(): Promise<{ migrated: boolean; sessionId?: string }> {
    const legacyStatePath = this.getLegacyStatePath()
    if (!existsSync(legacyStatePath)) {
      return { migrated: false }
    }

    const state = JSON.parse(await readFile(legacyStatePath, 'utf-8')) as PipelineState
    const sessionId = state.pipeline_id

    try {
      validateSessionIdForRead(sessionId)
    } catch {
      return { migrated: false }
    }

    const sessionDir = this.getSessionDir(sessionId)

    await mkdir(sessionDir, { recursive: true })

    try {
      await rename(legacyStatePath, this.getStatePath(sessionId))
    } catch (error) {
      if (this.isMissingFileError(error)) {
        return { migrated: false }
      }
      throw error
    }

    const legacyMetricsPath = this.getLegacyMetricsPath()
    if (existsSync(legacyMetricsPath)) {
      try {
        await rename(legacyMetricsPath, path.join(sessionDir, 'metrics.json'))
      } catch (error) {
        if (!this.isMissingFileError(error)) {
          throw error
        }
      }
    }

    return { migrated: true, sessionId }
  }

  async cleanup(sessionId: string): Promise<void> {
    validateSessionIdForRead(sessionId)
    await rm(this.getSessionDir(sessionId), { recursive: true, force: true })
  }

  exists(sessionId: string): boolean {
    validateSessionIdForRead(sessionId)
    return existsSync(this.getSessionDir(sessionId))
  }

  private getSessionDir(sessionId: string): string {
    return path.join(this.sessionsDir, sessionId)
  }

  private getStatePath(sessionId: string): string {
    return path.join(this.getSessionDir(sessionId), 'state.json')
  }

  private getLegacyStatePath(): string {
    return path.join(this.invokeDir, 'state.json')
  }

  private getLegacyMetricsPath(): string {
    return path.join(this.invokeDir, 'metrics.json')
  }

  async readState(sessionId: string): Promise<PipelineState> {
    validateSessionIdForRead(sessionId)
    const content = await readFile(this.getStatePath(sessionId), 'utf-8')
    return JSON.parse(content) as PipelineState
  }

  private async readSessionInfo(sessionId: string, staleDays = 7): Promise<SessionInfo | null> {
    const statePath = this.getStatePath(sessionId)
    if (!existsSync(statePath)) {
      return null
    }

    const state = await this.readState(sessionId)
    return {
      session_id: sessionId,
      pipeline_id: state.pipeline_id,
      current_stage: state.current_stage,
      started: state.started,
      last_updated: state.last_updated,
      status:
        state.current_stage === 'complete'
          ? 'complete'
          : this.isStateStale(state, staleDays)
            ? 'stale'
            : 'active',
    }
  }

  private isStateStale(state: Pick<PipelineState, 'last_updated'>, staleDays = 7): boolean {
    return Date.now() - new Date(state.last_updated).getTime() > staleDays * MS_PER_DAY
  }

  private isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
  }
}
