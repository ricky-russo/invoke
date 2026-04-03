# Invoke

AI-assisted development pipeline for Claude Code.

## What is Invoke?

Invoke orchestrates AI agents through a structured pipeline: scope, plan, orchestrate, build, and review. It runs as a Claude Code plugin, dispatching agents to multiple providers (Claude, Codex) in parallel, managing git worktrees for isolated builds, and merging results back into your branch. Project context is maintained across sessions so agents always understand your codebase.

## Pipeline

```mermaid
flowchart LR
    A["Scope\nResearch + Spec"] --> B["Plan\nCompeting Approaches"]
    B --> C["Orchestrate\nTask Breakdown"]
    C --> D["Build\nParallel Agents"]
    D --> E["Review\nMulti-Reviewer"]
    E --> F["Complete"]
```

## Quick Start

### 1. Install the plugin

From a local clone:

```sh
claude mcp add invoke -- node /path/to/invoke/dist/index.js
```

### 2. Initialize in your project

```sh
npx invoke-init
```

This creates a `.invoke/` directory with the default pipeline config, role prompts, and strategy templates.

### 3. Configure providers

Edit `.invoke/pipeline.yaml` to match the CLIs you have installed. The default config ships with `claude` and `codex` providers:

```yaml
providers:
  claude:
    cli: claude
    args: ["--print", "--model", "{{model}}", "--dangerously-skip-permissions"]
```

### 4. Start building

Open Claude Code in your project and ask it to build something. Invoke's scope skill activates automatically when you describe a feature to implement, and walks you through the full pipeline.

## How It Works

**Scope** -- Dispatches researcher agents (codebase analysis, best practices, dependency review) in parallel, then asks you targeted clarifying questions informed by the research. Produces a spec document with requirements, constraints, and acceptance criteria. [Details](docs/pipeline-stages.md)

**Plan** -- Dispatches planner agents that propose competing architectural approaches. You review and select the approach, or ask for revisions. [Details](docs/pipeline-stages.md)

**Orchestrate** -- Breaks the selected plan into ordered batches of parallel tasks. Each batch contains tasks that can be built independently; batches execute sequentially because later batches may depend on earlier ones. [Details](docs/pipeline-stages.md)

**Build** -- Dispatches builder agents into isolated git worktrees so they can work in parallel without conflicts. After each batch, worktrees are merged, post-merge commands run (lockfile regeneration, etc.), and validation checks execute. You can optionally run reviewers between batches. [Details](docs/pipeline-stages.md)

**Review** -- Dispatches multiple reviewers (spec-compliance, security, code-quality, performance, UX, accessibility) against the built code. Findings are triaged, and fix tasks are dispatched for issues you approve. The review-fix loop continues until you're satisfied. [Details](docs/pipeline-stages.md)

## Configuration

Pipeline behavior is controlled by `.invoke/pipeline.yaml`. A minimal configuration:

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
          effort: high
          timeout: 300

settings:
  default_strategy: tdd
  agent_timeout: 300
  commit_style: per-batch
  work_branch_prefix: invoke/work
```

The default config includes roles for researchers, planners, builders, and reviewers, each with both `claude` and `codex` provider entries. See [Configuration Reference](docs/configuration.md) for the full specification.

## Key Features

- **Multi-provider dispatch** -- run the same task on Claude and Codex, compare results
- **Parallel builds with git worktrees** -- agents work in isolated worktrees, merged after each batch
- **Inter-batch review** -- optionally dispatch reviewers between build batches to catch issues early
- **Spec-compliance reviewer** -- catches hallucinated features and missing requirements
- **Project context system** -- a living `context.md` document that persists across pipelines
- **Session recovery** -- resume interrupted pipelines at the task level
- **Per-agent configurable timeouts** -- set timeouts per provider entry in each role
- **Post-merge commands** -- regenerate lockfiles (`composer install`, `npm install`, etc.) after worktree merges
- **Config validation** -- startup validation with warnings and actionable suggestions

## Documentation

- [Configuration Reference](docs/configuration.md)
- [Pipeline Stages](docs/pipeline-stages.md)
- [Customization Guide](docs/customization.md)
- [Project Context](docs/project-context.md)
- [Troubleshooting](docs/troubleshooting.md)

## License

MIT
