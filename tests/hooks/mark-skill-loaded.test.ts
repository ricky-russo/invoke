import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const hookPath = path.resolve('plugin/hooks/mark-skill-loaded.cjs')

describe.sequential('mark-skill-loaded hook', () => {
  const cleanupPaths: string[] = []

  beforeEach(() => {
    cleanupPaths.length = 0
  })

  afterEach(async () => {
    await Promise.all(cleanupPaths.map(target => rm(target, { recursive: true, force: true })))
  })

  async function createProjectDir() {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-hook-mark-'))
    cleanupPaths.push(projectDir)
    return projectDir
  }

  function getSentinelPath(projectDir: string) {
    return path.join(projectDir, '.invoke', '.skill-active')
  }

  function runHook(cwd: string, input: string) {
    return execFileSync('node', [hookPath], {
      cwd,
      encoding: 'utf8',
      input,
    })
  }

  it('creates the sentinel for invoke:invoke-scope', async () => {
    const projectDir = await createProjectDir()

    runHook(
      projectDir,
      JSON.stringify({
        tool_input: {
          skill: 'invoke:invoke-scope',
        },
      }),
    )

    const sentinel = JSON.parse(await readFile(getSentinelPath(projectDir), 'utf8')) as {
      skill: string
      ts: number
    }

    expect(sentinel.skill).toBe('invoke:invoke-scope')
    expect(sentinel.ts).toEqual(expect.any(Number))
  })

  it('does not create the sentinel for invoke:invoke-messaging', async () => {
    const projectDir = await createProjectDir()

    runHook(
      projectDir,
      JSON.stringify({
        tool_input: {
          skill: 'invoke:invoke-messaging',
        },
      }),
    )

    await expect(access(getSentinelPath(projectDir))).rejects.toThrow()
  })

  it('does not create the sentinel for invoke:invoke-manage', async () => {
    const projectDir = await createProjectDir()

    runHook(
      projectDir,
      JSON.stringify({
        tool_input: {
          skill: 'invoke:invoke-manage',
        },
      }),
    )

    await expect(access(getSentinelPath(projectDir))).rejects.toThrow()
  })

  it('does not create the sentinel for invoke:invoke-bugs', async () => {
    const projectDir = await createProjectDir()

    runHook(
      projectDir,
      JSON.stringify({
        tool_input: {
          skill: 'invoke:invoke-bugs',
        },
      }),
    )

    await expect(access(getSentinelPath(projectDir))).rejects.toThrow()
  })

  it('exits cleanly when stdin JSON is malformed', async () => {
    const projectDir = await createProjectDir()

    expect(() => runHook(projectDir, '{"tool_input":')).not.toThrow()
    await expect(access(getSentinelPath(projectDir))).rejects.toThrow()
  })

  it('exits cleanly when tool_input.skill is missing', async () => {
    const projectDir = await createProjectDir()

    expect(() =>
      runHook(
        projectDir,
        JSON.stringify({
          tool_input: {},
        }),
      ),
    ).not.toThrow()

    await expect(access(getSentinelPath(projectDir))).rejects.toThrow()
  })

  it('exits cleanly when tool_input.skill is not a string', async () => {
    const projectDir = await createProjectDir()

    expect(() =>
      runHook(
        projectDir,
        JSON.stringify({
          tool_input: {
            skill: 123,
          },
        }),
      ),
    ).not.toThrow()

    await expect(access(getSentinelPath(projectDir))).rejects.toThrow()
  })
})
