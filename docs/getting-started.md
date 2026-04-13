# Getting Started

This guide walks through one full invoke run.
The example feature is a REST endpoint for user preferences.

## 1. Prerequisites

- Node.js 18 or newer.
- Claude Code.
- At least one AI CLI on your `PATH`.
- Claude is the default provider.
- Codex and Gemini are also supported when you reassign roles later.

## 2. Install

Add the invoke marketplace to `~/.claude/settings.json`:

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

Enable the plugin in `.claude/settings.local.json`:

```json
{
  "enabledPlugins": {
    "invoke@invoke": true
  }
}
```

Claude Code asks you to approve the plugin on first use.

## 3. Initialize

Run this in your project root:

```sh
invoke-init
```

This creates `.invoke/`.
It copies the default pipeline, role prompts, and strategy prompts.
It also creates output folders for specs, plans, and reviews.

## 4. Configure

`invoke-init` writes a full default pipeline.
This shorter excerpt shows the default Claude builder and global settings.

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
          timeout: 300

strategies:
  tdd:
    prompt: .invoke/strategies/tdd.md

settings:
  default_strategy: tdd
  agent_timeout: 300
  commit_style: per-task
  work_branch_prefix: invoke/work
  default_provider_mode: parallel
  max_review_cycles: 3
  post_merge_commands:
    - npm install
    - npm run test
    - npm run build
```

> Warning: `--dangerously-skip-permissions` skips Claude provider permission checks.
> See [Security Considerations](providers.md#security-considerations) before keeping that default.

If you stay with the generated defaults, Claude handles every stage.
Later, you can point any role at Codex or Gemini instead.

## 5. First Pipeline Run

Open Claude Code in the repo and ask for a real feature:

```text
Build a REST endpoint for user preferences.

Requirements:
- Add GET /api/user-preferences for the current user.
- Add PATCH /api/user-preferences with validation.
- Return theme and email notification preferences.
- Follow existing auth and response conventions.
- Add tests.
```

### Scope

The run starts with research.
By default, the scope stage can dispatch codebase, best-practices, and dependency researchers.

You then answer focused questions.
For this feature, expect questions about auth, default values, and response shape.

Scope ends with a written spec.
That spec becomes the contract for later stages.

### Plan

Planning compares implementation approaches.
One plan might reuse an existing profile service.
Another might add a dedicated preferences service and repository path.

You pick the plan you want.
You can also ask for a hybrid before moving on.

### Orchestrate

The chosen plan becomes ordered batches and tasks.
Invoke also suggests a build strategy before execution starts.

For this example, `tdd` is a likely suggestion because the request mentions tests.
A typical task list is schema work, GET handler, PATCH handler, and integration tests.

Independent tasks can run together.
Tasks with dependencies wait for earlier layers to finish.

### Build

Invoke creates one session work branch for the whole run.
With the default prefix, it looks like `invoke/work/<session-id>`.

That session also gets an integration worktree under your system temp directory.
Invoke stores that path in session state so later merges, post-merge commands, and resume can target the same checkout.

Each build task then gets its own temporary task worktree and task branch.
Those task worktrees branch from the session work branch when the session has been initialized.
That keeps parallel edits away from your main checkout and from each other.

When a task finishes, you can merge it immediately.
The default `per-task` style records one squash commit per accepted task.

After each merge, invoke runs the default post-merge commands.
In the shipped defaults, that means `npm install`, `npm run test`, and `npm run build`.

### Review

Review starts after the build is complete.
Reviewers inspect the resulting diff and return findings.

If you configure review tiers, each tier gates the next one.
A common flow is critical checks first, then quality, then polish.

You triage the findings.
Accept real issues, dismiss false positives, and send accepted issues into a fix loop.

For this example, a reviewer might flag weak enum validation on `theme`.
Another might catch a missing authorization check on `PATCH`.

## 6. What Happened

Here is the high-level output layout:

```text
.invoke/
  pipeline.yaml
  specs/
  plans/
  reviews/
  sessions/
```

`specs/` stores the feature spec.
`specs/research/` can also hold saved research artifacts.

`plans/` stores the chosen implementation plan.
It also stores the task breakdown that build uses later.

`sessions/` is created per run.
Each session gets its own directory under `.invoke/sessions/<session-id>/`.

Inside that session directory, `state.json` tracks stage progress.
It records the current stage, chosen artifacts, base branch, work branch, integration worktree path, and task state.

Dispatch metrics are stored separately in `.invoke/metrics.json`.
Session-scoped metrics tools use the `pipeline_id` recorded in `state.json` to select the entries for the current run.

`reviews/` stores review-cycle artifacts after review begins.
Those records help explain why a fix loop happened and what was accepted or dismissed.
