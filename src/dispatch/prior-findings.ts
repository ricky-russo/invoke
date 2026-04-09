import type { Finding, ReviewCycle } from '../types.js'

const MAX_ENTRIES = 20
const MAX_CHARS = 4000

export function formatPriorFindingsForBuilder(cycle: ReviewCycle | undefined): string {
  const accepted = cycle?.triaged?.accepted
  if (!accepted || accepted.length === 0) {
    return ''
  }

  const inScope = accepted.filter(finding => finding.out_of_scope !== true)
  if (inScope.length === 0) {
    return ''
  }

  const lines: string[] = []
  const cap = Math.min(inScope.length, MAX_ENTRIES)
  let charTotal = 0
  let truncatedAt = cap

  for (let i = 0; i < cap; i++) {
    const block = formatFinding(i + 1, inScope[i])
    const blockSeparatorLen = lines.length > 0 ? 1 : 0
    const remainingAfterCurrent = inScope.length - (i + 1)
    const overflowLen = remainingAfterCurrent > 0
      ? formatOverflowMarker(remainingAfterCurrent).length + 1
      : 0

    if (charTotal + blockSeparatorLen + block.length + overflowLen > MAX_CHARS) {
      truncatedAt = i
      break
    }

    lines.push(block)
    charTotal += blockSeparatorLen + block.length
  }

  if (truncatedAt < inScope.length) {
    lines.push(formatOverflowMarker(inScope.length - truncatedAt))
  }

  return lines.join('\n')
}

function formatFinding(index: number, finding: Finding): string {
  const severity = finding.severity.toUpperCase()
  const location = finding.line !== undefined
    ? `${finding.file}:${finding.line}`
    : finding.file

  return `${index}. [${severity}] ${location} — ${finding.issue}\n   Fix: ${finding.suggestion}`
}

function formatOverflowMarker(remaining: number): string {
  return `(${remaining} more prior findings truncated — review the delta diff for full context)`
}
