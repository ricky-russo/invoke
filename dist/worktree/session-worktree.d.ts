export interface SessionWorktreeInfo {
    sessionId: string;
    worktreePath: string;
    workBranch: string;
    baseBranch: string;
}
export declare class SessionWorktreeManager {
    private readonly repoDir;
    private readonly baseBranches;
    private readonly knownPrefixes;
    private readonly repoPath;
    constructor(repoDir: string);
    create(sessionId: string, workBranchPrefix: string, baseBranch: string): Promise<SessionWorktreeInfo>;
    resolve(sessionId: string, workBranch: string): Promise<SessionWorktreeInfo | null>;
    reattach(sessionId: string, workBranch: string): Promise<SessionWorktreeInfo | null>;
    cleanup(sessionId: string, workBranch: string, deleteBranch: boolean): Promise<void>;
    listSessionWorktrees(): Promise<SessionWorktreeInfo[]>;
    private listPorcelainWorktrees;
    private branchExists;
    private defaultWorktreePath;
    private reattachWorktreePath;
    private rememberPrefix;
    private matchingPrefix;
    private sessionIdFromPath;
    private rememberInfo;
}
//# sourceMappingURL=session-worktree.d.ts.map