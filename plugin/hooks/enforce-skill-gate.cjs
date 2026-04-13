#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const reason = 'Invoke pipeline requires a loaded skill before editing files. Route this work through the appropriate invoke skill (e.g., invoke-scope for new work, invoke-resume to continue).';

function output(permissionDecision, permissionDecisionReason) {
  const payload = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision,
    },
  };

  if (permissionDecisionReason) {
    payload.hookSpecificOutput.permissionDecisionReason = permissionDecisionReason;
  }

  console.log(JSON.stringify(payload));
}

try {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const invokeDir = path.join(projectDir, '.invoke');
  const sentinelPath = path.join(invokeDir, '.skill-active');

  if (!fs.existsSync(invokeDir)) {
    output('deny', reason);
    process.exit(0);
  }

  if (fs.existsSync(sentinelPath)) {
    output('allow');
    process.exit(0);
  }

  output('deny', reason);
} catch (error) {
  console.error(error);
  output('allow');
}
