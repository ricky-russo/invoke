import { readFile } from 'fs/promises'
import path from 'path'

interface ComposeOptions {
  projectDir: string
  promptPath: string
  strategyPath?: string
  taskContext: Record<string, string>
}

export async function composePrompt(options: ComposeOptions): Promise<string> {
  const { projectDir, promptPath, strategyPath, taskContext } = options

  const rolePrompt = await readFile(
    path.join(projectDir, promptPath),
    'utf-8'
  )

  let composed = rolePrompt

  if (strategyPath) {
    const strategyPrompt = await readFile(
      path.join(projectDir, strategyPath),
      'utf-8'
    )
    composed = composed + '\n\n---\n\n' + strategyPrompt
  }

  for (const [key, value] of Object.entries(taskContext)) {
    composed = composed.replaceAll(`{{${key}}}`, value)
  }

  return composed
}
