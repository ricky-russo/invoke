#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const ONE_HOUR_MS = 60 * 60 * 1000;
const REMOTE_URL = process.env.INVOKE_VERSION_CHECK_URL || 'https://raw.githubusercontent.com/ricky-russo/invoke/main/package.json';
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function compareVersions(localVersion, remoteVersion) {
  const localParts = localVersion.split('.').map(part => parseInt(part, 10));
  const remoteParts = remoteVersion.split('.').map(part => parseInt(part, 10));

  for (let index = 0; index < 3; index += 1) {
    const localPart = localParts[index] || 0;
    const remotePart = remoteParts[index] || 0;

    if (remotePart > localPart) {
      return 1;
    }

    if (remotePart < localPart) {
      return -1;
    }
  }

  return 0;
}

function fetchLatestVersion() {
  return new Promise((resolve, reject) => {
    const proto = REMOTE_URL.startsWith('https:') ? https : http;
    let settled = false;
    let req;
    const wallClockTimer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      if (req) {
        req.destroy(new Error('Wall-clock timeout'));
      }
      reject(new Error('Wall-clock timeout'));
    }, 3000);
    const settle = (fn, value) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(wallClockTimer);
      fn(value);
    };

    req = proto.get(REMOTE_URL, res => {
      if (res.statusCode !== 200) {
        res.resume();
        settle(reject, new Error(`Unexpected status code: ${res.statusCode}`));
        return;
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const version = JSON.parse(body).version;
          if (typeof version !== 'string' || !SEMVER_RE.test(version)) {
            settle(reject, new Error('Invalid remote version'));
            return;
          }

          settle(resolve, version);
        } catch (error) {
          settle(reject, error);
        }
      });
    });

    req.setTimeout(3000, () => {
      req.destroy(new Error('Request timed out'));
      settle(reject, new Error('Request timed out'));
    });

    req.on('error', error => {
      settle(reject, error);
    });
  });
}

async function main() {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const invokeDir = path.join(projectDir, '.invoke');

  if (!fs.existsSync(invokeDir)) {
    return;
  }

  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '..');
  const pluginJsonPath = path.join(pluginRoot, '.claude-plugin', 'plugin.json');
  const cachePath = path.join(invokeDir, '.version-check');
  const localVersion = readJson(pluginJsonPath).version;

  let latestVersion;

  try {
    if (fs.existsSync(cachePath)) {
      const invokeDirStats = fs.lstatSync(invokeDir);
      const cachePathStats = fs.lstatSync(cachePath);
      if (!invokeDirStats.isSymbolicLink() && !cachePathStats.isSymbolicLink()) {
        const cache = readJson(cachePath);
        const checkedAt = cache.checked_at;
        const cacheAge = Date.now() - checkedAt;
        if (Number.isFinite(checkedAt) && cacheAge >= 0 && cacheAge < ONE_HOUR_MS) {
          latestVersion = cache.latest_version;
          if (typeof latestVersion !== 'string' || !SEMVER_RE.test(latestVersion)) {
            latestVersion = undefined;
          }
        }
      }
    }
  } catch (error) {
    latestVersion = undefined;
  }

  if (!latestVersion) {
    latestVersion = await fetchLatestVersion();
    try {
      const invokeDirStats = fs.lstatSync(invokeDir);
      if (invokeDirStats.isDirectory()) {
        const flags =
          fs.constants.O_WRONLY |
          fs.constants.O_CREAT |
          fs.constants.O_TRUNC |
          fs.constants.O_NOFOLLOW;
        const fd = fs.openSync(cachePath, flags, 0o644);
        try {
          fs.writeSync(
            fd,
            JSON.stringify({
              latest_version: latestVersion,
              checked_at: Date.now()
            })
          );
        } finally {
          fs.closeSync(fd);
        }
      }
    } catch (error) {}
    }

  if (compareVersions(localVersion, latestVersion) !== 1) {
    return;
  }

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: `[INVOKE UPDATE] A newer version of invoke is available: v${latestVersion} (current: v${localVersion}). To update, remove and re-add the invoke marketplace in your Claude Code settings.`
      }
    })
  );
}

(async () => {
  try {
    await main();
  } catch (error) {}
})();
