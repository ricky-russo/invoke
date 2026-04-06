import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFile, rm } from 'fs/promises'
import path from 'path'
import { parse } from 'yaml'
import { BugManager } from '../../src/bugs/manager.js'

const TEST_DIR = path.join(import.meta.dirname, 'fixtures', 'bug-manager-test')

let bugManager: BugManager

beforeEach(() => {
  bugManager = new BugManager(TEST_DIR)
})

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('BugManager', () => {
  it('report() creates entry with correct fields and auto-generated BUG-001 ID', async () => {
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
      session_id: 'session-1',
      resolution: null,
      resolved_by_session: null,
    })
    expect(bug.created).toBe(bug.updated)
    expect(new Date(bug.created).getTime()).toBeGreaterThan(0)

    const raw = await readFile(path.join(TEST_DIR, '.invoke', 'bugs.yaml'), 'utf-8')
    const parsed = parse(raw) as { bugs: unknown[] }

    expect(parsed.bugs).toHaveLength(1)
    expect(parsed.bugs[0]).toEqual(bug)
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
    await bugManager.update(resolvedBug.id, { status: 'resolved' })

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

    await bugManager.update(second.id, { status: 'resolved' })

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

  it('update() throws for nonexistent bug ID', async () => {
    await expect(bugManager.update('BUG-999', { status: 'resolved' })).rejects.toThrow(
      "Bug 'BUG-999' not found"
    )
  })
})
