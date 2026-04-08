export declare const INVOKE_SESSION_BASENAME_PREFIX = "invoke-session-";
/**
 * Resolves the canonical realpath of `git rev-parse --git-common-dir` for the
 * given cwd. Returns null on any failure (failure-safe).
 *
 * This function is deliberately NOT memoized at module scope. A previous
 * version kept a `Map<cwd, resolved>` cache, but it was a "poisoned-on-first-
 * read" hazard: if an attacker swapped the path (symlink replacement, worktree
 * moved, repo re-initialized) between the benign first read and a later safety
 * check, the cache would keep returning the stale common-dir and approve the
 * swap. Callers that need to avoid repeated git invocations within a single
 * logical check should use a per-call memo (see `resolveSafeSessionWorkBranchPath`
 * which passes one in).
 */
export declare function resolveGitCommonDir(cwd: string, memo?: Map<string, string>): string | null;
/**
 * Returns true when workBranch is exactly the canonical session work branch
 * for sessionId under workBranchPrefix (i.e. `${prefix}/${sessionId}`).
 */
export declare function isSafeWorkBranch(workBranch: string | undefined, sessionId: string, workBranchPrefix: string): workBranch is string;
/**
 * Type guard: returns true only when workBranchPath is a real session worktree
 * for the given repoDir. Checks (in order):
 *   1. workBranchPath is a defined absolute path
 *   2. realpath(workBranchPath) is under realpath(os.tmpdir())
 *   3. basename of realpath starts with INVOKE_SESSION_BASENAME_PREFIX
 *   4. git rev-parse --git-common-dir for both workBranchPath and repoDir resolves to the same realpath
 *
 * Prefer `resolveSafeSessionWorkBranchPath` when you need to use the path after
 * the check — it returns the canonical path that was validated so callers do
 * not have to re-resolve the pathname (which opens a TOCTOU window).
 */
export declare function isSafeSessionWorkBranchPath(workBranchPath: string | undefined, repoDir: string): workBranchPath is string;
/**
 * Same checks as `isSafeSessionWorkBranchPath` but returns the canonical
 * (realpath-resolved) path on success, or null on failure. Callers should
 * prefer this over the type guard whenever they intend to use the path,
 * because it returns the EXACT path that was validated. Re-resolving via a
 * second `realpathSync` introduces a check-to-use TOCTOU window where an
 * attacker with tmpdir write access could swap a symlink between the check
 * and the use.
 */
export declare function resolveSafeSessionWorkBranchPath(workBranchPath: string | undefined, repoDir: string): string | null;
//# sourceMappingURL=trusted-session-helpers.d.ts.map