# Customization Guide

This guide explains how to extend invoke by adding providers, creating new reviewers and researchers, defining custom strategies, and editing existing role prompts.

---

## Adding a provider

A provider is an AI CLI tool that invoke can dispatch agents to. Providers are declared under `providers:` in `.invoke/pipeline.yaml`.

### Steps

1. Open `.invoke/pipeline.yaml` in your project.
2. Add a new key under `providers:` with a `cli` and `args` field.
3. Reference the new provider by name in any role entry under `roles:`.

### Example: adding a Gemini provider

```yaml
providers:
  claude:
    cli: claude
    args: ["--print", "--model", "{{model}}", "--dangerously-skip-permissions"]
  codex:
    cli: codex
    args: ["exec", "--model", "{{model}}", "--full-auto", "-c", "reasoning_effort={{effort}}"]
  gemini:
    cli: gemini
    args: ["--model", "{{model}}", "--yolo"]
```

Once declared, you can assign it to any subrole:

```yaml
roles:
  reviewer:
    code-quality:
      prompt: .invoke/roles/reviewer/code-quality.md
      providers:
        - provider: gemini
          model: gemini-2.5-pro
          effort: high
          timeout: 300
```

### Template variables in `args`

Two variables are interpolated at dispatch time:

- `{{model}}` — replaced with the `model` value from the role's provider entry. For example, `gemini-2.5-pro`.
- `{{effort}}` — replaced with the `effort` value from the role's provider entry: `low`, `medium`, or `high`. Providers that have no effort concept can simply omit this variable from their args.

Invoke validates at startup that each provider's `cli` binary exists on `PATH`. If the binary is missing, an error is reported before any pipeline work begins.

---

## Creating a reviewer

Reviewers run after the build phase and report findings in a structured format. Each reviewer is a subrole under `roles.reviewer` in `pipeline.yaml`, backed by a Markdown prompt file.

### Steps

1. Write the prompt file at `.invoke/roles/reviewer/<name>.md`.
2. Add an entry under `roles.reviewer` in `.invoke/pipeline.yaml`.

### The Finding output format

All reviewer prompts must instruct the agent to use this exact output format for each issue found:

```
### Finding N
**Severity:** critical|high|medium|low
**File:** path/to/file
**Line:** line number
**Issue:** Clear description of the problem
**Suggestion:** Specific fix recommendation
```

If no issues are found, the reviewer should state that explicitly (e.g., "No documentation issues found."). Invoke parses this structured output to aggregate findings across reviewers and present them for triage.

### Example: a documentation reviewer

**`.invoke/roles/reviewer/documentation.md`**

```markdown
# Documentation Reviewer

You are reviewing code for missing or inadequate documentation.

## Code to Review
{{task_description}}

## Diff
{{diff}}

## Project Context
{{project_context}}

## Instructions

Review the changed code for documentation quality, focusing on:

- **Public API coverage** — exported functions, classes, and types missing JSDoc/docstrings
- **Accuracy** — comments that no longer match the code they describe
- **Examples** — complex functions or non-obvious APIs that would benefit from usage examples
- **README gaps** — significant new functionality not reflected in project documentation

## Output Format

If you find issues, report each one using this exact format:

### Finding N
**Severity:** critical|high|medium|low
**File:** path/to/file
**Line:** line number
**Issue:** Clear description of the documentation gap
**Suggestion:** Specific improvement recommendation

If no issues found, state: "No documentation issues found."
```

**`.invoke/pipeline.yaml`** — add under `roles.reviewer`:

```yaml
roles:
  reviewer:
    documentation:
      prompt: .invoke/roles/reviewer/documentation.md
      provider_mode: parallel
      providers:
        - provider: claude
          model: claude-opus-4-6
          effort: medium
          timeout: 300
        - provider: codex
          model: o3
          effort: medium
          timeout: 300
```

