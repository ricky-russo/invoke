# Troubleshooting

This guide covers common problems and their solutions, drawn from real issues encountered running invoke pipelines.

---

## Validation warnings at startup

Invoke validates `pipeline.yaml` at startup and prints any issues before pipeline work begins. Warnings do not necessarily stop execution, but errors do.

To see the full validation report at any time without running a pipeline, call `invoke_validate_config`.

### Model format errors

The most common validation warning is a model name that does not match the expected format for its provider.

Example warning:

```
[WARNING] roles.reviewer.security.providers[0].model: Model 'opus-4.6' is not a recognized claude model format. Did you mean 'claude-opus-4-6'?
```

Claude model names follow the pattern `claude-<family>-<version>`, using hyphens throughout. Short aliases `opus`, `sonnet`, and `haiku` are also accepted. Common mistakes:

| Incorrect | Correct |
|---|---|
| `opus-4.6` | `claude-opus-4-6` or `opus` |
| `sonnet-4.6` | `claude-sonnet-4-6` or `sonnet` |
| `haiku-4.5` | `claude-haiku-4-5-20251001` or `haiku` |

Codex model names follow the pattern `o<digit>` (e.g., `o3`, `o4-mini`) or `gpt-<version>` (e.g., `gpt-4o`). The validator will suggest corrections where it recognizes the mistake.

### Provider mode warnings

When a role entry lists more than one provider but does not set `provider_mode`, invoke issues a warning because the behavior — fanning out to all providers simultaneously — may be unintentional.

Example warning:

```
[WARNING] roles.reviewer.security.provider_mode: Role 'reviewer.security' has multiple providers and no explicit provider_mode.
Set provider_mode to 'parallel', 'fallback', or 'single' to avoid implicit parallel fan-out.
```

Fix by adding `provider_mode` to the role entry in `pipeline.yaml`:

```yaml
roles:
  reviewer:
    security:
      prompt: .invoke/roles/reviewer/security.md
      provider_mode: parallel   # or: fallback, single
      providers:
        - provider: claude
          model: claude-opus-4-6
        - provider: codex
          model: o3
```

The three modes:

- `parallel` — all providers run at the same time; results are merged when all complete.
- `fallback` — providers are tried in order; the next is used only if the previous one errors.
- `single` — only the first provider entry is used; the rest are ignored.

If no `provider_mode` is set, invoke defaults to `parallel`.

### Missing CLIs

If a provider's `cli` binary is not found on `PATH`, invoke reports an error:

```
[ERROR] providers.gemini.cli: CLI 'gemini' not found on PATH. Install 'gemini' or update the provider config.
```

Install the missing CLI or remove the provider from `pipeline.yaml` if it is no longer needed. Any role entries that reference the missing provider will also fail validation.

### Missing prompt files

If a role's `prompt` path does not point to an existing file:

```
[ERROR] roles.reviewer.documentation.prompt: Prompt file '.invoke/roles/reviewer/documentation.md' not found.
```

Create the missing file or correct the path in `pipeline.yaml`. Invoke will not dispatch an agent whose prompt file is absent.

---

## Agent timeouts

### Default timeout

The global default timeout is 300 seconds (5 minutes), set via `settings.agent_timeout` in `pipeline.yaml`. This applies to every agent that does not define its own `timeout` field.

### Per-role overrides

Long-running agents — particularly research and planning roles that read broadly across a codebase — often need more time. Override the timeout per provider entry:

```yaml
roles:
  researcher:
    codebase:
      prompt: .invoke/roles/researcher/codebase.md
      providers:
        - provider: claude
          model: claude-opus-4-6
          effort: high
          timeout: 600   # 10 minutes for large codebases
```

A timeout of 600 seconds is a reasonable starting point for research and planning agents. Builder agents working on a single well-scoped task typically fit within the 300-second default.

### Timeouts are in seconds, not milliseconds

Values are in seconds. If you enter a millisecond value by mistake, the validator will warn you:

```
[WARNING] roles.builder.default.providers[0].timeout: Timeout 300000 seems too large — values are in seconds, not milliseconds. Did you mean 300 seconds?
```

The validator issues this warning for any timeout value greater than 3600 (one hour).

---

## Merge conflicts

### Parallel worktrees modifying lockfiles

When invoke runs multiple builder tasks in parallel, each task operates in its own git worktree on a separate branch. If tasks in the same batch both install packages — for example, one adds a Composer dependency and another adds an npm package — their respective lockfiles (`composer.lock`, `package-lock.json`) will both change. When invoke merges the worktrees back into the work branch sequentially, the second merge will conflict with the first.

The solution is to use `post_merge_commands` in `pipeline.yaml` to regenerate lockfiles after each merge rather than relying on the contents committed by individual tasks:

```yaml
settings:
  post_merge_commands:
    - composer install
    - npm install
```

Each command runs in the project root after a worktree is merged. Invoke executes them sequentially and surfaces any errors, but continues merging remaining worktrees.

### Commit history

Invoke uses squash merge when merging worktrees into the work branch. This keeps the work branch history clean — each task produces one commit regardless of how many commits the agent made inside its worktree.

---

## Session recovery

### How state is persisted

