# Invoke Pipeline

This project uses **invoke** for AI-assisted development. Invoke skills are installed in `.claude/skills/` and an MCP server is registered in `.mcp.json`.

## Required Behavior

**You MUST use invoke skills for all pipeline operations.** Do not manually perform actions that an invoke skill handles.

- **Creating/editing/removing roles, reviewers, strategies, agents** → use `invoke-manage` skill
- **Starting new development work** → use `invoke-scope` skill
- **Creating implementation plans** → use `invoke-plan` skill
- **Breaking plans into tasks** → use `invoke-orchestrate` skill
- **Dispatching build agents** → use `invoke-build` skill
- **Running code reviews** → use `invoke-review` skill
- **Resuming an active pipeline** → use `invoke-resume` skill

Never manually edit `.invoke/pipeline.yaml`, `.invoke/roles/`, or `.invoke/strategies/` — always use the invoke-manage skill which calls the proper MCP tools with validation.

## MCP Tools

The invoke MCP server provides tools prefixed with `invoke_` (e.g., `invoke_dispatch`, `invoke_get_config`, `invoke_update_config`). Skills call these tools — do not call them directly outside of skill instructions.

## Messaging

Follow `invoke-messaging` standards for all user-facing output related to the pipeline.
