# Messaging Standards & Test Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add consistent user-facing messaging throughout the invoke pipeline and comprehensive test coverage for CLI dispatching, output parsing, and the full dispatch chain.

**Architecture:** A shared messaging reference skill that all pipeline skills reference for formatting. Integration tests that exercise real code paths (config → provider → prompt → spawn → parse) using fake CLI commands. Separate provider smoke tests for real CLI validation.

**Tech Stack:** Markdown (messaging skill), TypeScript, vitest

**Spec:** This plan addresses two gaps identified in the existing implementation.

---

## File Structure

```
skills/
  invoke-messaging.md               # CREATE — shared messaging format reference

tests/
  integration/
    dispatch-chain.test.ts           # CREATE — full chain without mocks
    cli-spawn.test.ts                # CREATE — real process spawn with fake CLIs
    output-parsing.test.ts           # CREATE — parser integration with real output samples
  smoke/
    claude.smoke.ts                  # CREATE — real Claude CLI validation (manual run)
    codex.smoke.ts                   # CREATE — real Codex CLI validation (manual run)

vitest.config.ts                     # MODIFY — exclude smoke tests from default run
```

---

### Task 1: Messaging Standards Skill

**Files:**
- Create: `skills/invoke-messaging.md`

- [ ] **Step 1: Create the messaging reference**

Create `skills/invoke-messaging.md`:

```markdown
---
name: invoke-messaging
description: Internal reference — do not trigger directly. Defines consistent messaging formats for all invoke pipeline stages.
---

# Invoke — Messaging Standards

All invoke skills must follow these formatting standards when presenting information to the user. Consistency builds trust and makes the pipeline predictable.

## Agent Dispatch

When dispatching agents, always show:

```
🔄 Dispatching [role]/[subrole]
   Provider: [provider] ([model]) | Effort: [effort]
   Prompt: [prompt file path]
```

For multi-provider sub-roles:

```
🔄 Dispatching [role]/[subrole] to [N] providers
   ├─ [provider1] ([model1]) | Effort: [effort1]
   └─ [provider2] ([model2]) | Effort: [effort2]
   Prompt: [prompt file path]
```

For batch dispatches:

```
📦 Dispatching Batch [N] — [X] tasks
   ├─ [task_id] → [role]/[subrole] via [provider] ([model])
   ├─ [task_id] → [role]/[subrole] via [provider] ([model])
   └─ [task_id] → [role]/[subrole] via [provider] ([model])
   Worktrees: [yes/no]
```

## Progress Updates

While agents are working:

```
⏳ Batch [N] progress
   ├─ [task_id]: ✅ completed ([duration]s)
   ├─ [task_id]: 🔄 running ([elapsed]s)
   └─ [task_id]: ⏳ pending
```

## Agent Results — Success

When an agent completes successfully:

```
✅ [role]/[subrole] completed ([duration]s)
   Provider: [provider] ([model])
   Summary: [first 1-2 sentences of output]
```

## Agent Results — Error

When an agent fails:

```
❌ [role]/[subrole] failed ([duration]s)
   Provider: [provider] ([model])
   Error: [error message or exit code]
   Raw output (truncated):
   > [first 5 lines of output]
```

## Agent Results — Timeout

```
⏰ [role]/[subrole] timed out after [timeout]ms
   Provider: [provider] ([model])
```

## Review Findings

Present findings grouped by reviewer, sorted by severity:

```
📋 Review Results — [N] findings from [M] reviewers

### [Reviewer Name] ([provider])

| # | Severity | File | Line | Issue |
|---|----------|------|------|-------|
| 1 | 🔴 HIGH | src/auth/token.ts | 42 | SQL injection in query param |
| 2 | 🟡 MEDIUM | src/auth/session.ts | 15 | Session token in localStorage |
| 3 | 🟢 LOW | src/api/handler.ts | 88 | Verbose error messages |
```

When multiple providers agree on a finding:

```
| 1 | 🔴 HIGH | src/auth/token.ts | 42 | SQL injection (**agreed: claude, codex**) |
```

## Triage Prompt

```
📝 Triage findings — accept (a) or dismiss (d) each:

  1. [HIGH] SQL injection in src/auth/token.ts:42
     → Suggestion: Use parameterized queries
     [a/d]:

  2. [MEDIUM] Session token in localStorage src/auth/session.ts:15
     → Suggestion: Use HttpOnly cookies
     [a/d]:

  Or: accept all (aa), dismiss all (dd), accept all from [reviewer] (a:security)
```

## Pipeline Stage Transitions

When moving between stages:

```
──────────────────────────────────────
✅ [Stage] complete
➡️  Moving to [Next Stage]
──────────────────────────────────────
```

## Pipeline Status (Resume)

```
📊 Invoke Pipeline Status
   ├─ Pipeline: [id]
   ├─ Started: [date]
   ├─ Stage: [current_stage]
   ├─ Spec: [spec path or "not yet"]
   ├─ Plan: [plan path or "not yet"]
   ├─ Strategy: [strategy or "not set"]
   ├─ Batches: [N completed] / [M total]
   └─ Work Branch: [branch or "not created"]
