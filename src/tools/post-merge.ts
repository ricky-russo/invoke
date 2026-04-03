import { execSync } from 'child_process'
import type { InvokeConfig } from '../types.js'

export interface PostMergeResult {
  commands: { command: string; success: boolean; output: string }[]
}

export function runPostMergeCommands(config: InvokeConfig, projectDir: string): PostMergeResult {
  const commands = config.settings.post_merge_commands ?? []
  const results: PostMergeResult['commands'] = []

  for (const command of commands) {
    try {
      const output = execSync(command, {
        cwd: projectDir,
        stdio: 'pipe',
        timeout: 60000,
      }).toString()
      results.push({ command, success: true, output: output.slice(0, 500) })
    } catch (err) {
      const error = err as any
      results.push({
        command,
        success: false,
        output: (error.stderr?.toString() ?? error.message ?? 'Unknown error').slice(0, 500),
      })
    }
  }

  return { commands: results }
}
