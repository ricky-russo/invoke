import { describe, it, expect } from 'vitest'
import { readFile, readdir } from 'fs/promises'
import path from 'path'

const DEFAULT_ROLE_DIR = path.join(import.meta.dirname, '..', 'plugin', 'defaults', 'roles')
const INVOKE_ROLE_DIR = path.join(import.meta.dirname, '..', '.invoke', 'roles')
const PROJECT_CONTEXT_MARKERS = [
  '## Project Context',
  '{{project_context}}',
  '{{project_context_delim_start}}',
  '{{project_context_delim_end}}',
]

async function collectMarkdownFiles(rootDir: string, currentDir = rootDir): Promise<string[]> {
  const entries = await readdir(currentDir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const entryPath = path.join(currentDir, entry.name)

    if (entry.isDirectory()) {
      files.push(...await collectMarkdownFiles(rootDir, entryPath))
      continue
    }

    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(path.relative(rootDir, entryPath))
    }
  }

  return files.sort()
}

describe('role prompt project context drift guard', () => {
  it('keeps both role prompt trees aligned and project-context aware', async () => {
    const defaultFiles = await collectMarkdownFiles(DEFAULT_ROLE_DIR)
    const invokeFiles = await collectMarkdownFiles(INVOKE_ROLE_DIR)

    expect(defaultFiles).toHaveLength(16)
    expect(invokeFiles).toHaveLength(16)
    expect(invokeFiles).toEqual(defaultFiles)

    for (const relativePath of defaultFiles) {
      const defaultsPath = path.join(DEFAULT_ROLE_DIR, relativePath)
      const invokePath = path.join(INVOKE_ROLE_DIR, relativePath)
      const defaultsContent = await readFile(defaultsPath, 'utf-8')
      const invokeContent = await readFile(invokePath, 'utf-8')

      expect(invokeContent).toBe(defaultsContent)

      for (const marker of PROJECT_CONTEXT_MARKERS) {
        expect(defaultsContent).toContain(marker)
        expect(invokeContent).toContain(marker)
      }
    }
  })
})
