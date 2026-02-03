# StashApp Architecture Reference (Expanded)

This document is a **feature-centric architectural blueprint** for re-implementing the StashGifs feed UI in any modern web stack (React, Vue, Svelte, etc.). It omits stylistic and framework-specific details, focusing solely on **what** the application does and **how** the pieces interact.

---

## 1. High-level Purpose

A responsive, infinite-scroll feed that surfaces Stash content (markers, short-form scenes, images) with per-item video playback, filtering, favorites, ratings, and a unified search overlay. The feed must run as a **Stash UI plugin**, meaning it patches the native ScenePlayer component and shares the global video.js instance.

---

## 2. Core Data Models (GraphQL-native)

| Name | Key Fields | Purpose |
|------|------------|---------|
| SceneMarker | id, scene { id, title, paths, files { width, height, duration } }, seconds, end_seconds, tags[], performers[] | Represents a time-slice of a scene; the primary “post” unit. |
| Scene | id, title, paths, files[], tags[], performers[], o_counter, rating100 | Full scene object used for HD upgrades and short-form generation. |
| Image | id, title, visual_files[], o_counter, rating100 | Static image or looping MP4/GIF. |
| Tag | id, name | Used for inclusion/exclusion filters and marker creation. |
| Performer | id, name, image_path | Used for inclusion/exclusion filters. |

---

## 3. Feature Inventory

### 3.1 Feed Display
- Infinite scroll with automatic load-more trigger when user nears bottom.
- Mixed content types: markers, short-form scenes, images.
- Proportional chunking: 3–5 videos followed by 1–2 images, randomized per batch to avoid predictable patterns.
- Card-level metadata: title, performers (chips), tags (chips), duration, O-counter, rating stars, favorite heart, HQ toggle, external-link button.
- Verified badge on performer chips (toggleable in settings).

### 3.2 Video Playback
- Two playback modes per card:
  1. **Marker mode**: native HTML `<video>` with custom controls (mute, play/pause, progress, fullscreen, restart).
  2. **HD mode**: upgrade to full scene URL with audio; same UI skin.
- Autoplay when card is ~20 % visible; pause when < 0 % visible or another card starts.
- Global mute state persisted; mute button on each card; hover-to-unmute optional.
- Mobile: poster fallback to avoid animated previews; unlock autoplay via dummy video on first interaction.
- Network-aware: metadata-only preload on slow/cellular; aggressive preload on fast Wi-Fi.

### 3.3 Orientation & Filtering (server-side)
- Portrait / Landscape / Square toggles in settings.
- Applied via GraphQL filters:
  - Images: `image_filter.orientation.value = ['PORTRAIT'|'LANDSCAPE'|'SQUARE']`
  - Scene/Markers: `scene_filter.orientation.value = ['PORTRAIT'|'LANDSCAPE'|'SQUARE']`
- Missing dimensions → include (do not over-filter).

### 3.4 Short-Form Content
- Scenes whose first file’s duration < `shortFormMaxDuration` (default 120 s).
- Synthetic markers created at `seconds=0, end_seconds=null`.
- Separate pagination from regular markers to avoid double-fetching.

### 3.5 Shuffle Mode
- Random page selection using server-side `sort=random_` + seed.
- Two tiers:
  1. Markers only.
  2. All content (markers + scenes + images).

### 3.6 Saved Filters
- User-created marker filters stored in Stash.
- When active, **only** markers matching that filter are loaded (images & short-form skipped).

### 3.7 Search & Inclusion Filters
- **Query bar**: substring match against scene title, performer name, tag name.
- **Tag picker**: multi-select inclusion; recent + autocomplete.
- **Performer picker**: multi-select inclusion; recent + autocomplete.
- **File-type toggle**: images on/off, short-form on/off.
- **Exclusion tag list**: comma-separated tag names; stored in localStorage.

### 3.8 Favorites
- Implemented as a special tag `StashGifs Favorite`.
- Heart icon on each card; toggles instantly; persisted via GraphQL mutation.
- Favorite count shown in header; click to filter feed to favorites only.

### 3.9 Ratings
- 0–10 stars, half-star precision if `starPrecision='half'` in Stash config.
- In-place star bar on card; click or drag to set; immediate GraphQL mutation.
- Color-coded stars; hover preview; keyboard left/right for fine adjustment.

### 3.10 O-Counter
- Displayed as small pill; increments via GraphQL mutation on click.
- Optimistic UI update; debounced network call.

### 3.11 Tag Management
- **Add tag**: autocomplete dropdown inside card; creates new tag if not exists.
- **Remove tag**: × button on each tag chip.
- **Recent tags**: localStorage cache for quick re-add.

### 3.12 HD Upgrade (HQ Button)
- Switches card from preview stream to full scene file (with audio).
- Maintains current time position; resumes playback after switch.
- Global HD toggle in header forces all compatible cards to HD.

### 3.13 Fullscreen
- Native Fullscreen API wrapper (webkit/moz/ms prefixes).
- Exits fullscreen on Escape; button reflects state.

### 3.14 Reel Mode
- Full-height cards; scroll-snap vertical alignment.
- Swipe gestures on mobile; wheel delta on desktop.
- Disables horizontal scroll; hides header on scroll-down.

