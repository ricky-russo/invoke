# Troubleshooting

Use this page to diagnose the most common invoke failures after installation: startup validation problems, missing CLIs, worktree conflicts, interrupted sessions, hook denials, and bug-tracking issues. Startup validation is written to `.invoke/validation.json`, session state lives under `.invoke/sessions/`, dispatch metrics live in `.invoke/metrics.json`, and tracked bugs live in `.invoke/bugs.yaml`.

## Installation Issues

### Plugin not loading

- Verify the install shape first: global Claude settings should add the `invoke` marketplace pointing at `ricky-russo/invoke`, and project-local settings should enable `invoke@invoke`. The shipped plugin manifest is named `invoke`, so mismatched marketplace or plugin keys prevent Claude Code from resolving the same package this repository ships.
- If the plugin was added but invoke still does not appear in a new session, reopen Claude Code and complete the first-use approval step. The startup behavior depends on the session-start hook, which injects invoke's routing context into new sessions.
- If the repository has never been initialized, run `invoke-init` once. That CLI creates `.invoke/` and the default pipeline files, and its own output notes that the plugin handles skills, hooks, and runtime registration after initialization.

### Marketplace not recognized

- Compare your Claude settings against the README example exactly. The documented marketplace key is `invoke`, the documented repo is `ricky-russo/invoke`, and the documented project-local enable key is `invoke@invoke`. If any of those identifiers differ, Claude Code is looking for a different package.

### Hooks not firing

- Restore the shipped hook registry before debugging anything deeper. The plugin registers `SessionStart` hooks for sentinel clearing and startup context injection, a `PreToolUse` hook for `Edit|Write|Bash`, and `PostToolUse` hooks for stage-skill activation and post-merge validation. Missing or edited entries in `plugin/hooks/hooks.json` will break those behaviors.
- Keep hook files as `.cjs`. Every shipped hook command points at `.cjs` files, the hook implementations use CommonJS `require(...)`, and this package is marked `"type": "module"`, so renaming hooks to `.js` changes both the configured path and the module-loading mode.

## Provider & CLI Problems

- Invoke checks only providers that are actually referenced by a role, and it tests the configured executable with `which <cli>`. If a CLI works in your login shell but not inside Claude Code, compare the two `PATH` values before changing models or prompts.
- If you see `CLI '<name>' not found on PATH.`, fix the provider's `cli` field or expose that executable on `PATH`. The validator pairs that message with `Install '<name>' or update the provider config.` and emits it at `providers.<provider>.cli`.
- Provider definitions are only `cli` plus `args`, so stale binary names, renamed local wrappers, or hard-coded paths in `.invoke/pipeline.yaml` all surface as CLI failures before dispatch begins.

## Configuration Validation

- On startup, invoke validates `.invoke/pipeline.yaml`, prints warnings to stderr, and writes the full report to `.invoke/validation.json`. The session-start hook reads that file and injects a `PIPELINE CONFIG ISSUES DETECTED:` notice into new sessions when warnings are present.
- Use the exact warning text to decide whether you have a missing file, a bad reference, or an ambiguous multi-provider setup. The validator emits the following real messages from source code.

| Message | Meaning | Fix |
|---|---|---|
| `CLI '<name>' not found on PATH.` | The configured executable is missing from Claude Code's `PATH`. | Install the CLI or change `providers.<name>.cli`. |
| `Default strategy '<name>' not found in strategies.` | `settings.default_strategy` points at a missing key. | Add the strategy or change the default. |
| `Prompt file '<path>' not found.` | A role prompt path does not exist on disk. | Create the file or correct the path. |
| `Provider '<name>' is not defined in providers.` | A role references a provider that is not declared under `providers`. | Fix the spelling or add the provider entry. |
| `Role '<group>.<subrole>' has multiple providers and no explicit provider_mode.` | A multi-provider role is about to fan out without an explicit mode. | Add `provider_mode`. |
| `Set provider_mode to 'parallel', 'fallback', or 'single' to avoid implicit parallel fan-out.` | Companion suggestion for the previous warning. | Pick the intended mode explicitly. |
| `Timeout <n> seems too large — values are in seconds, not milliseconds.` | A timeout looks like milliseconds instead of seconds. | Convert it to seconds. |
| `max_review_cycles must be greater than or equal to 0.` | The review-cycle limit is negative. | Use `0` or a positive integer. |
| `max_dispatches must be greater than or equal to 1.` | The dispatch limit is zero or negative. | Use `1` or a positive integer. |

- Invalid `provider_mode` values do not come from a custom warning string. The config schema only accepts `parallel`, `fallback`, or `single` at both the role level and the global default-provider level, so any other value fails schema parsing before the runtime validator emits warnings.

## Worktree Conflicts

