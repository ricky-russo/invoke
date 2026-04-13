import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

const hookPath = path.resolve('plugin/hooks/enforce-skill-gate.cjs')

type HookOutput = {
  hookSpecificOutput: {
    hookEventName: string
    permissionDecision: 'allow' | 'deny'
    permissionDecisionReason?: string
  }
}

describe.sequential('enforce-skill-gate hook', () => {
  const cleanupPaths: string[] = []

  beforeEach(() => {
    cleanupPaths.length = 0
  })

  afterEach(async () => {
    await Promise.all(cleanupPaths.map(target => rm(target, { recursive: true, force: true })))
  })

  async function createProjectDir() {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-hook-gate-'))
    cleanupPaths.push(projectDir)
    return projectDir
  }

  function runHook(cwd: string, env: NodeJS.ProcessEnv = {}) {
    const stdout = execFileSync('node', [hookPath], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...env,
      },
    })

    return JSON.parse(stdout) as HookOutput
  }

  it('allows when the sentinel file exists', async () => {
    const projectDir = await createProjectDir()
    await mkdir(path.join(projectDir, '.invoke'), { recursive: true })
    await writeFile(path.join(projectDir, '.invoke', '.skill-active'), '{"skill":"invoke:invoke-scope"}')

    expect(runHook(projectDir)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
      },
    })
  })

  it('denies when the sentinel file is missing', async () => {
    const projectDir = await createProjectDir()
    await mkdir(path.join(projectDir, '.invoke'), { recursive: true })

    expect(runHook(projectDir)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Invoke pipeline requires a loaded skill before editing files. Route this work through the appropriate invoke skill (e.g., invoke-scope for new work, invoke-resume to continue).',
      },
    })
  })

  it('denies when the .invoke directory is missing', async () => {
    const projectDir = await createProjectDir()

    expect(runHook(projectDir)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Invoke pipeline requires a loaded skill before editing files. Route this work through the appropriate invoke skill (e.g., invoke-scope for new work, invoke-resume to continue).',
      },
    })
  })

  it('fails open when the sentinel check throws an error', async () => {
    const projectDir = await createProjectDir()
    await mkdir(path.join(projectDir, '.invoke'), { recursive: true })

    const preloadPath = path.join(projectDir, 'mock-fs-error.cjs')
    await writeFile(preloadPath, `
const fs = require('fs');
const originalExistsSync = fs.existsSync;
fs.existsSync = function(targetPath) {
  if (typeof targetPath === 'string' && targetPath.endsWith('/.invoke/.skill-active')) {
    throw new Error('existsSync boom');
  }
  return originalExistsSync.apply(this, arguments);
};
`)

    expect(runHook(projectDir, { NODE_OPTIONS: `--require ${preloadPath}` })).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
      },
    })
  })

  it('completes in under 200ms', async () => {
    const projectDir = await createProjectDir()
    await mkdir(path.join(projectDir, '.invoke'), { recursive: true })
    await writeFile(path.join(projectDir, '.invoke', '.skill-active'), '{"skill":"invoke:invoke-scope"}')

    const start = performance.now()
    runHook(projectDir)
    const durationMs = performance.now() - start

    expect(durationMs).toBeLessThan(200)
  })

  it('includes invoke-scope and invoke-resume in the deny reason', async () => {
    const projectDir = await createProjectDir()
    await mkdir(path.join(projectDir, '.invoke'), { recursive: true })

    const result = runHook(projectDir)

    expect(result.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(result.hookSpecificOutput.permissionDecisionReason).toContain('invoke-scope')
    expect(result.hookSpecificOutput.permissionDecisionReason).toContain('invoke-resume')
  })
})
