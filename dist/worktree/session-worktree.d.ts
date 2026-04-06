export interface SessionWorktreeInfo {
    sessionId: string;
    worktreePath: string;
    workBranch: string;
    baseBranch: string | null;
}
export declare class SessionWorktreeManager {
    private readonly repoDir;
    private readonly baseBranches;
    private readonly knownPrefixes;
    private readonly repoPath;
    private readonly realTmpdirPath;
    private readonly tmpdirPath;
    constructor(repoDir: string);
    create(sessionId: string, workBranchPrefix: string, baseBranch: string): Promise<SessionWorktreeInfo>;
    resolve(sessionId: string, workBranch: string): Promise<SessionWorktreeInfo | null>;
    reattach(sessionId: string, workBranch: string, recordedPath?: string): Promise<SessionWorktreeInfo | null>;
    cleanup(sessionId: string, workBranch: string, deleteBranch: boolean): Promise<void>;
    listSessionWorktrees(): Promise<SessionWorktreeInfo[]>;
    private listPorcelainWorktrees;
    private branchExists;
    private freshWorktreePath;
    private assertUnderTmpdir;
    private resolveTmpdirPath;
    private addWorktree;
    private realpathUnderTmpdir;
    private safeRealpathUnderTmpdir;
    private lookupBaseBranch;
    private rememberPrefix;
    private matchingPrefix;
    private sessionIdFromPath;
    private rememberInfo;
}
//# sourceMappingURL=session-worktree.d.ts.map