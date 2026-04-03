export class CodexProvider {
    config;
    name = 'codex';
    constructor(config) {
        this.config = config;
    }
    buildCommand(params) {
        const args = this.config.args.map(arg => arg
            .replace('{{model}}', params.model)
            .replace('{{effort}}', params.effort));
        args.push('--skip-git-repo-check');
        args.push(params.prompt);
        return { cmd: this.config.cli, args, cwd: params.workDir };
    }
}
//# sourceMappingURL=codex.js.map