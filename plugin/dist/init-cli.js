#!/usr/bin/env node
#!/usr/bin/env node
import{createRequire}from'module';const require=createRequire(import.meta.url);

// src/init.ts
import { cp, mkdir, readdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var PACKAGE_ROOT = path.join(__dirname, "..");
async function initProject(projectDir2) {
  const invokeDir = path.join(projectDir2, ".invoke");
  const defaultsDir = path.join(PACKAGE_ROOT, "defaults");
  await mkdir(invokeDir, { recursive: true });
  const configDest = path.join(invokeDir, "pipeline.yaml");
  if (!existsSync(configDest)) {
    await cp(path.join(defaultsDir, "pipeline.yaml"), configDest);
  }
  await copyDefaults(path.join(defaultsDir, "roles"), path.join(invokeDir, "roles"));
  await copyDefaults(path.join(defaultsDir, "strategies"), path.join(invokeDir, "strategies"));
  await mkdir(path.join(invokeDir, "specs", "research"), { recursive: true });
  await mkdir(path.join(invokeDir, "plans"), { recursive: true });
  await mkdir(path.join(invokeDir, "reviews"), { recursive: true });
}
async function copyDefaults(srcDir, destDir) {
  if (!existsSync(srcDir)) return;
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyDefaults(srcPath, destPath);
    } else if (!existsSync(destPath)) {
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
