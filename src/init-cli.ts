#!/usr/bin/env node

import { initProject } from './init.js'

const projectDir = process.argv[2] || process.cwd()

console.log(`Initializing invoke in ${projectDir}...`)

initProject(projectDir)
  .then(() => {
    console.log('')
    console.log('invoke installed successfully!')
    console.log('')
    console.log('What was set up:')
    console.log('  .invoke/              Pipeline config, roles, strategies')
    console.log('  .claude/skills/       Invoke pipeline skills (auto-discovered)')
    console.log('  .mcp.json             MCP server registration')
    console.log('  .claude/settings.json Hooks (auto-resume, post-merge validation)')
    console.log('  CLAUDE.md             Enforces invoke skill usage')
    console.log('')
    console.log('Next steps:')
    console.log('  1. Review .invoke/pipeline.yaml and customize providers/models')
    console.log('  2. Start a Claude Code session and describe what you want to build')
  })
  .catch((err) => {
    console.error('Error:', err.message)
    process.exit(1)
  })
