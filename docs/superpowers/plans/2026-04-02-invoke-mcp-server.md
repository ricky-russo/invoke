# Invoke MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the invoke-mcp server — a local stdio MCP server that dispatches AI agents to CLI tools, manages git worktrees, and tracks pipeline state.

**Architecture:** TypeScript MCP server using `@modelcontextprotocol/sdk` with stdio transport. Provider adapters spawn CLI processes (`claude`, `codex`, etc.). State and config are flat files in the project's `.invoke/` directory. Non-blocking batch dispatch with polling.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, `zod`, `yaml`, `vitest`

**Spec:** `docs/superpowers/specs/2026-04-02-invoke-design.md`

---

## File Structure

```
invoke2/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    index.ts                    # MCP server entry point
    types.ts                    # shared TypeScript interfaces
    config.ts                   # config loader + validation
    providers/
      base.ts                   # Provider interface
      claude.ts                 # Claude CLI adapter
      codex.ts                  # Codex CLI adapter
      registry.ts               # provider registry (name -> Provider)
    parsers/
      base.ts                   # Parser interface
      claude-parser.ts          # Claude output normalization
      codex-parser.ts           # Codex output normalization
      registry.ts               # parser registry (name -> Parser)
    tools/
      dispatch.ts               # invoke_dispatch, invoke_dispatch_batch, invoke_get_batch_status, invoke_cancel_batch
      worktree.ts               # invoke_create_worktree, invoke_merge_worktree, invoke_cleanup_worktrees
      state.ts                  # invoke_get_state, invoke_set_state
      artifacts.ts              # invoke_save_artifact, invoke_read_artifact
      config-tool.ts            # invoke_get_config
    dispatch/
      engine.ts                 # dispatch orchestration logic
      batch-manager.ts          # batch lifecycle (non-blocking dispatch + status tracking)
      prompt-composer.ts        # template variable injection
    worktree/
      manager.ts                # git worktree create/merge/cleanup
  tests/
    config.test.ts
    providers/
      claude.test.ts
      codex.test.ts
    parsers/
      claude-parser.test.ts
      codex-parser.test.ts
    dispatch/
      engine.test.ts
      batch-manager.test.ts
      prompt-composer.test.ts
    worktree/
      manager.test.ts
    tools/
      state.test.ts
      artifacts.test.ts
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/index.ts` (placeholder)

- [ ] **Step 1: Initialize the project**

```bash
cd /Users/rickyrusso/Documents/Github/invoke2
npm init -y
```

- [ ] **Step 2: Install dependencies**

```bash
npm install @modelcontextprotocol/sdk zod yaml
npm install -D typescript vitest @types/node tsx
```

- [ ] **Step 3: Configure package.json**

Update `package.json`:

```json
{
  "name": "invoke-mcp",
  "version": "0.1.0",
  "description": "AI-assisted development pipeline MCP server",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "invoke-mcp": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "engines": {
    "node": ">=18"
  }
}
```

- [ ] **Step 4: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 5: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    root: '.',
    include: ['tests/**/*.test.ts'],
  },
})
```

- [ ] **Step 6: Create placeholder entry point**

Create `src/index.ts`:

```typescript
#!/usr/bin/env node

console.error('invoke-mcp server starting...')
```

- [ ] **Step 7: Verify build works**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts src/index.ts package-lock.json
git commit -m "chore: scaffold invoke-mcp project"
```

---

### Task 2: Shared Types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write the type definitions**

Create `src/types.ts`:

```typescript
// -- Provider & Role Config --

export interface ProviderConfig {
  cli: string
  args: string[]
}

export interface RoleConfig {
  prompt: string
  provider: string
  model: string
  effort: 'low' | 'medium' | 'high'
}

export interface StrategyConfig {
  prompt: string
}

export interface Settings {
  default_strategy: string
  agent_timeout: number
  commit_style: 'one-commit' | 'per-batch' | 'per-task' | 'custom'
  work_branch_prefix: string
}

export interface InvokeConfig {
  providers: Record<string, ProviderConfig>
  roles: Record<string, Record<string, RoleConfig>>
  strategies: Record<string, StrategyConfig>
  settings: Settings
}

// -- Agent Dispatch & Results --

export interface DispatchRequest {
  role: string
  subrole: string
  taskContext: Record<string, string>
  workDir?: string
}

export interface AgentResult {
  role: string
  subrole: string
  provider: string
  model: string
  status: 'success' | 'error' | 'timeout'
  output: {
    summary: string
    findings?: Finding[]
    report?: string
    changes?: FileChange[]
    raw?: string
  }
  duration: number
}

export interface Finding {
  issue: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  file: string
  line?: number
  suggestion: string
}

export interface FileChange {
  file: string
  action: 'created' | 'modified' | 'deleted'
  summary: string
}

// -- Batch Dispatch --

export interface BatchRequest {
  tasks: BatchTask[]
  createWorktrees: boolean
}

export interface BatchTask {
  taskId: string
  role: string
  subrole: string
  taskContext: Record<string, string>
}

export interface BatchStatus {
  batchId: string
  status: 'running' | 'completed' | 'error' | 'cancelled'
  agents: AgentStatus[]
}

export interface AgentStatus {
  taskId: string
  status: 'pending' | 'dispatched' | 'running' | 'completed' | 'error' | 'timeout'
  result?: AgentResult
}

// -- Pipeline State --

export interface PipelineState {
  pipeline_id: string
  started: string
  current_stage: 'scope' | 'plan' | 'orchestrate' | 'build' | 'review' | 'complete'
  work_branch?: string
  spec?: string
  plan?: string
  strategy?: string
  batches: BatchState[]
  review_cycles: ReviewCycle[]
}

export interface BatchState {
  id: number
  status: 'pending' | 'in_progress' | 'completed' | 'error'
  tasks: TaskState[]
}

export interface TaskState {
  id: string
  status: 'pending' | 'dispatched' | 'running' | 'completed' | 'error' | 'timeout'
  worktree?: string | null
  result?: AgentResult
}

export interface ReviewCycle {
  id: number
  reviewers: string[]
  findings: Finding[]
  triaged?: {
    accepted: Finding[]
    dismissed: Finding[]
  }
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add shared type definitions"
```

---

### Task 3: Config Loader

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write the failing test for loading valid config**

Create `tests/config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig } from '../src/config.js'
import { mkdir, writeFile, rm } from 'fs/promises'
import path from 'path'

const TEST_DIR = path.join(import.meta.dirname, 'fixtures', 'config-test')

beforeEach(async () => {
  await mkdir(path.join(TEST_DIR, '.invoke'), { recursive: true })
})

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('loadConfig', () => {
  it('loads and parses a valid pipeline.yaml', async () => {
    const yaml = `
providers:
  claude:
    cli: claude
    args: ["--print", "--model", "{{model}}"]

