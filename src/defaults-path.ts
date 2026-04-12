import { existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.join(__dirname, '..')

const defaultsDir = existsSync(path.join(PACKAGE_ROOT, 'defaults'))
  ? path.join(PACKAGE_ROOT, 'defaults')
  : path.join(PACKAGE_ROOT, 'plugin', 'defaults')

export function getDefaultsDir(): string {
  return defaultsDir
}
