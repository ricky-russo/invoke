#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

try {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const sentinelPath = path.join(projectDir, '.invoke', '.skill-active');
  if (fs.existsSync(sentinelPath)) {
    fs.unlinkSync(sentinelPath);
  }
} catch (error) {}
