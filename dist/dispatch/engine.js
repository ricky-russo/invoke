import { spawn } from 'child_process';
import { composePrompt } from './prompt-composer.js';
import { mergeFindings } from './merge-findings.js';
export class DispatchEngine {
    config;
    providers;
    parsers;
    projectDir;
    constructor(options) {
        this.config = options.config;
        this.providers = options.providers;
        this.parsers = options.parsers;
        this.projectDir = options.projectDir;
    }
    async dispatch(request) {
        const roleConfig = this.config.roles[request.role]?.[request.subrole];
        if (!roleConfig) {
            throw new Error(`Role not found: ${request.role}.${request.subrole}`);
        }
        const prompt = await composePrompt({
            projectDir: this.projectDir,
            promptPath: roleConfig.prompt,
            taskContext: request.taskContext,
        });
        const workDir = request.workDir ?? this.projectDir;
        // Dispatch to all providers in parallel
        const resultPromises = roleConfig.providers.map(entry => this.dispatchToProvider(entry, prompt, workDir, request));
        const results = await Promise.all(resultPromises);
        // Single provider — return directly
        if (results.length === 1) {
            return results[0];
        }
        // Multiple providers — merge results
        return this.mergeResults(results, request);
    }
    async dispatchToProvider(entry, prompt, workDir, request) {
        const provider = this.providers.get(entry.provider);
        if (!provider) {
            throw new Error(`Provider not found: ${entry.provider}. Is the CLI installed?`);
        }
        const parser = this.parsers.get(entry.provider);
        if (!parser) {
            throw new Error(`Parser not found for provider: ${entry.provider}`);
        }
        const commandSpec = provider.buildCommand({
            model: entry.model,
            effort: entry.effort,
            workDir,
            prompt,
        });
        const startTime = Date.now();
        const timeoutSeconds = entry.timeout ?? this.config.settings.agent_timeout;
        const { stdout, stderr, exitCode } = await this.runProcess(commandSpec.cmd, commandSpec.args, timeoutSeconds * 1000, commandSpec.cwd);
        const duration = Date.now() - startTime;
        // Use stderr for diagnostics when stdout is empty or command failed
        const output = stdout || (exitCode !== 0 ? `[stderr] ${stderr}` : stderr);
        return parser.parse(output, exitCode, {
            role: request.role,
            subrole: request.subrole,
            provider: entry.provider,
            model: entry.model,
            duration,
        });
    }
    mergeResults(results, request) {
        const hasFindings = results.some(r => r.output.findings && r.output.findings.length > 0);
        if (hasFindings) {
            const providerFindings = results
                .filter(r => r.output.findings)
                .map(r => ({
                provider: r.provider,
                findings: r.output.findings,
            }));
            const merged = mergeFindings(providerFindings);
            return {
                role: request.role,
                subrole: request.subrole,
                provider: results.map(r => r.provider).join('+'),
                model: results.map(r => r.model).join('+'),
                status: results.every(r => r.status === 'success') ? 'success' : 'error',
                output: {
                    summary: `Merged results from ${results.length} providers (${merged.length} findings)`,
                    findings: merged,
                    raw: results.map(r => `--- ${r.provider} ---\n${r.output.raw}`).join('\n\n'),
                },
                duration: Math.max(...results.map(r => r.duration)),
            };
        }
        // Non-reviewer: concatenate reports
        return {
            role: request.role,
            subrole: request.subrole,
            provider: results.map(r => r.provider).join('+'),
            model: results.map(r => r.model).join('+'),
            status: results.every(r => r.status === 'success') ? 'success' : 'error',
            output: {
                summary: `Combined results from ${results.length} providers`,
                report: results.map(r => `## ${r.provider} (${r.model})\n\n${r.output.report ?? r.output.raw}`).join('\n\n---\n\n'),
                raw: results.map(r => `--- ${r.provider} ---\n${r.output.raw}`).join('\n\n'),
            },
            duration: Math.max(...results.map(r => r.duration)),
        };
    }
    runProcess(cmd, args, timeout, cwd) {
        return new Promise((resolve, reject) => {
            const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], cwd });
            let stdout = '';
            let stderr = '';
            let timedOut = false;
            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            const timer = setTimeout(() => {
                timedOut = true;
                proc.kill('SIGTERM');
            }, timeout);
            proc.on('close', (code) => {
                clearTimeout(timer);
                if (timedOut) {
                    resolve({ stdout: stdout || `Agent timed out after ${timeout}ms`, stderr, exitCode: -1 });
                }
                else {
                    resolve({ stdout, stderr, exitCode: code ?? 1 });
                }
            });
            proc.on('error', (err) => {
                clearTimeout(timer);
                reject(new Error(`Failed to spawn ${cmd}: ${err.message}. Is the CLI installed?`));
            });
        });
    }
}
//# sourceMappingURL=engine.js.map