`provider_mode: parallel` dispatches all listed providers concurrently and merges their findings. When two providers flag the same file and line (or flag the same file with more than 30% word overlap in the issue text), the findings are deduplicated into one entry. The merged finding includes an `agreedBy` array listing every provider that independently found it. If the providers disagree on severity, the higher severity is kept. Findings are sorted by severity first, then by how many providers agreed. (`src/dispatch/merge-findings.ts:19-44`)

See `defaults/roles/reviewer/security.md` for a complete, production-ready template you can use as a starting point when writing new reviewers.

---

## Creating a researcher

Researchers run during the scope stage to gather context before planning begins. Each researcher is a subrole under `roles.researcher`, backed by a Markdown prompt file.

### Steps

1. Write the prompt file at `.invoke/roles/researcher/<name>.md`.
2. Add an entry under `roles.researcher` in `.invoke/pipeline.yaml`.

### Example: an API contracts researcher

**`.invoke/roles/researcher/api-contracts.md`**

```markdown
# API Contracts Researcher

You are analyzing the existing API surface for a development task.

## Task
{{task_description}}

## Instructions

Analyze the codebase and report on:

### Existing Endpoints
- Documented and undocumented API routes
- Request and response shapes
- Authentication and authorization patterns in use

### Breaking Change Risk
- Consumers of the API (internal and external)
- Fields or behaviors the new work must preserve
- Version negotiation strategies in place

### Conventions
- URL naming patterns
- Error response formats
- Pagination and filtering conventions

## Output Format

Structure your report with the headers above. Include file paths and route definitions where relevant.
```

**`.invoke/pipeline.yaml`** — add under `roles.researcher`:

```yaml
roles:
  researcher:
    api-contracts:
      prompt: .invoke/roles/researcher/api-contracts.md
      providers:
        - provider: claude
          model: claude-opus-4-6
          effort: medium
          timeout: 600
        - provider: codex
          model: o3
          effort: medium
          timeout: 600
```

Research agents are given longer default timeouts (600 seconds) because they read broadly across the codebase. Adjust as needed for your project size.

---

## Creating a builder

Builder subroles let you specialize agents for different task types. Each subrole is a distinct agent persona dispatched during the build phase, with a prompt tuned for its particular kind of work.

### Built-in builder subroles

| Subrole | Intended use |
|---|---|
| `default` | General-purpose implementation tasks |
| `docs` | Documentation updates and additions |
| `integration-test` | Cross-module tests that verify components work together after a build has merged |
| `refactor` | Code quality improvements without behavior changes |
| `migration` | Breaking changes, schema migrations, and dependency upgrades |

(`defaults/roles/builder/`)

### Steps

1. Write the prompt file at `.invoke/roles/builder/<name>.md`.
2. Add an entry under `roles.builder` in `.invoke/pipeline.yaml`.

### Example: a frontend builder

**`.invoke/roles/builder/frontend.md`**

```markdown
# Frontend Builder

You are implementing a UI task as part of a larger development plan.

## Task
{{task_description}}

## Acceptance Criteria
{{acceptance_criteria}}

## Relevant Files
{{relevant_files}}

## Instructions

Implement the changes using the project's existing component library and styling conventions.
Follow the patterns in {{relevant_files}} for structure and naming.
Do not introduce new dependencies without noting them explicitly.
```

**`.invoke/pipeline.yaml`** — add under `roles.builder`:

```yaml
roles:
  builder:
    frontend:
      prompt: .invoke/roles/builder/frontend.md
      providers:
        - provider: claude
          model: claude-opus-4-6
          effort: high
          timeout: 600
```

---

## Creating a planner

Planner subroles produce competing implementation approaches for the same task. Having multiple planners generates distinct plans that can be compared before a build strategy is chosen.

### Built-in planner subroles

| Subrole | Intended use |
|---|---|
| `architect` | Primary implementation plan with full detail |
| `alternative` | Competing approach that explores a different design direction |

