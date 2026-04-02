#!/usr/bin/env node

import { initProject } from './init.js'

const projectDir = process.argv[2] || process.cwd()

console.log(`Initializing invoke in ${projectDir}...`)

initProject(projectDir)
  .then(() => {
    console.log('Done! invoke is configured in .invoke/')
    console.log('')
    console.log('Next steps:')
    console.log('  1. Review .invoke/pipeline.yaml and customize providers/models')
    console.log('  2. Add the invoke MCP server to your Claude Code settings')
    console.log('  3. Start a Claude Code session and describe what you want to build')
  })
  .catch((err) => {
    console.error('Error:', err.message)
    process.exit(1)
  })
