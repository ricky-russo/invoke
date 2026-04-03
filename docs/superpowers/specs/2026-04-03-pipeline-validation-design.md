# Pipeline Config Validation

**Date:** 2026-04-03
**Status:** Draft

## Goal

Add a validation layer that catches pipeline.yaml config errors (wrong model IDs, missing CLIs, broken file references) at startup with helpful suggestions, plus an `invoke_validate_config` MCP tool for on-demand validation after edits.

## Problem

Today, config errors only surface at dispatch time — after the user has selected agents and waited for dispatch. Model ID format mismatches (e.g., `opus-4.6` instead of `claude-opus-4-6`) and missing CLIs silently pass config loading and only fail when an agent is actually spawned, wasting time and producing confusing error messages.

## Requirements

### Validation checks

| Check | Severity | What it catches |
|---|---|---|
| CLI existence on PATH | error | Provider references a binary not installed |
| Model pattern match | warning | Model ID doesn't match known patterns for the provider |
| Prompt file exists on disk | error | Role references a `.md` prompt file that doesn't exist |
| Provider reference exists | error | Role references a provider name not in the `providers:` section |
| Strategy reference valid | error | `settings.default_strategy` references a strategy not in `strategies:` |

### Model patterns per provider

Patterns are loose enough to allow new models while catching obvious format errors.

- **claude:** Full IDs matching `claude-{name}-{version}` (e.g., `claude-opus-4-6`, `claude-sonnet-4-6`) and known aliases (`opus`, `sonnet`, `haiku`).
- **codex:** OpenAI model patterns — `o3`, `o4-mini`, `gpt-*`, `codex-*`, and other common formats.
- **Unknown providers:** Skip model validation entirely — cannot know the expected format.

The pattern map is a simple `Record<string, RegExp[]>` in the validator module, easy to extend when new providers are added.

### Suggestion format

Each warning includes a human-readable message and an optional `suggestion` field with a concrete fix:

- "Model 'opus-4.6' is not a recognized Claude model format. Did you mean 'claude-opus-4-6'?"
- "CLI 'codex' not found on PATH. Install it or update the provider config."
- "Prompt file '.invoke/roles/researcher/codebase.md' not found."
- "Provider 'gemini' is not defined in providers. Available: claude, codex."
- "Default strategy 'tdd' not found in strategies. Available: implementation-first, prototype."

### Validation result shape

```ts
interface ValidationResult {
  valid: boolean
  warnings: ValidationWarning[]
}

interface ValidationWarning {
  level: 'error' | 'warning'
  path: string           // e.g. "roles.researcher.codebase.providers[0].model"
  message: string        // human-readable issue
  suggestion?: string    // "Did you mean...?"
}
```

`valid` is `false` if any warning has `level: 'error'`. Warnings with `level: 'warning'` indicate likely problems that might still work.

## Architecture

### New module: `src/config-validator.ts`

Pure function: `validateConfig(config: InvokeConfig, projectDir: string): Promise<ValidationResult>`

- Takes loaded config + project directory
- Runs all checks, accumulates warnings
- Returns the full result — caller decides what to do with it
- Async because CLI existence check uses `which` / PATH lookup

### Integration points

1. **Startup (`src/index.ts`):** After `loadConfig()` succeeds, call `validateConfig()`. Log all warnings to stderr. Server still starts regardless — the user may want to use `invoke-manage` to fix issues.

2. **MCP tool (`invoke_validate_config`):** Registered in `src/tools/config-tool.ts`. Calls `validateConfig()` on demand and returns the result as JSON. No input params needed — reads the current loaded config.

3. **Session-start hook (`hooks/session-start.cjs`):** If a validation result file exists at `.invoke/validation.json`, include the warnings in the `additionalContext` so Claude sees them at conversation start and can surface them to the user.

### File changes

| File | Change |
|---|---|
| `src/config-validator.ts` | New — validation logic |
| `src/index.ts` | Call validator after config load, write result to `.invoke/validation.json` |
| `src/tools/config-tool.ts` | Register `invoke_validate_config` tool |
| `hooks/session-start.cjs` | Read validation.json if present, include warnings in context |
| `tests/config-validator.test.ts` | New — test cases for each check |
| `defaults/pipeline.yaml` | Fix model IDs to `claude-opus-4-6` / `o3` |

## Constraints

- Validation must not block server startup — always warn, never hard-fail
- Model patterns should be loose, not exhaustive — catch format errors, not access errors
- The validator is a pure function with no side effects (aside from filesystem reads for prompt file checks and PATH lookups)
- No network calls — validation is local only

## Acceptance criteria

- [ ] `opus-4.6` triggers a warning with suggestion `claude-opus-4-6`
- [ ] Missing CLI triggers an error with install suggestion
- [ ] Missing prompt file triggers an error with the file path
- [ ] Provider reference to undefined provider triggers an error listing available providers
- [ ] Invalid default_strategy triggers an error listing available strategies
- [ ] `invoke_validate_config` tool returns the full validation result
- [ ] Session-start hook includes validation warnings in context when present
- [ ] Default pipeline.yaml ships with correct model IDs
- [ ] All existing tests still pass

## Out of scope

- Model access verification (requires network/API calls)
- Auto-fixing config (validation reports problems, doesn't modify files)
- Validating prompt file content (only checking existence)