roles:
  reviewer:
    security:
      prompt: .invoke/roles/reviewer/security.md
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
    await writeFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), yaml)

    const config = await loadConfig(TEST_DIR)

    expect(config.providers.claude.cli).toBe('claude')
    expect(config.providers.claude.args).toEqual(['--print', '--model', '{{model}}'])
    expect(config.roles.reviewer.security.provider).toBe('claude')
    expect(config.roles.reviewer.security.effort).toBe('high')
    expect(config.strategies.tdd.prompt).toBe('.invoke/strategies/tdd.md')
    expect(config.settings.default_strategy).toBe('tdd')
    expect(config.settings.agent_timeout).toBe(300000)
  })

  it('throws if pipeline.yaml is missing', async () => {
    await expect(loadConfig(TEST_DIR + '/nonexistent')).rejects.toThrow()
  })

  it('throws if config is missing required fields', async () => {
    await writeFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), 'providers: {}')
    await expect(loadConfig(TEST_DIR)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — `loadConfig` not found

- [ ] **Step 3: Implement the config loader**

Create `src/config.ts`:

```typescript
import { readFile } from 'fs/promises'
import path from 'path'
import { parse } from 'yaml'
import { z } from 'zod'
import type { InvokeConfig } from './types.js'

const ProviderConfigSchema = z.object({
  cli: z.string(),
  args: z.array(z.string()),
})

const RoleConfigSchema = z.object({
  prompt: z.string(),
  provider: z.string(),
  model: z.string(),
  effort: z.enum(['low', 'medium', 'high']),
})

const StrategyConfigSchema = z.object({
  prompt: z.string(),
})

const SettingsSchema = z.object({
  default_strategy: z.string(),
  agent_timeout: z.number().positive(),
  commit_style: z.enum(['one-commit', 'per-batch', 'per-task', 'custom']),
  work_branch_prefix: z.string(),
})

const InvokeConfigSchema = z.object({
  providers: z.record(z.string(), ProviderConfigSchema),
  roles: z.record(z.string(), z.record(z.string(), RoleConfigSchema)),
  strategies: z.record(z.string(), StrategyConfigSchema),
  settings: SettingsSchema,
})

export async function loadConfig(projectDir: string): Promise<InvokeConfig> {
  const configPath = path.join(projectDir, '.invoke', 'pipeline.yaml')
  const content = await readFile(configPath, 'utf-8')
  const raw = parse(content)
  return InvokeConfigSchema.parse(raw)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/config.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add config loader with YAML parsing and validation"
```

---

### Task 4: Provider System

**Files:**
- Create: `src/providers/base.ts`
- Create: `src/providers/claude.ts`
- Create: `src/providers/codex.ts`
- Create: `src/providers/registry.ts`
- Create: `tests/providers/claude.test.ts`
- Create: `tests/providers/codex.test.ts`

- [ ] **Step 1: Write the Provider interface**

Create `src/providers/base.ts`:

```typescript
export interface CommandSpec {
  cmd: string
  args: string[]
  env?: Record<string, string>
}

export interface Provider {
  name: string
  buildCommand(params: {
    model: string
    effort: string
    workDir: string
    prompt: string
  }): CommandSpec
}
```

- [ ] **Step 2: Write failing tests for ClaudeProvider**

Create `tests/providers/claude.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { ClaudeProvider } from '../../src/providers/claude.js'

describe('ClaudeProvider', () => {
  const provider = new ClaudeProvider({
    cli: 'claude',
    args: ['--print', '--model', '{{model}}'],
  })

  it('has the correct name', () => {
    expect(provider.name).toBe('claude')
  })

  it('builds a command with model substituted', () => {
    const cmd = provider.buildCommand({
      model: 'opus-4.6',
      effort: 'high',
      workDir: '/tmp/worktree-1',
      prompt: 'Build the auth module',
    })

    expect(cmd.cmd).toBe('claude')
    expect(cmd.args).toContain('--print')
    expect(cmd.args).toContain('--model')
    expect(cmd.args).toContain('opus-4.6')
    expect(cmd.args).toContain('--directory')
    expect(cmd.args).toContain('/tmp/worktree-1')
    expect(cmd.args[cmd.args.length - 1]).toBe('Build the auth module')
  })

  it('substitutes all template variables', () => {
    const customProvider = new ClaudeProvider({
      cli: 'claude',
      args: ['--print', '--model', '{{model}}', '--effort', '{{effort}}'],
    })

    const cmd = customProvider.buildCommand({
      model: 'sonnet-4.6',
      effort: 'medium',
      workDir: '/tmp/wt',
      prompt: 'test prompt',
    })

    expect(cmd.args).toContain('sonnet-4.6')
    expect(cmd.args).toContain('medium')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/providers/claude.test.ts`
Expected: FAIL — `ClaudeProvider` not found

- [ ] **Step 4: Implement ClaudeProvider**

Create `src/providers/claude.ts`:

```typescript
import type { Provider, CommandSpec } from './base.js'
import type { ProviderConfig } from '../types.js'

export class ClaudeProvider implements Provider {
  name = 'claude'

  constructor(private config: ProviderConfig) {}

  buildCommand(params: {
    model: string
    effort: string
    workDir: string
    prompt: string
  }): CommandSpec {
    const args = this.config.args.map(arg =>
      arg
        .replace('{{model}}', params.model)
        .replace('{{effort}}', params.effort)
    )

    args.push('--directory', params.workDir)
    args.push(params.prompt)

    return { cmd: this.config.cli, args }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/providers/claude.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 6: Write failing tests for CodexProvider**

Create `tests/providers/codex.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { CodexProvider } from '../../src/providers/codex.js'

describe('CodexProvider', () => {
  const provider = new CodexProvider({
    cli: 'codex',
    args: ['--model', '{{model}}', '--reasoning-effort', '{{effort}}'],
  })

  it('has the correct name', () => {
    expect(provider.name).toBe('codex')
  })

  it('builds a command with model and effort substituted', () => {
    const cmd = provider.buildCommand({
      model: 'gpt-5.4',
      effort: 'high',
      workDir: '/tmp/worktree-2',
      prompt: 'Review for security issues',
    })

    expect(cmd.cmd).toBe('codex')
    expect(cmd.args).toContain('--model')
    expect(cmd.args).toContain('gpt-5.4')
    expect(cmd.args).toContain('--reasoning-effort')
    expect(cmd.args).toContain('high')
    expect(cmd.args).toContain('-C')
    expect(cmd.args).toContain('/tmp/worktree-2')
    expect(cmd.args[cmd.args.length - 1]).toBe('Review for security issues')
  })
})
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run tests/providers/codex.test.ts`
Expected: FAIL — `CodexProvider` not found

- [ ] **Step 8: Implement CodexProvider**

Create `src/providers/codex.ts`:

```typescript
import type { Provider, CommandSpec } from './base.js'
import type { ProviderConfig } from '../types.js'

export class CodexProvider implements Provider {
  name = 'codex'

  constructor(private config: ProviderConfig) {}

  buildCommand(params: {
    model: string
    effort: string
    workDir: string
    prompt: string
  }): CommandSpec {
    const args = this.config.args.map(arg =>
      arg
        .replace('{{model}}', params.model)
        .replace('{{effort}}', params.effort)
    )

    args.push('-C', params.workDir)
    args.push(params.prompt)

    return { cmd: this.config.cli, args }
  }
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run tests/providers/codex.test.ts`
Expected: All 2 tests PASS

- [ ] **Step 10: Create provider registry**

Create `src/providers/registry.ts`:

```typescript
import type { Provider } from './base.js'
import type { ProviderConfig } from '../types.js'
import { ClaudeProvider } from './claude.js'
import { CodexProvider } from './codex.js'

const PROVIDER_CONSTRUCTORS: Record<string, new (config: ProviderConfig) => Provider> = {
  claude: ClaudeProvider,
  codex: CodexProvider,
}

export function createProviderRegistry(
  configs: Record<string, ProviderConfig>
): Map<string, Provider> {
  const registry = new Map<string, Provider>()

  for (const [name, config] of Object.entries(configs)) {
    const Constructor = PROVIDER_CONSTRUCTORS[name]
    if (!Constructor) {
      throw new Error(`Unknown provider: ${name}. Available: ${Object.keys(PROVIDER_CONSTRUCTORS).join(', ')}`)
    }
    registry.set(name, new Constructor(config))
  }

  return registry
}
```

- [ ] **Step 11: Verify all provider tests pass**

Run: `npx vitest run tests/providers/`
Expected: All tests PASS

- [ ] **Step 12: Commit**

```bash
git add src/providers/ tests/providers/
git commit -m "feat: add provider system with Claude and Codex adapters"
```

---

### Task 5: Output Parsers

**Files:**
- Create: `src/parsers/base.ts`
- Create: `src/parsers/claude-parser.ts`
- Create: `src/parsers/codex-parser.ts`
- Create: `src/parsers/registry.ts`
- Create: `tests/parsers/claude-parser.test.ts`
- Create: `tests/parsers/codex-parser.test.ts`

- [ ] **Step 1: Write the Parser interface**

Create `src/parsers/base.ts`:

```typescript
import type { AgentResult } from '../types.js'

export interface ParseContext {
  role: string
  subrole: string
  provider: string
  model: string
  duration: number
}

export interface Parser {
  name: string
  parse(rawOutput: string, exitCode: number, context: ParseContext): AgentResult
}
```

- [ ] **Step 2: Write failing tests for ClaudeParser**

Create `tests/parsers/claude-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { ClaudeParser } from '../../src/parsers/claude-parser.js'

describe('ClaudeParser', () => {
  const parser = new ClaudeParser()

  it('parses successful output into AgentResult', () => {
    const output = 'Here is my analysis of the codebase.\n\nThe auth module uses JWT tokens stored in HttpOnly cookies.'

    const result = parser.parse(output, 0, {
      role: 'researcher',
      subrole: 'codebase',
      provider: 'claude',
      model: 'opus-4.6',
      duration: 12000,
    })

    expect(result.status).toBe('success')
    expect(result.role).toBe('researcher')
    expect(result.subrole).toBe('codebase')
    expect(result.output.summary).toBeTruthy()
    expect(result.output.raw).toBe(output)
    expect(result.duration).toBe(12000)
  })

  it('parses non-zero exit code as error', () => {
    const result = parser.parse('Something went wrong', 1, {
      role: 'builder',
      subrole: 'default',
      provider: 'claude',
      model: 'opus-4.6',
      duration: 5000,
    })

    expect(result.status).toBe('error')
    expect(result.output.raw).toBe('Something went wrong')
  })

  it('extracts findings from reviewer output', () => {
    const output = `## Security Review

### Finding 1
**Severity:** high
**File:** src/auth/token.ts
**Line:** 42
**Issue:** SQL injection vulnerability in query parameter
**Suggestion:** Use parameterized queries instead of string concatenation

### Finding 2
**Severity:** medium
**File:** src/auth/session.ts
**Line:** 15
**Issue:** Session token stored in localStorage
**Suggestion:** Use HttpOnly cookies for session storage`

    const result = parser.parse(output, 0, {
      role: 'reviewer',
      subrole: 'security',
      provider: 'claude',
      model: 'opus-4.6',
      duration: 30000,
    })

    expect(result.status).toBe('success')
    expect(result.output.findings).toHaveLength(2)
    expect(result.output.findings![0].severity).toBe('high')
    expect(result.output.findings![0].file).toBe('src/auth/token.ts')
    expect(result.output.findings![0].line).toBe(42)
    expect(result.output.findings![1].severity).toBe('medium')
  })

  it('returns raw output when findings cannot be parsed', () => {
    const output = 'Everything looks good, no issues found.'

    const result = parser.parse(output, 0, {
      role: 'reviewer',
      subrole: 'security',
      provider: 'claude',
      model: 'opus-4.6',
      duration: 10000,
    })

    expect(result.status).toBe('success')
    expect(result.output.findings).toEqual([])
    expect(result.output.raw).toBe(output)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/parsers/claude-parser.test.ts`
Expected: FAIL — `ClaudeParser` not found

- [ ] **Step 4: Implement ClaudeParser**

Create `src/parsers/claude-parser.ts`:

```typescript
import type { Parser, ParseContext } from './base.js'
import type { AgentResult, Finding } from '../types.js'

export class ClaudeParser implements Parser {
  name = 'claude'

  parse(rawOutput: string, exitCode: number, context: ParseContext): AgentResult {
    const base = {
      role: context.role,
      subrole: context.subrole,
      provider: context.provider,
      model: context.model,
      duration: context.duration,
    }

    if (exitCode !== 0) {
      return {
        ...base,
        status: 'error',
        output: {
          summary: `Agent exited with code ${exitCode}`,
          raw: rawOutput,
        },
      }
    }

    const findings = context.role === 'reviewer'
      ? this.extractFindings(rawOutput)
      : undefined

    const summary = rawOutput.split('\n').filter(l => l.trim()).slice(0, 3).join(' ').slice(0, 200)

    return {
      ...base,
      status: 'success',
      output: {
        summary,
        findings: context.role === 'reviewer' ? (findings ?? []) : undefined,
        report: context.role === 'researcher' ? rawOutput : undefined,
        raw: rawOutput,
      },
    }
  }

  private extractFindings(output: string): Finding[] {
    const findings: Finding[] = []
    const findingBlocks = output.split(/###\s+Finding\s+\d+/i).slice(1)

    for (const block of findingBlocks) {
      const severity = this.extractField(block, 'Severity')
      const file = this.extractField(block, 'File')
      const lineStr = this.extractField(block, 'Line')
      const issue = this.extractField(block, 'Issue')
      const suggestion = this.extractField(block, 'Suggestion')

      if (severity && file && issue && suggestion) {
        findings.push({
          severity: this.normalizeSeverity(severity),
          file,
          line: lineStr ? parseInt(lineStr, 10) : undefined,
          issue,
          suggestion,
        })
      }
    }

    return findings
  }

  private extractField(block: string, field: string): string | null {
    const match = block.match(new RegExp(`\\*\\*${field}:\\*\\*\\s*(.+)`, 'i'))
    return match ? match[1].trim() : null
  }

  private normalizeSeverity(s: string): Finding['severity'] {
    const lower = s.toLowerCase()
    if (lower === 'critical') return 'critical'
    if (lower === 'high') return 'high'
    if (lower === 'medium') return 'medium'
    return 'low'
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/parsers/claude-parser.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 6: Write failing tests for CodexParser**

Create `tests/parsers/codex-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { CodexParser } from '../../src/parsers/codex-parser.js'

describe('CodexParser', () => {
  const parser = new CodexParser()

  it('parses successful output into AgentResult', () => {
    const output = 'Analysis complete. The codebase follows RESTful patterns.'

    const result = parser.parse(output, 0, {
      role: 'researcher',
      subrole: 'codebase',
      provider: 'codex',
      model: 'gpt-5.4',
      duration: 15000,
    })

    expect(result.status).toBe('success')
    expect(result.provider).toBe('codex')
    expect(result.output.raw).toBe(output)
  })

  it('parses non-zero exit code as error', () => {
    const result = parser.parse('Error occurred', 1, {
      role: 'builder',
      subrole: 'default',
      provider: 'codex',
      model: 'gpt-5.4',
      duration: 2000,
    })

    expect(result.status).toBe('error')
  })

  it('extracts findings from reviewer output', () => {
    const output = `## Security Review

### Finding 1
**Severity:** critical
**File:** src/db/query.ts
**Line:** 88
**Issue:** Unsanitized user input in SQL query
**Suggestion:** Use prepared statements

### Finding 2
**Severity:** low
**File:** src/utils/log.ts
**Issue:** Sensitive data in log output
**Suggestion:** Redact PII before logging`

    const result = parser.parse(output, 0, {
      role: 'reviewer',
      subrole: 'security',
      provider: 'codex',
      model: 'gpt-5.4',
      duration: 25000,
    })

    expect(result.status).toBe('success')
    expect(result.output.findings).toHaveLength(2)
    expect(result.output.findings![0].severity).toBe('critical')
    expect(result.output.findings![1].line).toBeUndefined()
  })
})
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run tests/parsers/codex-parser.test.ts`
Expected: FAIL — `CodexParser` not found

- [ ] **Step 8: Implement CodexParser**

Create `src/parsers/codex-parser.ts`:

The Codex parser uses the same finding format since we'll instruct agents via prompt templates to use a consistent output format. The parser structure mirrors Claude's.

```typescript
import type { Parser, ParseContext } from './base.js'
import type { AgentResult, Finding } from '../types.js'

export class CodexParser implements Parser {
  name = 'codex'

  parse(rawOutput: string, exitCode: number, context: ParseContext): AgentResult {
    const base = {
      role: context.role,
      subrole: context.subrole,
      provider: context.provider,
      model: context.model,
      duration: context.duration,
    }

    if (exitCode !== 0) {
      return {
        ...base,
        status: 'error',
        output: {
          summary: `Agent exited with code ${exitCode}`,
          raw: rawOutput,
        },
      }
    }

    const findings = context.role === 'reviewer'
      ? this.extractFindings(rawOutput)
      : undefined

    const summary = rawOutput.split('\n').filter(l => l.trim()).slice(0, 3).join(' ').slice(0, 200)

    return {
      ...base,
      status: 'success',
      output: {
        summary,
        findings: context.role === 'reviewer' ? (findings ?? []) : undefined,
        report: context.role === 'researcher' ? rawOutput : undefined,
        raw: rawOutput,
      },
    }
  }

  private extractFindings(output: string): Finding[] {
    const findings: Finding[] = []
    const findingBlocks = output.split(/###\s+Finding\s+\d+/i).slice(1)

    for (const block of findingBlocks) {
      const severity = this.extractField(block, 'Severity')
      const file = this.extractField(block, 'File')
      const lineStr = this.extractField(block, 'Line')
      const issue = this.extractField(block, 'Issue')
      const suggestion = this.extractField(block, 'Suggestion')

      if (severity && file && issue && suggestion) {
        findings.push({
          severity: this.normalizeSeverity(severity),
          file,
          line: lineStr ? parseInt(lineStr, 10) : undefined,
          issue,
          suggestion,
        })
      }
    }

    return findings
  }

  private extractField(block: string, field: string): string | null {
    const match = block.match(new RegExp(`\\*\\*${field}:\\*\\*\\s*(.+)`, 'i'))
    return match ? match[1].trim() : null
  }

  private normalizeSeverity(s: string): Finding['severity'] {
    const lower = s.toLowerCase()
    if (lower === 'critical') return 'critical'
    if (lower === 'high') return 'high'
    if (lower === 'medium') return 'medium'
    return 'low'
  }
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run tests/parsers/codex-parser.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 10: Create parser registry**

Create `src/parsers/registry.ts`:

```typescript
import type { Parser } from './base.js'
import { ClaudeParser } from './claude-parser.js'
import { CodexParser } from './codex-parser.js'

const PARSERS: Record<string, new () => Parser> = {
  claude: ClaudeParser,
  codex: CodexParser,
}

export function createParserRegistry(): Map<string, Parser> {
  const registry = new Map<string, Parser>()
  for (const [name, Constructor] of Object.entries(PARSERS)) {
    registry.set(name, new Constructor())
  }
  return registry
}
```

- [ ] **Step 11: Run all parser tests**

Run: `npx vitest run tests/parsers/`
Expected: All tests PASS

- [ ] **Step 12: Commit**

```bash
git add src/parsers/ tests/parsers/
git commit -m "feat: add output parsers with finding extraction for Claude and Codex"
```

---

### Task 6: Prompt Composer

**Files:**
- Create: `src/dispatch/prompt-composer.ts`
- Create: `tests/dispatch/prompt-composer.test.ts`

- [ ] **Step 1: Write failing tests for prompt composition**

Create `tests/dispatch/prompt-composer.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { composePrompt } from '../../src/dispatch/prompt-composer.js'
import { mkdir, writeFile, rm } from 'fs/promises'
import path from 'path'

const TEST_DIR = path.join(import.meta.dirname, 'fixtures', 'prompt-test')

beforeEach(async () => {
  await mkdir(path.join(TEST_DIR, '.invoke', 'roles', 'reviewer'), { recursive: true })
  await mkdir(path.join(TEST_DIR, '.invoke', 'strategies'), { recursive: true })
})

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('composePrompt', () => {
  it('loads a role prompt and injects task context variables', async () => {
    const template = `# Security Review

## Task
{{task_description}}

## Files to Review
{{relevant_files}}

Review for OWASP top 10 vulnerabilities.`

    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'reviewer', 'security.md'),
      template
    )

    const result = await composePrompt({
      projectDir: TEST_DIR,
      promptPath: '.invoke/roles/reviewer/security.md',
      taskContext: {
        task_description: 'Review the auth module for security issues',
        relevant_files: 'src/auth/token.ts, src/auth/session.ts',
      },
    })

    expect(result).toContain('Review the auth module for security issues')
    expect(result).toContain('src/auth/token.ts, src/auth/session.ts')
    expect(result).toContain('Review for OWASP top 10 vulnerabilities.')
    expect(result).not.toContain('{{task_description}}')
    expect(result).not.toContain('{{relevant_files}}')
  })

  it('composes role prompt with strategy prompt when provided', async () => {
    const roleTemplate = `# Builder

## Task
{{task_description}}
`
    const strategyTemplate = `# TDD Strategy

## Instructions
1. Write a failing test first
2. Implement the minimum code
3. Refactor
`
    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'reviewer', 'security.md'),
      roleTemplate
    )
    await writeFile(
      path.join(TEST_DIR, '.invoke', 'strategies', 'tdd.md'),
      strategyTemplate
    )

    const result = await composePrompt({
      projectDir: TEST_DIR,
      promptPath: '.invoke/roles/reviewer/security.md',
      strategyPath: '.invoke/strategies/tdd.md',
      taskContext: {
        task_description: 'Build the token validator',
      },
    })

    expect(result).toContain('Build the token validator')
    expect(result).toContain('Write a failing test first')
  })

  it('leaves unmatched variables as-is', async () => {
    await writeFile(
      path.join(TEST_DIR, '.invoke', 'roles', 'reviewer', 'security.md'),
      'Review {{task_description}} and check {{unknown_var}}'
    )

    const result = await composePrompt({
      projectDir: TEST_DIR,
      promptPath: '.invoke/roles/reviewer/security.md',
      taskContext: {
        task_description: 'the auth module',
      },
    })

    expect(result).toContain('the auth module')
    expect(result).toContain('{{unknown_var}}')
  })

  it('throws when prompt file is missing', async () => {
    await expect(
      composePrompt({
        projectDir: TEST_DIR,
        promptPath: '.invoke/roles/nonexistent.md',
        taskContext: {},
      })
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dispatch/prompt-composer.test.ts`
Expected: FAIL — `composePrompt` not found

- [ ] **Step 3: Implement the prompt composer**

Create `src/dispatch/prompt-composer.ts`:

```typescript
import { readFile } from 'fs/promises'
import path from 'path'

interface ComposeOptions {
  projectDir: string
  promptPath: string
  strategyPath?: string
  taskContext: Record<string, string>
}

export async function composePrompt(options: ComposeOptions): Promise<string> {
  const { projectDir, promptPath, strategyPath, taskContext } = options

  const rolePrompt = await readFile(
    path.join(projectDir, promptPath),
    'utf-8'
  )

  let composed = rolePrompt

  if (strategyPath) {
    const strategyPrompt = await readFile(
      path.join(projectDir, strategyPath),
      'utf-8'
    )
    composed = composed + '\n\n---\n\n' + strategyPrompt
  }

  for (const [key, value] of Object.entries(taskContext)) {
    composed = composed.replaceAll(`{{${key}}}`, value)
  }

  return composed
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/dispatch/prompt-composer.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/dispatch/prompt-composer.ts tests/dispatch/prompt-composer.test.ts
git commit -m "feat: add prompt composer with template variable injection"
```

---

### Task 7: Worktree Manager

**Files:**
- Create: `src/worktree/manager.ts`
- Create: `tests/worktree/manager.test.ts`

- [ ] **Step 1: Write failing tests for worktree manager**

Create `tests/worktree/manager.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WorktreeManager } from '../../src/worktree/manager.js'
import { execSync } from 'child_process'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import os from 'os'

let repoDir: string
let manager: WorktreeManager

beforeEach(async () => {
  repoDir = await mkdtemp(path.join(os.tmpdir(), 'invoke-wt-test-'))
  execSync('git init', { cwd: repoDir })
  execSync('git config user.email "test@test.com"', { cwd: repoDir })
  execSync('git config user.name "Test"', { cwd: repoDir })
  await writeFile(path.join(repoDir, 'README.md'), '# Test')
  execSync('git add . && git commit -m "initial"', { cwd: repoDir })
  manager = new WorktreeManager(repoDir)
})

afterEach(async () => {
  await manager.cleanupAll()
  await rm(repoDir, { recursive: true, force: true })
})

describe('WorktreeManager', () => {
  it('creates a worktree and returns its path', async () => {
    const result = await manager.create('task-1')

    expect(result.worktreePath).toBeTruthy()
    expect(result.branch).toContain('task-1')
    expect(existsSync(result.worktreePath)).toBe(true)
    expect(existsSync(path.join(result.worktreePath, 'README.md'))).toBe(true)
  })

  it('creates multiple worktrees', async () => {
    const wt1 = await manager.create('task-1')
    const wt2 = await manager.create('task-2')

    expect(wt1.worktreePath).not.toBe(wt2.worktreePath)
    expect(existsSync(wt1.worktreePath)).toBe(true)
    expect(existsSync(wt2.worktreePath)).toBe(true)
  })

  it('merges a worktree back into the work branch', async () => {
    execSync('git checkout -b work-branch', { cwd: repoDir })

    const wt = await manager.create('task-1')
    await writeFile(path.join(wt.worktreePath, 'new-file.ts'), 'export const x = 1')
    execSync('git add . && git commit -m "add new file"', { cwd: wt.worktreePath })

    await manager.merge('task-1')

    expect(existsSync(path.join(repoDir, 'new-file.ts'))).toBe(true)
  })

  it('removes a worktree on cleanup', async () => {
    const wt = await manager.create('task-1')
    expect(existsSync(wt.worktreePath)).toBe(true)

    await manager.cleanup('task-1')
    expect(existsSync(wt.worktreePath)).toBe(false)
  })

  it('lists active worktrees', async () => {
    await manager.create('task-1')
    await manager.create('task-2')

    const active = manager.listActive()
    expect(active).toHaveLength(2)
    expect(active.map(a => a.taskId)).toContain('task-1')
    expect(active.map(a => a.taskId)).toContain('task-2')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/worktree/manager.test.ts`
Expected: FAIL — `WorktreeManager` not found

- [ ] **Step 3: Implement the worktree manager**

Create `src/worktree/manager.ts`:

```typescript
import { execSync } from 'child_process'
import { rm } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import os from 'os'

interface WorktreeInfo {
  taskId: string
  worktreePath: string
  branch: string
}

export class WorktreeManager {
  private worktrees = new Map<string, WorktreeInfo>()

  constructor(private repoDir: string) {}

  async create(taskId: string): Promise<WorktreeInfo> {
    const branch = `invoke-wt-${taskId}`
    const worktreePath = path.join(os.tmpdir(), `invoke-worktree-${taskId}-${Date.now()}`)

    execSync(
      `git worktree add "${worktreePath}" -b "${branch}"`,
      { cwd: this.repoDir, stdio: 'pipe' }
    )

    const info: WorktreeInfo = { taskId, worktreePath, branch }
    this.worktrees.set(taskId, info)
    return info
  }

  async merge(taskId: string): Promise<void> {
    const info = this.worktrees.get(taskId)
    if (!info) {
      throw new Error(`No worktree found for task: ${taskId}`)
    }

    execSync(
      `git merge "${info.branch}" --no-edit`,
      { cwd: this.repoDir, stdio: 'pipe' }
    )
  }

  async cleanup(taskId: string): Promise<void> {
    const info = this.worktrees.get(taskId)
    if (!info) return

    if (existsSync(info.worktreePath)) {
      execSync(
        `git worktree remove "${info.worktreePath}" --force`,
        { cwd: this.repoDir, stdio: 'pipe' }
      )
    }

    try {
      execSync(
        `git branch -D "${info.branch}"`,
        { cwd: this.repoDir, stdio: 'pipe' }
      )
    } catch {
      // Branch may already be deleted
    }

    this.worktrees.delete(taskId)
  }

  async cleanupAll(): Promise<void> {
    for (const taskId of [...this.worktrees.keys()]) {
      await this.cleanup(taskId)
    }
  }

  listActive(): WorktreeInfo[] {
    return [...this.worktrees.values()]
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/worktree/manager.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/worktree/ tests/worktree/
git commit -m "feat: add worktree manager for parallel agent isolation"
```

---

### Task 8: State Manager

**Files:**
- Create: `src/tools/state.ts`
- Create: `tests/tools/state.test.ts`

- [ ] **Step 1: Write failing tests for state manager**

Create `tests/tools/state.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { StateManager } from '../../src/tools/state.js'
import { mkdir, rm, readFile } from 'fs/promises'
import path from 'path'

const TEST_DIR = path.join(import.meta.dirname, 'fixtures', 'state-test')

let stateManager: StateManager

beforeEach(async () => {
  await mkdir(path.join(TEST_DIR, '.invoke'), { recursive: true })
  stateManager = new StateManager(TEST_DIR)
})

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('StateManager', () => {
  it('returns null when no state file exists', async () => {
    const state = await stateManager.get()
    expect(state).toBeNull()
  })

  it('creates initial state', async () => {
    await stateManager.initialize('pipeline-123')

    const state = await stateManager.get()
    expect(state).not.toBeNull()
    expect(state!.pipeline_id).toBe('pipeline-123')
    expect(state!.current_stage).toBe('scope')
    expect(state!.batches).toEqual([])
    expect(state!.review_cycles).toEqual([])
  })

  it('updates specific fields', async () => {
    await stateManager.initialize('pipeline-123')
    await stateManager.update({
      current_stage: 'build',
      work_branch: 'invoke/work-1234',
      strategy: 'tdd',
    })

    const state = await stateManager.get()
    expect(state!.current_stage).toBe('build')
    expect(state!.work_branch).toBe('invoke/work-1234')
    expect(state!.strategy).toBe('tdd')
    expect(state!.pipeline_id).toBe('pipeline-123')
  })

  it('writes state as formatted JSON', async () => {
    await stateManager.initialize('pipeline-123')

    const raw = await readFile(
      path.join(TEST_DIR, '.invoke', 'state.json'),
      'utf-8'
    )
    const parsed = JSON.parse(raw)
    expect(parsed.pipeline_id).toBe('pipeline-123')
    expect(raw).toContain('\n') // formatted, not minified
  })

  it('resets state', async () => {
    await stateManager.initialize('pipeline-123')
    await stateManager.update({ current_stage: 'build' })
    await stateManager.reset()

    const state = await stateManager.get()
    expect(state).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/state.test.ts`
Expected: FAIL — `StateManager` not found

- [ ] **Step 3: Implement the state manager**

Create `src/tools/state.ts`:

```typescript
import { readFile, writeFile, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import type { PipelineState } from '../types.js'

export class StateManager {
  private statePath: string

  constructor(private projectDir: string) {
    this.statePath = path.join(projectDir, '.invoke', 'state.json')
  }

  async get(): Promise<PipelineState | null> {
    if (!existsSync(this.statePath)) {
      return null
    }
    const content = await readFile(this.statePath, 'utf-8')
    return JSON.parse(content) as PipelineState
  }

  async initialize(pipelineId: string): Promise<PipelineState> {
    const state: PipelineState = {
      pipeline_id: pipelineId,
      started: new Date().toISOString(),
      current_stage: 'scope',
      batches: [],
      review_cycles: [],
    }
    await this.write(state)
    return state
  }

  async update(updates: Partial<PipelineState>): Promise<PipelineState> {
    const current = await this.get()
    if (!current) {
      throw new Error('No active pipeline. Call initialize() first.')
    }
    const updated = { ...current, ...updates }
    await this.write(updated)
    return updated
  }

  async reset(): Promise<void> {
    if (existsSync(this.statePath)) {
      await unlink(this.statePath)
    }
  }

  private async write(state: PipelineState): Promise<void> {
    await writeFile(this.statePath, JSON.stringify(state, null, 2) + '\n')
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tools/state.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/state.ts tests/tools/state.test.ts
git commit -m "feat: add pipeline state manager with flat file persistence"
```

---

### Task 9: Artifact Manager

**Files:**
- Create: `src/tools/artifacts.ts`
- Create: `tests/tools/artifacts.test.ts`

- [ ] **Step 1: Write failing tests for artifact manager**

Create `tests/tools/artifacts.test.ts`:

```typescript
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
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/artifacts.test.ts`
Expected: FAIL — `ArtifactManager` not found

- [ ] **Step 3: Implement the artifact manager**

Create `src/tools/artifacts.ts`:

```typescript
import { readFile, writeFile, mkdir, readdir } from 'fs/promises'
import path from 'path'

export class ArtifactManager {
  private baseDir: string

  constructor(projectDir: string) {
    this.baseDir = path.join(projectDir, '.invoke')
  }

  async save(stage: string, filename: string, content: string): Promise<string> {
    const dir = path.join(this.baseDir, stage)
    await mkdir(dir, { recursive: true })
    const filePath = path.join(dir, filename)
    await writeFile(filePath, content)
    return filePath
  }

  async read(stage: string, filename: string): Promise<string> {
    const filePath = path.join(this.baseDir, stage, filename)
    return readFile(filePath, 'utf-8')
  }

  async list(stage: string): Promise<string[]> {
    const dir = path.join(this.baseDir, stage)
    try {
      return await readdir(dir)
    } catch {
      return []
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tools/artifacts.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/artifacts.ts tests/tools/artifacts.test.ts
git commit -m "feat: add artifact manager for pipeline stage outputs"
```

---

### Task 10: Dispatch Engine

**Files:**
- Create: `src/dispatch/engine.ts`
- Create: `tests/dispatch/engine.test.ts`

- [ ] **Step 1: Write failing tests for single dispatch**

Create `tests/dispatch/engine.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DispatchEngine } from '../../src/dispatch/engine.js'
import type { InvokeConfig } from '../../src/types.js'
import type { Provider } from '../../src/providers/base.js'
import type { Parser } from '../../src/parsers/base.js'

// Mock child_process.spawn
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

import { spawn } from 'child_process'
import { EventEmitter, Readable } from 'stream'

function mockSpawn(stdout: string, exitCode: number): void {
  const proc = new EventEmitter() as any
  proc.stdout = Readable.from([stdout])
  proc.stderr = Readable.from([''])
  proc.pid = 12345

  const mockSpawnFn = vi.mocked(spawn)
  mockSpawnFn.mockReturnValue(proc)

  // Emit exit after a tick
  setTimeout(() => proc.emit('close', exitCode), 10)
}

const mockProvider: Provider = {
  name: 'claude',
  buildCommand: vi.fn().mockReturnValue({
    cmd: 'claude',
    args: ['--print', 'test prompt'],
  }),
}

const mockParser: Parser = {
  name: 'claude',
  parse: vi.fn().mockReturnValue({
    role: 'researcher',
    subrole: 'codebase',
    provider: 'claude',
    model: 'opus-4.6',
    status: 'success',
    output: { summary: 'Done', raw: 'Full output' },
    duration: 100,
  }),
}

const mockConfig: InvokeConfig = {
  providers: {
    claude: { cli: 'claude', args: ['--print', '--model', '{{model}}'] },
  },
  roles: {
    researcher: {
      codebase: {
        prompt: '.invoke/roles/researcher/codebase.md',
        provider: 'claude',
        model: 'opus-4.6',
        effort: 'high',
      },
    },
  },
  strategies: {},
  settings: {
    default_strategy: 'tdd',
    agent_timeout: 5000,
    commit_style: 'per-batch',
    work_branch_prefix: 'invoke/work',
  },
}

describe('DispatchEngine', () => {
  let engine: DispatchEngine

  beforeEach(() => {
    const providers = new Map([['claude', mockProvider]])
    const parsers = new Map([['claude', mockParser]])
    engine = new DispatchEngine({
      config: mockConfig,
      providers,
      parsers,
      projectDir: '/tmp/test-project',
    })
  })

  it('dispatches a single agent and returns a result', async () => {
    mockSpawn('Research output here', 0)

    const result = await engine.dispatch({
      role: 'researcher',
      subrole: 'codebase',
      taskContext: { task_description: 'Analyze the codebase' },
    })

    expect(mockProvider.buildCommand).toHaveBeenCalled()
    expect(result.status).toBe('success')
  })

  it('returns error when role is not found in config', async () => {
    await expect(
      engine.dispatch({
        role: 'nonexistent',
        subrole: 'test',
        taskContext: {},
      })
    ).rejects.toThrow('Role not found: nonexistent.test')
  })

  it('returns error when provider is not found', async () => {
    const badConfig = {
      ...mockConfig,
      roles: {
        researcher: {
          codebase: {
            ...mockConfig.roles.researcher.codebase,
            provider: 'unknown',
          },
        },
      },
    }
    const providers = new Map([['claude', mockProvider]])
    const parsers = new Map([['claude', mockParser]])
    const badEngine = new DispatchEngine({
      config: badConfig,
      providers,
      parsers,
      projectDir: '/tmp/test-project',
    })

    await expect(
      badEngine.dispatch({
        role: 'researcher',
        subrole: 'codebase',
        taskContext: {},
      })
    ).rejects.toThrow('Provider not found: unknown')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dispatch/engine.test.ts`
Expected: FAIL — `DispatchEngine` not found

- [ ] **Step 3: Implement the dispatch engine**

Create `src/dispatch/engine.ts`:

```typescript
import { spawn } from 'child_process'
import type { Provider } from '../providers/base.js'
import type { Parser } from '../parsers/base.js'
import type { InvokeConfig, DispatchRequest, AgentResult } from '../types.js'
import { composePrompt } from './prompt-composer.js'

interface DispatchEngineOptions {
  config: InvokeConfig
  providers: Map<string, Provider>
  parsers: Map<string, Parser>
  projectDir: string
}

export class DispatchEngine {
  private config: InvokeConfig
  private providers: Map<string, Provider>
  private parsers: Map<string, Parser>
  private projectDir: string

  constructor(options: DispatchEngineOptions) {
    this.config = options.config
    this.providers = options.providers
    this.parsers = options.parsers
    this.projectDir = options.projectDir
  }

  async dispatch(request: DispatchRequest): Promise<AgentResult> {
    const roleConfig = this.config.roles[request.role]?.[request.subrole]
    if (!roleConfig) {
      throw new Error(`Role not found: ${request.role}.${request.subrole}`)
    }

    const provider = this.providers.get(roleConfig.provider)
    if (!provider) {
      throw new Error(`Provider not found: ${roleConfig.provider}. Is the CLI installed?`)
    }

    const parser = this.parsers.get(roleConfig.provider)
    if (!parser) {
      throw new Error(`Parser not found for provider: ${roleConfig.provider}`)
    }

    const prompt = await composePrompt({
      projectDir: this.projectDir,
      promptPath: roleConfig.prompt,
      taskContext: request.taskContext,
    })

    const workDir = request.workDir ?? this.projectDir
    const commandSpec = provider.buildCommand({
      model: roleConfig.model,
      effort: roleConfig.effort,
      workDir,
      prompt,
    })

    const startTime = Date.now()
    const { stdout, exitCode } = await this.runProcess(
      commandSpec.cmd,
      commandSpec.args,
      this.config.settings.agent_timeout
    )
    const duration = Date.now() - startTime

    return parser.parse(stdout, exitCode, {
      role: request.role,
      subrole: request.subrole,
      provider: roleConfig.provider,
      model: roleConfig.model,
      duration,
    })
  }

  private runProcess(
    cmd: string,
    args: string[],
    timeout: number
  ): Promise<{ stdout: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })

      let stdout = ''
      let stderr = ''
      let timedOut = false

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      const timer = setTimeout(() => {
        timedOut = true
        proc.kill('SIGTERM')
      }, timeout)

      proc.on('close', (code) => {
        clearTimeout(timer)
        if (timedOut) {
          resolve({ stdout: stdout || `Agent timed out after ${timeout}ms`, exitCode: -1 })
        } else {
          resolve({ stdout, exitCode: code ?? 1 })
        }
      })

      proc.on('error', (err) => {
        clearTimeout(timer)
        reject(new Error(`Failed to spawn ${cmd}: ${err.message}. Is the CLI installed?`))
      })
    })
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/dispatch/engine.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/dispatch/engine.ts tests/dispatch/engine.test.ts
git commit -m "feat: add dispatch engine with CLI process spawning and timeout"
```

---

### Task 11: Batch Manager

**Files:**
- Create: `src/dispatch/batch-manager.ts`
- Create: `tests/dispatch/batch-manager.test.ts`

- [ ] **Step 1: Write failing tests for batch manager**

Create `tests/dispatch/batch-manager.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BatchManager } from '../../src/dispatch/batch-manager.js'
import type { DispatchEngine } from '../../src/dispatch/engine.js'
import type { WorktreeManager } from '../../src/worktree/manager.js'
import type { AgentResult } from '../../src/types.js'

const mockResult: AgentResult = {
  role: 'builder',
  subrole: 'default',
  provider: 'claude',
  model: 'opus-4.6',
  status: 'success',
  output: { summary: 'Built the thing', raw: 'Full output' },
  duration: 5000,
}

const mockEngine = {
  dispatch: vi.fn().mockResolvedValue(mockResult),
} as unknown as DispatchEngine

const mockWorktreeManager = {
  create: vi.fn().mockResolvedValue({
    taskId: 'task-1',
    worktreePath: '/tmp/wt-task-1',
    branch: 'invoke-wt-task-1',
  }),
  cleanup: vi.fn(),
} as unknown as WorktreeManager

describe('BatchManager', () => {
  let manager: BatchManager

  beforeEach(() => {
    vi.clearAllMocks()
    manager = new BatchManager(mockEngine, mockWorktreeManager)
  })

  it('dispatches a batch and returns a batch ID immediately', async () => {
    const batchId = manager.dispatchBatch({
      tasks: [
        { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: { task_description: 'Build X' } },
        { taskId: 'task-2', role: 'builder', subrole: 'default', taskContext: { task_description: 'Build Y' } },
      ],
      createWorktrees: true,
    })

    expect(batchId).toBeTruthy()
    expect(typeof batchId).toBe('string')
  })

  it('tracks batch status from running to completed', async () => {
    const batchId = manager.dispatchBatch({
      tasks: [
        { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: false,
    })

    // Initially running
    let status = manager.getStatus(batchId)
    expect(status).not.toBeNull()
    expect(['running', 'completed']).toContain(status!.status)

    // Wait for completion
    await vi.waitFor(() => {
      const s = manager.getStatus(batchId)
      expect(s!.status).toBe('completed')
    }, { timeout: 2000 })

    const finalStatus = manager.getStatus(batchId)
    expect(finalStatus!.status).toBe('completed')
    expect(finalStatus!.agents[0].status).toBe('completed')
    expect(finalStatus!.agents[0].result).toEqual(mockResult)
  })

  it('creates worktrees when requested', async () => {
    manager.dispatchBatch({
      tasks: [
        { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: true,
    })

    await vi.waitFor(() => {
      expect(mockWorktreeManager.create).toHaveBeenCalledWith('task-1')
    }, { timeout: 2000 })
  })

  it('cancels a running batch', async () => {
    // Make dispatch hang
    const neverResolve = new Promise<AgentResult>(() => {})
    vi.mocked(mockEngine.dispatch).mockReturnValue(neverResolve)

    const batchId = manager.dispatchBatch({
      tasks: [
        { taskId: 'task-1', role: 'builder', subrole: 'default', taskContext: {} },
      ],
      createWorktrees: false,
    })

    manager.cancel(batchId)

    const status = manager.getStatus(batchId)
    expect(status!.status).toBe('cancelled')
  })

  it('returns null for unknown batch ID', () => {
    expect(manager.getStatus('nonexistent')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dispatch/batch-manager.test.ts`
Expected: FAIL — `BatchManager` not found

- [ ] **Step 3: Implement the batch manager**

Create `src/dispatch/batch-manager.ts`:

```typescript
import { randomUUID } from 'crypto'
import type { DispatchEngine } from './engine.js'
import type { WorktreeManager } from '../worktree/manager.js'
import type { BatchRequest, BatchStatus, AgentStatus, AgentResult } from '../types.js'

interface BatchRecord {
  status: BatchStatus
  abortController: AbortController
}

export class BatchManager {
  private batches = new Map<string, BatchRecord>()

  constructor(
    private engine: DispatchEngine,
    private worktreeManager: WorktreeManager
  ) {}

  dispatchBatch(request: BatchRequest): string {
    const batchId = randomUUID().slice(0, 8)
    const agents: AgentStatus[] = request.tasks.map(task => ({
      taskId: task.taskId,
      status: 'pending' as const,
    }))

    const abortController = new AbortController()
    const record: BatchRecord = {
      status: { batchId, status: 'running', agents },
      abortController,
    }

    this.batches.set(batchId, record)

    // Fire and forget — dispatch all tasks in parallel
    this.runBatch(batchId, request, abortController.signal)

    return batchId
  }

  getStatus(batchId: string): BatchStatus | null {
    const record = this.batches.get(batchId)
    return record ? record.status : null
  }

  cancel(batchId: string): void {
    const record = this.batches.get(batchId)
    if (!record) return

    record.abortController.abort()
    record.status.status = 'cancelled'
    for (const agent of record.status.agents) {
      if (agent.status === 'pending' || agent.status === 'dispatched' || agent.status === 'running') {
        agent.status = 'error'
      }
    }
  }

  private async runBatch(
    batchId: string,
    request: BatchRequest,
    signal: AbortSignal
  ): Promise<void> {
    const record = this.batches.get(batchId)!

    const promises = request.tasks.map(async (task, index) => {
      if (signal.aborted) return

      const agentStatus = record.status.agents[index]

      try {
        let workDir: string | undefined

        if (request.createWorktrees) {
          agentStatus.status = 'dispatched'
          const wt = await this.worktreeManager.create(task.taskId)
          workDir = wt.worktreePath
        }

        agentStatus.status = 'running'

        if (signal.aborted) return

        const result = await this.engine.dispatch({
          role: task.role,
          subrole: task.subrole,
          taskContext: task.taskContext,
          workDir,
        })

        agentStatus.status = 'completed'
        agentStatus.result = result
      } catch (err) {
        agentStatus.status = 'error'
        agentStatus.result = {
          role: task.role,
          subrole: task.subrole,
          provider: 'unknown',
          model: 'unknown',
          status: 'error',
          output: {
            summary: err instanceof Error ? err.message : 'Unknown error',
            raw: String(err),
          },
          duration: 0,
        }
      }
    })

    await Promise.allSettled(promises)

    if (!signal.aborted) {
      const allDone = record.status.agents.every(
        a => a.status === 'completed' || a.status === 'error' || a.status === 'timeout'
      )
      const anyError = record.status.agents.some(a => a.status === 'error' || a.status === 'timeout')

      record.status.status = allDone
        ? (anyError ? 'error' : 'completed')
        : 'running'
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/dispatch/batch-manager.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/dispatch/batch-manager.ts tests/dispatch/batch-manager.test.ts
git commit -m "feat: add batch manager for non-blocking parallel agent dispatch"
```

---

### Task 12: MCP Server Entry Point & Tool Registration

**Files:**
- Create: `src/tools/config-tool.ts`
- Create: `src/tools/dispatch-tools.ts`
- Create: `src/tools/worktree-tools.ts`
- Create: `src/tools/state-tools.ts`
- Create: `src/tools/artifact-tools.ts`
- Modify: `src/index.ts`

This task wires everything together as MCP tools.

- [ ] **Step 1: Create config tool registrar**

Create `src/tools/config-tool.ts`:

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { loadConfig } from '../config.js'

export function registerConfigTools(server: McpServer, projectDir: string): void {
  server.registerTool(
    'invoke_get_config',
    {
      description: 'Read and return the parsed pipeline.yaml configuration',
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const config = await loadConfig(projectDir)
        return {
          content: [{ type: 'text', text: JSON.stringify(config, null, 2) }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error loading config: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    }
  )
}
```

- [ ] **Step 2: Create dispatch tool registrars**

Create `src/tools/dispatch-tools.ts`:

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { DispatchEngine } from '../dispatch/engine.js'
import type { BatchManager } from '../dispatch/batch-manager.js'

export function registerDispatchTools(
  server: McpServer,
  engine: DispatchEngine,
  batchManager: BatchManager
): void {
  server.registerTool(
    'invoke_dispatch',
    {
      description: 'Dispatch a single agent by role and subrole. Blocks until the agent completes.',
      inputSchema: z.object({
        role: z.string().describe('Top-level role group (e.g. researcher, reviewer, builder)'),
        subrole: z.string().describe('Specific sub-role (e.g. security, codebase, default)'),
        task_context: z.record(z.string()).describe('Template variables to inject into the prompt'),
        work_dir: z.string().optional().describe('Override working directory for the agent'),
      }),
    },
    async ({ role, subrole, task_context, work_dir }) => {
      try {
        const result = await engine.dispatch({
          role,
          subrole,
          taskContext: task_context,
          workDir: work_dir,
        })
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Dispatch error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    }
  )

  server.registerTool(
    'invoke_dispatch_batch',
    {
      description: 'Dispatch a batch of agents in parallel. Returns immediately with a batch_id for polling.',
      inputSchema: z.object({
        tasks: z.array(z.object({
          task_id: z.string(),
          role: z.string(),
          subrole: z.string(),
          task_context: z.record(z.string()),
        })),
        create_worktrees: z.boolean().describe('Whether to create git worktrees for each task'),
      }),
    },
    async ({ tasks, create_worktrees }) => {
      const batchId = batchManager.dispatchBatch({
        tasks: tasks.map(t => ({
          taskId: t.task_id,
          role: t.role,
          subrole: t.subrole,
          taskContext: t.task_context,
        })),
        createWorktrees: create_worktrees,
      })

      return {
        content: [{ type: 'text', text: JSON.stringify({ batch_id: batchId, status: 'dispatched' }) }],
      }
    }
  )

  server.registerTool(
    'invoke_get_batch_status',
    {
      description: 'Get the status of a dispatched batch. Poll this after invoke_dispatch_batch.',
      inputSchema: z.object({
        batch_id: z.string().describe('The batch ID returned by invoke_dispatch_batch'),
      }),
    },
    async ({ batch_id }) => {
      const status = batchManager.getStatus(batch_id)
      if (!status) {
        return {
          content: [{ type: 'text', text: `Batch not found: ${batch_id}` }],
          isError: true,
        }
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
      }
    }
  )

  server.registerTool(
    'invoke_cancel_batch',
    {
      description: 'Cancel a running batch and kill its agents.',
      inputSchema: z.object({
        batch_id: z.string().describe('The batch ID to cancel'),
      }),
    },
    async ({ batch_id }) => {
      batchManager.cancel(batch_id)
      return {
        content: [{ type: 'text', text: JSON.stringify({ batch_id, status: 'cancelled' }) }],
      }
    }
  )
}
```

- [ ] **Step 3: Create worktree tool registrars**

Create `src/tools/worktree-tools.ts`:

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { WorktreeManager } from '../worktree/manager.js'

export function registerWorktreeTools(server: McpServer, worktreeManager: WorktreeManager): void {
  server.registerTool(
    'invoke_create_worktree',
    {
      description: 'Create an isolated git worktree for a build task.',
      inputSchema: z.object({
        task_id: z.string().describe('Unique task identifier'),
      }),
    },
    async ({ task_id }) => {
      try {
        const info = await worktreeManager.create(task_id)
        return {
          content: [{ type: 'text', text: JSON.stringify(info) }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Worktree error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    }
  )

  server.registerTool(
    'invoke_merge_worktree',
    {
      description: 'Merge a completed worktree back into the work branch.',
      inputSchema: z.object({
        task_id: z.string().describe('Task ID of the worktree to merge'),
      }),
    },
    async ({ task_id }) => {
      try {
        await worktreeManager.merge(task_id)
        await worktreeManager.cleanup(task_id)
        return {
          content: [{ type: 'text', text: JSON.stringify({ task_id, status: 'merged' }) }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Merge error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    }
  )

  server.registerTool(
    'invoke_cleanup_worktrees',
    {
      description: 'Remove all stale/orphaned worktrees.',
      inputSchema: z.object({}),
    },
    async () => {
      const active = worktreeManager.listActive()
      await worktreeManager.cleanupAll()
      return {
        content: [{ type: 'text', text: JSON.stringify({ cleaned: active.length }) }],
      }
    }
  )
}
```

- [ ] **Step 4: Create state tool registrars**

Create `src/tools/state-tools.ts`:

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { StateManager } from './state.js'

export function registerStateTools(server: McpServer, stateManager: StateManager): void {
  server.registerTool(
    'invoke_get_state',
    {
      description: 'Get the current pipeline state.',
      inputSchema: z.object({}),
    },
    async () => {
      const state = await stateManager.get()
      return {
        content: [{ type: 'text', text: JSON.stringify(state, null, 2) }],
      }
    }
  )

  server.registerTool(
    'invoke_set_state',
    {
      description: 'Update pipeline state fields. Pass only the fields to update.',
      inputSchema: z.object({
        pipeline_id: z.string().optional(),
        current_stage: z.enum(['scope', 'plan', 'orchestrate', 'build', 'review', 'complete']).optional(),
        work_branch: z.string().optional(),
        spec: z.string().optional(),
        plan: z.string().optional(),
        strategy: z.string().optional(),
      }),
    },
    async (updates) => {
      try {
        let state = await stateManager.get()
        if (!state) {
          state = await stateManager.initialize(updates.pipeline_id ?? `pipeline-${Date.now()}`)
        }
        const updated = await stateManager.update(updates)
        return {
          content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `State error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    }
  )
}
```

- [ ] **Step 5: Create artifact tool registrars**

Create `src/tools/artifact-tools.ts`:

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ArtifactManager } from './artifacts.js'

export function registerArtifactTools(server: McpServer, artifactManager: ArtifactManager): void {
  server.registerTool(
    'invoke_save_artifact',
    {
      description: 'Save a pipeline artifact (spec, plan, review) to the .invoke/ directory.',
      inputSchema: z.object({
        stage: z.string().describe('Stage directory (e.g. specs, plans, reviews, specs/research)'),
        filename: z.string().describe('Filename to save'),
        content: z.string().describe('File content'),
      }),
    },
    async ({ stage, filename, content }) => {
      const filePath = await artifactManager.save(stage, filename, content)
      return {
        content: [{ type: 'text', text: JSON.stringify({ saved: filePath }) }],
      }
    }
  )

  server.registerTool(
    'invoke_read_artifact',
    {
      description: 'Read a pipeline artifact from the .invoke/ directory.',
      inputSchema: z.object({
        stage: z.string().describe('Stage directory (e.g. specs, plans, reviews)'),
        filename: z.string().describe('Filename to read'),
      }),
    },
    async ({ stage, filename }) => {
      try {
        const content = await artifactManager.read(stage, filename)
        return {
          content: [{ type: 'text', text: content }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Artifact not found: ${stage}/${filename}` }],
          isError: true,
        }
      }
    }
  )
}
```

- [ ] **Step 6: Wire everything together in the MCP server entry point**

Update `src/index.ts`:

```typescript
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
```

- [ ] **Step 7: Verify the project compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 9: Commit**

```bash
git add src/tools/config-tool.ts src/tools/dispatch-tools.ts src/tools/worktree-tools.ts src/tools/state-tools.ts src/tools/artifact-tools.ts src/index.ts
git commit -m "feat: wire MCP server with all tool registrations"
```

---

### Task 13: End-to-End Smoke Test

**Files:**
- Create: `tests/e2e/smoke.test.ts`

This test verifies the full server can start, load config, and respond to tool calls.

- [ ] **Step 1: Write the smoke test**

Create `tests/e2e/smoke.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { loadConfig } from '../../src/config.js'
import { createProviderRegistry } from '../../src/providers/registry.js'
import { createParserRegistry } from '../../src/parsers/registry.js'
import { DispatchEngine } from '../../src/dispatch/engine.js'
import { BatchManager } from '../../src/dispatch/batch-manager.js'
import { WorktreeManager } from '../../src/worktree/manager.js'
import { StateManager } from '../../src/tools/state.js'
import { ArtifactManager } from '../../src/tools/artifacts.js'
import { registerConfigTools } from '../../src/tools/config-tool.js'
import { registerStateTools } from '../../src/tools/state-tools.js'
import { registerArtifactTools } from '../../src/tools/artifact-tools.js'
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
```

- [ ] **Step 2: Run the smoke test**

Run: `npx vitest run tests/e2e/smoke.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: All tests PASS across all files

- [ ] **Step 4: Verify build succeeds**

Run: `npx tsc`
Expected: Clean build in `dist/` directory

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/ dist/
git commit -m "feat: add e2e smoke test and verify full build"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] MCP server as local stdio process — Task 12
- [x] Agent dispatch via CLI — Tasks 4, 10
- [x] Output normalization — Task 5
- [x] Prompt composition with templates — Task 6
- [x] Git worktree management — Task 7
- [x] Pipeline state in flat files — Task 8
- [x] Artifact storage — Task 9
- [x] Non-blocking batch dispatch with polling — Task 11
- [x] Batch cancellation — Task 11
- [x] Config loading and validation — Task 3
- [x] Provider registry — Task 4
- [x] All MCP tools registered — Task 12

**Not in this plan (covered by Plan 2: Skills + Defaults):**
- Skill files
- Default role/strategy prompt templates
- Claude Code hooks
- Install/packaging flow

**Placeholder scan:** No TBDs, TODOs, or vague steps found.

**Type consistency:** `AgentResult`, `Finding`, `BatchStatus`, `PipelineState` — all used consistently across engine, parsers, batch manager, and tool registrars.
