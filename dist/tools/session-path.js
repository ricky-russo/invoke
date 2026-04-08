import { execFileSync } from 'node:child_process';
import { isSafeWorkBranch, resolveSafeSessionWorkBranchPath, } from '../worktree/trusted-session-helpers.js';
import { StateManager } from './state.js';
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
export async function resolveSessionWorkBranchPath(sessionManager, projectDir, sessionId) {
    if (!sessionId)
        return undefined;
    if (!projectDir) {
        throw new Error('Project directory is required when session_id is provided');
    }
    const sessionDir = sessionManager.resolve(sessionId);
    const stateManager = new StateManager(projectDir, sessionDir);
    const state = await stateManager.get();
    const workBranchPath = state?.work_branch_path;
    if (workBranchPath === undefined)
        return undefined;
    // Gate 1+2: tmpdir + invoke-session- basename + same git-common-dir. Returns
    // the EXACT canonical path that was validated so we do not re-resolve.
    const canonicalPath = resolveSafeSessionWorkBranchPath(workBranchPath, projectDir);
    if (canonicalPath === null) {
        throw new Error(`Refusing to use unsafe session work branch path for session '${sessionId}'`);
    }
    // Gate 3: session-identity check on the stored branch name. The expected
    // branch is `<prefix>/<sessionId>` — anything else means state was either
    // corrupted or pointing at another session.
    const workBranchPrefix = state?.work_branch
        ? state.work_branch.split('/').slice(0, -1).join('/')
        : 'invoke/work';
    if (!isSafeWorkBranch(state?.work_branch, sessionId, workBranchPrefix)) {
        throw new Error(`Refusing to use session '${sessionId}': state.work_branch '${state?.work_branch ?? '<unset>'}' does not match the expected session branch name`);
    }
    // Gate 4: the worktree at canonicalPath is actually checked out on that
    // branch RIGHT NOW. This catches cross-session drift where `work_branch_path`
    // was rewritten to another session's worktree inside the same repo.
    let currentBranch;
    try {
        currentBranch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
            cwd: canonicalPath,
            stdio: 'pipe',
        })
            .toString()
            .trim();
    }
    catch (err) {
        throw new Error(`Refusing to use session '${sessionId}': could not read HEAD at '${canonicalPath}' (${err instanceof Error ? err.message : String(err)})`);
    }
    if (currentBranch !== state.work_branch) {
        throw new Error(`Refusing to use session '${sessionId}': worktree at '${canonicalPath}' is checked out on '${currentBranch}', expected '${state.work_branch}'`);
    }
    return canonicalPath;
}
//# sourceMappingURL=session-path.js.map