#!/usr/bin/env node

/**
 * Release notes for one version, from the hand-written RELEASE_NOTES.md.
 *
 *   node scripts/release-notes.js 7.23.0    -> the notes body for that version (stdout)
 *
 * Falls back to a one-line maintenance note when the version has no section, so a release
 * with nothing user-facing never publishes commit noise.
 */

const fs = require('fs');
const path = require('path');

const FALLBACK = 'Maintenance and internal improvements.';

/** Body (without the "## [x.y.z]" heading) of `version`'s section, or the fallback. */
function notesFor(version, markdown) {
  const lines = markdown.split('\n');
  const heading = new RegExp(`^## \\[${version.replaceAll('.', '\\.')}\\]`);
  const start = lines.findIndex((line) => heading.test(line));
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
