import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { parse, stringify } from 'yaml';
export class ConfigManager {
    projectDir;
    configPath;
    constructor(projectDir) {
        this.projectDir = projectDir;
        this.configPath = path.join(projectDir, '.invoke', 'pipeline.yaml');
    }
    async execute(op) {
        const raw = await this.readRaw();
        switch (op.operation) {
            case 'add_role':
                return this.addRole(raw, op);
            case 'remove_role':
                return this.removeRole(raw, op);
            case 'add_strategy':
                return this.addStrategy(raw, op);
            case 'remove_strategy':
                return this.removeStrategy(raw, op);
            case 'update_settings':
                return this.updateSettings(raw, op);
        }
    }
    async addRole(raw, op) {
        if (!raw.roles[op.role]) {
            raw.roles[op.role] = {};
        }
        if (raw.roles[op.role][op.subrole]) {
            throw new Error(`Role ${op.role}.${op.subrole} already exists`);
        }
        raw.roles[op.role][op.subrole] = {
            prompt: op.config.prompt,
            providers: op.config.providers,
        };
        return this.writeAndReload(raw);
    }
    async removeRole(raw, op) {
        if (!raw.roles[op.role]?.[op.subrole]) {
            throw new Error(`Role ${op.role}.${op.subrole} not found`);
        }
        delete raw.roles[op.role][op.subrole];
        return this.writeAndReload(raw);
    }
    async addStrategy(raw, op) {
        if (raw.strategies[op.strategy]) {
            throw new Error(`Strategy ${op.strategy} already exists`);
        }
        raw.strategies[op.strategy] = op.config;
        return this.writeAndReload(raw);
    }
    async removeStrategy(raw, op) {
        if (!raw.strategies[op.strategy]) {
            throw new Error(`Strategy ${op.strategy} not found`);
        }
        delete raw.strategies[op.strategy];
        return this.writeAndReload(raw);
    }
    async updateSettings(raw, op) {
        raw.settings = { ...raw.settings, ...op.settings };
        return this.writeAndReload(raw);
    }
    async readRaw() {
        const content = await readFile(this.configPath, 'utf-8');
        return parse(content);
    }
    async writeAndReload(raw) {
        await writeFile(this.configPath, stringify(raw));
        // Re-read through the normal config loader to validate and normalize
        const { loadConfig } = await import('../config.js');
        return loadConfig(this.projectDir);
    }
}
//# sourceMappingURL=config-manager.js.map