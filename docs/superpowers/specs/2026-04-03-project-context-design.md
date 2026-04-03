# Project Context System

**Date:** 2026-04-03
**Status:** Draft

## Goal

Give invoke a living document (`.invoke/context.md`) that accumulates project knowledge across pipelines, so researchers and planners start with context rather than re-discovering the codebase from scratch.

## Problem

Every invoke pipeline starts with researchers analyzing the codebase. On a large or growing project, this means:

- Re-discovering architecture that was already understood in a previous pipeline
- No memory of what invoke built before (previous specs, plans, decisions)
- No awareness of project goals, conventions, or constraints the user established
- Researchers waste time and tokens on context that could be carried forward

## Requirements

### Living document at `.invoke/context.md`

A structured markdown file that persists across pipelines:

| Section | Updated when | Content |
|---|---|---|
| **Project overview** | Initialization, user edits | Purpose, audience, key technologies |
| **Architecture** | After each build cycle | High-level structure, key components, data flow |
| **Conventions** | User edits, research findings | Coding standards, naming patterns, conventions |
| **Completed work** | After each pipeline completes | Summary of what invoke built, links to specs/plans |
| **Active decisions** | During scoping/planning | Architectural decisions, trade-offs chosen and why |
| **Known issues** | After review cycles | Deferred findings, tech debt acknowledged |

### Interactive initialization

When `invoke-scope` runs on a project with no `context.md`:

1. **Detect project type** — Check if the project is greenfield (empty/minimal) or existing (has code)
2. **For existing projects: dispatch codebase researcher** — Analyzes project structure, tech stack, file organization, patterns, dependencies
3. **Interactive discussion** — Using research findings as a starting point, ask the user targeted questions one at a time:
   - What's the project's purpose and who's it for?
   - Any conventions or constraints the research didn't capture?
   - Near-term goals or priorities?
   - The research makes questions smarter — instead of "what tech stack?" (already known), ask "the codebase uses Express + TypeScript — any conventions around error handling I should know about?"
4. **For greenfield projects** — Skip the research dispatch, go straight to interactive questions about the project's goals and planned architecture
5. **Generate context.md** — Combine research + user answers into the initial document
6. **User reviews** — Present the draft, let them edit before saving

### Auto-update after pipelines

When a pipeline completes (review stage → complete):

- Append to "Completed work": one-line summary + link to the spec
- Update "Architecture" if the build changed project structure (new directories, new components)
- Move accepted review findings that were deferred to "Known issues"

### Researcher context injection

When researchers/planners are dispatched, `context.md` content is included in their prompt so they don't re-discover known information. This is done via the prompt composer, not by the skills manually.

### User-editable

It's a plain markdown file in the repo. Users can edit it directly to correct, add, or remove information. Invoke respects manual edits and only appends/updates specific sections programmatically.

## Architecture

### New module: `src/tools/context.ts`

`ContextManager` class:

- `get(): Promise<string | null>` — Read `context.md`, return null if missing
- `exists(): boolean` — Check if context.md exists
- `initialize(content: string): Promise<void>` — Write initial context.md
- `updateSection(section: string, content: string, mode: 'replace' | 'append'): Promise<void>` — Update a specific section by heading match

### New MCP tools: `src/tools/context-tools.ts`

- `invoke_get_context` — Read the current context document (or null)
- `invoke_update_context` — Update a specific section (section name, content, mode: replace/append)
- `invoke_init_context` — Write the initial context.md (used during interactive initialization)

### Prompt composer integration

Modify `src/dispatch/prompt-composer.ts`:

- Read `.invoke/context.md` if it exists
- Make it available as `{{project_context}}` template variable
- Role prompts can include `{{project_context}}` to receive project knowledge

### Default template

`defaults/context-template.md` — skeleton used when generating context.md for the first time. Has section headings with brief instructions on what goes in each.

### Skill changes

`skills/invoke-scope/SKILL.md`:
- Before dispatching researchers, check if context.md exists
- If not: run the interactive initialization flow (detect greenfield vs existing, dispatch researcher if existing, interactive questions, generate, user review)
- If yes: include context.md content when dispatching researchers

`skills/invoke-review/SKILL.md`:
- After pipeline completes, call `invoke_update_context` to append completed work summary and update architecture/known issues sections

### File changes

| File | Change |
|---|---|
| `src/tools/context.ts` | New — ContextManager class |
| `src/tools/context-tools.ts` | New — MCP tools |
| `src/dispatch/prompt-composer.ts` | Read context.md, inject as template variable |
| `src/index.ts` | Initialize ContextManager, register tools |
| `skills/invoke-scope/SKILL.md` | Interactive initialization flow |
| `skills/invoke-review/SKILL.md` | Auto-update after pipeline completes |
| `defaults/context-template.md` | New — skeleton template |
| `tests/tools/context.test.ts` | New — tests |

## Constraints

- `context.md` is a plain markdown file — no special format that breaks if hand-edited
- Section updates match by heading text (`## Architecture`, etc.) — robust to minor formatting differences
- Context injection into prompts should be size-aware — if context.md exceeds 4000 characters, truncate to the first 4000 characters with a note "(truncated)" to avoid blowing agent context windows
- Auto-updates are additive/append-only for "Completed work" and "Known issues" — never delete user content

## Acceptance criteria

- [ ] `invoke_get_context` returns context.md content or null
- [ ] `invoke_update_context` updates a specific section by heading
- [ ] `invoke_init_context` writes the initial file
- [ ] Prompt composer injects context.md as `{{project_context}}`
- [ ] invoke-scope triggers interactive initialization when context.md is missing
- [ ] Existing codebase initialization dispatches researcher first, then asks targeted questions
- [ ] Greenfield initialization skips research and goes straight to questions
- [ ] invoke-review appends completed work summary after pipeline finishes
- [ ] context.md is a readable, hand-editable markdown file
- [ ] Large context.md is truncated before injection into agent prompts
- [ ] All existing tests pass

## Out of scope

- Auto-summarization of context.md when it grows too large (manual editing for now)
- Per-pipeline context snapshots (single living document)
- Context.md merge conflict resolution (standard git workflow)
