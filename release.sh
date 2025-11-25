#!/bin/bash

# Release script for stashgifs plugin
# Creates zip, updates version, creates GitHub release, and updates index.yml
# Usage: ./release.sh [bug|minor|major]
#   bug:    Increment patch version (5.6.3 -> 5.6.4)
#   minor:  Increment minor version (5.6.3 -> 5.7.0)
#   major:  Increment major version (5.6.3 -> 6.0.0)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

# Get script directory (project root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

STASHGIFS_DIR="$SCRIPT_DIR/stashgifs"
ZIP_FILE="$SCRIPT_DIR/stashgifs.zip"
HASH_FILE="$SCRIPT_DIR/stashgifs.zip.sha256"
MANIFEST_PATH="$STASHGIFS_DIR/manifest"
INDEX_YML_PATH="$SCRIPT_DIR/index.yml"
PACKAGE_JSON_PATH="$SCRIPT_DIR/package.json"
STASHGIFS_YML_PATH="$STASHGIFS_DIR/stashgifs.yml"

echo -e "${CYAN}=== StashGifs Release Script ===${NC}"
echo ""

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo -e "${RED}Error: GitHub CLI (gh) is not installed.${NC}"
    echo "Install it from: https://cli.github.com/"
    exit 1
fi

# Check if gh is authenticated
if ! gh auth status &> /dev/null; then
    echo -e "${RED}Error: GitHub CLI is not authenticated.${NC}"
    echo "Run: gh auth login"
    exit 1
fi

# Step 0: Build project
echo -e "${YELLOW}Step 0: Building project...${NC}"
if ! npm run build; then
    echo -e "${RED}Error: Build failed!${NC}"
    exit 1
fi
echo -e "${GREEN}Build completed successfully!${NC}"
echo ""

# Step 1: Update version if specified
VERSION_BUMP="$1"
if [ -n "$VERSION_BUMP" ]; then
    echo -e "${YELLOW}Step 1: Updating version ($VERSION_BUMP)...${NC}"
    
    if [[ ! "$VERSION_BUMP" =~ ^(bug|minor|major)$ ]]; then
        echo -e "${RED}Error: Invalid version bump type. Use 'bug', 'minor', or 'major'.${NC}"
        exit 1
    fi
    
    # Read current version from manifest
    if [ ! -f "$MANIFEST_PATH" ]; then
        echo -e "${RED}Error: Manifest file not found: $MANIFEST_PATH${NC}"
        exit 1
    fi
    
    CURRENT_VERSION=$(grep -oP 'version:\s*\K\d+\.\d+\.\d+' "$MANIFEST_PATH" || echo "")
    if [ -z "$CURRENT_VERSION" ]; then
        echo -e "${RED}Error: Could not parse version from manifest${NC}"
        exit 1
    fi
    
    # Parse version components
    IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
    
    # Bump version based on type
    case "$VERSION_BUMP" in
        "bug")
            PATCH=$((PATCH + 1))
            echo -e "${GRAY}Bumping patch version: $MAJOR.$MINOR.$((PATCH - 1)) -> $MAJOR.$MINOR.$PATCH${NC}"
            ;;
        "minor")
            MINOR=$((MINOR + 1))
            PATCH=0
            echo -e "${GRAY}Bumping minor version: $MAJOR.$((MINOR - 1)).* -> $MAJOR.$MINOR.$PATCH${NC}"
            ;;
        "major")
            MAJOR=$((MAJOR + 1))
            MINOR=0
            PATCH=0
            echo -e "${GRAY}Bumping major version: $((MAJOR - 1)).*.* -> $MAJOR.$MINOR.$PATCH${NC}"
            ;;
    esac
    
    NEW_VERSION="$MAJOR.$MINOR.$PATCH"
    CURRENT_DATE=$(date +"%Y-%m-%d %H:%M:%S")
    
    # Update manifest
    sed -i "s/version: [0-9]\+\.[0-9]\+\.[0-9]\+/version: $NEW_VERSION/" "$MANIFEST_PATH"
    sed -i "s/date: \"[^\"]*\"/date: \"$CURRENT_DATE\"/" "$MANIFEST_PATH"
    
    # Update index.yml
    sed -i "s/version: [0-9]\+\.[0-9]\+\.[0-9]\+/version: $NEW_VERSION/" "$INDEX_YML_PATH"
    sed -i "s/date: \"[^\"]*\"/date: \"$CURRENT_DATE\"/" "$INDEX_YML_PATH"
    sed -i "s|path: https://github.com/evolite/stashgifs/releases/download/[^/]*/stashgifs.zip|path: https://github.com/evolite/stashgifs/releases/download/v$NEW_VERSION/stashgifs.zip|" "$INDEX_YML_PATH"
    
    # Update stashgifs.yml if it exists
    if [ -f "$STASHGIFS_YML_PATH" ]; then
        if grep -q "version:" "$STASHGIFS_YML_PATH"; then
            sed -i "s/version: [0-9]\+\.[0-9]\+\.[0-9]\+/version: $NEW_VERSION/" "$STASHGIFS_YML_PATH"
        else
            # Add version field after description line
            sed -i "/description:/a version: $NEW_VERSION" "$STASHGIFS_YML_PATH"
        fi
    fi
    
    # Update package.json
    if [ -f "$PACKAGE_JSON_PATH" ]; then
        # Use node or python to update JSON (more reliable than sed)
        if command -v node &> /dev/null; then
            node -e "
                const fs = require('fs');
                const pkg = JSON.parse(fs.readFileSync('$PACKAGE_JSON_PATH', 'utf8'));
                pkg.version = '$NEW_VERSION';
                fs.writeFileSync('$PACKAGE_JSON_PATH', JSON.stringify(pkg, null, 2) + '\n');
            "
        elif command -v python3 &> /dev/null; then
            python3 << EOF
