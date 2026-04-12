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
2. **Verify RED** — Run the new test and confirm it fails. The test must fail — not error. The failure message must match what you expected (e.g., function not defined, assertion mismatch). If the test passes on first run, you are testing existing behavior — fix the test. If the test errors instead of failing (import error, syntax error), fix the error and re-run until it fails for the right reason. Do not proceed to Green until you have observed the expected RED.
3. **Green** — Write the minimum code to make the test pass. Do not add functionality beyond what the test requires.
4. **Refactor** — Clean up the implementation while keeping tests green. Remove duplication, improve naming, simplify logic.
5. **Repeat** — Move to the next acceptance criterion.

## Enforcement

If you write implementation code before a failing test exists, you are violating this strategy. STOP and write the test first. The cycle is RED (failing test) → GREEN (minimum code to pass) → REFACTOR → REPEAT.

## Iron Law

NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST. If you catch yourself having written production code before a failing test exists, delete that code entirely and restart the TDD cycle from scratch. Do not keep the written code as reference. Do not open the file to adapt it while writing tests. Do not copy snippets out before deleting. Delete means delete. Implement fresh from tests. This applies even if you wrote the production code just to explore — the exploration code must still be deleted before TDD can begin.

## Rationalizations

If you catch yourself thinking any of the following, STOP:

- **"Too simple to test"** — No behavior is too simple to break. Write the test. If the implementation is trivial, the test will be trivial too. You lose nothing and gain a regression guard.
- **"I will write the test after, it is faster"** — It is not faster. Writing tests after implementation means you are writing tests to match code, not to drive design. You will rationalize away edge cases. Write the test first.
- **"I already manually verified it works"** — Manual verification is not a test. It does not run on the next commit. It does not run in CI. It will not catch regressions. Write the test.
- **"The failing test has too much boilerplate — let me write the code first to see the shape"** — The boilerplate is the design work. Working through the setup tells you whether your interface is too coupled. Write the test, even if it is verbose.
- **"I need to explore the problem first"** — Exploration is valid. Write a spike. Then delete the spike code entirely and write the test before reimplementing. Exploration does not count as TDD groundwork.
- **"Deleting X minutes of work is wasteful"** — Keeping it is more wasteful. Code written before a failing test is code that bypassed the discipline. The Iron Law exists precisely because the code feels too good to delete. Delete it.
- **"TDD will slow me down on this task"** — It will slow you down on the first pass and prevent you from spending three times as long debugging. Follow the cycle.

## Anti-Patterns

- DO NOT write tests after implementation and claim TDD.
- DO NOT write tests that verify implementation details instead of behavior.
- DO NOT skip the refactor step.

## Rules

- Never write implementation code without a failing test first.
- Each test should verify one specific behavior.
- Run the full test suite after each green-refactor cycle to catch regressions.
- Do not run `git commit`. Stage work if convenient (`git add`); invoke will commit on your behalf after each cycle completes.
- If you're unsure how to test something, write the test for the interface you wish existed, then implement to match.
- Do not mock dependencies unless they are external services or slow I/O. Prefer real implementations.
