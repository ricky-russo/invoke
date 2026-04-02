# Invoke Skills, Defaults & Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the skill files that orchestrate the invoke pipeline, the default role/strategy prompt templates, the starter pipeline config, and the Claude Code hooks.

**Architecture:** Skills are markdown behavioral protocols that auto-trigger in Claude Code sessions. They call invoke-mcp tools to dispatch agents, manage state, and store artifacts. Default prompts ship in `defaults/` and get copied to `.invoke/` on project init. Hooks detect active pipelines and run post-merge validation.

**Tech Stack:** Markdown (skills + prompts), YAML (config), JSON (hooks), TypeScript (init script)

**Spec:** `docs/superpowers/specs/2026-04-02-invoke-design.md`

**Depends on:** Plan 1 (MCP Server) must be complete — all MCP tools are available.

---

## File Structure

```
invoke2/
  skills/
    invoke-scope.md
    invoke-plan.md
    invoke-orchestrate.md
    invoke-build.md
    invoke-review.md
    invoke-resume.md
    invoke-manage.md

  defaults/
    pipeline.yaml                    # starter config
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

  src/
    init.ts                          # invoke init command

  hooks/
    session-start.js                 # auto-resume detection
    post-merge-validation.js         # lint/test after merge

  tests/
    init.test.ts
```

---

### Task 1: Default Pipeline Config

**Files:**
- Create: `defaults/pipeline.yaml`

- [ ] **Step 1: Create the starter pipeline config**

Create `defaults/pipeline.yaml`:

```yaml
# Invoke Pipeline Configuration
# This file defines providers, roles, strategies, and settings for your invoke pipeline.
# Customize roles and strategies by editing the referenced .md files.

providers:
  claude:
    cli: claude
    args: ["--print", "--model", "{{model}}"]
  codex:
    cli: codex
    args: ["--model", "{{model}}", "--reasoning-effort", "{{effort}}"]

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
    dependencies:
      prompt: .invoke/roles/researcher/dependencies.md
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
      provider: claude
      model: opus-4.6
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
      provider: claude
      model: opus-4.6
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
    ux:
      prompt: .invoke/roles/reviewer/ux.md
      provider: claude
      model: opus-4.6
      effort: medium
    accessibility:
      prompt: .invoke/roles/reviewer/accessibility.md
      provider: claude
      model: opus-4.6
      effort: medium

strategies:
  tdd:
    prompt: .invoke/strategies/tdd.md
  implementation-first:
    prompt: .invoke/strategies/implementation-first.md
  prototype:
    prompt: .invoke/strategies/prototype.md
  bug-fix:
    prompt: .invoke/strategies/bug-fix.md

settings:
  default_strategy: tdd
  agent_timeout: 300000
  commit_style: per-batch
  work_branch_prefix: invoke/work
```

- [ ] **Step 2: Verify the config loads with our config loader**

```bash
mkdir -p /tmp/invoke-config-test/.invoke
cp defaults/pipeline.yaml /tmp/invoke-config-test/.invoke/pipeline.yaml
npx tsx -e "import { loadConfig } from './src/config.js'; loadConfig('/tmp/invoke-config-test').then(c => console.log('OK:', Object.keys(c.roles).join(', '))).catch(e => console.error('FAIL:', e.message))"
```

Expected: `OK: researcher, planner, builder, reviewer`

- [ ] **Step 3: Commit**

```bash
git add defaults/pipeline.yaml
git commit -m "feat: add default pipeline configuration"
```

---

### Task 2: Default Strategy Prompts

**Files:**
- Create: `defaults/strategies/tdd.md`
- Create: `defaults/strategies/implementation-first.md`
- Create: `defaults/strategies/prototype.md`
- Create: `defaults/strategies/bug-fix.md`

- [ ] **Step 1: Create TDD strategy prompt**

Create `defaults/strategies/tdd.md`:

```markdown
# Test-Driven Development Strategy

You are building a feature using test-driven development.

## Task
{{task_description}}

## Acceptance Criteria
{{acceptance_criteria}}

## Relevant Files
{{relevant_files}}

## Interfaces
{{interfaces}}

## Instructions

Follow the TDD cycle strictly:

1. **Red** — Write a failing test that validates one acceptance criterion. Run it to confirm it fails with the expected error.
2. **Green** — Write the minimum code to make the test pass. Do not add functionality beyond what the test requires.
3. **Refactor** — Clean up the implementation while keeping tests green. Remove duplication, improve naming, simplify logic.
4. **Repeat** — Move to the next acceptance criterion.

## Rules

- Never write implementation code without a failing test first.
- Each test should verify one specific behavior.
- Run the full test suite after each green-refactor cycle to catch regressions.
- Commit after each passing cycle.
- If you're unsure how to test something, write the test for the interface you wish existed, then implement to match.
- Do not mock dependencies unless they are external services or slow I/O. Prefer real implementations.
```

- [ ] **Step 2: Create implementation-first strategy prompt**

Create `defaults/strategies/implementation-first.md`:

```markdown
# Implementation-First Strategy

You are building a feature by implementing first, then adding tests.

## Task
{{task_description}}

## Acceptance Criteria
{{acceptance_criteria}}

## Relevant Files
{{relevant_files}}

## Interfaces
{{interfaces}}

## Instructions

1. **Implement** — Build the feature to meet all acceptance criteria. Focus on correctness and clarity.
2. **Test** — Write tests that verify each acceptance criterion. Cover edge cases and error paths.
3. **Refine** — Review your implementation for quality. Fix any issues found during testing.
4. **Commit** — Commit the implementation and tests together.

## Rules

- Implement the full feature before writing tests.
- Tests should verify behavior, not implementation details.
- Cover happy paths, edge cases, and error conditions.
- Run all tests before committing to ensure nothing is broken.
```

- [ ] **Step 3: Create prototype strategy prompt**

Create `defaults/strategies/prototype.md`:

