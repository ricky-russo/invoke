# Pipeline Stages

Invoke executes development work through a structured pipeline of six stages: Scope, Plan, Orchestrate, Build, Review, and (when needed) Resume. Each stage has a distinct responsibility, produces durable artifacts, and requires specific user decisions before advancing.

---

## Full Pipeline Flow

```mermaid
flowchart TD
    Start([Start]) --> Scope

    Scope --> ResearchDone{Research complete?}
    ResearchDone -- Yes --> ClarifyQ[Ask clarifying questions]
    ResearchDone -- No --> DispatchResearchers[Dispatch researchers]
    DispatchResearchers --> ClarifyQ
    ClarifyQ --> WriteSpec[Produce spec]
    WriteSpec --> SpecApproved{Spec approved?}
    SpecApproved -- No --> ClarifyQ
    SpecApproved -- Yes --> Plan

    Plan --> DispatchPlanners[Dispatch planners]
    DispatchPlanners --> ComparePlans[Present plan comparison]
    ComparePlans --> PlanChoice{User selects}
    PlanChoice -- One plan --> SavePlan[Save plan]
    PlanChoice -- Hybrid --> SavePlan
    PlanChoice -- Re-plan --> DispatchPlanners
    SavePlan --> Orchestrate

    Orchestrate --> AutoDetect[Auto-detect strategy from plan keywords]
    AutoDetect --> ChooseStrategy[User confirms build strategy]
    ChooseStrategy --> BreakDown[Break plan into batches and tasks]
    BreakDown --> BuildLayers[Build DAG execution layers per batch]
    BuildLayers --> BreakdownApproved{Breakdown approved?}
    BreakdownApproved -- No --> BreakDown
    BreakdownApproved -- Yes --> Build

    Build --> NextBatch{Next batch?}
    NextBatch -- Yes --> SelectBuilders[Select builders]
    SelectBuilders --> DispatchLayers[Dispatch tasks in execution layers]
    DispatchLayers --> TaskResult{Task result}
    TaskResult -- Completed --> OfferMerge[Offer per-task merge]
    OfferMerge --> BatchDone{Batch complete?}
    TaskResult -- Dep failed --> SkipTask[Skip — prerequisite failed]
    SkipTask --> BatchDone
    TaskResult -- Error --> ErrorRecovery{Retry / Skip / Abort}
    ErrorRecovery -- Retry --> DispatchLayers
    ErrorRecovery -- Skip --> BatchDone
    ErrorRecovery -- Abort --> Cleanup([Cleanup and stop])
    BatchDone -- No --> TaskResult
    BatchDone -- Yes --> PostMerge[Post-merge commands + validation]
    PostMerge --> InterBatch{Inter-batch review?}
    InterBatch -- Yes --> ReviewLoop[Run review cycle]
    ReviewLoop --> NextBatch
    InterBatch -- Skip --> NextBatch
    NextBatch -- No more batches --> Review

    Review --> ShowMetrics[Show dispatch cost and usage summary]
    ShowMetrics --> SelectReviewers[Select reviewers / current tier]
    SelectReviewers --> DispatchReviewers[Dispatch reviewers]
    DispatchReviewers --> Findings[Present findings]
    Findings --> Triage{User triage}
    Triage -- Accept findings --> DispatchFixes[Dispatch fix agents]
    DispatchFixes --> ShowMetrics
    Triage -- All dismissed --> AnotherCycle{Another cycle or tier?}
    AnotherCycle -- Yes --> ShowMetrics
    AnotherCycle -- No --> Commit
    Commit --> Done([Pipeline complete])

    Resume([Resume]) --> ListSessions[List sessions — active / stale / complete]
    ListSessions --> SelectSession[User selects session]
    SelectSession --> ReadState[Read sessions/session_id/state.json]
    ReadState --> ShowStatus[Present task-level progress]
    ShowStatus --> OrphanCheck[Check for orphaned worktrees]
    OrphanCheck --> UserChoice{Continue / Redo / Abort}
    UserChoice -- Continue --> ActiveStage[Resume at current stage]
    UserChoice -- Redo --> ActiveStage
    UserChoice -- Abort --> Cleanup
```

---

## Stage 1: Scope

### What it does

The scope stage establishes shared understanding of what needs to be built before any implementation begins.

