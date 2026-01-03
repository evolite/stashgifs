#!/bin/bash

# Deploy script for stashgifs plugin
# Builds the project and copies it to Stash plugins directory
# Usage: ./deploy.sh

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

SOURCE_DIR="$SCRIPT_DIR"
ASSETS_SOURCE="$SOURCE_DIR/stashgifs/app/assets"
TARGET_ASSETS_DIR="/home/evotech/Services/containers/data/stash/plugins/stashgifs/stashgifs/stashgifs/app/assets"

echo -e "${CYAN}=== StashGifs Deployment Script ===${NC}"
echo ""

# Step 1: Run npm build
echo -e "${YELLOW}Step 1: Building project...${NC}"
if ! npm run build; then
    echo -e "${RED}Error: Build failed!${NC}" >&2
    exit 1
fi
echo -e "${GREEN}Build completed successfully!${NC}"
echo ""

# Step 2: Create/clean target assets directory
echo -e "${YELLOW}Step 2: Preparing target assets directory...${NC}"
if [[ -d "$TARGET_ASSETS_DIR" ]]; then
    echo -e "${GRAY}Cleaning existing assets directory: $TARGET_ASSETS_DIR${NC}"
    rm -rf "$TARGET_ASSETS_DIR"/*
    rm -rf "$TARGET_ASSETS_DIR"/.* 2>/dev/null || true
    echo -e "${GREEN}Target assets directory cleaned.${NC}"
else
    echo -e "${GRAY}Creating target assets directory: $TARGET_ASSETS_DIR${NC}"
    mkdir -p "$TARGET_ASSETS_DIR"
    echo -e "${GREEN}Target assets directory created.${NC}"
fi
echo ""

# Step 3: Copy assets to target
echo -e "${YELLOW}Step 3: Copying assets to target directory...${NC}"
echo -e "${GRAY}Source: $ASSETS_SOURCE${NC}"
echo -e "${GRAY}Target: $TARGET_ASSETS_DIR${NC}"

if [[ ! -d "$ASSETS_SOURCE" ]]; then
    echo -e "${RED}Error: Source assets directory not found: $ASSETS_SOURCE${NC}" >&2
    exit 1
fi

# Copy the contents of assets directory to target (not the directory itself)
cp -r "$ASSETS_SOURCE"/* "$TARGET_ASSETS_DIR"/
if [[ $? -ne 0 ]]; then
    echo -e "${RED}Error: Copy failed!${NC}" >&2
    exit 1
fi

# Also copy hidden files if any
if ls -A "$ASSETS_SOURCE"/.* > /dev/null 2>&1; then
    cp -r "$ASSETS_SOURCE"/.* "$TARGET_ASSETS_DIR"/ 2>/dev/null || true
fi

echo -e "${GREEN}Assets copied successfully!${NC}"
echo ""

echo -e "${CYAN}=== Deployment Complete ===${NC}"
echo -e "${GREEN}Assets deployed to: $TARGET_ASSETS_DIR${NC}"

