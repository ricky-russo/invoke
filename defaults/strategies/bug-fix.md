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

### Phase 1: Root Cause Investigation

- Read error messages carefully, including full stack traces and line numbers.
- Reproduce the bug consistently with exact steps before touching any code.
- Check recent changes via `git log` and `git diff`, and review dependencies, config, and environment.
- Trace data flow backward to find where the bad value originated; fix at the source, not where it surfaces.

### Phase 2: Pattern Analysis

- Find working examples in the same codebase that do similar things.
- Compare the broken code against those references line by line.
- List every difference, however small; small differences are often the root cause.
- Understand what each dependency does before assuming it works correctly.

### Phase 3: Hypothesis and Testing

- State a single hypothesis clearly: "I think X is the root cause because Y."
- Test minimally — make the SMALLEST possible change, one variable at a time.
- Verify before continuing: if it worked, move to Phase 4; if not, form a NEW hypothesis — do not pile more fixes.
- If you cannot form a clear hypothesis, say "I don't understand X" — do not guess.

### Phase 4: Implementation

- Create a failing test case that reproduces the bug.
- Implement a single fix addressing the root cause; no while-I-am-here improvements or bundled refactoring.
- Verify the fix: the new test passes, no other tests are broken, and the issue is actually resolved.

## Enforcement

Write a failing test that reproduces the bug FIRST. Then fix the root cause, not the symptom.

## Architectural Escalation

If 3 fixes have failed on the same bug, STOP. Do not attempt a 4th fix.

Pattern indicating architectural problem:
- Each fix reveals new shared state or coupling in a different place.
- Fixes require massive refactoring to implement.
- Each fix creates new symptoms elsewhere.

When this happens, this is NOT a failed hypothesis — this is a wrong architecture. Report to the dispatching skill / pipeline:

> I have attempted 3 fixes. Each fix reveals a new problem in a different location. The architecture may be wrong. I am stopping before attempting a 4th fix. Recommend re-scoping or architectural discussion.

## Red Flags — Stop and Return to Phase 1

- "Quick fix for now, investigate later" → Stop. Do Phase 1 now.
- "Just try changing X and see if it works" → Stop. Form a hypothesis first.
- "Multiple fixes at once saves time" → Stop. One change at a time; you cannot isolate what worked.
- "Skip the test, I will manually verify" → Stop. Manual verification does not stick.
- "I do not fully understand but this might work" → Stop. Do Phase 1 until you understand.
- "Pattern says X but I will adapt it differently" → Stop. Read the pattern completely first.
- "One more fix attempt" (when already at 2 failed fixes) → Stop. Count how many fixes you have tried. If ≥ 3, escalate architecture.

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
