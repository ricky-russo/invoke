import type { InvokeConfig } from './types.js';
export interface ValidationWarning {
    level: 'error' | 'warning';
    path: string;
    message: string;
    suggestion?: string;
}
export interface ValidationResult {
    valid: boolean;
    warnings: ValidationWarning[];
}
export declare function isValidModelForProvider(provider: string, model: string, cli?: string): boolean;
export declare function checkCliExists(cli: string): boolean;
export declare function validateConfig(config: InvokeConfig, projectDir: string): Promise<ValidationResult>;
//# sourceMappingURL=config-validator.d.ts.map