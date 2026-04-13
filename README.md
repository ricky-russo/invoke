# Invoke

Invoke is an AI development pipeline for Claude Code that orchestrates multi-provider agents across Claude, Codex, and Gemini. It moves work through a structured scope, plan, orchestrate, build, and review flow so implementation, validation, and recovery stay consistent across sessions.

## Pipeline

```mermaid
flowchart LR
    scope[Scope] --> plan[Plan] --> orchestrate[Orchestrate] --> build[Build] --> review[Review] --> complete[Complete]
    review -->|Fixes needed| build
```

## Quick Start

1. Add the marketplace to `~/.claude/settings.json`:

   ```json
   {
     "extraKnownMarketplaces": {
       "invoke": {
         "source": {
           "source": "github",
           "repo": "ricky-russo/invoke"
         }
       }
     }
   }
   ```

2. Enable the plugin in `.claude/settings.local.json`:

   ```json
   {
     "enabledPlugins": {
       "invoke@invoke": true
     }
   }
   ```

3. Initialize the project with `invoke-init`. This creates `.invoke/` with the default pipeline, role prompts, strategy prompts, and artifact directories.
4. Configure a provider in `.invoke/pipeline.yaml`. The generated defaults already define `claude`, `codex`, and `gemini`; point the roles you want to use at a CLI you have installed.
5. Open Claude Code and ask for a feature or bug fix. Invoke routes new development work into the pipeline and carries it through review.

For the full setup and first-run walkthrough, see [docs/getting-started.md](docs/getting-started.md).

## How It Works

### Scope

Scope initializes the session and lets you choose a base branch.
It can also initialize shared project context, dispatch focused researchers, and turn the request into an approved spec with concrete requirements, constraints, and acceptance criteria.

### Plan

Plan dispatches planner roles against the approved spec, compares competing implementation approaches, and saves the user-approved plan that the later stages will execute.

### Orchestrate

Orchestrate suggests a build strategy and breaks the plan into task-sized units.
It records explicit `depends_on` edges where needed and groups the work into batches that can be scheduled safely in parallel.

### Build

Build dispatches builder roles into isolated git worktrees and tracks task state per session.
It offers successful tasks for immediate merge and runs post-merge commands and validation between merges before moving on.

### Review

Review shows current usage and cost.
It dispatches reviewers in fallback or tiered mode and records findings and triage history.
Accepted fixes loop back through builders.
Invoke then folds fixup commits according to the configured commit style before completion.

## Key Features

- Multi-provider dispatch across Claude, Codex, and Gemini
- DAG-based task scheduling
- Parallel builds with git worktrees
- Per-task merge
- Tiered review
- Strategy auto-detection
- Preset system
- Bug tracking
- Per-session work branches
- Fixup folding and autosquash
- Project context system
- Session recovery
- Metrics and cost tracking
- Pipeline management via `invoke-manage`
- Config validation
- Skill invocation enforcement
- Post-merge commands

## Documentation Index

- [Getting Started](docs/getting-started.md)
- [Concepts](docs/concepts.md)
- [Configuration Reference](docs/configuration.md)
- [Providers](docs/providers.md)
- [Customization](docs/customization.md)
- [Troubleshooting](docs/troubleshooting.md)

## License

MIT
