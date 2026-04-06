import type { Parser, ParseContext } from './base.js'
import type { AgentResult, Finding } from '../types.js'

export class ClaudeParser implements Parser {
  name = 'claude'

  parse(rawOutput: string, exitCode: number, context: ParseContext): AgentResult {
    const base = {
      role: context.role,
      subrole: context.subrole,
      provider: context.provider,
      model: context.model,
      duration: context.duration,
    }

    if (exitCode !== 0) {
      return {
        ...base,
        status: 'error',
        output: {
          summary: `Agent exited with code ${exitCode}`,
          raw: rawOutput,
        },
      }
    }

    const findings = context.role === 'reviewer'
      ? this.extractFindings(rawOutput)
      : undefined

    const summary = rawOutput.split('\n').filter(l => l.trim()).slice(0, 3).join(' ').slice(0, 200)

    return {
      ...base,
      status: 'success',
      output: {
        summary,
        findings: context.role === 'reviewer' ? (findings ?? []) : undefined,
        raw: rawOutput,
      },
    }
  }

  private extractFindings(output: string): Finding[] {
    const findings: Finding[] = []
    const findingBlocks = output.split(/###\s+Finding\s+\d+/i).slice(1)

    for (const block of findingBlocks) {
      const severity = this.extractField(block, 'Severity')
      const file = this.extractField(block, 'File')
      const lineStr = this.extractField(block, 'Line')
      const issue = this.extractField(block, 'Issue')
      const suggestion = this.extractField(block, 'Suggestion')

      if (severity && file && issue && suggestion) {
        findings.push({
          severity: this.normalizeSeverity(severity),
          file,
          line: lineStr ? parseInt(lineStr, 10) : undefined,
          issue,
          suggestion,
        })
      }
    }

    return findings
  }

  private extractField(block: string, field: string): string | null {
    const match = block.match(new RegExp(`\\*\\*${field}:\\*\\*\\s*(.+)`, 'i'))
    return match ? match[1].trim() : null
  }

  private normalizeSeverity(s: string): Finding['severity'] {
    const lower = s.toLowerCase()
    if (lower === 'critical') return 'critical'
    if (lower === 'high') return 'high'
    if (lower === 'medium') return 'medium'
    return 'low'
  }
}
