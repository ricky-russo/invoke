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

> **Session ownership:** Always pass `session_id: <pipeline_id>` on `invoke_get_batch_status` and `invoke_get_task_result` calls. The MCP server enforces session ownership on these tools to prevent cross-session data leakage.

Call `invoke_get_batch_status` with `{ batch_id, session_id: <pipeline_id> }` — it will wait up to 60 seconds for a status change before returning. The response contains `{ batchId, status, agents: [{ taskId, status }] }` — status information only, no result data. Keep calling until all reviewer tasks are terminal. Do NOT use `sleep` between calls.

When any reviewer task transitions to a terminal state (`completed`, `error`, or `timeout`), call `invoke_get_task_result({ batch_id, task_id, session_id: <pipeline_id> })` for that task to fetch its full result — reviewer findings are in `result.output.findings`. **Never call `invoke_get_task_result` for tasks still `pending`, `dispatched`, or `running` — the tool errors for non-terminal tasks.**

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
      { label: "Defer all (offer to log)", description: "Accept all findings as real but defer them — you'll be asked whether to log them as bugs for later" },
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
    question: "For the [N] findings you didn't select to fix — defer them (you'll be offered to log them as bugs) or dismiss them (treat as not a problem)?",
    header: "Unselected findings",
    multiSelect: false,
    options: [
      { label: "Defer (offer to log)", description: "Agree they are real issues — you'll be asked whether to log them as bugs for later" },
      { label: "Dismiss", description: "Treat as not actually a problem — no follow-up needed" }
    ]
  }]
})
```

After triage, record the review cycle using `invoke_set_state` with `session_id: <pipeline_id>` and `review_cycle_update`. First call `invoke_get_review_cycle_count` with `session_id: <pipeline_id>` to read the current count; use `count + 1` as the new monotonic `id`. Save the reviewers, findings, and triage result (`accepted` / `deferred` / `dismissed`). For tiered review cycles, include `tier: "<tier name>"`. In fallback mode, leave `tier` unset. For final review cycles in this stage, include `scope: 'final'`.

Each `review_cycle_update` follows this schema:

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

After the user completes triage, if any findings were **deferred** (the user agreed they are real issues but chose not to fix them now), ask whether to log them as bugs:

1. Call `AskUserQuestion` with:
   ```
   AskUserQuestion({
     questions: [{
       question: '[N] findings were deferred. Log them as bugs to track later?',
       header: 'Log bugs',
       multiSelect: false,
       options: [
         { label: 'Log all', description: 'Create bug entries for all [N] deferred findings' },
         { label: 'Skip', description: 'Do not log them as bugs' }
       ]
     }]
   })
   ```
2. If the user chose **Log all**, for each deferred finding call `invoke_report_bug` with:
   - `title` from `finding.issue`
   - `description` from `finding.suggestion`
   - `severity` from `finding.severity`
   - `file`/`line` from the finding location
   - `session_id` from the current pipeline
3. If bugs were logged, confirm: "Logged [N] bugs for later: [BUG-NNN, BUG-NNN, ...]"

**Dismissed findings are not logged as bugs.** Dismissal means the finding is not actually a problem and requires no follow-up.

### 6.5 Fixup Target Resolution

Before dispatching fix tasks, resolve the commit each fix should fold into. This lets step 7 pass `commit_message: 'fixup! <original-title>'` to `invoke_merge_worktree` so the end-of-review autosquash (step 8.5) can collapse the fix into its originating task commit.

1. Read `config.settings.commit_style` via `invoke_get_config`. Default to `'per-task'` if unset.
2. Read pipeline state via `invoke_get_state({ session_id: <pipeline_id> })`.
3. Build a flat lookup table `taskCommitSha` — for each batch in `state.batches`, for each task in `batch.tasks`, if `task.commit_sha` exists, record `taskCommitSha[task.id] = task.commit_sha`. For `per-batch` mode where task commit_shas were replaced with the batch SHA during build, this lookup still works because each task in the batch carries the batch SHA.
4. For each accepted finding, determine its originating task — the skill already tracks which task each finding came from during triage. Then:
   - If `originalTaskId` is set and appears in `taskCommitSha`, call `invoke_get_commit_title({ session_id: <pipeline_id>, commit_sha: taskCommitSha[originalTaskId] })` to look up the commit's title on the session work branch. Store `finding.fixup_target_sha` and `finding.fixup_target_title` on the finding for step 7.
   - If not (missing `commit_sha`, legacy pipeline with no work branch, or the finding spans multiple original tasks), store `None` for both. Cross-task findings MUST be split into per-task fix tasks before dispatch — one fix task per originating task — so each resulting fix has a single fixup target. If a finding is genuinely cross-cutting and unsplittable, leave the target unresolved; step 7 will dispatch it as a normal (non-fixup) commit and it will remain visible after autosquash.

### 7. Auto-Fix Accepted Findings

**ALWAYS dispatch builder agents for fixes — NEVER fix code directly in the session.** Fixing directly bypasses the pipeline (no worktrees, no state tracking, no validation).

Bundle accepted findings as fix tasks. For each finding, create a task:
- `task_description`: the finding details + suggestion
- `acceptance_criteria`: the specific fix expected
- `relevant_files`: the file(s) mentioned in the finding

Dispatch fix tasks using `invoke_dispatch_batch` with `create_worktrees: true`.

> **Session ownership:** Always pass `session_id: <pipeline_id>` on `invoke_get_batch_status` and `invoke_get_task_result` calls. The MCP server enforces session ownership on these tools to prevent cross-session data leakage.

Call `invoke_get_batch_status` with `{ batch_id, session_id: <pipeline_id> }` — it will wait up to 60 seconds for a status change before returning. The response contains `{ batchId, status, agents: [{ taskId, status }] }` — status information only, no result data. Keep calling until every fix task is terminal. Do NOT use `sleep` between calls.

When any fix task transitions to a terminal state (`completed`, `error`, or `timeout`), call `invoke_get_task_result({ batch_id, task_id, session_id: <pipeline_id> })` for that task to fetch its full result. Use `result.output` to decide whether to merge, retry, or skip that task — do not make merge or retry decisions before the result is fetched. **Never call `invoke_get_task_result` for tasks still `pending`, `dispatched`, or `running` — the tool errors for non-terminal tasks.**

Once a fix task's result indicates success, call `invoke_merge_worktree` for that task, then call `invoke_run_post_merge` before merging the next task. Never merge two fix tasks back-to-back without running `invoke_run_post_merge` between them.

When calling `invoke_merge_worktree`, pick the `commit_message` based on `commit_style` and whether step 6.5 resolved a fixup target for this finding:

```
finding = finding_for(fix_task.id)

