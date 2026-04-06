import { z } from 'zod';
import { loadConfig } from '../config.js';
import { StateManager } from './state.js';
import { getSessionScopedMetrics } from './session-metrics.js';
export function registerDispatchTools(server, engine, batchManager, projectDir, metricsManager, sessionManager) {
    const scopedStateManagers = new Map();
    function getScopedStateManager(sessionDir) {
        const existing = scopedStateManagers.get(sessionDir);
        if (existing) {
            return existing;
        }
        const stateManager = new StateManager(projectDir, sessionDir);
        scopedStateManagers.set(sessionDir, stateManager);
        return stateManager;
    }
    async function resolveSessionScope(sessionId) {
        if (!sessionId) {
            return undefined;
        }
        if (!sessionManager) {
            throw new Error('Session manager is required for session-scoped dispatch');
        }
        const sessionDir = sessionManager.exists(sessionId)
            ? sessionManager.resolve(sessionId)
            : await sessionManager.create(sessionId);
        return {
            sessionDir,
            stateManager: getScopedStateManager(sessionDir),
        };
    }
    function errorResponse(text) {
        return {
            content: [{ type: 'text', text }],
            isError: true,
        };
    }
    function validateBatchOwnership(batchId, sessionId) {
        const owner = batchManager.getBatchOwner(batchId);
        switch (owner.kind) {
            case 'not_found':
                return errorResponse(`Batch not found: ${batchId}`);
            case 'unowned':
                return null;
            case 'owned':
                if (sessionId === undefined) {
                    return errorResponse(`Batch ${batchId} is owned by a session and requires session_id parameter`);
                }
                if (owner.sessionId !== sessionId) {
                    return errorResponse(`Batch ${batchId} is not owned by session ${sessionId}`);
                }
                return null;
        }
    }
    async function resolveLimitStatus(config, pipelineId, sessionDir) {
        const limitStatus = await metricsManager.getLimitStatus(config, pipelineId);
        if (!sessionDir || pipelineId === null || limitStatus.dispatches_used > 0) {
            return limitStatus;
        }
        const sessionMetrics = await getSessionScopedMetrics(metricsManager, pipelineId, sessionDir);
        const dispatchesUsed = sessionMetrics.length;
        return {
            dispatches_used: dispatchesUsed,
            max_dispatches: limitStatus.max_dispatches,
            at_limit: limitStatus.max_dispatches !== undefined
                ? dispatchesUsed >= limitStatus.max_dispatches
                : false,
        };
    }
    server.registerTool('invoke_dispatch', {
        description: 'Dispatch a single agent by role and subrole. Blocks until the agent completes.',
        inputSchema: z.object({
            role: z.string().describe('Top-level role group (e.g. researcher, reviewer, builder)'),
            subrole: z.string().describe('Specific sub-role (e.g. security, codebase, default)'),
            task_context: z.record(z.string(), z.string()).describe('Template variables to inject into the prompt'),
            work_dir: z.string().optional().describe('Override working directory for the agent'),
        }),
    }, async ({ role, subrole, task_context, work_dir }) => {
        try {
            const result = await engine.dispatch({
                role,
                subrole,
                taskContext: task_context,
                workDir: work_dir,
            });
            return {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
        }
        catch (err) {
            return {
                content: [{ type: 'text', text: `Dispatch error: ${err instanceof Error ? err.message : String(err)}` }],
                isError: true,
            };
        }
    });
    server.registerTool('invoke_dispatch_batch', {
        description: 'Dispatch a batch of agents in parallel. Returns immediately with a batch_id for polling.',
        inputSchema: z.object({
            tasks: z.array(z.object({
                task_id: z.string(),
                role: z.string(),
                subrole: z.string(),
                task_context: z.record(z.string(), z.string()),
            })),
            create_worktrees: z.boolean().describe('Whether to create git worktrees for each task'),
            session_id: z.string().optional(),
        }),
    }, async ({ tasks, create_worktrees, session_id }) => {
        try {
            const sessionScope = await resolveSessionScope(session_id);
            const sessionStateManager = sessionScope?.stateManager;
            let boundPipelineId;
            if (sessionStateManager) {
                const state = await sessionStateManager.get();
                boundPipelineId = state?.pipeline_id ?? null;
            }
            // Read current config to report accurate provider info
            let taskProviders = [];
            let config;
            let warning;
            try {
                config = await loadConfig(projectDir);
                taskProviders = tasks.map(t => {
                    const roleConfig = config.roles[t.role]?.[t.subrole];
                    return {
                        task_id: t.task_id,
                        providers: roleConfig?.providers.map(p => ({
                            provider: p.provider,
                            model: p.model,
                            effort: p.effort,
                        })) ?? [],
                        provider_mode: roleConfig?.provider_mode ?? config.settings.default_provider_mode ?? 'parallel',
                    };
                });
            }
            catch {
                // Config read failed — return without provider info
            }
            const estimatedDispatches = taskProviders.reduce((sum, task) => {
                const mode = task.provider_mode;
                return sum + (mode === 'parallel' ? task.providers.length : 1);
            }, 0);
            if (config?.settings.max_dispatches !== undefined) {
                const pipelineId = sessionStateManager
                    ? (boundPipelineId ?? null)
                    : ((await new StateManager(projectDir).get())?.pipeline_id ?? null);
                let limitStatus;
                try {
                    // Session-scoped metrics fall back to legacy sessions/<id>/metrics.json when the
                    // migrated root metrics store is still empty. Remove this compatibility path after
                    // legacy session metrics files have been cleaned up.
                    limitStatus = await resolveLimitStatus(config, pipelineId, sessionScope?.sessionDir);
                }
                catch (err) {
                    console.error('Failed to evaluate dispatch limit — failing closed', err);
                    return errorResponse('Dispatch blocked: failed to evaluate dispatch limit');
                }
                if (limitStatus.at_limit) {
                    const pipelineLabel = pipelineId ? `pipeline ${pipelineId}` : 'active pipeline';
                    return {
                        content: [{
                                type: 'text',
                                text: `Dispatch blocked: ${pipelineLabel} has reached the max_dispatches limit (${limitStatus.dispatches_used}/${limitStatus.max_dispatches} dispatches used).`,
                            }],
                        isError: true,
                    };
                }
                const projectedDispatches = limitStatus.dispatches_used + estimatedDispatches;
                if (projectedDispatches > limitStatus.max_dispatches) {
                    warning = `Exceeding max_dispatches limit (${projectedDispatches}/${limitStatus.max_dispatches})`;
                }
                else if (projectedDispatches / limitStatus.max_dispatches > 0.8) {
                    warning = `Approaching max_dispatches limit (${projectedDispatches}/${limitStatus.max_dispatches})`;
                }
            }
            const maxParallel = config?.settings?.max_parallel_agents;
            const batchId = await batchManager.dispatchBatch({
                tasks: tasks.map(t => ({
                    taskId: t.task_id,
                    role: t.role,
                    subrole: t.subrole,
                    taskContext: t.task_context,
                })),
                createWorktrees: create_worktrees,
                maxParallel,
                ...(session_id ? { sessionId: session_id, boundPipelineId } : {}),
            }, {
                stateManager: sessionStateManager,
            });
            return {
                content: [{ type: 'text', text: JSON.stringify({
                            batch_id: batchId,
                            status: 'dispatched',
                            tasks: taskProviders,
                            dispatch_estimate: estimatedDispatches,
                            warning,
                        }) }],
            };
        }
        catch (err) {
            return errorResponse(`Dispatch error: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    server.registerTool('invoke_get_batch_status', {
        description: 'Get the status of a dispatched batch. Waits up to `wait` seconds (default 60) for a status change before returning. Returns immediately if the batch is already complete or if any agent status changes.',
        inputSchema: z.object({
            batch_id: z.string().describe('The batch ID returned by invoke_dispatch_batch'),
            wait: z.number().optional().describe('Max seconds to wait for a status change (default 60, 0 for immediate)'),
            session_id: z.string().optional().describe('Session ID required for session-owned batches; optional for legacy unowned batches'),
        }),
    }, async ({ batch_id, wait, session_id }) => {
        const ownershipError = validateBatchOwnership(batch_id, session_id);
        if (ownershipError) {
            return ownershipError;
        }
        const waitSeconds = wait ?? 60;
        const status = waitSeconds > 0
            ? await batchManager.waitForStatus(batch_id, waitSeconds)
            : batchManager.getStatus(batch_id);
        if (!status) {
            return errorResponse(`Batch not found: ${batch_id}`);
        }
        const projectedStatus = {
            batchId: status.batchId,
            status: status.status,
            agents: status.agents.map(agent => ({
                taskId: agent.taskId,
                status: agent.status,
            })),
        };
        return {
            content: [{ type: 'text', text: JSON.stringify(projectedStatus, null, 2) }],
        };
    });
    server.registerTool('invoke_get_task_result', {
        description: 'Get the full result for a terminal task in a dispatched batch.',
        inputSchema: z.object({
            batch_id: z.string().describe('The batch ID returned by invoke_dispatch_batch'),
            task_id: z.string().describe('The task ID to fetch the terminal result for'),
            session_id: z.string().optional().describe('Session ID required for session-owned batches; optional for legacy unowned batches'),
        }),
    }, async ({ batch_id, task_id, session_id }) => {
        const ownershipError = validateBatchOwnership(batch_id, session_id);
        if (ownershipError) {
            return ownershipError;
        }
        const result = batchManager.getTaskResult(batch_id, task_id);
        switch (result.kind) {
            case 'ok':
                return {
                    content: [{ type: 'text', text: JSON.stringify(result.result, null, 2) }],
                };
            case 'batch_not_found':
                return errorResponse(`Batch not found: ${batch_id}`);
            case 'task_not_found':
                return errorResponse(`Task not found in batch ${batch_id}: ${task_id}`);
            case 'not_terminal':
                return errorResponse(`Task not in terminal state; keep polling (current status: ${result.status})`);
            case 'no_result':
                return errorResponse(`Task reached terminal state without a stored result in batch ${batch_id}: ${task_id}`);
        }
    });
    server.registerTool('invoke_cancel_batch', {
        description: 'Cancel a running batch and kill its agents.',
        inputSchema: z.object({
            batch_id: z.string().describe('The batch ID to cancel'),
            session_id: z.string().optional().describe('Session ID required for session-owned batches; optional for legacy unowned batches'),
        }),
    }, async ({ batch_id, session_id }) => {
        const ownershipError = validateBatchOwnership(batch_id, session_id);
        if (ownershipError) {
            return ownershipError;
        }
        batchManager.cancel(batch_id);
        return {
            content: [{ type: 'text', text: JSON.stringify({ batch_id, status: 'cancelled' }) }],
        };
    });
}
//# sourceMappingURL=dispatch-tools.js.map