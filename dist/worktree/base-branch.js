import { execSync } from 'child_process';
function shellEscape(value) {
    return value.replace(/(["\\$`])/g, '\\$1');
}
function runGit(repoDir, command) {
    return execSync(command, {
        cwd: repoDir,
        stdio: 'pipe',
    }).toString().trim();
}
function tryRunGit(repoDir, command) {
    try {
        return runGit(repoDir, command);
    }
    catch {
        return null;
    }
}
export function branchExists(repoDir, branch) {
    try {
        execSync(`git show-ref --verify "refs/heads/${shellEscape(branch)}"`, {
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
    const originHead = tryRunGit(repoDir, 'git symbolic-ref refs/remotes/origin/HEAD');
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
    const currentHead = tryRunGit(repoDir, 'git symbolic-ref --short HEAD');
    const allLocalBranchesOutput = runGit(repoDir, `git for-each-ref --format='%(refname:short)' refs/heads/`);
    return {
        currentHead,
        defaultBranch: discoverDefaultBranch(repoDir),
        allLocalBranches: allLocalBranchesOutput
            ? allLocalBranchesOutput.split('\n').filter(Boolean)
            : [],
    };
}
//# sourceMappingURL=base-branch.js.map