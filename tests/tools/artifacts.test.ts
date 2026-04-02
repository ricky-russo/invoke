import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ArtifactManager } from '../../src/tools/artifacts.js'
import { mkdir, rm } from 'fs/promises'
import path from 'path'

const TEST_DIR = path.join(import.meta.dirname, 'fixtures', 'artifact-test')

let artifacts: ArtifactManager

beforeEach(async () => {
  await mkdir(path.join(TEST_DIR, '.invoke'), { recursive: true })
  artifacts = new ArtifactManager(TEST_DIR)
})

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('ArtifactManager', () => {
  it('saves an artifact to the correct stage directory', async () => {
    await artifacts.save('specs', 'spec.md', '# My Spec\n\nRequirements here.')

    const content = await artifacts.read('specs', 'spec.md')
    expect(content).toBe('# My Spec\n\nRequirements here.')
  })

  it('saves to nested subdirectories', async () => {
    await artifacts.save('specs/research', 'codebase-report.md', 'Report content')

    const content = await artifacts.read('specs/research', 'codebase-report.md')
    expect(content).toBe('Report content')
  })

  it('overwrites existing artifacts', async () => {
    await artifacts.save('specs', 'spec.md', 'Version 1')
    await artifacts.save('specs', 'spec.md', 'Version 2')

    const content = await artifacts.read('specs', 'spec.md')
    expect(content).toBe('Version 2')
  })

  it('throws when reading a nonexistent artifact', async () => {
    await expect(artifacts.read('specs', 'nonexistent.md')).rejects.toThrow()
  })

  it('lists artifacts in a stage directory', async () => {
    await artifacts.save('reviews', 'cycle-1.json', '{}')
    await artifacts.save('reviews', 'cycle-2.json', '{}')

    const files = await artifacts.list('reviews')
    expect(files).toContain('cycle-1.json')
    expect(files).toContain('cycle-2.json')
  })

  it('deletes an artifact', async () => {
    await artifacts.save('specs', 'to-delete.md', 'content')
    expect(await artifacts.read('specs', 'to-delete.md')).toBe('content')

    await artifacts.delete('specs', 'to-delete.md')
    await expect(artifacts.read('specs', 'to-delete.md')).rejects.toThrow()
  })

  it('throws when deleting nonexistent artifact', async () => {
    await expect(artifacts.delete('specs', 'nonexistent.md')).rejects.toThrow()
  })
})
