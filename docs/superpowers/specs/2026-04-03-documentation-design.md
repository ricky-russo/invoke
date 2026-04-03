# Invoke Documentation

**Date:** 2026-04-03
**Status:** Draft

## Goal

Create comprehensive user-facing and contributor documentation for invoke, covering installation, configuration, pipeline usage, customization, and development.

## Problem

Invoke has no user-facing documentation. The only docs are internal design specs and implementation plans. Users who install invoke have no way to learn how it works, how to configure it, or how to customize it.

## Requirements

### Files to create

| File | Audience | Purpose |
|---|---|---|
| `README.md` | End users | Quick-start, overview, pipeline diagram, feature highlights |
| `CONTRIBUTING.md` | Contributors | Dev setup, architecture, testing, PR guidelines |
| `docs/configuration.md` | End users | Full pipeline.yaml reference |
| `docs/pipeline-stages.md` | End users | Deep dive on each pipeline stage |
| `docs/customization.md` | End users | Creating roles, reviewers, strategies, providers |
| `docs/project-context.md` | End users | How context.md works |
| `docs/troubleshooting.md` | End users | Common issues, validation errors, recovery |

### README.md

1. **Header** — Name, one-line description
2. **What is invoke?** — 2-3 sentences: AI-assisted development pipeline that orchestrates multiple AI agents through scope, plan, orchestrate, build, review
3. **Pipeline diagram** — Mermaid flowchart showing the 5 stages with brief descriptions
4. **Quick start** — Install into a project, init, configure providers/models, start first pipeline. Minimal steps.
5. **How it works** — Brief explanation of each stage (2-3 sentences each) with links to `docs/pipeline-stages.md`
6. **Configuration** — Minimal pipeline.yaml example showing providers, one role, settings. Link to `docs/configuration.md`
7. **Key features** — Bullet list: multi-provider dispatch, parallel builds with git worktrees, inter-batch review, spec-compliance reviewer, project context system, session recovery, configurable timeouts, post-merge commands
8. **Documentation** — Links to all docs/ files
9. **License** — MIT

### CONTRIBUTING.md

1. **Dev setup** — Clone, `npm install`, `npm run build`, `npx vitest run`
2. **Architecture overview** — MCP server entry point (`src/index.ts`), key modules: config loader, config validator, dispatch engine, batch manager, state manager, worktree manager, artifact manager, context manager, prompt composer. How they connect.
3. **Testing** — `npx vitest run` for all, `npx vitest run tests/path` for specific. Fixture patterns (temp dirs, beforeEach/afterEach cleanup). Integration tests vs unit tests.
4. **Plugin structure** — `.claude-plugin/plugin.json` and `marketplace.json` for plugin metadata. `.mcp.json` for MCP server registration. `hooks/` for session-start and post-merge hooks. `skills/` for pipeline stage skills. `defaults/` for init templates.
5. **PR guidelines** — Conventional commits (`feat:`, `fix:`, `docs:`). Run tests before submitting. One concern per PR.

### docs/configuration.md

Full reference for every field in `pipeline.yaml`:

- `providers` — cli, args, template variables (`{{model}}`, `{{effort}}`)
- `roles` — role groups (researcher, planner, builder, reviewer), subroles, prompt files, provider entries (provider, model, effort, timeout)
- `strategies` — prompt file reference, what strategies are, the 4 defaults (tdd, implementation-first, prototype, bug-fix)
- `settings` — default_strategy, agent_timeout (seconds), commit_style, work_branch_prefix, post_merge_commands

Each field gets: description, type, default value, example.

### docs/pipeline-stages.md

For each of the 5 stages:

- **What it does** — purpose and output
- **What tools are called** — which MCP tools the skill invokes
- **User interaction points** — where the user makes decisions
- **Artifacts produced** — what files are saved to `.invoke/`
- **Resuming** — what happens if the session is interrupted at this stage

Stages: scope (research + spec), plan (competing plans + selection), orchestrate (task breakdown), build (parallel dispatch + merge + inter-batch review), review (multi-reviewer + triage + fix loop).

### docs/customization.md

Step-by-step guides for:

- **Adding a provider** — add to `providers:` section, configure CLI and args
- **Creating a reviewer** — write the prompt .md file, add to `roles.reviewer` in pipeline.yaml, specify providers/models
- **Creating a researcher** — same pattern as reviewer but under `roles.researcher`
- **Creating a strategy** — write the prompt .md file, add to `strategies:`
- **Modifying role prompts** — how template variables work (`{{task_description}}`, `{{diff}}`, `{{project_context}}`), prompt structure conventions

### docs/project-context.md

- **What is context.md** — living document that accumulates project knowledge
- **How it's initialized** — interactive flow during first invoke-scope (existing codebase vs greenfield)
- **What it contains** — the 6 sections and what goes in each
- **How it's auto-updated** — after pipeline completion (completed work, architecture, known issues)
- **How it's injected** — `{{project_context}}` template variable in role prompts
- **Manual editing** — users can edit directly, invoke respects manual changes

### docs/troubleshooting.md

Common issues with solutions:

- **Validation warnings at startup** — model format errors, missing CLIs, missing prompt files. How to run `invoke_validate_config`.
- **Agent timeouts** — how to configure per-entry timeouts, what values are reasonable
- **Merge conflicts** — why they happen with parallel worktrees, how post_merge_commands help
- **Session recovery** — how state.json works, what invoke-resume does, orphaned worktrees
- **Plugin not activating** — session-start hook issues, ESM/CJS conflicts, cache not updating
- **AskUserQuestion errors** — minimum 2 options requirement, auto-select behavior

## Constraints

- Documentation must be accurate to the current codebase — no aspirational features
- Examples must use real values that would work (e.g., `claude-opus-4-6` not `your-model-here`)
- README must be scannable — someone should understand what invoke does in 30 seconds
- Cross-reference between docs using relative links
- No duplicate information — each doc owns its topic, others link to it

## Acceptance criteria

- [ ] README.md with quick-start that a new user can follow to install and run invoke
- [ ] Pipeline diagram renders on GitHub (mermaid)
- [ ] CONTRIBUTING.md with working dev setup instructions
- [ ] docs/configuration.md covers every pipeline.yaml field
- [ ] docs/pipeline-stages.md covers all 5 stages with resume behavior
- [ ] docs/customization.md has step-by-step guides for adding roles/strategies/providers
- [ ] docs/project-context.md explains the full context system
- [ ] docs/troubleshooting.md covers the issues we've encountered during development
- [ ] All internal links resolve correctly
- [ ] Examples use real, valid values

## Out of scope

- API reference / JSDoc generation
- Hosted documentation site
- Video tutorials
- Changelog (will be generated from git history when needed)
