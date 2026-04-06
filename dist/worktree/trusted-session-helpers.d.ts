export declare const INVOKE_SESSION_BASENAME_PREFIX = "invoke-session-";
/**
 * Resolves the canonical realpath of `git rev-parse --git-common-dir` for the given cwd.
 * Returns null on any failure (failure-safe). Successful resolutions are memoized;
 * failures are not cached so a transient git error can be retried.
 */
export declare function resolveGitCommonDir(cwd: string): string | null;
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
 */
export declare function isSafeSessionWorkBranchPath(workBranchPath: string | undefined, repoDir: string): workBranchPath is string;
//# sourceMappingURL=trusted-session-helpers.d.ts.map