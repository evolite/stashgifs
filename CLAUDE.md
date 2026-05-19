# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Always use **pnpm**, never npm — the project uses `pnpm-lock.yaml`.

```bash
pnpm run build        # compile TypeScript (runs generate-version.js prebuild)
pnpm run release      # build + deploy to local Stash instance for testing
pnpm run watch        # incremental watch build
pnpm run type-check   # type-check without emitting
pnpm run clean        # remove build artifacts from stashgifs/app/assets/
pnpm run codegen      # regenerate src/graphql/ from schema
```

After making any code changes, always run `pnpm run release` so the user can test the result.

There is no test runner. Type-check a single file with `npx tsc --noEmit src/SomeFile.ts`. For UI changes, manual verification is required.

Build output goes to `stashgifs/app/assets/`. The file `src/version.ts` and everything under `src/graphql/` are generated — do not edit by hand.

## Architecture

StashGifs is a Stash UI plugin: a single-page, infinite-scroll feed rendered in the browser. There is no framework — all DOM is built imperatively in TypeScript classes.

### Class hierarchy

```
BasePost (abstract)
├── ImagePost          — GIF/static image posts
└── VideoPostBase (abstract)
    ├── VideoPost      — scene marker videos
    └── ImageVideoPost — MP4 image posts
```

`BasePost` provides the shared post shell (header, footer, overlays, rating, tag/performer chips, touch handlers). `VideoPostBase` adds video-specific fields: HQ toggle, mute overlay, poster layer, load-error retry, and an `IntersectionObserver`-driven autoplay contract. Concrete subclasses implement a small set of abstract methods (`getPlayer`, `checkForLoadError`, `getHQButtonOffLabel`, etc.).

`FeedContainer` orchestrates the feed: pagination, mixed-content batching (markers + images + short-form scenes), filter state, and wiring posts into the DOM.

### Key singletons and managers

- `VisibilityManager` — `IntersectionObserver` singleton; ensures only one video plays at a time and manages background preloading.
- `AudioManager` — global mute state; each VideoPostBase subscribes via `onMuteToggle`.
- `FavoritesManager` — caches and toggles the `StashGifs Favorite` tag.
- `PluginSettingsManager` — localStorage-backed settings, applied live.
- `PosterPreloader` — network-aware prefetch of poster images.
- `StashAPI` — GraphQL client (auto-detects endpoint, API key, deduplication).

### Shared utilities

- `src/utils/imagePostUtils.ts` — shared favorite/dialog logic for `ImagePost` and `ImageVideoPost`.
- `src/utils/touchHandlers.ts` — `setupTouchHandlers`, `preventClickAfterTouch`.
- `src/utils.ts` — general DOM helpers (`applyIconButtonStyles`, `addHoverEffect`, `showToast`, `throttle`, `THEME`, etc.).
- `src/graphql/` — generated types and query documents.

### Plugin integration

The feed is mounted as a Stash UI plugin. It accesses `window.PluginApi` for GraphQL endpoint discovery and (optionally) ScenePlayer patching. The GraphQL client in `src/graphql/client.ts` auto-detects the base URL from `window.PluginApi.baseURL` or `window.location.origin`.

## Release workflow

Push a semver tag (`v1.2.3`). CI (Forgejo Actions) will:
1. Bump versions in `package.json`, `stashgifs/manifest`, `stashgifs/stashgifs.yml`.
2. Regenerate `CHANGELOG.md` via git-cliff.
3. Build, create `stashgifs.zip`, and publish a Codeberg release.
4. Commit the version bump back to `master`.

Do **not** manually edit version files or commit generated files before tagging.

## Commit conventions

All commits must follow [Conventional Commits](https://www.conventionalcommits.org/):

| Type | Effect |
|------|--------|
| `feat:` | minor version bump, appears in changelog |
| `fix:` | patch version bump, appears in changelog |
| `perf:`, `refactor:`, `docs:` | changelog only |
| `chore:`, `ci:`, `build:` | excluded from changelog |
| `feat!:` / `BREAKING CHANGE:` | major version bump |

Description: lowercase, imperative mood, no trailing period.

## Code conventions

- ESM TypeScript; local imports use `.js` extension (e.g. `import './Foo.js'`).
- `import type` for type-only imports.
- 2-space indentation; template literals for multi-line `innerHTML`.
- DOM nodes named by role (`header`, `footer`, `buttonGroup`); handlers as `onX`/`handleX`.
- Minimum 44×44 px touch targets. Use `THEME` for colors/spacing.
- Clean up timers, listeners, and observers in `destroy()`.
- `aria-label`, `title`, `role="dialog"`, `aria-modal` required on interactive/overlay elements.

## SonarQube

Self-hosted at `https://sonar.slashdir.net` (project key `stashgifs`). Quality gate enforces `new_duplicated_lines_density ≤ 3%`. Analysis runs on every push via the `sonar.yml` workflow. The SonarQube MCP server is available for querying issues and gate status.