- Each build task gets a temp worktree named `invoke-worktree-<taskId>-<timestamp>` on branch `invoke-wt-<taskId>`. Conflicts are easiest to diagnose when you map the conflicting files back to that task ID.
- Per-task merge is a `git merge --squash` into the merge target. When Git reports file-level conflicts, invoke reads `git status --porcelain`, looks for conflict states `UU`, `AA`, `DD`, `AU`, `UA`, `DU`, or `UD`, resets the target back to `HEAD`, and returns the conflicting file list instead of leaving the merge half-applied.
- The most reliable prevention is batching discipline: the orchestrate guidance says no two tasks in the same parallel batch should create or modify the same file, including implicit overlaps such as lockfiles, package manifests, and shared config files.
- Stale task worktrees can remain after crashes. The live cleanup path only removes worktrees tracked by the current process, while orphan discovery scans `git worktree list --porcelain` for `invoke-wt-` branches that are no longer in the in-memory map. If temp worktrees linger, resume the pipeline and inspect or discard the orphaned task worktrees before redispatching work.

## Session Recovery

- Sessions live under `.invoke/sessions/<session_id>`. Each session stores its own `state.json`, session listing derives `active`, `complete`, or `stale` from `current_stage` and `last_updated`, and the default stale threshold is 7 days unless `settings.stale_session_days` overrides it.
- Legacy installs are migrated forward automatically. If old `.invoke/state.json` or `.invoke/metrics.json` files exist, startup moves them into the matching session directory before normal session handling continues.
- Use `invoke-resume` when a pipeline is interrupted. The resume flow presents session status, reattaches the integration worktree, checks for orphaned task worktrees, and then offers Continue, Redo current stage, or Abort.
- Reattachment is intentionally conservative. If the recorded session worktree still exists, invoke reuses it; if the temp directory vanished but the session branch still exists, invoke prunes stale Git worktree registrations and recreates a fresh `invoke-session-...` worktree; if the branch itself is gone, recovery is `unrecoverable`.
- If resume or a session-scoped command refuses the stored worktree path, that is a safety check, not a generic Git failure. Invoke rejects unsafe temp paths, rejects branch names that do not match the session ID, and rejects worktrees whose current `HEAD` is on the wrong branch.
- If cleanup reports warnings instead of deleting the session branch, read them. Session cleanup deliberately skips destructive branch/worktree deletion when `work_branch` or `work_branch_path` fails its safety checks, but it still removes the session directory.
- If recovery fails immediately with `Session '<id>' does not exist`, the session directory is already gone and there is nothing left to reattach.

## Metrics & Cost Tracking

- Each dispatch records metrics to `.invoke/metrics.json`. Summaries track total dispatches, prompt chars, duration, and estimated cost overall, by stage, and by `provider:model`.
- Session-scoped metrics are bound through the session's `pipeline_id`. If the root metrics store has no entries for that pipeline, invoke falls back to an older session-local `metrics.json` file inside the session directory.
- Estimated cost is recorded per dispatch from prompt length plus output size and stored as `estimated_input_tokens`, `estimated_output_tokens`, and `estimated_cost_usd`.
- To inspect metrics, ask invoke for the current pipeline's metrics summary or a stage-filtered view. The metrics response shape includes raw `entries`, rolled-up `summary`, and current dispatch-limit status in `limits`.
- To compare sessions, ask invoke to compare two or more session IDs. The comparison output is a markdown table with `Session`, `Dispatches`, `Success Rate`, `Duration`, `Prompt Chars`, and `Est. Cost`; when you compare exactly two sessions, invoke adds a `Delta` row.

## Hook Issues

- If you see `Invoke pipeline requires a loaded skill before editing files. Route this work through the appropriate invoke skill (e.g., invoke-scope for new work, invoke-resume to continue).`, the pre-edit hook blocked an `Edit`, `Write`, or `Bash` action because the skill sentinel was not present. The hook denies access both when `.invoke/` does not exist and when `.invoke/.skill-active` is missing.
- The sentinel is only written after one of the stage skills or the resume skill loads: `invoke-scope`, `invoke-plan`, `invoke-orchestrate`, `invoke-build`, `invoke-review`, or `invoke-resume`. If you started with a generic request instead of an invoke skill, the gate stays closed.
- The sentinel is intentionally cleared at session startup, resume, clear, and compact events. Seeing the skill-gate message again in a fresh Claude Code session is normal until one of the stage skills loads.
- If the message appears in a brand-new repository, initialize the repo with `invoke-init` or start through the appropriate invoke skill first so `.invoke/` exists and the stage skill can mark itself active.

## Bug Tracking

- Use `invoke-bugs` for outstanding-bug listing or bug-fix intake. That skill is explicitly routed for requests such as "show bugs", "outstanding bugs", or "fix a bug", it lists open bugs by default, and it can bundle multiple selected bugs into one pipeline.
- Reported bugs are stored in `.invoke/bugs.yaml`. New entries get sequential IDs like `BUG-001`, default to `open` with default severity `medium`, and record optional `file`, `line`, reporting session, resolution, and resolving session.
- To log a bug, ask invoke to log it or use `invoke-bugs`. The bug flow expects a title, description, optional file/line, and a severity of `critical`, `high`, `medium`, or `low`.
- To resolve a bug, finish the fix pipeline and let invoke mark the tracked bug IDs as resolved for that session. The bug manager requires a session ID when moving a bug into `resolved`, so ad hoc manual resolution without session context fails by design.
- Common bug-tracking errors are `Bug '<id>' not found`, `session_id required when resolving a bug`, `No changes specified`, `Invalid bugs.yaml contents: ...`, and `bugs.yaml must not be a symlink`. These all come from the bug manager rather than the pipeline stages.
