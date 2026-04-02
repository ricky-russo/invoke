export interface CommandSpec {
  cmd: string
  args: string[]
  env?: Record<string, string>
}

export interface Provider {
  name: string
  buildCommand(params: {
    model: string
    effort: string
    workDir: string
    prompt: string
  }): CommandSpec
}
