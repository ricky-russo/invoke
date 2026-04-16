import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.join(__dirname, '..')

const packageJsonPath = existsSync(path.join(PACKAGE_ROOT, 'package.json'))
  ? path.join(PACKAGE_ROOT, 'package.json')
  : path.join(PACKAGE_ROOT, '.claude-plugin', 'plugin.json')

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string }

export const VERSION: string = packageJson.version
