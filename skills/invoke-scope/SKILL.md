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

### 2. Initialize Project Context (if needed)

Call `invoke_get_context` to check if context.md exists.

**If context.md exists:** Skip to step 3. The context will be automatically injected into researcher prompts.

**If context.md does NOT exist:** Run the interactive initialization flow:

#### For existing codebases (project has source files):

1. Dispatch the `codebase` researcher to analyze the project structure, tech stack, patterns, and dependencies.
2. Once research completes, use the findings to ask the user **targeted** questions one at a time:
   - "What is this project's purpose and who is it for?"
   - Use research to make questions specific: "The codebase uses [framework] + [language] — are there any conventions around [pattern the research found] I should know about?"
   - "What are your near-term goals or priorities?"
3. Combine research findings + user answers into a context.md document following the template structure.
4. **Print the full draft context.md as text output first** — the user must be able to read it before being asked to approve.
5. THEN ask for approval using `AskUserQuestion`. Do NOT combine the draft and the approval prompt in the same message.
6. If approved, save via `invoke_init_context`. If the user wants changes, revise and repeat from step 4.

#### For greenfield projects (empty or minimal project):

1. Skip the research dispatch — nothing to analyze.
2. Ask the user interactive questions one at a time:
   - "What are you building and who is it for?"
   - "What tech stack are you planning to use?"
   - "Any architectural patterns or conventions you want to follow?"
   - "What are your immediate goals?"
3. Generate context.md from answers.
4. **Print the full draft context.md as text output first** — the user must be able to read it before being asked to approve.
5. THEN ask for approval using `AskUserQuestion`. Do NOT combine the draft and the approval prompt in the same message.
6. If approved, save via `invoke_init_context`. If the user wants changes, revise and repeat from step 4.

### 3. Dispatch Researchers

Read the pipeline config with `invoke_get_config` to see which researchers are available.

Present the available researchers using `AskUserQuestion` with `multiSelect: true`. Each option's label is the subrole name, description includes provider(s), model(s), and effort level.

#### Focus research tasks

Before dispatching, break the user's request into **focused research topics** — one per researcher dispatch. Do NOT pass the entire user request as a single task_description. Each researcher should investigate one specific area.

For example, if the user asks to "build an MVC framework with auth, routing, and a Vue frontend":
- `codebase` researcher gets: "Analyze the existing project structure, dependencies, and patterns"
- `best-practices` researcher gets: "Research PSR-compliant MVC routing patterns and middleware design"
- A second `best-practices` dispatch gets: "Research Vue + InertiaJS adapter patterns for PHP frameworks"

If the request covers more than 3 distinct topics, dispatch multiple batches of researchers rather than one overloaded batch. Each research task should be completable in under 5 minutes.

Wait for user selection, then dispatch the selected researchers using `invoke_dispatch_batch`:
- `create_worktrees: false` (researchers don't modify code)
- `task_context: { task_description: "<focused research topic, NOT the full user request>" }`

#### Wait for completion

Call `invoke_get_batch_status` with the batch ID — it will wait up to 60 seconds for a status change before returning. Keep calling until all researchers complete. Do NOT use `sleep` between calls — the tool handles waiting internally. Let the user know agents are working.

**CRITICAL: Do NOT proceed to step 4 while any dispatched agents are still running.** You must wait for all agents to complete or fail before moving on.

If agents have been running for more than 5 minutes, ask the user what to do using `AskUserQuestion`:

```
AskUserQuestion({
  questions: [{
    question: "Researchers have been running for over 5 minutes. What would you like to do?",
    header: "Long-running agents",
    multiSelect: false,
    options: [
      { label: "Keep waiting", description: "Continue waiting for all agents to finish" },
      { label: "Proceed with partial results", description: "Cancel remaining agents and use what we have so far" },
      { label: "Cancel all", description: "Cancel all agents and abort research" }
    ]
  }]
})
```

Only the user decides when to skip — never make this decision yourself.

### 4. Review Research

Read the research reports from the batch results. Use them to inform your scoping questions.

### 5. Ask Clarifying Questions

Using the research as context, ask clarifying questions **one at a time**:
- Focus on decisions only the user can make (don't ask things the research already answered)
- Use multiple choice when possible
- Cover: purpose, constraints, success criteria, edge cases, non-functional requirements

### 6. Produce Spec

When scope is clear, write a spec document covering:
- **Goal** — what we're building and why
- **Requirements** — specific, testable requirements
- **Constraints** — technical limitations, compatibility needs
- **Acceptance Criteria** — how we know it's done
- **Out of Scope** — explicitly excluded items

Generate a short, descriptive filename slug from the feature being scoped (e.g., "auth-middleware", "car-crud-api", "payment-integration"). Use the format `YYYY-MM-DD-<slug>-spec.md`.

Save the spec using `invoke_save_artifact`:
- `stage: "specs"`
- `filename: "YYYY-MM-DD-<slug>-spec.md"` (e.g., `2026-04-03-auth-middleware-spec.md`)

### 7. Update State

Call `invoke_set_state` with:
- `current_stage: "scope"` (until user approves)
- `spec: "specs/YYYY-MM-DD-<slug>-spec.md"`

### 8. Get Approval

**Print the full spec as text output first** so the user can read it. THEN, in a separate message, ask for approval using `AskUserQuestion`. Do NOT combine the spec content and the approval prompt.

Once approved, update state to `current_stage: "plan"`. If the user wants changes, revise the spec and repeat.

The plan stage skill will auto-trigger from here.

## Error Handling

- If a researcher fails or times out, present the error and ask if the user wants to retry or proceed without it
- If the user wants to abort, call `invoke_set_state` to reset the pipeline

## Key Principle

The research should make the scoping conversation faster and smarter. Don't ask the user about things the research already uncovered — focus on decisions that require human judgment.
