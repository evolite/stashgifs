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
