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

All selected bugs are fixed in **ONE pipeline**, regardless of how many bugs were selected. Do not start a separate pipeline per bug.

1. Compose a single task description that lists all selected bugs, e.g.:
   ```
   Fix the following bugs:
   - BUG-001: Token not invalidated (src/auth/session.ts:42) [HIGH]
   - BUG-002: Duplicate validation logic (src/api/users.ts:30) [MEDIUM]
   ```
   Include title, description, file/line when available, and severity for each bug.
2. Invoke the `invoke-scope` skill **once** with the composed description using `Skill({ skill: "invoke:invoke-scope" })`. This starts the single pipeline.
3. Once `invoke-scope` returns successfully and a `session_id` is established, call `invoke_set_state` with `session_id: <pipeline_id>` and `bug_ids: [<list of all selected bug IDs>]` to associate the bugs with this pipeline.
4. Only after `invoke_set_state` succeeds, call `invoke_update_bug` for **each** selected bug with `status: 'in_progress'`. This is the commitment point — marking bugs in progress signals they are actively being worked in this pipeline.

> **On failure:** If `invoke-scope` is cancelled, returns an error, or the pipeline aborts before step 4 completes, skip the `invoke_update_bug` calls. The bugs remain `open` and can be selected again in a future run.

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
