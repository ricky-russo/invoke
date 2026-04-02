import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig } from '../../src/config.js'
import { createProviderRegistry } from '../../src/providers/registry.js'
import { createParserRegistry } from '../../src/parsers/registry.js'
import { DispatchEngine } from '../../src/dispatch/engine.js'
import { BatchManager } from '../../src/dispatch/batch-manager.js'
import { WorktreeManager } from '../../src/worktree/manager.js'
import { StateManager } from '../../src/tools/state.js'
import { ArtifactManager } from '../../src/tools/artifacts.js'
import { mkdir, writeFile, rm } from 'fs/promises'
import path from 'path'

const TEST_DIR = path.join(import.meta.dirname, 'fixtures', 'e2e-test')

beforeEach(async () => {
  await mkdir(path.join(TEST_DIR, '.invoke'), { recursive: true })

  const config = `
providers:
  claude:
    cli: claude
    args: ["--print", "--model", "{{model}}"]

roles:
  researcher:
    codebase:
      prompt: .invoke/roles/researcher/codebase.md
      provider: claude
      model: opus-4.6
      effort: high

strategies:
  tdd:
    prompt: .invoke/strategies/tdd.md

settings:
  default_strategy: tdd
  agent_timeout: 300000
  commit_style: per-batch
  work_branch_prefix: invoke/work
`
  await writeFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), config)
})

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('E2E: MCP Server Components', () => {
  it('loads config and initializes all managers', async () => {
    const config = await loadConfig(TEST_DIR)

    expect(config.providers.claude).toBeTruthy()
    expect(config.roles.researcher.codebase).toBeTruthy()

    const providers = createProviderRegistry(config.providers)
    expect(providers.get('claude')).toBeTruthy()

    const parsers = createParserRegistry()
    expect(parsers.get('claude')).toBeTruthy()

    const stateManager = new StateManager(TEST_DIR)
    const artifactManager = new ArtifactManager(TEST_DIR)
    const worktreeManager = new WorktreeManager(TEST_DIR)
    const engine = new DispatchEngine({ config, providers, parsers, projectDir: TEST_DIR })
    const batchManager = new BatchManager(engine, worktreeManager)

    // All components initialized without error
    expect(engine).toBeTruthy()
    expect(batchManager).toBeTruthy()
  })

  it('state manager round-trip works', async () => {
    const stateManager = new StateManager(TEST_DIR)

    expect(await stateManager.get()).toBeNull()

    await stateManager.initialize('test-pipeline')
    const state = await stateManager.get()
    expect(state!.pipeline_id).toBe('test-pipeline')
    expect(state!.current_stage).toBe('scope')

    await stateManager.update({ current_stage: 'build', strategy: 'tdd' })
    const updated = await stateManager.get()
    expect(updated!.current_stage).toBe('build')
    expect(updated!.strategy).toBe('tdd')
  })

  it('artifact manager round-trip works', async () => {
    const artifactManager = new ArtifactManager(TEST_DIR)

    await artifactManager.save('specs', 'test-spec.md', '# Test Spec')
    const content = await artifactManager.read('specs', 'test-spec.md')
    expect(content).toBe('# Test Spec')

    const files = await artifactManager.list('specs')
    expect(files).toContain('test-spec.md')
  })
})

describe('E2E: Init + Config', () => {
  it('init creates a valid config that loads successfully', async () => {
    const { initProject } = await import('../../src/init.js')

    const initDir = path.join(import.meta.dirname, 'fixtures', 'e2e-init-test')
    await mkdir(initDir, { recursive: true })

    try {
      await initProject(initDir)

      // Config should load and validate
      const config = await loadConfig(initDir)
      expect(config.providers.claude).toBeTruthy()
      expect(config.roles.researcher).toBeTruthy()
      expect(config.roles.planner).toBeTruthy()
      expect(config.roles.builder).toBeTruthy()
      expect(config.roles.reviewer).toBeTruthy()
      expect(config.strategies.tdd).toBeTruthy()
      expect(config.settings.default_strategy).toBe('tdd')
    } finally {
      await rm(initDir, { recursive: true, force: true })
    }
  })
})
