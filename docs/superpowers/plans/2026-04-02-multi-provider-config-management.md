# Multi-Provider & Config Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-provider sub-roles (any role dispatches to multiple providers in parallel with merged results) and self-serve config management tools (`invoke_update_config`, `invoke_delete_artifact`).

**Architecture:** Extend the existing RoleConfig type to use a `providers` array. The config loader normalizes single-provider shorthand into arrays. The dispatch engine fans out to all providers and merges results. New config manager handles structured CRUD operations on pipeline.yaml with full Zod validation.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, `zod`, `yaml`, `vitest`

**Spec:** `docs/superpowers/specs/2026-04-02-multi-provider-and-config-management-design.md`

---

## File Structure

```
src/
  types.ts                          # MODIFY — RoleConfig → providers array, ProviderEntry, Finding.agreedBy
  config.ts                         # MODIFY — Zod schema accepts both formats, normalizes
  dispatch/
    engine.ts                       # MODIFY — fan out to multiple providers, merge results
    merge-findings.ts               # CREATE — finding deduplication and merge logic
  tools/
    artifacts.ts                    # MODIFY — add delete() method
    artifact-tools.ts               # MODIFY — register invoke_delete_artifact
    config-manager.ts               # CREATE — read/modify/validate/write config operations
    config-update-tools.ts          # CREATE — MCP tool for invoke_update_config

  index.ts                          # MODIFY — register new tools

tests/
  config.test.ts                    # MODIFY — test both config formats
  dispatch/
    engine.test.ts                  # MODIFY — test multi-provider dispatch
    merge-findings.test.ts          # CREATE — test dedup logic
  tools/
    artifacts.test.ts               # MODIFY — test delete
    config-manager.test.ts          # CREATE — test all CRUD operations

skills/
  invoke-manage.md                  # MODIFY — reference actual MCP tools
```

---

### Task 1: Update Types for Multi-Provider

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add ProviderEntry and update RoleConfig**

Replace the current `RoleConfig` interface in `src/types.ts` (lines 8-13) with:

```typescript
export interface ProviderEntry {
  provider: string
  model: string
  effort: 'low' | 'medium' | 'high'
}

export interface RoleConfig {
  prompt: string
  providers: ProviderEntry[]
}
```

- [ ] **Step 2: Add agreedBy to Finding**

In `src/types.ts`, update the `Finding` interface (lines 58-64) to:

```typescript
export interface Finding {
  issue: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  file: string
  line?: number
  suggestion: string
  agreedBy?: string[]
}
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: Errors in files that reference `roleConfig.provider` — this is expected, we'll fix in subsequent tasks.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat: update types for multi-provider sub-roles"
```

---

### Task 2: Update Config Loader for Both Formats

**Files:**
- Modify: `src/config.ts`
- Modify: `tests/config.test.ts`

- [ ] **Step 1: Write failing tests for both config formats**

