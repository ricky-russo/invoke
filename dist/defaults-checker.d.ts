export interface MissingDefault {
    relativePath: string;
    description: string;
}
export declare function checkForNewDefaults(projectDir: string): Promise<MissingDefault[]>;
//# sourceMappingURL=defaults-checker.d.ts.map