if commit_style == 'per-task' and finding.fixup_target_title:
  commit_message = 'fixup! ' + finding.fixup_target_title
elif commit_style == 'per-task':
  commit_message = 'feat: ' + fix_task.id        # no target resolved — land as own commit
elif commit_style in ('one-commit', 'per-batch') and finding.fixup_target_title:
  commit_message = 'fixup! ' + finding.fixup_target_title
elif commit_style in ('one-commit', 'per-batch'):
  commit_message = 'feat: ' + fix_task.id
elif commit_style == 'custom':
  commit_message = None                           # pass-through; invoke_merge_worktree uses its default

invoke_merge_worktree({ task_id: fix_task.id, session_id: <pipeline_id>, commit_message })
invoke_run_post_merge({ session_id: <pipeline_id> })
```

Record the fix task's returned `commit_sha` via `batch_update.tasks` the same way build merges do — this is only needed for tracking/debugging since fix commits are typically folded by step 8.5.

The same polling pattern — `invoke_get_batch_status` to track status, `invoke_get_task_result` for terminal tasks, `invoke_merge_worktree` + `invoke_run_post_merge` between merges — applies to any subsequent fix dispatches triggered during nested same-tier re-review cycles.

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

### 8.5 Autosquash Session / Commit-Style Collapse

After ALL review cycles are finished and EVERY accepted finding has been merged, fold `fixup!` fix commits into their originating task commits (or collapse everything per the commit_style setting). Run this step exactly once, before transitioning state to `complete`.

Read `commit_style` from config (same value as step 6.5 used):

```
fold_result = None  # for step 9 summary

if commit_style == 'one-commit':
  # Collapse the entire session branch (all tasks + all review fixes) into a single commit.
  # Determine the base SHA the session branched from:
  base_sha = git merge-base <state.base_branch> HEAD   # on state.work_branch_path
  result = invoke_collapse_commits({
    session_id: <pipeline_id>,
    base_sha: base_sha,
    message: 'feat: ' + (spec_title_or_pipeline_id),
  })
  fold_result = 'Collapsed pipeline into single commit ' + result.commit_sha

elif commit_style == 'custom':
  fold_result = 'commit_style=custom; leaving commits untouched.'

