---
name: invoke-plan
description: "MUST USE when a spec has been approved and needs an implementation plan. Triggers after invoke-scope completes or when the user has a ready spec. Do not write implementation plans without this skill."
---

# Invoke — Plan Stage

You are running the plan stage of the invoke pipeline. Your job is to dispatch planners to generate competing implementation plans, then help the user choose the best one.

## Messaging

Load the `invoke-messaging` skill and follow its standards for all user-facing output — agent dispatches, progress updates, results, errors, and selection prompts. Use `AskUserQuestion` for all user decisions.

## Flow

### 1. Verify State

Call `invoke_get_state` to verify we're at the plan stage. Read the spec from `invoke_read_artifact` with `stage: "specs"`, `filename: "spec.md"`.

### 2. Dispatch Planners

Read the pipeline config with `invoke_get_config` to see available planners.

Present available planners using `AskUserQuestion` with `multiSelect: true`. Each option's label is the subrole name, description includes provider(s), model(s), and effort. Note that running multiple gives competing approaches to compare.

Wait for user selection, then dispatch selected planners using `invoke_dispatch_batch`:
- `create_worktrees: false`
- `task_context: { task_description: "<full spec content>", research_context: "<research reports if available>" }`

Call `invoke_get_batch_status` with the batch ID — it will wait up to 60 seconds for a status change before returning. Keep calling until complete. Do NOT use `sleep` between calls.

### 3. Present Plans

Read the results from each planner. Present them to the user:

For each plan:
- Summarize the approach (2-3 sentences)
- Highlight key technical decisions
- Note what it optimizes for

Then compare:
- Where the plans agree
- Where they differ
- Trade-offs between approaches
- Your recommendation and why

### 4. User Chooses

Let the user pick:
- One plan as-is
- A hybrid combining elements from multiple plans
- Request a re-plan with additional constraints

### 5. Save Plan

Generate a short, descriptive filename slug matching the spec name (e.g., if the spec is `2026-04-03-auth-middleware-spec.md`, the plan is `2026-04-03-auth-middleware-plan.md`).

Save the chosen plan using `invoke_save_artifact`:
- `stage: "plans"`
- `filename: "YYYY-MM-DD-<slug>-plan.md"` (e.g., `2026-04-03-auth-middleware-plan.md`)

### 6. Update State

Call `invoke_set_state` with:
- `current_stage: "orchestrate"`
- `plan: "plans/YYYY-MM-DD-<slug>-plan.md"`

The orchestrate stage skill will auto-trigger from here.

## Error Handling

- If a planner fails, present the error. If only one planner succeeded, ask if the user wants to proceed with that single plan or retry.
- If all planners fail, investigate the error and offer to retry or fall back to manual planning.
