interface WorktreeInfo {
    taskId: string;
    worktreePath: string;
    branch: string;
}
export declare class WorktreeManager {
    private repoDir;
    private worktrees;
    constructor(repoDir: string);
    create(taskId: string): Promise<WorktreeInfo>;
    merge(taskId: string, commitMessage?: string): Promise<void>;
    cleanup(taskId: string): Promise<void>;
    cleanupAll(): Promise<void>;
    listActive(): WorktreeInfo[];
    discoverOrphaned(): Promise<WorktreeInfo[]>;
}
export {};
//# sourceMappingURL=manager.d.ts.map