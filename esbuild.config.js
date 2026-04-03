import { build } from 'esbuild'

const shared = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: [
    'child_process', 'fs', 'fs/promises', 'path', 'os',
    'crypto', 'stream', 'url', 'events', 'net', 'tls',
    'http', 'https', 'util', 'buffer', 'string_decoder',
  ],
  banner: {
    js: "import{createRequire}from'module';const require=createRequire(import.meta.url);",
  },
}

await build({
  ...shared,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
})

await build({
  ...shared,
  entryPoints: ['src/init-cli.ts'],
  outfile: 'dist/init-cli.js',
  banner: {
    js: "#!/usr/bin/env node\nimport{createRequire}from'module';const require=createRequire(import.meta.url);",
  },
})

console.log('Bundle complete')
