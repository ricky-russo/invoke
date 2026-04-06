import { z } from 'zod';
import { BugNotFoundError } from '../bugs/manager.js';
export function registerBugTools(server, bugManager) {
    server.registerTool('invoke_report_bug', {
        description: 'Report a bug discovered during a pipeline session.',
        inputSchema: z.object({
            title: z.string(),
            description: z.string(),
            severity: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
            file: z.string().optional(),
            line: z.number().optional(),
            labels: z.array(z.string()).optional().default([]),
            session_id: z.string().optional(),
        }),
    }, async ({ title, description, severity, file, line, labels, session_id }) => {
        try {
            const bug = await bugManager.report({
                title,
                description,
                severity,
                file,
                line,
                labels,
                session_id,
            });
            return {
                content: [{ type: 'text', text: JSON.stringify(bug, null, 2) }],
            };
        }
        catch (err) {
            logToolError('invoke_report_bug', err);
            return errorResponse('Failed to report bug');
        }
    });
    server.registerTool('invoke_list_bugs', {
        description: 'List bugs, optionally filtered by status and severity.',
        inputSchema: z.object({
            status: z.enum(['open', 'in_progress', 'resolved', 'all']).default('open'),
            severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
        }),
    }, async ({ status, severity }) => {
        try {
            const bugs = await bugManager.list({ status, severity });
            return {
                content: [{ type: 'text', text: JSON.stringify(bugs, null, 2) }],
            };
        }
        catch (err) {
            logToolError('invoke_list_bugs', err);
            return errorResponse('Failed to list bugs');
        }
    });
    server.registerTool('invoke_update_bug', {
        description: 'Update a bug entry (status, resolution, etc).',
        inputSchema: z.object({
            bug_id: z.string(),
            status: z.enum(['open', 'in_progress', 'resolved']).optional(),
            resolution: z.string().optional(),
            session_id: z.string().optional(),
        }),
    }, async ({ bug_id, status, resolution, session_id }) => {
        try {
            const bug = await bugManager.update(bug_id, {
                status,
                resolution,
                session_id,
            });
            return {
                content: [{ type: 'text', text: JSON.stringify(bug, null, 2) }],
            };
        }
        catch (err) {
            logToolError('invoke_update_bug', err);
            if (err instanceof BugNotFoundError) {
                return errorResponse(`Bug not found: ${bug_id}`);
            }
            return errorResponse('Failed to update bug');
        }
    });
}
function errorResponse(message) {
    return {
        content: [{ type: 'text', text: message }],
        isError: true,
    };
}
function logToolError(toolName, error) {
    console.error(`[bug-tools] ${toolName} failed`, error);
}
//# sourceMappingURL=bug-tools.js.map