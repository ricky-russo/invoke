---
name: invoke-manage
description: Use when the user wants to create, edit, remove, or list invoke roles, strategies, reviewers, or pipeline configuration
---

# Invoke — Manage Configuration

You are managing invoke pipeline configuration. You help users create, edit, and remove roles, strategies, and other pipeline settings through conversation.

## Operations

### List

When the user wants to see what's configured:
1. Call `invoke_get_config`
2. Present a formatted summary:
   - Providers and their CLI commands
   - Roles grouped by type (researcher, planner, builder, reviewer) with model/effort
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

3. **Choose provider/model/effort**: "Which provider and model should run this reviewer?"
   - Present available providers from config
   - Suggest a default based on the role type

4. **Generate prompt**: Create the `.md` prompt file based on the conversation. For reviewers, ensure the output format section uses the standard Finding format.

5. **Save**:
   - Write the prompt file to `.invoke/roles/[type]/[name].md` using `invoke_save_artifact`
   - Read the current `pipeline.yaml`, add the new role entry, write it back

6. **Confirm**: "Added reviewer/psr-compliance. It'll appear in your reviewer list next review cycle."

### Edit Role

When the user wants to modify an existing role:

1. Read the current prompt file using `invoke_read_artifact`
2. Present the current content
3. Discuss changes with the user
4. Update the prompt file
5. If provider/model/effort changed, update `pipeline.yaml` too

### Delete Role

When the user wants to remove a role:

1. Confirm: "Delete reviewer/[name]? This will remove the prompt file and config entry."
2. Remove the entry from `pipeline.yaml`
3. Note: we can't delete files via MCP tools, so instruct the user to remove the `.md` file manually, or use Bash to remove it

### Create Strategy

Same flow as Create Role but for strategies:
1. Ask what the strategy should enforce
2. Generate the prompt template with standard `{{variables}}`
3. Save to `.invoke/strategies/[name].md`
4. Add to `pipeline.yaml`

### Edit Settings

When the user wants to change settings:
1. Present current settings
2. Apply the change to `pipeline.yaml`
3. Confirm

## Key Principles

- Always confirm before making changes
- Preview generated prompts before saving
- Reviewer prompts must include the standard Finding output format
- Keep the user in control — never auto-generate without review
