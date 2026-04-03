---
name: invoke-orchestrate
description: "MUST USE when an implementation plan has been approved and needs to be broken into executable tasks. Triggers after invoke-plan completes. Do not break plans into tasks without this skill."
---

# Invoke — Orchestrate Stage

You are running the orchestrate stage. Your job is to break the approved plan into small, isolated, context-safe tasks grouped into sequential batches.

## Messaging

**BEFORE doing anything else**, invoke the `invoke-messaging` skill using the Skill tool (`Skill({ skill: "invoke:invoke-messaging" })`). This loads the messaging format standards you MUST follow for all output. Do NOT proceed with any pipeline steps until invoke-messaging is loaded. Use `AskUserQuestion` for all user decisions.

## Flow

### 1. Verify State

Call `invoke_get_state` to verify we're at the orchestrate stage. Read the plan from `invoke_read_artifact` with `stage: "plans"`, `filename: "plan.md"`.

### 2. Choose Build Strategy

Read the config with `invoke_get_config` to see available strategies.

Present available strategies using `AskUserQuestion` with `multiSelect: false`. Mark the default strategy (from `settings.default_strategy`) with "(Recommended)" in its label.

### 3. Break Down Tasks

Decompose the plan into tasks. Each task must be:

- **Self-contained** — an agent can complete it without understanding the whole system
- **Small** — fits comfortably in one agent's context window (target: 1-3 files per task)
- **Well-defined** — clear description, acceptance criteria, relevant files, interfaces to conform to

For each task, define:
- `task_id` — unique identifier (e.g., "auth-types", "auth-validate", "auth-middleware")
- `task_description` — what to build
- `acceptance_criteria` — how to verify it's done
- `relevant_files` — existing files the agent needs to read
- `interfaces` — type signatures, function contracts the code must conform to

### 4. Group into Batches

Organize tasks into sequential batches:
- **Batch 1** — foundational tasks (types, interfaces, core utilities) — all can run in parallel
- **Batch 2** — depends on Batch 1 outputs — all can run in parallel
- **Batch 3** — depends on Batch 2 outputs — etc.

Within each batch, tasks must be independent — no task in the same batch can depend on another task in the same batch.

### 5. Present for Approval

**Print the full task breakdown as text output first** so the user can read it:

For each batch:
> **Batch N** (parallel)
> - Task: [id] — [description] (files: [list])
> - Task: [id] — [description] (files: [list])

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
          "task_id": "task-id",
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

### 7. Update State

Call `invoke_set_state` with:
- `current_stage: "build"`
- `strategy: "<chosen strategy>"`

The build stage skill will auto-trigger from here.

## Task Sizing Guidelines

- If a task touches more than 3 files, it's probably too big. Split it.
- If a task requires understanding more than 500 lines of existing code, it's probably too big. Split it.
- If you can't write clear acceptance criteria in 3-5 bullet points, the task is too vague. Refine it.
- If two tasks modify the same file, they must be in different batches (sequential, not parallel).
