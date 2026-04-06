import { execSync } from 'child_process';
export function runPostMergeCommands(config, projectDir, cwd) {
    const commands = config.settings.post_merge_commands ?? [];
    const results = [];
    const commandCwd = cwd ?? projectDir;
    for (const command of commands) {
        try {
            const output = execSync(command, {
                cwd: commandCwd,
                stdio: 'pipe',
                timeout: 60000,
            }).toString();
            results.push({ command, success: true, output: output.slice(0, 500) });
        }
        catch (err) {
            const error = err;
            results.push({
                command,
                success: false,
                output: (error.stderr?.toString() ?? error.message ?? 'Unknown error').slice(0, 500),
            });
        }
    }
    return { commands: results };
}
//# sourceMappingURL=post-merge.js.map