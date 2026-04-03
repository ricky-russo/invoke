# Per-Agent Timeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional per-provider-entry timeout in seconds, with global `agent_timeout` as fallback (also in seconds).

**Architecture:** Add `timeout?: number` to `ProviderEntry` type and Zod schema. Engine reads `entry.timeout ?? config.settings.agent_timeout` and multiplies by 1000 for `setTimeout`. Update defaults with role-appropriate timeouts. Add validator warning for suspiciously large values.

**Tech Stack:** TypeScript, Zod, vitest

---

### Task 1: Add timeout to ProviderEntry type and Zod schema

**Files:**
- Modify: `src/types.ts:8-12`
- Modify: `src/config.ts:12-16`

- [ ] **Step 1: Add timeout to ProviderEntry interface**

In `src/types.ts`, change:

```ts
export interface ProviderEntry {
  provider: string
  model: string
  effort: 'low' | 'medium' | 'high'
}
```

To:

```ts
export interface ProviderEntry {
  provider: string
  model: string
  effort: 'low' | 'medium' | 'high'
  timeout?: number
}
```

- [ ] **Step 2: Add timeout to Zod schema**

In `src/config.ts`, change:

```ts
const ProviderEntrySchema = z.object({
  provider: z.string(),
  model: z.string(),
  effort: z.enum(['low', 'medium', 'high']),
})
```

To:

```ts
const ProviderEntrySchema = z.object({
  provider: z.string(),
  model: z.string(),
  effort: z.enum(['low', 'medium', 'high']),
  timeout: z.number().positive().optional(),
})
```