Invoke writes all pipeline progress to `.invoke/sessions/{session_id}/state.json` after every state change. This file records the pipeline ID, current stage, spec and plan filenames, and the status of every batch and individual task. Each session has its own directory under `.invoke/sessions/`.

If a session is interrupted — the terminal closes, the machine sleeps, or an agent crashes — no work is lost. The state file reflects exactly where the pipeline stopped.

Projects that were created before per-session directories were introduced have a legacy `.invoke/state.json`. On first access, invoke automatically migrates this file into the sessions directory structure.

### Listing and selecting sessions

Call `invoke_list_sessions` to see all sessions for the current project. Each entry shows the session ID, pipeline ID, current stage, and a status:

- `active` — the pipeline is in progress and was updated recently.
- `complete` — the pipeline finished successfully.
- `stale` — the pipeline has not been updated in more than `stale_session_days` days (default: 7). Stale sessions are likely abandoned.

When multiple sessions exist, invoke prompts you to select which one to resume.

To remove sessions that are no longer needed, call `invoke_cleanup_sessions`. You can target completed sessions, stale sessions, or a specific session ID.

The staleness threshold is controlled by `settings.stale_session_days` in `pipeline.yaml` (default: 7 days).

### Resuming a pipeline

When you open a new Claude Code session in a project with an active pipeline, the session-start hook detects the sessions directory and surfaces a notice. The `invoke-resume` skill then takes over.

On resume, invoke presents the current state:

- Pipeline ID and timestamps
- Current stage
- Per-batch progress showing which tasks completed, which errored, and which are still pending

You are then given three options: continue from where you left off, redo the current stage from scratch, or abort and clean up.

When continuing the build stage, invoke re-dispatches only the tasks that did not complete — already-completed tasks are skipped.

### Orphaned worktrees

If a session ended while builder agents were running, their git worktrees may still exist on disk. These are called orphaned worktrees.

Worktrees that invoke is aware of (tracked in session state) can be cleaned up with `invoke_cleanup_worktrees`. Untracked orphaned worktrees — those invoke has no record of — must be discovered manually:

```
git worktree list
```

Any worktree with a path under your `work_branch_prefix` (default: `invoke/work`) that is not currently running is a candidate for cleanup. Remove them with `git worktree remove <path>` after verifying their contents.

---

## Metrics and cost tracking

### Where metrics are stored

Invoke records a metric entry for each agent dispatch. These are written to `.invoke/sessions/{session_id}/metrics.json` — one file per session, updated after each dispatch.

### Viewing metrics

Call `invoke_get_metrics` to get a summary of the current session's dispatches. The summary includes:

- `total_dispatches` — number of agents invoked.
- `total_duration_ms` — cumulative wall-clock time across all dispatches.
- `total_estimated_cost_usd` — estimated spend for the session.
- `by_stage` — breakdown of the above fields per pipeline stage.
- `by_provider_model` — breakdown per provider/model pair (e.g., `claude:claude-opus-4-6`).

### Cost estimates

Cost figures are approximations. Invoke estimates token counts from character counts using a fixed ratio: 4 characters per token for prose content, 3 characters per token for code. Actual billing depends on the provider's tokenizer and may differ.

### Comparing sessions

Call `invoke_compare_sessions` to place two sessions side by side. The output is a table of dispatches, success rate, duration, prompt size, and estimated cost, with a delta row showing the difference between sessions. This is useful for comparing the cost or speed of different model configurations against the same task.

---

## Plugin not activating

### Check settings.local.json

Invoke is a Claude Code plugin. For it to activate, it must be listed in `.claude/settings.local.json` in your project. Verify that the file exists and contains an entry for invoke. If you installed via the marketplace, this should have been added automatically.

### Session-start hook must use .cjs extension

Claude Code loads hooks from the `hooks.json` file. The session-start hook script must use the `.cjs` extension, not `.js`. This is because Claude Code's Node.js environment uses CommonJS module loading for hooks, and a `.js` file in a project with `"type": "module"` in `package.json` will be treated as ESM and fail to load.

The correct entry in `hooks.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.cjs\"",
            "async": false
          }
        ]
      }
    ]
  }
}
```

If the file is named `session-start.js`, rename it to `session-start.cjs` and update the command path.

### Stale plugin cache

Claude Code caches plugin content. If you recently updated invoke, the cached version may still be active. Reinstalling the plugin forces a cache refresh. Remove the plugin entry from your settings and re-add it, or use the marketplace reinstall option if available.

### Competing plugins intercepting first

If another plugin — such as a superpowers plugin — is also configured with a session-start hook, it may intercept messages before invoke has a chance to respond. Check whether another plugin's routing rules overlap with invoke's triggers. Invoke's session-start hook injects its skill content as `additionalContext`; if another plugin is overriding or suppressing that context, invoke will not activate correctly.

---

## AskUserQuestion errors

### Minimum 2 options required

The `AskUserQuestion` tool requires at least two options to display a selection UI. If invoke constructs a question with only one option — for example, when only one researcher is configured — it will encounter an error rather than showing the prompt.

When this happens, invoke detects the single-option case and auto-selects the only available option instead of presenting the UI. No user input is required and the pipeline continues automatically.

If you see this error in a context where auto-selection is not expected, check whether a role group has been configured with only one entry. Adding a second option or removing the selection step for single-entry groups will resolve it.
