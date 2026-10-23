#!/usr/bin/env node

/**
 * Generate version.ts from package.json
 * This script is run automatically during the build process
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const packageJsonPath = path.join(__dirname, '..', 'package.json');
const versionTsPath = path.join(__dirname, '..', 'src', 'version.ts');

const pkg = require(packageJsonPath);

let buildHash = process.env.BUILD_HASH;

if (!buildHash) {
  // Reuse the existing hash when the version hasn't changed, so local builds
  // don't dirty version.ts on every `pnpm run build`.
  try {
    const existing = fs.readFileSync(versionTsPath, 'utf8');
    const versionMatch = existing.match(/VERSION = '([^']+)'/);
    const hashMatch = existing.match(/BUILD_HASH = '([^']+)'/);
    if (versionMatch?.[1] === pkg.version && hashMatch?.[1]) {
      buildHash = hashMatch[1];
    }
  } catch {
    // file doesn't exist yet — fall through to generate a fresh hash
  }
  buildHash ??= crypto.randomBytes(4).toString('hex');
}

const versionTsContent = `/**
 * Version information - auto-generated from package.json
 * This file is updated automatically during the build process
 */
export const VERSION = '${pkg.version}';
export const BUILD_HASH = '${buildHash}';
`;

fs.writeFileSync(versionTsPath, versionTsContent);
console.log(`Version file updated with: ${pkg.version} (hash: ${buildHash})`);

// Bundle RELEASE_NOTES.md (hand-written, user-facing) for the "What's new" dialog.
const changelogPath = path.join(__dirname, '..', 'RELEASE_NOTES.md');
const changelogTsPath = path.join(__dirname, '..', 'src', 'changelog.ts');
const entries = [];
let section;
const lines = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8').split('\n') : [];
for (const line of lines) {
  const release = /^## \[(\d+\.\d+\.\d+)\](?: - (\S+))?/.exec(line);
  if (release) {
    entries.push({ version: release[1], date: release[2] ?? '', sections: [] });
    section = undefined;
  } else if (entries.length > 0 && line.startsWith('### ')) {
    section = { title: line.slice(4).trim(), items: [] };
    entries[entries.length - 1].sections.push(section);
  } else if (section && line.startsWith('- ')) {
    section.items.push(line.slice(2).trim());
  }
}
fs.writeFileSync(
  changelogTsPath,
  `/**
 * Latest release notes - auto-generated from RELEASE_NOTES.md during the build process (the "What's new" dialog shows only the newest release)
 */
export interface ChangelogEntry {
  version: string;
  date: string;
  sections: Array<{ title: string; items: string[] }>;
}
export const CHANGELOG: ChangelogEntry[] = ${JSON.stringify(entries.slice(0, 1), null, 2)};
`
);
console.log(`Changelog file updated with the latest release (${entries[0]?.version ?? 'none'})`);
