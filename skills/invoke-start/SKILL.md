---
name: invoke-start
description: "Use when starting any conversation in a project that has invoke installed. Establishes how to find and use invoke skills, requiring invoke skill invocation before ANY response including clarifying questions. This skill MUST fire before any other skill."
---

# Invoke — Skill Router

You are in a project with the invoke pipeline installed. Invoke orchestrates development work through a structured pipeline: scope, plan, orchestrate, build, review. All development work MUST go through invoke skills.

## On Every Message

Before responding to any user message — including clarifying questions — check if an invoke skill applies. If the user's message clearly involves development work (writing or modifying code), invoke the matching skill. If the message looks like a normal human request, invoke the matching skill — do not skip routing unless dispatched-agent signals are clearly present.

## Dispatched Agent Detection

When this skill loads inside a dispatched agent (researcher, builder, planner, reviewer), the agent's task prompt is the first user message. These prompts carry recognizable structural signals. Only skip skill routing when one or more of the following positive signals are clearly present:

- The message contains structured fields like `task_description`, `acceptance_criteria`, or `relevant_files`
- The message begins with an explicit role prefix such as "You are analyzing...", "Research how...", or "Implement the following..."
- The message has no conversational tone, no greeting, and reads like a machine-injected spec or brief rather than a human request

If none of these signals are clearly present, treat the message as a human request and invoke the matching skill.

## Skill Routing

Match the user's intent to the correct invoke skill:

| User Intent | Skill | Examples |
|---|---|---|
| Start new development work | `invoke-scope` | "build X", "implement Y", "create a feature", "add functionality", "develop Z", "I need to build..." |
| Resume previous pipeline | `invoke-resume` | "continue", "resume", "where was I", "pick up where I left off" |
| Manage pipeline config | `invoke-manage` | "add a reviewer", "create a role", "edit strategy", "configure pipeline", "list roles" |
| Any development/implementation task | `invoke-scope` | Any request that involves writing code, building features, fixing complex bugs, or adding functionality |
| Questions about how invoke works | No skill | "how does the build stage work?", "what does invoke-scope do?" |

## Priority Rules

1. **Invoke skills ALWAYS take priority** over generic planning, brainstorming, or implementation approaches
2. **Never start implementation work** (writing code, scaffolding, designing architecture) without going through the invoke pipeline
3. **Never use generic planning tools** (EnterPlanMode, brainstorming skills from other plugins) for development work — use `invoke-scope` instead
4. If the user asks to "build", "implement", "create", "develop", or "add" anything — that is `invoke-scope`
5. If a session-start hook reports an active pipeline — that is `invoke-resume`

## Red Flags

These thoughts mean STOP — you are about to bypass invoke:

| Thought | Correct Action |
|---|---|
| "Let me just scaffold this quickly" | Use `invoke-scope` |
| "This is simple enough to do directly" | Use `invoke-scope` — invoke handles simple and complex work |
| "Let me plan this out first" | Use `invoke-scope` — it handles scoping and planning |
| "I'll enter plan mode" | Use `invoke-scope` instead |
| "Let me brainstorm approaches" | Use `invoke-scope` — it dispatches researchers for this |
| "I can explore the codebase and start coding" | Use `invoke-scope` first |
| "The user just wants a quick change" | If it involves writing code, use `invoke-scope` |
| "I'll fix this directly, it's faster" | Dispatch builder agents — never write code directly in the session |
| "Let me make these fixes quickly" | Dispatch builder agents via the pipeline — direct edits bypass state tracking |

## What Invoke Does NOT Handle

These are fine to do without invoke:

- Answering questions about the codebase (read-only exploration)
- Explaining how something works
- Running commands the user asks for (tests, builds, etc.)
- Git operations (commits, branches, PRs)
- Managing invoke configuration (use `invoke-manage` for this)
- Conversations that don't involve writing or modifying code

## Flow

1. Read the user's message
2. Check: does this appear to be a dispatched agent prompt (see Dispatched Agent Detection above)?
   - **Yes** → skip skill routing and execute the task directly
   - **No** → continue
3. Check: is there an active pipeline that should be resumed?
   - **Yes** → invoke `invoke-resume`
   - **No** → continue
4. Check: does this involve development work (writing/modifying code)?
   - **Yes** → invoke the matching invoke skill before responding
   - **No** → respond normally
