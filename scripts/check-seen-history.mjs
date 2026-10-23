#!/usr/bin/env node
// Offline check: SeenHistory caps, orders, filters and persists.
// Run: node scripts/check-seen-history.mjs
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
const { SeenHistory } = await loadTs('src/SeenHistory.ts');

let max = 3;
const history = new SeenHistory(() => max);
const item = (type, id) => ({ type, data: { id } });

history.mark('marker', '1'); history.mark('image', '1'); history.mark('marker', '2'); history.mark('marker', '3');
assert.deepEqual(
  history.filter([item('marker', '1'), item('image', '1'), item('marker', '3')], true, false).map((i) => `${i.type}:${i.data.id}`),
  ['marker:1'],
  'oldest entry evicted past the cap; marker 1 and image 1 are different keys',
);
history.mark('marker', '3'); // re-marking moves to most recent, no growth
history.dispose();
assert.deepEqual(JSON.parse(store.get('stashgifs-seen-ids')), ['image:1', 'marker:2', 'marker:3'], 'persisted most-recent-last');

const reloaded = new SeenHistory(() => max);
const all = [item('marker', '2'), item('marker', '3')];
assert.deepEqual(reloaded.filter(all, true, false), [], 'scroll: seen content is removed');
assert.deepEqual(reloaded.filter(all, false, false), all, 'fresh load: exhausted pool falls back to everything');
assert.deepEqual(reloaded.filter(all, true, true), all, 'saved filter is never thinned');
max = 0;
assert.deepEqual(reloaded.filter(all, true, false), all, 'size 0 disables the history');

console.log('seen history OK');
