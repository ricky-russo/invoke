import { execFileSync } from 'child_process';
import { realpathSync } from 'fs';
import os from 'os';
import path from 'path';
export const INVOKE_SESSION_BASENAME_PREFIX = 'invoke-session-';
const gitCommonDirCache = new Map();
let cachedTmpdirRealpath = null;
function getTmpdirRealpath() {
    if (cachedTmpdirRealpath !== null)
        return cachedTmpdirRealpath;
    try {
        cachedTmpdirRealpath = realpathSync(os.tmpdir());
    }
    catch {
        cachedTmpdirRealpath = os.tmpdir();
    }
    return cachedTmpdirRealpath;
}
/**
 * Resolves the canonical realpath of `git rev-parse --git-common-dir` for the given cwd.
 * Returns null on any failure (failure-safe). Successful resolutions are memoized;
 * failures are not cached so a transient git error can be retried.
 */
export function resolveGitCommonDir(cwd) {
    const cached = gitCommonDirCache.get(cwd);
    if (cached !== undefined)
        return cached;
    try {
        const output = execFileSync('git', ['rev-parse', '--git-common-dir'], {
            cwd,
            stdio: 'pipe',
        })
            .toString()
            .trim();
        // Output may be relative (e.g. '.git'); resolve against cwd first.
        const resolved = realpathSync(path.resolve(cwd, output));
        gitCommonDirCache.set(cwd, resolved);
        return resolved;
    }
    catch {
        return null;
    }
}
/**
 * Returns true when workBranch is exactly the canonical session work branch
 * for sessionId under workBranchPrefix (i.e. `${prefix}/${sessionId}`).
 */
export function isSafeWorkBranch(workBranch, sessionId, workBranchPrefix) {
    if (!workBranch)
        return false;
    return workBranch === `${workBranchPrefix}/${sessionId}`;
}
/**
 * Type guard: returns true only when workBranchPath is a real session worktree
 * for the given repoDir. Checks (in order):
 *   1. workBranchPath is a defined absolute path
 *   2. realpath(workBranchPath) is under realpath(os.tmpdir())
 *   3. basename of realpath starts with INVOKE_SESSION_BASENAME_PREFIX
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
    const canonicalTmp = getTmpdirRealpath();
    if (canonicalTarget !== canonicalTmp && !canonicalTarget.startsWith(canonicalTmp + path.sep)) {
        return false;
    }
    if (!path.basename(canonicalTarget).startsWith(INVOKE_SESSION_BASENAME_PREFIX)) {
        return false;
    }
    // Repo identity check via git common-dir.
    const targetCommonDir = resolveGitCommonDir(canonicalTarget);
    const repoCommonDir = resolveGitCommonDir(repoDir);
    if (!targetCommonDir || !repoCommonDir)
        return false;
    return targetCommonDir === repoCommonDir;
}
//# sourceMappingURL=trusted-session-helpers.js.map