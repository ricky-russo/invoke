# Configuration Reference

`.invoke/pipeline.yaml` is the project-level configuration file that Invoke reads on every config load. It defines provider commands, role prompts and provider assignments, strategy prompt files, global settings, and optional preset definitions.

## 1. Overview

Invoke loads the pipeline config from `<project-root>/.invoke/pipeline.yaml`. The loader expects top-level `providers`, `roles`, `strategies`, and `settings` keys. `presets` is optional.

This is a minimal schema-valid starting point:

```yaml
providers:
  claude:
    cli: claude
    args: ["--print", "--model", "{{model}}", "--dangerously-skip-permissions"]

roles:
  builder:
    default:
      prompt: .invoke/roles/builder/default.md
      providers:
        - provider: claude
          model: claude-sonnet-4-6
          effort: medium

strategies:
  tdd:
    prompt: .invoke/strategies/tdd.md

settings:
  default_strategy: tdd
  agent_timeout: 300
  commit_style: per-task
  work_branch_prefix: invoke/work
```

> **Security:** `--dangerously-skip-permissions` and `--dangerously-bypass-approvals-and-sandbox` bypass provider-side permission checks. See [Security Considerations](providers.md#security-considerations) before using either flag in production.

Each role entry must provide a `prompt` plus either a `providers` array or the single-provider shorthand (`provider`, `model`, `effort`). During normalization, shorthand entries are converted into the same `providers[]` structure used everywhere else.

The generated default file is larger than the minimal example above. It includes three provider definitions, four role groups, four built-in strategies, and a populated settings block.

## 2. Providers

`providers` is a map from provider name to a command definition. Each provider config has a `cli` string and an `args` string array.

The shipped defaults define these three providers:

```yaml
providers:
  claude:
    cli: claude
    args: ["--print", "--model", "{{model}}", "--dangerously-skip-permissions"]
  codex:
    cli: codex
    args: ["--dangerously-bypass-approvals-and-sandbox", "exec", "--model", "{{model}}", "-c", "reasoning_effort={{effort}}"]
  gemini:
    cli: gemini
    args: ["-y", "--output-format", "text", "-m", "{{model}}", "-p"]
```

> **Security:** The shipped Claude and Codex provider examples both include `dangerously-*` flags. Review [Security Considerations](providers.md#security-considerations) before reusing these defaults in production.

These default values come directly from the generated pipeline template.

### `providers.<name>.cli`

Type: `string`

The executable Invoke runs for that provider. Validation checks that the CLI exists on `PATH` for providers that are referenced by at least one role.

### `providers.<name>.args`

Type: `string[]`

This is the configured argument list for the provider command. At dispatch time, Invoke substitutes template variables in each configured argument string. It then appends the rendered prompt as the final CLI argument. The built-in Codex provider also appends `--skip-git-repo-check` before the prompt.

### Template Variables

The built-in provider args use two placeholders:

- `{{model}}` is replaced with the `model` value from the selected provider entry under a role's `providers` array.
- `{{effort}}` is replaced with the provider entry's `effort` value. The value must be `low`, `medium`, or `high`.

Gemini's default args use `{{model}}` but not `{{effort}}`. No effort placeholder is present in the shipped Gemini config.

## 3. Roles

`roles` is a nested map: role group -> subrole -> role config. A normalized role config always has a `prompt` and a `providers` array. It can also set `provider_mode`. Each provider entry contains `provider`, `model`, `effort`, and optional `timeout`.

The defaults define four role groups: `researcher`, `planner`, `builder`, and `reviewer`.

### `roles.<group>.<subrole>.prompt`

Type: `string`

Path to the prompt file for that subrole. Validation checks that the referenced file exists on disk.

### `roles.<group>.<subrole>.providers`

Type: `ProviderEntry[]`

Each entry selects a provider by name. It also supplies the `model`, `effort`, and optional per-entry `timeout` used for that role. If `timeout` is omitted, dispatch falls back to `settings.agent_timeout`.

The shipped defaults use the `providers` array form for every subrole, even when only one provider entry is present.

### Researcher

| Subrole | Default `prompt` | Default provider entry |
|---|---|---|
| `codebase` | `.invoke/roles/researcher/codebase.md` | `claude`, `claude-sonnet-4-6`, `medium`, `timeout: 600` |
| `best-practices` | `.invoke/roles/researcher/best-practices.md` | `claude`, `claude-sonnet-4-6`, `medium`, `timeout: 600` |
| `dependencies` | `.invoke/roles/researcher/dependencies.md` | `claude`, `claude-sonnet-4-6`, `medium`, `timeout: 600` |

Defaults above are defined in the pipeline template.

### Planner

| Subrole | Default `prompt` | Default provider entry |
|---|---|---|
| `architect` | `.invoke/roles/planner/architect.md` | `claude`, `claude-opus-4-6`, `high`, `timeout: 600` |
| `alternative` | `.invoke/roles/planner/alternative.md` | `claude`, `claude-opus-4-6`, `high`, `timeout: 600` |

Defaults above are defined in the pipeline template.

### Builder

| Subrole | Default `prompt` | Default provider entry |
|---|---|---|
| `default` | `.invoke/roles/builder/default.md` | `claude`, `claude-sonnet-4-6`, `medium`, `timeout: 300` |
| `docs` | `.invoke/roles/builder/docs.md` | `claude`, `claude-sonnet-4-6`, `medium`, `timeout: 300` |
| `integration-test` | `.invoke/roles/builder/integration-test.md` | `claude`, `claude-sonnet-4-6`, `medium`, `timeout: 300` |
| `refactor` | `.invoke/roles/builder/refactor.md` | `claude`, `claude-sonnet-4-6`, `medium`, `timeout: 300` |
| `migration` | `.invoke/roles/builder/migration.md` | `claude`, `claude-sonnet-4-6`, `medium`, `timeout: 300` |

Defaults above are defined in the pipeline template.

### Reviewer

| Subrole | Default `prompt` | Default provider entry |
|---|---|---|
| `spec-compliance` | `.invoke/roles/reviewer/spec-compliance.md` | `claude`, `claude-opus-4-6`, `high`, `timeout: 300` |
| `security` | `.invoke/roles/reviewer/security.md` | `claude`, `claude-sonnet-4-6`, `high`, `timeout: 300` |
| `code-quality` | `.invoke/roles/reviewer/code-quality.md` | `claude`, `claude-sonnet-4-6`, `medium`, `timeout: 300` |
| `performance` | `.invoke/roles/reviewer/performance.md` | `claude`, `claude-sonnet-4-6`, `medium`, `timeout: 300` |
| `ux` | `.invoke/roles/reviewer/ux.md` | `claude`, `claude-sonnet-4-6`, `medium`, `timeout: 300` |
| `accessibility` | `.invoke/roles/reviewer/accessibility.md` | `claude`, `claude-sonnet-4-6`, `medium`, `timeout: 300` |

Defaults above are defined in the pipeline template.

## 4. Strategies

`strategies` is a map from strategy name to a prompt file. The default configuration ships four built-in strategies.

| Strategy | Prompt | What the shipped prompt enforces |
|---|---|---|
| `tdd` | `.invoke/strategies/tdd.md` | Strict red -> verify red -> green -> refactor -> repeat. The prompt explicitly forbids writing production code before a failing test exists. |
| `implementation-first` | `.invoke/strategies/implementation-first.md` | Implement first, then write tests for every acceptance criterion before the task is complete. |
| `prototype` | `.invoke/strategies/prototype.md` | Optimize for speed and the happy path. Tests and hardening are skipped unless the acceptance criteria require them. |
| `bug-fix` | `.invoke/strategies/bug-fix.md` | Reproduce the bug, identify the root cause, create a failing test, then make the smallest fix that resolves it. |

Strategy names and prompt paths come from the default pipeline. The behavioral summaries above come from the shipped strategy prompt files.

## 5. Settings

`settings` holds global pipeline options. `settings.review_tiers` and `settings.preset` are documented in sections 6 and 7. They have extra structure and merge behavior.

| Key | Type | Default in `plugin/defaults/pipeline.yaml` | Description |
|---|---|---|---|
| `default_strategy` | `string` | `tdd` | Default strategy name. Validation errors if the value does not match a key under `strategies`. |
| `agent_timeout` | `number` | `300` | Default timeout, in seconds, for provider dispatches that do not specify `providers[].timeout`. |
| `commit_style` | `"one-commit" \| "per-batch" \| "per-task" \| "custom"` | `per-task` | Commit-style selector. The schema permits four values, and the shipped default file sets `per-task`. |
| `work_branch_prefix` | `string` | `invoke/work` | Prefix used when creating session work branches. Session work branches are created as `<work_branch_prefix>/<session_id>`. |
| `stale_session_days` | `number` | unset | Optional stale-session threshold. When it is not configured, session tooling falls back to 7 days. |
| `post_merge_commands` | `string[]` | `["npm install", "npm run test", "npm run build"]` | Shell commands run after merge. If the list is unset or empty, nothing runs. |
| `max_parallel_agents` | `number` | unset | Optional per-batch concurrency cap. When unset, batch execution uses `0`, which means unlimited parallelism. |
| `default_provider_mode` | `"parallel" \| "fallback" \| "single"` | `parallel` | Global default for multi-provider role dispatch when the subrole does not set its own `provider_mode`. |
| `max_review_cycles` | `number` | `3` | Configured review-cycle cap. The schema accepts `0` or greater, and the value is surfaced with review-cycle counts. |
| `max_dispatches` | `number` | unset | Optional total dispatch cap for a pipeline. When set, projected dispatch counts are checked before a batch starts. Dispatch can be blocked once the limit is reached. |

Settings defaults come from the shipped pipeline template. Types and constraints come from the config schema. Runtime behavior comes from the dispatch, session, and post-merge code paths.

## 6. Review Tiers

`settings.review_tiers` configures named reviewer groups. The canonical format is an array of objects:

```yaml
settings:
  review_tiers:
    - name: critical
      reviewers: [spec-compliance, security]
    - name: quality
      reviewers: [code-quality, performance]
    - name: polish
      reviewers: [ux, accessibility]
```

Each entry has this shape:

- `name: string`
- `reviewers: string[]`

The schema accepts either the array form above or a mapping object such as `critical: [spec-compliance, security]`. Mapping input is normalized into the same array-of-objects structure internally.

The shipped default pipeline leaves `review_tiers` unset. The commented example in the default file shows `critical`, `quality`, and `polish` as a typical tier layout. Validation warns when a tier references a reviewer name that is not configured under `roles.reviewer`.

## 7. Presets

Presets are optional named bundles of config overrides and selection lists. A preset definition can include:

- `name`
- `description`
- `settings`
- `researcher_selection`
- `reviewer_selection`
- `strategy_selection`

These fields are all optional within a preset object.

You activate a preset with `settings.preset`:

```yaml
settings:
  preset: quick
```

When `settings.preset` is set, Invoke resolves the preset in this order:

1. Inline under `presets.<name>` in `.invoke/pipeline.yaml`
2. `.invoke/presets/<name>.yaml` in the current project
3. The bundled default preset file under the defaults directory

Inline presets win over file presets because the loader checks `raw.presets?.[name]` before calling the file loader. Project-local preset files are checked before bundled defaults.

Preset merge behavior is important:

- Invoke starts from the preset's `settings` object and a synthetic `presets` entry for the active preset.
- It then deep-merges the raw project config on top of that preset base.
- Objects merge recursively.
- Arrays replace the preset array instead of concatenating with it.
- Keys omitted from YAML do not participate in the merge because the parser omits absent keys before `deepMerge()` runs.

Preset `settings` supply defaults. Project-level `settings` override them. The active preset definition remains available under `config.presets[settings.preset]`. That object holds selection lists such as `researcher_selection`, `reviewer_selection`, and `strategy_selection` after loading. When the same nested key is merged from both sides, arrays replace rather than extend.

Inline preset example:

```yaml
settings:
  preset: quick

presets:
  quick:
    name: quick
    description: Project-specific quick preset
    settings:
      max_parallel_agents: 1
    reviewer_selection:
      - spec-compliance
```

Bundled preset examples:

| Preset | Shipped behavior |
|---|---|
| `prototype` | Sets `default_strategy: prototype`, sets `max_review_cycles: 0`, clears `reviewer_selection`, and restricts `strategy_selection` to `prototype`. |
| `quick` | Sets `default_strategy: implementation-first`, sets `max_review_cycles: 1`, sets `max_parallel_agents: 2`, restricts researchers to `codebase`, reviewers to `spec-compliance` and `security`, and strategies to `implementation-first` and `bug-fix`. |
| `thorough` | Sets `default_strategy: tdd`, sets `max_review_cycles: 5`, includes all six default reviewers, and offers `tdd`, `implementation-first`, and `bug-fix` as strategies. |

Bundled preset values above come from the shipped preset files.

Validation warns when `settings.preset` does not match either an inline preset or a preset file available in the defaults or project preset directories.

## 8. Provider Mode

`provider_mode` controls how a role subrole dispatches when `providers[]` has more than one entry. Valid values are `parallel`, `fallback`, and `single`, and single-provider subroles always resolve to `single`. For full details on provider modes, see [Provider Modes](providers.md#provider-modes).

## 9. Template Variables

The provider templates in `providers.<name>.args` are populated from the role-level provider entry selected for the current dispatch. `model` is a free-form string. `effort` must be `low`, `medium`, or `high`.

Interpolation rules:

- `{{model}}` -> the entry's `model`
- `{{effort}}` -> the entry's `effort`

Invoke performs this substitution on each configured argument string immediately before launching the provider command. After interpolation, the prompt text is appended as the last CLI argument. The built-in Codex provider adds `--skip-git-repo-check` before the prompt. Claude and config-driven providers append only the prompt.

Example using the shipped Codex config plus a role entry of `model: o3` and `effort: high`:

```yaml
providers:
  codex:
    cli: codex
    args: ["--dangerously-bypass-approvals-and-sandbox", "exec", "--model", "{{model}}", "-c", "reasoning_effort={{effort}}"]
```

This produces configured args equivalent to:

```text
--dangerously-bypass-approvals-and-sandbox exec --model o3 -c reasoning_effort=high
```

The default Codex provider definition above comes from the pipeline template. Placeholder replacement comes from the provider implementations.
