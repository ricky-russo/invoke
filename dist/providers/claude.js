export class ClaudeProvider {
    config;
    name = 'claude';
    constructor(config) {
        this.config = config;
    }
    buildCommand(params) {
        const args = this.config.args.map(arg => arg
            .replace('{{model}}', params.model)
            .replace('{{effort}}', params.effort));
        args.push(params.prompt);
        return { cmd: this.config.cli, args, cwd: params.workDir };
    }
}
//# sourceMappingURL=claude.js.map