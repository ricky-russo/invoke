import type { InvokeConfig } from '../types.js';
export interface PostMergeResult {
    commands: {
        command: string;
        success: boolean;
        output: string;
    }[];
}
export declare function runPostMergeCommands(config: InvokeConfig, projectDir: string): PostMergeResult;
//# sourceMappingURL=post-merge.d.ts.map