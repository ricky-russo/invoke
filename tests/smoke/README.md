# Provider Smoke Tests

These tests validate that real CLI tools work as expected with invoke's provider system.

**These are NOT run as part of the default test suite.** Run them manually when:
- Adding a new provider
- After a CLI tool updates
- When debugging dispatch issues

## Prerequisites

- `claude` CLI installed and authenticated
- `codex` CLI installed and authenticated

## Running

```bash
# Run individual provider tests
npx vitest run tests/smoke/claude.smoke.ts
npx vitest run tests/smoke/codex.smoke.ts

# Run all smoke tests
npx vitest run tests/smoke/
```

## What They Test

- CLI accepts the args we build
- Output comes back on stdout
- Output is parseable by our parsers
- Worktree-based dispatch works (agent can read/write in a worktree directory)