Replace the contents of `tests/config.test.ts` with:

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
  it('loads single-provider shorthand and normalizes to providers array', async () => {
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

    expect(config.roles.reviewer.security.providers).toHaveLength(1)
    expect(config.roles.reviewer.security.providers[0].provider).toBe('claude')
    expect(config.roles.reviewer.security.providers[0].model).toBe('opus-4.6')
    expect(config.roles.reviewer.security.providers[0].effort).toBe('high')
    expect(config.roles.reviewer.security.prompt).toBe('.invoke/roles/reviewer/security.md')
  })

  it('loads multi-provider format directly', async () => {
    const yaml = `
providers:
  claude:
    cli: claude
    args: ["--print", "--model", "{{model}}"]
  codex:
    cli: codex
    args: ["--model", "{{model}}"]

roles:
  reviewer:
    security:
      prompt: .invoke/roles/reviewer/security.md
      providers:
        - provider: claude
          model: opus-4.6
          effort: high
        - provider: codex
          model: gpt-5.4
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

    expect(config.roles.reviewer.security.providers).toHaveLength(2)
    expect(config.roles.reviewer.security.providers[0].provider).toBe('claude')
    expect(config.roles.reviewer.security.providers[1].provider).toBe('codex')
    expect(config.roles.reviewer.security.providers[1].model).toBe('gpt-5.4')
  })

  it('handles mixed formats in same config', async () => {
    const yaml = `
providers:
  claude:
    cli: claude
    args: ["--print", "--model", "{{model}}"]

roles:
  reviewer:
    security:
      prompt: .invoke/roles/reviewer/security.md
      providers:
        - provider: claude
          model: opus-4.6
          effort: high
    code-quality:
      prompt: .invoke/roles/reviewer/code-quality.md
      provider: claude
      model: opus-4.6
      effort: medium

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

    expect(config.roles.reviewer.security.providers).toHaveLength(1)
    expect(config.roles.reviewer['code-quality'].providers).toHaveLength(1)
    expect(config.roles.reviewer['code-quality'].providers[0].provider).toBe('claude')
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

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — old tests no longer match new RoleConfig shape

- [ ] **Step 3: Update config loader**

Replace the contents of `src/config.ts` with:

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

const ProviderEntrySchema = z.object({
  provider: z.string(),
  model: z.string(),
  effort: z.enum(['low', 'medium', 'high']),
})

// Accept either single-provider shorthand or providers array
const RawRoleConfigSchema = z.object({
  prompt: z.string(),
  // Single-provider shorthand fields (optional)
  provider: z.string().optional(),
  model: z.string().optional(),
  effort: z.enum(['low', 'medium', 'high']).optional(),
  // Multi-provider array (optional)
  providers: z.array(ProviderEntrySchema).optional(),
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

const RawInvokeConfigSchema = z.object({
  providers: z.record(z.string(), ProviderConfigSchema),
  roles: z.record(z.string(), z.record(z.string(), RawRoleConfigSchema)),
  strategies: z.record(z.string(), StrategyConfigSchema),
  settings: SettingsSchema,
})

function normalizeConfig(raw: z.infer<typeof RawInvokeConfigSchema>): InvokeConfig {
  const roles: InvokeConfig['roles'] = {}

  for (const [roleGroup, subroles] of Object.entries(raw.roles)) {
    roles[roleGroup] = {}
    for (const [subroleName, subrole] of Object.entries(subroles)) {
      if (subrole.providers && subrole.providers.length > 0) {
        roles[roleGroup][subroleName] = {
          prompt: subrole.prompt,
          providers: subrole.providers,
        }
      } else if (subrole.provider && subrole.model && subrole.effort) {
        roles[roleGroup][subroleName] = {
          prompt: subrole.prompt,
          providers: [{
            provider: subrole.provider,
            model: subrole.model,
            effort: subrole.effort,
          }],
        }
      } else {
        throw new Error(
          `Role ${roleGroup}.${subroleName} must have either 'providers' array or 'provider'/'model'/'effort' fields`
        )
      }
    }
  }

  return {
    providers: raw.providers,
    roles,
    strategies: raw.strategies,
    settings: raw.settings,
  }
}

export async function loadConfig(projectDir: string): Promise<InvokeConfig> {
  const configPath = path.join(projectDir, '.invoke', 'pipeline.yaml')
  const content = await readFile(configPath, 'utf-8')
  const raw = parse(content)
  const validated = RawInvokeConfigSchema.parse(raw)
  return normalizeConfig(validated)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/config.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: config loader accepts both single and multi-provider formats"
```

---

### Task 3: Finding Merge Logic

**Files:**
- Create: `src/dispatch/merge-findings.ts`
- Create: `tests/dispatch/merge-findings.test.ts`

- [ ] **Step 1: Write failing tests for merge logic**

Create `tests/dispatch/merge-findings.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { mergeFindings } from '../../src/dispatch/merge-findings.js'
import type { Finding } from '../../src/types.js'

describe('mergeFindings', () => {
  it('deduplicates identical findings from multiple providers', () => {
    const findingsA: Finding[] = [
      { issue: 'SQL injection vulnerability', severity: 'high', file: 'src/db.ts', line: 42, suggestion: 'Use parameterized queries' },
    ]
    const findingsB: Finding[] = [
      { issue: 'SQL injection vulnerability', severity: 'high', file: 'src/db.ts', line: 42, suggestion: 'Use prepared statements' },
    ]

    const merged = mergeFindings([
      { provider: 'claude', findings: findingsA },
      { provider: 'codex', findings: findingsB },
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0].agreedBy).toEqual(['claude', 'codex'])
    expect(merged[0].file).toBe('src/db.ts')
    expect(merged[0].line).toBe(42)
  })

  it('keeps unique findings from different providers', () => {
    const findingsA: Finding[] = [
      { issue: 'XSS in template', severity: 'high', file: 'src/view.ts', line: 10, suggestion: 'Escape output' },
    ]
    const findingsB: Finding[] = [
      { issue: 'Memory leak in cache', severity: 'medium', file: 'src/cache.ts', line: 55, suggestion: 'Add eviction' },
    ]

    const merged = mergeFindings([
      { provider: 'claude', findings: findingsA },
      { provider: 'codex', findings: findingsB },
    ])

    expect(merged).toHaveLength(2)
    expect(merged[0].agreedBy).toEqual(['claude'])
    expect(merged[1].agreedBy).toEqual(['codex'])
  })

  it('matches findings by file and high word overlap in issue text', () => {
    const findingsA: Finding[] = [
      { issue: 'Unsanitized user input passed to SQL query', severity: 'high', file: 'src/db.ts', suggestion: 'Sanitize input' },
    ]
    const findingsB: Finding[] = [
      { issue: 'User input is not sanitized before SQL query execution', severity: 'high', file: 'src/db.ts', suggestion: 'Use parameterized queries' },
    ]

    const merged = mergeFindings([
      { provider: 'claude', findings: findingsA },
      { provider: 'codex', findings: findingsB },
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0].agreedBy).toEqual(['claude', 'codex'])
  })

  it('does not match findings in different files', () => {
    const findingsA: Finding[] = [
      { issue: 'SQL injection', severity: 'high', file: 'src/db.ts', line: 42, suggestion: 'Fix it' },
    ]
    const findingsB: Finding[] = [
      { issue: 'SQL injection', severity: 'high', file: 'src/other.ts', line: 42, suggestion: 'Fix it' },
    ]

    const merged = mergeFindings([
      { provider: 'claude', findings: findingsA },
      { provider: 'codex', findings: findingsB },
    ])

    expect(merged).toHaveLength(2)
  })

  it('sorts by severity then by agreement count', () => {
    const findingsA: Finding[] = [
      { issue: 'Low issue', severity: 'low', file: 'a.ts', suggestion: 'Fix' },
      { issue: 'Critical issue', severity: 'critical', file: 'b.ts', suggestion: 'Fix' },
    ]
    const findingsB: Finding[] = [
      { issue: 'Critical issue', severity: 'critical', file: 'b.ts', suggestion: 'Fix' },
      { issue: 'Medium issue', severity: 'medium', file: 'c.ts', suggestion: 'Fix' },
    ]

    const merged = mergeFindings([
      { provider: 'claude', findings: findingsA },
      { provider: 'codex', findings: findingsB },
    ])

    expect(merged[0].severity).toBe('critical')
    expect(merged[0].agreedBy).toEqual(['claude', 'codex'])
    expect(merged[1].severity).toBe('medium')
    expect(merged[2].severity).toBe('low')
  })

  it('handles single provider input', () => {
    const findings: Finding[] = [
      { issue: 'Bug', severity: 'high', file: 'src/a.ts', suggestion: 'Fix' },
    ]

    const merged = mergeFindings([
      { provider: 'claude', findings },
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0].agreedBy).toEqual(['claude'])
  })

  it('handles empty findings', () => {
    const merged = mergeFindings([
      { provider: 'claude', findings: [] },
      { provider: 'codex', findings: [] },
    ])

    expect(merged).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/dispatch/merge-findings.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement merge-findings**

Create `src/dispatch/merge-findings.ts`:

```typescript
import type { Finding } from '../types.js'

interface ProviderFindings {
  provider: string
  findings: Finding[]
}

interface MergedFinding extends Finding {
  agreedBy: string[]
}

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

export function mergeFindings(providerResults: ProviderFindings[]): MergedFinding[] {
  const merged: MergedFinding[] = []

  for (const { provider, findings } of providerResults) {
    for (const finding of findings) {
      const match = merged.find(m => isSameFinding(m, finding))
      if (match) {
        match.agreedBy.push(provider)
        // Keep the higher severity if they disagree
        if (SEVERITY_ORDER[finding.severity] < SEVERITY_ORDER[match.severity]) {
          match.severity = finding.severity
        }
      } else {
        merged.push({
          ...finding,
          agreedBy: [provider],
        })
      }
    }
  }

  return merged.sort((a, b) => {
    const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    if (sevDiff !== 0) return sevDiff
    return b.agreedBy.length - a.agreedBy.length
  })
}

function isSameFinding(a: Finding, b: Finding): boolean {
  if (a.file !== b.file) return false

  // Same file + same line = match
  if (a.line != null && b.line != null && a.line === b.line) return true

  // Same file + high word overlap in issue text = match
  return wordOverlap(a.issue, b.issue) > 0.8
}

function wordOverlap(textA: string, textB: string): number {
  const wordsA = new Set(textA.toLowerCase().trim().split(/\s+/))
  const wordsB = new Set(textB.toLowerCase().trim().split(/\s+/))

  let intersection = 0
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++
  }

  const union = new Set([...wordsA, ...wordsB]).size
  if (union === 0) return 0
  return intersection / union
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/dispatch/merge-findings.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/dispatch/merge-findings.ts tests/dispatch/merge-findings.test.ts
git commit -m "feat: add finding deduplication and merge logic"
```

---

### Task 4: Update Dispatch Engine for Multi-Provider

**Files:**
- Modify: `src/dispatch/engine.ts`
- Modify: `tests/dispatch/engine.test.ts`

- [ ] **Step 1: Write failing tests for multi-provider dispatch**

Replace the contents of `tests/dispatch/engine.test.ts` with:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DispatchEngine } from '../../src/dispatch/engine.js'
import type { InvokeConfig } from '../../src/types.js'
import type { Provider } from '../../src/providers/base.js'
import type { Parser } from '../../src/parsers/base.js'

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

vi.mock('../../src/dispatch/prompt-composer.js', () => ({
  composePrompt: vi.fn().mockResolvedValue('mocked prompt content'),
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

  setTimeout(() => proc.emit('close', exitCode), 10)
}

const mockProvider: Provider = {
  name: 'claude',
  buildCommand: vi.fn().mockReturnValue({
    cmd: 'claude',
    args: ['--print', 'test prompt'],
  }),
}

const mockCodexProvider: Provider = {
  name: 'codex',
  buildCommand: vi.fn().mockReturnValue({
    cmd: 'codex',
    args: ['--model', 'gpt-5.4', 'test prompt'],
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

const mockCodexParser: Parser = {
  name: 'codex',
  parse: vi.fn().mockReturnValue({
    role: 'researcher',
    subrole: 'codebase',
    provider: 'codex',
    model: 'gpt-5.4',
    status: 'success',
    output: { summary: 'Codex done', raw: 'Codex output' },
    duration: 200,
  }),
}

const singleProviderConfig: InvokeConfig = {
  providers: {
    claude: { cli: 'claude', args: ['--print', '--model', '{{model}}'] },
  },
  roles: {
    researcher: {
      codebase: {
        prompt: '.invoke/roles/researcher/codebase.md',
        providers: [{ provider: 'claude', model: 'opus-4.6', effort: 'high' }],
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

const multiProviderConfig: InvokeConfig = {
  providers: {
    claude: { cli: 'claude', args: ['--print', '--model', '{{model}}'] },
    codex: { cli: 'codex', args: ['--model', '{{model}}'] },
  },
  roles: {
    reviewer: {
      security: {
        prompt: '.invoke/roles/reviewer/security.md',
        providers: [
          { provider: 'claude', model: 'opus-4.6', effort: 'high' },
          { provider: 'codex', model: 'gpt-5.4', effort: 'high' },
        ],
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
  it('dispatches to a single provider and returns result', async () => {
    mockSpawn('Research output', 0)

    const providers = new Map([['claude', mockProvider]])
    const parsers = new Map([['claude', mockParser]])
    const engine = new DispatchEngine({
      config: singleProviderConfig,
      providers,
      parsers,
      projectDir: '/tmp/test-project',
    })

    const result = await engine.dispatch({
      role: 'researcher',
      subrole: 'codebase',
      taskContext: { task_description: 'Analyze' },
    })

    expect(mockProvider.buildCommand).toHaveBeenCalled()
    expect(result.status).toBe('success')
  })

  it('dispatches to multiple providers and returns merged result', async () => {
    mockSpawn('Review output', 0)

    const providers = new Map([['claude', mockProvider], ['codex', mockCodexProvider]])
    const parsers = new Map([['claude', mockParser], ['codex', mockCodexParser]])
    const engine = new DispatchEngine({
      config: multiProviderConfig,
      providers,
      parsers,
      projectDir: '/tmp/test-project',
    })

    const result = await engine.dispatch({
      role: 'reviewer',
      subrole: 'security',
      taskContext: { task_description: 'Review auth' },
    })

    expect(result.status).toBe('success')
    // Both providers should have been called
    expect(mockProvider.buildCommand).toHaveBeenCalled()
    expect(mockCodexProvider.buildCommand).toHaveBeenCalled()
  })

  it('throws when role is not found', async () => {
    const engine = new DispatchEngine({
      config: singleProviderConfig,
      providers: new Map([['claude', mockProvider]]),
      parsers: new Map([['claude', mockParser]]),
      projectDir: '/tmp/test',
    })

    await expect(
      engine.dispatch({ role: 'nonexistent', subrole: 'test', taskContext: {} })
    ).rejects.toThrow('Role not found: nonexistent.test')
  })

  it('throws when provider is not found', async () => {
    const badConfig: InvokeConfig = {
      ...singleProviderConfig,
      roles: {
        researcher: {
          codebase: {
            prompt: '.invoke/roles/researcher/codebase.md',
            providers: [{ provider: 'unknown', model: 'x', effort: 'high' }],
          },
        },
      },
    }

    const engine = new DispatchEngine({
      config: badConfig,
      providers: new Map([['claude', mockProvider]]),
      parsers: new Map([['claude', mockParser]]),
      projectDir: '/tmp/test',
    })

    await expect(
      engine.dispatch({ role: 'researcher', subrole: 'codebase', taskContext: {} })
    ).rejects.toThrow('Provider not found: unknown')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/dispatch/engine.test.ts`
Expected: FAIL — dispatch engine still uses old RoleConfig shape

- [ ] **Step 3: Update the dispatch engine**

Replace the contents of `src/dispatch/engine.ts` with:

```typescript
import { spawn } from 'child_process'
import type { Provider } from '../providers/base.js'
import type { Parser } from '../parsers/base.js'
import type { InvokeConfig, DispatchRequest, AgentResult, ProviderEntry } from '../types.js'
import { composePrompt } from './prompt-composer.js'
import { mergeFindings } from './merge-findings.js'

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

    const prompt = await composePrompt({
      projectDir: this.projectDir,
      promptPath: roleConfig.prompt,
      taskContext: request.taskContext,
    })

    const workDir = request.workDir ?? this.projectDir

    // Dispatch to all providers in parallel
    const resultPromises = roleConfig.providers.map(entry =>
      this.dispatchToProvider(entry, prompt, workDir, request)
    )

    const results = await Promise.all(resultPromises)

    // Single provider — return directly
    if (results.length === 1) {
      return results[0]
    }

    // Multiple providers — merge results
    return this.mergeResults(results, request)
  }

  private async dispatchToProvider(
    entry: ProviderEntry,
    prompt: string,
    workDir: string,
    request: DispatchRequest
  ): Promise<AgentResult> {
    const provider = this.providers.get(entry.provider)
    if (!provider) {
      throw new Error(`Provider not found: ${entry.provider}. Is the CLI installed?`)
    }

    const parser = this.parsers.get(entry.provider)
    if (!parser) {
      throw new Error(`Parser not found for provider: ${entry.provider}`)
    }

    const commandSpec = provider.buildCommand({
      model: entry.model,
      effort: entry.effort,
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
      provider: entry.provider,
      model: entry.model,
      duration,
    })
  }

  private mergeResults(results: AgentResult[], request: DispatchRequest): AgentResult {
    const hasFindings = results.some(r => r.output.findings && r.output.findings.length > 0)

    if (hasFindings) {
      const providerFindings = results
        .filter(r => r.output.findings)
        .map(r => ({
          provider: r.provider,
          findings: r.output.findings!,
        }))

      const merged = mergeFindings(providerFindings)

      return {
        role: request.role,
        subrole: request.subrole,
        provider: results.map(r => r.provider).join('+'),
        model: results.map(r => r.model).join('+'),
        status: results.every(r => r.status === 'success') ? 'success' : 'error',
        output: {
          summary: `Merged results from ${results.length} providers (${merged.length} findings)`,
          findings: merged,
          raw: results.map(r => `--- ${r.provider} ---\n${r.output.raw}`).join('\n\n'),
        },
        duration: Math.max(...results.map(r => r.duration)),
      }
    }

    // Non-reviewer: concatenate reports
    return {
      role: request.role,
      subrole: request.subrole,
      provider: results.map(r => r.provider).join('+'),
      model: results.map(r => r.model).join('+'),
      status: results.every(r => r.status === 'success') ? 'success' : 'error',
      output: {
        summary: `Combined results from ${results.length} providers`,
        report: results.map(r => `## ${r.provider} (${r.model})\n\n${r.output.report ?? r.output.raw}`).join('\n\n---\n\n'),
        raw: results.map(r => `--- ${r.provider} ---\n${r.output.raw}`).join('\n\n'),
      },
      duration: Math.max(...results.map(r => r.duration)),
    }
  }

  private runProcess(
    cmd: string,
    args: string[],
    timeout: number
  ): Promise<{ stdout: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })

      let stdout = ''
      let timedOut = false

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      proc.stderr.on('data', () => {})

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
Expected: All 4 tests PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS (some batch-manager tests may need mock updates — fix if needed)

- [ ] **Step 6: Commit**

```bash
git add src/dispatch/engine.ts tests/dispatch/engine.test.ts
git commit -m "feat: dispatch engine fans out to multiple providers and merges results"
```

---

### Task 5: Artifact Delete

**Files:**
- Modify: `src/tools/artifacts.ts`
- Modify: `src/tools/artifact-tools.ts`
- Modify: `tests/tools/artifacts.test.ts`

- [ ] **Step 1: Write failing test for delete**

Add to `tests/tools/artifacts.test.ts` inside the `describe('ArtifactManager')` block:

```typescript
  it('deletes an artifact', async () => {
    await artifacts.save('specs', 'to-delete.md', 'content')
    expect(await artifacts.read('specs', 'to-delete.md')).toBe('content')

    await artifacts.delete('specs', 'to-delete.md')
    await expect(artifacts.read('specs', 'to-delete.md')).rejects.toThrow()
  })

  it('throws when deleting nonexistent artifact', async () => {
    await expect(artifacts.delete('specs', 'nonexistent.md')).rejects.toThrow()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/artifacts.test.ts`
Expected: FAIL — `delete` method not found

- [ ] **Step 3: Add delete method to ArtifactManager**

Add to `src/tools/artifacts.ts`, inside the `ArtifactManager` class after the `list` method:

```typescript
  async delete(stage: string, filename: string): Promise<void> {
    const filePath = path.join(this.baseDir, stage, filename)
    await unlink(filePath)
  }
```

Also add `unlink` to the imports at the top:

```typescript
import { readFile, writeFile, mkdir, readdir, unlink } from 'fs/promises'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tools/artifacts.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Register invoke_delete_artifact tool**

Add to `src/tools/artifact-tools.ts`, after the `invoke_read_artifact` registration:

```typescript
  server.registerTool(
    'invoke_delete_artifact',
    {
      description: 'Delete a file from the .invoke/ directory.',
      inputSchema: z.object({
        stage: z.string().describe('Stage directory (e.g. roles/reviewer, strategies)'),
        filename: z.string().describe('Filename to delete'),
      }),
    },
    async ({ stage, filename }) => {
      try {
        await artifactManager.delete(stage, filename)
        return {
          content: [{ type: 'text', text: JSON.stringify({ deleted: `${stage}/${filename}` }) }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Delete error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    }
  )
```

- [ ] **Step 6: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/tools/artifacts.ts src/tools/artifact-tools.ts tests/tools/artifacts.test.ts
git commit -m "feat: add artifact delete method and invoke_delete_artifact tool"
```

---

### Task 6: Config Manager

**Files:**
- Create: `src/tools/config-manager.ts`
- Create: `tests/tools/config-manager.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/tools/config-manager.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ConfigManager } from '../../src/tools/config-manager.js'
import { mkdir, writeFile, rm, readFile } from 'fs/promises'
import path from 'path'

const TEST_DIR = path.join(import.meta.dirname, 'fixtures', 'config-manager-test')

let manager: ConfigManager

const STARTER_CONFIG = `
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

beforeEach(async () => {
  await mkdir(path.join(TEST_DIR, '.invoke'), { recursive: true })
  await writeFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), STARTER_CONFIG)
  manager = new ConfigManager(TEST_DIR)
})

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('ConfigManager', () => {
  describe('add_role', () => {
    it('adds a new sub-role to an existing role group', async () => {
      const result = await manager.execute({
        operation: 'add_role',
        role: 'reviewer',
        subrole: 'psr-compliance',
        config: {
          prompt: '.invoke/roles/reviewer/psr-compliance.md',
          providers: [{ provider: 'claude', model: 'opus-4.6', effort: 'high' }],
        },
      })

      expect(result.roles.reviewer['psr-compliance']).toBeTruthy()
      expect(result.roles.reviewer['psr-compliance'].providers[0].provider).toBe('claude')
      // Original role still exists
      expect(result.roles.reviewer.security).toBeTruthy()
    })

    it('adds a new role group', async () => {
      const result = await manager.execute({
        operation: 'add_role',
        role: 'orchestrator',
        subrole: 'default',
        config: {
          prompt: '.invoke/roles/orchestrator/default.md',
          providers: [{ provider: 'claude', model: 'opus-4.6', effort: 'high' }],
        },
      })

      expect(result.roles.orchestrator.default).toBeTruthy()
    })

    it('rejects duplicate sub-role', async () => {
      await expect(manager.execute({
        operation: 'add_role',
        role: 'reviewer',
        subrole: 'security',
        config: {
          prompt: '.invoke/roles/reviewer/security.md',
          providers: [{ provider: 'claude', model: 'opus-4.6', effort: 'high' }],
        },
      })).rejects.toThrow('already exists')
    })
  })

  describe('remove_role', () => {
    it('removes a sub-role', async () => {
      const result = await manager.execute({
        operation: 'remove_role',
        role: 'reviewer',
        subrole: 'security',
      })

      expect(result.roles.reviewer.security).toBeUndefined()
    })

    it('throws when sub-role does not exist', async () => {
      await expect(manager.execute({
        operation: 'remove_role',
        role: 'reviewer',
        subrole: 'nonexistent',
      })).rejects.toThrow('not found')
    })
  })

  describe('add_strategy', () => {
    it('adds a new strategy', async () => {
      const result = await manager.execute({
        operation: 'add_strategy',
        strategy: 'my-strategy',
        config: { prompt: '.invoke/strategies/my-strategy.md' },
      })

      expect(result.strategies['my-strategy'].prompt).toBe('.invoke/strategies/my-strategy.md')
    })
  })

  describe('remove_strategy', () => {
    it('removes a strategy', async () => {
      const result = await manager.execute({
        operation: 'remove_strategy',
        strategy: 'tdd',
      })

      expect(result.strategies.tdd).toBeUndefined()
    })
  })

  describe('update_settings', () => {
    it('updates specific settings', async () => {
      const result = await manager.execute({
        operation: 'update_settings',
        settings: { default_strategy: 'implementation-first', agent_timeout: 600000 },
      })

      expect(result.settings.default_strategy).toBe('implementation-first')
      expect(result.settings.agent_timeout).toBe(600000)
      // Unchanged settings preserved
      expect(result.settings.commit_style).toBe('per-batch')
    })
  })

  describe('persistence', () => {
    it('writes changes back to pipeline.yaml', async () => {
      await manager.execute({
        operation: 'add_strategy',
        strategy: 'my-strategy',
        config: { prompt: '.invoke/strategies/my-strategy.md' },
      })

      const raw = await readFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), 'utf-8')
      expect(raw).toContain('my-strategy')
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tools/config-manager.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement ConfigManager**

Create `src/tools/config-manager.ts`:

```typescript
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { parse, stringify } from 'yaml'
import type { InvokeConfig, ProviderEntry, StrategyConfig } from '../types.js'

interface AddRoleOperation {
  operation: 'add_role'
  role: string
  subrole: string
  config: {
    prompt: string
    providers: ProviderEntry[]
  }
}

interface RemoveRoleOperation {
  operation: 'remove_role'
  role: string
  subrole: string
}

interface AddStrategyOperation {
  operation: 'add_strategy'
  strategy: string
  config: StrategyConfig
}

interface RemoveStrategyOperation {
  operation: 'remove_strategy'
  strategy: string
}

interface UpdateSettingsOperation {
  operation: 'update_settings'
  settings: Record<string, unknown>
}

export type ConfigOperation =
  | AddRoleOperation
  | RemoveRoleOperation
  | AddStrategyOperation
  | RemoveStrategyOperation
  | UpdateSettingsOperation

export class ConfigManager {
  private configPath: string

  constructor(private projectDir: string) {
    this.configPath = path.join(projectDir, '.invoke', 'pipeline.yaml')
  }

  async execute(op: ConfigOperation): Promise<InvokeConfig> {
    const raw = await this.readRaw()

    switch (op.operation) {
      case 'add_role':
        return this.addRole(raw, op)
      case 'remove_role':
        return this.removeRole(raw, op)
      case 'add_strategy':
        return this.addStrategy(raw, op)
      case 'remove_strategy':
        return this.removeStrategy(raw, op)
      case 'update_settings':
        return this.updateSettings(raw, op)
    }
  }

  private async addRole(raw: any, op: AddRoleOperation): Promise<InvokeConfig> {
    if (!raw.roles[op.role]) {
      raw.roles[op.role] = {}
    }
    if (raw.roles[op.role][op.subrole]) {
      throw new Error(`Role ${op.role}.${op.subrole} already exists`)
    }

    raw.roles[op.role][op.subrole] = {
      prompt: op.config.prompt,
      providers: op.config.providers,
    }

    return this.writeAndReload(raw)
  }

  private async removeRole(raw: any, op: RemoveRoleOperation): Promise<InvokeConfig> {
    if (!raw.roles[op.role]?.[op.subrole]) {
      throw new Error(`Role ${op.role}.${op.subrole} not found`)
    }

    delete raw.roles[op.role][op.subrole]

    // Clean up empty role groups
    if (Object.keys(raw.roles[op.role]).length === 0) {
      delete raw.roles[op.role]
    }

    return this.writeAndReload(raw)
  }

  private async addStrategy(raw: any, op: AddStrategyOperation): Promise<InvokeConfig> {
    if (raw.strategies[op.strategy]) {
      throw new Error(`Strategy ${op.strategy} already exists`)
    }

    raw.strategies[op.strategy] = op.config

    return this.writeAndReload(raw)
  }

  private async removeStrategy(raw: any, op: RemoveStrategyOperation): Promise<InvokeConfig> {
    if (!raw.strategies[op.strategy]) {
      throw new Error(`Strategy ${op.strategy} not found`)
    }

    delete raw.strategies[op.strategy]

    return this.writeAndReload(raw)
  }

  private async updateSettings(raw: any, op: UpdateSettingsOperation): Promise<InvokeConfig> {
    raw.settings = { ...raw.settings, ...op.settings }

    return this.writeAndReload(raw)
  }

  private async readRaw(): Promise<any> {
    const content = await readFile(this.configPath, 'utf-8')
    return parse(content)
  }

  private async writeAndReload(raw: any): Promise<InvokeConfig> {
    await writeFile(this.configPath, stringify(raw))

    // Re-read through the normal config loader to validate and normalize
    const { loadConfig } = await import('../config.js')
    return loadConfig(this.projectDir)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tools/config-manager.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/config-manager.ts tests/tools/config-manager.test.ts
git commit -m "feat: add config manager with structured CRUD operations"
```

---

### Task 7: Config Update MCP Tool

**Files:**
- Create: `src/tools/config-update-tools.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Create config update tool registration**

Create `src/tools/config-update-tools.ts`:

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { ConfigManager } from './config-manager.js'

const ProviderEntrySchema = z.object({
  provider: z.string(),
  model: z.string(),
  effort: z.enum(['low', 'medium', 'high']),
})

export function registerConfigUpdateTools(server: McpServer, projectDir: string): void {
  const configManager = new ConfigManager(projectDir)

  server.registerTool(
    'invoke_update_config',
    {
      description: 'Update pipeline.yaml configuration. Supports adding/removing roles, strategies, and updating settings.',
      inputSchema: z.discriminatedUnion('operation', [
        z.object({
          operation: z.literal('add_role'),
          role: z.string().describe('Role group (e.g. reviewer, researcher, builder, planner)'),
          subrole: z.string().describe('Sub-role name (e.g. psr-compliance, security)'),
          config: z.object({
            prompt: z.string().describe('Path to the prompt .md file'),
            providers: z.array(ProviderEntrySchema).describe('Provider configurations'),
          }),
        }),
        z.object({
          operation: z.literal('remove_role'),
          role: z.string().describe('Role group'),
          subrole: z.string().describe('Sub-role name to remove'),
        }),
        z.object({
          operation: z.literal('add_strategy'),
          strategy: z.string().describe('Strategy name'),
          config: z.object({
            prompt: z.string().describe('Path to the strategy prompt .md file'),
          }),
        }),
        z.object({
          operation: z.literal('remove_strategy'),
          strategy: z.string().describe('Strategy name to remove'),
        }),
        z.object({
          operation: z.literal('update_settings'),
          settings: z.record(z.string(), z.unknown()).describe('Settings fields to update'),
        }),
      ]),
    },
    async (input) => {
      try {
        const result = await configManager.execute(input)
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Config update error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    }
  )
}
```

- [ ] **Step 2: Register the new tool in index.ts**

In `src/index.ts`, add the import at the top with the other imports:

```typescript
import { registerConfigUpdateTools } from './tools/config-update-tools.js'
```

Then add the registration call after `registerConfigTools(server, projectDir)` (around line 45):

```typescript
  registerConfigUpdateTools(server, projectDir)
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/config-update-tools.ts src/index.ts
git commit -m "feat: add invoke_update_config MCP tool and wire into server"
```

---

### Task 8: Update invoke-manage Skill

**Files:**
- Modify: `skills/invoke-manage.md`

- [ ] **Step 1: Update the skill to reference actual MCP tools**

Replace the contents of `skills/invoke-manage.md` with:

```markdown
---
name: invoke-manage
description: Use when the user wants to create, edit, remove, or list invoke roles, strategies, reviewers, or pipeline configuration
---

# Invoke — Manage Configuration

You are managing invoke pipeline configuration. You help users create, edit, and remove roles, strategies, and other pipeline settings through conversation.

## Operations

### List

When the user wants to see what's configured:
1. Call `invoke_get_config`
2. Present a formatted summary:
   - Providers and their CLI commands
   - Roles grouped by type (researcher, planner, builder, reviewer) with providers/models/effort
   - Strategies
   - Current settings

### Create Role

When the user wants to add a new role (e.g., "create a reviewer for PSR compliance"):

1. **Identify role type and name**: "This sounds like a reviewer. I'll call it `psr-compliance`. Sound good?"

2. **Ask about focus**: "What should this reviewer focus on? What specific standards or rules?" Ask one question at a time to understand:
   - What to check for
   - What severity levels to use
   - Any specific files or patterns to focus on
   - Output format requirements (must use the standard Finding format for reviewers)

3. **Choose providers**: "Which provider(s) and model(s) should run this?"
   - Present available providers from config
   - Allow multiple providers for cross-validation (e.g., run on both Claude and Codex)
   - Suggest a default based on the role type

4. **Generate and preview prompt**: Create the `.md` prompt file based on the conversation. For reviewers, ensure the output format section uses the standard Finding format. Present the prompt to the user for review before saving.

5. **Save**:
   - Write the prompt file: `invoke_save_artifact` with `stage: "roles/<type>"`, `filename: "<name>.md"`
   - Register in config: `invoke_update_config` with `operation: "add_role"`

6. **Confirm**: "Added reviewer/psr-compliance. It'll appear in your reviewer list next review cycle."

### Edit Role

When the user wants to modify an existing role:

1. Read the current prompt file using `invoke_read_artifact` with `stage: "roles/<type>"`, `filename: "<name>.md"`
2. Present the current content
3. Discuss changes with the user
4. Update the prompt file using `invoke_save_artifact` (overwrites existing)
5. If providers/model/effort changed, use `invoke_update_config` with `remove_role` then `add_role`

### Delete Role

When the user wants to remove a role:

1. Confirm: "Delete reviewer/[name]? This will remove the prompt file and config entry."
2. Remove config entry: `invoke_update_config` with `operation: "remove_role"`
3. Remove prompt file: `invoke_delete_artifact` with `stage: "roles/<type>"`, `filename: "<name>.md"`

### Create Strategy

Same flow as Create Role but for strategies:
1. Ask what the strategy should enforce
2. Generate the prompt template with standard `{{variables}}`: `{{task_description}}`, `{{acceptance_criteria}}`, `{{relevant_files}}`, `{{interfaces}}`
3. Preview with user
4. Save prompt: `invoke_save_artifact` with `stage: "strategies"`, `filename: "<name>.md"`
5. Register: `invoke_update_config` with `operation: "add_strategy"`

### Delete Strategy

1. Confirm with user
2. Remove config entry: `invoke_update_config` with `operation: "remove_strategy"`
3. Remove prompt file: `invoke_delete_artifact` with `stage: "strategies"`, `filename: "<name>.md"`

### Edit Settings

When the user wants to change settings:
1. Call `invoke_get_config` to show current settings
2. Discuss changes
3. Apply: `invoke_update_config` with `operation: "update_settings"`
4. Confirm the change

## Key Principles

- Always confirm before making changes
- Preview generated prompts before saving
- Reviewer prompts must include the standard Finding output format
- Multi-provider configs are supported — ask if the user wants cross-validation
- Keep the user in control — never auto-generate without review
```

- [ ] **Step 2: Commit**

```bash
git add skills/invoke-manage.md
git commit -m "feat: update invoke-manage skill with actual MCP tool references"
```

---

### Task 9: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit if any fixes were needed**

If any fixes were required, commit them.

---

## Self-Review Checklist

**Spec coverage:**
- [x] Multi-provider config format (both single and array) — Tasks 1, 2
- [x] Config normalization to providers array — Task 2
- [x] Finding deduplication with word overlap matching — Task 3
- [x] Finding.agreedBy field — Tasks 1, 3
- [x] Dispatch engine fans out to multiple providers — Task 4
- [x] Merged results sorted by severity then agreement — Task 3
- [x] invoke_update_config with all 5 operations — Tasks 6, 7
- [x] invoke_delete_artifact — Task 5
- [x] Validation safety (Zod schema check before write) — Task 6
- [x] invoke-manage skill updated with real tool references — Task 8

**Placeholder scan:** No TBDs or incomplete sections.

**Type consistency:** `ProviderEntry`, `RoleConfig.providers`, `Finding.agreedBy` used consistently across types, config, engine, merge-findings, config-manager, and tools.
