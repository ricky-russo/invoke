/** Serializes operations that mutate the repo's worktree registry (git worktree add/remove/prune). Keyed by canonical repoDir. */
export declare function withRepoLock<T>(repoDir: string, fn: () => Promise<T>): Promise<T>;
/** Serializes operations that mutate the working tree at a specific path (merges, resets, commits). Keyed by canonical path. */
export declare function withMergeTargetLock<T>(targetPath: string, fn: () => Promise<T>): Promise<T>;
//# sourceMappingURL=repo-lock.d.ts.map