#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const assetsDir = path.join(root, 'stashgifs', 'app', 'assets');

function cleanEmitted(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'vendor') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      cleanEmitted(full);
      if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
    } else if (/\.js(\.map)?$/.test(entry.name)) {
      fs.rmSync(full);
    }
  }
}

cleanEmitted(assetsDir);

const watch = process.argv.includes('--watch');

esbuild
  .context({
    entryPoints: [path.join(root, 'src', 'index.ts')],
    outdir: assetsDir,
    bundle: true,
    splitting: true,
    format: 'esm',
    target: 'es2022',
    minify: true,
    sourcemap: true,
    chunkNames: 'chunks/[name]-[hash]',
    logLevel: 'info',
  })
  .then(async (ctx) => {
    if (watch) {
      await ctx.watch();
    } else {
      await ctx.rebuild();
      await ctx.dispose();
    }
  })
  .catch(() => process.exit(1));
