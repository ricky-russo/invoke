# Pipeline Config Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add startup and on-demand pipeline.yaml validation with helpful error messages and model format suggestions.

**Architecture:** A pure `validateConfig()` function in `src/config-validator.ts` runs 5 checks (CLI existence, model patterns, prompt files, provider refs, strategy refs) and returns a structured result. Called at MCP server startup and via an `invoke_validate_config` tool. Session-start hook surfaces warnings to Claude.

**Tech Stack:** TypeScript, Zod (already in deps), Node `child_process` for CLI lookup, vitest for tests.

---

### Task 1: Validation Types and Model Patterns

**Files:**
- Create: `src/config-validator.ts`
- Test: `tests/config-validator.test.ts`

- [ ] **Step 1: Write the failing test for model pattern validation**

```ts
// tests/config-validator.test.ts
import { describe, it, expect } from 'vitest'
import { isValidModelForProvider } from '../src/config-validator.js'

describe('isValidModelForProvider', () => {
  describe('claude', () => {
    it('accepts full model IDs', () => {
      expect(isValidModelForProvider('claude', 'claude-opus-4-6')).toBe(true)
      expect(isValidModelForProvider('claude', 'claude-sonnet-4-6')).toBe(true)
      expect(isValidModelForProvider('claude', 'claude-haiku-4-5-20251001')).toBe(true)
    })

    it('accepts known aliases', () => {
      expect(isValidModelForProvider('claude', 'opus')).toBe(true)
      expect(isValidModelForProvider('claude', 'sonnet')).toBe(true)
      expect(isValidModelForProvider('claude', 'haiku')).toBe(true)
    })

    it('rejects invalid formats', () => {
      expect(isValidModelForProvider('claude', 'opus-4.6')).toBe(false)
      expect(isValidModelForProvider('claude', 'gpt-4')).toBe(false)
      expect(isValidModelForProvider('claude', 'claude opus')).toBe(false)
    })
  })

  describe('codex', () => {
    it('accepts valid OpenAI models', () => {
      expect(isValidModelForProvider('codex', 'o3')).toBe(true)
      expect(isValidModelForProvider('codex', 'o4-mini')).toBe(true)
      expect(isValidModelForProvider('codex', 'gpt-4o')).toBe(true)
      expect(isValidModelForProvider('codex', 'gpt-4.1')).toBe(true)
      expect(isValidModelForProvider('codex', 'codex-mini')).toBe(true)
    })

    it('rejects invalid formats', () => {
      expect(isValidModelForProvider('codex', 'opus-4.6')).toBe(false)
      expect(isValidModelForProvider('codex', 'claude-sonnet-4-6')).toBe(false)
    })
  })

  describe('unknown provider', () => {
    it('accepts any model (cannot validate)', () => {
      expect(isValidModelForProvider('gemini', 'anything-goes')).toBe(true)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config-validator.test.ts`
Expected: FAIL — `isValidModelForProvider` not found

- [ ] **Step 3: Implement model pattern validation**

```ts
// src/config-validator.ts
import type { InvokeConfig } from './types.js'
import { existsSync } from 'fs'
import { execSync } from 'child_process'
import path from 'path'

export interface ValidationResult {
  valid: boolean
  warnings: ValidationWarning[]
}

export interface ValidationWarning {
  level: 'error' | 'warning'
  path: string
  message: string
  suggestion?: string
}

const MODEL_PATTERNS: Record<string, RegExp[]> = {
  claude: [
    /^claude-[a-z]+-[\d-]+$/,          // claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5-20251001
    /^(opus|sonnet|haiku)$/,            // aliases
  ],
  codex: [
    /^o\d+(-\w+)?$/,                   // o3, o4-mini
    /^gpt-[\w.-]+$/,                    // gpt-4o, gpt-4.1
    /^codex-[\w.-]+$/,                  // codex-mini
  ],
}

const MODEL_SUGGESTIONS: Record<string, Record<string, string>> = {
  claude: {
    'opus-4.6': 'claude-opus-4-6',
    'opus-4-6': 'claude-opus-4-6',
    'sonnet-4.6': 'claude-sonnet-4-6',
    'sonnet-4-6': 'claude-sonnet-4-6',
    'haiku-4.5': 'claude-haiku-4-5-20251001',
    'claude opus': 'opus',
    'claude sonnet': 'sonnet',
  },
  codex: {
    'gpt-5.4': 'gpt-4.1',
  },
}

export function isValidModelForProvider(provider: string, model: string): boolean {
  const patterns = MODEL_PATTERNS[provider]
  if (!patterns) return true  // unknown provider — skip validation
  return patterns.some(p => p.test(model))
}

function suggestModel(provider: string, model: string): string | undefined {
  const suggestions = MODEL_SUGGESTIONS[provider]
  if (!suggestions) return undefined
  return suggestions[model]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config-validator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config-validator.ts tests/config-validator.test.ts
git commit -m "feat(validation): add model pattern validation with provider-specific rules"
```

