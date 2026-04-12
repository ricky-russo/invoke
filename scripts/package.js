#!/usr/bin/env node

import { cpSync, mkdirSync } from 'node:fs';
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

console.log('Bundle complete → plugin/dist/');
