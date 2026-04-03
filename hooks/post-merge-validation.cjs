#!/usr/bin/env node

// Post-merge validation hook for Claude Code
// Runs after invoke_merge_worktree to catch breakage early.
// Exit code 0 = pass, non-zero = fail (reported to the AI).

const { execSync } = require('child_process');
const fs = require('fs');

const checks = [];

// Detect available checks
if (fs.existsSync('package.json')) {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
  const scripts = pkg.scripts || {};

  if (scripts.typecheck || scripts['type-check']) {
    checks.push({ name: 'typecheck', cmd: scripts.typecheck ? 'npm run typecheck' : 'npm run type-check' });
  }
  if (scripts.lint) {
    checks.push({ name: 'lint', cmd: 'npm run lint' });
  }
  if (scripts.test) {
    checks.push({ name: 'test', cmd: 'npm test' });
  }
}

if (checks.length === 0) {
  process.exit(0);
}

const failures = [];

for (const check of checks) {
  try {
    execSync(check.cmd, { stdio: 'pipe', timeout: 120000 });
  } catch (e) {
    failures.push(`${check.name} failed: ${e.stderr ? e.stderr.toString().slice(0, 500) : e.message}`);
  }
}

if (failures.length > 0) {
  console.error('Post-merge validation failed:');
  failures.forEach(f => console.error(`  - ${f}`));
  process.exit(1);
} else {
  console.log('Post-merge validation passed.');
}
