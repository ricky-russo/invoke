import { describe, it, expect } from 'vitest'
import { CodexProvider } from '../../src/providers/codex.js'
import { CodexParser } from '../../src/parsers/codex-parser.js'
import { execSync, spawn } from 'child_process'

let cliAvailable = false
try {
  execSync('which codex', { stdio: 'pipe' })
  cliAvailable = true
} catch {
  cliAvailable = false
}

describe.skipIf(!cliAvailable)('Codex CLI Smoke Tests', () => {
  const provider = new CodexProvider({
    cli: 'codex',
    args: ['exec', '--model', '{{model}}', '--ask-for-approval', 'never', '--sandbox', 'danger-full-access', '-c', 'reasoning_effort={{effort}}'],
  })
  const parser = new CodexParser()

  it('accepts --model and --reasoning-effort flags', () => {
    const cmd = provider.buildCommand({
      model: 'gpt-5.4',
      effort: 'low',
      workDir: process.cwd(),
      prompt: 'Respond with exactly: SMOKE_TEST_OK',
    })

    expect(cmd.cmd).toBe('codex')
    expect(cmd.args).toContain('exec')
    expect(cmd.args).toContain('--model')
    expect(cmd.args).toContain('gpt-5.4')
    expect(cmd.args).toContain('reasoning_effort=low')
  })

  it('sets cwd for working directory', () => {
    const cmd = provider.buildCommand({
      model: 'gpt-5.4',
      effort: 'low',
      workDir: '/tmp',
      prompt: 'test',
    })

    expect(cmd.cwd).toBe('/tmp')
    expect(cmd.args).toContain('--skip-git-repo-check')
  })

  it('responds to a simple prompt', async () => {
    const cmd = provider.buildCommand({
      model: 'gpt-5.4',
      effort: 'low',
      workDir: process.cwd(),
      prompt: 'Respond with exactly one word: HELLO',
    })

    const output = await runCommand(cmd.cmd, cmd.args, 30000)

    expect(output.exitCode).toBe(0)
    expect(output.stdout.length).toBeGreaterThan(0)
  }, 60000)

  it('output is parseable by CodexParser', async () => {
    const cmd = provider.buildCommand({
      model: 'gpt-5.4',
      effort: 'low',
      workDir: process.cwd(),
      prompt: 'Respond with: "Analysis complete. No issues found."',
    })

    const output = await runCommand(cmd.cmd, cmd.args, 30000)

    const result = parser.parse(output.stdout, output.exitCode, {
      role: 'researcher',
      subrole: 'codebase',
      provider: 'codex',
      model: 'gpt-5.4',
      duration: 5000,
    })

    expect(result.status).toBe('success')
    expect(result.output.summary).toBeTruthy()
  }, 60000)
})

function runCommand(cmd: string, args: string[], timeout: number): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })

    let stdout = ''
    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString() })
    proc.stderr.on('data', () => {})

    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      resolve({ stdout, exitCode: -1 })
    }, timeout)

    proc.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, exitCode: code ?? 1 })
    })

    proc.on('error', reject)
  })
}
