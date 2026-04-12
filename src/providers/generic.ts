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

    args.push(params.prompt)

    return { cmd: this.config.cli, args, cwd: params.workDir }
  }
}