```markdown
# Prototype Strategy

You are building a quick prototype. Speed over quality.

## Task
{{task_description}}

## Acceptance Criteria
{{acceptance_criteria}}

## Relevant Files
{{relevant_files}}

## Interfaces
{{interfaces}}

## Instructions

1. **Build fast** — Get a working version as quickly as possible. Skip tests, skip edge cases, skip error handling.
2. **Make it work** — Focus on the happy path. Get the core functionality demonstrable.
3. **Commit** — Commit with a clear "prototype" or "spike" label.

## Rules

- No tests required. This is a spike.
- Hardcode values if it speeds things up.
- Skip error handling — assume inputs are valid.
- Do not refactor. This code may be thrown away.
- Leave TODO comments for anything that would need to be done properly.
- Make it clear in commit messages that this is a prototype.
```

- [ ] **Step 4: Create bug-fix strategy prompt**

Create `defaults/strategies/bug-fix.md`:

```markdown
# Bug-Fix Strategy

You are fixing a bug using a test-first approach.

## Task
{{task_description}}

## Acceptance Criteria
{{acceptance_criteria}}

## Relevant Files
{{relevant_files}}

## Interfaces
{{interfaces}}

## Instructions

1. **Reproduce** — Write a failing test that demonstrates the bug. The test should pass once the bug is fixed.
2. **Diagnose** — Read the relevant code to understand the root cause. Do not guess.
3. **Fix** — Make the minimum change to fix the bug. Do not refactor surrounding code.
4. **Verify** — Run the new test to confirm it passes. Run the full test suite to confirm no regressions.
5. **Commit** — Commit the test and fix together.

## Rules

- Always write the failing test before attempting a fix.
- Fix the root cause, not the symptom.
- Make the smallest possible change. Do not "improve" nearby code.
- If the fix requires a larger change, stop and report — the task may need to be re-scoped.
- Include the bug description in the commit message.
```

- [ ] **Step 5: Commit**

```bash
git add defaults/strategies/
git commit -m "feat: add default build strategy prompts"
```

---

### Task 3: Default Researcher Role Prompts

**Files:**
- Create: `defaults/roles/researcher/codebase.md`
- Create: `defaults/roles/researcher/best-practices.md`
- Create: `defaults/roles/researcher/dependencies.md`

- [ ] **Step 1: Create codebase researcher prompt**

Create `defaults/roles/researcher/codebase.md`:

```markdown
# Codebase Researcher

You are analyzing a codebase to provide context for a development task.

## Task
{{task_description}}

## Instructions

Analyze the codebase and produce a research report covering:

### Architecture
- Overall project structure and organization
- Key modules and their responsibilities
- How components communicate (APIs, events, shared state)

### Patterns & Conventions
- Coding style and naming conventions used
- Design patterns in use (MVC, repository, etc.)
- Testing approach and frameworks
- Error handling patterns

### Relevant Code
- Files and modules most relevant to the task
- Existing code that could be reused or extended
- Interfaces that the new code must conform to

### Constraints
- Technical constraints discovered (framework limitations, API boundaries)
- Dependencies that affect the approach
- Existing tests that must continue to pass

## Output Format

Structure your report with the headers above. Be specific — include file paths, function names, and code snippets where relevant. Focus on what will help an implementer build the right thing the first time.
```

- [ ] **Step 2: Create best-practices researcher prompt**

Create `defaults/roles/researcher/best-practices.md`:

```markdown
# Best Practices Researcher

You are researching best practices and established patterns for a development task.

## Task
{{task_description}}

## Instructions

Research and report on best practices relevant to this task:

### Industry Standards
- Established patterns for this type of feature
- Common pitfalls and how to avoid them
- Security considerations (OWASP, input validation, etc.)

### Framework Best Practices
- How the project's framework recommends implementing this
- Built-in utilities or helpers that should be used
- Anti-patterns specific to this framework

### Testing Best Practices
- What should be unit tested vs integration tested
- Edge cases commonly missed for this type of feature
- Test data strategies

### Performance Considerations
- Common performance pitfalls for this type of feature
- Caching strategies if applicable
- Scalability considerations

## Output Format

Structure your report with the headers above. Be actionable — don't just list principles, explain how they apply to this specific task.
```

- [ ] **Step 3: Create dependencies researcher prompt**

Create `defaults/roles/researcher/dependencies.md`:

```markdown
# Dependencies Researcher

You are analyzing the project's dependencies and their impact on a development task.

## Task
{{task_description}}

## Instructions

Analyze the project dependencies and report:

### Current Dependencies
- Libraries and frameworks relevant to the task
- Their versions and any known issues
- APIs and utilities they provide that are useful for this task

### New Dependencies Needed
- Whether any new libraries are needed for this task
- Comparison of options if multiple libraries could work
- License and maintenance status of recommended libraries

### Compatibility
- Version compatibility between existing and new dependencies
- Breaking changes or migration concerns
- Peer dependency requirements

### Integration Points
- How the task integrates with existing dependencies
- Configuration or setup required
- Examples of how similar features use these dependencies in the codebase

## Output Format

Structure your report with the headers above. Include specific package names, version numbers, and import paths.
```

- [ ] **Step 4: Commit**

```bash
git add defaults/roles/researcher/
git commit -m "feat: add default researcher role prompts"
```

---

### Task 4: Default Planner Role Prompts

**Files:**
- Create: `defaults/roles/planner/architect.md`
- Create: `defaults/roles/planner/alternative.md`

- [ ] **Step 1: Create architect planner prompt**

Create `defaults/roles/planner/architect.md`:

```markdown
# Architect Planner

You are creating an implementation plan for a development task.

## Spec
{{task_description}}

## Research Context
{{research_context}}

## Instructions

Create a detailed implementation plan that covers:

### Architecture Decision
- High-level approach and why it's the best fit
- Key technical decisions and their rationale
- Trade-offs considered

### Components
- What needs to be built (new files, modules, classes)
- What needs to be modified (existing files and why)
- How components interact

### Implementation Order
- What to build first and why (dependency order)
- Which parts can be parallelized
- Natural commit points

### Testing Strategy
- What to test at each level (unit, integration)
- Key edge cases to cover
- How to verify the feature works end-to-end

### Risks
- What could go wrong
- Dependencies or assumptions that could break
- Fallback approaches if the primary plan hits issues

## Output Format

Write a clear, actionable plan that an engineer could follow step-by-step. Include file paths, function signatures, and data structures where they help clarify the approach.
```

