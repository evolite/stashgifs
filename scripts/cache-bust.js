#!/usr/bin/env node

/**
 * Post-build cache-busting.
 *
 * The plugin's static assets are served behind Cloudflare with `Cache-Control:
 * max-age=14400` (4h) and stable URLs, so rebuilds don't reach the browser until the
 * edge cache expires — a hard refresh can't bust it. The app HTML, however, is served
 * `DYNAMIC` (uncached), so if it references versioned asset URLs each build becomes a new
 * cache key and Cloudflare fetches the fresh file.
 *
 * This stamps a fresh `?v=<token>` onto every relative ESM import in the emitted JS and
 * onto the asset URLs in the generated index.html, so `pnpm run build` + reload always loads new code.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const assetsDir = path.join(root, 'stashgifs', 'app', 'assets');
const indexTemplatePath = path.join(__dirname, 'index.template.html');
const indexHtmlPath = path.join(root, 'stashgifs', 'app', 'index.html');

// A fresh token per build. Node (not the agent harness), so Date.now() is fine.
const token = `${Date.now().toString(36)}`;

/** Recursively collect our emitted *.js files (skip source maps and third-party vendor). */
function collectJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'vendor') continue; // third-party bundles — never rewrite
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

// Relative ESM specifiers ending in .js, in `from '…'`, bare `import '…'`, and dynamic
// `import('…')`. Only specifiers starting with `.` are touched (skip bare/vendor imports).
// bundle.js re-emits these files each build, so they always start clean (no token stacking).
const FROM_RE = /(\bfrom\s*)(['"])(\.\.?\/[^'"]+?\.js)(\2)/g;
const SIDE_EFFECT_RE = /(\bimport\s*)(['"])(\.\.?\/[^'"]+?\.js)(\2)/g;
const DYNAMIC_RE = /(\bimport\(\s*)(['"])(\.\.?\/[^'"]+?\.js)(\2)/g;

function stampJs(content) {
  return content
    .replace(FROM_RE, (_m, p, q, spec) => `${p}${q}${spec}?v=${token}${q}`)
    .replace(SIDE_EFFECT_RE, (_m, p, q, spec) => `${p}${q}${spec}?v=${token}${q}`)
    .replace(DYNAMIC_RE, (_m, p, q, spec) => `${p}${q}${spec}?v=${token}${q}`);
}

let jsCount = 0;
for (const file of collectJsFiles(assetsDir)) {
  const original = fs.readFileSync(file, 'utf8');
  const stamped = stampJs(original);
  if (stamped !== original) {
    fs.writeFileSync(file, stamped);
    jsCount++;
  }
}

// index.html is generated from scripts/index.template.html: the template carries plain asset URLs and
// each build writes a stamped copy, so the token never shows up as a change in git.
const ASSET_URL_RE = /((?:src|href)=")(\.\/assets\/[^"?]+?\.(?:js|css|mjs))(")/g;
let htmlCount = 0;
const template = fs.readFileSync(indexTemplatePath, 'utf8');
const stamped = template.replace(ASSET_URL_RE, (_m, pre, url, post) => {
  htmlCount++;
  return `${pre}${url}?v=${token}${post}`;
});
fs.writeFileSync(indexHtmlPath, stamped);

console.log(`Cache-bust token ${token}: stamped ${jsCount} JS file(s) and ${htmlCount} index.html asset ref(s)`);
