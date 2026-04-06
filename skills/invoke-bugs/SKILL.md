---
name: invoke-bugs
description: MUST USE when the user asks about outstanding bugs, wants to see bug list, or wants to fix tracked bugs. Triggers on: 'what bugs', 'show bugs', 'outstanding bugs', 'open bugs', 'fix a bug', 'any bugs'.
---

# Invoke — Bug Tracker

You are running the bug tracking interface for invoke.

## Messaging

**BEFORE doing anything else**, invoke the `invoke-messaging` skill using the Skill tool (`Skill({ skill: "invoke:invoke-messaging" })`). This loads the messaging format standards you MUST follow for all output. Do NOT proceed with any steps until invoke-messaging is loaded. Use `AskUserQuestion` for all user decisions.

## Flow

### 1. List Open Bugs

Call `invoke_list_bugs` with `status: 'open'`.

If no bugs are returned, inform the user: "No outstanding bugs tracked." and exit.

### 2. Present Bugs

Format bugs as a markdown table with columns: `#`, `Severity`, `ID`, `Title`, `Location`, `Reported`.

Use the severity emoji mapping from invoke-messaging: 🔴 critical/high, 🟡 medium, 🟢 low.

Example:

```
| # | Severity | ID       | Title                     | Location            | Reported   |
|---|----------|----------|---------------------------|---------------------|------------|
| 1 | 🔴 HIGH  | BUG-001  | Token not invalidated     | src/auth/session.ts | 2026-04-01 |
| 2 | 🟡 MEDIUM| BUG-002  | Duplicate validation logic| src/api/users.ts:30 | 2026-04-02 |
```

### 3. Select Bugs to Fix

Use `AskUserQuestion` with `multiSelect: true`. Each option:
- `label`: `'[severity emoji] BUG-NNN — [title]'`
- `description`: `'[description snippet] ([file:line if available])'`

Note: `AskUserQuestion` supports max 4 options per question. If there are more than 4 bugs, group into multiple questions by severity — critical/high first, then medium, then low.

### 4. Start Fix Pipeline

For each selected bug:

1. Call `invoke_update_bug` with `bug_id: <id>` and `status: 'in_progress'`.
2. Compose a single task description combining the details of all selected bugs — title, description, file/line when available, and severity for each.
3. Invoke the `invoke-scope` skill with the composed task description using `Skill({ skill: "invoke:invoke-scope" })`.
4. The scope skill will create a pipeline. Once pipeline state exists, call `invoke_set_state` with `session_id: <pipeline_id>` and `bug_ids: [<selected bug IDs>]` to associate the bugs with this pipeline.

## Quick Log Flow

If the user says "log this bug" or similar (routed from invoke-start):

1. Parse title and description from context if available. If not clear, ask via `AskUserQuestion`.
2. Ask for severity if not apparent (`critical`, `high`, `medium`, `low` — default `medium`).
3. Call `invoke_report_bug` with `title`, `description`, `severity`, and optional `file`/`line` fields.
4. Confirm to the user: "Logged [BUG-NNN]: [title]"

`invoke_report_bug` accepts: `title` (required), `description` (required), `severity` (default `medium`), `file` (optional), `line` (optional), `labels` (optional), `session_id` (optional).

## Bug Resolution

When a pipeline that has `bug_ids` in its state reaches completion:

1. Read `bug_ids` from the pipeline state via `invoke_get_state`.
2. For each `bug_id`, call `invoke_update_bug` with:
   - `bug_id: <id>`
   - `status: 'resolved'`
   - `resolution: <brief summary of what was fixed>`
   - `session_id: <pipeline_id>`
3. Confirm which bugs were resolved: "Resolved: BUG-NNN ([title]), BUG-NNN ([title])"

## Error Handling

- If `invoke_list_bugs` fails, surface the error and exit — do not proceed with a partial list.
- If `invoke_update_bug` fails for an individual bug, report which bug failed and continue with the rest.
- If `invoke_report_bug` fails, surface the error and ask the user to retry.
