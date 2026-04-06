import { z } from 'zod';
import { discoverBaseBranchCandidates, branchExists } from '../worktree/base-branch.js';
import { StateManager } from './state.js';
export function registerSessionInitTools(server, sessionWorktreeManager, sessionManager, config, projectDir) {
    server.registerTool('invoke_get_base_branch_candidates', {
        description: 'Read-only: returns the list of base-branch candidates for the session-init prompt.',
        inputSchema: z.object({}),
    }, async () => {
        try {
            const candidates = discoverBaseBranchCandidates(projectDir);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            current_head: candidates.currentHead,
                            default_branch: candidates.defaultBranch,
                            all_local_branches: candidates.allLocalBranches,
                        }),
                    }],
            };
        }
        catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
                isError: true,
            };
        }
    });
    server.registerTool('invoke_session_init_worktree', {
        description: 'Initialize the per-session work branch and integration worktree for the given session.',
        inputSchema: z.object({
            session_id: z.string(),
            base_branch: z.string(),
        }),
    }, async ({ session_id, base_branch }) => {
        try {
            if (!branchExists(projectDir, base_branch)) {
                return {
                    content: [{ type: 'text', text: `Base branch '${base_branch}' does not exist in this repository.` }],
                    isError: true,
                };
            }
            const cfg = config();
            const prefix = cfg.settings.work_branch_prefix ?? 'invoke/work';
            const info = await sessionWorktreeManager.create(session_id, prefix, base_branch);
            const sessionDir = sessionManager.resolve(session_id);
            const stateManager = new StateManager(projectDir, sessionDir);
            await stateManager.update({
                work_branch: info.workBranch,
                base_branch: info.baseBranch ?? base_branch,
                work_branch_path: info.worktreePath,
            });
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            session_id,
                            work_branch: info.workBranch,
                            base_branch: info.baseBranch ?? base_branch,
                            work_branch_path: info.worktreePath,
                        }),
                    }],
            };
        }
        catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
                isError: true,
            };
        }
    });
}
//# sourceMappingURL=session-init-tools.js.map