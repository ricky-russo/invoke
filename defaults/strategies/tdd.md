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

## Enforcement

If you write implementation code before a failing test exists, you are violating this strategy. STOP and write the test first. The cycle is RED (failing test) → GREEN (minimum code to pass) → REFACTOR → REPEAT.

## Anti-Patterns

- DO NOT write tests after implementation and claim TDD.
- DO NOT write tests that verify implementation details instead of behavior.
- DO NOT skip the refactor step.

## Rules

- Never write implementation code without a failing test first.
- Each test should verify one specific behavior.
- Run the full test suite after each green-refactor cycle to catch regressions.
- Commit after each passing cycle.
- If you're unsure how to test something, write the test for the interface you wish existed, then implement to match.
- Do not mock dependencies unless they are external services or slow I/O. Prefer real implementations.
