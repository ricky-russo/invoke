import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ContextManager } from '../../src/tools/context.js'
import { mkdir, writeFile, readFile, rm } from 'fs/promises'
import path from 'path'
import os from 'os'

const TEST_DIR = path.join(os.tmpdir(), 'invoke-context-test')
let manager: ContextManager

beforeEach(async () => {
  await mkdir(path.join(TEST_DIR, '.invoke'), { recursive: true })
  manager = new ContextManager(TEST_DIR)
})

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('ContextManager', () => {
  it('returns null when no context.md exists', async () => {
    const content = await manager.get()
    expect(content).toBeNull()
  })

  it('returns false for exists() when file missing', () => {
    expect(manager.exists()).toBe(false)
  })

  it('initializes context.md with content', async () => {
    await manager.initialize('# Project Context\n\n## Overview\n\nTest project')
    expect(manager.exists()).toBe(true)
    const content = await manager.get()
    expect(content).toContain('Test project')
  })

  it('reads existing context.md', async () => {
    await writeFile(
      path.join(TEST_DIR, '.invoke', 'context.md'),
      '# Existing\n\nContent here'
    )
    const content = await manager.get()
    expect(content).toBe('# Existing\n\nContent here')
  })

  it('replaces a section by heading', async () => {
    await manager.initialize(
      '# Project Context\n\n## Architecture\n\nOld arch\n\n## Conventions\n\nOld conventions'
    )
    await manager.updateSection('Architecture', 'New architecture description', 'replace')
    const content = await manager.get()
    expect(content).toContain('New architecture description')
    expect(content).not.toContain('Old arch')
    expect(content).toContain('Old conventions')
  })

  it('appends to a section by heading', async () => {
    await manager.initialize(
      '# Project Context\n\n## Completed Work\n\nFirst item'
    )
    await manager.updateSection('Completed Work', '\n- Second item', 'append')
    const content = await manager.get()
    expect(content).toContain('First item')
    expect(content).toContain('Second item')
  })

  it('throws when updating nonexistent section', async () => {
    await manager.initialize('# Project Context\n\n## Architecture\n\nContent')
    await expect(
      manager.updateSection('Nonexistent', 'content', 'replace')
    ).rejects.toThrow()
  })

  it('truncates content when getting with maxLength', async () => {
    const longContent = '# Context\n\n' + 'x'.repeat(5000)
    await manager.initialize(longContent)
    const truncated = await manager.get(100)
    expect(truncated!.length).toBeLessThanOrEqual(115)
    expect(truncated).toContain('(truncated)')
  })
})
