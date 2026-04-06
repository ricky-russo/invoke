import type { BugEntry, BugSeverity, BugStatus } from '../types.js';
interface ReportBugInput {
    title: string;
    description: string;
    severity?: BugSeverity;
    file?: string;
    line?: number;
    labels?: string[];
    session_id?: string;
}
interface ListBugsFilters {
    status?: BugStatus | 'all';
    severity?: BugSeverity;
}
interface UpdateBugChanges {
    status?: BugStatus;
    resolution?: string;
    session_id?: string;
}
export declare class BugManager {
    private bugsPath;
    constructor(projectDir: string);
    report(input: ReportBugInput): Promise<BugEntry>;
    list(filters?: ListBugsFilters): Promise<BugEntry[]>;
    update(id: string, changes: UpdateBugChanges): Promise<BugEntry>;
    private nextBugId;
    private readBugsFile;
    private writeBugsFile;
    private isMissingFileError;
}
export {};
//# sourceMappingURL=manager.d.ts.map