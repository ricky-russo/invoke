import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
const CONFLICT_STATUS_PREFIXES = ['UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD'];
export class WorktreeManager {
    repoDir;
    static repoMutex = new Map();
    static mergeTargetMutex = new Map();
    worktrees = new Map();
    constructor(repoDir) {
        this.repoDir = repoDir;
    }
    static async withRepoLock(repoDir, fn) {
        return WorktreeManager.runExclusive(WorktreeManager.repoMutex, repoDir, fn);
    }
    static async withMergeTargetLock(targetPath, fn) {
        return WorktreeManager.runExclusive(WorktreeManager.mergeTargetMutex, targetPath, fn);
    }
    static async runExclusive(mutex, key, fn) {
        const prev = mutex.get(key) ?? Promise.resolve();
        let release;
        const next = new Promise(resolve => {
            release = resolve;
        });
        mutex.set(key, next);
        try {
            await prev;
            return await fn();
        }
        finally {
            release();
            if (mutex.get(key) === next) {
                mutex.delete(key);
            }
        }
    }
    async create(taskId) {
        const branch = `invoke-wt-${taskId}`;
        const worktreePath = path.join(os.tmpdir(), `invoke-worktree-${taskId}-${Date.now()}`);
        await WorktreeManager.withRepoLock(this.repoDir, async () => {
            execSync(`git worktree add "${worktreePath}" -b "${branch}"`, { cwd: this.repoDir, stdio: 'pipe' });
        });
        const info = { taskId, worktreePath, branch };
        this.worktrees.set(taskId, info);
        return info;
    }
    async merge(taskId, options) {
        const info = this.worktrees.get(taskId);
        if (!info) {
            throw new Error(`No worktree found for task: ${taskId}`);
        }
        const mergeTargetPath = options?.mergeTargetPath ?? this.repoDir;
        const message = options?.commitMessage ?? `feat: ${taskId}`;
        // Auto-commit any uncommitted changes in the worktree
        // (agents in sandboxed environments may not be able to commit)
        try {
            execSync('git add -A', { cwd: info.worktreePath, stdio: 'pipe' });
            execSync(`git diff --cached --quiet`, { cwd: info.worktreePath, stdio: 'pipe' });
            // If diff --quiet exits 0, there are no staged changes — nothing to commit
        }
        catch {
            // diff --quiet exits 1 when there ARE staged changes — commit them
            try {
                execSync(`git commit -m "agent work: ${taskId}"`, { cwd: info.worktreePath, stdio: 'pipe' });
            }
            catch {
                // Commit might fail if there's truly nothing to commit
            }
        }
        return WorktreeManager.withMergeTargetLock(mergeTargetPath, async () => {
            try {
                execSync(`git merge --squash "${info.branch}"`, { cwd: mergeTargetPath, stdio: 'pipe' });
            }
            catch {
                const conflictingFiles = this.collectConflictingFiles(mergeTargetPath);
                // Squash merges do NOT set MERGE_HEAD, so `git merge --abort` is unavailable.
                // Reset the working tree and clean untracked files instead.
                execSync('git reset --hard HEAD', { cwd: mergeTargetPath, stdio: 'pipe' });
                execSync('git clean -fd', { cwd: mergeTargetPath, stdio: 'pipe' });
                return { status: 'conflict', conflictingFiles, mergeTargetPath };
            }
            execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: mergeTargetPath, stdio: 'pipe' });
            return { status: 'merged' };
        });
    }
    collectConflictingFiles(targetPath) {
        try {
            const status = execSync('git status --porcelain', {
                cwd: targetPath,
                stdio: 'pipe',
            }).toString();
            return status
                .split('\n')
                .filter(line => CONFLICT_STATUS_PREFIXES.some(p => line.startsWith(p)))
                .map(line => line.slice(3));
        }
        catch {
            return [];
        }
    }
    async cleanup(taskId) {
        const info = this.worktrees.get(taskId);
        if (!info)
            return;
        if (existsSync(info.worktreePath)) {
            await WorktreeManager.withRepoLock(this.repoDir, async () => {
                execSync(`git worktree remove "${info.worktreePath}" --force`, { cwd: this.repoDir, stdio: 'pipe' });
            });
        }
        try {
            execSync(`git branch -D "${info.branch}"`, { cwd: this.repoDir, stdio: 'pipe' });
        }
        catch {
            // Branch may already be deleted
        }
        this.worktrees.delete(taskId);
    }
    async cleanupAll() {
        for (const taskId of [...this.worktrees.keys()]) {
            await this.cleanup(taskId);
        }
    }
    listActive() {
        return [...this.worktrees.values()];
    }
    async discoverOrphaned() {
        try {
            const output = execSync('git worktree list --porcelain', {
                cwd: this.repoDir,
                stdio: 'pipe',
            }).toString();
            const orphaned = [];
            const blocks = output.split('\n\n').filter(Boolean);
            for (const block of blocks) {
                const lines = block.split('\n');
                const worktreeLine = lines.find(l => l.startsWith('worktree '));
                const branchLine = lines.find(l => l.startsWith('branch '));
                if (!worktreeLine || !branchLine)
                    continue;
                const worktreePath = worktreeLine.replace('worktree ', '');
                const fullBranch = branchLine.replace('branch ', '');
                const branch = fullBranch.replace('refs/heads/', '');
                if (!branch.startsWith('invoke-wt-'))
                    continue;
                const taskId = branch.replace('invoke-wt-', '');
                if (this.worktrees.has(taskId))
                    continue;
                orphaned.push({ taskId, worktreePath, branch });
            }
            return orphaned;
        }
        catch {
            return [];
        }
    }
}
//# sourceMappingURL=manager.js.map