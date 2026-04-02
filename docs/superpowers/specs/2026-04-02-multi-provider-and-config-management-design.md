# Multi-Provider Sub-Roles & Config Management

## Overview

Two additions to the invoke system:

1. **Multi-provider sub-roles** — any sub-role can dispatch to multiple providers in parallel, with findings merged and deduplicated.
2. **Self-serve config management** — new MCP tools (`invoke_update_config`, `invoke_delete_artifact`) that let the `invoke-manage` skill create, edit, and delete roles/strategies without manual YAML editing.

## 1. Multi-Provider Sub-Roles

### Problem

Currently each sub-role maps to exactly one provider. Users cannot run the same review (e.g., security) against both Claude and Codex to get broader coverage and cross-validate findings.

### Solution

Allow a `providers` array on any sub-role config entry. Single-provider syntax remains as shorthand. Internally, everything normalizes to an array.

### Config Format

```yaml
# Single provider — shorthand (unchanged, backwards compatible)
reviewer:
  code-quality:
    prompt: .invoke/roles/reviewer/code-quality.md
    provider: claude
    model: opus-4.6
    effort: medium

# Multi-provider — new
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
```

Both formats are valid for any sub-role (researcher, planner, builder, reviewer).

### Type Changes

```typescript
// New type for a single provider entry
interface ProviderEntry {
  provider: string
  model: string
  effort: 'low' | 'medium' | 'high'
}

// RoleConfig changes — always an array internally
interface RoleConfig {
  prompt: string
  providers: ProviderEntry[]
}
```

### Config Normalization

The Zod schema accepts both formats. The config loader normalizes single-provider shorthand into a `providers` array of length 1:

```yaml
# This input:
code-quality:
  prompt: .invoke/roles/reviewer/code-quality.md
  provider: claude
  model: opus-4.6
  effort: medium

# Becomes internally:
code-quality:
  prompt: .invoke/roles/reviewer/code-quality.md
  providers:
    - provider: claude
      model: opus-4.6
      effort: medium
```

All downstream code (dispatch engine, batch manager, tools) only deals with `providers` arrays.

### Dispatch Behavior

When `DispatchEngine.dispatch()` is called for a sub-role:

1. Read the `providers` array from the role config
2. Compose the prompt once (same prompt for all providers)
3. Dispatch to ALL providers in parallel
4. Collect all `AgentResult` objects
5. If the role is a reviewer, merge and deduplicate findings:
   - Match findings on `file` + `line` (if present) + normalized `issue` text (case-insensitive, trimmed). Two findings match if they reference the same file and line, or the same file with >80% word overlap in the issue text.
   - Findings flagged by multiple providers get `agreedBy: ["claude", "codex"]`
   - Unique findings keep their single provider attribution
   - Sort by severity, then by number of providers agreeing (higher confidence first)
6. Return a single merged `AgentResult`

For non-reviewer roles (researchers, planners, builders), concatenate reports/outputs with provider headers.

### Finding Type Change

```typescript
interface Finding {
  issue: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  file: string
  line?: number
  suggestion: string
  agreedBy?: string[]  // NEW — which providers flagged this finding
}
```

### Files Changed

- `src/types.ts` — `RoleConfig` → `providers: ProviderEntry[]`, `Finding` + `agreedBy`
- `src/config.ts` — Zod schema accepts both formats, normalizes to array
- `src/dispatch/engine.ts` — `dispatch()` fans out to multiple providers, merges results
- `tests/config.test.ts` — test both config formats
- `tests/dispatch/engine.test.ts` — test multi-provider dispatch and merge
- `defaults/pipeline.yaml` — no change needed (single-provider format still works)

## 2. Self-Serve Config Management

### Problem

The `invoke-manage` skill describes a conversational flow for creating/editing/deleting roles and strategies, but the MCP has no tools to modify `pipeline.yaml` or delete files. The skill is hollow.

### Solution

Add two new MCP tools and one new method:

### invoke_update_config Tool

Structured operations on `pipeline.yaml`. Supported operations:

**add_role** — add a new sub-role:
```json
{
  "operation": "add_role",
  "role": "reviewer",
  "subrole": "psr-compliance",
  "config": {
    "prompt": ".invoke/roles/reviewer/psr-compliance.md",
    "providers": [
      { "provider": "claude", "model": "opus-4.6", "effort": "high" }
    ]
  }
}
```

**remove_role** — remove a sub-role:
```json
{
  "operation": "remove_role",
  "role": "reviewer",
  "subrole": "psr-compliance"
}
```

**add_strategy** — add a new strategy:
```json
{
  "operation": "add_strategy",
  "strategy": "my-strategy",
  "config": { "prompt": ".invoke/strategies/my-strategy.md" }
}
```

**remove_strategy** — remove a strategy:
```json
{
  "operation": "remove_strategy",
  "strategy": "my-strategy"
}
```

**update_settings** — update settings fields:
```json
{
  "operation": "update_settings",
  "settings": { "default_strategy": "implementation-first", "agent_timeout": 600000 }
}
```

### Validation Safety

Every `invoke_update_config` call:
1. Reads current `pipeline.yaml`
2. Applies the operation in memory
3. Validates the full result against the Zod config schema
4. Only writes if validation passes
5. Returns the updated config on success, or a validation error on failure

The skill cannot produce an invalid config.

### invoke_delete_artifact Tool

Removes a file from the `.invoke/` directory:
```json
{
  "stage": "roles/reviewer",
  "filename": "psr-compliance.md"
}
```

This completes the manage lifecycle:
- Create prompt files → `invoke_save_artifact`
- Update config entries → `invoke_update_config`
- Delete prompt files → `invoke_delete_artifact`
- Delete config entries → `invoke_update_config` with `remove_role`/`remove_strategy`

### Files Changed

- New: `src/tools/config-manager.ts` — logic for read/modify/validate/write config operations
- New: `src/tools/config-update-tools.ts` — MCP tool registration for `invoke_update_config`
- New: `tests/tools/config-manager.test.ts` — tests for all operations
- Modify: `src/tools/artifacts.ts` — add `delete()` method
- Modify: `src/tools/artifact-tools.ts` — register `invoke_delete_artifact`
- Modify: `src/index.ts` — register new tools
- Modify: `tests/tools/artifacts.test.ts` — test delete
- Update: `skills/invoke-manage.md` — reference the actual MCP tools

### invoke-manage Skill Update

The skill already describes the right conversational flow. It needs to be updated to reference the specific MCP tools:
- Use `invoke_get_config` to list current configuration
- Use `invoke_save_artifact` with `stage: "roles/<type>"` to create prompt files
- Use `invoke_update_config` with `add_role` to register the new role in config
- Use `invoke_update_config` with `remove_role` + `invoke_delete_artifact` to delete
- Use `invoke_update_config` with `update_settings` to change settings
