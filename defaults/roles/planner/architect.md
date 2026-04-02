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