(`defaults/roles/planner/`)

### Steps

1. Write the prompt file at `.invoke/roles/planner/<name>.md`.
2. Add an entry under `roles.planner` in `.invoke/pipeline.yaml`.

### Example: a minimal planner

**`.invoke/roles/planner/conservative.md`**

```markdown
# Conservative Planner

You are creating a low-risk implementation plan that minimizes surface-area changes.

## Spec
{{task_description}}

## Acceptance Criteria
{{acceptance_criteria}}

## Relevant Files
{{relevant_files}}

## Instructions

Produce a step-by-step plan that:
- Touches as few files as possible
- Reuses existing abstractions rather than creating new ones
- Defers any non-essential cleanup to a separate task
```

**`.invoke/pipeline.yaml`** — add under `roles.planner`:

```yaml
roles:
  planner:
    conservative:
      prompt: .invoke/roles/planner/conservative.md
      providers:
        - provider: claude
          model: claude-opus-4-6
          effort: medium
          timeout: 300
```

---

## Creating a strategy

A strategy prompt instructs builder agents on how to approach implementation — for example, writing tests first or implementing in a spike-and-stabilize loop. Strategies are referenced by name in `settings.default_strategy` and can also be selected at the start of a pipeline run.

### Steps

1. Write the prompt file at `.invoke/strategies/<name>.md`.
2. Add an entry under `strategies:` in `.invoke/pipeline.yaml`.

### Template variables available in strategy prompts

| Variable | Description |
|---|---|
| `{{task_description}}` | The full description of the task being implemented |
| `{{acceptance_criteria}}` | The list of acceptance criteria from the spec |
| `{{relevant_files}}` | Files identified during research as relevant to this task |
| `{{interfaces}}` | Interfaces and type signatures the implementation must conform to |

### Example: a spike-and-stabilize strategy

**`.invoke/strategies/spike-and-stabilize.md`**

```markdown
# Spike-and-Stabilize Strategy

You are building a feature using a spike-and-stabilize approach.

## Task
{{task_description}}

## Acceptance Criteria
{{acceptance_criteria}}

## Relevant Files
{{relevant_files}}

## Interfaces
{{interfaces}}

## Instructions

1. **Spike** — Write the simplest possible implementation that demonstrates the feature works end-to-end. Do not worry about edge cases, error handling, or test coverage at this stage.
2. **Verify** — Run the application manually against each acceptance criterion. Identify anything missing or broken.
3. **Stabilize** — Refactor the spike into production-quality code: add error handling, cover edge cases, write tests.
4. **Commit** — Commit only the stabilized version.

## Rules

- The spike is throwaway — rewrite freely during stabilization.
- Tests are written against the stabilized implementation, not the spike.
- Do not commit spike code.
```

**`.invoke/pipeline.yaml`** — add under `strategies:`:

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
  spike-and-stabilize:
    prompt: .invoke/strategies/spike-and-stabilize.md
```

To make the new strategy the default, update `settings.default_strategy`:

```yaml
settings:
  default_strategy: spike-and-stabilize
