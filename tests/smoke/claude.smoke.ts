import { describe, it, expect } from 'vitest'
import { ClaudeProvider } from '../../src/providers/claude.js'
import { ClaudeParser } from '../../src/parsers/claude-parser.js'
import { execSync, spawn } from 'child_process'

let cliAvailable = false
try {
  execSync('which claude', { stdio: 'pipe' })
  cliAvailable = true
} catch {
  cliAvailable = false
}

describe.skipIf(!cliAvailable)('Claude CLI Smoke Tests', () => {
  const provider = new ClaudeProvider({
    cli: 'claude',
    args: ['--print', '--model', '{{model}}'],
  })
  const parser = new ClaudeParser()

  it('accepts --print and --model flags', () => {
    const cmd = provider.buildCommand({
      model: 'sonnet-4.6',
      effort: 'low',
      workDir: process.cwd(),
      prompt: 'Respond with exactly: SMOKE_TEST_OK',
    })

    expect(cmd.cmd).toBe('claude')
    expect(cmd.args).toContain('--print')
    expect(cmd.args).toContain('--model')
    expect(cmd.args).toContain('sonnet-4.6')
  })

  it('responds to a simple prompt via --print', async () => {
    const cmd = provider.buildCommand({
      model: 'haiku-4.5',
      effort: 'low',
      workDir: process.cwd(),
      prompt: 'Respond with exactly one word: HELLO',
    })

    const output = await runCommand(cmd.cmd, cmd.args, 30000)

    expect(output.exitCode).toBe(0)
    expect(output.stdout.length).toBeGreaterThan(0)
  }, 60000)

  it('output is parseable by ClaudeParser', async () => {
    const cmd = provider.buildCommand({
      model: 'haiku-4.5',
      effort: 'low',
      workDir: process.cwd(),
      prompt: 'Respond with: "Analysis complete. No issues found."',
    })

    const output = await runCommand(cmd.cmd, cmd.args, 30000)

    const result = parser.parse(output.stdout, output.exitCode, {
      role: 'researcher',
      subrole: 'codebase',
      provider: 'claude',
      model: 'haiku-4.5',
      duration: 5000,
    })

    expect(result.status).toBe('success')
    expect(result.output.summary).toBeTruthy()
  }, 60000)

  it('sets cwd instead of --directory flag', () => {
    const cmd = provider.buildCommand({
      model: 'haiku-4.5',
      effort: 'low',
      workDir: '/tmp',
      prompt: 'test',
    })

    expect(cmd.cwd).toBe('/tmp')
    expect(cmd.args).not.toContain('--directory')
    expect(cmd.args).toContain('/tmp')
  })
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
