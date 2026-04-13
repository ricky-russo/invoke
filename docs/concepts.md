# Concepts

This page explains the core mental model behind invoke.
For stage-by-stage detail, see [First Pipeline Run](getting-started.md#5-first-pipeline-run).
For shared project memory, see [Project Context](#project-context).

## Pipeline Stages

Invoke moves each session through `scope`, `plan`, `orchestrate`, `build`, `review`, then `complete`.
Session state records the current stage and key artifact paths.

| Stage | What it does | Primary artifacts |
|---|---|---|
| Scope | Defines the request and approves a spec. | Spec file and recorded spec path. |
| Plan | Compares approaches and selects an implementation plan. | Plan file and recorded plan path. |
| Orchestrate | Breaks the plan into batches, tasks, and strategy. | Tasks file plus recorded task and strategy state. |
| Build | Runs builder tasks and merges accepted work. | Batch state and commits on the session branch. |
| Review | Reviews the diff, fixes issues, and closes the run. | Review artifacts and updated project context. |

The first three stages set direction.
Build changes code.
Review validates results and records outcomes.
For the full workflow, see [First Pipeline Run](getting-started.md#5-first-pipeline-run).

## Roles & Subroles

Invoke groups prompts by function, not by a single generic agent type.
Each subrole points to a prompt and one or more providers.

| Role group | Subroles | Purpose |
|---|---|---|
| `researcher` | `codebase`, `best-practices`, `dependencies` | Gather repository, external, and dependency context. |
| `planner` | `architect`, `alternative` | Compare implementation approaches. |
| `builder` | `default`, `docs`, `integration-test`, `refactor`, `migration` | Implement tasks by work type. |
| `reviewer` | `spec-compliance`, `security`, `code-quality`, `performance`, `ux`, `accessibility` | Review the built diff from different angles. |

The same provider can back several groups.
The prompt, context, and success criteria still change by subrole.

## Providers & Provider Modes

Providers are CLI adapters, and multi-provider dispatch can run in `single`, `fallback`, or `parallel` mode; see [Provider Modes](providers.md#provider-modes).

| Mode |
|---|
| `single` |
| `fallback` |
| `parallel` |

## Strategies

Strategies are builder prompt overlays, and invoke ships `tdd`, `implementation-first`, `prototype`, and `bug-fix`; see [Configuration Reference](configuration.md#4-strategies).

| Strategy |
|---|
| `tdd` |
| `implementation-first` |
| `prototype` |
| `bug-fix` |

## Sessions & Work Branches

Each pipeline run gets its own session directory under `.invoke/sessions/<session_id>`.
That directory stores the session's `state.json`.
Sessions can be listed, resumed, and cleaned up independently.

The pipeline ID is the durable identity for a run.
Stage skills reuse that same ID as the session ID.

Each session also gets a dedicated work branch.
Invoke names it as `<work_branch_prefix>/<session_id>`.
Session state also records the base branch and integration worktree path.

That branch is the integration target for the run.
Builder task branches merge into the session work branch first.
They do not merge straight into the user's main branch.

## Worktree Isolation

Invoke uses two layers of isolation during implementation:

- one integration worktree for the session work branch
- one temporary worktree per builder task

Builders work in temporary checkouts.
They do not edit the main repository checkout.
They also do not edit the shared session integration worktree directly.

When a task completes, invoke stages and commits task-local changes.
It then squash-merges the task branch into the merge target.
The resulting commit SHA is recorded in session state.

Build merges happen sequentially.
Task execution can still run in parallel before that merge point.
This keeps integration controlled while preserving execution parallelism.

The mental model is simple.
Builders work alone.
The session branch integrates accepted results one at a time.

## Project Context

`context.md` is invoke's shared project-memory document.
It lives at `.invoke/context.md`.
It sits outside any individual session directory.

Prompt composition can read that shared file.
Invoke can trim the content before injecting it into a role prompt.
That lets separate sessions reuse the same project context.

The review stage can also update the shared document.
It can append completed work, refresh architecture notes, and record deferred findings.

## Skills vs Internal Tools

The user-facing model is natural language plus skills.
The built-in router sends new work, resume requests, and configuration tasks to different flows.

Each stage is also defined as a skill.
Scope writes the specification.
Plan compares approaches.
Orchestrate defines tasks.
Build implements them.
Review validates the result.

Skills rely on lower-level runtime primitives.
Those primitives handle state, artifacts, context, providers, sessions, and worktrees.
For operators, the simpler model still applies.
Describe the work, let invoke run the pipeline, and inspect the artifacts when needed.
