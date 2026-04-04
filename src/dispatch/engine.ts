import { spawn } from 'child_process'
import type { Provider } from '../providers/base.js'
import type { Parser } from '../parsers/base.js'
import type {
  InvokeConfig,
  DispatchRequest,
  AgentResult,
  ProviderEntry,
  RoleConfig,
  ProviderMode,
  DispatchMetric,
} from '../types.js'
import { composePrompt } from './prompt-composer.js'
import { mergeFindings } from './merge-findings.js'
import { loadConfig } from '../config.js'

interface DispatchEngineOptions {
  providers: Map<string, Provider>
  parsers: Map<string, Parser>
  projectDir: string
  onDispatchComplete?: (metric: DispatchMetric) => void
}

export class DispatchEngine {
  private providers: Map<string, Provider>
  private parsers: Map<string, Parser>
  private projectDir: string
  private onDispatchComplete?: (metric: DispatchMetric) => void

  constructor(options: DispatchEngineOptions) {
    this.providers = options.providers
    this.parsers = options.parsers
    this.projectDir = options.projectDir
    this.onDispatchComplete = options.onDispatchComplete
  }

  async dispatch(request: DispatchRequest): Promise<AgentResult> {
    // Re-read config on every dispatch to pick up mid-session edits
    const config = await loadConfig(this.projectDir)

    const roleConfig = config.roles[request.role]?.[request.subrole]
    if (!roleConfig) {
      throw new Error(`Role not found: ${request.role}.${request.subrole}`)
    }

    const prompt = await composePrompt({
      projectDir: this.projectDir,
      promptPath: roleConfig.prompt,
      taskContext: request.taskContext,
    })

    const workDir = request.workDir ?? this.projectDir

    const mode = this.resolveProviderMode(roleConfig, config)

    switch (mode) {
      case 'parallel':
        return this.dispatchParallel(roleConfig.providers, prompt, workDir, request, config)
      case 'fallback':
        return this.dispatchFallback(roleConfig.providers, prompt, workDir, request, config)
      case 'single':
        return this.dispatchToProvider(roleConfig.providers[0], prompt, workDir, request, config)
    }
  }

  private resolveProviderMode(roleConfig: RoleConfig, config: InvokeConfig): ProviderMode {
    if (roleConfig.providers.length === 1) {
      return 'single'
    }

    return roleConfig.provider_mode ?? config.settings.default_provider_mode ?? 'parallel'
  }

  private async dispatchParallel(
    providers: ProviderEntry[],
    prompt: string,
    workDir: string,
    request: DispatchRequest,
    config: InvokeConfig
  ): Promise<AgentResult> {
    const results = await Promise.all(
      providers.map(entry => this.dispatchToProvider(entry, prompt, workDir, request, config))
    )

    if (results.length === 1) {
      return results[0]
    }

    return this.mergeResults(results, request)
  }

  private async dispatchFallback(
    providers: ProviderEntry[],
    prompt: string,
    workDir: string,
    request: DispatchRequest,
    config: InvokeConfig
  ): Promise<AgentResult> {
    let lastResult: AgentResult | undefined

    for (const entry of providers) {
      const result = await this.dispatchToProvider(entry, prompt, workDir, request, config)

      if (result.status === 'success') {
        return result
      }

      lastResult = result
    }

    if (!lastResult) {
      throw new Error('No providers configured for dispatch')
    }

    return lastResult
  }

