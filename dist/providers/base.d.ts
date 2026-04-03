export interface CommandSpec {
    cmd: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
}
export interface Provider {
    name: string;
    buildCommand(params: {
        model: string;
        effort: string;
        workDir: string;
        prompt: string;
    }): CommandSpec;
}
//# sourceMappingURL=base.d.ts.map