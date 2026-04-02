# Invoke Pipeline

This project uses **invoke** for ALL development work. Invoke skills are installed in `.claude/skills/` and an MCP server is registered in `.mcp.json`.

## HARD RULES — READ BEFORE DOING ANYTHING

1. **NEVER start development work, planning, research, or code review without first loading the appropriate invoke skill.** This is not optional.
2. **NEVER explore the codebase yourself to gather context.** Invoke dispatches researcher agents for this. Use `invoke-scope`.
3. **NEVER write implementation plans yourself.** Invoke dispatches planner agents. Use `invoke-plan`.
4. **NEVER build features directly.** Invoke dispatches builder agents into worktrees. Use `invoke-build`.
5. **NEVER review code yourself.** Invoke dispatches reviewer agents. Use `invoke-review`.
6. **NEVER manually edit `.invoke/` files.** Use `invoke-manage` which validates via MCP.

## When the user asks you to build, implement, plan, develop, create, or fix anything:

**STOP. Load `invoke-scope` FIRST.** Do not explore the codebase. Do not ask clarifying questions. Do not start planning. The invoke-scope skill handles all of this by dispatching researcher agents and guiding a structured scoping conversation.

## Skill → Trigger Mapping

| User says something like... | Load this skill |
|---|---|
| "build X", "implement X", "create X", "add X", "develop X", "fix X" | `invoke-scope` |
| "plan this", "how should we implement", "create a plan" | `invoke-plan` |
| "break this into tasks", "orchestrate" | `invoke-orchestrate` |
| "build it", "start building", "dispatch builders" | `invoke-build` |
| "review the code", "run reviewers" | `invoke-review` |
| "continue", "resume", "where was I" | `invoke-resume` |
| "create a reviewer", "add a role", "edit strategy", "configure" | `invoke-manage` |

## MCP Tools

The invoke MCP server provides tools prefixed with `invoke_` (e.g., `invoke_dispatch`, `invoke_get_config`, `invoke_update_config`). Skills call these tools — do not call them directly outside of skill instructions.

## Messaging

Follow `invoke-messaging` standards for all user-facing output related to the pipeline.
