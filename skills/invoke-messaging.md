---
name: invoke-messaging
description: Internal reference — do not trigger directly. Defines consistent messaging formats for all invoke pipeline stages.
---

# Invoke — Messaging Standards

All invoke skills must follow these formatting standards when presenting information to the user. Consistency builds trust and makes the pipeline predictable.

## Interactive Selection — ALWAYS use AskUserQuestion

**When asking the user to choose from options, ALWAYS use the `AskUserQuestion` tool.** Do not print formatted text and wait for free-form input. Use the tool's native UI.

### Selecting Roles/Agents (researchers, planners, builders, reviewers)

Use `AskUserQuestion` with `multiSelect: true`:

```
AskUserQuestion({
  questions: [{
    question: "Which [role type] should I dispatch?",
    header: "[Role type]",
    multiSelect: true,
    options: [
      {
        label: "[subrole] (Recommended)",
        description: "[provider1] ([model1]) + [provider2] ([model2]) | Effort: [effort]"
      },
      {
        label: "[subrole]",
        description: "[provider] ([model]) | Effort: [effort]"
      }
    ]
  }]
})
```

Put "(Recommended)" on the first option if you have a recommendation.

### Selecting Build Strategy

Use `AskUserQuestion` with `multiSelect: false`:

```
AskUserQuestion({
  questions: [{
    question: "Which build strategy should agents use?",
    header: "Strategy",
    multiSelect: false,
    options: [
      { label: "TDD (Recommended)", description: "Write failing tests first, then implement. Default strategy." },
      { label: "Implementation-first", description: "Build the feature, then add tests after." },
      { label: "Prototype", description: "Quick spike, no tests. For exploration only." },
      { label: "Bug-fix", description: "Reproduce with failing test, then fix." }
    ]
  }]
})
```

### Commit Strategy

Use `AskUserQuestion` with `multiSelect: false`:

```
AskUserQuestion({
  questions: [{
    question: "How should I commit the final result?",
    header: "Commits",
    multiSelect: false,
    options: [
      { label: "Per batch (Recommended)", description: "[N] commits — one per orchestration batch" },
      { label: "One commit", description: "Squash everything into a single commit" },
      { label: "Per task", description: "[N] commits — one per build task" },
      { label: "Custom", description: "Define your own grouping" }
    ]
  }]
})
```

### Error Recovery

Use `AskUserQuestion` with `multiSelect: false`:

```
AskUserQuestion({
  questions: [{
    question: "[task_id] failed: [brief error]. What should I do?",
    header: "Recovery",
    multiSelect: false,
    options: [
      { label: "Retry", description: "Dispatch the agent again for this task" },
      { label: "Skip", description: "Skip this task and continue with the batch" },
      { label: "Abort", description: "Stop the entire batch" }
    ]
  }]
})
```

### Triage Findings

Use `AskUserQuestion` with `multiSelect: true` to let the user select which findings to accept:

```
AskUserQuestion({
  questions: [{
    question: "Which findings should be fixed? (unselected will be dismissed)",
    header: "Triage",
    multiSelect: true,
    options: [
      {
        label: "🔴 HIGH — SQL injection",
        description: "src/auth/token.ts:42 — Use parameterized queries (agreed: claude, codex)"
      },
      {
        label: "🟡 MEDIUM — Token in localStorage",
        description: "src/auth/session.ts:15 — Use HttpOnly cookies"
      },
      {
        label: "🟢 LOW — Verbose errors",
        description: "src/api/handler.ts:88 — Sanitize error output"
      }
    ]
  }]
})
```

Note: AskUserQuestion supports max 4 options per question. If there are more than 4 findings, group them into multiple questions by reviewer or severity, or use a question per reviewer.

### Resume Options

Use `AskUserQuestion` with `multiSelect: false`:

```
AskUserQuestion({
  questions: [{
    question: "Found an active pipeline at [stage] stage. What would you like to do?",
    header: "Resume",
    multiSelect: false,
    options: [
      { label: "Continue (Recommended)", description: "Pick up where you left off at the [stage] stage" },
      { label: "Redo stage", description: "Restart the [stage] stage from scratch" },
      { label: "Abort", description: "Clean up and start fresh" }
    ]
  }]
})
```

## Text Output Formats

These formats are for informational output (not user decisions). Print them as formatted text.

### Agent Dispatch

When dispatching agents, always show:

```
🔄 Dispatching [role]/[subrole]
   Provider: [provider] ([model]) | Effort: [effort]
   Prompt: [prompt file path]
```

For multi-provider sub-roles:

```
🔄 Dispatching [role]/[subrole] to [N] providers
   ├─ [provider1] ([model1]) | Effort: [effort1]
   └─ [provider2] ([model2]) | Effort: [effort2]
   Prompt: [prompt file path]
```

For batch dispatches:

```
📦 Dispatching Batch [N] — [X] tasks
   ├─ [task_id] → [role]/[subrole] via [provider] ([model])
   ├─ [task_id] → [role]/[subrole] via [provider] ([model])
   └─ [task_id] → [role]/[subrole] via [provider] ([model])
   Worktrees: [yes/no]
```

### Progress Updates

While agents are working:

```
⏳ Batch [N] progress
   ├─ [task_id]: ✅ completed ([duration]s)
   ├─ [task_id]: 🔄 running ([elapsed]s)
   └─ [task_id]: ⏳ pending
```

### Agent Results — Success

```
✅ [role]/[subrole] completed ([duration]s)
   Provider: [provider] ([model])
   Summary: [first 1-2 sentences of output]
```

### Agent Results — Error

```
❌ [role]/[subrole] failed ([duration]s)
   Provider: [provider] ([model])
   Error: [error message or exit code]
   Raw output (truncated):
   > [first 5 lines of output]
```

### Agent Results — Timeout

```
⏰ [role]/[subrole] timed out after [timeout]ms
   Provider: [provider] ([model])
```

### Review Findings

Present findings grouped by reviewer, sorted by severity:

```
📋 Review Results — [N] findings from [M] reviewers

### [Reviewer Name] ([provider])

| # | Severity | File | Line | Issue |
|---|----------|------|------|-------|
| 1 | 🔴 HIGH | src/auth/token.ts | 42 | SQL injection (**agreed: claude, codex**) |
| 2 | 🟡 MEDIUM | src/auth/session.ts | 15 | Session token in localStorage |
| 3 | 🟢 LOW | src/api/handler.ts | 88 | Verbose error messages |
```

### Pipeline Stage Transitions

```
──────────────────────────────────────
✅ [Stage] complete
➡️  Moving to [Next Stage]
──────────────────────────────────────
```

### Pipeline Status (Resume)

```
📊 Invoke Pipeline Status
   ├─ Pipeline: [id]
   ├─ Started: [date]
   ├─ Stage: [current_stage]
   ├─ Spec: [spec path or "not yet"]
   ├─ Plan: [plan path or "not yet"]
   ├─ Strategy: [strategy or "not set"]
   ├─ Batches: [N completed] / [M total]
   └─ Work Branch: [branch or "not created"]
```

## Rules

1. **ALWAYS use `AskUserQuestion` for user decisions.** Never print options as text and wait for free-form input.
2. Always show provider and model when dispatching or reporting results
3. Always show duration for completed agents
4. Use the severity emoji mapping: 🔴 critical/high, 🟡 medium, 🟢 low
5. Truncate raw output to 5 lines in error reports — offer full output on request
6. Use tree-style (├─ └─) for hierarchical information in text output
7. Keep progress updates on one screen — don't flood with per-second updates
8. Bold the provider agreement indicator (**agreed: claude, codex**) in findings
