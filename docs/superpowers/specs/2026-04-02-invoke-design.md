# Invoke — AI-Assisted Development Pipeline

## Overview

Invoke is an AI-assisted development tool that runs inside Claude Code sessions as a set of auto-triggering skills. It orchestrates a structured pipeline — **scope, plan, orchestrate, build, review** — that dispatches work to multiple AI agents across different providers (Claude, Codex, GPT, etc.) via a local MCP server.

The system is fully configurable: users define providers, roles, strategies, and reviewers through config files and markdown prompt templates.

## Architecture

### Two Layers

**Skills layer** (runs inside the Claude Code session)
- A set of skill files that auto-trigger based on conversation context
- Handle all conversational/interactive work: scoping with the user, presenting plans, reviewer selection, triage of findings
- Call MCP tools to dispatch work and read/write pipeline state

**MCP server** (`invoke-mcp`, TypeScript, local stdio process)
- Ships as part of the invoke package — runs locally, no hosting
- Single gateway for all agent dispatch — spawns CLI processes (`claude`, `codex`, etc.)
- Manages git worktrees for parallel build tasks
- Reads/writes pipeline state to flat files in `.invoke/`
- Normalizes output from different CLI tools into a consistent format
- Manages batch execution (parallel tasks within a batch, sequential between batches)
- Non-blocking dispatch — returns immediately, skills poll for status

**Data layer** (flat files in project)
- `.invoke/pipeline.yaml` — config: providers, roles, strategies, settings
- `.invoke/state.json` — current pipeline state (auto-managed by MCP)
- `.invoke/specs/` — specs produced by the scope stage
- `.invoke/plans/` — plans and orchestration task breakdowns
- `.invoke/reviews/` — review findings per cycle

### Architecture Diagram

```
+-------------------------------------+
|  Claude Code Session (main)         |
|                                     |
|  +-----------+  +---------------+   |
|  |  Skills   |--|  MCP Client   |   |
|  |  (scope,  |  +------+--------+   |
|  |   plan,   |         |            |
|  |   review  |         |            |
|  |   triage) |  +------v--------+   |
|  +-----------+  |  invoke-mcp   |   |
|                 |  server        |   |
|                 |               |   |
|                 |  +----------+ |   |
|                 |  | Dispatch | |   |
|                 |  | Engine   | |   |
|                 |  +--+---+--+ |   |
|                 |     |   |    |   |
|                 +-----+---+----+   |
|                       |   |        |
+-----------------------+---+--------+
                        |   |
              +---------+   +---------+
              v                       v
        +----------+           +----------+
        | claude   |           | codex    |
        | CLI      |           | CLI      |
        |(worktree)|           |(worktree)|
        +----------+           +----------+
```

### MCP Registration

The MCP server registers locally in Claude Code settings:

```json
{
  "mcpServers": {
    "invoke": {
      "command": "npx",
      "args": ["invoke-mcp"],
      "cwd": "."
    }
  }
}
```

## Pipeline Stages

### Stage 1: Scope

**Trigger:** User asks to build a feature, fix something complex, or start new work.

**Flow:**
1. Skill auto-detects and loads
2. Reads pipeline config to see which researchers are available
3. Asks user which researchers to dispatch
4. Dispatches researcher agents via MCP (e.g. codebase analyzer, dependency checker)
5. Polls `invoke_get_batch_status` until researchers complete
6. Reads research reports from results
7. Uses research to ask smart clarifying questions — focused on decisions only the user can make, not things the code already tells you
8. When scope is clear, produces a spec document
9. Saves spec to `.invoke/specs/`
10. Updates pipeline state
11. User approves spec — triggers plan stage

**Output:** A markdown spec file with requirements, constraints, and acceptance criteria.

### Stage 2: Plan

**Trigger:** Spec is approved by user.

**Flow:**
1. Skill loads, reads the spec from `.invoke/specs/`
2. Asks user which planners to dispatch
3. Dispatches planner agents in parallel via MCP (e.g. Claude and Codex generate competing plans)
4. Polls until complete
5. Presents competing plans to user — highlights differences, trade-offs, recommends one
6. User picks a plan (or requests a hybrid)
7. Saves chosen plan to `.invoke/plans/`
8. Updates state — triggers orchestrate stage

**Output:** A high-level implementation plan — what to build, in what order, architecture decisions.

### Stage 3: Orchestrate

**Trigger:** Plan is approved by user.

