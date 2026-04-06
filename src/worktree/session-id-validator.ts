export function validateSessionId(sessionId: string): void {
  if (
    !sessionId ||
    sessionId === '.' ||
    sessionId === '..' ||
    sessionId.includes('/') ||
    sessionId.includes('\\')
  ) {
    throw new Error(`Invalid session ID: '${sessionId}'`)
  }
}
