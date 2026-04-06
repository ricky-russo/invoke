export interface BaseBranchCandidates {
    currentHead: string | null;
    defaultBranch: string | null;
    allLocalBranches: string[];
}
export declare function branchExists(repoDir: string, branch: string): boolean;
export declare function discoverBaseBranchCandidates(repoDir: string): BaseBranchCandidates;
//# sourceMappingURL=base-branch.d.ts.map