---

### Task 2: CLI Existence Check

**Files:**
- Modify: `src/config-validator.ts`
- Modify: `tests/config-validator.test.ts`

- [ ] **Step 1: Write the failing test for CLI existence**

```ts
// Append to tests/config-validator.test.ts
import { checkCliExists } from '../src/config-validator.js'

describe('checkCliExists', () => {
  it('returns true for a CLI on PATH', () => {
    expect(checkCliExists('node')).toBe(true)
  })

  it('returns false for a missing CLI', () => {
    expect(checkCliExists('nonexistent-cli-that-does-not-exist-xyz')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config-validator.test.ts`
Expected: FAIL — `checkCliExists` not found

- [ ] **Step 3: Implement CLI existence check**

Append to `src/config-validator.ts`:

```ts
export function checkCliExists(cli: string): boolean {
  try {
    execSync(`which ${cli}`, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config-validator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config-validator.ts tests/config-validator.test.ts
git commit -m "feat(validation): add CLI existence check via which"
```

---

### Task 3: Full validateConfig Function

**Files:**
- Modify: `src/config-validator.ts`
- Modify: `tests/config-validator.test.ts`

- [ ] **Step 1: Write failing tests for validateConfig**

```ts
// Append to tests/config-validator.test.ts
import { validateConfig } from '../src/config-validator.js'
import type { InvokeConfig } from '../src/types.js'
import { mkdir, writeFile, rm } from 'fs/promises'
import path from 'path'
import { beforeEach, afterEach } from 'vitest'

const VALID_DIR = path.join(import.meta.dirname, 'fixtures', 'validator-test')

describe('validateConfig', () => {
  beforeEach(async () => {
    await mkdir(path.join(VALID_DIR, '.invoke', 'roles', 'researcher'), { recursive: true })
    await mkdir(path.join(VALID_DIR, '.invoke', 'strategies'), { recursive: true })
    await writeFile(path.join(VALID_DIR, '.invoke', 'roles', 'researcher', 'codebase.md'), '# Prompt')
    await writeFile(path.join(VALID_DIR, '.invoke', 'strategies', 'tdd.md'), '# Strategy')
  })

  afterEach(async () => {
    await rm(VALID_DIR, { recursive: true, force: true })
  })

  const baseConfig: InvokeConfig = {
    providers: {
      claude: { cli: 'claude', args: ['--print', '--model', '{{model}}'] },
    },
    roles: {
      researcher: {
        codebase: {
          prompt: '.invoke/roles/researcher/codebase.md',
          providers: [{ provider: 'claude', model: 'claude-opus-4-6', effort: 'high' }],
        },
      },
    },
    strategies: { tdd: { prompt: '.invoke/strategies/tdd.md' } },
    settings: {
      default_strategy: 'tdd',
      agent_timeout: 300000,
      commit_style: 'per-batch',
      work_branch_prefix: 'invoke/work',
    },
  }

  it('returns valid for a correct config', async () => {
    const result = await validateConfig(baseConfig, VALID_DIR)
    expect(result.valid).toBe(true)
    expect(result.warnings).toHaveLength(0)
  })

  it('warns on invalid model format', async () => {
    const config = structuredClone(baseConfig)
    config.roles.researcher.codebase.providers[0].model = 'opus-4.6'
    const result = await validateConfig(config, VALID_DIR)
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        level: 'warning',
        path: 'roles.researcher.codebase.providers[0].model',
        suggestion: 'claude-opus-4-6',
      })
    )
  })

  it('errors on missing prompt file', async () => {
    const config = structuredClone(baseConfig)
    config.roles.researcher.codebase.prompt = '.invoke/roles/researcher/missing.md'
    const result = await validateConfig(config, VALID_DIR)
    expect(result.valid).toBe(false)
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        level: 'error',
        path: 'roles.researcher.codebase.prompt',
      })
    )
  })

  it('errors on undefined provider reference', async () => {
    const config = structuredClone(baseConfig)
    config.roles.researcher.codebase.providers[0].provider = 'gemini'
    const result = await validateConfig(config, VALID_DIR)
    expect(result.valid).toBe(false)
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        level: 'error',
        path: 'roles.researcher.codebase.providers[0].provider',
        message: expect.stringContaining('gemini'),
      })
    )
  })

  it('errors on invalid default_strategy', async () => {
    const config = structuredClone(baseConfig)
    config.settings.default_strategy = 'nonexistent'
    const result = await validateConfig(config, VALID_DIR)
    expect(result.valid).toBe(false)
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        level: 'error',
        path: 'settings.default_strategy',
      })
    )
  })

  it('errors on missing CLI', async () => {
    const config = structuredClone(baseConfig)
    config.providers.claude.cli = 'nonexistent-cli-xyz'
    const result = await validateConfig(config, VALID_DIR)
    expect(result.valid).toBe(false)
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        level: 'error',
        path: 'providers.claude.cli',
      })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config-validator.test.ts`
