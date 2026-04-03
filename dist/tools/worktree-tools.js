import { z } from 'zod';
import { runPostMergeCommands } from './post-merge.js';
export function registerWorktreeTools(server, worktreeManager, config, projectDir) {
    server.registerTool('invoke_create_worktree', {
        description: 'Create an isolated git worktree for a build task.',
        inputSchema: z.object({
            task_id: z.string().describe('Unique task identifier'),
        }),
    }, async ({ task_id }) => {
        try {
            const info = await worktreeManager.create(task_id);
            return {
                content: [{ type: 'text', text: JSON.stringify(info) }],
            };
        }
        catch (err) {
            return {
                content: [{ type: 'text', text: `Worktree error: ${err instanceof Error ? err.message : String(err)}` }],
                isError: true,
            };
        }
    });
    server.registerTool('invoke_merge_worktree', {
        description: 'Merge a completed worktree back into the work branch.',
        inputSchema: z.object({
            task_id: z.string().describe('Task ID of the worktree to merge'),
            commit_message: z.string().optional().describe('Commit message for the squash merge (defaults to "feat: <task_id>")'),
        }),
    }, async ({ task_id, commit_message }) => {
        try {
            await worktreeManager.merge(task_id, commit_message);
            await worktreeManager.cleanup(task_id);
            return {
                content: [{ type: 'text', text: JSON.stringify({ task_id, status: 'merged' }) }],
            };
        }
        catch (err) {
            return {
                content: [{ type: 'text', text: `Merge error: ${err instanceof Error ? err.message : String(err)}` }],
                isError: true,
            };
        }
    });
    server.registerTool('invoke_cleanup_worktrees', {
        description: 'Remove all stale/orphaned worktrees.',
        inputSchema: z.object({}),
    }, async () => {
        const active = worktreeManager.listActive();
        await worktreeManager.cleanupAll();
        return {
            content: [{ type: 'text', text: JSON.stringify({ cleaned: active.length }) }],
        };
    });
    server.registerTool('invoke_run_post_merge', {
        description: 'Run configured post-merge commands (e.g., composer install, npm install) to regenerate lockfiles after worktree merges.',
        inputSchema: z.object({}),
    }, async () => {
        if (!config || !projectDir) {
            return {
                content: [{ type: 'text', text: 'No config available — post-merge commands not configured.' }],
            };
        }
        const commands = config.settings.post_merge_commands ?? [];
        if (commands.length === 0) {
            return {
                content: [{ type: 'text', text: JSON.stringify({ message: 'No post_merge_commands configured', commands: [] }) }],
            };
        }
        const result = runPostMergeCommands(config, projectDir);
        return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
    });
}
//# sourceMappingURL=worktree-tools.js.map