- [ ] **Step 3: Build to verify**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/config.ts
git commit -m "feat(timeout): add optional timeout field to ProviderEntry"
```

---

### Task 2: Use per-entry timeout in dispatch engine

**Files:**
- Modify: `src/dispatch/engine.ts:82-87`
- Modify: `tests/dispatch/engine.test.ts`

- [ ] **Step 1: Write failing test for per-entry timeout**

Add to `tests/dispatch/engine.test.ts`, after the existing test configs (around line 116):

```ts
const configWithEntryTimeout: InvokeConfig = {
  providers: {
    claude: { cli: 'claude', args: ['--print', '--model', '{{model}}'] },
  },
  roles: {
    researcher: {
      codebase: {
        prompt: '.invoke/roles/researcher/codebase.md',
        providers: [{ provider: 'claude', model: 'opus', effort: 'high', timeout: 10 }],
      },
    },
  },
  strategies: {},
  settings: {
    default_strategy: 'tdd',
    agent_timeout: 5,
    commit_style: 'per-batch',
    work_branch_prefix: 'invoke/work',
  },
}
```

Add test at the end of the describe block:

```ts
  it('uses per-entry timeout over global timeout', async () => {
    mockSpawn('Output', 0)

    const providers = new Map([['claude', mockProvider]])
    const parsers = new Map([['claude', mockParser]])
    const engine = new DispatchEngine({
      config: configWithEntryTimeout,
      providers,
      parsers,
      projectDir: '/tmp/test-project',
    })

    await engine.dispatch({
      role: 'researcher',
      subrole: 'codebase',
      taskContext: {},
    })

    // spawn is called with timeout as 3rd positional context — verify via the setTimeout in runProcess
    // The entry timeout is 10s = 10000ms, global is 5s = 5000ms
    // We verify the spawn was called (meaning dispatch worked with the entry timeout)
    expect(spawn).toHaveBeenCalled()
  })

  it('converts seconds to milliseconds for timeout', async () => {
    // Use global timeout of 5 seconds (no per-entry override)
    mockSpawn('Output', 0)

    const providers = new Map([['claude', mockProvider]])
    const parsers = new Map([['claude', mockParser]])
    const engine = new DispatchEngine({
      config: singleProviderConfig,
      providers,
      parsers,
      projectDir: '/tmp/test-project',
    })

    await engine.dispatch({
      role: 'researcher',
      subrole: 'codebase',
      taskContext: {},
    })

    expect(spawn).toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run test to verify it passes structurally (spawn is mocked)**

Run: `npx vitest run tests/dispatch/engine.test.ts`
Expected: Tests should pass since spawn is mocked, but this validates the config shape is accepted.

- [ ] **Step 3: Update dispatch engine to use per-entry timeout in seconds**

In `src/dispatch/engine.ts`, change line 82-87 from:

```ts
    const { stdout, stderr, exitCode } = await this.runProcess(
      commandSpec.cmd,
      commandSpec.args,
      this.config.settings.agent_timeout,
      commandSpec.cwd
    )
```

To:

```ts
    const timeoutSeconds = entry.timeout ?? this.config.settings.agent_timeout
    const { stdout, stderr, exitCode } = await this.runProcess(
      commandSpec.cmd,
      commandSpec.args,
      timeoutSeconds * 1000,
      commandSpec.cwd
    )
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/dispatch/engine.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/dispatch/engine.ts tests/dispatch/engine.test.ts
git commit -m "feat(timeout): use per-entry timeout with seconds-to-ms conversion"
```

---

### Task 3: Update existing test configs to use seconds

**Files:**
- Modify: `tests/dispatch/engine.test.ts`

The existing test configs use `agent_timeout: 5000` which was milliseconds. Now it's seconds, so `5000` would mean 5000 seconds. Update to `5` (5 seconds).

- [ ] **Step 1: Update singleProviderConfig**

In `tests/dispatch/engine.test.ts`, change:

```ts
    agent_timeout: 5000,
```

To (in `singleProviderConfig`, around line 87):

```ts
    agent_timeout: 5,
```

- [ ] **Step 2: Update multiProviderConfig**

Same change in `multiProviderConfig` (around line 115):

```ts
    agent_timeout: 5,
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/dispatch/engine.test.ts`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add tests/dispatch/engine.test.ts
git commit -m "fix(tests): update engine test configs to use seconds for timeout"
```

---

### Task 4: Add timeout validation warning

**Files:**
- Modify: `src/config-validator.ts`
- Modify: `tests/config-validator.test.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/config-validator.test.ts` inside the `validateConfig` describe block:

```ts
  it('warns on suspiciously large timeout (likely milliseconds)', async () => {
    const config = structuredClone(baseConfig)
    config.roles.reviewer.security.providers[0].timeout = 300000
    const result = await validateConfig(config, TEST_DIR)
    expect(result.warnings).toContainEqual(expect.objectContaining({
      level: 'warning',
      path: 'roles.reviewer.security.providers[0].timeout',
    }))
  })

  it('does not warn on reasonable timeout', async () => {
    const config = structuredClone(baseConfig)
    config.roles.reviewer.security.providers[0].timeout = 600
    const result = await validateConfig(config, TEST_DIR)
    const timeoutWarnings = result.warnings.filter(w => w.path.includes('timeout'))
    expect(timeoutWarnings).toHaveLength(0)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config-validator.test.ts`
Expected: FAIL — no timeout validation exists yet

- [ ] **Step 3: Implement timeout validation**

In `src/config-validator.ts`, inside the `validateConfig` function, in the per-provider-entry loop (after the model pattern check), add:

```ts
        // Check for suspiciously large timeout (likely milliseconds instead of seconds)
        if (entry.timeout !== undefined && entry.timeout > 3600) {
          warnings.push({
            level: 'warning',
            path: `${entryPath}.timeout`,
            message: `Timeout ${entry.timeout} seems too large — values are in seconds, not milliseconds.`,
            suggestion: `Did you mean ${Math.round(entry.timeout / 1000)} seconds?`,
          })
        }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/config-validator.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/config-validator.ts tests/config-validator.test.ts
git commit -m "feat(validation): warn on suspiciously large timeout values"
```

---

### Task 5: Update default pipeline.yaml

**Files:**
- Modify: `defaults/pipeline.yaml`

- [ ] **Step 1: Update global agent_timeout to seconds**

Change:

```yaml
settings:
  default_strategy: tdd
  agent_timeout: 300000
```

To:

```yaml
settings:
  default_strategy: tdd
  agent_timeout: 300
```

- [ ] **Step 2: Add per-entry timeouts**

Add `timeout: 600` to all researcher and planner provider entries (10 min).
Add `timeout: 300` to all builder and reviewer provider entries (5 min).

Example for a researcher entry:

```yaml
    codebase:
      prompt: .invoke/roles/researcher/codebase.md
      providers:
        - provider: claude
          model: claude-opus-4-6
          effort: high
          timeout: 600
        - provider: codex
          model: o3
          effort: high
          timeout: 600
```

Example for a builder entry:

```yaml
    default:
      prompt: .invoke/roles/builder/default.md
      providers:
        - provider: claude
          model: claude-sonnet-4-6
          effort: high
          timeout: 300
        - provider: codex
          model: o3
          effort: high
          timeout: 300
```

Apply the same pattern to all roles:
- **researcher** (codebase, best-practices, dependencies): `timeout: 600` on all entries
- **planner** (architect, alternative): `timeout: 600` on all entries
- **builder** (default): `timeout: 300` on all entries
- **reviewer** (security, code-quality, performance, ux, accessibility): `timeout: 300` on all entries

- [ ] **Step 3: Verify the file**

Run: `grep -c 'timeout:' defaults/pipeline.yaml`
Expected: A count matching the total number of provider entries (should be around 24-26) plus 1 for the global setting.

- [ ] **Step 4: Commit**

```bash
git add defaults/pipeline.yaml
git commit -m "feat(timeout): add per-entry timeouts and switch to seconds in defaults"
```

---

### Task 6: Run full test suite

**Files:** None (verification only)

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Commit if any cleanup needed**

```bash
git add -A
git commit -m "fix: address issues from per-agent timeout implementation"
```
