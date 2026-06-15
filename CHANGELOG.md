# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [7.1.6] - 2026-06-15

### Bug Fixes

- Bust plugin asset cache on every build
- Stop the feed looping the first markers of an exhausted content type
- Reliable reel scrolling and feed loading

## [7.1.5] - 2026-06-13

### Bug Fixes

- Move Marker Title Search into the Layout section

## [7.1.4] - 2026-06-13

### Bug Fixes

- Keep image lazy-load observers alive across append loads

## [7.1.3] - 2026-06-13

### Bug Fixes

- Support Stash instances served under a base URL path prefix

## [7.1.2] - 2026-06-12

### Bug Fixes

- Prefetch next reel batch several cards before the end

## [7.1.1] - 2026-06-12

### Bug Fixes

- Keep reel scroll position stable when cleaning up distant posts

## [7.1.0] - 2026-06-11

### Features

- Add marker title search to the feed search bar

## [7.0.0] - 2026-06-03

### Bug Fixes

- Prevent tag/performer popups from being hidden under next post card
- Fire reel auto-advance on clipped marker loops
- Stop reel snapping back on fast wheel flick
- Repair four review findings from opus audit
- Resolve 4 SonarQube violations (new_violations gate)
- Keep reel progress bar updating after scrolling back to a card
- Mute audio only from the global mute setting
- Stop reel swipe ghost-click from pausing the next card on mobile
- Autoplay reel cards that finish loading after a fast scroll

### Features

- Replace NativeVideoPlayer with video.js engine for codec/HLS support
- Add draggable accent progress bar to video posts

### Performance

- Load videos only when visible and stop re-downloading on scroll
- Remove posters and prefetching, simplify marker-clip loading
- Cut ~200ms of artificial stalls from HD upgrade path
- Preload the next reel card for instant playback

### Refactoring

- Collapse play orchestration to single reconcile() function
- Replace JS card-snapping with native CSS scroll-snap
- Replace VisibilityManager/AudioManager with reel-only architecture
- Apply dead-code cleanup from post-reel-only review
- Simplify playback layer and harden reel video stability
- Extract shared clip-window computation in VideoJsPlayer
- Eliminate remaining code duplication across the project
- Clear SonarQube violations from recent changes

## [6.7.1] - 2026-05-31

### Bug Fixes

- Hide stale error banner when new load starts or content renders
- Resolve SonarQube violations from refactor
- Resolve 8 Opus-reviewed correctness issues
- Resolve 8 state/memory/cleanup issues from second Opus review
- Resolve memory leaks, race conditions, and stale state from Opus audit
- Replace negated condition with early-break in performer cache eviction

### Refactoring

- Address Opus code review findings in FeedContainer
- Address Opus LOW findings in FeedContainer

## [6.7.0] - 2026-05-30

### Bug Fixes

- Disable pinch-to-zoom on mobile
- Block pinch-to-zoom via touchmove in browsers that ignore user-scalable
- Constrain settings tabs to window width and scale to fit
- Flip add-tag and add-performer dialogs above anchor when below viewport
- Match rated/unrated star icon size and restore outline when unrated
- Use object-fit contain in reel mode to prevent media clipping
- Pass objectFit at construction time to prevent landscape media clipping in reel mode

### Features

- Hide discovery panel and button on mobile
- Add auto-hide search bar setting, default enabled

### Refactoring

- Unify discovery panel look with feed

## [6.6.0] - 2026-05-28

### Bug Fixes

- Optimize discovery panel and clean up button-group UI
- Move add-tag to header chip, soften hover dismissal
- Restore gold rating stars and amp up discovery jiggle

### Features

- Add reel auto-scroll with per-loop advance
- Auto-advance image posts after 5s dwell in reel autoscroll

### Refactoring

- Resolve SonarQube findings

## [6.5.0] - 2026-05-27

### Bug Fixes

- Detect locally-existing scenes regardless of stash_id endpoint

### Features

- Add scene title display option to layout settings
- Add Whisparr integration to discovery panel

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


