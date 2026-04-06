import { lstat, mkdir, readFile, rename, writeFile } from 'fs/promises'
import path from 'path'
import { ZodError } from 'zod'
import { parse, stringify } from 'yaml'
import { withLock } from '../session/lock.js'
import { BugsFileSchema, type BugEntry, type BugsFile, type BugSeverity, type BugStatus } from '../types.js'

interface ReportBugInput {
  title: string
  description: string
  severity?: BugSeverity
  file?: string
  line?: number
  labels?: string[]
  session_id?: string
}

interface ListBugsFilters {
  status?: BugStatus | 'all'
  severity?: BugSeverity
}

interface UpdateBugChanges {
  status?: BugStatus
  resolution?: string
  session_id?: string
}

export class BugNotFoundError extends Error {
  constructor(public readonly bugId: string) {
    super(`Bug '${bugId}' not found`)
    this.name = 'BugNotFoundError'
  }
}

export class BugManager {
  private bugsPath: string

  constructor(projectDir: string) {
    this.bugsPath = path.join(projectDir, '.invoke', 'bugs.yaml')
  }

  async report(input: ReportBugInput): Promise<BugEntry> {
    await mkdir(path.dirname(this.bugsPath), { recursive: true })

    return withLock(this.bugsPath, async () => {
      const bugsFile = await this.readBugsFile()
      const now = new Date().toISOString()
      const bug: BugEntry = {
        id: this.nextBugId(bugsFile.bugs),
        title: input.title,
        description: input.description,
        status: 'open',
        severity: input.severity ?? 'medium',
        file: input.file ?? null,
        line: input.line ?? null,
        labels: [...(input.labels ?? [])],
        reported_by_session: input.session_id ?? null,
        created: now,
        updated: now,
        resolution: null,
        resolved_by_session: null,
      }

      bugsFile.bugs.push(bug)
      await this.writeBugsFile(bugsFile)

      return bug
    })
  }

  async list(filters: ListBugsFilters = {}): Promise<BugEntry[]> {
    const bugsFile = await this.readBugsFile()
    const status = filters.status ?? 'open'

    return bugsFile.bugs.filter(bug => {
      if (status !== 'all' && bug.status !== status) {
        return false
      }

      if (filters.severity && bug.severity !== filters.severity) {
        return false
      }

      return true
    })
  }

  async update(id: string, changes: UpdateBugChanges): Promise<BugEntry> {
    await mkdir(path.dirname(this.bugsPath), { recursive: true })

    return withLock(this.bugsPath, async () => {
      const bugsFile = await this.readBugsFile()
      const bug = bugsFile.bugs.find(entry => entry.id === id)

      if (!bug) {
        throw new BugNotFoundError(id)
      }

      const isResolving = bug.status !== 'resolved' && changes.status === 'resolved'
      if (isResolving && !changes.session_id) {
        throw new Error('session_id required when resolving a bug')
      }

      let nextStatus = bug.status
      let nextResolution = bug.resolution
      let nextResolvedBySession = bug.resolved_by_session

      if (changes.status !== undefined) {
        nextStatus = changes.status
      }
      if (changes.resolution !== undefined) {
        nextResolution = changes.resolution
      }

      if (
        bug.status === 'resolved' &&
        (changes.status === 'open' || changes.status === 'in_progress')
      ) {
        nextResolution = null
        nextResolvedBySession = null
      } else if (changes.status === 'resolved' && changes.session_id) {
        nextResolvedBySession = changes.session_id
      }

      if (
        nextStatus === bug.status &&
        nextResolution === bug.resolution &&
        nextResolvedBySession === bug.resolved_by_session
      ) {
        throw new Error('No changes specified')
      }

      bug.status = nextStatus
      bug.resolution = nextResolution
      bug.resolved_by_session = nextResolvedBySession
      bug.updated = new Date().toISOString()

      await this.writeBugsFile(bugsFile)

      return bug
    })
  }

  private nextBugId(bugs: BugEntry[]): string {
    const maxId = bugs.reduce((max, bug) => {
      const match = /^BUG-(\d+)$/.exec(bug.id)
      if (!match) {
        return max
      }

      return Math.max(max, Number.parseInt(match[1], 10))
    }, 0)

    return `BUG-${String(maxId + 1).padStart(3, '0')}`
  }

  private async readBugsFile(): Promise<BugsFile> {
    await this.assertBugsPathIsNotSymlink()

    try {
      const content = await readFile(this.bugsPath, 'utf-8')
      const parsed = parse(content)
      // Break YAML alias references before validation and use.
      const cloneSafeParsed = JSON.parse(JSON.stringify(parsed ?? { bugs: [] })) as unknown

      return this.parseBugsFile(cloneSafeParsed)
    } catch (error) {
      if (this.isMissingFileError(error)) {
        return { bugs: [] }
      }

      throw error
    }
  }

  private async writeBugsFile(bugsFile: BugsFile): Promise<void> {
    await this.assertBugsPathIsNotSymlink()

    const validated = this.parseBugsFile(bugsFile)
    const serialized = stringify(validated)
    const tmpPath = `${this.bugsPath}.tmp`

    await writeFile(tmpPath, serialized)
    await rename(tmpPath, this.bugsPath)
  }

  private isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT'
  }

  private parseBugsFile(value: unknown): BugsFile {
    try {
      return BugsFileSchema.parse(value)
    } catch (error) {
      if (error instanceof ZodError) {
        throw new Error(`Invalid bugs.yaml contents: ${error.message}`, { cause: error })
      }

      throw error
    }
  }

  private async assertBugsPathIsNotSymlink(): Promise<void> {
    try {
      const stats = await lstat(this.bugsPath)

      if (stats.isSymbolicLink()) {
        throw new Error('bugs.yaml must not be a symlink')
      }
    } catch (error) {
      if (this.isMissingFileError(error)) {
        return
      }

      throw error
    }
  }
}
