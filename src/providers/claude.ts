import type { Provider, CommandSpec } from './base.js'
import type { ProviderConfig } from '../types.js'

export class ClaudeProvider implements Provider {
  name = 'claude'

  constructor(private config: ProviderConfig) {}

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

    args.push('--directory', params.workDir)
    args.push(params.prompt)

    return { cmd: this.config.cli, args }
  }
}
