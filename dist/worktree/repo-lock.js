import { realpathSync } from 'fs';
const repoLocks = new Map();
const mergeTargetLocks = new Map();
const taskLocks = new Map();
async function runExclusive(locks, key, fn) {
    const previous = locks.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise(resolve => {
        release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => current);
    locks.set(key, tail);
    await previous.catch(() => undefined);
    try {
        return await fn();
    }
    finally {
        release();
        if (locks.get(key) === tail) {
            locks.delete(key);
        }
    }
}
/** Serializes operations that mutate the repo's worktree registry (git worktree add/remove/prune). Keyed by canonical repoDir. */
export async function withRepoLock(repoDir, fn) {
    return runExclusive(repoLocks, canonicalize(repoDir), fn);
}
/** Serializes operations that mutate the working tree at a specific path (merges, resets, commits). Keyed by canonical path. */
export async function withMergeTargetLock(targetPath, fn) {
    return runExclusive(mergeTargetLocks, canonicalize(targetPath), fn);
}
/** Serializes lifecycle operations (merge, cleanup) that target the same task's worktree. Keyed by taskId. */
export async function withTaskLock(taskId, fn) {
    return runExclusive(taskLocks, taskId, fn);
}
function canonicalize(targetPath) {
    try {
        return realpathSync(targetPath);
    }
    catch {
        return targetPath;
    }
}
//# sourceMappingURL=repo-lock.js.map