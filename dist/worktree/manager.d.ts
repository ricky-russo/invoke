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
    private static repoMutex;
    private static mergeTargetMutex;
    private worktrees;
    constructor(repoDir: string);
    static withRepoLock<T>(repoDir: string, fn: () => Promise<T>): Promise<T>;
    static withMergeTargetLock<T>(targetPath: string, fn: () => Promise<T>): Promise<T>;
    private static runExclusive;
    create(taskId: string): Promise<WorktreeInfo>;
    merge(taskId: string, options?: {
        commitMessage?: string;
        mergeTargetPath?: string;
    }): Promise<MergeResult>;
    private collectConflictingFiles;
    cleanup(taskId: string): Promise<void>;
    cleanupAll(): Promise<void>;
    listActive(): WorktreeInfo[];
    discoverOrphaned(): Promise<WorktreeInfo[]>;
}
export {};
//# sourceMappingURL=manager.d.ts.map