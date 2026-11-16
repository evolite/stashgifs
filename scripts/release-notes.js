#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const FALLBACK = 'Maintenance and internal improvements.';

function notesFor(version, markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start === -1) return FALLBACK;
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## ['));
  const body = lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim();
  return body || FALLBACK;
}

module.exports = { notesFor, FALLBACK };

if (require.main === module) {
  const version = (process.argv[2] ?? '').replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.error('usage: node scripts/release-notes.js <x.y.z>');
    process.exit(1);
  }
  const file = path.join(__dirname, '..', 'RELEASE_NOTES.md');
  console.log(notesFor(version, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''));
}
