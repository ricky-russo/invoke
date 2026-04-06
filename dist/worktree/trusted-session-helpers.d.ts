/**
 * Resolves the canonical realpath of `git rev-parse --git-common-dir` for the given cwd.
 * Returns null on any failure (failure-safe).
 */
export declare function resolveGitCommonDir(cwd: string): string | null;
/**
 * Type guard: returns true only when workBranchPath is a real session worktree
 * for the given repoDir. Checks (in order):
 *   1. workBranchPath is a defined absolute path
 *   2. realpath(workBranchPath) is under realpath(os.tmpdir())
 *   3. basename of realpath starts with 'invoke-session-'
 *   4. git rev-parse --git-common-dir for both workBranchPath and repoDir resolves to the same realpath
 */
export declare function isSafeSessionWorkBranchPath(workBranchPath: string | undefined, repoDir: string): workBranchPath is string;
/**
 * Same as isSafeSessionWorkBranchPath but used by WorktreeManager.merge cleanup.
 * Identical contract — just renamed for clarity at the manager call site.
 */
export declare function isSafeSessionWorktreeTarget(targetPath: string, repoDir: string): boolean;
//# sourceMappingURL=trusted-session-helpers.d.ts.map