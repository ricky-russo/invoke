import { describe, it, expect } from 'vitest'
import { readFile } from 'fs/promises'
import path from 'path'

type PlannerPromptExpectation = {
  file: string
  expectedTitle: RegExp
}

const PLANNER_PROMPTS: PlannerPromptExpectation[] = [
  { file: 'architect.md', expectedTitle: /^# Architect Planner$/m },
  { file: 'alternative.md', expectedTitle: /^# Alternative Planner$/m },
]

describe('default planner prompts', () => {
  it.each(PLANNER_PROMPTS)('has required structure: $file', async ({ file, expectedTitle }) => {
    const promptPath = path.join(import.meta.dirname, '..', 'plugin', 'defaults', 'roles', 'planner', file)
    const content = await readFile(promptPath, 'utf-8')

    expect(content).toMatch(expectedTitle)
    expect(content).toContain('{{task_description}}')
    expect(content).toContain('{{research_context}}')
    expect(content).toContain('## Behavioral Guardrails')
    expect(content).toContain('## Anti-Patterns')
    expect(content).toContain('No Placeholders')
    expect(content).toContain('bite-sized')

    const doNotMatches = content.match(/^- DO NOT /gm) ?? []
    expect(doNotMatches.length).toBeGreaterThanOrEqual(3)
  })

  // Drift guard: planner dispatch reads from .invoke/roles/planner/. This asserts
  // byte-for-byte equality so any drift between defaults/ and .invoke/ breaks CI.
  it.each(PLANNER_PROMPTS)('.invoke/ planner prompt is byte-for-byte identical to defaults/: $file', async ({ file }) => {
    const defaultsPath = path.join(import.meta.dirname, '..', 'plugin', 'defaults', 'roles', 'planner', file)
    const invokePath = path.join(import.meta.dirname, '..', '.invoke', 'roles', 'planner', file)
    const defaultsContent = await readFile(defaultsPath, 'utf-8')
    const invokeContent = await readFile(invokePath, 'utf-8')
    expect(invokeContent).toBe(defaultsContent)
  })
})
