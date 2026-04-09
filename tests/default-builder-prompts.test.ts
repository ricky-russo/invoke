import { describe, it, expect } from 'vitest'
import { readFile } from 'fs/promises'
import path from 'path'

type BuilderPromptExpectation = {
  file: string
  expectedTitle: RegExp
}

const BUILDER_PROMPTS: BuilderPromptExpectation[] = [
  { file: 'default.md', expectedTitle: /^# Builder: Default$/m },
  { file: 'docs.md', expectedTitle: /^# Builder: Docs$/m },
  { file: 'integration-test.md', expectedTitle: /^# Builder: Integration Test$/m },
  { file: 'migration.md', expectedTitle: /^# Builder: Migration$/m },
  { file: 'refactor.md', expectedTitle: /^# Builder: Refactor$/m },
]

describe('default builder prompts', () => {
  it.each(BUILDER_PROMPTS)('has required structure: $file', async ({ file, expectedTitle }) => {
    const promptPath = path.join(import.meta.dirname, '..', 'defaults', 'roles', 'builder', file)
    const content = await readFile(promptPath, 'utf-8')

    expect(content).toMatch(expectedTitle)
    expect(content).toContain('{{task_description}}')
    expect(content).toContain('{{acceptance_criteria}}')
    expect(content).toContain('{{relevant_files}}')
    expect(content).toContain('{{interfaces}}')
    expect(content).toContain('{{prior_findings}}')
    expect(content).toContain('{{prior_findings_delim_start}}')
    expect(content).toContain('{{prior_findings_delim_end}}')
    expect(content).toContain('## Behavioral Guardrails')
    expect(content).toContain('## Handling Prior Review Findings')
    expect(content).toContain('## Rules')
    expect(content).toContain('untrusted data')

    const doNotMatches = content.match(/^- DO NOT /gm) ?? []
    expect(doNotMatches.length).toBeGreaterThanOrEqual(3)
  })

  // Drift guard: the runtime builder dispatch path reads from .invoke/roles/builder/,
  // not defaults/. If the .invoke/ tree drifts from defaults/, build tasks silently
  // regress. This test asserts byte-for-byte equality so any drift breaks CI immediately.
  it.each(BUILDER_PROMPTS)('.invoke/ builder prompt is byte-for-byte identical to defaults/: $file', async ({ file }) => {
    const defaultsPath = path.join(import.meta.dirname, '..', 'defaults', 'roles', 'builder', file)
    const invokePath = path.join(import.meta.dirname, '..', '.invoke', 'roles', 'builder', file)
    const defaultsContent = await readFile(defaultsPath, 'utf-8')
    const invokeContent = await readFile(invokePath, 'utf-8')
    expect(invokeContent).toBe(defaultsContent)
  })
})
