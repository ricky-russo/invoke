import type { Provider, CommandSpec } from './base.js'
import type { ProviderConfig } from '../types.js'

export class CodexProvider implements Provider {
  name = 'codex'

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

    args.push('--skip-git-repo-check')

    return { cmd: this.config.cli, args, cwd: params.workDir, stdinPrompt: params.prompt }
  }
}
