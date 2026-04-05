---
name: invoke-messaging
description: Internal reference — do not trigger directly. Defines consistent messaging formats for all invoke pipeline stages.
---

# Invoke — Messaging Standards

All invoke skills must follow these formatting standards when presenting information to the user. Consistency builds trust and makes the pipeline predictable.

## Interactive Selection — ALWAYS use AskUserQuestion

**When asking the user to choose from options, ALWAYS use the `AskUserQuestion` tool.** Do not print formatted text and wait for free-form input. Use the tool's native UI.

**IMPORTANT: AskUserQuestion requires a minimum of 2 options.** If there is only one option available (e.g., only one builder configured), **skip the selection UI entirely** — auto-select it and inform the user: "Auto-selecting [name] (only option configured)."

### Selecting Roles/Agents (researchers, planners, builders, reviewers)

Use `AskUserQuestion` with `multiSelect: true` (only when 2+ options exist):

```
AskUserQuestion({
  questions: [{
    question: "Which [role type] should I dispatch?",
    header: "[Role type]",
    multiSelect: true,
    options: [
      {
        label: "[subrole] (Recommended)",
        description: "[provider1] ([model1], [effort1]) + [provider2] ([model2], [effort2])"
      },
      {
        label: "[subrole]",
        description: "[provider] ([model], [effort])"
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

When dispatching a single agent with one provider:

```
🔄 Dispatching [role]/[subrole] → [provider] ([model], [effort])
```

When dispatching multiple agents of the same role (e.g., researchers, reviewers), use a compact list. Effort is per-provider, shown in parentheses next to the model:

```
🔄 Dispatching [role type]:
  • [subrole] → [provider1] ([model1], [effort1]) + [provider2] ([model2], [effort2])
  • [subrole] → [provider] ([model], [effort])
```

For batch dispatches (build stage), include task IDs and worktree info:

```
📦 Dispatching Batch [N] — [X] tasks (worktrees: [yes/no])
  • [task_id] → [provider] ([model], [effort])
  • [task_id] → [provider] ([model], [effort])
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

For single provider:
```
✅ [role]/[subrole] completed ([duration]s) via [provider] ([model])
   Summary: [first 1-2 sentences of output]
```

For multi-provider (combined result):
```
✅ [role]/[subrole] completed ([duration]s)
   • claude ([model]): [1-sentence summary]
   • codex ([model]): [1-sentence summary]
```

### Agent Results — Error

```
❌ [role]/[subrole] failed ([duration]s) via [provider] ([model])
   Error: [error message or exit code]
   Raw output (truncated):
   > [first 5 lines of output]
```

### Agent Results — Timeout

```
⏰ [role]/[subrole] timed out after [timeout]ms via [provider] ([model])
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

### Plan Comparison

Present competing plans side-by-side after parallel planning:

```
📐 Plan Comparison — [N] plans from [M] planners

### Plan A — [Planner Name] ([provider])
[2-3 sentence summary of the overall approach and how it solves the problem.]

**Key technical decisions:**
- [Decision 1]
- [Decision 2]

**Optimization focus:** [e.g., correctness, speed, minimal surface area]

---

### Plan B — [Planner Name] ([provider])
[2-3 sentence summary of the overall approach and how it solves the problem.]

**Key technical decisions:**
- [Decision 1]
- [Decision 2]

**Optimization focus:** [e.g., correctness, speed, minimal surface area]

---

### Comparison

| | Plan A | Plan B |
|---|--------|--------|
| **Agree on** | [shared approach or decision] | ← same |
| **Differ on** | [Plan A approach] | [Plan B approach] |
| **Trade-off** | [Plan A trade-off] | [Plan B trade-off] |

**Recommendation:** [Which plan (or hybrid) is recommended and why — 1-2 sentences.]
```

### Plan Selection

Use `AskUserQuestion` with `multiSelect: false` after presenting the Plan Comparison:

```
AskUserQuestion({
  questions: [{
    question: "Which plan should the builders implement?",
    header: "Plan Selection",
    multiSelect: false,
    options: [
      { label: "Plan A ([planner name])", description: "[one-line summary of Plan A approach]" },
      { label: "Plan B ([planner name])", description: "[one-line summary of Plan B approach]" },
      { label: "Hybrid (combine elements)", description: "Merge the strongest elements of both plans" },
      { label: "Re-plan with constraints", description: "Add constraints and dispatch planners again" }
    ]
  }]
})
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
   ├─ Work Branch: [branch or "not created"]
   └─ Tasks:
        ├─ [task_id]: ✅ completed ([duration]s)
        ├─ [task_id]: 🔄 running ([elapsed]s)
        ├─ [task_id]: ❌ failed — [brief error]
        └─ [task_id]: ⏳ pending
```

Omit the Tasks block if no tasks have been dispatched yet. Show only the current batch's tasks when in the build stage.

## Rules

1. **ALWAYS use `AskUserQuestion` for user decisions.** Never print options as text and wait for free-form input.
2. Always show provider, model, and effort together as `provider (model, effort)` when dispatching
3. Always show provider and model with duration for completed agents
4. Use the severity emoji mapping: 🔴 critical/high, 🟡 medium, 🟢 low
5. Truncate raw output to 5 lines in error reports — offer full output on request
6. Use bullet lists (•) for dispatch and result lists, tree-style (├─ └─) for hierarchical status info
7. Keep progress updates on one screen — don't flood with per-second updates
8. Bold the provider agreement indicator (**agreed: claude, codex**) in findings
9. **AskUserQuestion fallback:** If `AskUserQuestion` fails or is dismissed without a selection, fall back to presenting the options as a numbered text list and accept a text response. Do not block execution on a failed UI interaction.
10. **AskUserQuestion `preview` field:** `AskUserQuestion` supports an optional `preview` field for comparing code snippets, ASCII mockups, or plan summaries side-by-side. Use it when presenting a Plan Comparison or strategy comparison so the user can evaluate options without switching contexts.