- [ ] **Step 2: Create alternative planner prompt**

Create `defaults/roles/planner/alternative.md`:

```markdown
# Alternative Planner

You are creating an alternative implementation plan to provide a different perspective.

## Spec
{{task_description}}

## Research Context
{{research_context}}

## Instructions

Create an implementation plan that takes a different approach than the obvious one. Consider:

### Alternative Approach
- A different architecture or pattern than the most obvious choice
- Why this alternative might be better in certain contexts
- What it optimizes for (simplicity, performance, maintainability, extensibility)

### Components
- What needs to be built with this approach
- How this differs from a conventional implementation
- Files and modules involved

### Trade-offs
- What you gain with this approach
- What you sacrifice
- When this approach would be clearly better or clearly worse

### Implementation Order
- Step-by-step build order
- Dependencies between steps
- Natural commit points

### Risks
- Unique risks of this alternative approach
- How to mitigate them
- When to abandon this approach and fall back to conventional

## Output Format

Be explicit about how this differs from a conventional approach and why someone might prefer it. Include enough detail for an engineer to evaluate and execute it.
```

- [ ] **Step 3: Commit**

```bash
git add defaults/roles/planner/
git commit -m "feat: add default planner role prompts"
```

---

### Task 5: Default Builder Role Prompt

**Files:**
- Create: `defaults/roles/builder/default.md`

- [ ] **Step 1: Create default builder prompt**

Create `defaults/roles/builder/default.md`:

```markdown
# Builder

You are implementing a specific task as part of a larger development plan.

## Task
{{task_description}}

## Acceptance Criteria
{{acceptance_criteria}}

## Relevant Files
{{relevant_files}}

## Interfaces
{{interfaces}}

## Instructions

Implement this task completely and correctly:

1. Read and understand the acceptance criteria before writing any code.
2. Follow the build strategy instructions provided below (if any).
3. Implement the feature to meet all acceptance criteria.
4. Verify your implementation works by running tests.
5. Commit your work with a clear, descriptive message.

## Rules

- Implement exactly what is asked. Do not add extra features.
- Follow existing code patterns and conventions in the project.
- Each file should have one clear responsibility.
- Name things clearly — names should describe what something does, not how it works.
- If something is unclear, stop and ask rather than guessing.
- If you cannot complete the task, report what you accomplished and what blocked you.

## Output Format

When complete, report:
- What you implemented
- Files created or modified
- Tests written and their results
- Any concerns or decisions you made
```

- [ ] **Step 2: Commit**

```bash
git add defaults/roles/builder/
git commit -m "feat: add default builder role prompt"
```

---

### Task 6: Default Reviewer Role Prompts

**Files:**
- Create: `defaults/roles/reviewer/security.md`
- Create: `defaults/roles/reviewer/code-quality.md`
- Create: `defaults/roles/reviewer/performance.md`
- Create: `defaults/roles/reviewer/ux.md`
- Create: `defaults/roles/reviewer/accessibility.md`

All reviewer prompts must output findings in a standardized format that the parsers can extract:

```
### Finding N
**Severity:** critical|high|medium|low
**File:** path/to/file.ts
**Line:** 42
**Issue:** Description of the issue
**Suggestion:** How to fix it
```

- [ ] **Step 1: Create security reviewer prompt**

Create `defaults/roles/reviewer/security.md`:

```markdown
# Security Reviewer

You are reviewing code for security vulnerabilities.

## Code to Review
{{task_description}}

## Diff
{{diff}}

## Instructions

Review the code for security issues, focusing on:

- **Injection** — SQL injection, command injection, XSS, template injection
- **Authentication & Authorization** — broken auth, privilege escalation, insecure session management
- **Data Exposure** — sensitive data in logs, unencrypted storage, overly broad API responses
- **Input Validation** — missing validation, insufficient sanitization, type confusion
- **Cryptography** — weak algorithms, hardcoded secrets, improper key management
- **Dependencies** — known vulnerable packages, outdated libraries
- **Configuration** — debug modes, default credentials, overly permissive CORS

## Output Format

If you find issues, report each one using this exact format:

### Finding N
**Severity:** critical|high|medium|low
**File:** path/to/file
**Line:** line number
**Issue:** Clear description of the vulnerability
**Suggestion:** Specific fix recommendation

If no issues found, state: "No security issues found."

Be precise. Only report real vulnerabilities, not hypothetical concerns.
```

- [ ] **Step 2: Create code-quality reviewer prompt**

Create `defaults/roles/reviewer/code-quality.md`:

```markdown
# Code Quality Reviewer

You are reviewing code for quality, maintainability, and correctness.

## Code to Review
{{task_description}}

## Diff
{{diff}}

## Instructions

Review the code for quality issues, focusing on:

- **Correctness** — logic errors, off-by-one, race conditions, null/undefined handling
- **Clarity** — unclear naming, confusing control flow, missing context
- **Maintainability** — tight coupling, god objects, duplicated logic, missing abstractions
- **Testing** — missing test coverage, tests that don't test real behavior, brittle tests
- **Conventions** — inconsistency with codebase patterns, style violations
- **Error Handling** — swallowed errors, missing error paths, unhelpful error messages
- **Complexity** — unnecessary abstractions, over-engineering, premature optimization

## Output Format

If you find issues, report each one using this exact format:

### Finding N
**Severity:** critical|high|medium|low
**File:** path/to/file
**Line:** line number
**Issue:** Clear description of the quality concern
**Suggestion:** Specific improvement recommendation

If no issues found, state: "No quality issues found."

Focus on issues that matter. Don't nitpick formatting or style preferences.
```

- [ ] **Step 3: Create performance reviewer prompt**

Create `defaults/roles/reviewer/performance.md`:

