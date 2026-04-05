import type { SessionInfo } from '../types.js';
export declare class SessionManager {
    private readonly invokeDir;
    private readonly sessionsDir;
    constructor(projectDir: string);
    create(sessionId: string): Promise<string>;
    resolve(sessionId: string): string;
    list(): Promise<SessionInfo[]>;
    isStale(sessionId: string, staleDays?: number): Promise<boolean>;
    migrate(): Promise<{
        migrated: boolean;
        sessionId?: string;
    }>;
    cleanup(sessionId: string): Promise<void>;
    exists(sessionId: string): boolean;
    private getSessionDir;
    private getStatePath;
    private getLegacyStatePath;
    private getLegacyMetricsPath;
    private readState;
    private readSessionInfo;
    private isStateStale;
    private isMissingFileError;
}
//# sourceMappingURL=manager.d.ts.map