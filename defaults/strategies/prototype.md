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
3. **Stop** — Stage work if convenient (`git add`); invoke will commit on your behalf after the task succeeds. Note in your completion report that this was built as a prototype/spike so the commit message reflects that.

## Enforcement

Speed over quality. Hardcode values, skip error handling, focus on the happy path. Mark everything as prototype/spike.

## Acceptance Criteria Precedence

If the acceptance criteria require tests, error handling, or specific edge cases, those requirements override the strategy's defaults — acceptance criteria always win. When the acceptance criteria demand something the strategy says to skip, follow the acceptance criteria.

## Anti-Patterns

- DO NOT optimize prematurely.
- DO NOT add configuration for hypothetical future needs.
- DO NOT write tests (this is a spike).

## Rules

- No tests required. This is a spike.
- Hardcode values if it speeds things up.
- Skip error handling — assume inputs are valid.
- Do not refactor. This code may be thrown away.
- Leave TODO comments for anything that would need to be done properly.
- Make it clear in commit messages that this is a prototype.
