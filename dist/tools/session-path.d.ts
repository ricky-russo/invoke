import type { SessionManager } from '../session/manager.js';
/**
 * Resolve the canonical filesystem path of a session's integration worktree
 * for the given session_id, verifying in this order:
 *
 *   1. The session actually has a `work_branch_path` in its state. Legacy
 *      sessions that predate per-session work branches return `undefined` so
 *      callers can fall through to append-only behavior.
 *   2. The path passes `resolveSafeSessionWorkBranchPath`: it is under
 *      `realpath(os.tmpdir())`, its basename starts with `invoke-session-`,
 *      and its git-common-dir matches `projectDir`'s git-common-dir (cross-
 *      repo drift blocked).
 *   3. `state.work_branch` is present and equals `<work_branch_prefix>/
 *      <sessionId>` — this is the canonical session branch name and must
 *      match the requested session_id.
 *   4. The worktree at the resolved path is actually checked out on that
 *      branch right now. This catches cross-session drift within the same
 *      repo: if session A's `work_branch_path` was rewritten to point at
 *      session B's worktree, HEAD at that path will be on session B's
 *      branch, not `<prefix>/<A>`, and we refuse to proceed.
 *
 * Returns the validated canonical path on success, or throws when any
 * defense-in-depth check fails. Returns `undefined` ONLY for legacy sessions
 * without a `work_branch_path` — callers treat that as "not_supported" so
 * legacy pipelines keep append-only behavior.
 *
 * Rationale: prior to tightening, a crafted `state.json` could silently
 * repoint session A's `work_branch_path` at session B's worktree, and the
 * rebase / collapse tools would happily rewrite B's history. See BUG-014
 * post-mortem and the security review for the full pattern.
 */
export declare function resolveSessionWorkBranchPath(sessionManager: SessionManager, projectDir: string | undefined, sessionId?: string): Promise<string | undefined>;
//# sourceMappingURL=session-path.d.ts.map