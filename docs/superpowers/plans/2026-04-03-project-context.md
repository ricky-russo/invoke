# Project Context System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give invoke a living document (`.invoke/context.md`) that accumulates project knowledge across pipelines and is automatically injected into agent prompts.

**Architecture:** A `ContextManager` class handles reading, writing, and section-level updates of `context.md`. MCP tools expose get/update/init operations. The prompt composer reads `context.md` and injects it as `{{project_context}}`. The scope skill triggers interactive initialization when context.md is missing. The review skill auto-updates after pipeline completion.

**Tech Stack:** TypeScript, vitest, markdown parsing via string operations (no external deps)

---

### Task 1: Create the default context template

**Files:**
- Create: `defaults/context-template.md`

- [ ] **Step 1: Create the template file**

```markdown
# Project Context

> This document is maintained by invoke and provides context to AI agents working on this project.
> You can edit it manually — invoke will only append to or update specific sections.

## Project Overview

<!-- Describe the project's purpose, audience, and key technologies -->

## Architecture

<!-- High-level structure, key components, data flow -->

## Conventions

<!-- Coding standards, naming patterns, project-specific rules -->

## Completed Work

<!-- Automatically updated by invoke after each pipeline completes -->

## Active Decisions

<!-- Architectural decisions and trade-offs chosen during planning -->

## Known Issues

<!-- Deferred findings, acknowledged tech debt -->
```

- [ ] **Step 2: Commit**

```bash
git add defaults/context-template.md
git commit -m "feat(context): add default context.md template"
```

---

### Task 2: ContextManager class

**Files:**
- Create: `src/tools/context.ts`
- Create: `tests/tools/context.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/tools/context.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ContextManager } from '../../src/tools/context.js'
import { mkdir, writeFile, readFile, rm } from 'fs/promises'
import path from 'path'
import os from 'os'

const TEST_DIR = path.join(os.tmpdir(), 'invoke-context-test')
let manager: ContextManager

beforeEach(async () => {
  await mkdir(path.join(TEST_DIR, '.invoke'), { recursive: true })
  manager = new ContextManager(TEST_DIR)
})

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('ContextManager', () => {
  it('returns null when no context.md exists', async () => {
    const content = await manager.get()
    expect(content).toBeNull()
  })

  it('returns false for exists() when file missing', () => {
    expect(manager.exists()).toBe(false)
  })

  it('initializes context.md with content', async () => {
    await manager.initialize('# Project Context\n\n## Overview\n\nTest project')
    expect(manager.exists()).toBe(true)
    const content = await manager.get()
    expect(content).toContain('Test project')
  })

  it('reads existing context.md', async () => {
    await writeFile(
      path.join(TEST_DIR, '.invoke', 'context.md'),
      '# Existing\n\nContent here'
    )
    const content = await manager.get()
    expect(content).toBe('# Existing\n\nContent here')
  })

  it('replaces a section by heading', async () => {
    await manager.initialize(
      '# Project Context\n\n## Architecture\n\nOld arch\n\n## Conventions\n\nOld conventions'
    )
    await manager.updateSection('Architecture', 'New architecture description', 'replace')
    const content = await manager.get()
    expect(content).toContain('New architecture description')
    expect(content).not.toContain('Old arch')
    expect(content).toContain('Old conventions')
  })

  it('appends to a section by heading', async () => {
    await manager.initialize(
      '# Project Context\n\n## Completed Work\n\nFirst item'
    )
    await manager.updateSection('Completed Work', '\n- Second item', 'append')
    const content = await manager.get()
    expect(content).toContain('First item')
    expect(content).toContain('Second item')
  })

  it('throws when updating nonexistent section', async () => {
    await manager.initialize('# Project Context\n\n## Architecture\n\nContent')
    await expect(
      manager.updateSection('Nonexistent', 'content', 'replace')
    ).rejects.toThrow()
  })

  it('truncates content when getting with maxLength', async () => {
    const longContent = '# Context\n\n' + 'x'.repeat(5000)
    await manager.initialize(longContent)
    const truncated = await manager.get(100)
    expect(truncated!.length).toBeLessThanOrEqual(115) // 100 + "(truncated)" suffix
    expect(truncated).toContain('(truncated)')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tools/context.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement ContextManager**

```ts
// src/tools/context.ts
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

export class ContextManager {
  private contextPath: string

  constructor(private projectDir: string) {
    this.contextPath = path.join(projectDir, '.invoke', 'context.md')
  }

  async get(maxLength?: number): Promise<string | null> {
    if (!existsSync(this.contextPath)) {
      return null
    }
    let content = await readFile(this.contextPath, 'utf-8')
    if (maxLength && content.length > maxLength) {
      content = content.slice(0, maxLength) + '\n\n(truncated)'
    }
    return content
  }

  exists(): boolean {
    return existsSync(this.contextPath)
  }

  async initialize(content: string): Promise<void> {
    await writeFile(this.contextPath, content)
  }