  private async dispatchToProvider(
    entry: ProviderEntry,
    prompt: string,
    workDir: string,
    request: DispatchRequest,
    config: InvokeConfig
  ): Promise<AgentResult> {
    const provider = this.providers.get(entry.provider)
    if (!provider) {
      throw new Error(`Provider not found: ${entry.provider}. Is the CLI installed?`)
    }

    const parser = this.parsers.get(entry.provider)
    if (!parser) {
      throw new Error(`Parser not found for provider: ${entry.provider}`)
    }

    const commandSpec = provider.buildCommand({
      model: entry.model,
      effort: entry.effort,
      workDir,
      prompt,
    })

    const startTime = Date.now()
    const startedAt = new Date(startTime).toISOString()
    const timeoutSeconds = entry.timeout ?? config.settings.agent_timeout
    const timeoutMs = timeoutSeconds * 1000
    const { stdout, stderr, exitCode, timedOut } = await this.runProcess(
      commandSpec.cmd,
      commandSpec.args,
      timeoutMs,
      commandSpec.cwd
    )
    const duration = Date.now() - startTime

    let result: AgentResult
    if (timedOut) {
      result = {
        role: request.role,
        subrole: request.subrole,
        provider: entry.provider,
        model: entry.model,
        status: 'timeout',
        output: {
          summary: `Agent timed out after ${timeoutMs}ms`,
          raw: stdout || stderr || `Agent timed out after ${timeoutMs}ms`,
        },
        duration,
      }
    } else {
      // Use stderr for diagnostics when stdout is empty or command failed
      const output = stdout || (exitCode !== 0 ? `[stderr] ${stderr}` : stderr)

      result = parser.parse(output, exitCode, {
        role: request.role,
        subrole: request.subrole,
        provider: entry.provider,
        model: entry.model,
        duration,
      })
    }

    this.onDispatchComplete?.({
      pipeline_id: request.taskContext.pipeline_id ?? null,
      stage: request.taskContext.stage ?? 'unknown',
      role: request.role,
      subrole: request.subrole,
      provider: entry.provider,
      model: entry.model,
      effort: entry.effort,
      prompt_size_chars: prompt.length,
      duration_ms: duration,
      status: result.status,
      started_at: startedAt,
    })

    return result
  }

  private mergeResults(results: AgentResult[], request: DispatchRequest): AgentResult {
    const hasFindings = results.some(r => r.output.findings && r.output.findings.length > 0)

    if (hasFindings) {
      const providerFindings = results
        .filter(r => r.output.findings)
        .map(r => ({
          provider: r.provider,
          findings: r.output.findings!,
        }))

      const merged = mergeFindings(providerFindings)

      return {
        role: request.role,
        subrole: request.subrole,
        provider: results.map(r => r.provider).join('+'),
        model: results.map(r => r.model).join('+'),
        status: results.every(r => r.status === 'success') ? 'success' : 'error',
        output: {
          summary: `Merged results from ${results.length} providers (${merged.length} findings)`,
          findings: merged,
          raw: results.map(r => `--- ${r.provider} ---\n${r.output.raw}`).join('\n\n'),
        },
        duration: Math.max(...results.map(r => r.duration)),
      }
    }

    // Non-reviewer: concatenate reports
    return {
      role: request.role,
      subrole: request.subrole,
      provider: results.map(r => r.provider).join('+'),
      model: results.map(r => r.model).join('+'),
      status: results.every(r => r.status === 'success') ? 'success' : 'error',
      output: {
        summary: `Combined results from ${results.length} providers`,
        report: results.map(r => `## ${r.provider} (${r.model})\n\n${r.output.report ?? r.output.raw}`).join('\n\n---\n\n'),
        raw: results.map(r => `--- ${r.provider} ---\n${r.output.raw}`).join('\n\n'),
      },
      duration: Math.max(...results.map(r => r.duration)),
    }
  }

  private runProcess(
    cmd: string,
    args: string[],
    timeout: number,
    cwd?: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], cwd })

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
          resolve({
            stdout: stdout || `Agent timed out after ${timeout}ms`,
            stderr,
            exitCode: -1,
            timedOut: true,
          })
        } else {
          resolve({ stdout, stderr, exitCode: code ?? 1, timedOut: false })
        }
      })

      proc.on('error', (err) => {
        clearTimeout(timer)
        reject(new Error(`Failed to spawn ${cmd}: ${err.message}. Is the CLI installed?`))
      })
    })
  }
}
