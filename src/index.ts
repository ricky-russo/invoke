#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { loadConfig } from './config.js'
import { validateConfig } from './config-validator.js'
import { createProviderRegistry } from './providers/registry.js'
import { createParserRegistry } from './parsers/registry.js'
import { DispatchEngine } from './dispatch/engine.js'
import { BatchManager } from './dispatch/batch-manager.js'
import { WorktreeManager } from './worktree/manager.js'
import { MetricsManager } from './metrics/manager.js'
import { SessionManager } from './session/manager.js'
import { BugManager } from './bugs/manager.js'
import { StateManager } from './tools/state.js'
import { ArtifactManager } from './tools/artifacts.js'
import { registerConfigTools } from './tools/config-tool.js'
import { registerDispatchTools } from './tools/dispatch-tools.js'
import { registerWorktreeTools } from './tools/worktree-tools.js'
import { registerSessionTools } from './tools/session-tools.js'
import { registerComparisonTools } from './tools/comparison-tools.js'
import { registerStateTools } from './tools/state-tools.js'
import { registerArtifactTools } from './tools/artifact-tools.js'
import { registerConfigUpdateTools } from './tools/config-update-tools.js'
import { ContextManager } from './tools/context.js'
import { registerContextTools } from './tools/context-tools.js'
import { registerMetricsTools } from './tools/metrics-tools.js'
import { registerBugTools } from './tools/bug-tools.js'
import { checkForNewDefaults } from './defaults-checker.js'
import { writeFile } from 'fs/promises'
import path from 'path'

async function main() {
  const projectDir = process.cwd()

  const server = new McpServer({
    name: 'invoke-mcp',
    version: '0.1.0',
  })

  // Load config — tools will fail gracefully if config is missing
  let config
  try {
    config = await loadConfig(projectDir)
  } catch (err) {
    console.error(`Warning: Could not load .invoke/pipeline.yaml: ${err instanceof Error ? err.message : String(err)}`)
    console.error('Config-dependent tools will return errors until pipeline.yaml is configured.')
  }

  if (config) {
    const validation = await validateConfig(config, projectDir)
    if (validation.warnings.length > 0) {
      console.error('Pipeline config warnings:')
      for (const w of validation.warnings) {
        const prefix = w.level === 'error' ? 'ERROR' : 'WARNING'
        console.error(`  [${prefix}] ${w.path}: ${w.message}${w.suggestion ? ` ${w.suggestion}` : ''}`)
      }
    }
    try {
      await writeFile(
        path.join(projectDir, '.invoke', 'validation.json'),
        JSON.stringify(validation, null, 2)
      )
    } catch {
      // Non-critical
    }
  }

  // Check for new defaults after upgrade
  const newDefaults = await checkForNewDefaults(projectDir)
  if (newDefaults.length > 0) {
    console.error('New defaults available — run invoke-init to add them:')
    for (const d of newDefaults) {
      console.error(`  + ${d.relativePath} (${d.description})`)
    }
  }

  // Initialize managers
  const worktreeManager = new WorktreeManager(projectDir)
  const stateManager = new StateManager(projectDir)
  const artifactManager = new ArtifactManager(projectDir)
  const contextManager = new ContextManager(projectDir)
  const metricsManager = new MetricsManager(projectDir)
  const sessionManager = new SessionManager(projectDir)
  const bugManager = new BugManager(projectDir)

  // Run session migration and register tools
  const migration = await sessionManager.migrate()
  if (migration.migrated) {
    console.error(`Migrated legacy state to session: ${migration.sessionId}`)
  }

  registerSessionTools(server, sessionManager, projectDir)
  registerComparisonTools(server, projectDir, sessionManager)
  registerStateTools(server, stateManager, projectDir, sessionManager)
  registerArtifactTools(server, artifactManager)
  registerWorktreeTools(server, worktreeManager, config, projectDir)
  registerConfigTools(server, projectDir)
  registerConfigUpdateTools(server, projectDir)
  registerContextTools(server, contextManager)
  registerMetricsTools(server, metricsManager, projectDir, sessionManager)
  registerBugTools(server, bugManager)

  // Register dispatch tools (need config)
  if (config) {
    const providers = createProviderRegistry(config.providers)
    const parsers = createParserRegistry()
    const engine = new DispatchEngine({
      providers,
      parsers,
      projectDir,
      onDispatchComplete: (metric) => metricsManager.record(metric),
    })
    const batchManager = new BatchManager(engine, worktreeManager, stateManager)
    registerDispatchTools(server, engine, batchManager, projectDir, metricsManager, sessionManager)
  }

  // Connect via stdio
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('invoke-mcp server running on stdio')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