Expected: FAIL — `validateConfig` not found or not returning expected results

- [ ] **Step 3: Implement validateConfig**

Append to `src/config-validator.ts`:

```ts
export async function validateConfig(
  config: InvokeConfig,
  projectDir: string
): Promise<ValidationResult> {
  const warnings: ValidationWarning[] = []
  const providerNames = Object.keys(config.providers)

  // Check CLI existence for each provider
  for (const [name, provider] of Object.entries(config.providers)) {
    if (!checkCliExists(provider.cli)) {
      warnings.push({
        level: 'error',
        path: `providers.${name}.cli`,
        message: `CLI '${provider.cli}' not found on PATH.`,
        suggestion: `Install '${provider.cli}' or update the provider config.`,
      })
    }
  }

  // Check default strategy exists
  if (!config.strategies[config.settings.default_strategy]) {
    const available = Object.keys(config.strategies).join(', ')
    warnings.push({
      level: 'error',
      path: 'settings.default_strategy',
      message: `Default strategy '${config.settings.default_strategy}' not found in strategies.`,
      suggestion: `Available strategies: ${available}`,
    })
  }

  // Check each role
  for (const [roleGroup, subroles] of Object.entries(config.roles)) {
    for (const [subroleName, subrole] of Object.entries(subroles)) {
      const rolePath = `roles.${roleGroup}.${subroleName}`

      // Check prompt file exists
      const promptFullPath = path.join(projectDir, subrole.prompt)
      if (!existsSync(promptFullPath)) {
        warnings.push({
          level: 'error',
          path: `${rolePath}.prompt`,
          message: `Prompt file '${subrole.prompt}' not found.`,
        })
      }

      // Check each provider entry
      for (let i = 0; i < subrole.providers.length; i++) {
        const entry = subrole.providers[i]
        const entryPath = `${rolePath}.providers[${i}]`

        // Check provider reference
        if (!providerNames.includes(entry.provider)) {
          warnings.push({
            level: 'error',
            path: `${entryPath}.provider`,
            message: `Provider '${entry.provider}' is not defined in providers.`,
            suggestion: `Available providers: ${providerNames.join(', ')}`,
          })
        }

        // Check model format
        if (!isValidModelForProvider(entry.provider, entry.model)) {
          const suggestion = suggestModel(entry.provider, entry.model)
          warnings.push({
            level: 'warning',
            path: `${entryPath}.model`,
            message: `Model '${entry.model}' is not a recognized ${entry.provider} model format.`,
            suggestion: suggestion ? `Did you mean '${suggestion}'?` : undefined,
          })
        }
      }
    }
  }

  return {
    valid: !warnings.some(w => w.level === 'error'),
    warnings,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config-validator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config-validator.ts tests/config-validator.test.ts
git commit -m "feat(validation): add full validateConfig with all 5 checks"
```

---

### Task 4: Wire Validation into MCP Server Startup

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add validation call after config load**

In `src/index.ts`, add the import and validation call:

```ts
// Add import at top
import { validateConfig } from './config-validator.js'
import { writeFile } from 'fs/promises'
import path from 'path'

// After the existing loadConfig try/catch block (around line 35), add:

  // Validate config if loaded
  if (config) {
    const validation = await validateConfig(config, projectDir)
    if (validation.warnings.length > 0) {
      console.error('Pipeline config warnings:')
      for (const w of validation.warnings) {
        const prefix = w.level === 'error' ? 'ERROR' : 'WARNING'
        console.error(`  [${prefix}] ${w.path}: ${w.message}${w.suggestion ? ` ${w.suggestion}` : ''}`)
      }
    }

    // Write validation result for session-start hook
    try {
      await writeFile(
        path.join(projectDir, '.invoke', 'validation.json'),
        JSON.stringify(validation, null, 2)
      )
    } catch {
      // Non-critical — don't block startup
    }
  }
```

- [ ] **Step 2: Build to verify compilation**

