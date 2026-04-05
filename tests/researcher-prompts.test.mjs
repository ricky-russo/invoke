import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const ROOT = process.cwd()

const sharedGuardrails = [
  '### Behavioral Guardrails',
  '- You are a researcher, not an implementer.',
  '- DO NOT write code or suggest implementations.',
  '- Report what exists and what constraints apply.',
  '- Cite file paths for every claim.',
]

const sharedAntiPatterns = [
  '### Anti-Patterns',
  '- DO NOT dump entire file contents; summarize and quote only the relevant 5-10 lines.',
  '- DO NOT speculate about behavior you have not verified.',
  '- DO NOT make implementation recommendations.',
]

const cases = [
  {
    file: 'defaults/roles/researcher/codebase.md',
    reportHeaders: [
      '### Architecture',
      '### Patterns & Conventions',
      '### Relevant Code',
      '### Constraints',
    ],
    specificAntiPattern:
      '- DO NOT list every file; focus on architecturally significant modules.',
    nAExample: '`N/A — no relevant architecture found.`',
    preservedCoreInstruction:
      'Focus on what will help an implementer build the right thing the first time.',
  },
  {
    file: 'defaults/roles/researcher/best-practices.md',
    reportHeaders: [
      '### Industry Standards',
      '### Framework Best Practices',
      '### Testing Best Practices',
      '### Performance Considerations',
    ],
    specificAntiPattern:
      "- DO NOT cite generic advice; be specific to the task's tech stack and patterns.",
    nAExample: '`N/A — no relevant industry standards found.`',
    preservedCoreInstruction:
      "Be actionable — don't just list principles, explain how they apply to this specific task.",
  },
  {
    file: 'defaults/roles/researcher/dependencies.md',
    reportHeaders: [
      '### Current Dependencies',
      '### New Dependencies Needed',
      '### Compatibility',
      '### Integration Points',
    ],
    specificAntiPattern:
      '- DO NOT recommend adding dependencies without first checking whether existing ones already cover the need.',
    nAExample: '`N/A — no relevant current dependencies found.`',
    preservedCoreInstruction:
      'Include specific package names, version numbers, import paths, and file paths for every claim.',
  },
]

test('researcher prompts include required guardrails and structure enforcement', () => {
  for (const promptCase of cases) {
    const content = readFileSync(path.join(ROOT, promptCase.file), 'utf8')

    for (const line of sharedGuardrails) {
      assert.match(content, new RegExp(escapeRegExp(line)))
    }

    for (const line of sharedAntiPatterns) {
      assert.match(content, new RegExp(escapeRegExp(line)))
    }

    assert.match(content, new RegExp(escapeRegExp(promptCase.specificAntiPattern)))

    for (const header of promptCase.reportHeaders) {
      assert.match(content, new RegExp(escapeRegExp(header)))
    }

    assert.match(
      content,
      /If a section has no relevant findings, include the header and write/,
    )
    assert.match(content, new RegExp(escapeRegExp(promptCase.nAExample)))
    assert.match(content, /Do not omit sections\./)
    assert.match(content, new RegExp(escapeRegExp(promptCase.preservedCoreInstruction)))

    const antiPatternSection = content
      .split('### Anti-Patterns')[1]
      .split('## Output Format')[0]
    const doNotCount = antiPatternSection.match(/DO NOT/g)?.length ?? 0
    assert.ok(doNotCount >= 4, `${promptCase.file} should contain at least 4 DO NOT rules`)
  }
})

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