**Flow:**
1. Skill loads, reads the plan from `.invoke/plans/`
2. Breaks the plan into small, isolated, context-safe tasks — each one self-contained enough for a sub-agent to execute without losing context or hallucinating
3. Groups tasks into sequential batches (parallel within a batch, sequential between batches)
4. Each task includes: description, acceptance criteria, relevant files, interfaces it must conform to, dependencies on prior batches
5. Asks user which build strategy to use (TDD, implementation-first, etc.)
6. Presents task breakdown to user for approval
7. Saves to `.invoke/plans/tasks.json`
8. Updates state — triggers build stage

**Output:** An ordered list of batches, each containing parallelizable tasks with full context.

### Stage 4: Build

**Trigger:** Task breakdown is approved by user.

**Flow:**
1. Read tasks from `.invoke/plans/tasks.json` and build strategy
2. MCP creates a temporary work branch (`invoke/work-<timestamp>`)
3. For each batch:
   a. Ask user which builder roles to dispatch for this batch
   b. Call `invoke_dispatch_batch` — MCP creates a worktree per task, composes prompts (strategy template + task context), spawns CLI agents in each worktree
   c. Poll for progress, report status to user
   d. When batch complete, collect results
   e. Main session merges worktrees into work branch — present any conflicts to user
   f. Post-merge validation hook runs (lint, type-check, tests)
   g. Mark batch done in state, proceed to next batch
4. When all batches complete — update state, triggers review stage

**Worktree management:** The MCP creates worktrees before dispatching agents. This is required because not all CLIs (e.g. Codex) support native worktree isolation. The MCP owns the full worktree lifecycle: create, dispatch agent into it, merge back, clean up.

**Output:** Implemented code on the work branch.

### Stage 5: Review

**Trigger:** Build completes (or a build-review loop iteration completes).

**Flow:**
1. Skill reads config to see available reviewers
2. Asks user: "Which reviewers do you want to run?" — lists available sub-roles
3. Dispatches selected reviewers in parallel via MCP, each with the full diff/codebase context
4. Polls until complete
5. Findings are normalized into a consistent format (issue, severity, file, line, suggestion)
6. Presents findings grouped by reviewer
7. User triages each finding: accept or dismiss
8. Accepted findings get bundled as fix tasks
9. Dispatches builder agents to fix them (same dispatch mechanism)
10. Polls until fixes complete, merges into work branch
11. Asks user: "Run another review cycle?" — loop back to step 2 or finish

**Output:** Clean, reviewed code. Review history saved to `.invoke/reviews/`.

### Pipeline State Transitions

```
scope -> [spec approved] -> plan -> [plan approved] -> orchestrate -> [tasks approved] -> build -> review
                                                                                           ^       |
                                                                                           +-------+
                                                                                         (until clean)
```

Each transition requires explicit user approval. The state file tracks where you are so you can resume across sessions.

### Commit Strategy

All build and fix work happens on a temporary work branch. This keeps the iteration history separate from the clean feature branch.

On pipeline completion, the skill asks the user how to commit:

- **One commit** — squash everything into a single commit
- **Per batch** — one commit per orchestration batch (each batch is a logical unit of work)
- **Per task** — one commit per build task (most granular but still clean)
- **Custom** — user defines how to group changes

Default: **per-batch** — the git history reads as a logical progression of the implementation.

The messy fix iterations within each batch are squashed away, but the logical structure is preserved.

After the squash merge is complete, the temporary work branch is deleted automatically.

## MCP Server Design

### Tools

**Agent Dispatch:**
- `invoke_dispatch(role, subrole, task_context)` — dispatch a single agent. Composes prompt from role template + task context, spawns CLI process, returns structured output.
- `invoke_dispatch_batch(batch)` — dispatch a batch of agents in parallel. Creates worktrees, dispatches each agent, returns immediately with a `batch_id`.
- `invoke_get_batch_status(batch_id)` — returns per-agent status: `pending | running | completed | error`.
- `invoke_cancel_batch(batch_id)` — kills running agents if needed.

**Worktree Management:**
- `invoke_create_worktree(task_id)` — creates an isolated git worktree for a task.
- `invoke_merge_worktree(task_id)` — merges a completed worktree back into the work branch.
- `invoke_cleanup_worktrees()` — removes stale/orphaned worktrees.

**Pipeline State:**
- `invoke_get_state()` — returns current pipeline state (stage, batch progress, history).
- `invoke_set_state(updates)` — updates pipeline state.
- `invoke_get_config()` — reads and returns parsed `pipeline.yaml`.

**File Management:**
- `invoke_save_artifact(stage, filename, content)` — saves specs, plans, reviews to the right `.invoke/` subdirectory.
- `invoke_read_artifact(stage, filename)` — reads an artifact back.

