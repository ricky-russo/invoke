import { readFile } from 'fs/promises';
import path from 'path';
import { parse } from 'yaml';
import { z } from 'zod';
const ProviderConfigSchema = z.object({
    cli: z.string(),
    args: z.array(z.string()),
});
const ProviderEntrySchema = z.object({
    provider: z.string(),
    model: z.string(),
    effort: z.enum(['low', 'medium', 'high']),
    timeout: z.number().positive().optional(),
});
// Accept either single-provider shorthand or providers array
const RawRoleConfigSchema = z.object({
    prompt: z.string(),
    // Single-provider shorthand fields (optional)
    provider: z.string().optional(),
    model: z.string().optional(),
    effort: z.enum(['low', 'medium', 'high']).optional(),
    // Multi-provider array (optional)
    providers: z.array(ProviderEntrySchema).optional(),
});
const StrategyConfigSchema = z.object({
    prompt: z.string(),
});
const SettingsSchema = z.object({
    default_strategy: z.string(),
    agent_timeout: z.number().positive(),
    commit_style: z.enum(['one-commit', 'per-batch', 'per-task', 'custom']),
    work_branch_prefix: z.string(),
    post_merge_commands: z.array(z.string()).optional(),
});
const RawInvokeConfigSchema = z.object({
    providers: z.record(z.string(), ProviderConfigSchema),
    roles: z.record(z.string(), z.record(z.string(), RawRoleConfigSchema)),
    strategies: z.record(z.string(), StrategyConfigSchema),
    settings: SettingsSchema,
});
function normalizeConfig(raw) {
    const roles = {};
    for (const [roleGroup, subroles] of Object.entries(raw.roles)) {
        roles[roleGroup] = {};
        for (const [subroleName, subrole] of Object.entries(subroles)) {
            if (subrole.providers && subrole.providers.length > 0) {
                roles[roleGroup][subroleName] = {
                    prompt: subrole.prompt,
                    providers: subrole.providers,
                };
            }
            else if (subrole.provider && subrole.model && subrole.effort) {
                roles[roleGroup][subroleName] = {
                    prompt: subrole.prompt,
                    providers: [{
                            provider: subrole.provider,
                            model: subrole.model,
                            effort: subrole.effort,
                        }],
                };
            }
            else {
                throw new Error(`Role ${roleGroup}.${subroleName} must have either 'providers' array or 'provider'/'model'/'effort' fields`);
            }
        }
    }
    return {
        providers: raw.providers,
        roles,
        strategies: raw.strategies,
        settings: raw.settings,
    };
}
export async function loadConfig(projectDir) {
    const configPath = path.join(projectDir, '.invoke', 'pipeline.yaml');
    const content = await readFile(configPath, 'utf-8');
    const raw = parse(content);
    const validated = RawInvokeConfigSchema.parse(raw);
    return normalizeConfig(validated);
}
//# sourceMappingURL=config.js.map