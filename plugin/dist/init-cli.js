#!/usr/bin/env node
#!/usr/bin/env node
import{createRequire}from'module';const require=createRequire(import.meta.url);

// src/init.ts
import { cp, mkdir, readdir } from "fs/promises";
import { existsSync as existsSync2 } from "fs";
import path2 from "path";

// src/defaults-path.ts
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var PACKAGE_ROOT = path.join(__dirname, "..");
var defaultsDir = existsSync(path.join(PACKAGE_ROOT, "defaults")) ? path.join(PACKAGE_ROOT, "defaults") : path.join(PACKAGE_ROOT, "plugin", "defaults");
function getDefaultsDir() {
  return defaultsDir;
}

// src/init.ts
async function initProject(projectDir2) {
  const invokeDir = path2.join(projectDir2, ".invoke");
  const defaultsDir2 = getDefaultsDir();
  await mkdir(invokeDir, { recursive: true });
  const configDest = path2.join(invokeDir, "pipeline.yaml");
  if (!existsSync2(configDest)) {
    await cp(path2.join(defaultsDir2, "pipeline.yaml"), configDest);
  }
  await copyDefaults(path2.join(defaultsDir2, "roles"), path2.join(invokeDir, "roles"));
  await copyDefaults(path2.join(defaultsDir2, "strategies"), path2.join(invokeDir, "strategies"));
  await mkdir(path2.join(invokeDir, "specs", "research"), { recursive: true });
  await mkdir(path2.join(invokeDir, "plans"), { recursive: true });
  await mkdir(path2.join(invokeDir, "reviews"), { recursive: true });
}
async function copyDefaults(srcDir, destDir) {
  if (!existsSync2(srcDir)) return;
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path2.join(srcDir, entry.name);
    const destPath = path2.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyDefaults(srcPath, destPath);
    } else if (!existsSync2(destPath)) {
      await cp(srcPath, destPath);
    }
  }
}

// src/init-cli.ts
var projectDir = process.argv[2] || process.cwd();
console.log(`Initializing invoke project config in ${projectDir}...`);
initProject(projectDir).then(() => {
  console.log("");
  console.log("invoke project config created!");
  console.log("");
  console.log("What was set up:");
  console.log("  .invoke/pipeline.yaml  Pipeline config (providers, roles, strategies)");
  console.log("  .invoke/roles/         Default role prompts");
  console.log("  .invoke/strategies/    Default strategy prompts");
  console.log("  .invoke/specs/         Output directory for specs");
  console.log("  .invoke/plans/         Output directory for plans");
  console.log("  .invoke/reviews/       Output directory for reviews");
  console.log("");
  console.log("The invoke plugin handles skills, hooks, and MCP server registration.");
  console.log("Review .invoke/pipeline.yaml to customize providers and models.");
}).catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
