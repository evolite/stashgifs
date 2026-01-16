# AGENTS.md

## Repository overview
- Project: StashGifs (TypeScript, DOM-driven UI)
- Output build: `stashgifs/app/assets`
- Source: `src/`
- No Cursor or Copilot rules found in `.cursor/rules/`, `.cursorrules`, or `.github/copilot-instructions.md`

## Commands (build/lint/test)
- Install deps: `npm install`
- Build: `npm run build`
- Watch build: `npm run watch`
- Type-check only: `npm run type-check`
- Clean build artifacts: `npm run clean`
- GraphQL codegen: `npm run codegen`
- GraphQL codegen (watch): `npm run codegen:watch`

### Tests
- There is no test runner configured.
- For a “single test” equivalent, run a targeted type-check:
  - `npx tsc --noEmit src/SomeFile.ts`

## Code style guidelines
### Language & module system
- TypeScript with ESM output.
- Local imports include the `.js` extension in source (e.g., `import { Foo } from './Foo.js'`).
- Prefer `import type` for types when practical.

### Formatting
- 2-space indentation.
- Keep lines readable; follow existing wrapping patterns.
- Group related logic with blank lines.
- Inline styles are common; keep style blocks compact and consistent.

### Naming
- Classes: `PascalCase`.
- Methods/functions: `camelCase`.
- Constants: `UPPER_SNAKE_CASE`.
- Booleans: prefix with `is`, `has`, `should`, `can`.
- DOM elements: name by role (`header`, `footer`, `buttonGroup`).

### Imports
- Order: external libs, then local modules, then types.
- Avoid unused imports; keep imports minimal.

### Types & data handling
- Use explicit types for public APIs and shared helpers.
- Keep `string` ids consistent; parse to `number` only when required.
- Favor `const` and `readonly` where values should not change.
- Use `??=` or guarded assignments for optional arrays.

### Error handling
- Use `try/catch` around API calls.
- Log failures with `console.error` and surface user feedback via `showToast`.
- Return early when required dependencies (API, manager) are missing.

### DOM & UI
- Prefer helper methods (`applyIconButtonStyles`, `addHoverEffect`, `buildFooterContainer`, etc.).
- Avoid layout thrashing: measure DOM inside `requestAnimationFrame` when needed.
- Use `pointer-events` and `aria-*` attributes for dialogs and overlays.
- Keep buttons at 44x44px minimum for touch targets.

### State & lifecycle
- Clean up timers and listeners in `destroy()`.
- Ensure dialogs are closed and hidden before removal.
- Avoid mutating shared arrays without cloning when needed.

### GraphQL
- Generated types live under `src/graphql`.
- Run `npm run codegen` after query/schema changes.

## File/area notes
- `src/`: main TS sources.
- `stashgifs/app/assets/`: build output; update only when intentional.
- `src/version.ts` is generated during build via `scripts/generate-version.js`.

## Repository layout
- `scripts/`: build/version helpers.
- `src/graphql/`: generated GraphQL types/queries.
- `stashgifs/app/`: packaged app assets.
- Root `package.json` defines build scripts.

## PR/commit hygiene
- Keep changes focused to the feature/bug being addressed.
- Prefer small, logical commits.

## Agent tips
- Default to `npm run type-check` for validation.
- If changing UI layout, confirm dialogs/overlays remain accessible and within card bounds.
- Preserve existing interaction patterns (hover, touch, keyboard).

## UI patterns
- Prefer shared helpers in `BasePost` for common layouts.
- Use `renderBasePost` when building post structure.
- Use `buildFooterContainer` for action rows.
- Use `buildImageHeader` for image-based headers.
- Keep button groups aligned to the right unless a view dictates otherwise.
- Reuse `applyIconButtonStyles` and `addHoverEffect` for button consistency.

## Accessibility
- Provide `aria-label` and `title` for interactive icons.
- Use `role="dialog"` and `aria-modal` for overlays.
- Set `aria-hidden` and `hidden` when closing dialogs.
- Maintain 44x44px minimum touch targets.

## Performance
- Use `throttle` for resize or scroll-driven UI updates.
- Use `requestAnimationFrame` for measurement/positioning work.
- Avoid forced layout inside large loops.
- Reuse DOM nodes where possible.

## API usage
- Guard API calls when `api` or `favoritesManager` is missing.
- Prefer `StashAPI` helpers over direct fetches.
- Update local state after successful mutations.
- Use optimistic UI updates only when rollback is handled.

## Styling notes
- Inline styles are common; keep them minimal.
- Keep transitions subtle and consistent with existing patterns.
- When changing UI, ensure overlays remain within card bounds.
- Avoid editing `stashgifs/app/assets` unless intended.

## Generated files
- `src/version.ts` is generated during build; avoid manual edits.
- Build artifacts live under `stashgifs/app/assets`.
- Regenerate assets via `npm run build` or `npm run watch`.

## Testing guidance
- No automated tests; rely on targeted type-checks.
- Favor `npx tsc --noEmit src/SomeFile.ts` when touching a single file.
- If editing UI, verify keyboard/focus flows manually.

## Debugging tips
- Use `console.error` for failures and `showToast` for user feedback.
- Guard DOM queries and exit early on missing elements.
- Prefer logging IDs/names rather than full objects.

## Common pitfalls
- Do not omit `.js` on local import paths.
- Avoid mutating shared arrays without cloning.
- Keep dialog overlays inside card bounds.
- Remember to remove listeners/timers in `destroy()`.

## Quick reference
- Build: `npm run build`
- Type-check: `npm run type-check`
- Codegen: `npm run codegen`
- Single-file type-check: `npx tsc --noEmit src/SomeFile.ts`
