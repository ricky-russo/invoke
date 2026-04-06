---
name: invoke-manage
description: "MUST USE when creating, editing, removing, or listing invoke roles, reviewers, researchers, builders, planners, strategies, sub-roles, or agents, or when cleaning up sessions. Triggers on: 'create a reviewer', 'add a new agent', 'new sub-role', 'remove reviewer', 'edit strategy', 'list roles', 'configure pipeline', 'add provider', 'clean up old sessions', 'remove stale pipelines', 'delete completed sessions'. Always use this skill instead of manually editing .invoke/ files."
---

# Invoke — Manage Configuration

You are managing invoke pipeline configuration. You help users create, edit, and remove roles, strategies, and other pipeline settings through conversation.

## Messaging

**BEFORE doing anything else**, invoke the `invoke-messaging` skill using the Skill tool (`Skill({ skill: "invoke:invoke-messaging" })`). This loads the messaging format standards you MUST follow for all output. Do NOT proceed with any operations until invoke-messaging is loaded. Use `AskUserQuestion` for all user decisions.

## Operations

### List

When the user wants to see what's configured:
1. Call `invoke_get_config`
2. Present a formatted summary:
   - Providers and their CLI commands
   - Roles grouped by type (researcher, planner, builder, reviewer) with providers/models/effort
   - Strategies
   - Current settings

### List Strategies

When the user wants to see all configured strategies:
1. Call `invoke_get_config`
2. Present a formatted table of all strategy names and their prompt file paths:

```
| Strategy | Prompt File |
|----------|-------------|
| [name]   | [path]      |
```

### Create Role

When the user wants to add a new role (e.g., "create a reviewer for PSR compliance"):

1. **Identify role type and name**: Determine the role type (researcher, planner, builder, reviewer) and a proposed name (e.g., `psr-compliance`). Confirm with the user:

```
AskUserQuestion({
  questions: [{
    question: "I'll create a reviewer named `psr-compliance`. How would you like to proceed?",
    header: "Create Role",
    multiSelect: false,
    options: [
      { label: "Create role", description: "Proceed with reviewer/psr-compliance" },
      { label: "Edit details", description: "Change the name, type, or other details" },
      { label: "Cancel", description: "Do not create this role" }
    ]
  }]
})
```

2. **Ask about focus**: "What should this reviewer focus on? What specific standards or rules?" Ask one question at a time to understand:
   - What to check for
   - What severity levels to use
   - Any specific files or patterns to focus on
   - Output format requirements (must use the standard Finding format for reviewers)

3. **Choose providers**: "Which provider(s) and model(s) should run this?"
   - Present available providers from config
   - Allow multiple providers for cross-validation (e.g., run on both Claude and Codex)
   - Suggest a default based on the role type

4. **Generate and preview prompt**: Create the `.md` prompt file based on the conversation. For reviewers, ensure the output format section uses the standard Finding format. **Print the full prompt as text output first** so the user can read it. THEN, in a separate message, ask for approval using `AskUserQuestion` before saving. Do NOT combine the preview and the approval prompt.

5. **Save**:
   - Write the prompt file: `invoke_save_artifact` with `stage: "roles/<type>"`, `filename: "<name>.md"`
   - Register in config: `invoke_update_config` with `operation: "add_role"`

   > **Role prompt artifact paths:** Role prompt files are stored using `invoke_save_artifact` with `stage: "roles/<type>"` where `<type>` is the role type (researcher, planner, builder, reviewer). For example, a security reviewer prompt is saved with `stage: "roles/reviewer"`, `filename: "security.md"`.

6. **Confirm**: "Added reviewer/psr-compliance. It'll appear in your reviewer list next review cycle."

### Edit Role

When the user wants to modify an existing role:

1. Read the current prompt file using `invoke_read_artifact` with `stage: "roles/<type>"`, `filename: "<name>.md"`
2. Present the current content
3. Discuss changes with the user
4. Update the prompt file using `invoke_save_artifact` (overwrites existing)
5. If providers/model/effort changed, use `invoke_update_config` with `remove_role` then `add_role`. After calling `invoke_update_config` with `add_role` to re-create the role, verify the role was added by re-reading the config with `invoke_get_config`. Only confirm success to the user after verification. If the re-add fails, inform the user the role was removed but could not be re-created, and offer to retry.

### Delete Role

When the user wants to remove a role:

1. Confirm with the user:

```
AskUserQuestion({
  questions: [{
    question: "Delete reviewer/[name]? This will remove the prompt file and config entry.",
    header: "Delete Role",
    multiSelect: false,
    options: [
      { label: "Delete", description: "Permanently remove this role" },
      { label: "Cancel", description: "Keep the role" }
    ]
  }]
})
```

2. Remove config entry: `invoke_update_config` with `operation: "remove_role"`
3. Remove prompt file: `invoke_delete_artifact` with `stage: "roles/<type>"`, `filename: "<name>.md"`

### Create Strategy

Same flow as Create Role but for strategies:
1. Ask what the strategy should enforce
2. Generate the prompt template with standard `{{variables}}`: `{{task_description}}`, `{{acceptance_criteria}}`, `{{relevant_files}}`, `{{interfaces}}`
3. Preview with user
4. Save prompt: `invoke_save_artifact` with `stage: "strategies"`, `filename: "<name>.md"`
5. Register: `invoke_update_config` with `operation: "add_strategy"`

