export function validateSessionId(sessionId) {
    if (!sessionId ||
        sessionId === '.' ||
        sessionId === '..' ||
        sessionId.includes('/') ||
        sessionId.includes('\\')) {
        throw new Error(`Invalid session ID: '${sessionId}'`);
    }
}
//# sourceMappingURL=session-id-validator.js.map