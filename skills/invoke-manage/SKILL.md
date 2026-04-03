---
name: invoke-manage
description: "MUST USE when creating, editing, removing, or listing invoke roles, reviewers, researchers, builders, planners, strategies, sub-roles, or agents. Triggers on: 'create a reviewer', 'add a new agent', 'new sub-role', 'remove reviewer', 'edit strategy', 'list roles', 'configure pipeline', 'add provider'. Always use this skill instead of manually editing .invoke/ files."
---

# Invoke — Manage Configuration

You are managing invoke pipeline configuration. You help users create, edit, and remove roles, strategies, and other pipeline settings through conversation.

## Operations

### List

When the user wants to see what's configured:
1. Call `invoke_get_config`
2. Present a formatted summary:
   - Providers and their CLI commands
   - Roles grouped by type (researcher, planner, builder, reviewer) with providers/models/effort
   - Strategies
   - Current settings

### Create Role

When the user wants to add a new role (e.g., "create a reviewer for PSR compliance"):

1. **Identify role type and name**: "This sounds like a reviewer. I'll call it `psr-compliance`. Sound good?"

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

6. **Confirm**: "Added reviewer/psr-compliance. It'll appear in your reviewer list next review cycle."

### Edit Role

When the user wants to modify an existing role:

1. Read the current prompt file using `invoke_read_artifact` with `stage: "roles/<type>"`, `filename: "<name>.md"`
2. Present the current content
3. Discuss changes with the user
4. Update the prompt file using `invoke_save_artifact` (overwrites existing)
5. If providers/model/effort changed, use `invoke_update_config` with `remove_role` then `add_role`

### Delete Role

When the user wants to remove a role:

1. Confirm: "Delete reviewer/[name]? This will remove the prompt file and config entry."
2. Remove config entry: `invoke_update_config` with `operation: "remove_role"`
3. Remove prompt file: `invoke_delete_artifact` with `stage: "roles/<type>"`, `filename: "<name>.md"`

### Create Strategy

Same flow as Create Role but for strategies:
1. Ask what the strategy should enforce
2. Generate the prompt template with standard `{{variables}}`: `{{task_description}}`, `{{acceptance_criteria}}`, `{{relevant_files}}`, `{{interfaces}}`
3. Preview with user
4. Save prompt: `invoke_save_artifact` with `stage: "strategies"`, `filename: "<name>.md"`
5. Register: `invoke_update_config` with `operation: "add_strategy"`

### Delete Strategy

1. Confirm with user
2. Remove config entry: `invoke_update_config` with `operation: "remove_strategy"`
3. Remove prompt file: `invoke_delete_artifact` with `stage: "strategies"`, `filename: "<name>.md"`

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
