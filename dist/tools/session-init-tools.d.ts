import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SessionWorktreeManager } from '../worktree/session-worktree.js';
import type { SessionManager } from '../session/manager.js';
import type { InvokeConfig } from '../types.js';
export declare function registerSessionInitTools(server: McpServer, sessionWorktreeManager: SessionWorktreeManager, sessionManager: SessionManager, config: () => InvokeConfig, projectDir: string): void;
//# sourceMappingURL=session-init-tools.d.ts.map