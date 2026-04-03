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

Claude model names follow the pattern `claude-<family>-<version>`, using hyphens throughout. Common mistakes:

| Incorrect | Correct |
|---|---|
| `opus-4.6` | `claude-opus-4-6` |
| `sonnet-4.6` | `claude-sonnet-4-6` |
| `haiku-4.5` | `claude-haiku-4-5-20251001` |

Codex model names follow the pattern `o<number>` or `gpt-<version>`. The validator will suggest corrections where it recognizes the mistake.

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

Invoke writes all pipeline progress to `.invoke/state.json` after every state change. This file records the pipeline ID, current stage, spec and plan filenames, and the status of every batch and individual task.

If a session is interrupted — the terminal closes, the machine sleeps, or an agent crashes — no work is lost. The state file reflects exactly where the pipeline stopped.

### Resuming a pipeline

When you open a new Claude Code session in a project with an active pipeline, the session-start hook detects `.invoke/state.json` and surfaces a notice. The `invoke-resume` skill then takes over.

On resume, invoke presents the current state:

- Pipeline ID and timestamps
- Current stage
- Per-batch progress showing which tasks completed, which errored, and which are still pending

You are then given three options: continue from where you left off, redo the current stage from scratch, or abort and clean up.

When continuing the build stage, invoke re-dispatches only the tasks that did not complete — already-completed tasks are skipped.

### Orphaned worktrees

If a session ended while builder agents were running, their git worktrees may still exist on disk. These are called orphaned worktrees. On resume, invoke checks for them and offers to keep and merge whatever was completed, discard them entirely, or inspect each one individually before deciding.

You can also discover orphaned worktrees manually:

```
git worktree list
```

Any worktree with a path under your `work_branch_prefix` (default: `invoke/work`) that is not currently running is a candidate for cleanup.

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
