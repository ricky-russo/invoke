export const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export function validateSessionId(sessionId) {
    if (!SESSION_ID_PATTERN.test(sessionId)) {
        throw new Error(`Invalid session ID: '${sessionId}'`);
    }
}
//# sourceMappingURL=session-id-validator.js.map