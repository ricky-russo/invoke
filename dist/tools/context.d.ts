export declare class ContextManager {
    private projectDir;
    private contextPath;
    constructor(projectDir: string);
    get(maxLength?: number): Promise<string | null>;
    exists(): boolean;
    initialize(content: string): Promise<void>;
    updateSection(sectionName: string, content: string, mode: 'replace' | 'append'): Promise<void>;
}
//# sourceMappingURL=context.d.ts.map