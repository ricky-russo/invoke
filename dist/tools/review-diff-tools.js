import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { sanitizeReviewedSha } from './reviewed-sha.js';
import { resolveSessionWorkBranchPath } from './session-path.js';
const MAX_DIFF_BUFFER_BYTES = 50 * 1024 * 1024;
const DIFF_SIZE_WARN_BYTES = 48 * 1024 * 1024;
const ReviewDiffInputSchema = z.object({
    session_id: z.string(),
    reviewed_sha: z.string(),
});
const NOT_SUPPORTED_MESSAGE = 'Session has no worktree; review-diff tool requires a per-session worktree';
function ok(result) {
    return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
    };
}
function formatExecError(error) {
    if (typeof error === 'object' && error !== null && 'stderr' in error) {
        const stderr = error.stderr;
        if (Buffer.isBuffer(stderr)) {
            const message = stderr.toString().trim();
            if (message) {
                return message;
            }
        }
        else if (typeof stderr === 'string' && stderr.trim()) {
            return stderr.trim();
        }
    }
    return error instanceof Error ? error.message : String(error);
}
export function registerReviewDiffTools(server, sessionManager, projectDir) {
    server.registerTool('invoke_compute_review_diff', {
        description: 'Compute the diff between a reviewed commit SHA and the current session HEAD.',
        inputSchema: ReviewDiffInputSchema,
    }, async ({ session_id, reviewed_sha }) => {
        let worktreePath;
        try {
            worktreePath = await resolveSessionWorkBranchPath(sessionManager, projectDir, session_id);
        }
        catch (error) {
            return ok({
                status: 'resolve_error',
                message: error instanceof Error ? error.message : String(error),
            });
        }
        if (!worktreePath) {
            return ok({
                status: 'not_supported',
                message: NOT_SUPPORTED_MESSAGE,
            });
        }
        const sanitizedReviewedSha = sanitizeReviewedSha(reviewed_sha);
        if (sanitizedReviewedSha === undefined) {
            return ok({
                status: 'invalid_reviewed_sha',
                message: 'reviewed_sha failed hex validation',
            });
        }
        try {
            execFileSync('git', ['rev-parse', '--verify', `${sanitizedReviewedSha}^{commit}`], {
                cwd: worktreePath,
                stdio: 'pipe',
                timeout: 10000,
                maxBuffer: MAX_DIFF_BUFFER_BYTES,
            });
        }
        catch (error) {
            return ok({
                status: 'commit_not_found',
                message: formatExecError(error),
            });
        }
        let diffBuffer;
        try {
            diffBuffer = execFileSync('git', ['diff', `${sanitizedReviewedSha}...HEAD`], {
                cwd: worktreePath,
                stdio: 'pipe',
                timeout: 30000,
                maxBuffer: MAX_DIFF_BUFFER_BYTES,
            });
        }
        catch (error) {
            return ok({
                status: 'diff_error',
                message: formatExecError(error),
            });
        }
        if (diffBuffer.length > DIFF_SIZE_WARN_BYTES) {
            return ok({
                status: 'diff_too_large',
                message: `Review diff is ${diffBuffer.length} bytes (threshold ${DIFF_SIZE_WARN_BYTES}); reviewer will fall back to full diff`,
            });
        }
        return ok({
            status: 'ok',
            reviewed_sha: sanitizedReviewedSha,
            diff: diffBuffer.toString(),
        });
    });
}
//# sourceMappingURL=review-diff-tools.js.map