```markdown
# Performance Reviewer

You are reviewing code for performance issues.

## Code to Review
{{task_description}}

## Diff
{{diff}}

## Instructions

Review the code for performance issues, focusing on:

- **Algorithmic Complexity** — O(n^2) or worse where O(n) is possible, unnecessary iterations
- **Memory** — memory leaks, unbounded caches, large object copies, retained references
- **I/O** — N+1 queries, missing batching, synchronous I/O in hot paths, missing caching
- **Concurrency** — blocking the event loop, missing parallelization opportunities, lock contention
- **Bundle Size** — unnecessary imports, large dependencies for small features
- **Rendering** — unnecessary re-renders, missing memoization, layout thrashing

## Output Format

If you find issues, report each one using this exact format:

### Finding N
**Severity:** critical|high|medium|low
**File:** path/to/file
**Line:** line number
**Issue:** Clear description of the performance concern
**Suggestion:** Specific optimization recommendation

If no issues found, state: "No performance issues found."

Only flag real performance issues, not micro-optimizations. Consider the actual scale and context.
```

- [ ] **Step 4: Create UX reviewer prompt**

Create `defaults/roles/reviewer/ux.md`:

```markdown
# UX Reviewer

You are reviewing code for user experience issues.

## Code to Review
{{task_description}}

## Diff
{{diff}}

## Instructions

Review the code for UX issues, focusing on:

- **Error States** — unclear error messages, missing error states, unhandled failures
- **Loading States** — missing loading indicators, jarring transitions, layout shifts
- **Feedback** — missing confirmation for actions, unclear success/failure states
- **Consistency** — inconsistent behavior patterns, surprising interactions
- **Edge Cases** — empty states, long content, offline behavior, slow connections
- **Validation** — unclear validation messages, validation timing, missing inline hints

## Output Format

If you find issues, report each one using this exact format:

### Finding N
**Severity:** critical|high|medium|low
**File:** path/to/file
**Line:** line number
**Issue:** Clear description of the UX concern
**Suggestion:** Specific improvement recommendation

If no issues found, state: "No UX issues found."

Focus on issues that affect real users. Consider the context and typical usage patterns.
```

- [ ] **Step 5: Create accessibility reviewer prompt**

Create `defaults/roles/reviewer/accessibility.md`:

```markdown
# Accessibility Reviewer

You are reviewing code for accessibility issues.

## Code to Review
{{task_description}}

## Diff
{{diff}}

## Instructions

Review the code for accessibility issues, focusing on:

- **Semantic HTML** — missing landmarks, incorrect heading hierarchy, non-semantic elements
- **ARIA** — missing labels, incorrect roles, redundant ARIA attributes
- **Keyboard Navigation** — unreachable elements, missing focus management, focus traps
- **Screen Readers** — missing alt text, unclear link text, hidden content issues
- **Color & Contrast** — insufficient contrast ratios, color-only indicators
- **Motion** — missing prefers-reduced-motion support, auto-playing animations
- **Forms** — missing labels, unclear instructions, inaccessible error messages

## Output Format

If you find issues, report each one using this exact format:

### Finding N
**Severity:** critical|high|medium|low
**File:** path/to/file
**Line:** line number
**Issue:** Clear description of the accessibility concern
**Suggestion:** Specific fix recommendation with WCAG reference if applicable

If no issues found, state: "No accessibility issues found."

Reference WCAG guidelines where applicable (e.g., WCAG 2.1 SC 1.4.3 for contrast).
```

- [ ] **Step 6: Commit**

```bash
git add defaults/roles/reviewer/
git commit -m "feat: add default reviewer role prompts"
```

---

### Task 7: Skill — invoke-scope

**Files:**
- Create: `skills/invoke-scope.md`

- [ ] **Step 1: Create the scope skill**

Create `skills/invoke-scope.md`:

```markdown
---
name: invoke-scope
description: Use when the user wants to build a feature, add functionality, fix something complex, or start new development work that would benefit from a structured pipeline
---

# Invoke — Scope Stage

You are running the scope stage of the invoke pipeline. Your job is to produce a clear, validated spec by first dispatching researchers and then asking the user smart clarifying questions.

## Flow

### 1. Initialize Pipeline

Call `invoke_set_state` to create or verify pipeline state:
- If no active pipeline, initialize one with `current_stage: "scope"`
- If an active pipeline exists at a later stage, ask the user if they want to start a new pipeline

### 2. Dispatch Researchers

Read the pipeline config with `invoke_get_config` to see which researchers are available.

Present the available researchers to the user:
> "Before we scope this out, I can dispatch researchers to gather context. Available researchers: [list sub-roles under researcher]. Which ones should I run?"

Wait for user selection, then dispatch the selected researchers using `invoke_dispatch_batch`:
- `create_worktrees: false` (researchers don't modify code)
- `task_context: { task_description: "<user's initial request>" }`

Poll `invoke_get_batch_status` until all researchers complete. While waiting, let the user know agents are working.

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
```

- [ ] **Step 2: Commit**

```bash
git add skills/invoke-scope.md
git commit -m "feat: add invoke-scope skill"
```

---

### Task 8: Skill — invoke-plan

**Files:**
- Create: `skills/invoke-plan.md`

- [ ] **Step 1: Create the plan skill**

Create `skills/invoke-plan.md`:

```markdown
---
name: invoke-plan
description: Use when a spec has been approved and needs an implementation plan — typically after invoke-scope completes or when the user has a ready spec
---

# Invoke — Plan Stage

You are running the plan stage of the invoke pipeline. Your job is to dispatch planners to generate competing implementation plans, then help the user choose the best one.

## Flow

### 1. Verify State

Call `invoke_get_state` to verify we're at the plan stage. Read the spec from `invoke_read_artifact` with `stage: "specs"`, `filename: "spec.md"`.

### 2. Dispatch Planners

Read the pipeline config with `invoke_get_config` to see available planners.

Present available planners to the user:
> "Ready to plan. Available planners: [list sub-roles under planner]. Which ones should I dispatch? Running multiple gives you competing approaches to compare."

Wait for user selection, then dispatch selected planners using `invoke_dispatch_batch`:
- `create_worktrees: false`
- `task_context: { task_description: "<full spec content>", research_context: "<research reports if available>" }`

Poll `invoke_get_batch_status` until complete.

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

Save the chosen plan using `invoke_save_artifact`:
- `stage: "plans"`
- `filename: "plan.md"`

### 6. Update State

Call `invoke_set_state` with:
- `current_stage: "orchestrate"`
- `plan: "plans/plan.md"`

The orchestrate stage skill will auto-trigger from here.

## Error Handling

- If a planner fails, present the error. If only one planner succeeded, ask if the user wants to proceed with that single plan or retry.
- If all planners fail, investigate the error and offer to retry or fall back to manual planning.
```

