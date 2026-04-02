#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { loadConfig } from './config.js'
import { createProviderRegistry } from './providers/registry.js'
import { createParserRegistry } from './parsers/registry.js'
import { DispatchEngine } from './dispatch/engine.js'
import { BatchManager } from './dispatch/batch-manager.js'
import { WorktreeManager } from './worktree/manager.js'
import { StateManager } from './tools/state.js'
import { ArtifactManager } from './tools/artifacts.js'
import { registerConfigTools } from './tools/config-tool.js'
import { registerDispatchTools } from './tools/dispatch-tools.js'
import { registerWorktreeTools } from './tools/worktree-tools.js'
import { registerStateTools } from './tools/state-tools.js'
import { registerArtifactTools } from './tools/artifact-tools.js'
import { registerConfigUpdateTools } from './tools/config-update-tools.js'

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

  // Initialize managers
  const worktreeManager = new WorktreeManager(projectDir)
  const stateManager = new StateManager(projectDir)
  const artifactManager = new ArtifactManager(projectDir)

  // Register config-independent tools first
  registerStateTools(server, stateManager)
  registerArtifactTools(server, artifactManager)
  registerWorktreeTools(server, worktreeManager)
  registerConfigTools(server, projectDir)
  registerConfigUpdateTools(server, projectDir)

  // Register dispatch tools (need config)
  if (config) {
    const providers = createProviderRegistry(config.providers)
    const parsers = createParserRegistry()
    const engine = new DispatchEngine({ config, providers, parsers, projectDir })
    const batchManager = new BatchManager(engine, worktreeManager)
    registerDispatchTools(server, engine, batchManager)
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
