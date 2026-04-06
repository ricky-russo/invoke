import { execFileSync } from 'child_process';
import { existsSync, realpathSync } from 'fs';
import os from 'os';
import path from 'path';
import { buildWorkBranch } from './branch-prefix.js';
import { parsePorcelainWorktrees } from './porcelain.js';
import { withRepoLock } from './repo-lock.js';
import { validateSessionId } from './session-id-validator.js';
function toKnownPath(worktreePath) {
    return existsSync(worktreePath) ? realpathSync(worktreePath) : worktreePath;
}
export class SessionWorktreeManager {
    repoDir;
    baseBranches = new Map();
    knownPrefixes = new Set();
    repoPath;
    constructor(repoDir) {
        this.repoDir = repoDir;
        this.repoPath = toKnownPath(repoDir);
    }
    async create(sessionId, workBranchPrefix, baseBranch) {
        validateSessionId(sessionId);
        const workBranch = buildWorkBranch(workBranchPrefix, sessionId);
        this.rememberPrefix(sessionId, workBranch);
        this.baseBranches.set(workBranch, baseBranch);
        const existing = await this.resolve(sessionId, workBranch);
        if (existing) {
            return this.rememberInfo({ ...existing, baseBranch });
        }
        return withRepoLock(this.repoDir, async () => {
            const lockedExisting = await this.resolve(sessionId, workBranch);
            if (lockedExisting) {
                return this.rememberInfo({ ...lockedExisting, baseBranch });
            }
            const worktreePath = this.defaultWorktreePath(sessionId);
            this.assertUnderTmpdir(worktreePath);
            execFileSync('git', ['worktree', 'add', worktreePath, '-b', workBranch, baseBranch], { cwd: this.repoDir, stdio: 'pipe' });
            return this.rememberInfo({
                sessionId,
                worktreePath: toKnownPath(worktreePath),
                workBranch,
                baseBranch,
            });
        });
    }
    async resolve(sessionId, workBranch) {
        validateSessionId(sessionId);
        this.rememberPrefix(sessionId, workBranch);
        const entry = this.listPorcelainWorktrees().find(worktree => worktree.branch === workBranch);
        if (!entry) {
            return null;
        }
        return this.rememberInfo({
            sessionId,
            worktreePath: toKnownPath(entry.worktreePath),
            workBranch,
            baseBranch: this.lookupBaseBranch(workBranch),
        });
    }
    async reattach(sessionId, workBranch, recordedPath) {
        validateSessionId(sessionId);
        this.rememberPrefix(sessionId, workBranch);
        if (recordedPath !== undefined) {
            // Strict mode: the branch must be checked out exactly at the recorded path.
            // The caller can decide what to do (e.g. delete the stale worktree) on null.
            const existing = await this.resolve(sessionId, workBranch);
            if (!existing) {
                return null;
            }
            if (toKnownPath(existing.worktreePath) !== toKnownPath(recordedPath)) {
                return null;
            }
            if (!existsSync(existing.worktreePath)) {
                return null;
            }
            return existing;
        }
        const existing = await this.resolve(sessionId, workBranch);
        if (existing && existsSync(existing.worktreePath)) {
            return existing;
        }
        if (!this.branchExists(workBranch)) {
            return null;
        }
        return withRepoLock(this.repoDir, async () => {
            const lockedExisting = await this.resolve(sessionId, workBranch);
            if (lockedExisting && existsSync(lockedExisting.worktreePath)) {
                return lockedExisting;
            }
            if (!this.branchExists(workBranch)) {
                return null;
            }
            execFileSync('git', ['worktree', 'prune'], {
                cwd: this.repoDir,
                stdio: 'pipe',
            });
            const worktreePath = this.reattachWorktreePath(sessionId);
            this.assertUnderTmpdir(worktreePath);
            execFileSync('git', ['worktree', 'add', worktreePath, workBranch], { cwd: this.repoDir, stdio: 'pipe' });
            return this.rememberInfo({
                sessionId,
                worktreePath: toKnownPath(worktreePath),
                workBranch,
                baseBranch: this.lookupBaseBranch(workBranch),
            });
        });
    }
    async cleanup(sessionId, workBranch, deleteBranch) {
        validateSessionId(sessionId);
        this.rememberPrefix(sessionId, workBranch);
        const existing = await this.resolve(sessionId, workBranch);
        if (existing) {
            await withRepoLock(this.repoDir, async () => {
                execFileSync('git', ['worktree', 'remove', '--force', existing.worktreePath], { cwd: this.repoDir, stdio: 'pipe' });
            });
        }
        if (deleteBranch) {
            try {
                execFileSync('git', ['branch', '-D', workBranch], { cwd: this.repoDir, stdio: 'pipe' });
            }
            catch {
                // Branch may already be absent.
            }
        }
        this.baseBranches.delete(workBranch);
    }
    async listSessionWorktrees() {
        const sessionWorktrees = [];
        for (const entry of this.listPorcelainWorktrees()) {
            if (!entry.branch) {
                continue;
            }
            if (toKnownPath(entry.worktreePath) === this.repoPath) {
                continue;
            }
            const workBranch = entry.branch;
            const matchingPrefix = this.matchingPrefix(workBranch);
            const isSessionPath = path.basename(entry.worktreePath).startsWith('invoke-session-');
            if (!isSessionPath && !matchingPrefix) {
                continue;
            }
            const sessionId = matchingPrefix
                ? workBranch.slice(matchingPrefix.length + 1)
                : this.sessionIdFromPath(entry.worktreePath);
            if (!sessionId) {
                continue;
            }
            sessionWorktrees.push(this.rememberInfo({
                sessionId,
                worktreePath: toKnownPath(entry.worktreePath),
                workBranch,
                baseBranch: this.lookupBaseBranch(workBranch),
            }));
        }
        return sessionWorktrees;
    }
    listPorcelainWorktrees() {
        try {
            const output = execFileSync('git', ['worktree', 'list', '--porcelain'], {
                cwd: this.repoDir,
                stdio: 'pipe',
            }).toString();
            return parsePorcelainWorktrees(output);
        }
        catch {
            return [];
        }
    }
    branchExists(workBranch) {
        try {
            execFileSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${workBranch}`], { cwd: this.repoDir, stdio: 'pipe' });
            return true;
        }
        catch {
            return false;
        }
    }
    defaultWorktreePath(sessionId) {
        return path.join(os.tmpdir(), `invoke-session-${sessionId}`);
    }
    reattachWorktreePath(sessionId) {
        return path.join(os.tmpdir(), `invoke-session-${sessionId}-reattach-${Date.now()}`);
    }
    assertUnderTmpdir(worktreePath) {
        const tmpdir = os.tmpdir();
        let canonicalRoot = tmpdir;
        try {
            canonicalRoot = realpathSync(tmpdir);
        }
        catch {
            // Fall back to the literal tmpdir below.
        }
        const resolved = path.resolve(worktreePath);
        for (const root of [tmpdir, canonicalRoot]) {
            if (resolved === root || resolved.startsWith(root + path.sep)) {
                return;
            }
        }
        throw new Error(`Session worktree path escapes tmpdir: ${resolved}`);
    }
    lookupBaseBranch(workBranch) {
        return this.baseBranches.get(workBranch) ?? null;
    }
    rememberPrefix(sessionId, workBranch) {
        const suffix = `/${sessionId}`;
        if (!workBranch.endsWith(suffix)) {
            return;
        }
        this.knownPrefixes.add(workBranch.slice(0, -suffix.length));
    }
    matchingPrefix(workBranch) {
        let match = null;
        for (const prefix of this.knownPrefixes) {
            if (!workBranch.startsWith(`${prefix}/`)) {
                continue;
            }
            if (!match || prefix.length > match.length) {
                match = prefix;
            }
        }
        return match;
    }
    sessionIdFromPath(worktreePath) {
        const match = path.basename(worktreePath).match(/^invoke-session-(.+?)(?:-reattach-\d+)?$/);
        return match?.[1] ?? null;
    }
    rememberInfo(info) {
        if (info.baseBranch !== null) {
            this.baseBranches.set(info.workBranch, info.baseBranch);
        }
        this.rememberPrefix(info.sessionId, info.workBranch);
        return info;
    }
}
//# sourceMappingURL=session-worktree.js.map