### Edit Strategy

When the user wants to modify an existing strategy:

1. Read the current strategy file using `invoke_read_artifact` with `stage: "strategies"`, `filename: "<name>.md"`
2. Present the current content to the user
3. Ask what they want to change:

```
AskUserQuestion({
  questions: [{
    question: "What would you like to change about this strategy?",
    header: "Edit Strategy",
    multiSelect: false,
    options: [
      { label: "Edit focus/instructions", description: "Change what the strategy enforces" },
      { label: "Edit variables/template", description: "Change the template variables or structure" },
      { label: "Replace entirely", description: "Start fresh with a new prompt" },
      { label: "Cancel", description: "Keep the strategy as-is" }
    ]
  }]
})
```

4. Apply the requested edits
5. Preview the updated content with the user before saving
6. Save via `invoke_save_artifact` with `stage: "strategies"`, `filename: "<name>.md"` (overwrites existing)
7. Confirm: "Strategy [name] updated."

### Delete Strategy

When the user wants to remove a strategy:

1. Confirm with the user:

```
AskUserQuestion({
  questions: [{
    question: "Delete strategy/[name]? This will remove the prompt file and config entry.",
    header: "Delete Strategy",
    multiSelect: false,
    options: [
      { label: "Delete", description: "Permanently remove this strategy" },
      { label: "Cancel", description: "Keep the strategy" }
    ]
  }]
})
```

2. Remove config entry: `invoke_update_config` with `operation: "remove_strategy"`
3. Remove prompt file: `invoke_delete_artifact` with `stage: "strategies"`, `filename: "<name>.md"`

### Manage Presets

> **Note:** Preset definitions (the preset objects themselves) are declared in `pipeline.yaml` — either as inline entries under `presets:` or as files in `.invoke/presets/`. There is no `add_preset`, `update_preset`, or `remove_preset` operation in `invoke_update_config`. To create or edit a preset definition, the user must edit `pipeline.yaml` or the corresponding preset file directly. The config tool API only supports changing which preset is currently active.

#### List Presets

1. Call `invoke_get_config`
2. If `config.presets` is present, present a formatted list of all preset names and their key settings. Also show the active preset from `config.settings.preset` if set.

#### Set Active Preset

To switch which preset is active:

1. Call `invoke_get_config` to show available presets and the current active preset
2. Confirm the desired preset name with the user using `AskUserQuestion`
3. Apply via `invoke_update_config` with `operation: "update_settings"` and `settings: { preset: "<name>" }`
4. Confirm: "Active preset set to [name]."

#### Create or Edit Preset Definition

Preset definitions cannot be created or modified through the config tool API. When the user wants to define a new preset or change an existing one:

1. Explain that preset definitions live in `pipeline.yaml` (under the `presets:` key) or as separate YAML files in `.invoke/presets/`
2. Offer to help the user edit the relevant file directly

### Cleanup Sessions

When the user wants to clean up old or completed sessions (e.g., 'clean up old sessions', 'remove stale pipelines', 'delete completed sessions'):

1. Call `invoke_list_sessions` to get all sessions.
2. Filter to sessions matching the cleanup criteria (status: `complete`, `stale`, or all inactive per user choice). If the user did not specify, ask via `AskUserQuestion`:
   ```
   AskUserQuestion({
     questions: [{
       question: 'Which sessions should I clean up?',
       header: 'Cleanup scope',
       multiSelect: false,
       options: [
         { label: 'Complete only', description: 'Sessions whose pipeline reached the complete stage' },
         { label: 'Stale only', description: 'Sessions that were abandoned or never finished' },
         { label: 'All inactive', description: 'Both complete and stale sessions' }
       ]
     }]
   })
   ```
3. For each session that matched the filter:
   a. Call `invoke_get_state({ session_id: <session.session_id> })` to read that session's state.
   b. Check the response for `state.work_branch`.
   c. If `state.work_branch` is set, ask the user via `AskUserQuestion`:
      ```
      AskUserQuestion({
        questions: [{
          question: 'Session [session_id] has work branch [state.work_branch]. Keep the branch?',
          header: 'Keep branch',
          multiSelect: false,
          options: [
            { label: 'Keep (Recommended)', description: 'Remove the worktree but preserve the branch' },
            { label: 'Delete', description: 'Remove both the worktree and the branch (git branch -D)' }
          ]
        }]
      })
      ```
      Then call `invoke_cleanup_sessions({ session_id: <id>, delete_work_branch: <true|false> })` based on the answer. The tool returns `{ cleaned, warnings }`; if `warnings` is non-empty, tell the user branch cleanup was skipped and include the warning message.
   d. If `state.work_branch` is NOT set (legacy session), call `invoke_cleanup_sessions({ session_id: <id> })` without the `delete_work_branch` flag. This also returns `{ cleaned, warnings }`; surface any warning messages.
4. Report the cleaned sessions back to the user. If any cleanup call returned warnings, include them in the report.

### Edit Settings

When the user wants to change settings:
1. Call `invoke_get_config` to show current settings
2. Discuss changes
3. Apply: `invoke_update_config` with `operation: "update_settings"`
4. Confirm the change

## Key Principles

- Always confirm before making changes
- Preview generated prompts before saving
- Reviewer prompts must include the standard Finding output format
- Multi-provider configs are supported — ask if the user wants cross-validation
- Keep the user in control — never auto-generate without review
