export class ConfigDrivenProvider {
    config;
    name;
    constructor(name, config) {
        this.config = config;
        this.name = name;
    }
    buildCommand(params) {
        const args = this.config.args.map(arg => arg
            .replace('{{model}}', params.model)
            .replace('{{effort}}', params.effort));
        args.push(params.prompt);
        return { cmd: this.config.cli, args, cwd: params.workDir };
    }
}
//# sourceMappingURL=generic.js.map