---
name: invoke-orchestrate
description: "MUST USE when an implementation plan has been approved and needs to be broken into executable tasks. Triggers after invoke-plan completes. Do not break plans into tasks without this skill."
---

# Invoke — Orchestrate Stage

You are running the orchestrate stage. Your job is to break the approved plan into small, isolated, context-safe tasks grouped into sequential batches, with explicit task dependencies where needed so DAG-aware runners can start downstream work as soon as prerequisites finish.

## Messaging

**BEFORE doing anything else**, invoke the `invoke-messaging` skill using the Skill tool (`Skill({ skill: "invoke:invoke-messaging" })`). This loads the messaging format standards you MUST follow for all output. Do NOT proceed with any pipeline steps until invoke-messaging is loaded. Use `AskUserQuestion` for all user decisions.

## Flow

All `invoke_get_state` and `invoke_set_state` calls in this flow must include `session_id`, and `session_id` equals the pipeline's `pipeline_id`. The tools remain backward-compatible because `session_id` is optional, but do not omit it here.

### 1. Verify State

Call `invoke_get_state` with `session_id: <pipeline_id>` to verify we're at the orchestrate stage. Read the plan from `invoke_read_artifact` with `stage: "plans"`, using the filename from `state.plan`.

If the state includes `spec`, read that artifact too (use the filename from `state.spec` with `stage: "specs"`). Use the approved spec text for strategy auto-detection. If `spec` is missing, fall back to the approved plan text.

### 2. Choose Build Strategy

Read the config with `invoke_get_config` to see available strategies.

Before presenting the strategy picker, tell the user that strategy auto-detection is available and which strategy it suggests.

Use this inline heuristic for the suggestion (case-insensitive, based on the approved spec text; fall back to the plan text if needed):
- If the text contains `bug`, `fix`, or `broken`, suggest `bug-fix`
- If the text contains `prototype` or `spike`, suggest `prototype`
- Otherwise, suggest `settings.default_strategy`

Present available strategies using `AskUserQuestion` with `multiSelect: false`. Mark the suggested option in its label using the reason that matches the heuristic:
- `Bug-fix (Recommended — detected bug fix keywords)`
- `Prototype (Recommended — detected prototype keywords)`
- `[Default strategy name] (Recommended — default from settings)`

If the heuristic falls back to `settings.default_strategy`, still mention that auto-detection selected the default from settings before asking the question.

### 3. Break Down Tasks

Decompose the plan into tasks. Each task must be:

- **Self-contained** — an agent can complete it without understanding the whole system
- **Small** — fits comfortably in one agent's context window (target: 1-3 files per task)
- **Well-defined** — clear description, acceptance criteria, relevant files, interfaces to conform to

For each task, define:
- `task_id` — unique identifier (e.g., "auth-types", "auth-validate", "auth-middleware")
- `depends_on` — optional array of prerequisite `task_id` values from this same task breakdown; include it when a task needs specific upstream outputs, omit it when the task can start immediately
- `task_description` — what to build
- `acceptance_criteria` — how to verify it's done
- `relevant_files` — existing files the agent needs to read
- `interfaces` — type signatures, function contracts the code must conform to

Use the narrowest valid dependency set. If a task only needs one earlier task, set `depends_on` to that specific `task_id` instead of treating the whole earlier batch as a blocker.

### Builder Subrole Selection

Match each task to the most appropriate builder subrole based on the work involved. Do not default all tasks to `"subrole": "default"`.

- `default` — new code implementation, general-purpose tasks
- `docs` — documentation, markdown content, README updates
- `migration` — database migrations, schema changes, data transformations
- `refactor` — restructuring existing code, moving/renaming, architecture changes
- `integration-test` — writing integration or end-to-end tests

If the plan is too vague to decompose into concrete tasks (missing file paths, unclear scope, no acceptance criteria derivable), do not guess. Ask the user to clarify the ambiguity, or suggest returning to invoke-plan to refine the plan.

### 4. Group into Batches

Organize tasks into sequential batches for backward compatibility, while also encoding the true dependency graph with `depends_on`:
- **Batch 1** — foundational tasks with no prerequisites — all can run in parallel
- **Batch 2** — tasks that depend on specific Batch 1 outputs
- **Batch 3** — tasks that depend on specific Batch 1 and/or Batch 2 outputs — etc.

For simple cases, batches alone are enough and `depends_on` can be omitted. When a task has prerequisites, it must both:
- live in a later batch than every task it depends on
- list those prerequisite task IDs in `depends_on`

Within each batch, tasks must still be independent — no task in the same batch can depend on another task in the same batch. The batch structure remains the compatibility layer for simple runners, while `depends_on` lets DAG-aware runners start a downstream task as soon as its prerequisites finish instead of waiting for the entire previous batch.