### Dispatch Engine

When `invoke_dispatch` is called:

1. **Load config** — read provider CLI details from `pipeline.yaml`
2. **Load prompt template** — read the role's `.md` file
3. **Compose prompt** — inject task context variables into template (e.g. `{{task_description}}`, `{{acceptance_criteria}}`, `{{relevant_files}}`)
4. **Create worktree** (if build task) — `git worktree add`
5. **Spawn CLI process** — e.g. `claude --print --model opus-4.6 --directory /path/to/worktree "composed prompt"`
6. **Capture output** — stdout from the CLI
7. **Normalize output** — parse into consistent structure via provider-specific parsers
8. **Return result** — structured JSON back to the skill

### Non-Blocking Dispatch

`invoke_dispatch_batch` returns immediately with a `batch_id`. The skill polls `invoke_get_batch_status` to track progress. This allows the user to continue conversing while agents work — e.g. asking "how's the build going?" mid-flight.

### Output Normalization

Each provider's CLI returns different formats. Provider-specific output parsers normalize into a standard shape:

```typescript
interface AgentResult {
  role: string
  subrole: string
  provider: string
  model: string
  status: 'success' | 'error' | 'timeout'
  output: {
    summary: string
    findings?: Finding[]    // for reviewers
    report?: string         // for researchers
    changes?: FileChange[]  // for builders
  }
  duration: number
}

interface Finding {
  issue: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  file: string
  line?: number
  suggestion: string
}
```

## Skills Design

### Skill Files

```
skills/
  invoke-scope.md
  invoke-plan.md
  invoke-orchestrate.md
  invoke-build.md
  invoke-review.md
  invoke-resume.md
  invoke-manage.md
```

Each skill auto-triggers based on its description. Skills handle conversational/interactive work and delegate execution to the MCP.

### invoke-scope

**Trigger:** "Use when the user wants to build a feature, add functionality, or start new development work"

Dispatches researchers, uses findings to ask smart clarifying questions, produces a spec.

### invoke-plan

**Trigger:** "Use when a spec has been approved and needs an implementation plan"

Dispatches competing planners, presents options, user picks one.

### invoke-orchestrate

**Trigger:** "Use when an implementation plan has been approved and needs to be broken into tasks"

Breaks plan into small isolated tasks, groups into sequential batches, user approves.

### invoke-build

**Trigger:** "Use when an orchestrated task breakdown has been approved and is ready to build"

Dispatches builder agents per batch into worktrees, polls progress, merges results.

### invoke-review

**Trigger:** "Use when build is complete and code needs review"

User selects reviewers, dispatches them, presents findings, user triages, auto-fixes loop.

### invoke-resume

**Trigger:** "Use when the user returns to a project that has an in-progress invoke pipeline"

Reads state, presents current progress, offers to continue or restart.

### invoke-manage

**Trigger:** "Use when the user wants to create, edit, or remove invoke roles, strategies, or pipeline configuration"

Conversational role management:

- **Create:** User describes what they want (e.g. "create a reviewer for PSR compliance"). Skill asks clarifying questions about focus areas, generates the prompt `.md` file, asks for provider/model/effort, updates `pipeline.yaml`.
- **Edit:** Reads existing prompt file, discusses changes, updates the file and/or config.
- **Delete:** Confirms with user, removes config entry and prompt file.

Keeps the system self-service — users never need to manually write prompt files or edit YAML.

## Configuration

### Roles

All roles follow the same pattern: a top-level role group with named sub-roles.

```yaml
roles:
  researcher:
    codebase:
      prompt: .invoke/roles/researcher/codebase.md
      provider: claude
      model: opus-4.6
      effort: high
    best-practices:
      prompt: .invoke/roles/researcher/best-practices.md
      provider: claude
      model: opus-4.6
      effort: medium

  planner:
    architect:
      prompt: .invoke/roles/planner/architect.md
      provider: claude
      model: opus-4.6
      effort: high
    alternative:
      prompt: .invoke/roles/planner/alternative.md
      provider: codex
      model: gpt-5.4
      effort: high

  builder:
    default:
      prompt: .invoke/roles/builder/default.md
      provider: claude
      model: opus-4.6
      effort: high

  reviewer:
    security:
      prompt: .invoke/roles/reviewer/security.md
      provider: codex
      model: gpt-5.4
      effort: high
    code-quality:
      prompt: .invoke/roles/reviewer/code-quality.md
      provider: claude
      model: opus-4.6
      effort: medium
    performance:
      prompt: .invoke/roles/reviewer/performance.md
      provider: claude
      model: opus-4.6
      effort: high
```

