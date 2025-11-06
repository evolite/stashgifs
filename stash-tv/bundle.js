/**
 * Simple bundler to combine all ES modules into a single file
 * This avoids MIME type issues with individual module files
 */

const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, 'app', 'assets');
const outputFile = path.join(assetsDir, 'feed-bundle.js');

// Order matters - dependencies first
const modules = [
  'types.js',
  'utils.js',
  'StashAPI.js',
  'NativeVideoPlayer.js',
  'VisibilityManager.js',
  'VideoPost.js',
  'FeedContainer.js',
  'index.js'
];

let bundle = `/**
 * Stash TV Feed UI - Bundled
 * Generated bundle combining all ES modules
 */

`;

// Process each module
for (const module of modules) {
  const filePath = path.join(assetsDir, module);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    continue;
  }
  
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Remove import statements (we'll handle them differently)
  // Remove export keywords (we'll make everything available on window)
  content = content.replace(/^import\s+.*?from\s+['"].*?['"];?\s*$/gm, '');
  content = content.replace(/^export\s+/gm, '');
  
  bundle += `\n// === ${module} ===\n`;
  bundle += content;
  bundle += '\n\n';
}

// Wrap in IIFE to avoid global scope pollution
const wrapped = `(function() {
${bundle}
})();`;

fs.writeFileSync(outputFile, wrapped, 'utf8');
console.log(`Bundle created: ${outputFile}`);

