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
5. **Stop** — Stage work if convenient (`git add`); invoke will commit on your behalf after the task succeeds.

## Enforcement

Write a failing test that reproduces the bug FIRST. Then fix the root cause, not the symptom.

## Anti-Patterns

- DO NOT fix symptoms without understanding root cause.
- DO NOT expand scope to related improvements.
- DO NOT modify tests to make them pass instead of fixing the code.

## Rules

- Always write the failing test before attempting a fix.
- Fix the root cause, not the symptom.
- Make the smallest possible change. Do not "improve" nearby code.
- If the fix requires a larger change, stop and report — the task may need to be re-scoped.
- Include the bug description in the commit message.