```

## Commit Strategy Selection

```
📦 Pipeline complete — choose commit style:

  1. One commit (squash all changes)
  2. Per batch ([N] commits):
     ├─ "feat: [batch 1 description]"
     ├─ "feat: [batch 2 description]"
     └─ "feat: [batch 3 description]"
  3. Per task ([N] commits)
  4. Custom grouping
```

## Selection Prompts

When asking the user to select from configured items:

```
🔧 Available [role type]:
   ├─ [1] [subrole] — [provider] ([model]) | Effort: [effort]
   ├─ [2] [subrole] — [provider1]+[provider2] | Effort: [effort]
   └─ [3] [subrole] — [provider] ([model]) | Effort: [effort]

   Select (comma-separated, or 'all'): 
```

## Error Recovery

```
⚠️  [task_id] failed — [brief error]
   Options:
   ├─ [r] Retry
   ├─ [s] Skip this task
   └─ [a] Abort batch
```

## Rules

1. Always show provider and model when dispatching or reporting results
2. Always show duration for completed agents
3. Use the severity emoji mapping: 🔴 critical/high, 🟡 medium, 🟢 low
4. Truncate raw output to 5 lines in error reports — offer full output on request
5. Use tree-style (├─ └─) for hierarchical information
6. Keep progress updates on one screen — don't flood with per-second updates
7. Bold the provider agreement indicator (**agreed: claude, codex**) in findings
```

- [ ] **Step 2: Commit**

```bash
git add skills/invoke-messaging.md
git commit -m "feat: add shared messaging standards for invoke pipeline"
```

---

### Task 2: Update All Skills to Reference Messaging Standards

**Files:**
- Modify: `skills/invoke-scope.md`
- Modify: `skills/invoke-plan.md`
- Modify: `skills/invoke-orchestrate.md`
- Modify: `skills/invoke-build.md`
- Modify: `skills/invoke-review.md`
- Modify: `skills/invoke-resume.md`

Each skill needs a brief directive added near the top, after the frontmatter description section. Add this block after the `# Invoke — [Stage]` heading and before the `## Flow` section:

```markdown
## Messaging

Follow the formatting standards in `invoke-messaging.md` for all user-facing output — agent dispatches, progress updates, results, errors, and selection prompts.
```

- [ ] **Step 1: Add messaging directive to all 6 skills**

Add the messaging section to each skill file, right after the main heading and description paragraph, before `## Flow`.

For `invoke-scope.md`, after "Your job is to produce a clear, validated spec..." add:

```markdown

## Messaging

Follow the formatting standards in `invoke-messaging.md` for all user-facing output — agent dispatches, progress updates, results, errors, and selection prompts.
```

Repeat for all 6 skill files (scope, plan, orchestrate, build, review, resume).

- [ ] **Step 2: Commit**

```bash
git add skills/
git commit -m "feat: add messaging standards reference to all pipeline skills"
```

---

### Task 3: Exclude Smoke Tests from Default Run

**Files:**
- Modify: `vitest.config.ts`

- [ ] **Step 1: Update vitest config to exclude smoke tests**