### 3.15 Card Snapping
- Optional snap to next/previous card mid-scroll.
- Throttled wheel/touch handlers; calculates snap target via card height + gap.

### 3.16 Visibility Manager (singleton)
- IntersectionObserver per card; 20 % threshold.
- Only one video may play at a time; newest visible card wins.
- Background preloading: next N cards fetched while current plays.
- Memory pressure: unloads players outside `unloadDistance` px.

### 3.17 Background Preload
- **Delay**: 150 ms between card loads (desktop), 80 ms (mobile).
- **Fast-scroll delay**: 400 ms when scroll velocity > 2 px/ms.
- **Count limit**: 2 simultaneous preloads (1 on slow networks).
- **Network aware**: disabled on 2g / data-saver.

### 3.18 Error Handling & Retry
- **Player errors**: up to 3 retries with exponential backoff; toast on final failure.
- **GraphQL errors**: toast message; skeleton loaders removed.
- **Network errors**: graceful degradation; keeps UI interactive.

### 3.19 Mobile Optimizations
- Poster images instead of video preview to avoid animated thumbnails.
- Touch handlers for play/pause; prevent ghost clicks.
- Reduced preloads; smaller card max-width; larger touch targets (44 px).
- Autoplay unlock: invisible 1×1 MP4 played on first user gesture.

### 3.20 Keyboard Shortcuts
- **Escape**: close any open overlay (settings, rating dialog, tag picker, performer picker, fullscreen).
- **Arrow keys**: navigate rating stars when dialog open.

### 3.21 Toasts
- Non-blocking feedback for actions (favorite, rating, tag added/removed, errors).
- Auto-dismiss after 3 s; queue if multiple.

### 3.22 Settings Persistence
- Stored in localStorage under key `stashgifs-settings`.
- Immediate apply without reload (except layout mode change).
- Export/import JSON file option.

### 3.23 Theme Customization
- Four color tokens: background, primary surface, secondary surface, accent.
- Applied as CSS custom properties at root; early injection to prevent flash.
- Live preview in settings; hex input with validation.

### 3.24 Performance Constants
- `CONTENT_LOAD_LIMIT`: 4 items per page.
- `unloadDistance`: 1000 px.
- `autoPlayThreshold`: 0.2 (20 % visible).
- `maxSimultaneousPreloads`: 2 (desktop), 1 (mobile/slow).
- `backgroundPreloadDelay`: 150 ms (desktop), 80 ms (mobile).
- `backgroundPreloadFastScrollDelay`: 400 ms.

### 3.25 Dev / Debug Layout
- **ScenePlayer Dev**: alternate layout that patches Stash’s native player and injects a control bar below it.
- Useful for verifying plugin API access without loading feed content.

---

## 4. Plugin Integration (Stash UI)

### 4.1 ScenePlayer Patching
- Uses `window.PluginApi.patch.after('ScenePlayer', callback)` to wrap the built-in player component.
- Injects a small control bar (play/pause, restart, mute, log time) below the native UI.
- Accesses the global video.js instance via `window.PluginApi.utils.InteractiveUtils.getPlayer()`.

### 4.2 GraphQL Client
- Auto-detects endpoint from `window.location.origin` or plugin context.
- Accepts API key if provided; otherwise uses session cookies.
- Request deduplication and 5-minute autocomplete cache.

### 4.3 Base URL Resolution
- Priority: explicit arg → `window.PluginApi.baseURL` → `window.location.origin`.

---

## 5. Extension Points

| Hook | Purpose |
|------|---------|
| `onPerformerChipClick` | Navigate to performer page or open overlay. |
| `onTagChipClick` | Navigate to tag page or open overlay. |
| `onMuteToggle` | Global mute state change callback. |
| `onCancelRequests` | Abort all pending GraphQL requests (used on navigation). |

---

## 6. Out-of-scope (Intentionally Not Implemented)
- Comments or social features.
- Upload or editing of scenes/images.
- Real-time sync across tabs.
- Server-side analytics.
- Offline playback or service-worker caching.

---

## 7. Minimum Viable Re-implementation Checklist

- [ ] GraphQL client with deduplication & auth.
- [ ] Infinite scroll + proportional chunking.
- [ ] Viewport-aware autoplay (IntersectionObserver).
- [ ] Per-card native video player with mute/progress/fullscreen.
- [ ] HD upgrade path (preview → full scene).
- [ ] Favorite toggle (tag-based).
- [ ] 0-10 star rating with half-star support.
- [ ] Tag/performer inclusion filters + exclusion list.
- [ ] Orientation filters (portrait/landscape/square) via GraphQL.
- [ ] Settings persistence (localStorage) + live apply.
- [ ] Plugin patch for ScenePlayer (dev layout).
- [ ] Mobile optimizations (poster, touch, autoplay unlock).
- [ ] Network-aware preload throttling.
- [ ] Error toasts + retry logic.
- [ ] Keyboard shortcuts (Escape, arrow keys).

This expanded reference now captures every significant behaviour, knob, and edge case observed in the current codebase.