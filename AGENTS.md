# AGENTS.md

## Repository overview
- Project: StashGifs (TypeScript, DOM-driven UI)
- Source: `src/` (ESM TypeScript, browser-first)
- Build output: `app/assets/` (tsconfig outDir)
- Generated GraphQL types: `src/graphql/`
- Generated version file: `src/version.ts` (via `scripts/generate-version.js`)
- No Cursor or Copilot rules found in `.cursor/rules/`, `.cursorrules`, `.github/copilot-instructions.md`

## Commands (build/lint/test)
- Install deps: `npm install`
- Build: `npm run build` (runs `scripts/generate-version.js` via `prebuild`)
- Watch build: `npm run watch`
- Type-check only: `npm run type-check`
- Clean build artifacts: `npm run clean` (removes `app/assets/*.js` and `.map`)
- GraphQL codegen: `npm run codegen`
- GraphQL codegen (watch): `npm run codegen:watch`
- Lint: none configured (no ESLint/Prettier)

### Tests
- There is no test runner configured.
- Single-test equivalent: `npx tsc --noEmit src/SomeFile.ts`
- For UI changes, do manual verification of keyboard/focus and touch flows.

## Code style guidelines
### Language & module system
- TypeScript with ESM output (module `ES2020`).
- Local imports include the `.js` extension (example: `./Foo.js`).
- Prefer `import type` for type-only imports.
- Use `globalThis` when referencing globals.
- Avoid `@ts-nocheck`; prefer targeted fixes.

### Imports
- Order: external libs, then local modules, then types.
- Keep imports minimal; delete unused imports.
- Prefer narrow imports from helpers/utils instead of barrel exports.

### Formatting
- 2-space indentation.
- Follow existing wrapping and whitespace patterns.
- Group related logic with blank lines.
- Use template literals for multi-line `innerHTML`.
- Keep inline styles compact and consistent.

### Naming
- Classes: `PascalCase`.
- Methods/functions: `camelCase`.
- Constants: `UPPER_SNAKE_CASE`.
- Booleans: prefix with `is`, `has`, `should`, `can`.
- DOM nodes: name by role (`header`, `footer`, `buttonGroup`).
- Handlers: `onX`, `handleX`, `setX` naming patterns.

### Types & data handling
- Use explicit types for public APIs and shared helpers.
- Keep IDs as `string` unless numeric parsing is required.
- Prefer `const` and `readonly` where values should not change.
- Use `private`/`protected` on class fields to encode intent.
- Use `??=` or guarded assignments for optional arrays.
- Validate numeric parsing with `Number.isFinite`/`Number.isNaN`.

### Error handling
- Wrap API calls in `try/catch`.
- Log failures with `console.error`/`console.warn`.
- Surface user feedback via `showToast`.
- Return early when dependencies (API, manager) are missing.
- Use `AbortController` to cancel in-flight requests when appropriate.

### DOM & UI
- Prefer shared helpers in `BasePost` for common layouts.
- Use `renderBasePost` when building post structure.
- Use `buildFooterContainer` for action rows.
- Use `buildImageHeader` for image-based headers.
- Reuse `applyIconButtonStyles` and `addHoverEffect` for consistency.
- Use `setupTouchHandlers` and `preventClickAfterTouch` for mobile.
- Keep buttons at 44x44px minimum for touch targets.
- Use `THEME` for colors, spacing, and typography.
- Use `requestAnimationFrame` for measurement/positioning work.
- Keep overlays/dialogs inside card bounds and within the viewport.
- Apply `role="dialog"`, `aria-modal`, `aria-hidden`, and `hidden` for overlays.

### State & lifecycle
- Clean up timers and listeners in `destroy()`.
- Ensure dialogs are closed and hidden before removal.
- Avoid mutating shared arrays without cloning when needed.
- Keep scroll/visibility handlers passive where possible.

### GraphQL
- Generated types and documents live under `src/graphql/`.
- Run `npm run codegen` after query/schema changes.
- Prefer generated types for API responses.
- Do not edit generated GraphQL output by hand.

## File/area notes
- `src/`: main TypeScript sources.
- `src/utils/`: shared DOM helpers and touch utilities.
- `src/graphql/`: generated GraphQL types/queries.
- `scripts/`: build/version helpers.
- `app/assets/`: build output; avoid manual edits.
- `src/version.ts` is generated during build; avoid manual edits.
- `tsconfig.json` excludes `src/controllers`, `src/players`, `src/services`, `src/state`.

## PR/commit hygiene
- Keep changes focused to the feature/bug being addressed.
- Prefer small, logical commits.
- Do not commit generated files unless explicitly requested.

## Accessibility
- Provide `aria-label` and `title` for interactive icons.
- Use `role="dialog"` and `aria-modal` for overlays.
- Set `aria-hidden` and `hidden` when closing dialogs.
- Maintain 44x44px minimum touch targets.

## Performance
- Use `throttle` for resize or scroll-driven UI updates.
- Avoid forced layout inside large loops.
- Reuse DOM nodes where possible.

## API usage
- Guard API calls when `api` or `favoritesManager` is missing.
- Prefer `StashAPI` helpers over direct fetches.
- Update local state after successful mutations.
- Use optimistic UI updates only when rollback is handled.

## Debugging tips
- Use `console.error` for failures and `showToast` for user feedback.
- Guard DOM queries and exit early on missing elements.
- Prefer logging IDs/names rather than full objects.

## Common pitfalls
- Do not omit `.js` on local import paths.
- Avoid mutating shared arrays without cloning.
- Keep dialog overlays inside card bounds.
- Remember to remove listeners/timers in `destroy()`.
- Avoid editing generated files (`src/version.ts`, `src/graphql/*`).

## Quick reference
- Build: `npm run build`
- Type-check: `npm run type-check`
- Codegen: `npm run codegen`
- Single-file type-check: `npx tsc --noEmit src/SomeFile.ts`
- Clean: `npm run clean`
