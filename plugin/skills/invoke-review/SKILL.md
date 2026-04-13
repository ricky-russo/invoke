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

Derive `orchestrationBatchId = state.batches.at(-1)?.id` (numeric — the ID of the last completed build batch in `state.batches[]`). This value is stable across all cycles of this review pass.

If `state.batches` is empty, emit ⚠️ `No orchestration batch — treating every cycle as cycle-1 (full diff)`, skip cycle-2 detection entirely, and omit `batch_id` on all saved ReviewCycles in this pass. In this case, set `orchestrationBatchId = undefined`.

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

### 3.5 Determine Current Tier (tiered mode only)

Skip this step entirely if `review_tiers` is not configured (fallback mode). Also set `currentScope = undefined` — it is only set to `'final'` when recording the very last review cycle in step 6.

Scan `state.review_cycles` to determine which tier to run next:

1. For each configured tier in order (`critical` → `quality` → `polish`), find the most recent `review_cycle` entry where `rc.tier === tier` AND `rc.batch_id === orchestrationBatchId`.
   - **No matching cycle exists:** this tier has not been started — set `currentTier` to this tier and stop scanning.
   - **A matching cycle exists but the tier has NOT cleared** (unresolved in-scope findings remain — see clearing rules below): set `currentTier` to this tier (re-review needed after fixes) and stop scanning.
   - **The tier has cleared:** continue to the next tier.

2. **Clearing rules** (same as step 8, restated here for the algorithm):
   - `critical` clears when the latest critical-tier cycle has no unresolved `critical` or `high` in-scope accepted findings after triage and any accepted fixes have been re-reviewed.
   - `quality` clears when the latest quality-tier cycle has no unresolved in-scope accepted findings remaining.
   - `polish` clears when the latest polish-tier cycle has no unresolved in-scope accepted findings remaining.

3. **If `currentTier` is `polish`:** before proceeding, ask the user whether to run it or skip:

```
AskUserQuestion({
  questions: [{
    question: 'Critical and quality tiers have cleared. Run the polish tier?',
    header: 'Polish tier',
    multiSelect: false,
    options: [
      { label: 'Run polish tier', description: 'Dispatch polish reviewers: [list names from config]' },
      { label: 'Skip — complete pipeline', description: 'Skip polish and proceed to completion' }
    ]
  }]
})
```

If the user skips polish, jump directly to step 8.5 (Autosquash) and then step 9 (Complete Pipeline).

4. **If all configured tiers have cleared**, skip review entirely — jump to step 8.5 and then step 9.

5. **Confirm the tier dispatch** with the user via `AskUserQuestion`:

```
AskUserQuestion({
  questions: [{
    question: 'Ready to dispatch the [currentTier] tier reviewers?',
    header: '[CurrentTier] tier review',
    multiSelect: false,
    options: [
      { label: 'Dispatch [currentTier] tier', description: 'Reviewers: [list reviewer names from tier config]' },
      { label: 'Skip — complete pipeline', description: 'Skip remaining review and proceed to completion' }
    ]
  }]
})
```

If the user skips, jump to step 8.5 and then step 9.

### Pre-Dispatch Preparation

Before dispatching reviewers, complete these three substeps in order.

**3.1 Read Spec Context**

Read `state.spec` from pipeline state. Call `invoke_read_artifact({ stage: 'specs', filename: <basename of state.spec> })` to load the spec text. Hard-truncate to 4000 characters; if truncated, append `\n\n(spec truncated at 4000 chars)`. Store the result as `specContext`. If the read fails, set `specContext = '(spec unavailable for this cycle)'` and emit: `⚠️ Spec artifact not found — reviewers will not have scope context this cycle`.

**3.2 Capture Current SHA**

Run `git rev-parse HEAD` in the session worktree. Store the result as `currentSha`. This SHA will be persisted on the `review_cycle_update` in step 6 so that cycle 2+ can compute a delta diff.

**3.3 Detect Cycle and Compute Prior Findings**

