import { readFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE_PATH = path.join(__dirname, '..', 'defaults', 'context-template.md')

describe('default context template', () => {
  it('uses the canonical context section headers', async () => {
    const content = await readFile(TEMPLATE_PATH, 'utf-8')

    expect(content).toContain('## Purpose')
    expect(content).toContain('## Tech Stack')
    expect(content).toContain('## Conventions')
    expect(content).toContain('## Constraints')
    expect(content).not.toContain('## Project Overview')
    expect(content).not.toContain('## Active Decisions')
  })
})