```

---

## Using invoke-manage

The `invoke-manage` skill in Claude Code provides an alternative to editing `pipeline.yaml` by hand. It accepts natural-language requests and translates them into structured config operations. `invoke-manage` writes the change to `pipeline.yaml` first, then reloads and validates the updated config. If validation fails, the error is surfaced but the file has already been written.

### Operations

| Operation | What it does |
|---|---|
| `add_role` | Create a new role or subrole entry under `roles.<group>` |
| `remove_role` | Delete a subrole entry |
| `add_strategy` | Create a new strategy entry under `strategies:` |
| `remove_strategy` | Delete a strategy entry |
| `update_settings` | Update one or more fields under `settings:` |

Each operation reads the current `pipeline.yaml`, applies the change, and writes it back. The config is then reloaded through the normal validation path. If the reload detects an invalid configuration, the error is surfaced — but the file has already been written, so you may need to fix it manually or re-run the operation. (`src/tools/config-manager.ts:128-134`)

### Example

To create a new reviewer for API documentation:

> Create a new reviewer for API documentation. Use claude-opus-4-6 with medium effort.

Invoke-manage will prompt you for the prompt file path if not specified, write the entry under `roles.reviewer` in `pipeline.yaml`, and confirm what changed.

To update the default strategy to `spike-and-stabilize`:

> Set the default strategy to spike-and-stabilize.

(`src/tools/config-update-tools.ts:26-67`)

---

## Modifying role prompts

### Where prompts live

All prompt files for roles are stored under `.invoke/` in your project:

```
.invoke/
  roles/
    researcher/   ← researcher prompts
    planner/      ← planner prompts
    builder/      ← builder prompts
    reviewer/     ← reviewer prompts
  strategies/     ← strategy prompts
```

Each file is plain Markdown. Invoke reads it at dispatch time, substitutes template variables, and sends it to the configured provider.

### Available template variables in role prompts

| Variable | Available in | Description |
|---|---|---|
| `{{task_description}}` | All roles | The task or feature description passed to this agent |
| `{{project_context}}` | All roles | Filtered contents of `.invoke/context.md` (see below) |
| `{{diff}}` | Reviewer roles | The git diff of changes being reviewed |
| `{{acceptance_criteria}}` | Builder, planner roles | The list of acceptance criteria from the spec |
| `{{relevant_files}}` | Builder, planner roles | Files identified during research as relevant to this task |
| `{{interfaces}}` | Builder, planner roles | Interfaces and type signatures the implementation must conform to |
| `{{strategy}}` | Builder roles | The name of the selected strategy (e.g., `tdd`); the strategy prompt content is appended to the role prompt automatically |

(`src/dispatch/prompt-composer.ts:245`, `src/dispatch/engine.ts:47-56`)

### How `{{project_context}}` is filtered

`{{project_context}}` is not a raw dump of `.invoke/context.md`. When the context file exceeds 4000 characters, the prompt composer filters its `##`-headed sections before injecting them. The filtering rules are: (`src/dispatch/prompt-composer.ts:6-95`)

- **Always included:** sections whose headers contain `purpose`, `tech stack`, `conventions`, or `constraints`.
- **Included for builder and planner roles:** sections whose headers contain `architecture`.
- **Included for reviewer roles:** sections whose headers contain `completed work`.
- **Included for all roles:** sections whose headers share a keyword with the task context (task description, acceptance criteria, etc.).
- **Excluded:** sections that match none of the above.

If the filtered result still exceeds 4000 characters, it is truncated at that limit with a `(truncated)` marker appended. If the context file is 4000 characters or shorter, all sections are passed through without filtering.

This means context sections that are not relevant to the current role or task are silently omitted. If an agent appears to be missing architectural or background information, check whether the relevant section heading matches one of the inclusion rules above.

### Tips for writing effective prompts

**Be specific about output format.** Invoke parses reviewer output to extract findings. If the Finding format is not present in the prompt, the agent may return free-form text that cannot be aggregated. Always include the exact format block.

**Narrow the focus.** Each role should do one thing well. A reviewer prompt that covers security, performance, and documentation at once produces diluted results. Split concerns across separate subroles.

**Use the project context.** Reference `{{project_context}}` in your prompts to give agents awareness of conventions, architecture decisions, and known issues. This is especially valuable for reviewers checking for convention violations.

**Match effort to the task.** Research and planning roles that read broadly across a codebase benefit from `effort: high` and longer timeouts. Build roles working on a single well-defined task can often use `effort: high` with the default timeout.

**Test by reading.** Before saving a new prompt, read it aloud as if you are the AI receiving it. Ambiguous instructions produce inconsistent results — clarify anything that could be interpreted more than one way.
