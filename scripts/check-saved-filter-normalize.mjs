#!/usr/bin/env node
// Offline check: Stash's saved-filter criterion shapes are converted to GraphQL input shapes.
// Run: node scripts/check-saved-filter-normalize.mjs
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';

const { StashAPI } = await loadTs('src/StashAPI.ts');

const out = Object.create(StashAPI.prototype).normalizeSavedObjectFilter({
  rating100: { modifier: 'BETWEEN', value: { value: 20, value2: 80 } },
  o_counter: { modifier: 'GREATER_THAN', value: { value: 1, value2: null } },
  resolution: { modifier: 'EQUALS', value: '720p' },
  organized: 'true',
  tags: { modifier: 'INCLUDES_ALL', value: { depth: 0, excluded: [], items: [{ id: '16', label: 'x' }] } },
  weird: { modifier: 'X', value: { nope: 1 } },
});

assert.deepEqual(out.rating100, { modifier: 'BETWEEN', value: 20, value2: 80 });
assert.deepEqual(out.o_counter, { modifier: 'GREATER_THAN', value: 1 });
assert.deepEqual(out.resolution, { modifier: 'EQUALS', value: 'STANDARD_HD' });
assert.equal(out.organized, true);
assert.deepEqual(out.tags, { value: ['16'], modifier: 'INCLUDES_ALL', depth: 0 });
assert.ok(!('weird' in out));
console.log('saved filter normalization OK');
