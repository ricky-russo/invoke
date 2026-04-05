# Configuration Reference

Invoke is configured through `.invoke/pipeline.yaml` in your project root. This file defines the AI providers available to the pipeline, the roles agents play, the strategies that govern execution order, and global settings.

When invoke starts it validates the full configuration against its schema and surfaces any warnings before proceeding. See [Validation](#validation) for details.

---

## File location

```
<project-root>/
  .invoke/
    pipeline.yaml     ← main configuration file
    roles/            ← prompt files referenced by roles
    strategies/       ← prompt files referenced by strategies
    presets/          ← optional project-local preset files
```

---

## Providers

The `providers` map declares every AI CLI tool that invoke can dispatch to. Keys are arbitrary names you choose; they are referenced from role definitions.

```yaml
providers:
  claude:
    cli: claude
    args: ["--print", "--model", "{{model}}", "--dangerously-skip-permissions"]
  codex:
    cli: codex
    args: ["exec", "--model", "{{model}}", "--full-auto", "-c", "reasoning_effort={{effort}}"]
```

### `providers.<name>.cli`

Type: `string`

The CLI binary name that invoke will execute. The binary must be on `PATH`. Examples: `claude`, `codex`.

### `providers.<name>.args`

Type: `string[]`

Array of arguments passed to the CLI binary. Two template variables are interpolated at dispatch time:

- `{{model}}` — replaced with the `model` value from the role's provider entry
- `{{effort}}` — replaced with the `effort` value from the role's provider entry (`low`, `medium`, or `high`)

You can include these variables anywhere in the args array. Providers that do not use a particular variable (e.g., a provider that has no effort concept) simply omit it from the args.

---

## Roles

The `roles` map organises agents into four named groups. Each group contains one or more subroles. Invoke runs the appropriate subroles for each stage of the pipeline.

```yaml
roles:
  researcher:   # discovery and analysis before planning
    codebase: ...
    best-practices: ...
    dependencies: ...

  planner:      # architecture and alternative approaches
    architect: ...
    alternative: ...

  builder:      # implementation
    default: ...
    docs: ...
    integration-test: ...
    refactor: ...
    migration: ...

  reviewer:     # post-build quality checks
    spec-compliance: ...
    security: ...
    code-quality: ...
    performance: ...
    ux: ...
    accessibility: ...
```

### Role groups

| Group | Purpose |
|---|---|
| `researcher` | Analyses the existing codebase, third-party best practices, and dependency landscape before a plan is written. Subroles: `codebase`, `best-practices`, `dependencies`. |
| `planner` | Produces the implementation plan. The `architect` subrole generates the primary plan; the `alternative` subrole generates a competing approach so the orchestrator can compare them. |
| `builder` | Executes the implementation tasks produced by the planner. Five subroles are available — see [Builder subroles](#builder-subroles) below. |
| `reviewer` | Reviews completed work across six dimensions: `spec-compliance`, `security`, `code-quality`, `performance`, `ux`, and `accessibility`. |

### Builder subroles

Each builder subrole has a distinct focus. The orchestrator assigns tasks to the appropriate subrole based on the nature of the work.

| Subrole | Intended use |
|---|---|
| `default` | General-purpose implementation work — new features, modifications, and anything without a more specific category. |
| `docs` | Documentation updates: README files, API references, inline comments, and other written material. |
| `integration-test` | Cross-module and end-to-end tests that exercise multiple components working together. |
| `refactor` | Code quality improvements that change structure without altering behaviour: renaming, extracting, simplifying. |
| `migration` | Breaking changes and data migrations: schema changes, renamed APIs, format upgrades. |

### Subrole fields

Each subrole entry requires a `prompt` path and at least one provider, declared in one of two formats.

#### `prompt`

Type: `string`

Path to the Markdown prompt file for this subrole, relative to the project root.

```yaml
prompt: .invoke/roles/researcher/codebase.md
```

#### Multi-provider array format

Declare a `providers` array when you want to assign multiple providers to a subrole. The `provider_mode` field (see below) controls how those providers are used.

```yaml
roles:
  researcher:
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

#### Shorthand single-provider format

When you only need one provider, you can inline the fields directly on the subrole instead of nesting a `providers` array.

```yaml
roles:
  builder:
    default:
      prompt: .invoke/roles/builder/default.md
      provider: claude
      model: claude-sonnet-4-6
      effort: high
```

Invoke normalises the shorthand into the same internal structure as the array format. You cannot mix both formats on the same subrole — use one or the other.

#### `provider_mode`

Type: `"parallel" | "fallback" | "single"`, optional

Controls how invoke uses multiple providers for a subrole. This field is ignored when the subrole has only one provider configured — single-provider subroles always dispatch to that one provider regardless of this setting.

**Mode resolution order** (first defined value wins):

1. `provider_mode` on the subrole itself
2. `settings.default_provider_mode` in the settings block
3. `'parallel'` (built-in default)

If a subrole has only one provider configured, the mode is forced to `'single'` regardless of any setting.

**Mode behaviours:**

| Mode | Behaviour |
|---|---|
| `parallel` | All providers are dispatched concurrently. Results are merged when all complete. |
| `fallback` | Providers are tried in order. The first provider to succeed returns its result; subsequent providers are not called. |
| `single` | Only `providers[0]` is dispatched. Additional entries in the array are ignored. |

**Parallel result merging:**

When running in `parallel` mode with multiple providers, invoke merges results as follows:

- **Reviewer roles** (subroles that produce `findings`): Findings are deduplicated by file and line number (or by word overlap in the issue text when no line number is present). Findings from multiple providers that match the same location are merged into one entry; the `agreedBy` array on the merged finding lists every provider that flagged it. When providers disagree on severity, the higher severity is kept.
- **Non-reviewer roles**: Reports are concatenated in sequence, with a `## {provider} ({model})` header before each provider's output.

```yaml
roles:
  reviewer:
    spec-compliance:
      prompt: .invoke/roles/reviewer/spec-compliance.md
      provider_mode: parallel
      providers:
        - provider: claude
          model: claude-opus-4-6
          effort: high
          timeout: 300
        - provider: codex
          model: o3
          effort: high
          timeout: 300
```

### Provider entry fields

#### `provider`

Type: `string`

Must match a key defined under `providers:` at the top level.

#### `model`

Type: `string`

The model identifier passed to the CLI at runtime via the `{{model}}` template variable. Examples: `claude-opus-4-6`, `claude-sonnet-4-6`, `o3`.

#### `effort`

Type: `"low" | "medium" | "high"`

Reasoning effort level. Passed to the CLI via the `{{effort}}` template variable. Higher effort typically produces better results at the cost of latency and token usage.

#### `timeout`

Type: `number` (seconds), optional

Per-subrole timeout in seconds. When set, this overrides the global `settings.agent_timeout` for this specific subrole. Useful for long-running research or architecture roles that need more time than the default.

```yaml
providers:
  - provider: claude
    model: claude-opus-4-6
    effort: high
    timeout: 600   # 10 minutes, overrides the global 300-second default
```

---

## Strategies

The `strategies` map defines named execution strategies. A strategy prompt instructs the orchestrator on how to sequence and structure the build phase.

```yaml
strategies:
  tdd:
    prompt: .invoke/strategies/tdd.md
  implementation-first:
    prompt: .invoke/strategies/implementation-first.md
  prototype:
    prompt: .invoke/strategies/prototype.md
  bug-fix:
    prompt: .invoke/strategies/bug-fix.md
```

### `strategies.<name>.prompt`

Type: `string`

Path to the strategy prompt Markdown file, relative to the project root.

### Default strategies

| Name | Description |
|---|---|
| `tdd` | Test-driven development. Builder agents write tests first, then implementation. |
| `implementation-first` | Implementation is written before tests, suitable for well-understood features. |
| `prototype` | Rapid exploration with minimal structure. Useful for spikes and proof-of-concept work. |
| `bug-fix` | Focused diagnostic and fix workflow. Orients research and build phases around reproducing and resolving a defect. |

### Auto-detection

When you describe a task, invoke scans the description for keywords and suggests a strategy before asking you to confirm. The suggestion is advisory only — you always make the final choice.

| Keywords found | Suggested strategy |
|---|---|
| `fix`, `bug`, `regression`, `broken` | `bug-fix` |
| `prototype`, `spike`, `mvp`, `quickly`, `urgent` | `prototype` |
| `test` + existing test files detected | `tdd` |
| No strong pattern | `tdd` (default) |

Two or more matching keywords from the same group raise the confidence level from `medium` to `high`. Invoke displays the suggestion and its reasoning; you select the strategy to use.

---

## Settings

The `settings` block controls global pipeline behaviour.

```yaml
settings:
  default_strategy: tdd
  agent_timeout: 300
  commit_style: per-batch
  work_branch_prefix: invoke/work
  default_provider_mode: parallel
  max_review_cycles: 3
  post_merge_commands:
    - composer install
```

### `default_strategy`

Type: `string`

The strategy used when the user does not specify one at invocation time. Must match a key defined under `strategies:`.

### `agent_timeout`

Type: `number` (seconds)

Default: `300`

Global fallback timeout for all agent dispatches. Any subrole that does not define its own `timeout` field will be subject to this limit. Must be a positive number.

### `commit_style`

Type: `"one-commit" | "per-batch" | "per-task" | "custom"`

Controls how invoke creates git commits during the build phase.

| Value | Behaviour |
|---|---|
| `one-commit` | All changes from the entire pipeline run are squashed into a single commit. |
| `per-batch` | One commit is created after each batch of parallel tasks completes. |
| `per-task` | Each individual task produces its own commit when its worktree is merged. |
| `custom` | Invoke makes no automatic commits. You manage git history yourself. |

### `work_branch_prefix`

Type: `string`

String prefix used when invoke creates work branches and worktrees. For example, with `invoke/work`, invoke creates branches like `invoke/work/abc123`.

### `preset`

Type: `string`, optional

Name of the preset to activate for this pipeline run. When set, invoke loads the named preset and uses its values as a base, then applies any values explicitly defined in `settings` on top. See [Presets](#presets) for details.

```yaml
settings:
  preset: quick
```

### `stale_session_days`

Type: `number`, optional

Default: `7`

Number of days after which a session is considered stale and eligible for cleanup. Must be a positive number.

### `default_provider_mode`

Type: `"parallel" | "fallback" | "single"`, optional

Global default dispatch mode for subroles that have multiple providers configured but no explicit `provider_mode` set. When omitted, `parallel` is used. Subroles can override this per-subrole with their own `provider_mode` field.

### `max_parallel_agents`

Type: `number`, optional

Maximum number of agents that invoke will run in parallel within a single batch. When omitted, there is no limit and all tasks in a batch run concurrently. Use this to reduce load on API services or avoid hitting rate limits.

### `max_dispatches`

Type: `number`, optional

Global cap on the total number of agent dispatches across the entire pipeline run. Invoke will not start new dispatches once this limit is reached. Must be a positive number when set.

### `max_review_cycles`

Type: `number` (nonnegative), optional

Maximum number of review iterations invoke will run per batch. Set to `0` to skip review entirely. When omitted, review cycles continue until reviewers find no new issues or the orchestrator decides the work is complete.

### `review_tiers`

Type: array of `{ name: string, reviewers: string[] }` or dict, optional

Groups reviewer subroles into named tiers. Invoke runs tiers sequentially, so a lighter first tier can gate access to a more expensive second tier.

Two formats are accepted:

```yaml
# Array format (explicit ordering):
settings:
  review_tiers:
    - name: critical
      reviewers: [spec-compliance, security]
    - name: quality
      reviewers: [code-quality, performance]
    - name: polish
      reviewers: [ux, accessibility]

# Dict format (order not guaranteed):
settings:
  review_tiers:
    critical: [spec-compliance, security]
    quality: [code-quality, performance]
```

Each reviewer name must match a subrole key defined under `roles.reviewer`. Invoke warns at startup if a tier references an undefined reviewer.

### `post_merge_commands`

Type: `string[]`, optional

Commands to run in the project root after invoke merges each worktree back into the work branch. Use this to regenerate lockfiles or perform other housekeeping that must happen after file changes are merged.

```yaml
post_merge_commands:
  - composer install
  - npm install
```

Each command is executed sequentially in a shell. If a command fails, invoke surfaces the error but continues merging remaining worktrees.

---

## Presets

Presets are named bundles of settings and selections that you can activate by name. They are useful for switching between pipeline configurations without editing the full settings block each time.

### Preset schema

```yaml
name: my-preset           # optional, defaults to the file or key name
description: "..."        # optional, human-readable description
settings:                 # optional, partial Settings — overrides global defaults
  default_strategy: tdd
  max_review_cycles: 2
researcher_selection:     # optional, list of researcher subrole keys to include
  - codebase
reviewer_selection:       # optional, list of reviewer subrole keys to include
  - spec-compliance
  - security
strategy_selection:       # optional, list of strategy names to offer at dispatch time
  - tdd
  - bug-fix
```

All fields are optional. A preset that only sets `reviewer_selection` is valid.

### Loading order

When `settings.preset` is set, invoke locates the preset in this order:

1. `presets.<name>` defined inline in `pipeline.yaml`
2. `.invoke/presets/<name>.yaml` in the project directory
3. `defaults/presets/<name>.yaml` shipped with invoke

The first match found is used. If none is found, invoke emits a warning and continues with the base configuration.

### Merge behaviour

Preset `settings` values form the **base**. Values explicitly defined in the `settings` block of `pipeline.yaml` are applied on top as overrides. This means you can activate a preset and still override specific fields in-place.

- **Objects** are merged recursively: only keys present in the override replace their counterparts in the base.
- **Arrays** replace entirely: if the override defines an array, the preset's array is discarded.

### Activating a preset

```yaml
settings:
  preset: quick
  # Any settings here override the preset's values:
  max_review_cycles: 2
```

### Defining inline presets

You can define presets directly in `pipeline.yaml` under the top-level `presets` key. Inline presets take priority over file-based presets with the same name.

```yaml
settings:
  preset: minimal

presets:
  minimal:
    description: Minimal pipeline for routine changes
    settings:
      default_strategy: implementation-first
      max_review_cycles: 1
    reviewer_selection:
      - spec-compliance
    strategy_selection:
      - implementation-first
      - bug-fix
```

### Built-in presets

Three presets are included with invoke and available without any additional files:

| Preset | Description | Key settings |
|---|---|---|
| `quick` | Fast pipeline for small changes with limited review coverage. | `default_strategy: implementation-first`, `max_review_cycles: 1`, `max_parallel_agents: 2` |
| `thorough` | Full pipeline with maximum review and strategy coverage. | `default_strategy: tdd`, `max_review_cycles: 5` |
| `prototype` | Rapid iteration with minimal review overhead. | `default_strategy: prototype`, `max_review_cycles: 0` |

The `quick` preset limits researchers to `codebase` only and reviewers to `spec-compliance` and `security`. The `thorough` preset enables all six reviewer subroles. The `prototype` preset sets `reviewer_selection: []`, disabling review entirely.

---

## Validation

Invoke validates the full `pipeline.yaml` against its schema at startup using [Zod](https://zod.dev). Validation checks include:

**Schema checks** (errors that block startup):

- All required fields are present and have the correct type
- `effort` values are one of `low`, `medium`, or `high`
- `commit_style` is one of the four recognised values
- `agent_timeout` and per-role `timeout` values are positive numbers
- Each subrole has either a `providers` array or the inline `provider`/`model`/`effort` shorthand — but not an incomplete combination of both

**Semantic checks** (errors that block startup):

- **CLI existence** — each provider's `cli` binary is found on `PATH` via `which`. If not found, invoke emits an error for that provider.
- **Default strategy** — `settings.default_strategy` references a key that exists under `strategies:`.
- **Provider references** — every `provider` name used in a subrole entry exists as a key under the top-level `providers:` map.
- **Prompt file existence** — each subrole's `prompt` path resolves to a file on disk.

**Warnings** (non-blocking, printed before pipeline work begins):

- **Model format** — model identifiers are checked against known patterns for each provider. For `claude`, valid formats are `claude-{family}-{version}` (e.g. `claude-opus-4-6`) or the short aliases `opus`, `sonnet`, and `haiku`. For `codex`, valid formats are `o{digit}` (e.g. `o3`, `o1-mini`), `gpt-*`, and `codex-*`. Unknown providers allow any model string.
- **Timeout magnitude** — a `timeout` value greater than `3600` is flagged as likely being in milliseconds instead of seconds, with a suggested corrected value.
- **Multi-provider without explicit mode** — a subrole with more than one provider and no `provider_mode` field will implicitly fan out to all providers in parallel. Invoke warns so you can set an explicit mode.
- **Review tier references** — reviewer names listed in `settings.review_tiers` are checked against defined subroles under `roles.reviewer`.
- **Preset resolution** — when `settings.preset` is set, invoke checks that the named preset can be found in an inline block, a project-local file, or a built-in file. If none is found, invoke warns and lists available preset names.

You can also trigger validation explicitly through the `invoke_validate_config` tool without running a full pipeline. This is useful when editing the configuration to catch mistakes early.

For common validation errors and how to resolve them, see [troubleshooting.md](./troubleshooting.md).