import json
with open('$PACKAGE_JSON_PATH', 'r') as f:
    pkg = json.load(f)
pkg['version'] = '$NEW_VERSION'
with open('$PACKAGE_JSON_PATH', 'w') as f:
    json.dump(pkg, f, indent=2)
    f.write('\n')
EOF
        else
            # Fallback to sed (less reliable but works)
            sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/" "$PACKAGE_JSON_PATH"
        fi
    fi
    
    echo -e "${GREEN}Version updated to $NEW_VERSION in manifest, index.yml, stashgifs.yml, and package.json${NC}"
    echo ""
fi

# Step 2: Validate manifest includes all built files
echo -e "${YELLOW}Step 2: Validating manifest...${NC}"
ASSETS_DIR="$STASHGIFS_DIR/app/assets"

if [ ! -d "$ASSETS_DIR" ]; then
    echo -e "${RED}Error: Assets directory not found: $ASSETS_DIR${NC}"
    exit 1
fi

if [ ! -f "$MANIFEST_PATH" ]; then
    echo -e "${RED}Error: Manifest file not found: $MANIFEST_PATH${NC}"
    exit 1
fi

# Get all built files (normalize paths to use forward slashes)
BUILT_FILES=$(find "$ASSETS_DIR" -type f \( -name "*.js" -o -name "*.js.map" -o -name "*.css" \) | \
    sed "s|^$STASHGIFS_DIR/||" | sed 's|\\|/|g' | sort)

# Get files from manifest (normalize paths - handle both Windows backslashes and forward slashes)
MANIFEST_FILES=$(grep "^- app" "$MANIFEST_PATH" | sed 's/^- //' | sed 's|\\|/|g' | sort)

# Find missing files
MISSING=$(comm -23 <(echo "$BUILT_FILES") <(echo "$MANIFEST_FILES"))

# Find extra files in manifest
EXTRA=$(comm -13 <(echo "$BUILT_FILES") <(echo "$MANIFEST_FILES"))

if [ -n "$MISSING" ]; then
    echo -e "${RED}Error: Built files missing from manifest:${NC}"
    echo "$MISSING" | while read -r file; do
        echo -e "${YELLOW}  $file${NC}"
    done
    exit 1
fi

if [ -n "$EXTRA" ]; then
    echo -e "${YELLOW}Warning: Files in manifest but not built:${NC}"
    echo "$EXTRA" | while read -r file; do
        echo -e "${YELLOW}  $file${NC}"
    done
fi

BUILT_COUNT=$(echo "$BUILT_FILES" | wc -l)
echo -e "${GREEN}Manifest validation passed! All $BUILT_COUNT built files are included.${NC}"
echo ""

# Step 3: Delete existing zip if it exists
echo -e "${YELLOW}Step 3: Cleaning existing zip file...${NC}"
if [ -f "$ZIP_FILE" ]; then
    echo -e "${GRAY}Deleting existing zip: $ZIP_FILE${NC}"
    rm -f "$ZIP_FILE"
    echo -e "${GREEN}Existing zip deleted.${NC}"
else
    echo -e "${GRAY}No existing zip file found.${NC}"
fi
echo ""

# Step 4: Create zip file
echo -e "${YELLOW}Step 4: Creating zip file...${NC}"
echo -e "${GRAY}Source: $STASHGIFS_DIR${NC}"
echo -e "${GRAY}Target: $ZIP_FILE${NC}"