  async updateSection(
    sectionName: string,
    content: string,
    mode: 'replace' | 'append'
  ): Promise<void> {
    const current = await this.get()
    if (!current) {
      throw new Error('No context.md exists. Call initialize() first.')
    }

    const heading = `## ${sectionName}`
    const headingIndex = current.indexOf(heading)
    if (headingIndex === -1) {
      throw new Error(`Section '${sectionName}' not found in context.md`)
    }

    // Find the end of this section (next ## heading or end of file)
    const afterHeading = headingIndex + heading.length
    const nextHeadingIndex = current.indexOf('\n## ', afterHeading)
    const sectionEnd = nextHeadingIndex === -1 ? current.length : nextHeadingIndex

    if (mode === 'replace') {
      const updated =
        current.slice(0, afterHeading) +
        '\n\n' + content + '\n' +
        current.slice(sectionEnd)
      await writeFile(this.contextPath, updated)
    } else {
      // append
      const updated =
        current.slice(0, sectionEnd) +
        content + '\n' +
        current.slice(sectionEnd)
      await writeFile(this.contextPath, updated)
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tools/context.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/tools/context.ts tests/tools/context.test.ts
git commit -m "feat(context): add ContextManager with section-level updates and truncation"
```

---

### Task 3: MCP tools for context

**Files:**
- Create: `src/tools/context-tools.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Create context tools**

```ts
// src/tools/context-tools.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ContextManager } from './context.js'

export function registerContextTools(server: McpServer, contextManager: ContextManager): void {
  server.registerTool(
    'invoke_get_context',
    {
      description: 'Read the project context document (.invoke/context.md). Returns null if not yet initialized.',
      inputSchema: z.object({}),
    },
    async () => {
      const content = await contextManager.get()
      return {
        content: [{ type: 'text', text: content ?? 'No context.md found. Use invoke-scope to initialize project context.' }],
      }
    }
  )

  server.registerTool(
    'invoke_update_context',
    {
      description: 'Update a specific section in context.md by heading name.',
      inputSchema: z.object({
        section: z.string().describe('Section heading name (e.g. "Architecture", "Completed Work")'),
        content: z.string().describe('New content for the section'),
        mode: z.enum(['replace', 'append']).describe('"replace" overwrites the section, "append" adds to the end'),
      }),
    },
    async ({ section, content, mode }) => {
      try {
        await contextManager.updateSection(section, content, mode)
        return {
          content: [{ type: 'text', text: JSON.stringify({ updated: section, mode }) }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Context error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    }
  )

  server.registerTool(
    'invoke_init_context',
    {
      description: 'Initialize the project context document with the given content. Used during first-time project setup.',
      inputSchema: z.object({
        content: z.string().describe('Full markdown content for context.md'),
      }),
    },
    async ({ content }) => {
      try {
        await contextManager.initialize(content)
        return {
          content: [{ type: 'text', text: JSON.stringify({ initialized: true }) }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Init error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    }
  )
}
```

- [ ] **Step 2: Register in index.ts**

In `src/index.ts`, add the import:

```ts
import { ContextManager } from './tools/context.js'
import { registerContextTools } from './tools/context-tools.js'
```

After the `artifactManager` initialization (around line 62), add:

```ts
  const contextManager = new ContextManager(projectDir)
```

After the existing `registerConfigUpdateTools` call (around line 69), add:

```ts
  registerContextTools(server, contextManager)
```

- [ ] **Step 3: Build to verify**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 4: Commit**

```bash
git add src/tools/context-tools.ts src/index.ts
git commit -m "feat(context): register MCP tools for get/update/init context"
```

---

### Task 4: Prompt composer context injection

**Files:**
- Modify: `src/dispatch/prompt-composer.ts`
- Modify: `tests/dispatch/prompt-composer.test.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/dispatch/prompt-composer.test.ts`:

```ts
  it('injects project_context from context.md when available', async () => {
    await writeFile(
      path.join(TEST_DIR, '.invoke', 'context.md'),
      '# Project Context\n\n## Architecture\n\nThis is a REST API'
    )

    const result = await composePrompt({
      projectDir: TEST_DIR,
      promptPath: '.invoke/roles/test/prompt.md',
      taskContext: { task_description: 'Build feature' },
    })

    expect(result).toContain('This is a REST API')
  })

  it('sets project_context to empty string when no context.md', async () => {
    const result = await composePrompt({
      projectDir: TEST_DIR,
      promptPath: '.invoke/roles/test/prompt.md',
      taskContext: { task_description: 'Build feature' },
    })

    // Should not contain the literal placeholder
    expect(result).not.toContain('{{project_context}}')
  })
```

Note: Check the existing test file structure first — the test fixture directory and role prompt file may need to include `{{project_context}}` in the template to test replacement. Update the fixture prompt to include `{{project_context}}` if it doesn't already.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/dispatch/prompt-composer.test.ts`
Expected: FAIL — context injection not implemented

- [ ] **Step 3: Update prompt composer**

In `src/dispatch/prompt-composer.ts`, change to:

```ts
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

const CONTEXT_MAX_LENGTH = 4000

interface ComposeOptions {
  projectDir: string
  promptPath: string
  strategyPath?: string
  taskContext: Record<string, string>
}

export async function composePrompt(options: ComposeOptions): Promise<string> {
  const { projectDir, promptPath, strategyPath, taskContext } = options

  const rolePrompt = await readFile(
    path.join(projectDir, promptPath),
    'utf-8'
  )

  let composed = rolePrompt

  if (strategyPath) {
    const strategyPrompt = await readFile(
      path.join(projectDir, strategyPath),
      'utf-8'
    )
    composed = composed + '\n\n---\n\n' + strategyPrompt
  }

  // Inject project context if available
  const contextPath = path.join(projectDir, '.invoke', 'context.md')
  let projectContext = ''
  if (existsSync(contextPath)) {
    projectContext = await readFile(contextPath, 'utf-8')
    if (projectContext.length > CONTEXT_MAX_LENGTH) {
      projectContext = projectContext.slice(0, CONTEXT_MAX_LENGTH) + '\n\n(truncated)'
    }
  }
  composed = composed.replaceAll('{{project_context}}', projectContext)

  for (const [key, value] of Object.entries(taskContext)) {
    composed = composed.replaceAll(`{{${key}}}`, value)
  }

  return composed
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/dispatch/prompt-composer.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/dispatch/prompt-composer.ts tests/dispatch/prompt-composer.test.ts
git commit -m "feat(context): inject project context into agent prompts via prompt composer"
```

---

### Task 5: Update invoke-scope skill for context initialization

**Files:**
- Modify: `skills/invoke-scope/SKILL.md`

- [ ] **Step 1: Add context initialization flow to the scope skill**

In `skills/invoke-scope/SKILL.md`, add a new section **before** the existing "### 2. Dispatch Researchers" section:

```markdown
### 2. Initialize Project Context (if needed)

Call `invoke_get_context` to check if context.md exists.

**If context.md exists:** Skip to step 3. The context will be automatically injected into researcher prompts.

**If context.md does NOT exist:** Run the interactive initialization flow:

#### For existing codebases (project has source files):

1. Dispatch the `codebase` researcher to analyze the project structure, tech stack, patterns, and dependencies.
2. Once research completes, use the findings to ask the user **targeted** questions one at a time:
   - "What is this project's purpose and who is it for?"
   - Use research to make questions specific: "The codebase uses [framework] + [language] — are there any conventions around [pattern the research found] I should know about?"
   - "What are your near-term goals or priorities?"
3. Combine research findings + user answers into a context.md document following the template structure.
4. Present the draft to the user for review.
5. Save via `invoke_init_context`.

#### For greenfield projects (empty or minimal project):

1. Skip the research dispatch — nothing to analyze.
2. Ask the user interactive questions one at a time:
   - "What are you building and who is it for?"
   - "What tech stack are you planning to use?"
   - "Any architectural patterns or conventions you want to follow?"
   - "What are your immediate goals?"
3. Generate context.md from answers.
4. Present the draft to the user for review.
5. Save via `invoke_init_context`.
```

Renumber subsequent sections (old "### 2" becomes "### 3", etc.).

- [ ] **Step 2: Commit**

```bash
git add skills/invoke-scope/SKILL.md
git commit -m "feat(context): add interactive context initialization to invoke-scope"
```

---

### Task 6: Update invoke-review skill for auto-update

**Files:**
- Modify: `skills/invoke-review/SKILL.md`

- [ ] **Step 1: Add context update to pipeline completion**

In `skills/invoke-review/SKILL.md`, in the "### 8. Complete Pipeline" section (after saving the review history), add:

```markdown
#### Update Project Context

After saving the review history, update context.md to record what was built:

1. Call `invoke_get_context` to check if context.md exists. If not, skip this step.
2. Call `invoke_update_context` with:
   - `section: "Completed Work"`
   - `mode: "append"`
   - `content: "\n- [date]: [one-line summary of what was built] (spec: [spec filename])"`
3. If the build changed the project's architecture (new directories, components, or significant structural changes), call `invoke_update_context` with:
   - `section: "Architecture"`
   - `mode: "replace"`
   - `content: [updated architecture description]`
4. If there are accepted findings that were NOT fixed (deferred), call `invoke_update_context` with:
   - `section: "Known Issues"`
   - `mode: "append"`
   - `content: "\n- [finding summary] (deferred from pipeline [id])"`
```

- [ ] **Step 2: Commit**

```bash
git add skills/invoke-review/SKILL.md
git commit -m "feat(context): auto-update context.md after pipeline completion"
```

---

### Task 7: Run full test suite

**Files:** None (verification only)

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Commit if cleanup needed**

```bash
git add -A
git commit -m "fix: cleanup from project context implementation"
```