### 5. Present for Approval

**Print the full task breakdown as text output first** so the user can read it:

For each batch:
> **Batch N** (parallel where dependencies allow)
> - Task: [id] — [description] (files: [list], depends_on: [none or ids])
> - Task: [id] — [description] (files: [list], depends_on: [none or ids])

THEN, in a separate message, ask for approval using `AskUserQuestion`. Do NOT combine the breakdown and the approval prompt.

### 6. Save Tasks

Use the same slug from the plan filename (e.g., if plan is `2026-04-03-auth-middleware-plan.md`, tasks file is `2026-04-03-auth-middleware-tasks.json`).

Save the task breakdown using `invoke_save_artifact`:
- `stage: "plans"`
- `filename: "YYYY-MM-DD-<slug>-tasks.json"` (e.g., `2026-04-03-auth-middleware-tasks.json`)

The format:
```json
{
  "strategy": "tdd",
  "batches": [
    {
      "id": 1,
      "tasks": [
        {
          "task_id": "auth-types",
          "role": "builder",
          "subrole": "default",
          "task_context": {
            "task_description": "...",
            "acceptance_criteria": "...",
            "relevant_files": "...",
            "interfaces": "..."
          }
        }
      ]
    },
    {
      "id": 2,
      "tasks": [
        {
          "task_id": "auth-middleware",
          "depends_on": ["auth-types"],
          "role": "builder",
          "subrole": "default",
          "task_context": {
            "task_description": "...",
            "acceptance_criteria": "...",
            "relevant_files": "...",
            "interfaces": "..."
          }
        }
      ]
    }
  ]
}
```

`depends_on` is optional. Keep the `batches` structure even when the dependency graph is simple.

### 7. Update State

Call `invoke_set_state` with `session_id: <pipeline_id>` and:
- `current_stage: "build"`
- `tasks: "plans/YYYY-MM-DD-<slug>-tasks.json"`
- `strategy: "<chosen strategy>"`

The server validates the transition and the response includes a `next_step` field — execute it immediately to invoke the build stage.

## Task Sizing Guidelines

### Traffic-Light Rubric

| Dimension | Green | Yellow | Red |
|---|---|---|---|
| Files with substantive edits | 1–3 | 4–6 | 7+ |
| Estimated net code delta | ≤50 LOC | 50–150 LOC | >150 LOC |
| Scope verb | add, rename, validate, guard, wire, cover-with-test | extract, update, extend | refactor, migrate, overhaul, generalize, rework |
| Dependency shape | None or one upstream | Two sequential layers | Branching DAG or unclear order |

### Legacy heuristics (still valid as quick checks):

- If a task requires understanding more than 500 lines of existing code, it's probably too big. Split it.
- If you can't write clear acceptance criteria in 3–5 bullet points, the task is too vague. Refine it.

### Timeout-Aware Sizing

Builders have a hard time limit (default 300s, configurable via `agent_timeout` in settings or per-provider `timeout`). Tasks must be sized to complete well within this budget. A task that would take a human more than 30 minutes of focused coding is too large for a single builder dispatch. Prefer tasks with one primary verb and one clear proof obligation.

### Mandatory Self-Check

1. Apply the traffic-light rubric to each task across all four dimensions.
2. Report the classification for each task in the approval presentation (example: `task-1: Files=Green, LOC=Yellow, Scope verb=Green, Dependency shape=Green`).
3. Split any task with a Red classification in ANY dimension before proceeding.
4. Provide explicit justification for every Yellow-classified task.

## CRITICAL: Dependency Validation

**Before finalizing the task breakdown, validate every dependency edge.**

1. List every `task_id` in the task breakdown
2. Verify every `depends_on` entry matches a real `task_id` in the same tasks file
3. Reject self-dependencies and circular dependencies
4. Keep every dependent task in a later batch than all task IDs referenced in its `depends_on`

## CRITICAL: File Conflict Prevention

**Before finalizing the task breakdown, validate that no two tasks in the same batch create or modify the same file.** This is the #1 cause of merge conflicts when parallel worktrees are merged.

For each batch:
1. List every file that each task will create or modify (from `relevant_files` and the task description)
2. Check for overlaps — if two tasks touch the same file, they MUST be in different batches
3. Also check for **implicit overlaps** — tasks that both generate config files, lockfiles, or shared resources like `composer.json`, `package.json`, `phpunit.xml`
4. Also check for files that tasks will **CREATE** (described in `task_description`), not just files listed in `relevant_files`. A task that creates a new module and a task that creates a shared types file both touching the same directory can still conflict.

If conflicts are found, move one of the conflicting tasks to a later batch. Never put conflicting tasks in the same parallel batch.