Run: `npm run build`
Expected: Clean build, no errors

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(validation): run validation at MCP server startup"
```

---

### Task 5: Register invoke_validate_config Tool

**Files:**
- Modify: `src/tools/config-tool.ts`

- [ ] **Step 1: Add the validation tool**

In `src/tools/config-tool.ts`, add the import and register the new tool:

```ts
// Add import at top
import { validateConfig } from '../config-validator.js'

// After the existing invoke_get_config tool registration, add:

  server.registerTool(
    'invoke_validate_config',
    {
      description: 'Validate the pipeline.yaml configuration. Checks CLI existence, model formats, prompt file existence, provider references, and strategy references. Returns warnings with suggestions.',
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const config = await loadConfig(projectDir)
        const result = await validateConfig(config, projectDir)
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error loading config: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    }
  )
```

- [ ] **Step 2: Build to verify compilation**

Run: `npm run build`
Expected: Clean build, no errors

- [ ] **Step 3: Commit**

```bash
git add src/tools/config-tool.ts
git commit -m "feat(validation): add invoke_validate_config MCP tool"
```

---

### Task 6: Surface Warnings in Session-Start Hook

**Files:**
- Modify: `hooks/session-start.cjs`

- [ ] **Step 1: Add validation warning injection**

In `hooks/session-start.cjs`, add reading of `validation.json` after the pipeline state check (around line 43):

```js
  // Check for validation warnings
  const validationPath = path.join(process.cwd(), '.invoke', 'validation.json');
  let validationNotice = '';
  try {
    if (fs.existsSync(validationPath)) {
      const validation = JSON.parse(fs.readFileSync(validationPath, 'utf-8'));
      if (validation.warnings && validation.warnings.length > 0) {
        const lines = validation.warnings.map(w => {
          const prefix = w.level === 'error' ? 'ERROR' : 'WARNING';
          return `[${prefix}] ${w.path}: ${w.message}${w.suggestion ? ' ' + w.suggestion : ''}`;
        });
        validationNotice = `\\n\\nPIPELINE CONFIG ISSUES DETECTED:\\n${escapeForJson(lines.join('\n'))}\\nRun invoke_validate_config or use invoke-manage to fix these issues.`;
      }
    }
  } catch (e) {
    // Ignore validation read errors
  }
```

Then update the context string to include it (modify the existing `const context = ...` line):

```js
  const context = `<EXTREMELY_IMPORTANT>\\nThis project uses the invoke development pipeline.\\n\\n**Below is the full content of the 'invoke:invoke-start' skill — your guide to routing all development work through invoke. For all other invoke skills, use the Skill tool:**\\n\\n${escapeForJson(skillContent)}${pipelineNotice}${validationNotice}\\n</EXTREMELY_IMPORTANT>`;
```

- [ ] **Step 2: Test the hook manually**

Create a test validation.json and run the hook:

```bash
cd /tmp && mkdir -p .invoke
echo '{"valid":false,"warnings":[{"level":"error","path":"providers.claude.cli","message":"CLI not found","suggestion":"Install claude"}]}' > .invoke/validation.json
CLAUDE_PLUGIN_ROOT=/Users/rickyrusso/Documents/Github/invoke node /Users/rickyrusso/Documents/Github/invoke/hooks/session-start.cjs 2>&1 | head -5
rm -rf .invoke
```

Expected: JSON output containing "PIPELINE CONFIG ISSUES DETECTED"

- [ ] **Step 3: Commit**

```bash
git add hooks/session-start.cjs
git commit -m "feat(validation): surface config warnings in session-start hook"
```

---

### Task 7: Fix Default Model IDs

**Files:**
- Modify: `defaults/pipeline.yaml`

- [ ] **Step 1: Update model IDs**

In `defaults/pipeline.yaml`, replace all `model: opus` with `model: claude-opus-4-6` and keep `model: o3` as-is (already valid for codex). Also update the builder to use `claude-sonnet-4-6` since builders run more frequently and sonnet is faster:

```yaml
# For all researcher, planner, reviewer roles — claude provider:
model: claude-opus-4-6

# For builder role — claude provider:
model: claude-sonnet-4-6

# For all codex providers (already correct):
model: o3
```

- [ ] **Step 2: Verify the file looks correct**

Run: `grep 'model:' defaults/pipeline.yaml`
Expected: All entries show `claude-opus-4-6`, `claude-sonnet-4-6`, or `o3`

- [ ] **Step 3: Commit**

```bash
git add defaults/pipeline.yaml
git commit -m "fix: use correct model ID formats in default pipeline.yaml"
```

---

### Task 8: Run Full Test Suite

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (existing + new)

- [ ] **Step 2: Build the project**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 3: Final commit if any cleanup needed**

If any fixes were needed, commit them:

```bash
git add -A
git commit -m "fix: address test/build issues from validation implementation"
```