else:
  # per-task and per-batch: absorb fixup! commits into their target commits
  result = invoke_autosquash_session({ session_id: <pipeline_id> })
  if result.status == 'ok':
    fold_result = 'Folded ' + result.fixups_absorbed + ' review fixes into ' + result.commits_after + ' task commits'
  elif result.status == 'not_supported':
    fold_result = 'Legacy session — autosquash skipped; review fix commits remain on work branch.'
  elif result.status == 'conflict_aborted':
    fold_result = 'Autosquash aborted: ' + result.message + '. Review fix commits remain on work branch. Conflicting files: ' + result.conflicting_files.join(', ')
```

Print `fold_result` immediately so the user sees it during the run. Step 9's final summary also includes it so the user can reference it after the fact. `conflict_aborted` is a non-blocking warning — the pipeline continues to `complete` normally, and the user can inspect the work branch manually to resolve any residual fix commits.

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

At pipeline completion, call `invoke_get_metrics` with `session_id: <pipeline_id>` and print a usage summary, then print the fold result from step 8.5:

```
📊 Pipeline Usage Summary
   ├─ Total dispatches: [N]
   ├─ By stage: scope ([N]), plan ([N]), build ([N]), review ([N])
   ├─ By provider: claude ([N]), codex ([N])
   ├─ Total prompt chars: [N]
   └─ Total duration: [N]s

📝 Commit fold: [fold_result from step 8.5]
```

Example `fold_result` values:
- `Folded 3 review fixes into 5 task commits` — per-task/per-batch autosquash succeeded
- `Folded 0 review fixes into 5 task commits` — no fix commits needed folding (clean run)
- `Collapsed pipeline into single commit abc1234` — one-commit mode
- `commit_style=custom; leaving commits untouched.` — custom mode
- `Autosquash aborted: <git error>. Review fix commits remain on work branch. Conflicting files: <files>` — conflict fallback
- `Legacy session — autosquash skipped; review fix commits remain on work branch.` — legacy pipeline

Get the metrics data from `invoke_get_metrics`: use `summary.total_dispatches`, `summary.total_prompt_chars`, `summary.total_duration_ms`, and `summary.by_stage`; convert `summary.total_duration_ms` to seconds for the final line; aggregate `entries` by `provider` for the provider line; print `0` for any missing stage before rendering the summary.

### 10. Commit Strategy

Present the commit strategy using `AskUserQuestion` as defined in the invoke-messaging standard (Commit Strategy pattern). Use `multiSelect: false` with options: Per batch (Recommended), One commit, Per task, Custom.

Execute the chosen commit strategy. The session work branch is preserved at pipeline completion. It will only be removed when the user explicitly cleans up the session via invoke_cleanup_sessions, where they will be prompted to keep or delete the branch.

### PR Offer (R5)

If `state.work_branch` is set (the session was initialized with a per-session work branch via invoke-scope's invoke_session_init_worktree call), offer to push and optionally create a PR. Skip this step entirely if `state.work_branch` is unset (legacy sessions).

Use `AskUserQuestion`:

```
AskUserQuestion({
  questions: [{
    question: 'Pipeline complete. Push the session work branch and open a PR?',
    header: 'PR offer',
    multiSelect: false,
    options: [
      { label: 'Create PR (Recommended)', description: 'Push to origin and open a PR via gh against the original base branch' },
      { label: 'Push only', description: 'Push the branch to origin without creating a PR — the compare URL will be printed' },
      { label: 'Skip', description: 'Do not push or create a PR' }
    ]
  }]
})
```

If the user picks Create PR or Push only, call `invoke_pr_create` with:
- `session_id: <pipeline_id>`
- `base_branch: <state.base_branch>` (read from state, set during invoke-scope)
- `mode: 'create_pr'` or `'push_only'` accordingly

The tool detects gh availability and degrades gracefully — if gh is missing or unauthenticated, it falls back to push + printing a compare URL. Print the response (pr_url or compare_url) to the user.

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

## Session Cleanup (R6) — contract for cleanup callers

This section documents the per-session prompt contract that any cleanup flow must follow per R6. **The actual cleanup operation lives in invoke-manage — see its Cleanup Sessions section.** invoke-review does not run cleanup itself, but if you call `invoke_cleanup_sessions` from any context, you MUST follow this per-session loop:

1. List sessions to clean up via `invoke_list_sessions`.
2. For each session whose `state.work_branch` is set, ask the user via `AskUserQuestion` (Keep / Delete branch).
3. Call `invoke_cleanup_sessions` with `session_id` and `delete_work_branch`.
4. Repeat per session.