if [ ! -d "$STASHGIFS_DIR" ]; then
    echo -e "${RED}Error: Source stashgifs directory not found: $STASHGIFS_DIR${NC}"
    exit 1
fi

# Check for zip or 7z command
if command -v zip &> /dev/null; then
    cd "$SCRIPT_DIR"
    zip -r "stashgifs.zip" "stashgifs" -q
elif command -v 7z &> /dev/null; then
    cd "$SCRIPT_DIR"
    7z a -tzip "stashgifs.zip" "stashgifs" -y > /dev/null
else
    echo -e "${RED}Error: zip or 7z command not found.${NC}"
    echo "Install zip: sudo apt-get install zip (Debian/Ubuntu)"
    echo "Or install 7zip: sudo apt-get install p7zip-full (Debian/Ubuntu)"
    exit 1
fi

echo -e "${GREEN}Zip file created successfully!${NC}"
echo ""

# Step 5: Generate SHA256 hash
echo -e "${YELLOW}Step 5: Generating SHA256 hash...${NC}"
if command -v sha256sum &> /dev/null; then
    HASH=$(sha256sum "$ZIP_FILE" | cut -d' ' -f1)
elif command -v shasum &> /dev/null; then
    HASH=$(shasum -a 256 "$ZIP_FILE" | cut -d' ' -f1)
else
    echo -e "${RED}Error: sha256sum or shasum command not found.${NC}"
    exit 1
fi

HASH_LOWER=$(echo "$HASH" | tr '[:upper:]' '[:lower:]')
echo "$HASH" > "$HASH_FILE"
echo -e "${GREEN}Hash: $HASH${NC}"
echo -e "${GREEN}Hash saved to: $HASH_FILE${NC}"
echo ""

# Step 6: Update index.yml with hash and date
echo -e "${YELLOW}Step 6: Updating index.yml...${NC}"
CURRENT_DATE=$(date +"%Y-%m-%d %H:%M:%S")

# Get version from index.yml
VERSION=$(grep -oP 'version:\s*\K\d+\.\d+\.\d+' "$INDEX_YML_PATH" || echo "")
if [ -z "$VERSION" ]; then
    echo -e "${RED}Error: Could not parse version from index.yml${NC}"
    exit 1
fi

# Update index.yml
sed -i "s/date: \"[^\"]*\"/date: \"$CURRENT_DATE\"/" "$INDEX_YML_PATH"
sed -i "s/sha256: [a-fA-F0-9]\+/sha256: $HASH_LOWER/" "$INDEX_YML_PATH"
sed -i "s|path: https://github.com/evolite/stashgifs/releases/download/[^/]*/stashgifs.zip|path: https://github.com/evolite/stashgifs/releases/download/v$VERSION/stashgifs.zip|" "$INDEX_YML_PATH"

echo -e "${GREEN}index.yml updated with hash and date.${NC}"
echo ""

# Step 7: Create GitHub release
echo -e "${YELLOW}Step 7: Creating GitHub release...${NC}"

# Check if release already exists
if gh release view "v$VERSION" &> /dev/null; then
    echo -e "${YELLOW}Release v$VERSION already exists. Deleting it...${NC}"
    gh release delete "v$VERSION" --yes
    # Also delete the tag if it exists
    if git rev-parse "v$VERSION" &> /dev/null; then
        git tag -d "v$VERSION" 2>/dev/null || true
        git push origin ":refs/tags/v$VERSION" 2>/dev/null || true
    fi
fi

# Create release with zip file
RELEASE_NOTES="Release v$VERSION

## Changes
- See commit history for details"

if gh release create "v$VERSION" "$ZIP_FILE" --title "v$VERSION" --notes "$RELEASE_NOTES"; then
    echo -e "${GREEN}GitHub release created successfully!${NC}"
else
    echo -e "${RED}Error: Failed to create GitHub release${NC}"
    exit 1
fi
echo ""

echo -e "${CYAN}=== Release Complete ===${NC}"
echo -e "${GREEN}Zip file: $ZIP_FILE${NC}"
echo -e "${GREEN}Hash file: $HASH_FILE${NC}"
echo -e "${GREEN}Hash: $HASH_LOWER${NC}"
echo -e "${GREEN}Version: $VERSION${NC}"
echo -e "${GREEN}GitHub release: https://github.com/evolite/stashgifs/releases/tag/v$VERSION${NC}"
echo -e "${GREEN}index.yml updated with hash, date, and release URL${NC}"

