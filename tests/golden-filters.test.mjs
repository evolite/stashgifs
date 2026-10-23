// Golden test for the GraphQL filters the feed sends. Records the variables for a matrix of filter
// options (network stubbed) and compares them with tests/fixtures/golden-filters.json, so a change
// to filter building shows up as a readable diff.
//   UPDATE_GOLDEN=1 pnpm test    rewrite the fixture after an intentional change
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { newStashApi } from './helpers.mjs';

const FIXTURE = new URL('./fixtures/golden-filters.json', import.meta.url);

const savedFilter = {
  id: '3', name: 'sf', mode: 'SCENE_MARKERS', find_filter: { q: 'abc', sort: 'date', direction: 'DESC' },
  object_filter: {
    tags: { modifier: 'INCLUDES', value: { items: [{ id: '4' }], depth: 1 } },
    rating100: { modifier: 'GREATER_THAN', value: { value: 40 } },
    performers: { modifier: 'INCLUDES_ALL', value: { items: [{ id: '7' }] } },
  },
};

async function makeApi() {
  const api = await newStashApi((op) => {
    if (op === 'GetSavedFilter') return { findSavedFilter: savedFilter };
    return { findSceneMarkers: { count: 0, scene_markers: [] }, findScenes: { count: 0, scenes: [] }, findImages: { count: 0, images: [] } };
  });
  // tag routing: 1 -> marker only, 2 -> scene only, 3 -> performer only, 4 -> image only, 5 -> everywhere
  const sources = { 1: [1, 0, 0, 0], 2: [0, 1, 0, 0], 3: [0, 0, 1, 0], 4: [0, 0, 0, 1], 5: [1, 1, 1, 1] };
  for (const [id, [marker, scene, performer, image]] of Object.entries(sources)) {
    api.tags.tagSources.set(id, { marker: !!marker, scene: !!scene, performer: !!performer, image: !!image });
  }
  return api;
}

const base = { limit: 8, sortSeed: 'random_1' };
const feedCases = {
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
const imageCases = {
  none: undefined,
  tags: { tagIds: ['1', '3', '4', '5'], tagDepth: 1 },
  performerTags: { tagIds: ['3', '4'], showPerformerTags: true },
  excluded: { tagIds: ['4'], excludedTagIds: ['9'], showPerformerTags: true },
  misc: { performerIds: ['10'], studioIds: ['20'], studioDepth: -1, imagesInGalleryOnly: true, galleryIds: ['1', '2'], orientationFilter: ['portrait'], dateRangeFilter: 'week' },
  saved: { savedFilterId: '3', dateRangeFilter: 'year', orientationFilter: ['landscape'] },
};

// Normalize what legitimately differs per run: random sort seeds and "now"-based dates.
const normalize = (_key, value) => (typeof value === 'string'
  ? value.replace(/random_\d{8}/g, 'random_SEED').replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, 'DATE')
  : value);

async function record(name, out, call) {
  const api = await makeApi();
  try { await call(api); } catch (error) { api.calls.push({ error: String(error.message ?? error) }); }
  out[name] = api.calls.map(({ op, variables, error }) => (error ? { error } : { op, variables }));
}

it('sends the expected filters for every content type and filter combination', async () => {
  const out = {};
  for (const [name, filters] of Object.entries(feedCases)) {
    await record(`markers/${name}`, out, (api) => api.fetchSceneMarkers({ ...base, ...filters }));
    await record(`shortform/${name}`, out, (api) => api.fetchShortFormVideos({ ...base, ...filters }, 120, 8, filters.offset ?? 0));
    await record(`previews/${name}`, out, (api) => api.fetchScenePreviews({ ...base, ...filters }, 8, filters.offset ?? 0));
  }
  for (const [name, filters] of Object.entries(imageCases)) {
    await record(`images/${name}`, out, (api) => api.findImages(['.gif', '.mp4'], filters, 20, 0));
  }

  const actual = `${JSON.stringify(out, normalize, 2)}\n`;
  if (process.env.UPDATE_GOLDEN) {
    writeFileSync(FIXTURE, actual);
    return;
  }
  assert.equal(actual, readFileSync(FIXTURE, 'utf8'), 'filter building changed; rerun with UPDATE_GOLDEN=1 if intentional');
});
