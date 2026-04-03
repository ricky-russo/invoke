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

Invoke validates at startup that each provider's `cli` binary exists on `PATH`. If the binary is missing, a warning is printed before any pipeline work begins.

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
      providers:
        - provider: claude
          model: claude-opus-4-6
          effort: medium
          timeout: 300
```

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
| `{{diff}}` | Reviewer roles | The git diff of changes being reviewed |
| `{{project_context}}` | All roles | Contents of `.invoke/context.md` (see project-context.md) |

The `{{project_context}}` variable is populated automatically from `.invoke/context.md` if that file exists. It is truncated at 4000 characters if the file is large.

Strategy prompts also receive `{{acceptance_criteria}}`, `{{relevant_files}}`, and `{{interfaces}}` as described in the strategies section above.

### Tips for writing effective prompts

**Be specific about output format.** Invoke parses reviewer output to extract findings. If the Finding format is not present in the prompt, the agent may return free-form text that cannot be aggregated. Always include the exact format block.

**Narrow the focus.** Each role should do one thing well. A reviewer prompt that covers security, performance, and documentation at once produces diluted results. Split concerns across separate subroles.

**Use the project context.** Reference `{{project_context}}` in your prompts to give agents awareness of conventions, architecture decisions, and known issues. This is especially valuable for reviewers checking for convention violations.

**Match effort to the task.** Research and planning roles that read broadly across a codebase benefit from `effort: high` and longer timeouts. Build roles working on a single well-defined task can often use `effort: high` with the default timeout.

**Test by reading.** Before saving a new prompt, read it aloud as if you are the AI receiving it. Ambiguous instructions produce inconsistent results — clarify anything that could be interpreted more than one way.
