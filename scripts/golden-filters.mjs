#!/usr/bin/env node
// Golden-output harness for StashAPI's filter building: records the GraphQL variables sent for a
// matrix of filter options (network stubbed) and compares it with golden-filters.expected.json.
//   node scripts/golden-filters.mjs --check     compare (used by `pnpm run check`)
//   node scripts/golden-filters.mjs --update    rewrite the expected file after an intentional change
//   node scripts/golden-filters.mjs             print the output
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadTs } from './load-ts.mjs';

globalThis.window = {};
globalThis.location = { origin: 'http://stash.test', pathname: '/plugin/stashgifs/assets/app/' };
const { StashAPI } = await loadTs('src/StashAPI.ts');

const sentinel = (query) => query.replace(/\s+/g, ' ').match(/(query|mutation) (\w+)/)?.[2] ?? 'anonymous';
function makeApi() {
  const api = new StashAPI('http://stash.test');
  api.sent = [];
  api.gqlClient = {
    destroy() {},
    query: async ({ query, variables }) => {
      api.sent.push({ op: sentinel(query), variables });
      if (/GetSavedFilter\b/.test(query)) {
        return { data: { findSavedFilter: { id: '3', name: 'sf', mode: 'SCENE_MARKERS', find_filter: { q: 'abc', sort: 'date', direction: 'DESC' },
          object_filter: { tags: { modifier: 'INCLUDES', value: { items: [{ id: '4' }], depth: 1 } }, rating100: { modifier: 'GREATER_THAN', value: { value: 40 } }, performers: { modifier: 'INCLUDES_ALL', value: { items: [{ id: '7' }] } } } } } };
      }
      return { data: { findSceneMarkers: { count: 0, scene_markers: [] }, findScenes: { count: 0, scenes: [] }, findImages: { count: 0, images: [] } } };
    },
    mutate: async () => ({ data: {} }),
  };
  // tag source routing: 1 -> marker only, 2 -> scene only, 3 -> performer only, 4 -> image only, 5 -> everywhere
  const src = { 1: [1, 0, 0, 0], 2: [0, 1, 0, 0], 3: [0, 0, 1, 0], 4: [0, 0, 0, 1], 5: [1, 1, 1, 1] };
  for (const [id, [marker, scene, performer, image]] of Object.entries(src)) {
    api._tagSourceCache.set(id, { marker: !!marker, scene: !!scene, performer: !!performer, image: !!image });
  }
  return api;
}

const base = { limit: 8, sortSeed: 'random_1' };
const markerCases = {
  none: {},
  tags: { tags: ['1', '2', '5'] },
  tagsDepth: { tags: ['1'], tagDepth: -1 },
  performers: { performers: ['10'] },
  studios: { studios: ['20'], studioDepth: -1 },
  everything: { tags: ['1', '3', '4'], performers: ['10', '11'], studios: ['20'], dateRangeFilter: 'month', orientationFilter: ['portrait'], excludedTagIds: ['9'], showPerformerTags: true, includeSceneTagsInMarkerFilter: true },
  savedFilter: { savedFilterId: '3', savedFilterMode: 'SCENE_MARKERS', tags: ['5'] },
  savedImages: { savedFilterId: '3', savedFilterMode: 'IMAGES' },
  query: { query: 'hello' },
  orientation: { orientationFilter: ['landscape', 'square'] },
  excluded: { excludedTagIds: ['9', '9', '12'], showPerformerTags: false },
  offset: { offset: 16 },
  shuffle: { shuffleMode: true, tags: ['2'], includeScenesWithoutMarkers: true },
};
const out = {};
const run = async (name, fn) => {
  const api = makeApi();
  try { await fn(api); } catch (e) { api.sent.push({ error: String(e.message ?? e) }); }
  out[name] = api.sent;
};
for (const [name, f] of Object.entries(markerCases)) {
  await run(`markers/${name}`, (api) => api.fetchSceneMarkers({ ...base, ...f }));
  await run(`shortform/${name}`, (api) => api.fetchShortFormVideos({ ...base, ...f }, 120, 8, f.offset ?? 0));
  await run(`previews/${name}`, (api) => api.fetchScenePreviews({ ...base, ...f }, 8, f.offset ?? 0));
}
const imageCases = {
  none: undefined,
  tags: { tagIds: ['1', '3', '4', '5'], tagDepth: 1 },
  performerTags: { tagIds: ['3', '4'], showPerformerTags: true },
  excluded: { tagIds: ['4'], excludedTagIds: ['9'], showPerformerTags: true },
  misc: { performerIds: ['10'], studioIds: ['20'], studioDepth: -1, imagesInGalleryOnly: true, galleryIds: ['1', '2'], orientationFilter: ['portrait'], dateRangeFilter: 'week' },
  saved: { savedFilterId: '3', dateRangeFilter: 'year', orientationFilter: ['landscape'] },
};
for (const [name, f] of Object.entries(imageCases)) {
  await run(`images/${name}`, (api) => api.findImages(['.gif', '.mp4'], f, 20, 0));
}
// Normalize what legitimately differs per run: random sort seeds and "now"-based dates.
const normalize = (_k, v) => (typeof v === 'string'
  ? v.replace(/random_\d{8}/g, 'random_SEED').replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, 'DATE')
  : v);
const actual = `${JSON.stringify(out, normalize, 2)}\n`;
const expectedPath = new URL('./golden-filters.expected.json', import.meta.url);
if (process.argv.includes('--update')) {
  writeFileSync(expectedPath, actual);
  console.log('golden filters updated');
} else if (process.argv.includes('--check')) {
  assert.equal(actual, readFileSync(expectedPath, 'utf8'), 'filter building changed — rerun with --update if intentional');
  console.log('golden filters OK');
} else {
  process.stdout.write(actual);
}
