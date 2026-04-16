import type { Provider, CommandSpec } from './base.js'
import type { ProviderConfig } from '../types.js'

export class ConfigDrivenProvider implements Provider {
  name: string

  constructor(name: string, private config: ProviderConfig) {
    this.name = name
  }

  buildCommand(params: {
    model: string
    effort: string
    workDir: string
    prompt: string
  }): CommandSpec {
    const args = this.config.args.map(arg =>
      arg
        .replace('{{model}}', params.model)
        .replace('{{effort}}', params.effort)
    )

    return {
      cmd: this.config.cli,
      // Config-driven CLIs may require the prompt as an arg instead of stdin
      // (for example, Gemini's -p flag), so we intentionally send both for
      // backward compatibility: stdin-aware tools read stdin, arg-based tools read args.
      args: [...args, params.prompt],
      cwd: params.workDir,
      stdinPrompt: params.prompt,
    }
  }
}
