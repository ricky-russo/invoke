import { readFile, writeFile, mkdir, readdir, unlink } from 'fs/promises'
import path from 'path'
import { withLock } from '../session/lock.js'

export class ArtifactManager {
  private baseDir: string

  constructor(projectDir: string) {
    this.baseDir = path.join(projectDir, '.invoke')
  }

  async save(stage: string, filename: string, content: string): Promise<string> {
    const dir = path.join(this.baseDir, stage)
    await mkdir(dir, { recursive: true })
    const filePath = path.join(dir, filename)
    await withLock(filePath, async () => {
      await writeFile(filePath, content)
    })
    return filePath
  }

  async read(stage: string, filename: string): Promise<string> {
    const filePath = path.join(this.baseDir, stage, filename)
    return readFile(filePath, 'utf-8')
  }

  async list(stage: string): Promise<string[]> {
    const dir = path.join(this.baseDir, stage)
    try {
      return await readdir(dir)
    } catch {
      return []
    }
  }

  async delete(stage: string, filename: string): Promise<void> {
    const filePath = path.join(this.baseDir, stage, filename)
    await unlink(filePath)
  }
}
