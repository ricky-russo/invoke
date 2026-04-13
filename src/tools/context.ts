import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { withLock } from '../session/lock.js'

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
    await withLock(this.contextPath, async () => {
      await writeFile(this.contextPath, content)
    })
  }

  async updateSection(
    sectionName: string,
    content: string,
    mode: 'replace' | 'append'
  ): Promise<void> {
    await withLock(this.contextPath, async () => {
      const current = await this.get()
      if (!current) {
        throw new Error('No context.md exists. Call initialize() first.')
      }

      const heading = `## ${sectionName}`
      const headingIndex = current.indexOf(heading)
      if (headingIndex === -1) {
        const separator = current.endsWith('\n\n') ? '' : current.endsWith('\n') ? '\n' : '\n\n'
        const updated =
          current +
          separator +
          heading +
          '\n\n' +
          content +
          '\n'
        await writeFile(this.contextPath, updated)
        return
      }

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
        const updated =
          current.slice(0, sectionEnd) +
          content + '\n' +
          current.slice(sectionEnd)
        await writeFile(this.contextPath, updated)
      }
    })
  }
}
