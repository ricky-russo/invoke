import { cp, mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.join(__dirname, '..')

export async function initProject(projectDir: string): Promise<void> {
  await setupInvokeDir(projectDir)
  await installSkills(projectDir)
  await installClaudeMd(projectDir)
  await registerMcpServer(projectDir)
  await installHooks(projectDir)
}

// --- CLAUDE.md: enforce invoke skill usage ---

async function installClaudeMd(projectDir: string): Promise<void> {
  const destPath = path.join(projectDir, 'CLAUDE.md')
  const srcPath = path.join(PACKAGE_ROOT, 'defaults', 'CLAUDE.md')

  if (existsSync(destPath)) {
    // Append invoke section if not already present
    const existing = await readFile(destPath, 'utf-8')
    if (!existing.includes('# Invoke Pipeline')) {
      const invokeSection = await readFile(srcPath, 'utf-8')
      await writeFile(destPath, existing + '\n\n' + invokeSection)
    }
  } else {
    await cp(srcPath, destPath)
  }
}

// --- .invoke/ directory: config, roles, strategies, output dirs ---

async function setupInvokeDir(projectDir: string): Promise<void> {
  const invokeDir = path.join(projectDir, '.invoke')
  const defaultsDir = path.join(PACKAGE_ROOT, 'defaults')

  await mkdir(invokeDir, { recursive: true })

  // Copy pipeline.yaml if it doesn't exist
  const configDest = path.join(invokeDir, 'pipeline.yaml')
  if (!existsSync(configDest)) {
    await cp(path.join(defaultsDir, 'pipeline.yaml'), configDest)
  }

  // Copy default roles and strategies (skip existing)
  await copyDefaults(path.join(defaultsDir, 'roles'), path.join(invokeDir, 'roles'))
  await copyDefaults(path.join(defaultsDir, 'strategies'), path.join(invokeDir, 'strategies'))

  // Create empty output directories
  await mkdir(path.join(invokeDir, 'specs', 'research'), { recursive: true })
  await mkdir(path.join(invokeDir, 'plans'), { recursive: true })
  await mkdir(path.join(invokeDir, 'reviews'), { recursive: true })
}

// --- Skills: copy to .claude/skills/<name>/SKILL.md ---

async function installSkills(projectDir: string): Promise<void> {
  const skillsSrc = path.join(PACKAGE_ROOT, 'skills')
  if (!existsSync(skillsSrc)) return

  const entries = await readdir(skillsSrc)

  for (const filename of entries) {
    if (!filename.endsWith('.md')) continue

    const skillName = filename.replace('.md', '')
    const destDir = path.join(projectDir, '.claude', 'skills', skillName)
    const destFile = path.join(destDir, 'SKILL.md')

    // Skip if skill already installed
    if (existsSync(destFile)) continue

    await mkdir(destDir, { recursive: true })
    await cp(path.join(skillsSrc, filename), destFile)
  }
}

// --- MCP Server: register in .mcp.json ---

async function registerMcpServer(projectDir: string): Promise<void> {
  const mcpConfigPath = path.join(projectDir, '.mcp.json')

  let mcpConfig: Record<string, unknown> = {}
  if (existsSync(mcpConfigPath)) {
    const content = await readFile(mcpConfigPath, 'utf-8')
    mcpConfig = JSON.parse(content)
  }

  const servers = (mcpConfig.mcpServers ?? {}) as Record<string, unknown>

  // Skip if already registered
  if (servers.invoke) return

  servers.invoke = {
    command: 'invoke-mcp',
    args: [],
  }

  mcpConfig.mcpServers = servers
  await writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2) + '\n')
}

// --- Hooks: add to .claude/settings.json ---

async function installHooks(projectDir: string): Promise<void> {
  const settingsPath = path.join(projectDir, '.claude', 'settings.json')

  await mkdir(path.join(projectDir, '.claude'), { recursive: true })

  let settings: Record<string, unknown> = {}
  if (existsSync(settingsPath)) {
    const content = await readFile(settingsPath, 'utf-8')
    settings = JSON.parse(content)
  }

  const hooks = (settings.hooks ?? {}) as Record<string, unknown>

  // Resolve hook script paths relative to the invoke package
  const sessionStartScript = path.join(PACKAGE_ROOT, 'hooks', 'session-start.js')
  const postMergeScript = path.join(PACKAGE_ROOT, 'hooks', 'post-merge-validation.js')

  // Add SessionStart hook if not present
  if (!hooks.SessionStart) {
    hooks.SessionStart = [{
      matcher: '',
      hooks: [{
        type: 'command',
        command: `node ${sessionStartScript}`,
      }],
    }]
  }

  // Add PostToolUse hook if not present
  if (!hooks.PostToolUse) {
    hooks.PostToolUse = [{
      matcher: 'mcp__invoke__invoke_merge_worktree',
      hooks: [{
        type: 'command',
        command: `node ${postMergeScript}`,
      }],
    }]
  }

  settings.hooks = hooks
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n')
}

// --- Helpers ---

async function copyDefaults(srcDir: string, destDir: string): Promise<void> {
  if (!existsSync(srcDir)) return

  await mkdir(destDir, { recursive: true })

  const entries = await readdir(srcDir, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name)
    const destPath = path.join(destDir, entry.name)

    if (entry.isDirectory()) {
      await copyDefaults(srcPath, destPath)
    } else if (!existsSync(destPath)) {
      await cp(srcPath, destPath)
    }
  }
}
