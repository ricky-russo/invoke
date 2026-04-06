/**
 * Session ID validators.
 *
 * The module exposes TWO policies:
 *   - validateSessionId: strict allow-list, used for new session creation.
 *     Format: ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$
 *   - validateSessionIdForRead: permissive, only blocks path traversal.
 *     Used for read paths (resolve, exists, isStale, migrate, cleanup) so
 *     legacy sessions created under the old deny-list remain accessible
 *     per R8/C2/AC10 of the per-session-work-branches spec.
 */
export declare const SESSION_ID_PATTERN: RegExp;
export declare function validateSessionId(sessionId: string): void;
/**
 * Permissive validator for session ID READ paths. Only blocks path traversal
 * shapes (empty, '.', '..', '/', '\\', NUL). Legacy session IDs that were
 * valid under the old deny-list (pre allow-list rollout) MUST remain readable
 * for R8/C2/AC10 compatibility.
 *
 * Use this in resolve(), exists(), isStale(), migrate(), cleanup() — anywhere
 * a session is accessed by id without being created.
 *
 * For NEW session creation, use validateSessionId (strict allow-list).
 */
export declare function validateSessionIdForRead(sessionId: string): void;
//# sourceMappingURL=session-id-validator.d.ts.map