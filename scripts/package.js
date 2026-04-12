#!/usr/bin/env node

import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const plugin = join(root, 'plugin');

// 1. Clean plugin/ directory
rmSync(plugin, { recursive: true, force: true });
mkdirSync(plugin, { recursive: true });

// 2. Copy dist/ → plugin/dist/ (esbuild output only: index.js and init-cli.js)
mkdirSync(join(plugin, 'dist'));
for (const file of ['index.js', 'init-cli.js']) {
  cpSync(join(root, 'dist', file), join(plugin, 'dist', file));
}

// 3. Copy hooks/ → plugin/hooks/
cpSync(join(root, 'hooks'), join(plugin, 'hooks'), { recursive: true });

// 4. Copy skills/*/SKILL.md preserving directory structure
const skillsDir = join(root, 'skills');
for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
  if (entry.isDirectory()) {
    const src = join(skillsDir, entry.name, 'SKILL.md');
    const dest = join(plugin, 'skills', entry.name, 'SKILL.md');
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest);
  }
}

// 5. Copy defaults/ → plugin/defaults/
cpSync(join(root, 'defaults'), join(plugin, 'defaults'), { recursive: true });

// 6. Copy vendor/proper-lockfile/ → plugin/vendor/proper-lockfile/
cpSync(join(root, 'vendor', 'proper-lockfile'), join(plugin, 'vendor', 'proper-lockfile'), { recursive: true });

// 7. Copy .mcp.json → plugin/.mcp.json
cpSync(join(root, '.mcp.json'), join(plugin, '.mcp.json'));

// 8. Write plugin/.claude-plugin/plugin.json
const pluginMeta = {
  name: 'invoke',
  description: 'AI-assisted development pipeline — scope, plan, orchestrate, build, review with multi-provider agent dispatch',
  version: '0.1.0',
  author: {
    name: 'Ricky Russo',
  },
  license: 'MIT',
  keywords: [
    'pipeline',
    'agents',
    'multi-provider',
    'code-review',
    'orchestration',
    'mcp',
  ],
};

const pluginJsonDir = join(plugin, '.claude-plugin');
mkdirSync(pluginJsonDir, { recursive: true });
writeFileSync(join(pluginJsonDir, 'plugin.json'), JSON.stringify(pluginMeta, null, 2) + '\n');

console.log('Plugin packaged to plugin/');
