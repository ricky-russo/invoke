export declare class ArtifactManager {
    private baseDir;
    constructor(projectDir: string);
    save(stage: string, filename: string, content: string): Promise<string>;
    read(stage: string, filename: string): Promise<string>;
    list(stage: string): Promise<string[]>;
    delete(stage: string, filename: string): Promise<void>;
}
//# sourceMappingURL=artifacts.d.ts.map