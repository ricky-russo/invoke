---
name: invoke-review
description: "MUST USE when build is complete and code needs review, or when a build-review loop iteration starts. Triggers after invoke-build completes. Do not dispatch reviewers without this skill."
---

# Invoke — Review Stage

You are running the review stage. Your job is to dispatch reviewers, present findings, let the user triage, and loop back to build for fixes.

## Messaging

**BEFORE doing anything else**, invoke the `invoke-messaging` skill using the Skill tool (`Skill({ skill: "invoke:invoke-messaging" })`). This loads the messaging format standards you MUST follow for all output. Do NOT proceed with any pipeline steps until invoke-messaging is loaded. Use `AskUserQuestion` for all user decisions.

## Flow

All `invoke_get_state`, `invoke_set_state`, and `invoke_get_metrics` calls in this flow must include `session_id`, and `session_id` equals the pipeline's `pipeline_id`. The tools remain backward-compatible because `session_id` is optional, but do not omit it here.

### 1. Verify State

Call `invoke_get_state` with `session_id: <pipeline_id>` to verify we're at the review stage.

### 2. Show Current Usage And Cost Summary

Call `invoke_get_metrics` with `session_id: <pipeline_id>` and no stage filter before selecting reviewers or tiers. Display the current pipeline usage and cost summary so the user can see both dispatch headroom and token spend before review starts. Use `summary` and `limits` to show the current totals, including:
- dispatches used
- `max_dispatches` when available
- total prompt chars
- total duration
- `summary.total_estimated_cost_usd`
- current review-stage estimated cost from `summary.by_stage.review.estimated_cost_usd` when present

Repeat this cost summary before every later reviewer dispatch as well. In tiered review, that means before each tier dispatch and each same-tier re-review after fixes. In fallback review, that means before each full review cycle dispatch.

### 3. Load Review Config

Read the config with `invoke_get_config` to see available reviewers and `config.settings.review_tiers`.

If `review_tiers` is missing or empty, use the fallback path in steps 4-8:
- present available reviewers using `AskUserQuestion` with `multiSelect: true`
- each option's label is the subrole name
- each description includes provider(s), model(s), and effort
- dispatch all selected reviewers in parallel as one review cycle

If `review_tiers` is configured, do NOT ask for arbitrary reviewer selection. Use the configured tiers instead. Match tier names case-insensitively and run them in this order:
1. `critical`
2. `quality`
3. `polish`

Skip any named tier that is not configured. `polish` is optional even when configured: once `critical` and `quality` are complete, ask the user whether to run the configured polish tier or skip it.

Before dispatching reviewers, call `invoke_get_review_cycle_count` with the `session_id`. If the count meets or exceeds the configured `max_review_cycles`, inform the user: "Review cycle limit reached ([count]/[max]). Findings from this point will be advisory only — no further fix cycles will be dispatched." This is the same guard rail used in invoke-build for inter-batch review. When the limit is reached, findings are advisory only. Do NOT dispatch builder fix agents or re-review loops. Present the findings to the user but skip steps 7 (Auto-Fix) and 8 (Next Cycle fix loops). The user can still read and act on findings manually.

### 4. Dispatch Reviewers

