import { readdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.join(__dirname, '..')

export interface MissingDefault {
  relativePath: string
  description: string
}

export async function checkForNewDefaults(projectDir: string): Promise<MissingDefault[]> {
  const invokeDir = path.join(projectDir, '.invoke')
  const defaultsDir = path.join(PACKAGE_ROOT, 'defaults')

  if (!existsSync(invokeDir) || !existsSync(defaultsDir)) {
    return []
  }

  const missing: MissingDefault[] = []
  await scanDir(defaultsDir, invokeDir, '', missing)
  return missing
}

async function scanDir(
  srcDir: string,
  destDir: string,
  relativePath: string,
  missing: MissingDefault[]
): Promise<void> {
  if (!existsSync(srcDir)) return

  const entries = await readdir(srcDir, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name)
    const destPath = path.join(destDir, entry.name)
    const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      await scanDir(srcPath, destPath, relPath, missing)
    } else if (!existsSync(destPath)) {
      missing.push({
        relativePath: relPath,
        description: describeDefault(relPath),
      })
    }
  }
}

function describeDefault(relPath: string): string {
  if (relPath.includes('roles/reviewer/')) return `New reviewer: ${path.basename(relPath, '.md')}`
  if (relPath.includes('roles/researcher/')) return `New researcher: ${path.basename(relPath, '.md')}`
  if (relPath.includes('roles/planner/')) return `New planner: ${path.basename(relPath, '.md')}`
  if (relPath.includes('roles/builder/')) return `New builder: ${path.basename(relPath, '.md')}`
  if (relPath.includes('presets/')) return `New preset: ${path.basename(relPath, path.extname(relPath))}`
  if (relPath.includes('strategies/')) return `New strategy: ${path.basename(relPath, '.md')}`
  if (relPath === 'context-template.md') return 'Project context template'
  return `New default: ${relPath}`
}
