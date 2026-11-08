import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers.mjs';

const { FilterState } = await loadTs('src/FilterState.ts');
const { FilterHistory } = await loadTs('src/FilterHistory.ts');
const { SavedSearches } = await loadTs('src/SavedSearches.ts');
const { FeedFilters } = await loadTs('src/api/FeedFilters.ts');

describe('short-form source', () => {
  const filters = new FeedFilters(new Map());
  const scene = (path, duration, ...tags) => ({ files: [{ path, duration }], tags: tags.map(id => ({ id })) });
  const inside = scene('/media/shorts [HD]/sub/video.mp4', 119);
  const tagged = scene('/media/other/video.mp4', 119, '7');
  const scope = { tagId: '7', folder: '/media/shorts [HD]/' };

  it('requires duration and lets either source criterion match', () => {
    const matches = filters.shortFormSceneMatcher(120, scope);
    assert.equal(matches(inside), true);
    assert.equal(matches(tagged), true);
    assert.equal(matches(scene('/media/shorts [HD]-old/video.mp4', 119, '70')), false);
    assert.equal(matches(scene(inside.files[0].path, 120, '7')), false);
    assert.equal(matches(scene(inside.files[0].path, undefined, '7')), false);
    assert.equal(filters.shortFormSceneMatcher(120)(tagged), true);
    assert.equal(filters.shortFormSceneMatcher(120, { tagId: '7' })(inside), false);
    assert.equal(filters.shortFormSceneMatcher(120, { folder: scope.folder })(tagged), false);
  });

  it('adds server-side source criteria without replacing normal feed criteria', () => {
    const combined = filters.buildShortFormSceneFilter({ performers: ['2'] }, 120, scope);
    assert.deepEqual(combined.duration, { value: 120, modifier: 'LESS_THAN' });
    assert.deepEqual(combined.performers.value, [2]);
    assert.deepEqual(combined.AND.tags, { value: ['7'], modifier: 'INCLUDES', depth: 0 });
    assert.equal(combined.AND.OR.path.value, '^/media/shorts \\[HD\\]/');
    assert.equal(filters.buildShortFormSceneFilter(undefined, 120, { folder: scope.folder }).path.modifier, 'MATCHES_REGEX');
    assert.equal(filters.buildShortFormSceneFilter(undefined, 120, { tagId: '7' }).AND.OR, undefined);
    const ordinary = filters.buildShortFormSceneFilter({ tags: ['8'] }, 120, scope);
    assert.deepEqual(ordinary.tags.value, ['8']);
    assert.equal(ordinary.AND, undefined);
  });

  it('matches Windows separators and case while keeping the folder boundary', () => {
    const windows = { folder: 'D:\\Media\\Shorts\\' };
    const matches = filters.shortFormSceneMatcher(120, windows);
    assert.equal(matches(scene('d:\\Media\\SHORTS\\Sub\\video.mp4', 50)), true);
    assert.equal(matches(scene('D:/Media/Shorts/video.mp4', 50)), true);
    assert.equal(matches(scene('D:/Media/Shorts2/video.mp4', 50)), false);
  });
});

describe('FilterState', () => {
  const full = {
    tags: [[1, 'a']], studios: [[9, 's']], markerName: 'm', dateRange: 'week',
    savedFilter: { id: '5', name: 'x', mode: 'IMAGES' },
  };

  it('builds the feed query from every field', () => {
    const state = new FilterState();
    state.replace(full);
    const query = state.toFilterOptions({ limit: 8, includeSubtags: true });
    assert.deepEqual(
      [query.tags, query.performers, query.studios, query.query, query.dateRangeFilter, query.savedFilterId, query.tagDepth],
      [['1'], undefined, ['9'], 'm', 'week', '5', -1],
    );
  });

  it('lets resolved free text override the marker-name search', () => {
    const state = new FilterState();
    state.replace(full);
    assert.equal(state.toFilterOptions({ limit: 8, includeSubtags: false, query: 'typed' }).query, 'typed');
  });

  it('counts pills (a saved filter is not one) and reset clears every field', () => {
    const state = new FilterState();
    state.replace(full);
    assert.equal(state.pillCount, 4);
    state.reset();
    assert.equal(state.pillCount, 0);
    assert.deepEqual(state.toSnapshot(), {
      tags: [], performers: [], studios: [], markerName: undefined, dateRange: undefined, savedFilter: undefined,
    });
  });
});

describe('FilterHistory', () => {
  function setup() {
    const pushes = [];
    let onPop;
    globalThis.window = { addEventListener: (_, handler) => { onPop = handler; }, removeEventListener: () => {} };
    globalThis.history = { replaceState() {}, pushState: (entry) => pushes.push(entry) };
    const state = new FilterState();
    let restores = 0;
    const history = new FilterHistory(state, () => { restores++; });
    history.start();
    return { state, history, pushes, pop: (entry) => onPop({ state: entry }), restores: () => restores };
  }

  it('records a new entry only when the selection actually changed', () => {
    const { state, history, pushes } = setup();
    history.push();
    assert.equal(pushes.length, 0);
    state.replace({ tags: [[2, 'b']] });
    history.push();
    history.push();
    assert.equal(pushes.length, 1);
  });

  it('restores a popped entry without recording it again, and ignores foreign entries', () => {
    const { state, history, pushes, pop, restores } = setup();
    pop({ filterSnapshot: { tags: [[7, 'z']], performers: [], studios: [] } });
    assert.deepEqual([...state.tags], [[7, 'z']]);
    assert.equal(restores(), 1);
    history.push();
    assert.equal(pushes.length, 0);
    pop(null);
    assert.equal(restores(), 1);
  });
});

describe('SavedSearches', () => {
  it('replaces a search with the same name (ignoring case and spaces), keeps selections only, and deletes by id', () => {
    let stored = [];
    const settings = { data: { settings: { get savedSearches() { return stored; } } }, save: (patch) => { stored = patch.settings.savedSearches; } };
    const searches = new SavedSearches(settings);
    const snapshot = { tags: [[1, 'a']], performers: [], studios: [], markerName: 'm', dateRange: 'month', savedFilter: { id: '1' } };

    searches.save('Mine', snapshot);
    searches.save(' mine ', { ...snapshot, tags: [[2, 'b']] });

    assert.equal(stored.length, 1);
    assert.deepEqual([stored[0].tags, stored[0].dateRange, 'savedFilter' in stored[0]], [[[2, 'b']], 'month', false]);
    searches.delete(stored[0].id);
    assert.equal(stored.length, 0);
  });
});
