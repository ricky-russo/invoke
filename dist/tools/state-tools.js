import path from 'path';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import { SESSION_ID_PATTERN } from '../worktree/session-id-validator.js';
import { StateManager } from './state.js';
const TaskSchema = z.object({
    id: z.string(),
    status: z.enum(['pending', 'dispatched', 'running', 'completed', 'error', 'timeout', 'conflict']),
    worktree_path: z.string().optional(),
    worktree_branch: z.string().optional(),
    conflict_attempts: z.number().optional(),
    conflicting_files: z.array(z.string()).optional(),
    result_summary: z.string().optional(),
    result_status: z.enum(['success', 'error', 'timeout']).optional(),
    merged: z.boolean().optional(),
    commit_sha: z.string().optional(),
});
const BatchSchema = z.object({
    id: z.number(),
    status: z.enum(['pending', 'in_progress', 'partial', 'completed', 'error']),
    merged_tasks: z.array(z.string()).optional(),
    tasks: z.array(TaskSchema),
    commit_sha: z.string().optional(),
});
const ReviewCycleSchema = z.object({
    id: z.number(),
    reviewers: z.array(z.string()),
    findings: z.array(z.any()),
    batch_id: z.number().optional(),
    scope: z.enum(['batch', 'final']).optional(),
    tier: z.string().optional(),
    triaged: z.object({
        accepted: z.array(z.any()),
        dismissed: z.array(z.any()),
        deferred: z.array(z.any()).optional(),
    }).optional(),
});
const WORK_BRANCH_PATTERN = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/;
const SetStateInputSchema = z.object({
    session_id: z.string().regex(SESSION_ID_PATTERN, 'invalid session id format').optional(),
    pipeline_id: z.string().optional(),
    current_stage: z.enum(['scope', 'plan', 'orchestrate', 'build', 'review', 'complete']).optional(),
    work_branch: z.string().regex(WORK_BRANCH_PATTERN, 'invalid work_branch format').optional(),
    base_branch: z.string().optional(),
    work_branch_path: z.string()
        .refine(value => path.isAbsolute(value) && path.basename(value).startsWith('invoke-session-'), 'work_branch_path must be an absolute path with invoke-session- basename')
        .optional(),
    spec: z.string().optional(),
    plan: z.string().optional(),
    tasks: z.string().optional(),
    strategy: z.string().optional(),
    batches: z.array(BatchSchema).optional(),
    batch_update: BatchSchema.optional(),
    review_cycles: z.array(ReviewCycleSchema).optional(),
    review_cycle_update: ReviewCycleSchema.optional(),
    bug_ids: z.array(z.string().regex(/^BUG-\d+$/, 'bug_ids must be BUG-NNN format')).optional(),
});
export function registerStateTools(server, stateManager, projectDir, sessionManager) {
    const scopedStateManagers = new Map();
    function getScopedStateManager(sessionDir) {
        const existing = scopedStateManagers.get(sessionDir);
        if (existing) {
            return existing;
        }
        const scopedManager = new StateManager(projectDir, sessionDir);
        scopedStateManagers.set(sessionDir, scopedManager);
        return scopedManager;
    }
    function resolveStateManager(sessionId) {
        if (!sessionId) {
            return stateManager;
        }
        if (!sessionManager.exists(sessionId)) {
            return stateManager;
        }
        return getScopedStateManager(sessionManager.resolve(sessionId));
    }
    async function resolveWritableStateManager(sessionId) {
        if (!sessionId) {
            return stateManager;
        }
        const sessionDir = sessionManager.exists(sessionId)
            ? sessionManager.resolve(sessionId)
            : await sessionManager.create(sessionId);
        return getScopedStateManager(sessionDir);
    }
    server.registerTool('invoke_get_state', {
        description: 'Get the current pipeline state.',
        inputSchema: z.object({
            session_id: z.string().optional(),
        }),
    }, async ({ session_id }) => {
        try {
            const scopedStateManager = resolveStateManager(session_id);
            const state = await scopedStateManager.get();
            if (!session_id && !state) {
                return {
                    content: [{
                            type: 'text',
                            text: 'No session_id provided. Use invoke_list_sessions to see available sessions.',
                        }],
                    isError: true,
                };
            }
            return {
                content: [{ type: 'text', text: JSON.stringify(state, null, 2) }],
            };
        }
        catch (err) {
            return {
                content: [{ type: 'text', text: `State error: ${err instanceof Error ? err.message : String(err)}` }],
                isError: true,
            };
        }
    });
    server.registerTool('invoke_set_state', {
        description: 'Update pipeline state fields. Pass only the fields to update. ' +
            'Supports nested batches and review_cycles. `batch_update.tasks` is merged into the existing batch by task id ' +
            '(send only the changed tasks; sibling task state is preserved). ' +
            'For full-array replacement (e.g. invoke-resume reset paths), use `batches: [...]` instead.',
        inputSchema: SetStateInputSchema,
    }, async (updates) => {
        try {
            const { session_id, ...stateUpdates } = updates;
            let resolvedSessionId = session_id;
            // When initializing a new pipeline without an explicit session_id,
            // auto-create a session directory so the pipeline_id can be used
            // as a session_id by other tools (e.g. invoke_dispatch_batch).
            if (!resolvedSessionId) {
                const globalState = await stateManager.get();
                if (!globalState) {
                    resolvedSessionId = stateUpdates.pipeline_id ?? `pipeline-${Date.now()}`;
                }
            }
            const scopedStateManager = await resolveWritableStateManager(resolvedSessionId);
            let state = await scopedStateManager.get();
            if (!state) {
                state = await scopedStateManager.initialize(resolvedSessionId ?? `pipeline-${Date.now()}`);
            }
            if (stateUpdates.batches !== undefined && stateUpdates.batch_update !== undefined) {
                console.warn('invoke_set_state received both batches and batch_update; batch_update will be applied before batches replaces the array');
            }
            if (stateUpdates.review_cycles !== undefined && stateUpdates.review_cycle_update !== undefined) {
                console.warn('invoke_set_state received both review_cycles and review_cycle_update; review_cycle_update will be applied before review_cycles replaces the array');
            }
            const { batch_update, review_cycle_update, ...rest } = stateUpdates;
            const updated = await scopedStateManager.applyComposite({
                batchUpdate: batch_update,
                reviewCycleUpdate: review_cycle_update,
                partial: rest,
            });
            return {
                content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }],
            };
        }
        catch (err) {
            return {
                content: [{ type: 'text', text: `State error: ${err instanceof Error ? err.message : String(err)}` }],
                isError: true,
            };
        }
    });
    server.registerTool('invoke_get_review_cycle_count', {
        description: 'Get the number of recorded review cycles, optionally filtered to a batch, plus the configured max review cycle limit when available.',
        inputSchema: z.object({
            session_id: z.string().optional(),
            batch_id: z.number().optional(),
        }),
    }, async ({ session_id, batch_id }) => {
        try {
            const scopedStateManager = resolveStateManager(session_id);
            const count = await scopedStateManager.getReviewCycleCount(batch_id);
            let maxReviewCycles;
            try {
                const config = await loadConfig(projectDir);
                maxReviewCycles = config.settings.max_review_cycles;
            }
            catch {
                // Counting review cycles should still work when config is absent or invalid.
            }
            const result = maxReviewCycles === undefined
                ? { count }
                : { count, max_review_cycles: maxReviewCycles };
            return {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
        }
        catch (err) {
            return {
                content: [{ type: 'text', text: `State error: ${err instanceof Error ? err.message : String(err)}` }],
                isError: true,
            };
        }
    });
}
//# sourceMappingURL=state-tools.js.map