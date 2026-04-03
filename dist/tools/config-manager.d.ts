import type { InvokeConfig, ProviderEntry, StrategyConfig } from '../types.js';
interface AddRoleOperation {
    operation: 'add_role';
    role: string;
    subrole: string;
    config: {
        prompt: string;
        providers: ProviderEntry[];
    };
}
interface RemoveRoleOperation {
    operation: 'remove_role';
    role: string;
    subrole: string;
}
interface AddStrategyOperation {
    operation: 'add_strategy';
    strategy: string;
    config: StrategyConfig;
}
interface RemoveStrategyOperation {
    operation: 'remove_strategy';
    strategy: string;
}
interface UpdateSettingsOperation {
    operation: 'update_settings';
    settings: Record<string, unknown>;
}
export type ConfigOperation = AddRoleOperation | RemoveRoleOperation | AddStrategyOperation | RemoveStrategyOperation | UpdateSettingsOperation;
export declare class ConfigManager {
    private projectDir;
    private configPath;
    constructor(projectDir: string);
    execute(op: ConfigOperation): Promise<InvokeConfig>;
    private addRole;
    private removeRole;
    private addStrategy;
    private removeStrategy;
    private updateSettings;
    private readRaw;
    private writeAndReload;
}
export {};
//# sourceMappingURL=config-manager.d.ts.map