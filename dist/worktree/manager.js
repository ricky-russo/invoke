import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
export class WorktreeManager {
    repoDir;
    worktrees = new Map();
    constructor(repoDir) {
        this.repoDir = repoDir;
    }
    async create(taskId) {
        const branch = `invoke-wt-${taskId}`;
        const worktreePath = path.join(os.tmpdir(), `invoke-worktree-${taskId}-${Date.now()}`);
        execSync(`git worktree add "${worktreePath}" -b "${branch}"`, { cwd: this.repoDir, stdio: 'pipe' });
        const info = { taskId, worktreePath, branch };
        this.worktrees.set(taskId, info);
        return info;
    }
    async merge(taskId, commitMessage) {
        const info = this.worktrees.get(taskId);
        if (!info) {
            throw new Error(`No worktree found for task: ${taskId}`);
        }
        execSync(`git merge --squash "${info.branch}"`, { cwd: this.repoDir, stdio: 'pipe' });
        const message = commitMessage ?? `feat: ${taskId}`;
        execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: this.repoDir, stdio: 'pipe' });
    }
    async cleanup(taskId) {
        const info = this.worktrees.get(taskId);
        if (!info)
            return;
        if (existsSync(info.worktreePath)) {
            execSync(`git worktree remove "${info.worktreePath}" --force`, { cwd: this.repoDir, stdio: 'pipe' });
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