- [ ] **Step 2: Commit**

```bash
git add skills/invoke-plan.md
git commit -m "feat: add invoke-plan skill"
```

---

### Task 9: Skill — invoke-orchestrate

**Files:**
- Create: `skills/invoke-orchestrate.md`

- [ ] **Step 1: Create the orchestrate skill**

Create `skills/invoke-orchestrate.md`:

```markdown
---
name: invoke-orchestrate
description: Use when an implementation plan has been approved and needs to be broken into executable tasks — typically after invoke-plan completes
---

# Invoke — Orchestrate Stage

You are running the orchestrate stage. Your job is to break the approved plan into small, isolated, context-safe tasks grouped into sequential batches.

## Flow

### 1. Verify State

Call `invoke_get_state` to verify we're at the orchestrate stage. Read the plan from `invoke_read_artifact` with `stage: "plans"`, `filename: "plan.md"`.

### 2. Choose Build Strategy

Read the config with `invoke_get_config` to see available strategies.

Ask the user:
> "Which build strategy should agents use? Available: [list strategies]. Default: [settings.default_strategy]"

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

Present the task breakdown to the user:

For each batch:
> **Batch N** (parallel)
> - Task: [id] — [description] (files: [list])
> - Task: [id] — [description] (files: [list])

Ask:
> "Does this breakdown look right? Any tasks to split, merge, or reorder?"

### 6. Save Tasks

Save the task breakdown using `invoke_save_artifact`:
- `stage: "plans"`
- `filename: "tasks.json"`

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
```

- [ ] **Step 2: Commit**

```bash
git add skills/invoke-orchestrate.md
git commit -m "feat: add invoke-orchestrate skill"
```

---

### Task 10: Skill — invoke-build

**Files:**
- Create: `skills/invoke-build.md`

- [ ] **Step 1: Create the build skill**

Create `skills/invoke-build.md`:

```markdown
---
name: invoke-build
description: Use when an orchestrated task breakdown has been approved and is ready to build — typically after invoke-orchestrate completes
---

# Invoke — Build Stage

You are running the build stage. Your job is to dispatch builder agents for each batch, manage worktrees, merge results, and track progress.

## Flow

### 1. Verify State

Call `invoke_get_state` to verify we're at the build stage. Read the task breakdown from `invoke_read_artifact` with `stage: "plans"`, `filename: "tasks.json"`.

### 2. Create Work Branch

The first time build runs for this pipeline, note the current branch. All build work happens on a temporary work branch — but since agents work in worktrees, the current branch stays clean until merge.

### 3. Execute Batches

For each batch in order:

#### a. Select Builders

Ask the user which builder roles to use for this batch:
> "Batch N ready ([X] tasks). Available builders: [list sub-roles under builder]. Which builders should handle these tasks?"

#### b. Dispatch Batch

Call `invoke_dispatch_batch` with:
- `tasks`: the batch's tasks with their task_context
- `create_worktrees: true`

Each task's prompt is composed by the MCP from the builder role template + strategy template + task context.

#### c. Monitor Progress

Poll `invoke_get_batch_status` periodically. Report progress to the user:
> "Batch N progress: task-1 ✅, task-2 running, task-3 running"

Allow the user to interact while waiting (e.g., "how's it going?").

#### d. Collect Results

When the batch completes, review results:
- For successful tasks: proceed to merge
- For failed tasks: present the error and ask: "Retry, skip, or abort batch?"

#### e. Merge Worktrees

For each completed task, call `invoke_merge_worktree` with the task_id. This merges the worktree branch and cleans up.

If a merge conflict occurs, present it to the user and help resolve it.

#### f. Post-Merge Validation

The post-merge validation hook will run automatically (lint, tests). If it fails, present the failure and help fix it before proceeding.

#### g. Update State

Update the batch status in the pipeline state via `invoke_set_state`.

### 4. Build Complete

When all batches are done, update state:
- `current_stage: "review"`

The review stage skill will auto-trigger from here.

## Error Handling

- **Agent timeout**: Present error, offer retry/skip/abort
- **Agent error**: Present raw output, offer retry/skip/abort
- **Merge conflict**: Present conflicts, help user resolve
- **Validation failure**: Present test/lint output, help fix before next batch
- **User abort**: Clean up worktrees via `invoke_cleanup_worktrees`, ask if they want to keep or discard the work branch

## Key Principles

- Never proceed to the next batch if the current batch has unresolved failures
- Always merge and validate before starting the next batch
- Keep the user informed of progress without overwhelming them
```

- [ ] **Step 2: Commit**

```bash
git add skills/invoke-build.md
git commit -m "feat: add invoke-build skill"
```

---

### Task 11: Skill — invoke-review

**Files:**
- Create: `skills/invoke-review.md`

- [ ] **Step 1: Create the review skill**

Create `skills/invoke-review.md`:

```markdown
---
name: invoke-review
description: Use when build is complete and code needs review, or when a build-review loop iteration needs to start — typically after invoke-build completes
---

# Invoke — Review Stage

You are running the review stage. Your job is to dispatch reviewers, present findings, let the user triage, and loop back to build for fixes.

## Flow

### 1. Verify State

Call `invoke_get_state` to verify we're at the review stage.

### 2. Select Reviewers

Read the config with `invoke_get_config` to see available reviewers.

Present the reviewer list to the user:
> "Build complete. Which reviewers should I run? Available:"
> - security — Security vulnerability analysis
> - code-quality — Code quality and maintainability
> - performance — Performance analysis
> - ux — User experience review
> - accessibility — Accessibility compliance
>
> "Select the reviewers for this cycle (e.g., 'security, code-quality, performance'):"

### 3. Dispatch Reviewers

Dispatch selected reviewers using `invoke_dispatch_batch`:
- `create_worktrees: false` (reviewers don't modify code)
- `task_context: { task_description: "<what was built — summary from plan>", diff: "<git diff of all changes>" }`

Poll `invoke_get_batch_status` until complete.

### 4. Present Findings

Collect findings from all reviewers. Present them grouped by reviewer:

> **Security Review** (3 findings)
> 1. [HIGH] SQL injection in src/db/query.ts:42 — Use parameterized queries
> 2. [MEDIUM] Session token in localStorage src/auth/session.ts:15 — Use HttpOnly cookies
> 3. [LOW] Verbose error messages src/api/handler.ts:88 — Sanitize error output
>
> **Code Quality Review** (1 finding)
> 1. [MEDIUM] Duplicated validation logic in src/api/users.ts:30 and src/api/posts.ts:25 — Extract shared validator

### 5. User Triage

For each finding, ask the user:
> "Accept or dismiss? (You can also accept/dismiss all from a reviewer)"

Options:
- **Accept** — will be sent to build agents for fixing
- **Dismiss** — false positive or intentional, skip it

### 6. Auto-Fix Accepted Findings

Bundle accepted findings as fix tasks. For each finding, create a task:
- `task_description`: the finding details + suggestion
- `acceptance_criteria`: the specific fix expected
- `relevant_files`: the file(s) mentioned in the finding

Dispatch fix tasks using `invoke_dispatch_batch` with `create_worktrees: true`.

Poll, collect results, merge — same flow as build stage.

### 7. Next Cycle

After fixes are applied, ask the user:
> "Fixes applied. Want to run another review cycle, or are you satisfied?"

If another cycle: loop back to step 2.
If satisfied: proceed to completion.

### 8. Complete Pipeline

Save the review history using `invoke_save_artifact`:
- `stage: "reviews"`
- `filename: "review-cycle-N.json"`

### 9. Commit Strategy

Ask the user how to commit the final result:
> "Pipeline complete. How should I commit?"
> 1. One commit (squash all)
> 2. Per batch (N commits) — [preview commit messages]
> 3. Per task (N commits) — [preview commit messages]
> 4. Custom grouping

Execute the chosen commit strategy. Clean up the work branch after squash merge.

Update state:
- `current_stage: "complete"`

## Error Handling

- If a reviewer fails, present the error and proceed with other reviewers' results
- If fix agents fail, present the error and let the user decide: retry, fix manually, or dismiss the finding
- If all reviewers return no findings, congratulate and proceed to commit

## Key Principles

- Present findings clearly — severity, location, description, suggestion
- Let the user make all triage decisions — never auto-dismiss findings
- The loop continues until the user is satisfied, not until reviewers find zero issues
```

- [ ] **Step 2: Commit**

```bash
git add skills/invoke-review.md
git commit -m "feat: add invoke-review skill"
```

---

### Task 12: Skill — invoke-resume

**Files:**
- Create: `skills/invoke-resume.md`

- [ ] **Step 1: Create the resume skill**

Create `skills/invoke-resume.md`:

```markdown
---
name: invoke-resume
description: Use when the user returns to a project that has an in-progress invoke pipeline, or when a session-start hook detects active pipeline state
---

# Invoke — Resume Pipeline

You are resuming an in-progress invoke pipeline from a previous session.

## Flow

### 1. Read State

Call `invoke_get_state` to get the current pipeline state.

If state is null, inform the user there's no active pipeline and offer to start one (which will trigger invoke-scope).

### 2. Present Status

Present the pipeline status clearly:

> "Found an active invoke pipeline:"
> - **Pipeline ID:** [id]
> - **Started:** [date]
> - **Current Stage:** [stage]
> - **Spec:** [spec filename if set]
> - **Plan:** [plan filename if set]
> - **Strategy:** [strategy if set]
> - **Batches:** [N completed / M total]
> - **Work Branch:** [branch name if set]

If there are any active worktrees, list them.

### 3. Offer Options

> "What would you like to do?"
> 1. **Continue** — pick up where we left off at the [stage] stage
> 2. **Redo current stage** — restart the [stage] stage from scratch
> 3. **Abort** — clean up and start fresh

### 4. Handle Choice

**Continue:**
- Load the appropriate stage skill based on `current_stage`:
  - `scope` → invoke-scope picks up at clarifying questions (research may already be done)
  - `plan` → invoke-plan picks up at planner dispatch or plan selection
  - `orchestrate` → invoke-orchestrate picks up at task breakdown
  - `build` → invoke-build resumes at the next incomplete batch
  - `review` → invoke-review resumes at reviewer selection

**Redo:**
- Reset state for the current stage but keep prior stage outputs
- Re-trigger the current stage skill

**Abort:**
- Clean up worktrees via `invoke_cleanup_worktrees`
- Reset pipeline state
- Inform user: "Pipeline cleaned up. Ready to start fresh."

## Worktree Recovery

If the state shows worktrees that may be orphaned (session crashed during build):

> "Found [N] worktrees from the previous session. Some may have incomplete work."
> 1. **Keep and merge** — merge whatever was completed
> 2. **Discard** — clean up all worktrees and restart the batch
> 3. **Inspect** — let me check each worktree's status first

If "Inspect": check each worktree for uncommitted changes and committed changes, then present options per worktree.
```

- [ ] **Step 2: Commit**

```bash
git add skills/invoke-resume.md
git commit -m "feat: add invoke-resume skill"
```

---

### Task 13: Skill — invoke-manage

**Files:**
- Create: `skills/invoke-manage.md`

- [ ] **Step 1: Create the manage skill**

Create `skills/invoke-manage.md`:

