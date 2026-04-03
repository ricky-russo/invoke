---
name: invoke-scope
description: "MUST USE when the user wants to build a feature, add functionality, fix something complex, or start new development work. Triggers on: 'build', 'implement', 'create feature', 'add functionality', 'develop'. Always invoke this skill before starting any implementation work."
---

# Invoke — Scope Stage

You are running the scope stage of the invoke pipeline. Your job is to produce a clear, validated spec by first dispatching researchers and then asking the user smart clarifying questions.

## Messaging

Load the `invoke-messaging` skill and follow its standards for all user-facing output — agent dispatches, progress updates, results, errors, and selection prompts. Use `AskUserQuestion` for all user decisions.

## Flow

### 1. Initialize Pipeline

Call `invoke_set_state` to create or verify pipeline state:
- If no active pipeline, initialize one with `current_stage: "scope"`
- If an active pipeline exists at a later stage, ask the user if they want to start a new pipeline

### 2. Dispatch Researchers

Read the pipeline config with `invoke_get_config` to see which researchers are available.

Present the available researchers using `AskUserQuestion` with `multiSelect: true`. Each option's label is the subrole name, description includes provider(s), model(s), and effort level.

Wait for user selection, then dispatch the selected researchers using `invoke_dispatch_batch`:
- `create_worktrees: false` (researchers don't modify code)
- `task_context: { task_description: "<user's initial request>" }`

Call `invoke_get_batch_status` with the batch ID — it will wait up to 60 seconds for a status change before returning. Keep calling until all researchers complete. Do NOT use `sleep` between calls — the tool handles waiting internally. Let the user know agents are working.

### 3. Review Research

Read the research reports from the batch results. Use them to inform your scoping questions.

### 4. Ask Clarifying Questions

Using the research as context, ask clarifying questions **one at a time**:
- Focus on decisions only the user can make (don't ask things the research already answered)
- Use multiple choice when possible
- Cover: purpose, constraints, success criteria, edge cases, non-functional requirements

### 5. Produce Spec

When scope is clear, write a spec document covering:
- **Goal** — what we're building and why
- **Requirements** — specific, testable requirements
- **Constraints** — technical limitations, compatibility needs
- **Acceptance Criteria** — how we know it's done
- **Out of Scope** — explicitly excluded items

Save the spec using `invoke_save_artifact`:
- `stage: "specs"`
- `filename: "spec.md"`

### 6. Update State

Call `invoke_set_state` with:
- `current_stage: "scope"` (until user approves)
- `spec: "specs/spec.md"`

### 7. Get Approval

Present the spec to the user for approval. Once approved, update state to `current_stage: "plan"`.

The plan stage skill will auto-trigger from here.

## Error Handling

- If a researcher fails or times out, present the error and ask if the user wants to retry or proceed without it
- If the user wants to abort, call `invoke_set_state` to reset the pipeline

## Key Principle

The research should make the scoping conversation faster and smarter. Don't ask the user about things the research already uncovered — focus on decisions that require human judgment.
