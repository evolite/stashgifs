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
 * onto the asset URLs in index.html, so `pnpm run build` + reload always loads new code.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const assetsDir = path.join(root, 'stashgifs', 'app', 'assets');
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

// index.html is a static (non-generated) file, so replace idempotently: an existing
// `?v=…` is overwritten rather than appended, preventing token accumulation.
const ASSET_URL_RE = /((?:src|href)=")(\.\/assets\/[^"?]+?\.(?:js|css|mjs))(\?v=[^"]*)?(")/g;
let htmlCount = 0;
if (fs.existsSync(indexHtmlPath)) {
  const html = fs.readFileSync(indexHtmlPath, 'utf8');
  const stamped = html.replace(ASSET_URL_RE, (_m, pre, url, _old, post) => {
    htmlCount++;
    return `${pre}${url}?v=${token}${post}`;
  });
  if (stamped !== html) {
    fs.writeFileSync(indexHtmlPath, stamped);
  }
}

console.log(`Cache-bust token ${token}: stamped ${jsCount} JS file(s) and ${htmlCount} index.html asset ref(s)`);
