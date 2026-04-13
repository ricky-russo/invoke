#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const STAGE_SKILLS = new Set([
  'invoke:invoke-scope',
  'invoke:invoke-plan',
  'invoke:invoke-orchestrate',
  'invoke:invoke-build',
  'invoke:invoke-review',
  'invoke:invoke-resume',
]);

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const skill = input?.tool_input?.skill;

  if (typeof skill !== 'string') {
    process.exit(0);
  }

  if (!STAGE_SKILLS.has(skill)) {
    process.exit(0);
  }

  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const invokeDir = path.join(projectDir, '.invoke');
  const sentinelPath = path.join(invokeDir, '.skill-active');

  fs.mkdirSync(invokeDir, { recursive: true });
  fs.writeFileSync(sentinelPath, JSON.stringify({ skill, ts: Date.now() }));
} catch (error) {
  console.error(error);
}
