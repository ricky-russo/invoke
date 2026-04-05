import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DispatchEngine } from '../dispatch/engine.js';
import type { BatchManager } from '../dispatch/batch-manager.js';
import type { MetricsManager } from '../metrics/manager.js';
import type { SessionManager } from '../session/manager.js';
export declare function registerDispatchTools(server: McpServer, engine: DispatchEngine, batchManager: BatchManager, projectDir: string, metricsManager: MetricsManager, sessionManager?: SessionManager): void;
//# sourceMappingURL=dispatch-tools.d.ts.map