Replace `vitest.config.ts` with:

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    root: '.',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/smoke/**'],
  },
})
```

- [ ] **Step 2: Verify existing tests still run**

Run: `npx vitest run`
Expected: All tests PASS (same count as before)

- [ ] **Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "chore: exclude smoke tests from default vitest run"
```

---

### Task 4: Dispatch Chain Integration Test

**Files:**
- Create: `tests/integration/dispatch-chain.test.ts`

Tests the real code path: config load → role lookup → prompt compose → provider.buildCommand → parser.parse — without mocking intermediate layers. Only the actual process spawn is avoided.

- [ ] **Step 1: Write the integration test**

Create `tests/integration/dispatch-chain.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig } from '../../src/config.js'
import { createProviderRegistry } from '../../src/providers/registry.js'
import { createParserRegistry } from '../../src/parsers/registry.js'
import { composePrompt } from '../../src/dispatch/prompt-composer.js'
import { mkdir, writeFile, rm } from 'fs/promises'
import path from 'path'

const TEST_DIR = path.join(import.meta.dirname, 'fixtures', 'dispatch-chain-test')

beforeEach(async () => {
  // Set up a complete .invoke directory with config and prompt files
  await mkdir(path.join(TEST_DIR, '.invoke', 'roles', 'reviewer'), { recursive: true })
  await mkdir(path.join(TEST_DIR, '.invoke', 'roles', 'researcher'), { recursive: true })
  await mkdir(path.join(TEST_DIR, '.invoke', 'strategies'), { recursive: true })

  // Config with both single and multi-provider roles
  const config = `
providers:
  claude:
    cli: claude
    args: ["--print", "--model", "{{model}}"]
  codex:
    cli: codex
    args: ["--model", "{{model}}", "--reasoning-effort", "{{effort}}"]

roles:
  researcher:
    codebase:
      prompt: .invoke/roles/researcher/codebase.md
      provider: claude
      model: opus-4.6
      effort: high
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
  await writeFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), config)

  // Prompt templates
  await writeFile(
    path.join(TEST_DIR, '.invoke', 'roles', 'reviewer', 'security.md'),
    '# Security Review\n\n## Task\n{{task_description}}\n\n## Diff\n{{diff}}\n\nReview for vulnerabilities.'
  )
  await writeFile(
    path.join(TEST_DIR, '.invoke', 'roles', 'researcher', 'codebase.md'),
    '# Codebase Research\n\n## Task\n{{task_description}}\n\nAnalyze the codebase.'
  )
  await writeFile(
    path.join(TEST_DIR, '.invoke', 'strategies', 'tdd.md'),
    '# TDD\n\nWrite tests first.'
  )
})

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('Dispatch Chain Integration', () => {
  it('loads config with single-provider role and normalizes to providers array', async () => {
    const config = await loadConfig(TEST_DIR)

    expect(config.roles.researcher.codebase.providers).toHaveLength(1)
    expect(config.roles.researcher.codebase.providers[0].provider).toBe('claude')
  })

  it('loads config with multi-provider role', async () => {
    const config = await loadConfig(TEST_DIR)

    expect(config.roles.reviewer.security.providers).toHaveLength(2)
    expect(config.roles.reviewer.security.providers[0].provider).toBe('claude')
    expect(config.roles.reviewer.security.providers[1].provider).toBe('codex')
  })

  it('creates provider registry from config', async () => {
    const config = await loadConfig(TEST_DIR)
    const providers = createProviderRegistry(config.providers)

    expect(providers.get('claude')).toBeTruthy()
    expect(providers.get('codex')).toBeTruthy()
  })

  it('builds correct CLI command for Claude', async () => {
    const config = await loadConfig(TEST_DIR)
    const providers = createProviderRegistry(config.providers)
    const claude = providers.get('claude')!

    const entry = config.roles.researcher.codebase.providers[0]
    const cmd = claude.buildCommand({
      model: entry.model,
      effort: entry.effort,
      workDir: '/tmp/worktree',
      prompt: 'Test prompt',
    })

    expect(cmd.cmd).toBe('claude')
    expect(cmd.args).toContain('--print')
    expect(cmd.args).toContain('--model')
    expect(cmd.args).toContain('opus-4.6')
    expect(cmd.args).toContain('--directory')
    expect(cmd.args).toContain('/tmp/worktree')
    expect(cmd.args[cmd.args.length - 1]).toBe('Test prompt')
  })

  it('builds correct CLI command for Codex', async () => {
    const config = await loadConfig(TEST_DIR)
    const providers = createProviderRegistry(config.providers)
    const codex = providers.get('codex')!

    const entry = config.roles.reviewer.security.providers[1]
    const cmd = codex.buildCommand({
      model: entry.model,
      effort: entry.effort,
      workDir: '/tmp/worktree',
      prompt: 'Review prompt',
    })

    expect(cmd.cmd).toBe('codex')
    expect(cmd.args).toContain('--model')
    expect(cmd.args).toContain('gpt-5.4')
    expect(cmd.args).toContain('--reasoning-effort')
    expect(cmd.args).toContain('high')
    expect(cmd.args).toContain('-C')
    expect(cmd.args).toContain('/tmp/worktree')
    expect(cmd.args[cmd.args.length - 1]).toBe('Review prompt')
  })

  it('composes prompt with template variables injected', async () => {
    const prompt = await composePrompt({
      projectDir: TEST_DIR,
      promptPath: '.invoke/roles/reviewer/security.md',
      taskContext: {
        task_description: 'Review auth module',
        diff: '+ new code here',
      },
    })

    expect(prompt).toContain('Review auth module')
    expect(prompt).toContain('+ new code here')
    expect(prompt).not.toContain('{{task_description}}')
    expect(prompt).not.toContain('{{diff}}')
    expect(prompt).toContain('Review for vulnerabilities.')
  })

  it('composes prompt with strategy appended', async () => {
    const prompt = await composePrompt({
      projectDir: TEST_DIR,
      promptPath: '.invoke/roles/researcher/codebase.md',
      strategyPath: '.invoke/strategies/tdd.md',
      taskContext: {
        task_description: 'Analyze the auth system',
      },
    })

    expect(prompt).toContain('Analyze the auth system')
    expect(prompt).toContain('Write tests first.')
  })

  it('parsers produce correct AgentResult shape from reviewer output', () => {
    const parsers = createParserRegistry()
    const claude = parsers.get('claude')!

    const reviewOutput = `## Security Review

### Finding 1
**Severity:** high
**File:** src/auth/token.ts
**Line:** 42
**Issue:** SQL injection in query
**Suggestion:** Use parameterized queries

### Finding 2
**Severity:** medium
**File:** src/auth/session.ts
**Line:** 15
**Issue:** Token stored in localStorage
**Suggestion:** Use HttpOnly cookies`

    const result = claude.parse(reviewOutput, 0, {
      role: 'reviewer',
      subrole: 'security',
      provider: 'claude',
      model: 'opus-4.6',
      duration: 5000,
    })

    expect(result.status).toBe('success')
    expect(result.role).toBe('reviewer')
    expect(result.output.findings).toHaveLength(2)
    expect(result.output.findings![0].severity).toBe('high')
    expect(result.output.findings![0].file).toBe('src/auth/token.ts')
    expect(result.output.findings![0].line).toBe(42)
    expect(result.output.findings![1].severity).toBe('medium')
  })

  it('parsers produce correct AgentResult shape from researcher output', () => {
    const parsers = createParserRegistry()
    const claude = parsers.get('claude')!

    const researchOutput = 'The codebase uses Express with TypeScript.\n\nKey modules: auth, api, db.'

    const result = claude.parse(researchOutput, 0, {
      role: 'researcher',
      subrole: 'codebase',
      provider: 'claude',
      model: 'opus-4.6',
      duration: 3000,
    })

    expect(result.status).toBe('success')
    expect(result.output.report).toBe(researchOutput)
    expect(result.output.findings).toBeUndefined()
  })

  it('parsers handle error exit codes', () => {
    const parsers = createParserRegistry()
    const codex = parsers.get('codex')!

    const result = codex.parse('Something broke', 1, {
      role: 'builder',
      subrole: 'default',
      provider: 'codex',
      model: 'gpt-5.4',
      duration: 1000,
    })

    expect(result.status).toBe('error')
    expect(result.output.raw).toBe('Something broke')
  })

  it('full chain: config → role lookup → compose → command → parse', async () => {
    const config = await loadConfig(TEST_DIR)
    const providers = createProviderRegistry(config.providers)
    const parsers = createParserRegistry()

    // Look up role
    const roleConfig = config.roles.reviewer.security
    expect(roleConfig).toBeTruthy()
    expect(roleConfig.providers).toHaveLength(2)

    // Compose prompt
    const prompt = await composePrompt({
      projectDir: TEST_DIR,
      promptPath: roleConfig.prompt,
      taskContext: { task_description: 'Review login flow', diff: 'code changes' },
    })
    expect(prompt).toContain('Review login flow')

    // Build commands for each provider
    for (const entry of roleConfig.providers) {
      const provider = providers.get(entry.provider)!
      const cmd = provider.buildCommand({
        model: entry.model,
        effort: entry.effort,
        workDir: '/tmp/wt',
        prompt,
      })
      expect(cmd.cmd).toBeTruthy()
      expect(cmd.args.length).toBeGreaterThan(0)
      expect(cmd.args[cmd.args.length - 1]).toBe(prompt)

      // Parse a simulated result
      const parser = parsers.get(entry.provider)!
      const result = parser.parse('No issues found.', 0, {
        role: 'reviewer',
        subrole: 'security',
        provider: entry.provider,
        model: entry.model,
        duration: 2000,
      })
      expect(result.status).toBe('success')
      expect(result.provider).toBe(entry.provider)
    }
  })
})
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/integration/dispatch-chain.test.ts`
Expected: All 11 tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/dispatch-chain.test.ts
git commit -m "test: add dispatch chain integration tests"
```

---

### Task 5: CLI Spawn Integration Test

**Files:**
- Create: `tests/integration/cli-spawn.test.ts`

Tests real process spawning using `echo` and `cat` as fake CLI providers.

- [ ] **Step 1: Write the test**

Create `tests/integration/cli-spawn.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DispatchEngine } from '../../src/dispatch/engine.js'
import { createParserRegistry } from '../../src/parsers/registry.js'
import type { InvokeConfig } from '../../src/types.js'
import type { Provider, CommandSpec } from '../../src/providers/base.js'
import { mkdir, writeFile, rm } from 'fs/promises'
import path from 'path'

const TEST_DIR = path.join(import.meta.dirname, 'fixtures', 'cli-spawn-test')

// A provider that uses 'echo' as a fake CLI
class EchoProvider implements Provider {
  name = 'echo'

  buildCommand(params: {
    model: string
    effort: string
    workDir: string
    prompt: string
  }): CommandSpec {
    return {
      cmd: 'echo',
      args: [params.prompt],
    }
  }
}

// A provider that uses a shell command to simulate structured reviewer output
class FakeReviewerProvider implements Provider {
  name = 'fake-reviewer'

  buildCommand(params: {
    model: string
    effort: string
    workDir: string
    prompt: string
  }): CommandSpec {
    const output = [
      '## Security Review',
      '',
      '### Finding 1',
      '**Severity:** high',
      '**File:** src/auth.ts',
      '**Line:** 10',
      '**Issue:** Hardcoded secret',
      '**Suggestion:** Use environment variables',
    ].join('\n')

    return {
      cmd: 'printf',
      args: ['%s', output],
    }
  }
}

// A provider that exits with an error
class FailingProvider implements Provider {
  name = 'failing'

  buildCommand(): CommandSpec {
    return {
      cmd: 'sh',
      args: ['-c', 'echo "error output" && exit 1'],
    }
  }
}

beforeEach(async () => {
  await mkdir(path.join(TEST_DIR, '.invoke', 'roles', 'researcher'), { recursive: true })
  await mkdir(path.join(TEST_DIR, '.invoke', 'roles', 'reviewer'), { recursive: true })

  await writeFile(
    path.join(TEST_DIR, '.invoke', 'roles', 'researcher', 'codebase.md'),
    '# Research\n\n## Task\n{{task_description}}\n\nAnalyze.'
  )
  await writeFile(
    path.join(TEST_DIR, '.invoke', 'roles', 'reviewer', 'security.md'),
    '# Review\n\n## Task\n{{task_description}}\n\nCheck security.'
  )
})

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('CLI Spawn Integration', () => {
  it('spawns a real process and captures stdout', async () => {
    const config: InvokeConfig = {
      providers: { echo: { cli: 'echo', args: [] } },
      roles: {
        researcher: {
          codebase: {
            prompt: '.invoke/roles/researcher/codebase.md',
            providers: [{ provider: 'echo', model: 'test', effort: 'high' }],
          },
        },
      },
      strategies: {},
      settings: { default_strategy: 'tdd', agent_timeout: 10000, commit_style: 'per-batch', work_branch_prefix: 'invoke/work' },
    }

    const providers = new Map([['echo', new EchoProvider()]])
    const parsers = createParserRegistry()
    // Use claude parser for echo output (it handles any text)
    parsers.set('echo', parsers.get('claude')!)

    const engine = new DispatchEngine({ config, providers, parsers, projectDir: TEST_DIR })

    const result = await engine.dispatch({
      role: 'researcher',
      subrole: 'codebase',
      taskContext: { task_description: 'Test dispatch' },
    })

    expect(result.status).toBe('success')
    expect(result.output.raw).toBeTruthy()
    expect(result.duration).toBeGreaterThan(0)
  })

  it('spawns a process that produces parseable reviewer output', async () => {
    const config: InvokeConfig = {
      providers: { 'fake-reviewer': { cli: 'printf', args: [] } },
      roles: {
        reviewer: {
          security: {
            prompt: '.invoke/roles/reviewer/security.md',
            providers: [{ provider: 'fake-reviewer', model: 'test', effort: 'high' }],
          },
        },
      },
      strategies: {},
      settings: { default_strategy: 'tdd', agent_timeout: 10000, commit_style: 'per-batch', work_branch_prefix: 'invoke/work' },
    }

    const providers = new Map([['fake-reviewer', new FakeReviewerProvider()]])
    const parsers = createParserRegistry()
    parsers.set('fake-reviewer', parsers.get('claude')!)

    const engine = new DispatchEngine({ config, providers, parsers, projectDir: TEST_DIR })

    const result = await engine.dispatch({
      role: 'reviewer',
      subrole: 'security',
      taskContext: { task_description: 'Review auth' },
    })

    expect(result.status).toBe('success')
    expect(result.output.findings).toBeTruthy()
    expect(result.output.findings!.length).toBeGreaterThan(0)
    expect(result.output.findings![0].severity).toBe('high')
    expect(result.output.findings![0].file).toBe('src/auth.ts')
    expect(result.output.findings![0].line).toBe(10)
  })

  it('handles process exit with non-zero code', async () => {
    const config: InvokeConfig = {
      providers: { failing: { cli: 'sh', args: [] } },
      roles: {
        builder: {
          default: {
            prompt: '.invoke/roles/researcher/codebase.md',
            providers: [{ provider: 'failing', model: 'test', effort: 'high' }],
          },
        },
      },
      strategies: {},
      settings: { default_strategy: 'tdd', agent_timeout: 10000, commit_style: 'per-batch', work_branch_prefix: 'invoke/work' },
    }

    const providers = new Map([['failing', new FailingProvider()]])
    const parsers = createParserRegistry()
    parsers.set('failing', parsers.get('claude')!)

    const engine = new DispatchEngine({ config, providers, parsers, projectDir: TEST_DIR })

    const result = await engine.dispatch({
      role: 'builder',
      subrole: 'default',
      taskContext: {},
    })

    expect(result.status).toBe('error')
    expect(result.output.raw).toContain('error output')
  })

  it('respects timeout and kills long-running processes', async () => {
    const config: InvokeConfig = {
      providers: { slow: { cli: 'sleep', args: [] } },
      roles: {
        researcher: {
          codebase: {
            prompt: '.invoke/roles/researcher/codebase.md',
            providers: [{ provider: 'slow', model: 'test', effort: 'high' }],
          },
        },
      },
      strategies: {},
      settings: { default_strategy: 'tdd', agent_timeout: 500, commit_style: 'per-batch', work_branch_prefix: 'invoke/work' },
    }

    // Provider that runs sleep 10 (will be killed by timeout)
    const sleepProvider: Provider = {
      name: 'slow',
      buildCommand: () => ({ cmd: 'sleep', args: ['10'] }),
    }

    const providers = new Map([['slow', sleepProvider]])
    const parsers = createParserRegistry()
    parsers.set('slow', parsers.get('claude')!)

    const engine = new DispatchEngine({ config, providers, parsers, projectDir: TEST_DIR })

    const start = Date.now()
    const result = await engine.dispatch({
      role: 'researcher',
      subrole: 'codebase',
      taskContext: { task_description: 'test' },
    })
    const elapsed = Date.now() - start

    // Should have been killed well before 10 seconds
    expect(elapsed).toBeLessThan(3000)
    expect(result.status).toBe('error')
  }, 10000)
})
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/integration/cli-spawn.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/cli-spawn.test.ts
git commit -m "test: add CLI spawn integration tests with real processes"
```

---

### Task 6: Output Parsing Integration Test

**Files:**
- Create: `tests/integration/output-parsing.test.ts`

Tests parsers against realistic output samples from different providers and roles.

- [ ] **Step 1: Write the test**

Create `tests/integration/output-parsing.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { createParserRegistry } from '../../src/parsers/registry.js'
import { mergeFindings } from '../../src/dispatch/merge-findings.js'

describe('Output Parsing Integration', () => {
  const parsers = createParserRegistry()

  describe('Claude parser with realistic outputs', () => {
    const claude = parsers.get('claude')!

    it('parses a multi-finding security review', () => {
      const output = `## Security Review

I've reviewed the authentication module. Here are my findings:

### Finding 1
**Severity:** critical
**File:** src/auth/login.ts
**Line:** 23
**Issue:** Password compared using === instead of constant-time comparison, vulnerable to timing attacks
**Suggestion:** Use crypto.timingSafeEqual() for password comparison

### Finding 2
**Severity:** high
**File:** src/auth/token.ts
**Line:** 45
**Issue:** JWT secret is hardcoded in the source file
**Suggestion:** Load JWT_SECRET from environment variables using process.env

### Finding 3
**Severity:** medium
**File:** src/auth/session.ts
**Line:** 12
**Issue:** Session cookies missing HttpOnly and Secure flags
**Suggestion:** Set { httpOnly: true, secure: true, sameSite: 'strict' } on cookie options

### Finding 4
**Severity:** low
**File:** src/auth/login.ts
**Line:** 78
**Issue:** Login error message reveals whether email exists in system
**Suggestion:** Use generic "Invalid credentials" message for both invalid email and password`

      const result = claude.parse(output, 0, {
        role: 'reviewer', subrole: 'security', provider: 'claude', model: 'opus-4.6', duration: 15000,
      })

      expect(result.status).toBe('success')
      expect(result.output.findings).toHaveLength(4)
      expect(result.output.findings![0].severity).toBe('critical')
      expect(result.output.findings![0].issue).toContain('timing attacks')
      expect(result.output.findings![1].severity).toBe('high')
      expect(result.output.findings![2].severity).toBe('medium')
      expect(result.output.findings![3].severity).toBe('low')
    })

    it('parses a clean review with no findings', () => {
      const output = `## Security Review

I've thoroughly reviewed the codebase and found no security vulnerabilities.

The authentication system follows best practices:
- Uses bcrypt for password hashing
- JWT tokens have appropriate expiration
- CORS is properly configured`

      const result = claude.parse(output, 0, {
        role: 'reviewer', subrole: 'security', provider: 'claude', model: 'opus-4.6', duration: 8000,
      })

      expect(result.status).toBe('success')
      expect(result.output.findings).toEqual([])
    })

    it('parses a researcher report', () => {
      const output = `# Codebase Analysis

## Architecture
The project uses a layered architecture with Express.js.

## Key Files
- src/routes/auth.ts — authentication endpoints
- src/middleware/auth.ts — JWT validation middleware
- src/models/user.ts — User model with Prisma

## Patterns
- Repository pattern for data access
- Middleware chain for request validation
- Error handling via express-async-errors`

      const result = claude.parse(output, 0, {
        role: 'researcher', subrole: 'codebase', provider: 'claude', model: 'opus-4.6', duration: 12000,
      })

      expect(result.status).toBe('success')
      expect(result.output.report).toBe(output)
      expect(result.output.findings).toBeUndefined()
    })
  })

  describe('Codex parser with realistic outputs', () => {
    const codex = parsers.get('codex')!

    it('parses findings from Codex output', () => {
      const output = `## Code Quality Review

### Finding 1
**Severity:** high
**File:** src/utils/validate.ts
**Line:** 34
**Issue:** Function has cyclomatic complexity of 15, making it hard to test and maintain
**Suggestion:** Break into smaller functions, each handling one validation rule

### Finding 2
**Severity:** medium
**File:** src/api/users.ts
**Line:** 89
**Issue:** Duplicate validation logic — same email regex appears in 3 places
**Suggestion:** Extract into a shared validateEmail utility`

      const result = codex.parse(output, 0, {
        role: 'reviewer', subrole: 'code-quality', provider: 'codex', model: 'gpt-5.4', duration: 20000,
      })

      expect(result.status).toBe('success')
      expect(result.output.findings).toHaveLength(2)
      expect(result.output.findings![0].file).toBe('src/utils/validate.ts')
      expect(result.output.findings![1].issue).toContain('Duplicate validation')
    })
  })

  describe('Multi-provider merge with realistic data', () => {
    it('merges overlapping findings from Claude and Codex', () => {
      const claude = parsers.get('claude')!
      const codex = parsers.get('codex')!

      // Both find the same SQL injection
      const claudeOutput = `## Review
### Finding 1
**Severity:** high
**File:** src/db/query.ts
**Line:** 42
**Issue:** SQL injection vulnerability in user search query
**Suggestion:** Use parameterized queries

### Finding 2
**Severity:** medium
**File:** src/api/handler.ts
**Line:** 15
**Issue:** Error stack traces exposed to client
**Suggestion:** Sanitize error responses in production`

      const codexOutput = `## Review
### Finding 1
**Severity:** high
**File:** src/db/query.ts
**Line:** 42
**Issue:** SQL injection in user search — unsanitized input concatenated into query string
**Suggestion:** Use prepared statements with parameter binding

### Finding 2
**Severity:** low
**File:** src/config.ts
**Line:** 5
**Issue:** Debug mode enabled by default
**Suggestion:** Set debug to false in production config`

      const claudeResult = claude.parse(claudeOutput, 0, {
        role: 'reviewer', subrole: 'security', provider: 'claude', model: 'opus-4.6', duration: 10000,
      })
      const codexResult = codex.parse(codexOutput, 0, {
        role: 'reviewer', subrole: 'security', provider: 'codex', model: 'gpt-5.4', duration: 12000,
      })

      const merged = mergeFindings([
        { provider: 'claude', findings: claudeResult.output.findings! },
        { provider: 'codex', findings: codexResult.output.findings! },
      ])

      // SQL injection should be merged (same file + same line)
      const sqlFinding = merged.find(f => f.file === 'src/db/query.ts')
      expect(sqlFinding).toBeTruthy()
      expect(sqlFinding!.agreedBy).toEqual(['claude', 'codex'])

      // Other findings should be unique
      const errorFinding = merged.find(f => f.file === 'src/api/handler.ts')
      expect(errorFinding).toBeTruthy()
      expect(errorFinding!.agreedBy).toEqual(['claude'])

      const debugFinding = merged.find(f => f.file === 'src/config.ts')
      expect(debugFinding).toBeTruthy()
      expect(debugFinding!.agreedBy).toEqual(['codex'])

      // Total: 3 unique findings (1 merged + 2 unique)
      expect(merged).toHaveLength(3)

      // Sorted: high (agreed) first, then medium, then low
      expect(merged[0].severity).toBe('high')
      expect(merged[0].agreedBy).toHaveLength(2)
    })
  })
})
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/integration/output-parsing.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/output-parsing.test.ts
git commit -m "test: add output parsing integration tests with realistic samples"
```

---

### Task 7: Provider Smoke Tests

**Files:**
- Create: `tests/smoke/claude.smoke.ts`
- Create: `tests/smoke/codex.smoke.ts`
- Create: `tests/smoke/README.md`

These are NOT `.test.ts` files — they won't run in the default test suite. Run them manually:
```bash
npx vitest run tests/smoke/claude.smoke.ts
npx vitest run tests/smoke/codex.smoke.ts
```

- [ ] **Step 1: Create the README**

Create `tests/smoke/README.md`:

```markdown
# Provider Smoke Tests

These tests validate that real CLI tools work as expected with invoke's provider system.

**These are NOT run as part of the default test suite.** Run them manually when:
- Adding a new provider
- After a CLI tool updates
- When debugging dispatch issues

## Prerequisites

- `claude` CLI installed and authenticated
- `codex` CLI installed and authenticated

## Running

```bash
# Run individual provider tests
npx vitest run tests/smoke/claude.smoke.ts
npx vitest run tests/smoke/codex.smoke.ts

# Run all smoke tests
npx vitest run tests/smoke/
```

## What They Test

- CLI accepts the args we build
- Output comes back on stdout
- Output is parseable by our parsers
- Worktree-based dispatch works (agent can read/write in a worktree directory)
```

- [ ] **Step 2: Create Claude smoke test**

Create `tests/smoke/claude.smoke.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { ClaudeProvider } from '../../src/providers/claude.js'
import { ClaudeParser } from '../../src/parsers/claude-parser.js'
import { execSync, spawn } from 'child_process'

// Check if claude CLI is available
let cliAvailable = false
try {
  execSync('which claude', { stdio: 'pipe' })
  cliAvailable = true
} catch {
  cliAvailable = false
}

describe.skipIf(!cliAvailable)('Claude CLI Smoke Tests', () => {
  const provider = new ClaudeProvider({
    cli: 'claude',
    args: ['--print', '--model', '{{model}}'],
  })
  const parser = new ClaudeParser()

  it('accepts --print and --model flags', () => {
    const cmd = provider.buildCommand({
      model: 'sonnet-4.6',
      effort: 'low',
      workDir: process.cwd(),
      prompt: 'Respond with exactly: SMOKE_TEST_OK',
    })

    expect(cmd.cmd).toBe('claude')
    expect(cmd.args).toContain('--print')
    expect(cmd.args).toContain('--model')
    expect(cmd.args).toContain('sonnet-4.6')
  })

  it('responds to a simple prompt via --print', async () => {
    const cmd = provider.buildCommand({
      model: 'haiku-4.5',
      effort: 'low',
      workDir: process.cwd(),
      prompt: 'Respond with exactly one word: HELLO',
    })

    const output = await runCommand(cmd.cmd, cmd.args, 30000)

    expect(output.exitCode).toBe(0)
    expect(output.stdout.length).toBeGreaterThan(0)
  }, 60000)

  it('output is parseable by ClaudeParser', async () => {
    const cmd = provider.buildCommand({
      model: 'haiku-4.5',
      effort: 'low',
      workDir: process.cwd(),
      prompt: 'Respond with: "Analysis complete. No issues found."',
    })

    const output = await runCommand(cmd.cmd, cmd.args, 30000)

    const result = parser.parse(output.stdout, output.exitCode, {
      role: 'researcher',
      subrole: 'codebase',
      provider: 'claude',
      model: 'haiku-4.5',
      duration: 5000,
    })

    expect(result.status).toBe('success')
    expect(result.output.summary).toBeTruthy()
  }, 60000)

  it('accepts --directory flag', () => {
    const cmd = provider.buildCommand({
      model: 'haiku-4.5',
      effort: 'low',
      workDir: '/tmp',
      prompt: 'test',
    })

    expect(cmd.args).toContain('--directory')
    expect(cmd.args).toContain('/tmp')
  })
})

function runCommand(cmd: string, args: string[], timeout: number): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })

    let stdout = ''
    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString() })
    proc.stderr.on('data', () => {})

    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      resolve({ stdout, exitCode: -1 })
    }, timeout)

    proc.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, exitCode: code ?? 1 })
    })

    proc.on('error', reject)
  })
}
```

- [ ] **Step 3: Create Codex smoke test**

Create `tests/smoke/codex.smoke.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { CodexProvider } from '../../src/providers/codex.js'
import { CodexParser } from '../../src/parsers/codex-parser.js'
import { execSync, spawn } from 'child_process'

// Check if codex CLI is available
let cliAvailable = false
try {
  execSync('which codex', { stdio: 'pipe' })
  cliAvailable = true
} catch {
  cliAvailable = false
}

describe.skipIf(!cliAvailable)('Codex CLI Smoke Tests', () => {
  const provider = new CodexProvider({
    cli: 'codex',
    args: ['--model', '{{model}}', '--reasoning-effort', '{{effort}}'],
  })
  const parser = new CodexParser()

  it('accepts --model and --reasoning-effort flags', () => {
    const cmd = provider.buildCommand({
      model: 'gpt-5.4',
      effort: 'low',
      workDir: process.cwd(),
      prompt: 'Respond with exactly: SMOKE_TEST_OK',
    })

    expect(cmd.cmd).toBe('codex')
    expect(cmd.args).toContain('--model')
    expect(cmd.args).toContain('gpt-5.4')
    expect(cmd.args).toContain('--reasoning-effort')
    expect(cmd.args).toContain('low')
  })

  it('accepts -C flag for working directory', () => {
    const cmd = provider.buildCommand({
      model: 'gpt-5.4',
      effort: 'low',
      workDir: '/tmp',
      prompt: 'test',
    })

    expect(cmd.args).toContain('-C')
    expect(cmd.args).toContain('/tmp')
  })

  it('responds to a simple prompt', async () => {
    const cmd = provider.buildCommand({
      model: 'gpt-5.4',
      effort: 'low',
      workDir: process.cwd(),
      prompt: 'Respond with exactly one word: HELLO',
    })

    const output = await runCommand(cmd.cmd, cmd.args, 30000)

    expect(output.exitCode).toBe(0)
    expect(output.stdout.length).toBeGreaterThan(0)
  }, 60000)

  it('output is parseable by CodexParser', async () => {
    const cmd = provider.buildCommand({
      model: 'gpt-5.4',
      effort: 'low',
      workDir: process.cwd(),
      prompt: 'Respond with: "Analysis complete. No issues found."',
    })

    const output = await runCommand(cmd.cmd, cmd.args, 30000)

    const result = parser.parse(output.stdout, output.exitCode, {
      role: 'researcher',
      subrole: 'codebase',
      provider: 'codex',
      model: 'gpt-5.4',
      duration: 5000,
    })

    expect(result.status).toBe('success')
    expect(result.output.summary).toBeTruthy()
  }, 60000)
})

function runCommand(cmd: string, args: string[], timeout: number): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })

    let stdout = ''
    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString() })
    proc.stderr.on('data', () => {})

    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      resolve({ stdout, exitCode: -1 })
    }, timeout)

    proc.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, exitCode: code ?? 1 })
    })

    proc.on('error', reject)
  })
}
```

- [ ] **Step 4: Verify smoke tests are excluded from default run**

Run: `npx vitest run`
Expected: All tests PASS, smoke tests NOT included

- [ ] **Step 5: Commit**

```bash
git add tests/smoke/
git commit -m "test: add provider smoke tests for Claude and Codex CLIs"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS (smoke tests excluded)

- [ ] **Step 2: Verify TypeScript build**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Count total tests**

Run: `npx vitest run` and note the count.

- [ ] **Step 4: Commit if any fixes needed**

---

## Self-Review Checklist

**Coverage:**
- [x] Messaging standards — Task 1
- [x] All skills reference messaging — Task 2
- [x] Dispatch chain integration (config → role → compose → command → parse) — Task 4
- [x] CLI spawn with real processes (echo, printf, exit 1, timeout) — Task 5
- [x] Output parsing with realistic samples — Task 6
- [x] Multi-provider merge with realistic data — Task 6
- [x] Provider smoke tests (Claude + Codex) — Task 7
- [x] Smoke tests excluded from default run — Task 3

**Placeholder scan:** No TBDs or incomplete sections.

**Type consistency:** All tests use the current `providers: ProviderEntry[]` shape on RoleConfig.
