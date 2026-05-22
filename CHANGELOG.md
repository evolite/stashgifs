# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [6.4.0] - 2026-05-22

### Bug Fixes

- Lower view threshold to half-clip or 3 seconds, whichever is smaller
- Resolve all SonarQube reported issues
- Eliminate boolean selector param in applyReelHeaderStyles (S2301)
- Resolve all SonarQube cognitive complexity and void operator issues
- Resolve SonarQube issues in discovery feature

### Features

- Add performer placeholder and search dialog for posts with no performers
- Add view count badge with eye icon to scene and image feeds
- Add StashDB discovery panel sidebar
- Show play in stash link on discovery cards when scene is locally available
- Add rate limiter to StashBox discovery requests
- Improve discovery panel UX and StashDB request efficiency
- Per-slot discovery card updates with random slot selection
- Add trending sort option to discovery panel scene order

## [6.3.1] - 2026-05-19

### Bug Fixes

- Change studio filter to OR (INCLUDES) and show "or" separators between studio chips
- Enforce AND for multi-performer filter and natural-language pill layout
- Improve Random settings UX and toggle accent color

### Refactoring

- Extract pill group methods to reduce cognitive complexity

## [6.3.0] - 2026-05-19

### Features

- Restrict marker video playback and seek bar to marker duration
- Extend include subtags toggle to also traverse child studio hierarchy

### Refactoring

- Group count params in calculateHasMoreForMixedContent to satisfy S107

## [6.2.0] - 2026-05-18

### Bug Fixes

- Random mode no longer exhausts when filter matches few scenes
- Resolve random mode pagination and deduplication issues
- Logo click now removes active filter chips from the DOM

### Features

- Add setting to include scenes with markers in random mode
- Generate multiple synthetic markers per scene for small random pools

## [6.1.7] - 2026-05-18

### Bug Fixes

- Studio chip click filters feed instead of navigating to studio page

## [6.1.6] - 2026-05-18

### Bug Fixes

- Remove studio chip style duplication and unnecessary assertion

### Features

- Add studio chips with hover overlay to feed cards

### Refactoring

- Extract chip helpers to eliminate BasePost duplication

## [6.1.4] - 2026-05-18

### Bug Fixes

- Install git-cliff to user bin and register it on PATH

## [6.1.3] - 2026-05-18

### Bug Fixes

- Call git-cliff directly instead of as git subcommand

## [6.1.2] - 2026-05-18

### Bug Fixes

- Resolve git-cliff 404 by fetching versioned download URL

## [6.1.1] - 2026-05-18

### Bug Fixes

- Clear favoriteTagPromise on failure so retries work

## [5.1.0] - 2025-11-18

### Bug Fixes

- Disable random page selection when applying saved filters; only randomize in discovery mode (no query/tags/savedFilterId)
- Header apply now preserves selected saved filter; restore randomization with filters by counting with merged criteria
- Ensure saved filter criteria takes precedence; prevent manual tags/query from overwriting saved filter; add debug logging
- Correctly parse saved filter tags value.items into numeric IDs for scene_marker_filter
- Remove availablePackages wrapper, use direct array format
- Ensure stashgifs.mjs is properly included, add icon files, remove old stash-tv files

### Features

- Show selected tags and saved filters as chips in header search; allow removing chips to re-apply filters; unify saved filter selection behavior
- Enable multi-select tags without closing suggestions; prevent duplicate tag chips in header and filter sheet
- Show primary tag as badge on video card (fallback to first tag)
- Display marker tags as chips next to performers in footer
- Show tags and saved filters on search bar focus; update API to support empty tag search
- Filter tag suggestions to only show tags that have scene markers

### Refactoring

- Rename UI branding from Stash TV to Stashgifs across UI and docs


