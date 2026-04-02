#!/usr/bin/env node

// Session-start hook for Claude Code
// Detects an active invoke pipeline and nudges the AI to resume it.

const fs = require('fs');
const path = require('path');

const statePath = path.join(process.cwd(), '.invoke', 'state.json');

try {
  if (fs.existsSync(statePath)) {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    if (state.current_stage && state.current_stage !== 'complete') {
      console.log(
        `Active invoke pipeline detected (stage: ${state.current_stage}, ` +
        `started: ${state.started}). ` +
        `Use invoke-resume to continue.`
      );
    }
  }
} catch (e) {
  // Silently ignore — don't block session start
}
