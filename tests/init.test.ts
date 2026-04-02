import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initProject } from '../src/init.js'
import { mkdir, rm, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

const TEST_DIR = path.join(import.meta.dirname, 'fixtures', 'init-test')

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true })
})

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('initProject', () => {
  // --- .invoke/ directory ---

  it('creates .invoke directory with pipeline.yaml', async () => {
    await initProject(TEST_DIR)

    expect(existsSync(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'))).toBe(true)

    const config = await readFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), 'utf-8')
    expect(config).toContain('providers:')
    expect(config).toContain('roles:')
    expect(config).toContain('strategies:')
    expect(config).toContain('settings:')
  })

  it('copies default role prompts', async () => {
    await initProject(TEST_DIR)

    expect(existsSync(path.join(TEST_DIR, '.invoke', 'roles', 'researcher', 'codebase.md'))).toBe(true)
    expect(existsSync(path.join(TEST_DIR, '.invoke', 'roles', 'reviewer', 'security.md'))).toBe(true)
    expect(existsSync(path.join(TEST_DIR, '.invoke', 'roles', 'builder', 'default.md'))).toBe(true)
    expect(existsSync(path.join(TEST_DIR, '.invoke', 'roles', 'planner', 'architect.md'))).toBe(true)
  })

  it('copies default strategy prompts', async () => {
    await initProject(TEST_DIR)

    expect(existsSync(path.join(TEST_DIR, '.invoke', 'strategies', 'tdd.md'))).toBe(true)
    expect(existsSync(path.join(TEST_DIR, '.invoke', 'strategies', 'implementation-first.md'))).toBe(true)
    expect(existsSync(path.join(TEST_DIR, '.invoke', 'strategies', 'prototype.md'))).toBe(true)
    expect(existsSync(path.join(TEST_DIR, '.invoke', 'strategies', 'bug-fix.md'))).toBe(true)
  })

  it('creates empty output directories', async () => {
    await initProject(TEST_DIR)

    expect(existsSync(path.join(TEST_DIR, '.invoke', 'specs'))).toBe(true)
    expect(existsSync(path.join(TEST_DIR, '.invoke', 'specs', 'research'))).toBe(true)
    expect(existsSync(path.join(TEST_DIR, '.invoke', 'plans'))).toBe(true)
    expect(existsSync(path.join(TEST_DIR, '.invoke', 'reviews'))).toBe(true)
  })

  it('does not overwrite existing pipeline.yaml', async () => {
    await mkdir(path.join(TEST_DIR, '.invoke'), { recursive: true })
    await writeFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), 'providers:\n  custom:\n    cli: custom-ai\n    args: []')

    await initProject(TEST_DIR)

    const config = await readFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), 'utf-8')
    expect(config).toContain('custom-ai')
  })

  // --- Skills installation ---

  it('installs skills to .claude/skills/<name>/SKILL.md', async () => {
    await initProject(TEST_DIR)

    expect(existsSync(path.join(TEST_DIR, '.claude', 'skills', 'invoke-scope', 'SKILL.md'))).toBe(true)
    expect(existsSync(path.join(TEST_DIR, '.claude', 'skills', 'invoke-plan', 'SKILL.md'))).toBe(true)
    expect(existsSync(path.join(TEST_DIR, '.claude', 'skills', 'invoke-build', 'SKILL.md'))).toBe(true)
    expect(existsSync(path.join(TEST_DIR, '.claude', 'skills', 'invoke-review', 'SKILL.md'))).toBe(true)
    expect(existsSync(path.join(TEST_DIR, '.claude', 'skills', 'invoke-resume', 'SKILL.md'))).toBe(true)
    expect(existsSync(path.join(TEST_DIR, '.claude', 'skills', 'invoke-manage', 'SKILL.md'))).toBe(true)
    expect(existsSync(path.join(TEST_DIR, '.claude', 'skills', 'invoke-messaging', 'SKILL.md'))).toBe(true)
    expect(existsSync(path.join(TEST_DIR, '.claude', 'skills', 'invoke-orchestrate', 'SKILL.md'))).toBe(true)
  })

  it('skill files contain valid frontmatter', async () => {
    await initProject(TEST_DIR)

    const content = await readFile(path.join(TEST_DIR, '.claude', 'skills', 'invoke-scope', 'SKILL.md'), 'utf-8')
    expect(content).toContain('name: invoke-scope')
    expect(content).toContain('description:')
  })

  it('does not overwrite existing skills', async () => {
    const skillDir = path.join(TEST_DIR, '.claude', 'skills', 'invoke-scope')
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, 'SKILL.md'), '# Custom skill content')

    await initProject(TEST_DIR)

    const content = await readFile(path.join(skillDir, 'SKILL.md'), 'utf-8')
    expect(content).toBe('# Custom skill content')
  })

  // --- MCP server registration ---

  it('creates .mcp.json with invoke server', async () => {
    await initProject(TEST_DIR)

    expect(existsSync(path.join(TEST_DIR, '.mcp.json'))).toBe(true)

    const mcpConfig = JSON.parse(await readFile(path.join(TEST_DIR, '.mcp.json'), 'utf-8'))
    expect(mcpConfig.mcpServers.invoke).toBeTruthy()
    expect(mcpConfig.mcpServers.invoke.command).toBe('invoke-mcp')
  })

  it('does not overwrite existing .mcp.json entries', async () => {
    await writeFile(path.join(TEST_DIR, '.mcp.json'), JSON.stringify({
      mcpServers: {
        'other-server': { command: 'other', args: [] },
      },
    }))

    await initProject(TEST_DIR)

    const mcpConfig = JSON.parse(await readFile(path.join(TEST_DIR, '.mcp.json'), 'utf-8'))
    expect(mcpConfig.mcpServers['other-server']).toBeTruthy()
    expect(mcpConfig.mcpServers.invoke).toBeTruthy()
  })

  it('does not overwrite existing invoke MCP entry', async () => {
    await writeFile(path.join(TEST_DIR, '.mcp.json'), JSON.stringify({
      mcpServers: {
        invoke: { command: 'custom-invoke', args: ['--custom'] },
      },
    }))

    await initProject(TEST_DIR)

    const mcpConfig = JSON.parse(await readFile(path.join(TEST_DIR, '.mcp.json'), 'utf-8'))
    expect(mcpConfig.mcpServers.invoke.command).toBe('custom-invoke')
  })

  // --- Hooks installation ---

  it('installs hooks in .claude/settings.json', async () => {
    await initProject(TEST_DIR)

    expect(existsSync(path.join(TEST_DIR, '.claude', 'settings.json'))).toBe(true)

    const settings = JSON.parse(await readFile(path.join(TEST_DIR, '.claude', 'settings.json'), 'utf-8'))
    expect(settings.hooks).toBeTruthy()
    expect(settings.hooks.SessionStart).toBeTruthy()
    expect(settings.hooks.PostToolUse).toBeTruthy()
  })

  it('SessionStart hook references session-start.js', async () => {
    await initProject(TEST_DIR)

    const settings = JSON.parse(await readFile(path.join(TEST_DIR, '.claude', 'settings.json'), 'utf-8'))
    const sessionHook = settings.hooks.SessionStart[0].hooks[0]
    expect(sessionHook.type).toBe('command')
    expect(sessionHook.command).toContain('session-start.js')
  })

  it('PostToolUse hook matches invoke_merge_worktree', async () => {
    await initProject(TEST_DIR)

    const settings = JSON.parse(await readFile(path.join(TEST_DIR, '.claude', 'settings.json'), 'utf-8'))
    const postHook = settings.hooks.PostToolUse[0]
    expect(postHook.matcher).toContain('invoke_merge_worktree')
  })

  it('does not overwrite existing hooks', async () => {
    await mkdir(path.join(TEST_DIR, '.claude'), { recursive: true })
    await writeFile(path.join(TEST_DIR, '.claude', 'settings.json'), JSON.stringify({
      hooks: {
        SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'echo custom' }] }],
      },
    }))

    await initProject(TEST_DIR)

    const settings = JSON.parse(await readFile(path.join(TEST_DIR, '.claude', 'settings.json'), 'utf-8'))
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe('echo custom')
    // PostToolUse should still be added
    expect(settings.hooks.PostToolUse).toBeTruthy()
  })

  it('preserves existing settings when adding hooks', async () => {
    await mkdir(path.join(TEST_DIR, '.claude'), { recursive: true })
    await writeFile(path.join(TEST_DIR, '.claude', 'settings.json'), JSON.stringify({
      permissions: { allow: ['Bash(npm *)'] },
    }))

    await initProject(TEST_DIR)

    const settings = JSON.parse(await readFile(path.join(TEST_DIR, '.claude', 'settings.json'), 'utf-8'))
    expect(settings.permissions.allow).toContain('Bash(npm *)')
    expect(settings.hooks).toBeTruthy()
  })
})
