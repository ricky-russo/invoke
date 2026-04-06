import { execFileSync } from 'child_process';
import { realpathSync } from 'fs';
import os from 'os';
import path from 'path';
/**
 * Resolves the canonical realpath of `git rev-parse --git-common-dir` for the given cwd.
 * Returns null on any failure (failure-safe).
 */
export function resolveGitCommonDir(cwd) {
    try {
        const output = execFileSync('git', ['rev-parse', '--git-common-dir'], {
            cwd,
            stdio: 'pipe',
        })
            .toString()
            .trim();
        // Output may be relative (e.g. '.git'); resolve against cwd first.
        return realpathSync(path.resolve(cwd, output));
    }
    catch {
        return null;
    }
}
/**
 * Type guard: returns true only when workBranchPath is a real session worktree
 * for the given repoDir. Checks (in order):
 *   1. workBranchPath is a defined absolute path
 *   2. realpath(workBranchPath) is under realpath(os.tmpdir())
 *   3. basename of realpath starts with 'invoke-session-'
 *   4. git rev-parse --git-common-dir for both workBranchPath and repoDir resolves to the same realpath
 */
export function isSafeSessionWorkBranchPath(workBranchPath, repoDir) {
    if (!workBranchPath || !path.isAbsolute(workBranchPath))
        return false;
    let canonicalTarget;
    try {
        canonicalTarget = realpathSync(workBranchPath);
    }
    catch {
        return false;
    }
    let canonicalTmp;
    try {
        canonicalTmp = realpathSync(os.tmpdir());
    }
    catch {
        canonicalTmp = os.tmpdir();
    }
    if (canonicalTarget !== canonicalTmp && !canonicalTarget.startsWith(canonicalTmp + path.sep)) {
        return false;
    }
    if (!path.basename(canonicalTarget).startsWith('invoke-session-')) {
        return false;
    }
    // Repo identity check via git common-dir.
    const targetCommonDir = resolveGitCommonDir(canonicalTarget);
    const repoCommonDir = resolveGitCommonDir(repoDir);
    if (!targetCommonDir || !repoCommonDir)
        return false;
    return targetCommonDir === repoCommonDir;
}
/**
 * Same as isSafeSessionWorkBranchPath but used by WorktreeManager.merge cleanup.
 * Identical contract — just renamed for clarity at the manager call site.
 */
export function isSafeSessionWorktreeTarget(targetPath, repoDir) {
    return isSafeSessionWorkBranchPath(targetPath, repoDir);
}
//# sourceMappingURL=trusted-session-helpers.js.map