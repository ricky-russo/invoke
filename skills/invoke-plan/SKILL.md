---
name: invoke-plan
description: "MUST USE when a spec has been approved and needs an implementation plan. Triggers after invoke-scope completes or when the user has a ready spec. Do not write implementation plans without this skill."
---

# Invoke — Plan Stage

You are running the plan stage of the invoke pipeline. Your job is to dispatch planners to generate competing implementation plans, then help the user choose the best one.

## Messaging

**BEFORE doing anything else**, invoke the `invoke-messaging` skill using the Skill tool (`Skill({ skill: "invoke:invoke-messaging" })`). This loads the messaging format standards you MUST follow for all output. Do NOT proceed with any pipeline steps until invoke-messaging is loaded. Use `AskUserQuestion` for all user decisions.

## Flow

All `invoke_get_state` and `invoke_set_state` calls in this flow must include `session_id`, and `session_id` equals the pipeline's `pipeline_id`. The tools remain backward-compatible because `session_id` is optional, but do not omit it here.

### 1. Verify State

Call `invoke_get_state` with `session_id: <pipeline_id>` to verify we're at the plan stage. Read the spec from `invoke_read_artifact` with `stage: "specs"` and the filename from `state.spec` (e.g., `2026-04-05-auth-middleware-spec.md`).

#### Research Context

If the state has batches from the scope stage (i.e., `state.batches` contains scope-stage entries), check the batch results for research reports. These contain codebase analysis, best-practices findings, and dependency research that should inform the planning.

Read each research artifact and extract relevant summaries. Pass these summaries to planners in the `research_context` field of `task_context` so they can ground their plans in the actual codebase rather than assumptions.

### 2. Dispatch Planners

Read the pipeline config with `invoke_get_config` to see available planners.

Present available planners using `AskUserQuestion` with `multiSelect: true`. Each option's label is the subrole name, description includes provider(s), model(s), and effort. Note that running multiple planners gives competing approaches to compare.

Wait for user selection, then dispatch selected planners using `invoke_dispatch_batch`:
- `create_worktrees: false`
- `task_context: { task_description: "<full spec content>", research_context: "<research summaries from step 1 if available>" }`

> **Session ownership:** Always pass `session_id: <pipeline_id>` on `invoke_get_batch_status` and `invoke_get_task_result` calls. The MCP server enforces session ownership on these tools to prevent cross-session data leakage.

Call `invoke_get_batch_status` with `{ batch_id, session_id: <pipeline_id> }` — it will wait up to 60 seconds for a status change before returning. The response contains `{ batchId, status, agents: [{ taskId, status }] }` — status information only, no result data. Keep calling until all planner tasks are terminal. Do NOT use `sleep` between calls.

**CRITICAL: Do NOT proceed to step 3 while any dispatched agents are still running.** You must wait for all agents to complete or fail. If agents have been running for more than 5 minutes, use `AskUserQuestion` to ask the user whether to keep waiting, proceed with partial results, or cancel.

After `invoke_get_batch_status` shows the batch is `completed` or `partial`, call `invoke_get_task_result({ batch_id, task_id, session_id: <pipeline_id> })` for each terminal planner task to fetch its full output. Use `result.output.raw` for the full plan, or `result.output.summary` for a quick gist. **Never call `invoke_get_task_result` inside the polling loop for tasks still `pending`, `dispatched`, or `running` — the tool errors for non-terminal tasks.**

### 3. Present Plans

**Print the full plan comparison as text output first** so the user can read it. Build the comparison from the planner outputs fetched via `invoke_get_task_result`. Use the `📐 Plan Comparison` format from `invoke-messaging`.

For each plan, show:
- **Approach summary** — 2-3 sentences describing the overall strategy and how it solves the problem
- **Key technical decisions** — bullet list of the most significant choices (data model, API shape, dependency choices, etc.)
- **Optimization focus** — what the plan prioritizes (e.g., correctness, speed, minimal surface area, testability)

Then compare across all plans:
- Where the plans agree
- Where they differ
- Trade-offs between approaches
- Your recommendation and why (1-2 sentences)

