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

  it('does not overwrite existing role prompts', async () => {
    await mkdir(path.join(TEST_DIR, '.invoke', 'roles', 'reviewer'), { recursive: true })
    await writeFile(path.join(TEST_DIR, '.invoke', 'roles', 'reviewer', 'security.md'), '# Custom security prompt')

    await initProject(TEST_DIR)

    const content = await readFile(path.join(TEST_DIR, '.invoke', 'roles', 'reviewer', 'security.md'), 'utf-8')
    expect(content).toBe('# Custom security prompt')
  })

  it('does not create .claude directory or CLAUDE.md', async () => {
    await initProject(TEST_DIR)

    expect(existsSync(path.join(TEST_DIR, '.claude'))).toBe(false)
    expect(existsSync(path.join(TEST_DIR, 'CLAUDE.md'))).toBe(false)
    expect(existsSync(path.join(TEST_DIR, '.mcp.json'))).toBe(false)
  })
})