Call `invoke_get_review_cycle_count` with `session_id: <pipeline_id>` to get an overall count, but **do not use that count alone to decide cycle 1 vs cycle ≥ 2**. Instead, reverse-scan `state.review_cycles` for the most recent entry where:
- `rc.batch_id === orchestrationBatchId`
- `rc.scope === currentScope`
- (in tiered mode) `rc.tier === currentTier`

Only an exact match on all three keys triggers the cycle ≥ 2 path. A non-empty `state.review_cycles` from earlier or unrelated batches does NOT. If `orchestrationBatchId` is undefined (empty-batches case), skip this lookup entirely and treat every cycle as cycle-1.

- **No matching prior cycle (treat as cycle 1):** Set `priorFindings = '(first review cycle — no prior findings)'`. Use the full `git diff main...HEAD` (or `git diff $(git merge-base HEAD main)...HEAD`) as the diff.

- **Matching prior cycle exists (cycle ≥ 2):** Read its `reviewed_sha`.
  - **If `reviewed_sha` is undefined or missing** (legacy ReviewCycles may not carry one): emit ⚠️ `Prior cycle has no reviewed_sha — falling back to full diff`, skip the tool call entirely, use the full `git diff main...HEAD` as the diff, and set `priorFindings = '(prior cycle has no reviewed_sha — full diff being reviewed)'`.
  - **If `reviewed_sha` is defined:** Call `invoke_compute_review_diff({ session_id: <pipeline_id>, reviewed_sha: <prior cycle reviewed_sha> })`.
    - If the tool returns `{ status: 'ok', reviewed_sha, diff }`: use `result.diff` as the delta diff for this cycle. Build `priorFindings` as a numbered checklist of that cycle's `triaged.accepted` findings, **excluding any with `out_of_scope === true`**:
      ```
      1. [HIGH] src/auth/token.ts:42 — SQL injection
         Fix: Use parameterized queries
      ```
      **Cap the checklist at 20 entries OR 4000 characters, whichever comes first.** If the prior cycle's accepted-and-in-scope findings exceed either limit, truncate and append a single overflow line: `(N more prior findings truncated — review the delta diff for full context)`. Prefer to filter the checklist to findings relevant to the current reviewer's specialty when reviewer-relevance metadata is available; otherwise use the natural order from `triaged.accepted`.
    - If the tool returns any other status (`invalid_reviewed_sha`, `commit_not_found`, `diff_error`, `diff_too_large`, `resolve_error`, `not_supported`): emit ⚠️ `No prior review SHA (tool returned <status>) — falling back to full diff`, use `git diff main...HEAD` as the diff, and set `priorFindings = '(prior cycle had no usable reviewed_sha — full diff being reviewed)'`.

Both `specContext` and `priorFindings` **MUST** always be set to a non-empty string before dispatching — never `undefined`.

### 4. Dispatch Reviewers

