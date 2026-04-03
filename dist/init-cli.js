#!/usr/bin/env node
import { initProject } from './init.js';
const projectDir = process.argv[2] || process.cwd();
console.log(`Initializing invoke project config in ${projectDir}...`);
initProject(projectDir)
    .then(() => {
    console.log('');
    console.log('invoke project config created!');
    console.log('');
    console.log('What was set up:');
    console.log('  .invoke/pipeline.yaml  Pipeline config (providers, roles, strategies)');
    console.log('  .invoke/roles/         Default role prompts');
    console.log('  .invoke/strategies/    Default strategy prompts');
    console.log('  .invoke/specs/         Output directory for specs');
    console.log('  .invoke/plans/         Output directory for plans');
    console.log('  .invoke/reviews/       Output directory for reviews');
    console.log('');
    console.log('The invoke plugin handles skills, hooks, and MCP server registration.');
    console.log('Review .invoke/pipeline.yaml to customize providers and models.');
})
    .catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
});
//# sourceMappingURL=init-cli.js.map