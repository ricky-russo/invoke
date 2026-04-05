# Project Context

The project context document is invoke's mechanism for accumulating and sharing knowledge about your codebase across pipeline runs. It lives at `.invoke/context.md` and is automatically read by every agent in the pipeline.

---

## What is context.md

`.invoke/context.md` is a living Markdown document that describes your project to AI agents. Instead of each agent spending time re-discovering basic facts — what framework you use, what your naming conventions are, what decisions have already been made — they read this document at the start of every dispatch.

You can edit it freely at any time. Invoke will only modify specific sections automatically; everything else you write is preserved.

---

## How context.md is initialized

The file is created the first time the `invoke-scope` skill runs and no `.invoke/context.md` exists.

### Existing codebases

If your project already has source files, invoke runs the initialization flow before scoping:

1. The `codebase` researcher is dispatched to analyze the project structure, tech stack, patterns, and conventions.
2. Once research completes, invoke asks you targeted questions one at a time, using the research findings to make questions specific. For example, rather than asking "what framework do you use?", it will ask something like "The codebase uses Laravel with repository pattern — are there any conventions around how repositories are injected that I should follow?"
3. Your answers and the research findings are combined into a draft `context.md`.
4. The draft is presented to you for review before anything is saved.
5. On approval, the file is written to `.invoke/context.md`.

### Greenfield projects

If the project is empty or has minimal files, the research dispatch is skipped because there is nothing to analyze. Invoke asks you a short set of questions directly:

- What are you building and who is it for?
- What tech stack are you planning to use?
- Any architectural patterns or conventions you want to follow?
- What are your immediate goals?

A draft `context.md` is generated from your answers, reviewed, and saved.

---

## The seven sections

The context document has seven sections. All sections accept free-form Markdown.

### Purpose

A short description of the project's purpose and its intended audience. This is the first thing agents read — keep it accurate and concise.

### Tech Stack

The primary languages, frameworks, tools, and platforms the project uses. Kept separate from Purpose so agents can quickly locate technology details without reading narrative prose.

### Architecture

High-level structure of the codebase: how it is organized, what the major components are, and how they interact. Invoke replaces this section automatically when structural changes are detected after a pipeline run.

### Conventions

Coding standards, naming patterns, and project-specific rules that agents must follow. This is the highest-leverage section to keep current — agents that understand your conventions write code that fits naturally into the codebase.

### Completed Work

A log of features and changes that have been delivered through invoke. This section is append-only: invoke adds a timestamped entry after each pipeline completes. You can read it to see what was done, but you do not need to maintain it manually.

### Constraints

Non-negotiable requirements, operational limits, and important trade-offs that are currently in effect. Update this section manually when significant constraints are established or change outside of an invoke pipeline.

### Known Issues

Deferred findings, acknowledged technical debt, and known limitations. Invoke appends to this section when a review cycle produces findings that were dismissed rather than fixed — so the information is not lost, just deferred.

---

## Automatic updates after pipelines

Invoke updates `context.md` in three ways after a pipeline completes:

- **Completed Work** — a new entry is appended with the pipeline ID, the feature delivered, and a timestamp. This happens after every successful pipeline.
- **Architecture** — the Architecture section is replaced if the pipeline introduced structural changes (new modules, changed directory layout, new entry points). The replacement content is generated from the build output.
- **Known Issues** — findings that were accepted but not fixed (deferred) are appended here with their severity, file, and a brief description. Dismissed findings (false positives) are not recorded.

All other sections — Purpose, Tech Stack, Conventions, Constraints — are never modified by invoke. Your edits to these sections are always preserved.

---

## Prompt injection

Every role prompt can receive relevant sections of `context.md` through the `{{project_context}}` template variable.

When invoke composes a prompt for an agent, it does not inject the full file verbatim. The prompt composer reads `.invoke/context.md`, parses it into sections, and selects which sections to include based on the agent's role and task. If the file does not exist, the variable resolves to an empty string.

### Section selection

Sections are filtered using the following rules (`src/dispatch/prompt-composer.ts:77-120`):

- **Always included** — Purpose, Tech Stack, Conventions, Constraints. These are included for every role regardless of the task.
- **Builder and Planner roles** — Architecture is also included.
- **Reviewer roles** — Completed Work is also included.
- **Keyword overlap** — any remaining section whose heading words overlap with words in the task description is also included.

If the total context length is at or under 4000 characters, all sections are passed through without filtering (`src/dispatch/prompt-composer.ts:170-176`).

### Length limit

The selected context is truncated at 4000 characters. A `(truncated)` marker is appended when truncation occurs so the agent is aware the context is partial (`src/dispatch/prompt-composer.ts:32-38`).

To use this variable in a role prompt:

```markdown
## Project Context
{{project_context}}
```

Place it near the top of the prompt so the agent has the context before reading the instructions.

---

## Manual editing

`context.md` is plain Markdown. Open it in any editor and change whatever you want.

Invoke's write behavior by section:

| Section | Invoke behavior |
|---|---|
| Purpose | Never modified |
| Tech Stack | Never modified |
| Architecture | Replaced after structural changes |
| Conventions | Never modified |
| Completed Work | Append-only |
| Constraints | Never modified |
| Known Issues | Append-only |

Because Completed Work and Known Issues are append-only, manual entries you add there will be preserved — invoke only adds to the end of the section, it does not rewrite existing content.

If `context.md` grows stale — for example, a major refactor changed the architecture — edit the Architecture section directly. Invoke will use whatever you write there on the next pipeline run.
