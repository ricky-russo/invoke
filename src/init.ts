import { cp, mkdir, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export async function initProject(projectDir: string): Promise<void> {
  const invokeDir = path.join(projectDir, '.invoke')
  const defaultsDir = path.join(__dirname, '..', 'defaults')

  // Create .invoke directory
  await mkdir(invokeDir, { recursive: true })

  // Copy pipeline.yaml if it doesn't exist
  const configDest = path.join(invokeDir, 'pipeline.yaml')
  if (!existsSync(configDest)) {
    await cp(
      path.join(defaultsDir, 'pipeline.yaml'),
      configDest
    )
  }

  // Copy default roles
  await copyDefaults(
    path.join(defaultsDir, 'roles'),
    path.join(invokeDir, 'roles')
  )

  // Copy default strategies
  await copyDefaults(
    path.join(defaultsDir, 'strategies'),
    path.join(invokeDir, 'strategies')
  )

  // Create empty output directories
  await mkdir(path.join(invokeDir, 'specs', 'research'), { recursive: true })
  await mkdir(path.join(invokeDir, 'plans'), { recursive: true })
  await mkdir(path.join(invokeDir, 'reviews'), { recursive: true })
}

async function copyDefaults(srcDir: string, destDir: string): Promise<void> {
  if (!existsSync(srcDir)) return

  await mkdir(destDir, { recursive: true })

  const entries = await readdir(srcDir, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name)
    const destPath = path.join(destDir, entry.name)

    if (entry.isDirectory()) {
      await copyDefaults(srcPath, destPath)
    } else if (!existsSync(destPath)) {
      await cp(srcPath, destPath)
    }
  }
}
