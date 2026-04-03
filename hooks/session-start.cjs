#!/usr/bin/env node

// Session-start hook for Claude Code
// Injects the invoke-start gateway skill into Claude's context and
// detects active pipelines for resume.

const fs = require('fs');
const path = require('path');

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '..');
const skillPath = path.join(pluginRoot, 'skills', 'invoke-start', 'SKILL.md');
const statePath = path.join(process.cwd(), '.invoke', 'state.json');

function escapeForJson(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

try {
  // Read the gateway skill content
  let skillContent = '';
  try {
    skillContent = fs.readFileSync(skillPath, 'utf-8');
  } catch (e) {
    // Skill file missing — fall back to minimal directive
    skillContent = 'Invoke pipeline is installed. Use invoke skills for all development work.';
  }

  // Check for active pipeline
  let pipelineNotice = '';
  try {
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      if (state.current_stage && state.current_stage !== 'complete') {
        pipelineNotice = `\\n\\nACTIVE PIPELINE DETECTED — Stage: ${state.current_stage}, Started: ${state.started}. You MUST use invoke-resume to continue this pipeline.`;
      }
    }
  } catch (e) {
    // Ignore state read errors
  }

  const context = `<EXTREMELY_IMPORTANT>\\nThis project uses the invoke development pipeline.\\n\\n**Below is the full content of the 'invoke:invoke-start' skill — your guide to routing all development work through invoke. For all other invoke skills, use the Skill tool:**\\n\\n${escapeForJson(skillContent)}${pipelineNotice}\\n</EXTREMELY_IMPORTANT>`;

  // Output in the format Claude Code expects
  const output = `{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": "${context}"\n  }\n}`;

  console.log(output);
} catch (e) {
  // Silently ignore — don't block session start
}
