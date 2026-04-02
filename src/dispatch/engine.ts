import { spawn } from 'child_process'
import type { Provider } from '../providers/base.js'
import type { Parser } from '../parsers/base.js'
import type { InvokeConfig, DispatchRequest, AgentResult } from '../types.js'
import { composePrompt } from './prompt-composer.js'

interface DispatchEngineOptions {
  config: InvokeConfig
  providers: Map<string, Provider>
  parsers: Map<string, Parser>
  projectDir: string
}

export class DispatchEngine {
  private config: InvokeConfig
  private providers: Map<string, Provider>
  private parsers: Map<string, Parser>
  private projectDir: string

  constructor(options: DispatchEngineOptions) {
    this.config = options.config
    this.providers = options.providers
    this.parsers = options.parsers
    this.projectDir = options.projectDir
  }

  async dispatch(request: DispatchRequest): Promise<AgentResult> {
    const roleConfig = this.config.roles[request.role]?.[request.subrole]
    if (!roleConfig) {
      throw new Error(`Role not found: ${request.role}.${request.subrole}`)
    }

    const provider = this.providers.get(roleConfig.provider)
    if (!provider) {
      throw new Error(`Provider not found: ${roleConfig.provider}. Is the CLI installed?`)
    }

    const parser = this.parsers.get(roleConfig.provider)
    if (!parser) {
      throw new Error(`Parser not found for provider: ${roleConfig.provider}`)
    }

    const prompt = await composePrompt({
      projectDir: this.projectDir,
      promptPath: roleConfig.prompt,
      taskContext: request.taskContext,
    })

    const workDir = request.workDir ?? this.projectDir
    const commandSpec = provider.buildCommand({
      model: roleConfig.model,
      effort: roleConfig.effort,
      workDir,
      prompt,
    })

    const startTime = Date.now()
    const { stdout, exitCode } = await this.runProcess(
      commandSpec.cmd,
      commandSpec.args,
      this.config.settings.agent_timeout
    )
    const duration = Date.now() - startTime

    return parser.parse(stdout, exitCode, {
      role: request.role,
      subrole: request.subrole,
      provider: roleConfig.provider,
      model: roleConfig.model,
      duration,
    })
  }

  private runProcess(
    cmd: string,
    args: string[],
    timeout: number
  ): Promise<{ stdout: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })

      let stdout = ''
      let stderr = ''
      let timedOut = false

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      const timer = setTimeout(() => {
        timedOut = true
        proc.kill('SIGTERM')
      }, timeout)

      proc.on('close', (code) => {
        clearTimeout(timer)
        if (timedOut) {
          resolve({ stdout: stdout || `Agent timed out after ${timeout}ms`, exitCode: -1 })
        } else {
          resolve({ stdout, exitCode: code ?? 1 })
        }
      })

      proc.on('error', (err) => {
        clearTimeout(timer)
        reject(new Error(`Failed to spawn ${cmd}: ${err.message}. Is the CLI installed?`))
      })
    })
  }
}
