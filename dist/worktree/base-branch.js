import { execFileSync } from 'child_process';
function runGit(repoDir, args) {
    return execFileSync('git', args, {
        cwd: repoDir,
        stdio: 'pipe',
    }).toString().trim();
}
function tryRunGit(repoDir, args) {
    try {
        return runGit(repoDir, args);
    }
    catch {
        return null;
    }
}
export function branchExists(repoDir, branch) {
    try {
        execFileSync('git', ['show-ref', '--verify', `refs/heads/${branch}`], {
            cwd: repoDir,
            stdio: 'pipe',
        });
        return true;
    }
    catch {
        return false;
    }
}
function discoverDefaultBranch(repoDir) {
    const originHead = tryRunGit(repoDir, ['symbolic-ref', 'refs/remotes/origin/HEAD']);
    if (originHead) {
        return originHead.replace(/^refs\/remotes\/origin\//, '');
    }
    if (branchExists(repoDir, 'main')) {
        return 'main';
    }
    if (branchExists(repoDir, 'master')) {
        return 'master';
    }
    return null;
}
export function discoverBaseBranchCandidates(repoDir) {
    const currentHead = tryRunGit(repoDir, ['symbolic-ref', '--short', 'HEAD']);
    const allLocalBranchesOutput = runGit(repoDir, [
        'for-each-ref',
        '--format=%(refname:short)',
        'refs/heads/',
    ]);
    return {
        currentHead,
        defaultBranch: discoverDefaultBranch(repoDir),
        allLocalBranches: allLocalBranchesOutput
            ? allLocalBranchesOutput.split('\n').filter(Boolean)
            : [],
    };
}
//# sourceMappingURL=base-branch.js.map