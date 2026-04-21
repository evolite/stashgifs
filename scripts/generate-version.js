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

// Get BUILD_HASH from environment variable, or generate a random one if not set
const buildHash = process.env.BUILD_HASH || crypto.randomBytes(4).toString('hex');

const versionTsContent = `/**
 * Version information - auto-generated from package.json
 * This file is updated automatically during the build process
 */
export const VERSION = '${pkg.version}';
export const BUILD_HASH = '${buildHash}';
`;

fs.writeFileSync(versionTsPath, versionTsContent);
console.log(`Version file updated with: ${pkg.version} (hash: ${buildHash})`);
