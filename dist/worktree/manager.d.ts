interface WorktreeInfo {
    taskId: string;
    worktreePath: string;
    branch: string;
}
export type MergeResult = {
    status: 'merged';
} | {
    status: 'conflict';
    conflictingFiles: string[];
    mergeTargetPath: string;
};
export declare class WorktreeManager {
    private repoDir;
    private worktrees;
    constructor(repoDir: string);
    create(taskId: string): Promise<WorktreeInfo>;
    merge(taskId: string, options?: {
        commitMessage?: string;
        mergeTargetPath?: string;
    }): Promise<MergeResult>;
    private mergeLocked;
    private collectConflictingFiles;
    cleanup(taskId: string): Promise<void>;
    private cleanupLocked;
    cleanupAll(): Promise<void>;
    listActive(): WorktreeInfo[];
    discoverOrphaned(): Promise<WorktreeInfo[]>;
}
export {};
//# sourceMappingURL=manager.d.ts.map