```markdown
---
name: invoke-manage
description: Use when the user wants to create, edit, remove, or list invoke roles, strategies, reviewers, or pipeline configuration
---

# Invoke — Manage Configuration

You are managing invoke pipeline configuration. You help users create, edit, and remove roles, strategies, and other pipeline settings through conversation.

## Operations

### List

When the user wants to see what's configured:
1. Call `invoke_get_config`
2. Present a formatted summary:
   - Providers and their CLI commands
   - Roles grouped by type (researcher, planner, builder, reviewer) with model/effort
   - Strategies
   - Current settings

### Create Role

When the user wants to add a new role (e.g., "create a reviewer for PSR compliance"):

1. **Identify role type and name**: "This sounds like a reviewer. I'll call it `psr-compliance`. Sound good?"

2. **Ask about focus**: "What should this reviewer focus on? What specific standards or rules?" Ask one question at a time to understand:
   - What to check for
   - What severity levels to use
   - Any specific files or patterns to focus on
   - Output format requirements (must use the standard Finding format for reviewers)

3. **Choose provider/model/effort**: "Which provider and model should run this reviewer?"
   - Present available providers from config
   - Suggest a default based on the role type

4. **Generate prompt**: Create the `.md` prompt file based on the conversation. For reviewers, ensure the output format section uses the standard Finding format.

5. **Save**: 
   - Write the prompt file to `.invoke/roles/[type]/[name].md` using `invoke_save_artifact`
   - Read the current `pipeline.yaml`, add the new role entry, write it back

6. **Confirm**: "Added reviewer/psr-compliance. It'll appear in your reviewer list next review cycle."

### Edit Role

When the user wants to modify an existing role:

1. Read the current prompt file using `invoke_read_artifact`
2. Present the current content
3. Discuss changes with the user
4. Update the prompt file
5. If provider/model/effort changed, update `pipeline.yaml` too

### Delete Role

When the user wants to remove a role:

1. Confirm: "Delete reviewer/[name]? This will remove the prompt file and config entry."
2. Remove the entry from `pipeline.yaml`
3. Note: we can't delete files via MCP tools, so instruct the user to remove the `.md` file manually, or use Bash to remove it

### Create Strategy

Same flow as Create Role but for strategies:
1. Ask what the strategy should enforce
2. Generate the prompt template with standard `{{variables}}`
3. Save to `.invoke/strategies/[name].md`
4. Add to `pipeline.yaml`

### Edit Settings

When the user wants to change settings:
1. Present current settings
2. Apply the change to `pipeline.yaml`
3. Confirm

## Key Principles

- Always confirm before making changes
- Preview generated prompts before saving
- Reviewer prompts must include the standard Finding output format
- Keep the user in control — never auto-generate without review
```

- [ ] **Step 2: Commit**

```bash
git add skills/invoke-manage.md
git commit -m "feat: add invoke-manage skill"
```

---

### Task 14: Init Script

**Files:**
- Create: `src/init.ts`
- Create: `tests/init.test.ts`

The init script copies defaults to a project's `.invoke/` directory and registers the MCP server.

- [ ] **Step 1: Write failing test**

Create `tests/init.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initProject } from '../src/init.js'
import { mkdir, rm, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

const TEST_DIR = path.join(import.meta.dirname, 'fixtures', 'init-test')

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true })
})

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('initProject', () => {
  it('creates .invoke directory with pipeline.yaml', async () => {
    await initProject(TEST_DIR)

    expect(existsSync(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'))).toBe(true)

    const config = await readFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), 'utf-8')
    expect(config).toContain('providers:')
    expect(config).toContain('roles:')
    expect(config).toContain('strategies:')
    expect(config).toContain('settings:')
  })

  it('copies default role prompts', async () => {
    await initProject(TEST_DIR)

    expect(existsSync(path.join(TEST_DIR, '.invoke', 'roles', 'researcher', 'codebase.md'))).toBe(true)
    expect(existsSync(path.join(TEST_DIR, '.invoke', 'roles', 'reviewer', 'security.md'))).toBe(true)
    expect(existsSync(path.join(TEST_DIR, '.invoke', 'roles', 'builder', 'default.md'))).toBe(true)
    expect(existsSync(path.join(TEST_DIR, '.invoke', 'roles', 'planner', 'architect.md'))).toBe(true)
  })

  it('copies default strategy prompts', async () => {
    await initProject(TEST_DIR)

    expect(existsSync(path.join(TEST_DIR, '.invoke', 'strategies', 'tdd.md'))).toBe(true)
    expect(existsSync(path.join(TEST_DIR, '.invoke', 'strategies', 'implementation-first.md'))).toBe(true)
    expect(existsSync(path.join(TEST_DIR, '.invoke', 'strategies', 'prototype.md'))).toBe(true)
    expect(existsSync(path.join(TEST_DIR, '.invoke', 'strategies', 'bug-fix.md'))).toBe(true)
  })

  it('creates empty output directories', async () => {
    await initProject(TEST_DIR)

    expect(existsSync(path.join(TEST_DIR, '.invoke', 'specs'))).toBe(true)
    expect(existsSync(path.join(TEST_DIR, '.invoke', 'specs', 'research'))).toBe(true)
    expect(existsSync(path.join(TEST_DIR, '.invoke', 'plans'))).toBe(true)
    expect(existsSync(path.join(TEST_DIR, '.invoke', 'reviews'))).toBe(true)
  })

  it('does not overwrite existing config', async () => {
    await mkdir(path.join(TEST_DIR, '.invoke'), { recursive: true })
    const customConfig = 'providers:\n  custom:\n    cli: custom-ai\n    args: []'
    const { writeFile } = await import('fs/promises')
    await writeFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), customConfig)

    await initProject(TEST_DIR)

    const config = await readFile(path.join(TEST_DIR, '.invoke', 'pipeline.yaml'), 'utf-8')
    expect(config).toContain('custom-ai')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/init.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the init script**

Create `src/init.ts`:

```typescript
import { cp, mkdir, readdir, stat } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export async function initProject(projectDir: string): Promise<void> {
  const invokeDir = path.join(projectDir, '.invoke')
  const defaultsDir = path.join(__dirname, '..', 'defaults')

  // Create .invoke directory
  await mkdir(invokeDir, { recursive: true })

  // Copy pipeline.yaml if it doesn't exist
  const configDest = path.join(invokeDir, 'pipeline.yaml')
  if (!existsSync(configDest)) {
    await cp(
      path.join(defaultsDir, 'pipeline.yaml'),
      configDest
    )
  }

  // Copy default roles
  await copyDefaults(
    path.join(defaultsDir, 'roles'),
    path.join(invokeDir, 'roles')
  )

  // Copy default strategies
  await copyDefaults(
    path.join(defaultsDir, 'strategies'),
    path.join(invokeDir, 'strategies')
  )

  // Create empty output directories
  await mkdir(path.join(invokeDir, 'specs', 'research'), { recursive: true })
  await mkdir(path.join(invokeDir, 'plans'), { recursive: true })
  await mkdir(path.join(invokeDir, 'reviews'), { recursive: true })
}

