import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import { checkForNewDefaults } from '../src/defaults-checker.js'

const TEST_DIR = path.join(os.tmpdir(), 'invoke-defaults-checker-test')

describe('checkForNewDefaults', () => {
  beforeEach(async () => {
    await mkdir(path.join(TEST_DIR, '.invoke'), { recursive: true })
  })

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  it('reports new preset files with preset-specific descriptions', async () => {
    const missing = await checkForNewDefaults(TEST_DIR)

    expect(missing).toEqual(expect.arrayContaining([
      expect.objectContaining({
        relativePath: 'presets/quick.yaml',
        description: 'New preset: quick',
      }),
    ]))
  })

  it('ignores future role files that do not exist in defaults yet', async () => {
    const missing = await checkForNewDefaults(TEST_DIR)
    const futureRoleFiles = ['docs.md', 'integration-test.md', 'migration.md']

    expect(
      missing.some(entry => futureRoleFiles.some(fileName => entry.relativePath.endsWith(fileName))),
    ).toBe(false)
  })

  it('reports new builder role files that now exist in defaults', async () => {
    const missing = await checkForNewDefaults(TEST_DIR)

    expect(missing).toEqual(expect.arrayContaining([
      expect.objectContaining({
        relativePath: 'roles/builder/refactor.md',
        description: 'New builder: refactor',
      }),
    ]))
  })
})
