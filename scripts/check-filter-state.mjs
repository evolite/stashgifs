#!/usr/bin/env node
// Offline check: FilterState (reset/replace/query build), FilterHistory (dedupe, restore), SavedSearches (save/replace/delete).
// Run: node scripts/check-filter-state.mjs
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';

const { FilterState } = await loadTs('src/FilterState.ts');
const { FilterHistory } = await loadTs('src/FilterHistory.ts');
const { SavedSearches } = await loadTs('src/SavedSearches.ts');

// --- FilterState
const state = new FilterState();
state.replace({ tags: [[1, 'a']], studios: [[9, 's']], markerName: 'm', dateRange: 'week', savedFilter: { id: '5', name: 'x', mode: 'IMAGES' } });
assert.equal(state.pillCount, 4, 'tags + studio + marker + date range (saved filter is not a pill)');
const opts = state.toFilterOptions({ limit: 8, includeSubtags: true });
assert.deepEqual([opts.tags, opts.performers, opts.studios, opts.query, opts.dateRangeFilter, opts.savedFilterId, opts.tagDepth], [['1'], undefined, ['9'], 'm', 'week', '5', -1]);
assert.equal(state.toFilterOptions({ limit: 8, includeSubtags: false, query: 'typed' }).query, 'typed', 'resolved free text overrides marker name');
state.reset();
assert.equal(state.pillCount, 0);
assert.deepEqual(state.toSnapshot(), { tags: [], performers: [], studios: [], markerName: undefined, dateRange: undefined, savedFilter: undefined }, 'reset clears every field');

// --- FilterHistory
const pushes = [];
let popHandler;
globalThis.window = { addEventListener: (_, h) => { popHandler = h; }, removeEventListener: () => { popHandler = undefined; } };
globalThis.history = { replaceState: () => {}, pushState: (s) => pushes.push(s) };
let restored = 0;
const hist = new FilterHistory(state, () => { restored++; });
hist.start();
hist.push();
assert.equal(pushes.length, 0, 'identical to the starting entry: no push');
state.replace({ tags: [[2, 'b']] });
hist.push(); hist.push();
assert.equal(pushes.length, 1, 'consecutive identical states are deduped');
popHandler({ state: { filterSnapshot: { tags: [[7, 'z']], performers: [], studios: [] } } });
assert.deepEqual([...state.tags], [[7, 'z']]);
assert.equal(restored, 1);
hist.push();
assert.equal(pushes.length, 1, 'restoring from history does not push a new entry');
popHandler({ state: null });
assert.equal(restored, 1, 'foreign history entries are ignored');

// --- SavedSearches
let saved = [];
const settings = { data: { settings: { get savedSearches() { return saved; } } }, save: (p) => { saved = p.settings.savedSearches; } };
const searches = new SavedSearches(settings);
const snap = { tags: [[1, 'a']], performers: [], studios: [], markerName: 'm', dateRange: 'month', savedFilter: { id: '1', name: 'n', mode: 'IMAGES' } };
searches.save('Mine', snap);
searches.save(' mine ', { ...snap, tags: [[2, 'b']] });
assert.equal(saved.length, 1, 'same name (case/space-insensitive) replaces');
assert.deepEqual([saved[0].name, saved[0].tags, saved[0].dateRange, 'savedFilter' in saved[0]], [' mine ', [[2, 'b']], 'month', false]);
searches.delete(saved[0].id);
assert.equal(saved.length, 0);

console.log('filter state OK');
