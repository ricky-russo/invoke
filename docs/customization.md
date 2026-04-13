# Customization Guide

This guide covers the parts of Invoke you customize most often: role prompts, strategy prompts, and presets.

## 1. Overview

Invoke reads `.invoke/pipeline.yaml` on each config load.
That file defines role groups, subroles, strategies, settings, and optional inline presets.

The main customization points are here:

```text
.invoke/
  pipeline.yaml
  roles/
    researcher/
    planner/
    builder/
    reviewer/
  strategies/
```

In practice:

- Edit `.invoke/pipeline.yaml` to register or repoint roles, strategies, and presets.
- Add or edit role prompts under `.invoke/roles/<group>/<name>.md`.
- Add or edit strategy prompts under `.invoke/strategies/<name>.md`.

Each role entry needs a `prompt` path and at least one provider entry.
Validation checks that the prompt file exists.

## 2. Customizing Roles

Role customization has two steps:

1. Create the prompt file under `.invoke/roles/<group>/<name>.md`.
2. Add a matching entry under `roles.<group>.<name>` in `.invoke/pipeline.yaml`.

The default setup uses four role groups: `researcher`, `planner`, `builder`, and `reviewer`.

### Example: add a new reviewer

Create `.invoke/roles/reviewer/documentation.md`:

```markdown
# Documentation Reviewer

## Specification
{{task_description}}

## Diff
{{diff}}

## Scope
{{scope_delim_start}}
{{scope}}
{{scope_delim_end}}

## Prior Findings
{{prior_findings_delim_start}}
{{prior_findings}}
{{prior_findings_delim_end}}

## Instructions

Review only documentation changes implied by the spec and the diff.
Focus on missing updates, inaccurate comments, and public-facing docs that no longer match the code.
```

Then register it in `.invoke/pipeline.yaml`:

```yaml
roles:
  reviewer:
    documentation:
      prompt: .invoke/roles/reviewer/documentation.md
      providers:
        - provider: claude
          model: claude-sonnet-4-6
          effort: medium
          timeout: 300
```

This matches the same shape as the shipped reviewer roles.
Use a prompt path plus a `providers` array.

If the prompt file is missing, validation reports an error on `roles.<group>.<subrole>.prompt`.

## 3. Writing Effective Prompts

Prompt rendering has four parts:

1. Invoke reads the role prompt file.
2. If a strategy is selected, Invoke appends the strategy prompt.
3. Invoke injects `{{project_context}}` when the prompt references it.
4. Invoke replaces `{{word}}` placeholders from the current task context.

### Placeholder Reference

The renderer supports any `{{word}}` key in `taskContext`.
If a value is missing, Invoke leaves the placeholder unchanged.

| Placeholder | Common use | Notes |
|---|---|---|
| `{{task_description}}` | Most built-in roles and strategies | Main task text |
| `{{acceptance_criteria}}` | Builder and strategy prompts | Acceptance criteria block |
| `{{relevant_files}}` | Builder and strategy prompts | File list or paths |
| `{{interfaces}}` | Builder and strategy prompts | Interface notes |
| `{{research_context}}` | Planner prompts | Research summary from the plan stage |
| `{{project_context}}` | Any role prompt | Filtered from `.invoke/context.md` when present |
| `{{strategy}}` | Prompts that read a task-context strategy value | Separate from strategy prompt selection |
| `{{diff}}` | Reviewer prompts | Changed files or patch text |
| `{{scope}}` | Reviewer prompts | Scope block for review |
| `{{prior_findings}}` | Builder and reviewer prompts | Review follow-up context |
| `{{scope_delim_start}}` / `{{scope_delim_end}}` | Reviewer prompts | Marks untrusted scope data |
| `{{prior_findings_delim_start}}` / `{{prior_findings_delim_end}}` | Builder and reviewer prompts | Marks untrusted findings data |

### Prompt-writing guidance

- Keep prompts narrow. Split roles by job instead of combining several jobs into one prompt.
- Prefer placeholders over copied task text. Invoke fills task context during dispatch.
- Use delimiter placeholders around untrusted `scope` and `prior_findings` content.
- Add `{{project_context}}` only where the role needs shared project memory.

## 4. Strategy Customization

Strategies are separate prompt files, not separate roles.
When a builder request selects a strategy, Invoke appends that strategy prompt to the builder prompt.

Invoke ships `tdd`, `implementation-first`, `prototype`, and `bug-fix`.
For the built-in list and behavior summaries, see [Strategies](configuration.md#strategies).

To customize strategy behavior, edit a file in `.invoke/strategies/` or add a new entry in `.invoke/pipeline.yaml`:

```yaml
strategies:
  tdd:
    prompt: .invoke/strategies/tdd.md
  docs-safe:
    prompt: .invoke/strategies/docs-safe.md
```

Each strategy entry maps a name to a prompt path.

## 5. Presets

Presets are named bundles of optional settings and selection lists.
A preset can define `name`, `description`, `settings`, `researcher_selection`, `reviewer_selection`, and `strategy_selection`.

Activate a preset by setting `settings.preset`.

### Inline preset example

```yaml
settings:
  preset: quick

presets:
  quick:
    settings:
      default_strategy: implementation-first
      max_review_cycles: 1
    reviewer_selection:
      - spec-compliance
```

### File-based preset example

Create `.invoke/presets/ci-light.yaml`:

```yaml
settings:
  default_strategy: implementation-first
  max_parallel_agents: 1
  max_review_cycles: 1
reviewer_selection:
  - spec-compliance
```

Then activate it in `.invoke/pipeline.yaml`:

```yaml
settings:
  preset: ci-light
```

For preset resolution order and merge behavior, see [Presets](configuration.md#presets).

## 6. Using `invoke-manage`

If you do not want to edit YAML, use `invoke-manage`.
The router sends requests like "add a reviewer" or "edit strategy" to that skill.

At a user level, `invoke-manage` can:

- List configured roles and strategies.
- Create, edit, and remove roles.
- Create, edit, and remove strategies.
- Update settings conversationally.

It writes `.invoke/pipeline.yaml` and reloads the config through the normal validation path.

## 7. Prompt Size Tips

Longer prompts cost more.
Fields like `diff`, `scope`, `prior_findings`, and `project_context` can dominate prompt size.

Keep prompts concise:

- Keep each custom role focused on one job.
- Keep strategy prompts short when possible.
- Trim `research_context`, `scope`, and `prior_findings` to the current cycle.
- Use `{{project_context}}` only where the role needs it.
- Keep clear `##` headings in `.invoke/context.md` so filtering works well.

For provider-mode cost tradeoffs, see [Cost Guidance](providers.md#cost-guidance).
