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
STASHGIFS_SOURCE="$SOURCE_DIR/stashgifs"
TARGET_DIR="/home/evotech/Services/containers/data/stash/plugins/stashgifs/stashgifs"

echo -e "${CYAN}=== StashGifs Deployment Script ===${NC}"
echo ""

# Step 1: Run npm build
echo -e "${YELLOW}Step 1: Building project...${NC}"
if ! npm run build; then
    echo -e "${RED}Error: Build failed!${NC}"
    exit 1
fi
echo -e "${GREEN}Build completed successfully!${NC}"
echo ""

# Step 2: Delete target directory if it exists
echo -e "${YELLOW}Step 2: Cleaning target directory...${NC}"
if [ -d "$TARGET_DIR" ]; then
    echo -e "${GRAY}Deleting existing directory: $TARGET_DIR${NC}"
    rm -rf "$TARGET_DIR"
    echo -e "${GREEN}Target directory deleted.${NC}"
else
    echo -e "${GRAY}Target directory does not exist, skipping deletion.${NC}"
fi
echo ""

# Step 3: Copy source to target
echo -e "${YELLOW}Step 3: Copying files to target directory...${NC}"
echo -e "${GRAY}Source: $STASHGIFS_SOURCE${NC}"
echo -e "${GRAY}Target: $TARGET_DIR${NC}"

if [ ! -d "$STASHGIFS_SOURCE" ]; then
    echo -e "${RED}Error: Source stashgifs directory not found: $STASHGIFS_SOURCE${NC}"
    exit 1
fi

# Copy the stashgifs directory contents to target
cp -r "$STASHGIFS_SOURCE" "$TARGET_DIR"
if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Copy failed!${NC}"
    exit 1
fi

echo -e "${GREEN}Files copied successfully!${NC}"
echo ""

echo -e "${CYAN}=== Deployment Complete ===${NC}"
echo -e "${GREEN}Plugin deployed to: $TARGET_DIR${NC}"