async function copyDefaults(srcDir: string, destDir: string): Promise<void> {
  if (!existsSync(srcDir)) return

  await mkdir(destDir, { recursive: true })

  const entries = await readdir(srcDir, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name)
    const destPath = path.join(destDir, entry.name)

    if (entry.isDirectory()) {
      await copyDefaults(srcPath, destPath)
    } else if (!existsSync(destPath)) {
      await cp(srcPath, destPath)
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/init.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Add init command to package.json**

Update the `bin` field in `package.json`:

```json
{
  "bin": {
    "invoke-mcp": "dist/index.js",
    "invoke-init": "dist/init-cli.js"
  }
}
```

Create `src/init-cli.ts`:

```typescript
#!/usr/bin/env node

import { initProject } from './init.js'

const projectDir = process.argv[2] || process.cwd()

console.log(`Initializing invoke in ${projectDir}...`)

initProject(projectDir)
  .then(() => {
    console.log('Done! invoke is configured in .invoke/')
    console.log('')
    console.log('Next steps:')
    console.log('  1. Review .invoke/pipeline.yaml and customize providers/models')
    console.log('  2. Add the invoke MCP server to your Claude Code settings')
    console.log('  3. Start a Claude Code session and describe what you want to build')
  })
  .catch((err) => {
    console.error('Error:', err.message)
    process.exit(1)
  })
```

- [ ] **Step 6: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/init.ts src/init-cli.ts tests/init.test.ts package.json
git commit -m "feat: add invoke init script to scaffold project config"
```

---

### Task 15: Hook Scripts

**Files:**
- Create: `hooks/session-start.js`
- Create: `hooks/post-merge-validation.js`

These are plain JS files that can be referenced from Claude Code's `settings.json`.

- [ ] **Step 1: Create session-start hook**

Create `hooks/session-start.js`:

```javascript
#!/usr/bin/env node

// Session-start hook for Claude Code
// Detects an active invoke pipeline and nudges the AI to resume it.

const fs = require('fs');
const path = require('path');

const statePath = path.join(process.cwd(), '.invoke', 'state.json');

try {
  if (fs.existsSync(statePath)) {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    if (state.current_stage && state.current_stage !== 'complete') {
      console.log(
        `Active invoke pipeline detected (stage: ${state.current_stage}, ` +
        `started: ${state.started}). ` +
        `Use invoke-resume to continue.`
      );
    }
  }
} catch (e) {
  // Silently ignore — don't block session start
}
```

- [ ] **Step 2: Create post-merge validation hook**

Create `hooks/post-merge-validation.js`:

```javascript
#!/usr/bin/env node

// Post-merge validation hook for Claude Code
// Runs after invoke_merge_worktree to catch breakage early.
// Exit code 0 = pass, non-zero = fail (reported to the AI).

const { execSync } = require('child_process');
const fs = require('fs');

const checks = [];

// Detect available checks
if (fs.existsSync('package.json')) {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
  const scripts = pkg.scripts || {};

  if (scripts.typecheck || scripts['type-check']) {
    checks.push({ name: 'typecheck', cmd: scripts.typecheck ? 'npm run typecheck' : 'npm run type-check' });
  }
  if (scripts.lint) {
    checks.push({ name: 'lint', cmd: 'npm run lint' });
  }
  if (scripts.test) {
    checks.push({ name: 'test', cmd: 'npm test' });
  }
}

if (checks.length === 0) {
  process.exit(0);
}

const failures = [];

for (const check of checks) {
  try {
    execSync(check.cmd, { stdio: 'pipe', timeout: 120000 });
  } catch (e) {
    failures.push(`${check.name} failed: ${e.stderr ? e.stderr.toString().slice(0, 500) : e.message}`);
  }
}

if (failures.length > 0) {
  console.error('Post-merge validation failed:');
  failures.forEach(f => console.error(`  - ${f}`));
  process.exit(1);
} else {
  console.log('Post-merge validation passed.');
}
```

- [ ] **Step 3: Commit**

```bash
git add hooks/
git commit -m "feat: add Claude Code hooks for auto-resume and post-merge validation"
```

---

### Task 16: Final Integration Test

**Files:**
- Modify: `tests/e2e/smoke.test.ts` (add init test)

- [ ] **Step 1: Add init integration test**

Add to `tests/e2e/smoke.test.ts`:

```typescript
describe('E2E: Init + Config', () => {
  it('init creates a valid config that loads successfully', async () => {
    const { initProject } = await import('../../src/init.js')

    const initDir = path.join(import.meta.dirname, 'fixtures', 'e2e-init-test')
    await mkdir(initDir, { recursive: true })

    try {
      await initProject(initDir)

      // Config should load and validate
      const config = await loadConfig(initDir)
      expect(config.providers.claude).toBeTruthy()
      expect(config.roles.researcher).toBeTruthy()
      expect(config.roles.planner).toBeTruthy()
      expect(config.roles.builder).toBeTruthy()
      expect(config.roles.reviewer).toBeTruthy()
      expect(config.strategies.tdd).toBeTruthy()
      expect(config.settings.default_strategy).toBe('tdd')
    } finally {
      await rm(initDir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Verify full build**

Run: `npx tsc`
Expected: Clean build

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/smoke.test.ts
git commit -m "feat: add init integration test"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] 7 skill files — Tasks 7-13
- [x] Default pipeline.yaml — Task 1
- [x] 4 strategy prompts — Task 2
- [x] 3 researcher prompts — Task 3
- [x] 2 planner prompts — Task 4
- [x] 1 builder prompt — Task 5
- [x] 5 reviewer prompts — Task 6
- [x] Init script — Task 14
- [x] Session-start hook — Task 15
- [x] Post-merge validation hook — Task 15
- [x] Integration test — Task 16

**Placeholder scan:** No TBDs or incomplete sections.

**Type consistency:** Template variables (`{{task_description}}`, `{{acceptance_criteria}}`, `{{relevant_files}}`, `{{interfaces}}`, `{{diff}}`, `{{research_context}}`) are used consistently across all prompts and match what the prompt composer and dispatch tools expect.
