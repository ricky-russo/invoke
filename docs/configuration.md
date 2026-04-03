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
| `builder` | Executes the implementation tasks produced by the planner. The `default` subrole handles general-purpose build work. |
| `reviewer` | Reviews completed work across six dimensions: `spec-compliance`, `security`, `code-quality`, `performance`, `ux`, and `accessibility`. |

### Subrole fields

Each subrole entry requires a `prompt` path and at least one provider, declared in one of two formats.

#### `prompt`

Type: `string`

Path to the Markdown prompt file for this subrole, relative to the project root.

```yaml
prompt: .invoke/roles/researcher/codebase.md
```

#### Multi-provider array format

Declare a `providers` array to enable provider fallback. If the first provider fails or times out, invoke tries the next one in order.

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

---

## Settings

The `settings` block controls global pipeline behaviour.

```yaml
settings:
  default_strategy: tdd
  agent_timeout: 300
  commit_style: per-batch
  work_branch_prefix: invoke/work
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

## Validation

Invoke validates the full `pipeline.yaml` against its schema at startup using [Zod](https://zod.dev). Validation checks include:

- All required fields are present and have the correct type
- `effort` values are one of `low`, `medium`, or `high`
- `commit_style` is one of the four recognised values
- `agent_timeout` and per-role `timeout` values are positive numbers
- Each subrole has either a `providers` array or the inline `provider`/`model`/`effort` shorthand — but not an incomplete combination of both

Configuration warnings and errors are printed to the console before any pipeline work begins.

You can also trigger validation explicitly through the `invoke_validate_config` tool without running a full pipeline. This is useful when editing the configuration to catch mistakes early.

For common validation errors and how to resolve them, see [troubleshooting.md](./troubleshooting.md).
