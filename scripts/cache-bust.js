#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const assetsDir = path.join(root, 'stashgifs', 'app', 'assets');
const indexTemplatePath = path.join(__dirname, 'index.template.html');
const indexHtmlPath = path.join(root, 'stashgifs', 'app', 'index.html');

const token = `${Date.now().toString(36)}`;

function collectJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'vendor') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

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

const ASSET_URL_RE = /((?:src|href)=")(\.\/assets\/[^"?]+?\.(?:js|css|mjs))(")/g;
let htmlCount = 0;
const template = fs.readFileSync(indexTemplatePath, 'utf8');
const stamped = template.replace(ASSET_URL_RE, (_m, pre, url, post) => {
  htmlCount++;
  return `${pre}${url}?v=${token}${post}`;
});
fs.writeFileSync(indexHtmlPath, stamped);

console.log(`Cache-bust token ${token}: stamped ${jsCount} JS file(s) and ${htmlCount} index.html asset ref(s)`);
