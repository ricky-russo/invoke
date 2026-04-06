import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, rm, symlink, writeFile } from 'fs/promises'
import path from 'path'
import { ZodError } from 'zod'
import { parse } from 'yaml'
import { BugManager, BugNotFoundError } from '../../src/bugs/manager.js'

const TEST_DIR = path.join(import.meta.dirname, 'fixtures', 'bug-manager-test')
const BUGS_FILE_PATH = path.join(TEST_DIR, '.invoke', 'bugs.yaml')

let bugManager: BugManager

beforeEach(() => {
  bugManager = new BugManager(TEST_DIR)
})

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('BugManager', () => {
  it('report() creates entry with correct fields and stores reported_by_session', async () => {
    const bug = await bugManager.report({
      title: 'Crash on startup',
      description: 'Application crashes before rendering the main window.',
      severity: 'critical',
      file: 'src/main.ts',
      line: 42,
      labels: ['startup', 'regression'],
      session_id: 'session-1',
    })

    expect(bug).toMatchObject({
      id: 'BUG-001',
      title: 'Crash on startup',
      description: 'Application crashes before rendering the main window.',
      status: 'open',
      severity: 'critical',
      file: 'src/main.ts',
      line: 42,
      labels: ['startup', 'regression'],
      reported_by_session: 'session-1',
      resolution: null,
      resolved_by_session: null,
    })
    expect(bug.created).toBe(bug.updated)
    expect(new Date(bug.created).getTime()).toBeGreaterThan(0)

    const raw = await readFile(BUGS_FILE_PATH, 'utf-8')
    const parsed = parse(raw) as { bugs: unknown[] }

    expect(parsed.bugs).toHaveLength(1)
    expect(parsed.bugs[0]).toEqual(bug)
    expect(parsed.bugs[0]).toHaveProperty('reported_by_session', 'session-1')
    expect(parsed.bugs[0]).not.toHaveProperty('session_id')
  })

  it('report() second call generates BUG-002', async () => {
    await bugManager.report({
      title: 'First bug',
      description: 'The first reported issue.',
      severity: 'high',
    })

    const second = await bugManager.report({
      title: 'Second bug',
      description: 'The second reported issue.',
    })

    expect(second.id).toBe('BUG-002')
    expect(second.severity).toBe('medium')
  })

  it('report() persists concurrent writes without losing either bug', async () => {
    const [first, second] = await Promise.all([
      bugManager.report({
        title: 'Concurrent bug A',
        description: 'Reported in parallel A.',
      }),
      bugManager.report({
        title: 'Concurrent bug B',
        description: 'Reported in parallel B.',
      }),
    ])

    expect([first.id, second.id].sort()).toEqual(['BUG-001', 'BUG-002'])

    const bugs = await bugManager.list({ status: 'all' })

    expect(bugs).toHaveLength(2)
    expect(bugs.map(bug => bug.id)).toEqual(['BUG-001', 'BUG-002'])
    expect(bugs.map(bug => bug.title).sort()).toEqual(['Concurrent bug A', 'Concurrent bug B'])
  })

  it('list() defaults to open bugs only', async () => {
    const openBug = await bugManager.report({
      title: 'Open bug',
      description: 'Still open.',
      severity: 'medium',
    })
    const inProgressBug = await bugManager.report({
      title: 'In-progress bug',
      description: 'Being fixed.',
      severity: 'high',
    })
    const resolvedBug = await bugManager.report({
      title: 'Resolved bug',
      description: 'Already fixed.',
      severity: 'low',
    })

    await bugManager.update(inProgressBug.id, { status: 'in_progress' })
    await bugManager.update(resolvedBug.id, { status: 'resolved', session_id: 'session-1' })

    await expect(bugManager.list()).resolves.toEqual([openBug])
  })

  it('list() with status=\'all\' returns everything', async () => {
    const first = await bugManager.report({
      title: 'First bug',
      description: 'First bug description.',
    })
    const second = await bugManager.report({
      title: 'Second bug',
      description: 'Second bug description.',
    })

    await bugManager.update(second.id, { status: 'resolved', session_id: 'session-1' })

    const bugs = await bugManager.list({ status: 'all' })

    expect(bugs).toHaveLength(2)
    expect(bugs.map(bug => bug.id)).toEqual([first.id, second.id])
    expect(bugs.map(bug => bug.status)).toEqual(['open', 'resolved'])
  })

  it('list() with severity filter works', async () => {
    const criticalBug = await bugManager.report({
      title: 'Critical bug',
      description: 'Critical severity bug.',
      severity: 'critical',
    })
    await bugManager.report({
      title: 'Low bug',
      description: 'Low severity bug.',
      severity: 'low',
    })

    await expect(bugManager.list({ status: 'all', severity: 'critical' })).resolves.toEqual([
      criticalBug,
    ])
  })

  it('list() returns empty array when file does not exist', async () => {
    await expect(bugManager.list()).resolves.toEqual([])
  })

  it('list() treats an empty bugs file as empty and report() can recover from it', async () => {
    await mkdir(path.dirname(BUGS_FILE_PATH), { recursive: true })
    await writeFile(BUGS_FILE_PATH, '')

    await expect(bugManager.list()).resolves.toEqual([])

    const bug = await bugManager.report({
      title: 'Recovered from empty file',
      description: 'A new bug after an empty file.',
    })

    expect(bug.id).toBe('BUG-001')
    await expect(bugManager.list({ status: 'all' })).resolves.toEqual([bug])
  })

  it('report() rejects bugs.yaml symlinks', async () => {
    await mkdir(path.dirname(BUGS_FILE_PATH), { recursive: true })

    const targetPath = path.join(TEST_DIR, 'elsewhere.yaml')
    await writeFile(targetPath, 'bugs: []\n')
    await symlink(targetPath, BUGS_FILE_PATH)

    await expect(
      bugManager.report({
        title: 'Symlinked file',
        description: 'This should fail.',
      })
    ).rejects.toThrow('bugs.yaml must not be a symlink')
  })

  it('list() rejects invalid bug entries with a Zod validation error', async () => {
    await mkdir(path.dirname(BUGS_FILE_PATH), { recursive: true })
    await writeFile(
      BUGS_FILE_PATH,
      [
        'bugs:',
        '  - id: BUG-001',
        '    title: Invalid bug',
        '    description: Invalid status field.',
        '    status: invalid_status',
        '    severity: high',
        '    labels: []',
        '    created: 2026-01-01T00:00:00.000Z',
        '    updated: 2026-01-01T00:00:00.000Z',
        '',
      ].join('\n')
    )

    let error: unknown

    try {
      await bugManager.list({ status: 'all' })
    } catch (caughtError) {
      error = caughtError
    }

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('Invalid bugs.yaml contents:')
    expect((error as Error & { cause?: unknown }).cause).toBeInstanceOf(ZodError)
  })

  it('update() changes status and sets updated timestamp', async () => {
    const bug = await bugManager.report({
      title: 'Needs triage',
      description: 'This bug needs triage.',
    })

    await new Promise(resolve => setTimeout(resolve, 10))

    const updated = await bugManager.update(bug.id, { status: 'in_progress' })

    expect(updated.status).toBe('in_progress')
    expect(updated.updated).not.toBe(bug.updated)
    expect(new Date(updated.updated).getTime()).toBeGreaterThan(new Date(bug.updated).getTime())
  })

  it('update() throws when no changes are specified', async () => {
    const bug = await bugManager.report({
      title: 'Unchanged bug',
      description: 'No updates should be applied.',
    })

    await expect(bugManager.update(bug.id, {})).rejects.toThrow('No changes specified')
  })

  it('update() requires session_id when resolving a bug', async () => {
    const bug = await bugManager.report({
      title: 'Resolvable bug',
      description: 'Resolving without a session should fail.',
    })

    await expect(bugManager.update(bug.id, { status: 'resolved' })).rejects.toThrow(
      'session_id required when resolving a bug'
    )
  })

  it('update() with resolution + session_id sets resolved_by_session', async () => {
    const bug = await bugManager.report({
      title: 'Fixable bug',
      description: 'This bug can be resolved.',
    })

    const updated = await bugManager.update(bug.id, {
      status: 'resolved',
      resolution: 'Patched the null check.',
      session_id: 'session-2',
    })

    expect(updated.status).toBe('resolved')
    expect(updated.resolution).toBe('Patched the null check.')
    expect(updated.resolved_by_session).toBe('session-2')
  })

  it('update() clears resolution and resolved_by_session when reopening a resolved bug', async () => {
    const bug = await bugManager.report({
      title: 'Reopenable bug',
      description: 'This bug will be resolved and reopened.',
    })

    await bugManager.update(bug.id, {
      status: 'resolved',
      resolution: 'Fixed by adding a guard clause.',
      session_id: 'session-2',
    })

    const reopened = await bugManager.update(bug.id, { status: 'open' })

    expect(reopened.status).toBe('open')
    expect(reopened.resolution).toBeNull()
    expect(reopened.resolved_by_session).toBeNull()
  })

  it('update() throws BugNotFoundError for nonexistent bug ID', async () => {
    await expect(
      bugManager.update('BUG-999', { status: 'resolved', session_id: 'session-1' })
    ).rejects.toBeInstanceOf(BugNotFoundError)
  })
})
