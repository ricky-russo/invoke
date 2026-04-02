---
name: invoke-messaging
description: Internal reference — do not trigger directly. Defines consistent messaging formats for all invoke pipeline stages.
---

# Invoke — Messaging Standards

All invoke skills must follow these formatting standards when presenting information to the user. Consistency builds trust and makes the pipeline predictable.

## Agent Dispatch

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

## Progress Updates

While agents are working:

```
⏳ Batch [N] progress
   ├─ [task_id]: ✅ completed ([duration]s)
   ├─ [task_id]: 🔄 running ([elapsed]s)
   └─ [task_id]: ⏳ pending
```

## Agent Results — Success

When an agent completes successfully:

```
✅ [role]/[subrole] completed ([duration]s)
   Provider: [provider] ([model])
   Summary: [first 1-2 sentences of output]
```

## Agent Results — Error

When an agent fails:

```
❌ [role]/[subrole] failed ([duration]s)
   Provider: [provider] ([model])
   Error: [error message or exit code]
   Raw output (truncated):
   > [first 5 lines of output]
```

## Agent Results — Timeout

```
⏰ [role]/[subrole] timed out after [timeout]ms
   Provider: [provider] ([model])
```

## Review Findings

Present findings grouped by reviewer, sorted by severity:

```
📋 Review Results — [N] findings from [M] reviewers

### [Reviewer Name] ([provider])

| # | Severity | File | Line | Issue |
|---|----------|------|------|-------|
| 1 | 🔴 HIGH | src/auth/token.ts | 42 | SQL injection in query param |
| 2 | 🟡 MEDIUM | src/auth/session.ts | 15 | Session token in localStorage |
| 3 | 🟢 LOW | src/api/handler.ts | 88 | Verbose error messages |
```

When multiple providers agree on a finding:

```
| 1 | 🔴 HIGH | src/auth/token.ts | 42 | SQL injection (**agreed: claude, codex**) |
```

## Triage Prompt

```
📝 Triage findings — accept (a) or dismiss (d) each:

  1. [HIGH] SQL injection in src/auth/token.ts:42
     → Suggestion: Use parameterized queries
     [a/d]:

  2. [MEDIUM] Session token in localStorage src/auth/session.ts:15
     → Suggestion: Use HttpOnly cookies
     [a/d]:

  Or: accept all (aa), dismiss all (dd), accept all from [reviewer] (a:security)
```

## Pipeline Stage Transitions

When moving between stages:

```
──────────────────────────────────────
✅ [Stage] complete
➡️  Moving to [Next Stage]
──────────────────────────────────────
```

## Pipeline Status (Resume)

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

## Commit Strategy Selection

```
📦 Pipeline complete — choose commit style:

  1. One commit (squash all changes)
  2. Per batch ([N] commits):
     ├─ "feat: [batch 1 description]"
     ├─ "feat: [batch 2 description]"
     └─ "feat: [batch 3 description]"
  3. Per task ([N] commits)
  4. Custom grouping
```

## Selection Prompts

When asking the user to select from configured items:

```
🔧 Available [role type]:
   ├─ [1] [subrole] — [provider] ([model]) | Effort: [effort]
   ├─ [2] [subrole] — [provider1]+[provider2] | Effort: [effort]
   └─ [3] [subrole] — [provider] ([model]) | Effort: [effort]

   Select (comma-separated, or 'all'): 
```

## Error Recovery

```
⚠️  [task_id] failed — [brief error]
   Options:
   ├─ [r] Retry
   ├─ [s] Skip this task
   └─ [a] Abort batch
```

## Rules

1. Always show provider and model when dispatching or reporting results
2. Always show duration for completed agents
3. Use the severity emoji mapping: 🔴 critical/high, 🟡 medium, 🟢 low
4. Truncate raw output to 5 lines in error reports — offer full output on request
5. Use tree-style (├─ └─) for hierarchical information
6. Keep progress updates on one screen — don't flood with per-second updates
7. Bold the provider agreement indicator (**agreed: claude, codex**) in findings
