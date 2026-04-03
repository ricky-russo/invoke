# Contributing to invoke

## Dev Setup

**Requirements:** Node.js >= 18

```sh
git clone https://github.com/rickyrusso/invoke.git
cd invoke
npm install
npm run build
npx vitest run
```

For development with live reloading via `tsx`:

```sh
npm run dev
```

The build compiles TypeScript from `src/` to `dist/` (ES2022, Node16 module resolution). The entry point is `dist/index.js`, which is also the MCP server binary registered as `invoke-mcp`.

---

## Architecture Overview

`src/index.ts` is the MCP server entry point. On startup it:

1. Loads and validates `.invoke/pipeline.yaml` via `config.ts` and `config-validator.ts`
2. Instantiates all managers (`WorktreeManager`, `StateManager`, `ArtifactManager`, `ContextManager`)
3. Registers MCP tool groups against each manager
4. If a valid config is present, builds the provider/parser registries and wires up dispatch tools
5. Connects to Claude Code via stdio transport

### Key modules

**`src/config.ts` + `src/config-validator.ts`**
Loads `pipeline.yaml` from the project's `.invoke/` directory using the `yaml` package, then validates the schema with `zod`. Validation warnings are written to `.invoke/validation.json` on each startup.

**`src/dispatch/engine.ts`**
`DispatchEngine` takes a resolved config, provider registry, and parser registry. It dispatches a single agent task to the appropriate CLI provider (e.g. `claude`, `codex`) and returns parsed output.

**`src/dispatch/batch-manager.ts`**
`BatchManager` wraps `DispatchEngine` for parallel multi-agent dispatch. It manages a queue of tasks across worktrees, persists in-flight state so a session can be resumed after interruption, and coordinates with `WorktreeManager` and `StateManager`.

**`src/dispatch/prompt-composer.ts`**
Builds the prompt string passed to a provider by merging task templates, role definitions, strategy configuration, and any project context documents.

**`src/worktree/manager.ts`**
`WorktreeManager` handles the full git worktree lifecycle: creating worktrees for agent tasks, squash-merging completed work back to the base branch, cleaning up stale worktrees, and discovering orphaned worktrees from interrupted runs.

**`src/tools/state.ts`**
`StateManager` persists pipeline run state to `.invoke/state.json` using atomic writes. It supports task-level updates so partial progress survives crashes or restarts.

**`src/tools/artifacts.ts`**
`ArtifactManager` manages the spec, plan, and review files that agents produce and consume across pipeline stages. Files live under `.invoke/artifacts/`.

**`src/tools/context.ts`**
`ContextManager` reads and writes project context documents from `.invoke/context/`. Context documents are injected into prompts to give agents background on the project.

**`src/providers/`**
One file per CLI provider. Each provider implements a common interface: construct the CLI command, spawn the process, and return raw output. The `registry.ts` module maps provider names from config to their implementations.

**`src/parsers/`**
One parser per provider. Parsers take the raw stdout/stderr from a provider run and extract structured results. The `registry.ts` module mirrors the provider registry pattern.

---

## Testing

Run all tests:

```sh
npx vitest run
```

Run a specific test file or directory:

```sh
npx vitest run tests/tools
npx vitest run tests/config.test.ts
```

Watch mode during development:

```sh
npm run test:watch
```

**Test layout:**

| Path | What it covers |
|------|---------------|
| `tests/*.test.ts` | Unit tests for config loading and validation |
| `tests/tools/` | Unit tests for state, artifacts, context managers |
| `tests/dispatch/` | Unit tests for engine, batch manager, prompt composer |
| `tests/worktree/` | Unit tests for worktree manager |
| `tests/providers/` | Unit tests for CLI provider implementations |
| `tests/parsers/` | Unit tests for output parsers |
| `tests/integration/` | Integration tests that spawn real processes |
| `tests/smoke/` | Smoke tests excluded from normal runs |

Tests use the real filesystem with temporary directories created per-test and cleaned up in `afterEach`. Do not use mocks for filesystem operations — real I/O catches edge cases that mocks miss.

Smoke tests (`tests/smoke/`) are excluded from `vitest.config.ts` and must be run manually when validating end-to-end provider behavior.

---

## Plugin Structure

invoke is distributed as a Claude Code plugin. The relevant files are:

**`.claude-plugin/plugin.json`**
Plugin metadata: name, description, version, author, license, keywords.

**`.claude-plugin/marketplace.json`**
Local marketplace configuration used for installing the plugin from a local path rather than a remote registry.

**`.mcp.json`**
Registers the MCP server with Claude Code. The server is started with:
```json
{ "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/dist/index.js"] }
```
`CLAUDE_PLUGIN_ROOT` is resolved at runtime by Claude Code to the plugin installation directory.

**`hooks/`**
Two hooks are registered in `hooks/hooks.json`:
- `SessionStart` — runs `hooks/session-start.cjs` to inject project context into the session on startup, compact, or clear
- `PostToolUse` on `mcp__pipeline__invoke_merge_worktree` — runs `hooks/post-merge-validation.cjs` after a worktree is merged to validate the result

**`skills/`**
Pipeline stage skills exposed to Claude Code. Each skill in `skills/` maps to a stage in a typical pipeline run:
`invoke-start`, `invoke-scope`, `invoke-plan`, `invoke-orchestrate`, `invoke-build`, `invoke-review`, `invoke-manage`, `invoke-messaging`, `invoke-resume`

**`defaults/`**
Templates copied into a project's `.invoke/` directory during `invoke-init`. Includes `pipeline.yaml`, role definitions under `roles/`, strategy definitions under `strategies/`, and `context-template.md`.

---

## PR Guidelines

**Commit style:** use conventional commits.

```
feat: add codex provider retry logic
fix: worktree cleanup fails on detached HEAD
docs: update pipeline.yaml reference
test: add batch-manager cancellation test
```

**Before submitting:**

```sh
npm run build && npx vitest run
```

Both must pass. TypeScript errors are not acceptable in a PR.

**Scope:** one concern per PR. If a fix requires a refactor, split them into separate PRs unless they are inseparable.

**Branch naming:** `feat/short-description`, `fix/short-description`, `docs/short-description`.