If the project has no `context.md` yet, scope first initializes project context. For existing codebases it dispatches a `codebase` researcher to analyze structure, tech stack, patterns, and dependencies, then uses those findings to ask targeted questions and generate a `context.md`. For greenfield projects it skips research and gathers the same information interactively.

Once context exists, scope dispatches the selected researchers in parallel. Each researcher explores a specific domain (security posture, existing patterns, external APIs, performance characteristics, etc.) and returns a report. The aggregated research informs a series of clarifying questions asked one at a time, focusing only on decisions that require human judgment — things the research did not already answer.

When the answers are sufficient, scope produces a written spec.

### User decisions

- Which researchers to dispatch (multi-select from configured researchers)
- Answers to clarifying questions (purpose, constraints, success criteria, edge cases, non-functional requirements)
- Spec approval (reject sends the conversation back to clarifying questions)

### Artifacts

`specs/YYYY-MM-DD-<slug>-spec.md`

The spec covers: goal, specific and testable requirements, technical constraints, acceptance criteria, and an explicit out-of-scope list.

### Resume behavior

If the session is interrupted after research completes but before the spec is written, invoke-scope resumes at the clarifying questions step. Research results are already available and do not need to be re-run.

---

## Stage 2: Plan

### What it does

The plan stage generates competing implementation approaches and lets the user choose how to proceed.

Planners are dispatched in parallel, each receiving the full spec content and any available research reports. Each planner proposes a distinct approach to implementing the spec. Once all planners complete, the results are presented with per-plan summaries (approach, key technical decisions, what it optimizes for), a cross-plan comparison (where they agree, where they differ, trade-offs), and a recommendation.

### User decisions

- Which planners to dispatch (multi-select; running multiple planners gives competing approaches to compare)
- Which plan to adopt: one plan as-is, a hybrid combining elements from multiple plans, or a re-plan with additional constraints added

### Artifacts

`plans/YYYY-MM-DD-<slug>-plan.md`

The filename slug matches the spec (e.g., if the spec is `2026-04-03-auth-middleware-spec.md`, the plan is `2026-04-03-auth-middleware-plan.md`).

### Resume behavior

If interrupted before planners are dispatched, invoke-plan resumes at planner selection. If interrupted after planners complete but before the user has chosen, invoke-plan resumes at the plan comparison and selection step.

---

## Stage 3: Orchestrate

### What it does

The orchestrate stage translates the chosen plan into a concrete, executable task graph.

**Strategy auto-detection.** Before breaking down the plan, invoke scans the plan text for keywords and suggests an appropriate build strategy (`src/strategy/auto-detect.ts:54-87`):

- Keywords `fix`, `bug`, `regression`, or `broken` → suggests `bug-fix`
- Keywords `prototype`, `spike`, `mvp`, `quickly`, or `urgent` → suggests `prototype`
- `test` mentioned in the text combined with existing test files in the repo → suggests `tdd` (medium confidence)
- No matching pattern → suggests the configured default strategy (low confidence)

The suggestion is presented alongside the confidence level and matching keywords. The user always has final choice and can select any configured strategy regardless of the suggestion.

**Task breakdown.** The plan is decomposed into individual tasks. Each task must be self-contained (an agent can complete it without understanding the whole system), small (targeting 1–3 files), and well-defined with clear acceptance criteria. Tasks that would touch the same file are placed in different batches to avoid conflicts.

Tasks are grouped into sequential batches where foundational work (types, interfaces, core utilities) lands in earlier batches and later batches build on those outputs.

**DAG scheduling.** Within each batch, tasks can declare dependencies on other tasks in the same batch using the `depends_on` field — an array of prerequisite task IDs (`src/types.ts:200`). `buildExecutionLayers()` applies Kahn's algorithm (topological sort) to arrange tasks into ordered execution layers (`src/dispatch/dag-scheduler.ts:6-63`). All tasks in a layer are independent and run in parallel; the next layer does not begin until the current layer completes. Dependencies are strictly intra-batch — cross-batch dependencies are not supported. If a prerequisite task fails or errors, any task that depends on it is immediately settled with a "Prerequisite \<id\> failed" error and not dispatched (`src/dispatch/batch-manager.ts:342-366`).

A circular dependency in any batch's task graph raises an error during orchestrate rather than at dispatch time (`src/dispatch/dag-scheduler.ts:58-60`).

### User decisions

