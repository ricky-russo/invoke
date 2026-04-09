import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../session/manager.js';
export type ReviewDiffResult = {
    status: 'ok';
    reviewed_sha: string;
    diff: string;
} | {
    status: 'invalid_reviewed_sha';
    message: string;
} | {
    status: 'commit_not_found';
    message: string;
} | {
    status: 'diff_error';
    message: string;
} | {
    status: 'not_supported';
    message: string;
};
export declare function registerReviewDiffTools(server: McpServer, sessionManager: SessionManager, projectDir: string): void;
//# sourceMappingURL=review-diff-tools.d.ts.map