Dispatch either the selected reviewers from the fallback flow or the reviewers from the current tier using `invoke_dispatch_batch`:
- `create_worktrees: false` (reviewers don't modify code)
- `task_context: { task_description: "<what was built — summary from plan>", diff: "<delta diff or full diff per step 3.3>", scope: specContext, prior_findings: priorFindings }`

Use the diff computed in step 3.3 (delta diff for cycle ≥ 2 when `reviewed_sha` is available, full `git diff main...HEAD` for cycle 1 or when no prior SHA exists). `scope` and `prior_findings` MUST always be the strings resolved in pre-dispatch steps 3.1 and 3.3 — never `undefined`.

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

**Provider Agreement Display.** When a reviewer's merged `result.output.provider_counts` is present (multi-provider parallel dispatch), print a per-provider count line under the reviewer header BEFORE the findings list:

> _providers: claude=4, codex=4_

If any provider has `0` while another has `>0`, emit a divergence warning immediately after the count line:

> ⚠️ **Provider divergence:** claude returned 0 findings, codex returned 4.
> Review the findings carefully — one provider may have missed issues the other caught, or one may be hallucinating. Consider re-running the reviewer or checking the raw output for each provider.

Omit the provider line entirely when `provider_counts` is undefined (single-provider review dispatches).

### 5.1 Partition Out-of-Scope Findings

Before triage, partition all findings:

- **`inScopeFindings`** — findings where `out_of_scope !== true`
- **`outOfScopeFindings`** — findings where `out_of_scope === true`

In the step 5 output, show only `inScopeFindings` in the reviewer-grouped sections. Append a separate section at the end for out-of-scope findings:

> **📋 Out-of-Scope (will be logged as bugs)**
> 1. [HIGH] src/legacy/module.ts:88 — Hard-coded API key
>    Suggestion: Move to environment variable

**Out-of-scope confirmation** — if `outOfScopeFindings.length > 0`, ask before the standard triage question:

```
AskUserQuestion({
  questions: [{
    question: '[N] findings were flagged as out-of-scope. How would you like to handle them?',
    header: 'Out-of-scope findings',
    multiSelect: false,
    options: [
      { label: 'Log all N out-of-scope findings as bugs (Recommended)', description: 'Auto-defer and log each as a tracked bug for later' },
      { label: 'Override — triage them manually', description: 'Clear the out-of-scope flag and include them in normal triage' }
    ]
  }]
})
```

- **Log all (Recommended):** For each finding in `outOfScopeFindings`, call `invoke_report_bug` with `title` (from `finding.issue`), `description` (from `finding.suggestion`), `severity`, `file`, `line`, and `session_id`. Collect the returned bug IDs, store findings under `triaged.deferred` (and mark them as already-logged so step 6.1's "Deferred Findings as Bugs" prompt does not re-offer them). To append bug IDs to `state.bug_ids`: first call `invoke_get_state` to read the existing `state.bug_ids` array, then call `invoke_set_state` with `bug_ids: [...existing, ...newBugIds]` (deduplicated). **Do NOT pass only the new bug IDs to `invoke_set_state` — `invoke_set_state` REPLACES top-level arrays, it does not merge them, so passing only the new IDs would silently drop any pre-existing pipeline bugs.** Confirm: "Logged [N] out-of-scope findings as bugs: [BUG-NNN, ...]"
- **Override:** Clear `out_of_scope` on each overridden finding and merge them into `inScopeFindings` for normal triage in step 6.

### 6. User Triage

The following triage operates on **`inScopeFindings` only**. Out-of-scope findings were handled in step 5.1 and are excluded from the count below.

THEN, in a separate message, ask the user how to handle the findings using `AskUserQuestion`. Always offer bulk options first:

```
AskUserQuestion({
  questions: [{
    question: "[N] in-scope findings from [M] reviewers[ in the <tier name> tier]. How would you like to proceed?",
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

After triage, record the review cycle using `invoke_set_state` with `session_id: <pipeline_id>` and `review_cycle_update`. First call `invoke_get_review_cycle_count` with `session_id: <pipeline_id>` to read the current count; use `count + 1` as the new monotonic `id`. Save the reviewers, findings, and triage result (`accepted` / `deferred` / `dismissed`). For tiered review cycles, include `tier: "<tier name>"`. In fallback mode, leave `tier` unset. For final review cycles in this stage, include `scope: 'final'`. Always include `reviewed_sha: currentSha` (the SHA captured in pre-dispatch step 3.2) on every cycle. Set `batch_id: orchestrationBatchId` (the numeric value derived in step 1). If `orchestrationBatchId` is undefined (empty-batches case), omit `batch_id` entirely from the saved ReviewCycle.

Each `review_cycle_update` follows this schema:

```json
{
  "id": 1,
  "reviewers": ["<subrole>"],
  "scope": "final",
  "batch_id": orchestrationBatchId,
  "reviewed_sha": "<git sha at time of dispatch>",
  "tier": "critical",
  "findings": [
    {
      "reviewer": "<subrole>",
      "severity": "HIGH",
      "file": "src/auth/token.ts",
      "line": 42,
      "issue": "SQL injection",
      "suggestion": "Use parameterized queries",
      "original_task_id": "auth-middleware",
      "agreed_by": ["claude", "codex"]
    }
  ],
  "triaged": {
    "accepted": [
      {
        "severity": "HIGH",
        "file": "src/auth/token.ts",
        "line": 42,
        "issue": "SQL injection",
        "suggestion": "Use parameterized queries"
      }
    ],
    "deferred": [],
    "dismissed": []
  }
}
```

`scope` is only set on final review cycles. `tier` is omitted in fallback mode. `agreed_by` is omitted when there is only one reviewer. **Each entry in `triaged.accepted`, `triaged.deferred`, and `triaged.dismissed` MUST be a full Finding object** (with `severity`, `file`, `line`, `issue`, `suggestion`, optional `out_of_scope`, optional `agreed_by`), NOT just an ID — substep 3.3 of the next cycle reads these objects to render the prior-findings checklist.

**`original_task_id` attachment — REQUIRED when commit_style is per-task / per-batch / one-commit.** Step 6.5 needs to know which task commit each finding should fold into. The skill attaches this during triage:

1. **When building the finding list** from reviewer output, look at `finding.file` and map it to the most recently merged task that touched that file. Walk `state.batches` in reverse order and find the first task whose worktree diff includes that path — use its `id` as `original_task_id`. For tasks merged in the current pipeline, this is deterministic: the file:task map is `relevant_files` keys from the build stage's `tasks.json`.
2. **When `finding.file` matches multiple tasks** (cross-task finding), split the finding into one finding per originating task, each with its own `original_task_id`. The split preserves `issue` / `suggestion` / `severity` but narrows the scope to each task's portion of the fix.
3. **When `finding.file` is genuinely cross-cutting** (e.g., a new file that doesn't exist in any task's `relevant_files`, or a cross-layer architectural finding), leave `original_task_id` unset. Step 6.5 will then store `None` for the fixup target, and step 7 will dispatch the finding as a normal `feat:` commit that remains visible after autosquash.
4. **When `commit_style == 'custom'`**, skip attachment entirely — fixup folding does not apply.

If the skill cannot determine `original_task_id` from `relevant_files` / diff overlap (e.g., because the task breakdown was lost or the finding file wasn't touched by any task), use `AskUserQuestion` to ask the user which task this finding belongs to. Present the list of merged task IDs from `state.batches` as options. This is the operator escape hatch when heuristics fall short.

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

Out-of-scope findings were never added to `triaged.accepted`, so the dispatch loop below automatically excludes them.

Before dispatching fix tasks, call `invoke_get_prior_findings_for_builder({ session_id: <pipeline_id>, batch_id: orchestrationBatchId })` and store the returned string (from `result.content[0].text`) as `priorFindingsForFix`. This string is the same checklist the builder will see, minus any findings marked `out_of_scope: true`. If `orchestrationBatchId` is undefined (the empty-batches case), call without `batch_id`.

Bundle accepted findings as fix tasks. For each finding, create a task:
- `task_description`: the finding details + suggestion
- `acceptance_criteria`: the specific fix expected
- `relevant_files`: the file(s) mentioned in the finding
- `prior_findings`: `priorFindingsForFix` (the builder template wraps `{{prior_findings}}` in the same anti-injection sentinels reviewers use; out-of-scope findings are already filtered out by the tool)

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

A finding is **unresolved** if it has been accepted (triaged into the accepted list) but not yet fixed by a builder. A finding is **resolved** if it has been fixed or dismissed. Do not count dismissed findings when checking whether a tier has unresolved critical/high findings. **Out-of-scope findings are also excluded from this count** — only in-scope findings determine whether a tier has unresolved critical/high findings blocking tier progression.

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

Read `commit_style` from config (same value as step 6.5 used). Also read `state.work_branch_path` — legacy sessions that predate per-session work branches have no `work_branch_path` and MUST be kept on the append-only path for every commit_style mode, because `invoke_collapse_commits` and `invoke_autosquash_session` both refuse to operate on legacy sessions (they'd either error out or return `not_supported`).

```
fold_result = None  # for step 9 summary

if state.work_branch_path is not set:
  # Legacy session — no session work branch, nothing to rewrite. Skip every
  # commit_style branch uniformly and keep append-only history.
  fold_result = 'Legacy session — commit folding skipped; history left as-is.'

elif commit_style == 'one-commit':
  # Collapse the entire session branch (all tasks + all review fixes) into a
  # single commit. Build a concrete commit message from state — prefer the
  # spec slug, falling back to the pipeline id. The spec slug comes from the
  # spec filename: if state.spec is `specs/2026-04-06-fixup-folding-spec.md`,
  # the slug is `fixup-folding` (strip date prefix and `-spec.md` suffix).
  base_sha = git merge-base <state.base_branch> HEAD   # on state.work_branch_path
  slug = derive_spec_slug(state.spec) or state.pipeline_id
  commit_message = 'feat: ' + slug
  result = invoke_collapse_commits({
    session_id: <pipeline_id>,
    base_sha: base_sha,
    message: commit_message,
  })
  fold_result = 'Collapsed pipeline into single commit ' + result.commit_sha + ' (' + commit_message + ')'

elif commit_style == 'custom':
  fold_result = 'commit_style=custom; leaving commits untouched.'

else:
  # per-task and per-batch: absorb fixup! commits into their target commits.
  # invoke_autosquash_session also returns `not_supported` for legacy sessions
  # as a defensive fallback, but we already handled that above.
  result = invoke_autosquash_session({ session_id: <pipeline_id> })
  if result.status == 'ok':
    fold_result = 'Folded ' + result.fixups_absorbed + ' review fixes into ' + result.commits_after + ' task commits'
  elif result.status == 'not_supported':
    # Defensive: shouldn't reach here because of the legacy check above.
    fold_result = 'Legacy session — autosquash skipped; review fix commits remain on work branch.'
  elif result.status == 'conflict_aborted':
    fold_result = 'Autosquash aborted (merge conflict during rebase): ' + result.message + '. Review fix commits remain on work branch. Conflicting files: ' + result.conflicting_files.join(', ')
  elif result.status == 'error':
    # Non-conflict failure: detached HEAD, bad ref, corrupted state, etc.
    # Surface it explicitly so the user knows it is NOT a conflict fallback.
    fold_result = 'Autosquash errored (non-conflict failure): ' + result.message + '. Review fix commits remain on work branch. Manual inspection required.'
```

Helper `derive_spec_slug(spec_path)`:
- Strip the `specs/` prefix and the `.md` suffix.
- Strip the leading date prefix `YYYY-MM-DD-` if present.
- Strip the trailing `-spec` suffix if present.
- Return the remaining slug, or `None` if the spec path is empty or unusable.

Print `fold_result` immediately so the user sees it during the run. Step 9's final summary also includes it so the user can reference it after the fact. `conflict_aborted` and `error` are both non-blocking warnings — the pipeline continues to `complete` normally, and the user can inspect the work branch manually to resolve any residual fix commits. The distinction matters for triage: `conflict_aborted` means a real merge conflict during the fixup-fold (expected fallback), while `error` means the rebase never got far enough to hit a conflict (detached HEAD, corrupt state, or some other git failure that warrants manual inspection).

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
5. Promote durable discoveries from `Session Discoveries` only with explicit user approval:
   - Read the current context via `invoke_get_context` and inspect the `Session Discoveries` section.
   - For each discovery, decide whether it is durable project context or transient session-only information.
   - Prepare up to three proposed promotion payloads:
     - Durable architectural changes: first read the existing `Architecture` content, merge in the durable change, and prepare the full merged replacement content for `section: "Architecture"` with `mode: "replace"`.
     - New conventions that should persist across future work: prepare the exact bullet lines to append to `section: "Conventions"` with `mode: "append"`.
     - New hard constraints or operational limits: prepare the exact bullet lines to append to `section: "Constraints"` with `mode: "append"`.
   - Print the proposed promotions as text before asking for approval so the user can review exactly what would be written to each permanent section. Show each non-empty category separately:
     - `Architecture` proposed replacement: [full merged Architecture section content]
     - `Conventions` proposed append: [exact bullet lines to append]
     - `Constraints` proposed append: [exact bullet lines to append]
   - If no category has a proposed promotion, skip the approval question and do not call `invoke_update_context` for promotion.
   - Otherwise, BEFORE any promotion `invoke_update_context` calls, ask the user via `AskUserQuestion` to approve each non-empty category separately:

   ```text
   AskUserQuestion({
     questions: [
       {
         question: 'Approve replacing the Architecture section with the proposed merged content shown above?',
         header: 'Architecture promotion',
         multiSelect: false,
         options: [
           { label: 'Approve replacement', description: 'Write the proposed Architecture replacement' },
           { label: 'Reject replacement', description: 'Do not write the proposed Architecture change' }
         ]
       },
       {
         question: 'Approve appending the proposed Conventions entries shown above?',
         header: 'Conventions promotion',
         multiSelect: false,
         options: [
           { label: 'Approve append', description: 'Append the proposed Conventions entries' },
           { label: 'Reject append', description: 'Do not write the proposed Conventions entries' }
         ]
       },
       {
         question: 'Approve appending the proposed Constraints entries shown above?',
         header: 'Constraints promotion',
         multiSelect: false,
         options: [
           { label: 'Approve append', description: 'Append the proposed Constraints entries' },
           { label: 'Reject append', description: 'Do not write the proposed Constraints entries' }
         ]
       }
     ]
   })
   ```

   - Include only the questions for categories that actually have proposed content.
   - After the user answers, call `invoke_update_context` only for the categories the user explicitly approved:
     - Approved `Architecture` replacement: call `invoke_update_context` with:
       - `section: "Architecture"`
       - `mode: "replace"`
       - `content: [full merged Architecture section content]`
     - Approved `Conventions` appends: call `invoke_update_context` with:
       - `section: "Conventions"`
       - `mode: "append"`
       - `content: [exact bullet lines approved for append]`
     - Approved `Constraints` appends: call `invoke_update_context` with:
       - `section: "Constraints"`
       - `mode: "append"`
       - `content: [exact bullet lines approved for append]`
   - If the user rejects a category, do NOT write that category.
   - Transient patterns, one-off debugging notes, and session-local observations: do NOT promote them.
6. Clear `Session Discoveries` after the approval pass regardless of whether any promotions were proposed or approved so the heading remains but the session-only content is removed. Call `invoke_update_context({ section: 'Session Discoveries', mode: 'replace', content: '' })` unconditionally.

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

### 10. Commit Strategy (read-only summary)

**Do NOT prompt the user to choose a commit strategy here.** The commit strategy is controlled by `config.settings.commit_style` and was already enforced during build (per-batch collapse in invoke-build step g2) and review (fold or collapse in step 8.5). Re-prompting at the end of review would:
- Conflict with the new `per-task` default set during this spec's work.
- Invite the user to override a setting that has already been acted on — the build and review stages cannot retroactively reshape commits based on a post-review answer.

Instead, print a one-line summary of what commit_style was in effect for this pipeline so the user can see how commits are grouped on the session work branch:

```
📋 Commit style: <commit_style> ([description])
```

Where `[description]` matches the mode:
- `per-task`: one commit per build task; reviewer fixes folded via autosquash at end of review (default)
- `per-batch`: one commit per build batch; reviewer fixes folded via autosquash at end of review
- `one-commit`: single commit for the entire pipeline; collapse happened in step 8.5
- `custom`: commit grouping left to the operator / skill extensions; no automatic folding

If the user wants to CHANGE `commit_style`, they must do so in `config.settings.commit_style` and re-run the pipeline (or at minimum re-run from the build stage) — there is no in-flight override path. The session work branch is preserved at pipeline completion; it will only be removed when the user explicitly cleans up the session via invoke_cleanup_sessions, where they will be prompted to keep or delete the branch.

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

After all review cycles complete and the user approves the final result, update state with `current_stage: "complete"` via `invoke_set_state` with `session_id: <pipeline_id>`. The server validates the transition; because `complete` is terminal, do not expect a `next_step` field after this update.

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
