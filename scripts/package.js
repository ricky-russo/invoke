#!/usr/bin/env node

import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const plugin = join(root, 'plugin');

// Update plugin/dist/ with fresh esbuild output (index.js and init-cli.js)
mkdirSync(join(plugin, 'dist'), { recursive: true });
for (const file of ['index.js', 'init-cli.js']) {
  cpSync(join(root, 'dist', file), join(plugin, 'dist', file));
}

const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const pluginJsonPath = join(plugin, '.claude-plugin', 'plugin.json');
const pluginJson = JSON.parse(readFileSync(pluginJsonPath, 'utf8'));

pluginJson.version = packageJson.version;

writeFileSync(pluginJsonPath, `${JSON.stringify(pluginJson, null, 2)}\n`);

console.log(`Bundle complete → plugin/dist/ (version ${packageJson.version})`);