When only one planner was dispatched, still print the full plan in the same structure so the user can review it before selecting.

### 4. User Chooses

THEN, in a separate message, ask the user to choose using `AskUserQuestion`. Do NOT combine the plan comparison and the selection prompt.

Use `multiSelect: false`. Populate the `preview` field if the plans differ substantially in structure — this lets the user compare summaries without switching contexts.

```
AskUserQuestion({
  questions: [{
    question: "Which plan should we proceed with?",
    header: "Plan",
    multiSelect: false,
    options: [
      { label: "Plan A ([planner name]) (Recommended)", description: "[1-sentence summary of Plan A approach]" },
      { label: "Plan B ([planner name])", description: "[1-sentence summary of Plan B approach]" },
      { label: "Hybrid", description: "Combine elements from multiple plans" },
      { label: "Re-plan with constraints", description: "Dispatch new planners with additional constraints" }
    ]
  }]
})
```

If only one planner was dispatched, omit the Hybrid option and present:
- `Plan A ([planner name]) (Recommended)` — with a 1-sentence summary
- `Re-plan with constraints` — dispatch new planners with additional constraints

(Two options satisfies the `AskUserQuestion` minimum of 2.)

If the user selects `Re-plan with constraints`, ask them to describe the additional constraints, then return to step 2 and dispatch new planners with those constraints added to `task_context`.

### 5. Generate and Approve Plan

After the user selects a plan:

1. **Print the full chosen or hybrid plan as text output.** If the user selected `Hybrid`, synthesize the chosen elements from each plan into a coherent combined plan and print it in full.

2. **Ask for explicit approval** in a separate message using `AskUserQuestion`:

```
AskUserQuestion({
  questions: [{
    question: "Does this plan look right?",
    header: "Plan Approval",
    multiSelect: false,
    options: [
      { label: "Approve — save and proceed", description: "Save this plan and move to the orchestrate stage" },
      { label: "Request changes", description: "Describe what to adjust; the plan will be revised and re-presented" }
    ]
  }]
})
```

3. **If the user requests changes**, ask what they want adjusted (free-form), revise the plan accordingly, print the revised plan in full, and re-present the approval prompt. Repeat until the user explicitly approves.

4. **Only save after explicit approval.**

### 6. Save Plan

Generate a short, descriptive filename slug matching the spec name (e.g., if the spec is `2026-04-03-auth-middleware-spec.md`, the plan is `2026-04-03-auth-middleware-plan.md`).

Save the chosen plan using `invoke_save_artifact`:
- `stage: "plans"`
- `filename: "YYYY-MM-DD-<slug>-plan.md"` (e.g., `2026-04-03-auth-middleware-plan.md`)

### 7. Update State and Advance

Call `invoke_set_state` with `session_id: <pipeline_id>` and:
- `current_stage: "orchestrate"`
- `plan: "plans/YYYY-MM-DD-<slug>-plan.md"`

Then invoke the next stage:

```
Skill({ skill: "invoke:invoke-orchestrate" })
```

## Error Handling

- If a planner fails, present the error using the `❌` format from `invoke-messaging`. If only one planner succeeded, ask if the user wants to proceed with that single plan or retry.
- If all planners fail, investigate the error and offer to retry or fall back to manual planning.
- If the user selects `Re-plan with constraints` at any point, ask them to describe additional constraints, then dispatch new planners with those constraints appended to `task_context.task_description`.

## Key Principles

- Never save a plan without explicit user approval — always present first, then ask.
- Never skip the plan comparison step even when only one planner ran — the single plan still needs to be reviewed before approval.
- Research context from the scope stage is advisory, not authoritative — include it when available but do not block planning if it is absent.
- The plan file drives the orchestrate stage. A vague or incomplete plan produces poor task breakdowns. Iterate with the user until the plan is concrete enough for builders to act on without further clarification.
- Keep the user informed of planner progress without overwhelming them — one progress update per `invoke_get_batch_status` poll is sufficient.