Dispatch either the selected reviewers from the fallback flow or the reviewers from the current tier using `invoke_dispatch_batch`:
- `create_worktrees: false` (reviewers don't modify code)
- `task_context: { task_description: "<what was built — summary from plan>", diff: "<git diff of all changes>" }`

Get the diff using `git diff main...HEAD` (or `git diff $(git merge-base HEAD main)...HEAD` if the base branch is not main). This shows all changes on the work branch relative to the base.

Check the batch response before moving on. It includes `dispatch_estimate`, and may include `warning` when the projected usage is approaching or exceeding `max_dispatches`. Surface that warning to the user as an advisory notice before the dispatch summary and status polling.

Call `invoke_get_batch_status` with the batch ID — it will wait up to 60 seconds for a status change before returning. Keep calling until complete. Do NOT use `sleep` between calls.

**CRITICAL: Do NOT proceed to step 5 while any dispatched reviewers are still running.** You must wait for all reviewers to complete or fail. If reviewers have been running for more than 5 minutes, use `AskUserQuestion` to ask the user whether to keep waiting, proceed with partial results, or cancel.

### 5. Present Findings

**Print the full findings as text output first** so the user can read them. Group by reviewer:

> **Security Review** (3 findings)
> 1. [HIGH] SQL injection in src/db/query.ts:42 — Use parameterized queries
> 2. [MEDIUM] Session token in localStorage src/auth/session.ts:15 — Use HttpOnly cookies
> 3. [LOW] Verbose error messages src/api/handler.ts:88 — Sanitize error output
>
> **Code Quality Review** (1 finding)
> 1. [MEDIUM] Duplicated validation logic in src/api/users.ts:30 and src/api/posts.ts:25 — Extract shared validator

When using tiered review, prefix the reviewer heading with the tier name: `### Critical Tier — [Reviewer Name] ([provider])`. For non-tiered review, use the standard format: `### [Reviewer Name] ([provider])`.

In tiered review, include the tier name in the heading so the user can see which gate is being evaluated, for example:
> **Critical Tier — Security Review** (3 findings)

### 6. User Triage

THEN, in a separate message, ask the user how to handle the findings using `AskUserQuestion`. Always offer bulk options first:

```
AskUserQuestion({
  questions: [{
    question: "[N] findings from [M] reviewers[ in the <tier name> tier]. How would you like to proceed?",
    header: "Review triage",
    multiSelect: false,
    options: [
      { label: "Fix all", description: "Accept all findings and dispatch fix agents" },
      { label: "Dismiss all", description: "Dismiss all findings — treats them as not actually a problem, nothing logged" },
      { label: "Defer all (log as bugs)", description: "Accept all findings as real but log as bugs for later — no fix agents dispatched now" },
      { label: "Triage individually", description: "Review each finding and choose fix, defer, or dismiss" }
    ]
  }]
})
```

If the user chooses **Triage individually**, present findings grouped by reviewer using `AskUserQuestion` with `multiSelect: true` — selected findings are accepted for fixing. Note: `AskUserQuestion` supports max 4 options per question. If there are more than 4 findings, group into multiple questions by reviewer.

After the user selects which findings to fix, if any findings were not selected, ask a follow-up via `AskUserQuestion`:

```
AskUserQuestion({
  questions: [{
    question: "For the [N] findings you didn't select to fix — defer them (log as bugs for later) or dismiss them (treat as not a problem)?",
    header: "Unselected findings",
    multiSelect: false,
    options: [
      { label: "Defer (log as bugs)", description: "Agree they are real issues — log as bugs to fix later" },
      { label: "Dismiss", description: "Treat as not actually a problem — no follow-up needed" }
    ]
  }]
})
```

After triage, record the review cycle with `invoke_set_state` using `session_id: <pipeline_id>` under `review_cycles`. Save the reviewers, findings, and triage result (`accepted` / `deferred` / `dismissed`). For tiered review cycles, include `tier: "<tier name>"` on the `ReviewCycle`. In fallback mode, leave `tier` unset. For final review cycles in this stage, include `scope: 'final'`.

Each entry in `review_cycles` follows this schema:

```json
{
  "id": 1,
  "reviewers": ["<subrole>"],
  "scope": "final",
  "batch_id": "<batch-id>",
  "tier": "critical",
  "findings": [
    {
      "reviewer": "<subrole>",
      "severity": "HIGH",
      "file": "src/auth/token.ts",
      "line": 42,
      "issue": "SQL injection",
      "suggestion": "Use parameterized queries",
      "agreed_by": ["claude", "codex"]
    }
  ],
  "triaged": {
    "accepted": ["<finding-id>"],
    "deferred": ["<finding-id>"],
    "dismissed": ["<finding-id>"]
  }
}
```

`scope` is only set on final review cycles. `tier` is omitted in fallback mode. `agreed_by` is omitted when there is only one reviewer.

### Deferred Findings as Bugs

After the user completes triage, if any findings were **deferred** (the user agreed they are real issues but chose not to fix them now), automatically log each one as a bug:

1. For each deferred finding, call `invoke_report_bug` with:
   - `title` from `finding.issue`
   - `description` from `finding.suggestion`
   - `severity` from `finding.severity`
   - `file`/`line` from the finding location
   - `session_id` from the current pipeline
2. Confirm: "Logged [N] bugs for later: [BUG-NNN, BUG-NNN, ...]"

**Dismissed findings are not logged as bugs.** Dismissal means the finding is not actually a problem and requires no follow-up.

### 7. Auto-Fix Accepted Findings

**ALWAYS dispatch builder agents for fixes — NEVER fix code directly in the session.** Fixing directly bypasses the pipeline (no worktrees, no state tracking, no validation).

Bundle accepted findings as fix tasks. For each finding, create a task:
- `task_description`: the finding details + suggestion
- `acceptance_criteria`: the specific fix expected
- `relevant_files`: the file(s) mentioned in the finding

Dispatch fix tasks using `invoke_dispatch_batch` with `create_worktrees: true`.

Call `invoke_get_batch_status` to wait for completion. Merge worktrees, run post-merge commands, validate — same flow as a regular build batch.

In tiered review, when accepted findings came from a tier, re-review that same tier only after fixes are applied. Do NOT jump ahead to later tiers until the current tier clears. In fallback review, accepted findings lead to another full review cycle only if the user asks for it in step 8.

### 8. Next Cycle

If `review_tiers` is configured, run staged tiered review:

A finding is **unresolved** if it has been accepted (triaged into the accepted list) but not yet fixed by a builder. A finding is **resolved** if it has been fixed or dismissed. Do not count dismissed findings when checking whether a tier has unresolved critical/high findings.

1. `critical` tier: dispatch only the configured critical-tier reviewers first (for example, `spec-compliance` and `security` when those reviewers are configured). Present findings, let the user triage them, record the cycle with `tier: "critical"`, and fix any accepted findings by dispatching builders. After fixes merge and validate, re-review the `critical` tier only. Do NOT start the `quality` tier until the latest critical-tier cycle has no unresolved `critical` or `high` findings after triage and any accepted fixes have been re-reviewed.
2. `quality` tier: once the critical tier clears, dispatch only the configured quality-tier reviewers (for example, `code-quality` and `performance`). Use the same triage -> fix -> same-tier re-review loop. Do NOT proceed past quality until the current quality-tier cycle has no unresolved accepted findings remaining.
3. `polish` tier: if a polish tier is configured, ask the user whether to run it. If the user opts in, dispatch only the configured polish-tier reviewers and use the same triage -> fix -> same-tier re-review loop, recording `tier: "polish"` on each cycle. If the user skips it, proceed to completion.

If `review_tiers` is NOT configured, keep the current behavior:
- let the user select reviewers with `AskUserQuestion` using `multiSelect: true`
- dispatch all selected reviewers in parallel
- present findings, let the user triage them, record the cycle, and dispatch builder fixes for accepted findings
- after fixes are applied, ask the user:

> "Fixes applied. Want to run another review cycle, or are you satisfied?"

If another cycle: loop back to step 3.
If satisfied: proceed to completion.

### 9. Complete Pipeline

Use the same slug from the spec/plan filenames. Save the review history using `invoke_save_artifact`:
- `stage: "reviews"`
- `filename: "YYYY-MM-DD-<slug>-review-N.json"` (e.g., `2026-04-03-auth-middleware-review-1.json`)

#### Update Project Context

After saving the review history, update context.md to record what was built:

1. Call `invoke_get_context` to check if context.md exists. If not, skip this step.
2. Call `invoke_update_context` with:
   - `section: "Completed Work"`
   - `mode: "append"`
   - `content: "\n- [date]: [one-line summary of what was built] (spec: [spec filename])"`
3. If the build changed the project's architecture (new directories, components, or significant structural changes), call `invoke_update_context` with:
   - `section: "Architecture"`
   - `mode: "replace"`
   - `content: [updated architecture description]`
4. If there are accepted findings that were NOT fixed (deferred), call `invoke_update_context` with:
   - `section: "Known Issues"`
   - `mode: "append"`
   - `content: "\n- [finding summary] (deferred from pipeline [id])"`

At pipeline completion, call `invoke_get_metrics` with `session_id: <pipeline_id>` and print a usage summary:

```
📊 Pipeline Usage Summary
   ├─ Total dispatches: [N]
   ├─ By stage: scope ([N]), plan ([N]), build ([N]), review ([N])
   ├─ By provider: claude ([N]), codex ([N])
   ├─ Total prompt chars: [N]
   └─ Total duration: [N]s
```

Get this data from `invoke_get_metrics`: use `summary.total_dispatches`, `summary.total_prompt_chars`, `summary.total_duration_ms`, and `summary.by_stage`; convert `summary.total_duration_ms` to seconds for the final line; aggregate `entries` by `provider` for the provider line; print `0` for any missing stage before rendering the summary.

### 10. Commit Strategy

Present the commit strategy using `AskUserQuestion` as defined in the invoke-messaging standard (Commit Strategy pattern). Use `multiSelect: false` with options: Per batch (Recommended), One commit, Per task, Custom.

Execute the chosen commit strategy. Clean up the work branch after squash merge.

After all review cycles complete and the user approves the final result, update state with `current_stage: "complete"` via `invoke_set_state` with `session_id: <pipeline_id>`.

### 11. Bug Resolution

When the pipeline completes (all review cycles pass or the user approves the final result):

1. Read `state.bug_ids` via `invoke_get_state` with `session_id: <pipeline_id>`.
2. If `bug_ids` is present and non-empty, for each `bug_id` call `invoke_update_bug` with:
   - `status: "resolved"`
   - `resolution`: brief summary of what was completed in this pipeline
   - `session_id: <pipeline_id>`
3. Print: "✅ Resolved bugs: [list of BUG-NNN]"

## Error Handling

- If a reviewer fails, present the error and proceed with other reviewers' results
- If fix agents fail, present the error and let the user decide: retry, fix manually, or dismiss the finding
- If a tier or full review cycle returns no findings, say so explicitly and continue according to the configured flow

## Key Principles

- Present findings clearly — severity, location, description, suggestion
- Let the user make all triage decisions — never auto-dismiss findings
- In tiered review, `critical` gates `quality`, and `quality` completes before optional `polish`
- In fallback review, the loop continues until the user is satisfied, not until reviewers find zero issues
