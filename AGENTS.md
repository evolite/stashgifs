# AGENTS.md

## Repository overview
- Project: StashGifs (TypeScript, DOM-driven UI)
- Source: `src/` (ESM TypeScript)
- Build output: `stashgifs/app/assets` (tsconfig outDir)
- Generated GraphQL types: `src/graphql/`
- Generated version file: `src/version.ts` (from `scripts/generate-version.js`)
- No Cursor or Copilot rules found in `.cursor/rules/`, `.cursorrules`, or `.github/copilot-instructions.md`

## Commands (build/lint/test)
- Install deps: `npm install`
- Build: `npm run build` (runs `scripts/generate-version.js` via prebuild)
- Watch build: `npm run watch`
- Type-check only: `npm run type-check`
- Clean build artifacts: `npm run clean`
- GraphQL codegen: `npm run codegen`
- GraphQL codegen (watch): `npm run codegen:watch`
- Lint: none configured

### Tests
- There is no test runner configured.
- Single-test equivalent: `npx tsc --noEmit src/SomeFile.ts`
- For UI changes, manually verify keyboard/focus flows.

## Code style guidelines
### Language & module system
- TypeScript with ESM output (module ES2020).
- Local imports include the `.js` extension (example: `./Foo.js`).
- Prefer `import type` for types when practical.
- Use `globalThis` for browser globals when practical.
- Avoid `@ts-nocheck` unless there is no safer alternative.

### Formatting
- 2-space indentation.
- Keep lines readable; follow existing wrapping patterns.
- Group related logic with blank lines.
- Inline styles are common; keep style blocks compact and consistent.
- Prefer template literals for multi-line `innerHTML`.

### Naming
- Classes: `PascalCase`.
- Methods/functions: `camelCase`.
- Constants: `UPPER_SNAKE_CASE`.
- Booleans: prefix with `is`, `has`, `should`, `can`.
- DOM elements: name by role (`header`, `footer`, `buttonGroup`).
- Handlers: use `onX`/`handleX`/`setX` patterns.

### Imports
- Order: external libs, then local modules, then types.
- Avoid unused imports; keep imports minimal.
- Prefer narrow imports from `utils`/`icons` instead of wildcard patterns.

### Types & data handling
- Use explicit types for public APIs and shared helpers.
- Keep `string` ids consistent; parse to `number` only when required.
- Favor `const` and `readonly` where values should not change.
- Use `private`/`protected` on class fields to encode intent.
- Use `??=` or guarded assignments for optional arrays.
- Validate numeric parsing with `Number.isFinite`/`Number.isNaN`.

### Error handling
- Use `try/catch` around API calls.
- Log failures with `console.error`/`console.warn`.
- Surface user feedback via `showToast`.
- Return early when required dependencies (API, manager) are missing.
- Use `AbortController` to cancel in-flight requests when appropriate.

### DOM & UI
- Prefer shared helpers in `BasePost` for common layouts.
- Use `renderBasePost` when building post structure.
- Use `buildFooterContainer` for action rows.
- Use `buildImageHeader` for image-based headers.
- Reuse `applyIconButtonStyles` and `addHoverEffect` for button consistency.
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
- Generated types and documents live under `src/graphql`.
- Run `npm run codegen` after query/schema changes.
- Prefer generated types for API responses.

## File/area notes
- `src/`: main TS sources.
- `src/graphql/`: generated GraphQL types/queries; avoid manual edits.
- `stashgifs/app/`: packaged app assets.
- `stashgifs/app/assets/`: build output; update only when intentional.
- `src/version.ts` is generated during build; avoid manual edits.
- `tsconfig.json` excludes `src/controllers`, `src/players`, `src/services`, `src/state`.

## Repository layout
- `scripts/`: build/version helpers.
- `src/utils/`: shared DOM helpers and touch utilities.
- `src/graphql/`: generated GraphQL types/queries.
- Root `package.json` defines scripts and tooling.

## PR/commit hygiene
- Keep changes focused to the feature/bug being addressed.
- Prefer small, logical commits.

## Agent tips
- Default to `npm run type-check` for validation.
- If changing UI layout, confirm dialogs/overlays remain accessible.
- Preserve existing interaction patterns (hover, touch, keyboard).

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
