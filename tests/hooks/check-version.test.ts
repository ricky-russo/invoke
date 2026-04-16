import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { RequestListener, Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'

const hookPath = path.resolve('plugin/hooks/check-version.cjs')
const ONE_HOUR_MS = 60 * 60 * 1000
const execFileAsync = promisify(execFile)

type HookOutput = {
  hookSpecificOutput: {
    hookEventName: string
    additionalContext: string
  }
}

describe.sequential('check-version hook', () => {
  const cleanupPaths: string[] = []
  const cleanupServers: Server[] = []

  beforeEach(() => {
    cleanupPaths.length = 0
    cleanupServers.length = 0
  })

  afterEach(async () => {
    await Promise.all(
      cleanupServers.map(
        server =>
          new Promise<void>((resolve, reject) => {
            server.close(error => {
              if (error) {
                reject(error)
                return
              }

              resolve()
            })
          }),
      ),
    )
    await Promise.all(cleanupPaths.map(target => rm(target, { recursive: true, force: true })))
  })

  async function createTempDir(prefix: string) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), prefix))
    cleanupPaths.push(tempDir)
    return tempDir
  }

  async function createProjectDir(withInvoke = true) {
    const projectDir = await createTempDir('invoke-hook-version-project-')
    if (withInvoke) {
      await mkdir(path.join(projectDir, '.invoke'), { recursive: true })
    }

    return projectDir
  }

  async function createPluginRoot(localVersion?: string) {
    const pluginRoot = await createTempDir('invoke-hook-version-plugin-')

    if (localVersion) {
      await mkdir(path.join(pluginRoot, '.claude-plugin'), { recursive: true })
      await writeFile(
        path.join(pluginRoot, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ version: localVersion }),
      )
    }

    return pluginRoot
  }

  async function writeCache(projectDir: string, contents: { latest_version: string; checked_at: number } | string) {
    await mkdir(path.join(projectDir, '.invoke'), { recursive: true })
    await writeFile(
      path.join(projectDir, '.invoke', '.version-check'),
      typeof contents === 'string' ? contents : JSON.stringify(contents),
    )
  }

  async function createVersionServer(listener: RequestListener) {
    const server = createServer(listener)

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        reject(error)
      }

      server.once('error', onError)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', onError)
        resolve()
      })
    })

    cleanupServers.push(server)

    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address')
    }

    return `http://127.0.0.1:${(address as AddressInfo).port}/package.json`
  }

  async function runHook(projectDir: string, pluginRoot: string, env: NodeJS.ProcessEnv = {}) {
    const { stdout } = await execFileAsync('node', [hookPath], {
      cwd: projectDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: projectDir,
        CLAUDE_PLUGIN_ROOT: pluginRoot,
        ...env,
      },
    })

    return {
      stdout: stdout ?? '',
      parsed: stdout ? (JSON.parse(stdout) as HookOutput) : null,
    }
  }

  it('emits an update notice when the cache has a newer version', async () => {
    const projectDir = await createProjectDir()
    const pluginRoot = await createPluginRoot('0.1.0')
    await writeCache(projectDir, {
      latest_version: '99.0.0',
      checked_at: Date.now(),
    })

    const result = await runHook(projectDir, pluginRoot)

    expect(result.parsed).toEqual({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext:
          '[INVOKE UPDATE] A newer version of invoke is available: v99.0.0 (current: v0.1.0). To update, remove and re-add the invoke marketplace in your Claude Code settings.',
      },
    })
    expect(result.parsed?.hookSpecificOutput.additionalContext).toContain('[INVOKE UPDATE]')
    expect(result.parsed?.hookSpecificOutput.additionalContext).toContain('v99.0.0')
    expect(result.parsed?.hookSpecificOutput.additionalContext).toContain('v0.1.0')
  })

  it('does not emit output when the cached version matches the local version', async () => {
    const projectDir = await createProjectDir()
    const pluginRoot = await createPluginRoot('0.1.0')
    await writeCache(projectDir, {
      latest_version: '0.1.0',
      checked_at: Date.now(),
    })

    const result = await runHook(projectDir, pluginRoot)

    expect(result.stdout).toBe('')
    expect(result.parsed).toBeNull()
  })

  it('does not emit output when the cached remote version is older than local', async () => {
    const projectDir = await createProjectDir()
    const pluginRoot = await createPluginRoot('0.2.0')
    await writeCache(projectDir, {
      latest_version: '0.1.0',
      checked_at: Date.now(),
    })

    const result = await runHook(projectDir, pluginRoot)

    expect(result.stdout).toBe('')
    expect(result.parsed).toBeNull()
  })

  it('completes in under 200ms when a fresh cache is present', async () => {
    const projectDir = await createProjectDir()
    const pluginRoot = await createPluginRoot('0.1.0')
    await writeCache(projectDir, {
      latest_version: '99.0.0',
      checked_at: Date.now(),
    })

    const start = performance.now()
    const result = await runHook(projectDir, pluginRoot)
    const durationMs = performance.now() - start

    expect(durationMs).toBeLessThan(200)
    expect(result.parsed?.hookSpecificOutput.additionalContext).toContain('v99.0.0')
  })

  it('does not crash when the cache is stale', async () => {
    const projectDir = await createProjectDir()
    const pluginRoot = await createPluginRoot('0.1.0')
    const remoteUrl = await createVersionServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ version: '99.0.0' }))
    })

    await writeCache(projectDir, {
      latest_version: '99.0.0',
      checked_at: Date.now() - (2 * ONE_HOUR_MS),
    })

    const result = await runHook(projectDir, pluginRoot, {
      INVOKE_VERSION_CHECK_URL: remoteUrl,
    })

    expect(result.parsed?.hookSpecificOutput.additionalContext).toContain('v99.0.0')
  })

  it('does not emit output or create .invoke when the project has no invoke directory', async () => {
    const projectDir = await createProjectDir(false)
    const pluginRoot = await createPluginRoot('0.1.0')

    const result = await runHook(projectDir, pluginRoot)

    expect(result.stdout).toBe('')
    expect(result.parsed).toBeNull()
    expect(existsSync(path.join(projectDir, '.invoke'))).toBe(false)
  })

  it('does not crash when plugin.json is missing', async () => {
    const projectDir = await createProjectDir()
    const pluginRoot = await createPluginRoot()

    const result = await runHook(projectDir, pluginRoot)

    expect(result.stdout).toBe('')
  })

  it('does not crash when the cache file contains malformed JSON', async () => {
    const projectDir = await createProjectDir()
    const pluginRoot = await createPluginRoot('0.1.0')
    const remoteUrl = await createVersionServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ version: '0.1.0' }))
    })
    await writeCache(projectDir, '{"latest_version":')

    const result = await runHook(projectDir, pluginRoot, {
      INVOKE_VERSION_CHECK_URL: remoteUrl,
    })

    expect(result.stdout).toBe('')
  })

  it('ignores a symlinked .invoke directory on cache reads and falls back to the remote URL', async () => {
    const projectDir = await createProjectDir(false)
    const pluginRoot = await createPluginRoot('1.0.0')
    const invokeTargetDir = await createTempDir('invoke-hook-version-target-')
    const remoteUrl = await createVersionServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ version: '1.0.0' }))
    })

    await writeFile(
      path.join(invokeTargetDir, '.version-check'),
      JSON.stringify({
        latest_version: '99.0.0',
        checked_at: Date.now(),
      }),
    )
    await symlink(invokeTargetDir, path.join(projectDir, '.invoke'))

    const result = await runHook(projectDir, pluginRoot, {
      INVOKE_VERSION_CHECK_URL: remoteUrl,
    })

    expect(result.stdout).toBe('')
  })

  it('emits the exact update message format', async () => {
    const projectDir = await createProjectDir()
    const pluginRoot = await createPluginRoot('0.1.0')
    await writeCache(projectDir, {
      latest_version: '1.2.3',
      checked_at: Date.now(),
    })

    const result = await runHook(projectDir, pluginRoot)

    expect(result.parsed).toEqual({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext:
          '[INVOKE UPDATE] A newer version of invoke is available: v1.2.3 (current: v0.1.0). To update, remove and re-add the invoke marketplace in your Claude Code settings.',
      },
    })
  })

  it('detects a minor version bump from the cache', async () => {
    const projectDir = await createProjectDir()
    const pluginRoot = await createPluginRoot('0.1.9')
    await writeCache(projectDir, {
      latest_version: '0.2.0',
      checked_at: Date.now(),
    })

    const result = await runHook(projectDir, pluginRoot)

    expect(result.parsed?.hookSpecificOutput.additionalContext).toContain('v0.2.0')
    expect(result.parsed?.hookSpecificOutput.additionalContext).toContain('v0.1.9')
  })

  it('detects a major version bump from the cache', async () => {
    const projectDir = await createProjectDir()
    const pluginRoot = await createPluginRoot('0.99.99')
    await writeCache(projectDir, {
      latest_version: '1.0.0',
      checked_at: Date.now(),
    })

    const result = await runHook(projectDir, pluginRoot)

    expect(result.parsed?.hookSpecificOutput.additionalContext).toContain('v1.0.0')
    expect(result.parsed?.hookSpecificOutput.additionalContext).toContain('v0.99.99')
  })

  it('does not flag a higher local patch version as an update', async () => {
    const projectDir = await createProjectDir()
    const pluginRoot = await createPluginRoot('0.1.5')
    await writeCache(projectDir, {
      latest_version: '0.1.0',
      checked_at: Date.now(),
    })

    const result = await runHook(projectDir, pluginRoot)

    expect(result.stdout).toBe('')
    expect(result.parsed).toBeNull()
  })

  it('rejects cached latest_version that fails semver validation', async () => {
    const projectDir = await createProjectDir()
    const pluginRoot = await createPluginRoot('0.1.0')
    const remoteUrl = await createVersionServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ version: '0.1.0' }))
    })

    await writeCache(projectDir, {
      latest_version: '1.0.0; malicious payload',
      checked_at: Date.now(),
    })

    const result = await runHook(projectDir, pluginRoot, {
      INVOKE_VERSION_CHECK_URL: remoteUrl,
    })

    expect(result.stdout).toBe('')
  })

  it('rejects cache with checked_at in the future', async () => {
    const projectDir = await createProjectDir()
    const pluginRoot = await createPluginRoot('0.1.0')
    const remoteUrl = await createVersionServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ version: '0.1.0' }))
    })

    await writeCache(projectDir, {
      latest_version: '99.0.0',
      checked_at: Date.now() + ONE_HOUR_MS,
    })

    const result = await runHook(projectDir, pluginRoot, {
      INVOKE_VERSION_CHECK_URL: remoteUrl,
    })

    expect(result.stdout).toBe('')
  })

  it('writes cache file after fresh fetch when .invoke exists and cache is missing', async () => {
    const projectDir = await createProjectDir()
    const pluginRoot = await createPluginRoot('0.1.0')
    const cachePath = path.join(projectDir, '.invoke', '.version-check')

    const remoteUrl = await createVersionServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ version: '1.2.3' }))
    })

    await runHook(projectDir, pluginRoot, {
      INVOKE_VERSION_CHECK_URL: remoteUrl,
    })

    expect(existsSync(cachePath)).toBe(true)

    const cache = JSON.parse(await readFile(cachePath, 'utf8')) as {
      latest_version?: unknown
      checked_at?: unknown
    }

    expect(cache.latest_version).toBe('1.2.3')
    expect(cache.checked_at).toEqual(expect.any(Number))
  })

  it('fetches a newer version from the remote URL override, emits an update, and writes cache', async () => {
    const projectDir = await createProjectDir()
    const pluginRoot = await createPluginRoot('0.1.0')
    const cachePath = path.join(projectDir, '.invoke', '.version-check')
    const remoteUrl = await createVersionServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ version: '2.0.0' }))
    })

    const result = await runHook(projectDir, pluginRoot, {
      INVOKE_VERSION_CHECK_URL: remoteUrl,
    })

    expect(result.parsed?.hookSpecificOutput.additionalContext).toContain('v2.0.0')
    expect(result.parsed?.hookSpecificOutput.additionalContext).toContain('v0.1.0')
    expect(JSON.parse(await readFile(cachePath, 'utf8'))).toMatchObject({
      latest_version: '2.0.0',
    })
  })

  it('fails open when the remote URL override returns malformed JSON', async () => {
    const projectDir = await createProjectDir()
    const pluginRoot = await createPluginRoot('0.1.0')
    const remoteUrl = await createVersionServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"version":')
    })

    const result = await runHook(projectDir, pluginRoot, {
      INVOKE_VERSION_CHECK_URL: remoteUrl,
    })

    expect(result.stdout).toBe('')
  })

  it('fails open when the remote URL override returns a non-200 response', async () => {
    const projectDir = await createProjectDir()
    const pluginRoot = await createPluginRoot('0.1.0')
    const remoteUrl = await createVersionServer((_req, res) => {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'unavailable' }))
    })

    const result = await runHook(projectDir, pluginRoot, {
      INVOKE_VERSION_CHECK_URL: remoteUrl,
    })

    expect(result.stdout).toBe('')
  })

  it('fails open when the remote URL override times out', async () => {
    const projectDir = await createProjectDir()
    const pluginRoot = await createPluginRoot('0.1.0')
    const remoteUrl = await createVersionServer(() => {})

    const start = performance.now()
    const result = await runHook(projectDir, pluginRoot, {
      INVOKE_VERSION_CHECK_URL: remoteUrl,
    })
    const durationMs = performance.now() - start

    expect(result.stdout).toBe('')
    expect(durationMs).toBeLessThan(4500)
  })

  it('uses cached value on second run within 1 hour', async () => {
    const projectDir = await createProjectDir()
    const pluginRoot = await createPluginRoot('0.1.0')
    let requestCount = 0
    const remoteUrl = await createVersionServer((_req, res) => {
      requestCount += 1
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ version: '0.1.0' }))
    })

    await runHook(projectDir, pluginRoot, {
      INVOKE_VERSION_CHECK_URL: remoteUrl,
    })
    expect(requestCount).toBe(1)

    await runHook(projectDir, pluginRoot, {
      INVOKE_VERSION_CHECK_URL: remoteUrl,
    })

    expect(requestCount).toBe(1)
  })
})
