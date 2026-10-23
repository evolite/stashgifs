import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers.mjs';

const { FilterState } = await loadTs('src/FilterState.ts');
const { FilterHistory } = await loadTs('src/FilterHistory.ts');
const { SavedSearches } = await loadTs('src/SavedSearches.ts');

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
