export interface PorcelainWorktreeEntry {
    worktreePath: string;
    branch: string | null;
    head: string;
    detached: boolean;
    bare: boolean;
    prunable: boolean;
}
/** Parse `git worktree list --porcelain` output into structured entries. */
export declare function parsePorcelainWorktrees(porcelainOutput: string): PorcelainWorktreeEntry[];
//# sourceMappingURL=porcelain.d.ts.map