- Build strategy selection (invoke's auto-detected suggestion is shown with confidence level; the configured default is marked as recommended)
- Task breakdown approval — the user can request tasks be split, merged, reordered, or have `depends_on` relationships added or removed before confirming

### Artifacts

`plans/YYYY-MM-DD-<slug>-tasks.json`

The tasks file contains the chosen strategy and the full batch/task structure, including each task's description, acceptance criteria, relevant files, interface contracts, and any `depends_on` declarations.

### Resume behavior

If interrupted before the breakdown is approved, invoke-orchestrate resumes at the task breakdown presentation and approval step.

---

## Stage 4: Build

### What it does

The build stage executes the task graph: dispatching agents in isolated git worktrees, merging results as tasks complete, running post-merge commands, validating, and optionally running inter-batch reviews.

**Execution.** For each batch, the user selects which builders to use, then the batch is dispatched. If the batch contains tasks with `depends_on` set, tasks run in the topological layers built during orchestrate — all tasks in a layer run in parallel, with each layer waiting for the previous one to finish before starting (`src/dispatch/batch-manager.ts:434-446`). Batches without any dependencies run all tasks in parallel as a single flat layer.

Each agent works in its own worktree (a separate `git worktree add` branch under a temp path) so the main work branch stays clean throughout the batch.

**Per-task merge.** Tasks are offered for merge individually as they complete — the user does not have to wait for all tasks in the batch to finish before merging a completed one. This is handled via `invoke_merge_worktree`. The merge process for each task is (`src/worktree/manager.ts:39-67`):

1. `git add -A` — stage all changes in the worktree
2. Commit staged changes if any exist (agents in sandboxed environments may not commit themselves)
3. `git merge --squash <branch>` — squash all worktree commits into the work branch as staged changes
4. `git commit` — record the squash commit on the work branch
5. Clean up the worktree

**Partial batch state.** `BatchState.merged_tasks` records the list of task IDs that have been individually merged (`src/types.ts:190`). `TaskState.merged` is set to `true` once a task's worktree has been merged (`src/types.ts:201`). A batch's status is `'partial'` when at least one task has been merged but the batch is not yet complete (`src/types.ts:188`). This allows resume to correctly identify which tasks in a batch still need merging.

**Review cycle guard.** The `max_review_cycles` setting caps the number of inter-batch (and final) review iterations (`src/types.ts:43`). Before initiating a review cycle, `invoke_get_review_cycle_count` returns the current cycle count for the batch alongside the configured limit (`src/tools/state-tools.ts:131-166`). When the limit is reached, additional review cycles are not offered.

After all worktrees in a batch are merged, post-merge commands run (e.g., regenerating `composer.lock` or `package-lock.json`), followed by the configured validation hook (lint, tests). If validation fails, the failure is presented and must be resolved before the next batch starts.

Between batches, the user can optionally run reviewers against the current state of the codebase before proceeding. This follows the same flow as the review stage and can catch issues early.

### User decisions

- Builder selection for each batch (multi-select from configured builders)
- Per-task merge acceptance as each task completes
- Error recovery when a task fails: retry, skip, or abort the batch
- Inter-batch review: select reviewers to run, or skip and proceed to the next batch

### Artifacts

Code changes merged into the work branch. No separate document artifact is produced; the git history records the per-task squash commits.

### Resume behavior

When resuming a build, invoke-build advances to the next incomplete batch. Within a batch, only tasks not already marked `completed` are re-dispatched. Tasks with `merged: true` in their state are not re-merged. The resume prompt reports how many tasks in the batch were already done and how many remain.

---

## Stage 5: Review

### What it does

The review stage runs one or more structured review passes against the completed work, triages findings with the user, dispatches fix agents, and loops until the user is satisfied. It then updates project context and commits the final result.

**Cost and usage summary.** Before each round of reviewer dispatches, invoke shows a metrics summary via `invoke_get_metrics`: total dispatches so far in the session, total duration, and estimated cost in USD (`src/types.ts:227-231`, `src/tools/metrics-tools.ts:15-68`). This gives the user visibility into accumulated spend before selecting which reviewers to run.

**Standard review flow (no `review_tiers` configured).** Reviewers (security, code quality, performance, accessibility, etc.) are selected by the user and dispatched in parallel. Each reviewer receives a summary of what was built plus a full git diff and returns structured findings with severity, file location, description, and suggested fix. Findings are presented grouped by reviewer. The user triages each finding individually (or in bulk per reviewer): accepted findings are bundled into fix tasks and dispatched as a new build batch, dismissed findings are skipped. After fixes are applied the user can run another review cycle or declare the pipeline complete.

**Tiered review flow (`review_tiers` configured).** When `review_tiers` is set in the pipeline configuration, reviewers are dispatched in named tiers rather than all at once (`src/types.ts:27-30`, `src/types.ts:44`). Each tier has a name (e.g., `critical`, `quality`, `polish`) and a list of reviewers assigned to it. The tiers gate each other:

1. Reviewers for the first tier are dispatched and their findings are triaged.
2. If any findings are accepted for fixing, fix agents are dispatched and the **same tier** is re-reviewed after fixes are merged.
3. Once all findings from a tier are dismissed (or there were none), the next tier begins.
4. This continues until all tiers have passed, at which point the pipeline proceeds to commit.

`ReviewCycle.tier` records which tier each review cycle belongs to (`src/types.ts:210`), so the review history artifact clearly shows which checks were part of which tier.

On completion, the review stage:
1. Saves the review history as a JSON artifact
2. Updates `context.md` to record the completed work, any architectural changes, and any accepted-but-deferred findings
3. Asks the user for a commit strategy and executes it

### User decisions

- Reviewer selection (multi-select; or first-tier reviewers are auto-populated from `review_tiers` config)
- Finding triage: accept (dispatch for fixing) or dismiss (false positive or intentional) — each finding is decided individually
- Whether to run another review cycle (non-tiered) or advance to the next tier (tiered), or proceed to commit
- Commit strategy: one squash commit, one commit per batch, one commit per task, or custom grouping

### Artifacts

`reviews/YYYY-MM-DD-<slug>-review-N.json`

Where `N` increments for each review cycle within the same pipeline (e.g., `review-1.json`, `review-2.json`). The review JSON contains all findings, their triage decisions, and the `tier` field when tiered review was used.

An updated `context.md` is also produced, recording what was built, any architectural changes, and any deferred findings under Known Issues.

### Resume behavior

If interrupted before reviewers are dispatched, invoke-review resumes at reviewer selection (or at the current tier when using `review_tiers`).

---

## Session Recovery

### How invoke-resume works

`invoke-resume` is triggered when the user returns to a project with an active pipeline — either by asking to continue, or when the session-start hook detects an active session.

**Step 1 — List sessions.** `invoke_list_sessions` enumerates all sessions under `.invoke/sessions/`. Each session entry includes its ID, current stage, start and last-updated timestamps, and status: `active`, `stale` (no activity for longer than `stale_session_days`, defaulting to 7), or `complete` (`src/session/manager.ts:33-48`, `src/types.ts:217-225`). If more than one session exists, the user selects which one to resume.

> **Legacy migration.** If a pre-sessions-directory `state.json` exists at `.invoke/state.json`, it is automatically moved to `.invoke/sessions/<pipeline_id>/state.json` before listing (`src/session/manager.ts:56-96`). The accompanying `metrics.json` is migrated to the same session directory.

**Step 2 — Read state.** `invoke_get_state` loads the full pipeline state for the selected session from `.invoke/sessions/<session_id>/state.json` (`src/session/manager.ts:112-114`). State includes current stage, artifact paths, work branch, strategy, and per-batch task records.

**Step 3 — Present task-level progress.** The status summary shows pipeline metadata (ID, start date, last active timestamp) plus a per-batch breakdown listing every task and its status (completed, merged, error with summary, or pending). If the last activity was more than 24 hours ago the timestamp is highlighted.

**Step 4 — Discover orphaned worktrees.** `invoke_cleanup_worktrees` runs in discovery mode to find any worktrees left over from the interrupted session. If found, the user is offered three options: keep and merge whatever was completed, discard all worktrees and restart affected tasks, or inspect each worktree's git status and log individually before deciding.

**Step 5 — Offer actions.** The user chooses one of:
- **Continue** — load the appropriate stage skill and pick up exactly where the pipeline left off (see per-stage resume behavior above)
- **Redo current stage** — reset state for the current stage while keeping all prior stage outputs, then re-trigger the stage skill
- **Abort** — clean up all worktrees, reset pipeline state, and start fresh

The granularity of recovery matches the granularity of state tracking: build recovery operates at the individual task level within a batch, so only genuinely incomplete work is re-run.