### Providers

```yaml
providers:
  claude:
    cli: claude
    args: ["--print", "--model", "{{model}}"]
  codex:
    cli: codex
    args: ["--model", "{{model}}"]
```

Adding a new provider is a config entry — no code changes required.

### Strategies

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

### Prompt Templates

Prompt files are markdown with template variables that the MCP injects at dispatch time:

```markdown
# TDD Strategy

You are building a feature using test-driven development.

## Task
{{task_description}}

## Acceptance Criteria
{{acceptance_criteria}}

## Relevant Files
{{relevant_files}}

## Instructions
1. Write a failing test that validates the acceptance criteria
2. Implement the minimum code to pass the test
3. Refactor if needed
```

Strategies and roles are fully extensible — users can add custom ones via `invoke-manage` or by hand.

### Settings

```yaml
settings:
  default_strategy: tdd
  agent_timeout: 300000
  commit_style: per-batch
  work_branch_prefix: invoke/work
```

## File Structure

### Project `.invoke/` Directory

```
.invoke/
  pipeline.yaml
  state.json

  roles/
    researcher/
      codebase.md
      best-practices.md
      dependencies.md
    planner/
      architect.md
      alternative.md
    builder/
      default.md
    reviewer/
      security.md
      code-quality.md
      performance.md
      ux.md
      accessibility.md

  strategies/
    tdd.md
    implementation-first.md
    prototype.md
    bug-fix.md

  specs/
    research/
  plans/
    tasks.json
  reviews/
```

### Invoke Package

```
invoke/
  package.json
  src/
    mcp/
      index.ts               # MCP server entry point
      tools/
        dispatch.ts          # dispatch & batch tools
        worktree.ts          # worktree management tools
        state.ts             # pipeline state tools
        artifacts.ts         # file management tools
      providers/
        base.ts              # shared provider interface
        claude.ts            # Claude CLI adapter
        codex.ts             # Codex CLI adapter
      parsers/
        claude-parser.ts     # Claude output normalization
        codex-parser.ts      # Codex output normalization

  skills/
    invoke-scope.md
    invoke-plan.md
    invoke-orchestrate.md
    invoke-build.md
    invoke-review.md
    invoke-resume.md
    invoke-manage.md

  defaults/
    roles/
      researcher/
      planner/
      builder/
      reviewer/
    strategies/
```

## Claude Code Hooks

### Session Start — Auto-Resume

Detects an active pipeline when a session opens and nudges the AI to load `invoke-resume`.

```json
{
  "hooks": {
    "SessionStart": [{
      "command": "node -e \"try { const s=require('fs').readFileSync('.invoke/state.json','utf8'); const j=JSON.parse(s); if(j.current_stage) console.log('Active invoke pipeline detected at stage: '+j.current_stage+'. Load invoke-resume to continue.') } catch(e) {}\""
    }]
  }
}
```

### Post-Merge Validation

Runs lint, type-check, and tests after each worktree merge to catch breakage early.

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "invoke_merge_worktree",
      "command": "npm test && npm run lint && npm run typecheck"
    }]
  }
}
```

## Error Handling

### Agent Failures
- **Timeout** — agent exceeds `agent_timeout`. MCP kills the process, marks task as `error`. Skill asks user: retry, skip, or abort batch.
- **CLI crash** — non-zero exit code. Same user prompt: retry, skip, or abort.
- **CLI not installed** — MCP detects missing CLI at dispatch time, returns clear error naming the missing tool.
- **Bad output** — parser can't normalize the response. Raw output is saved and presented to user for manual review.

### Worktree Issues
- **Merge conflicts** — after a batch, if worktree merge has conflicts, skill presents them to the user and asks how to resolve.
- **Stale worktrees** — if a session dies mid-build, `invoke-resume` detects orphaned worktrees via state file and offers cleanup.

### Pipeline Recovery
- **Session crash mid-pipeline** — state file tracks everything. `invoke-resume` reads state, finds last completed step, picks up from there.
- **User wants to restart a stage** — skill offers "continue from here" or "redo this stage" when resuming.
- **User wants to abort** — skill cleans up work branch, worktrees, and resets state.

### Config Issues
- **Missing prompt file** — MCP returns error naming the missing `.md` file.
- **Unknown provider** — MCP returns error at dispatch time.
- **Invalid config** — MCP validates `pipeline.yaml` on first tool call and returns actionable errors.
