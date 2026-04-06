import { z } from 'zod';
import { loadConfig } from '../config.js';
import { StateManager } from './state.js';
export function registerDispatchTools(server, engine, batchManager, projectDir, metricsManager, sessionManager) {
    async function resolveBatchManager(sessionId) {
        if (!sessionId) {
            return batchManager;
        }
        if (!sessionManager) {
            throw new Error('Session manager is required for session-scoped dispatch');
        }
        const sessionDir = sessionManager.exists(sessionId)
            ? sessionManager.resolve(sessionId)
            : await sessionManager.create(sessionId);
        return Object.assign(Object.create(Object.getPrototypeOf(batchManager)), batchManager, {
            stateManager: new StateManager(projectDir, sessionDir),
        });
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
            try {
                const limitStatus = await metricsManager.getLimitStatus(config);
                const projectedDispatches = limitStatus.dispatches_used + estimatedDispatches;
                if (projectedDispatches > limitStatus.max_dispatches) {
                    warning = `Exceeding max_dispatches limit (${projectedDispatches}/${limitStatus.max_dispatches})`;
                }
                else if (projectedDispatches / limitStatus.max_dispatches > 0.8) {
                    warning = `Approaching max_dispatches limit (${projectedDispatches}/${limitStatus.max_dispatches})`;
                }
            }
            catch {
                // Metrics lookup failed — omit warning without blocking dispatch
            }
        }
        const maxParallel = config?.settings?.max_parallel_agents;
        const activeBatchManager = await resolveBatchManager(session_id);
        const batchId = await activeBatchManager.dispatchBatch({
            tasks: tasks.map(t => ({
                taskId: t.task_id,
                role: t.role,
                subrole: t.subrole,
                taskContext: t.task_context,
            })),
            createWorktrees: create_worktrees,
            maxParallel,
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
    });
    server.registerTool('invoke_get_batch_status', {
        description: 'Get the status of a dispatched batch. Waits up to `wait` seconds (default 60) for a status change before returning. Returns immediately if the batch is already complete or if any agent status changes.',
        inputSchema: z.object({
            batch_id: z.string().describe('The batch ID returned by invoke_dispatch_batch'),
            wait: z.number().optional().describe('Max seconds to wait for a status change (default 60, 0 for immediate)'),
        }),
    }, async ({ batch_id, wait }) => {
        const waitSeconds = wait ?? 60;
        const status = waitSeconds > 0
            ? await batchManager.waitForStatus(batch_id, waitSeconds)
            : batchManager.getStatus(batch_id);
        if (!status) {
            return {
                content: [{ type: 'text', text: `Batch not found: ${batch_id}` }],
                isError: true,
            };
        }
        return {
            content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
        };
    });
    server.registerTool('invoke_cancel_batch', {
        description: 'Cancel a running batch and kill its agents.',
        inputSchema: z.object({
            batch_id: z.string().describe('The batch ID to cancel'),
        }),
    }, async ({ batch_id }) => {
        batchManager.cancel(batch_id);
        return {
            content: [{ type: 'text', text: JSON.stringify({ batch_id, status: 'cancelled' }) }],
        };
    });
}
//# sourceMappingURL=dispatch-tools.js.map