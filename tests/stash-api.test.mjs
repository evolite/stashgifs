import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { newStashApi, settle } from './helpers.mjs';

const ops = (api, name) => api.calls.filter((call) => call.op === name);

describe('scene tags (favorites and bookmarks)', () => {
  const sceneTags = (variables) => ({
    findScenes: { scenes: variables.ids.map((id) => ({ id, tags: id === '1' ? [{ id: '9' }] : [] })) },
  });

  it('answers many per-post checks with a single batched query', async () => {
    const api = await newStashApi((op, variables) => sceneTags(variables));
    const results = await Promise.all([api.sceneHasTag('1', '9'), api.sceneHasTag('2', '9'), api.sceneHasTag('3', '9')]);
    assert.deepEqual(results, [true, false, false]);
    assert.equal(api.calls.length, 1);
    assert.deepEqual(api.calls[0].variables.ids, ['1', '2', '3']);
  });

  it('adds a tag with one server-side mutation and remembers the result without re-querying', async () => {
    const api = await newStashApi((op, variables) => {
      if (op === 'BulkSceneUpdate') return { bulkSceneUpdate: [{ id: '2', tags: [{ id: '9' }] }] };
      return sceneTags(variables);
    });
    await api.addTagToScene('2', '9');
    assert.deepEqual(api.calls.map((c) => c.op), ['BulkSceneUpdate']);
    assert.deepEqual(api.calls[0].variables.input, { ids: ['2'], tag_ids: { ids: ['9'], mode: 'ADD' } });

    assert.equal(await api.sceneHasTag('2', '9'), true);
    assert.equal(api.calls.length, 1, 'answered from the mutation response');
  });

  it('removes a tag with mode REMOVE', async () => {
    const api = await newStashApi(() => ({ bulkSceneUpdate: [{ id: '1', tags: [] }] }));
    await api.removeTagFromScene('1', '9');
    assert.equal(api.calls[0].variables.input.tag_ids.mode, 'REMOVE');
    assert.equal(await api.sceneHasTag('1', '9'), false);
  });
});

describe('failures are not mistaken for "empty"', () => {
  const down = () => { throw new Error('server down'); };

  it('getSavedFilter rejects on error, resolves null when missing, and caches a hit', async () => {
    const failing = await newStashApi(down);
    await assert.rejects(failing.getSavedFilter('3'));

    const missing = await newStashApi(() => ({ findSavedFilter: null }));
    assert.equal(await missing.getSavedFilter('3'), null);

    const present = await newStashApi(() => ({ findSavedFilter: { id: '3', name: 'x', mode: 'SCENE_MARKERS' } }));
    await present.getSavedFilter('3');
    await present.getSavedFilter('3');
    assert.equal(present.calls.length, 1);
  });

  it('getPluginSettings rejects on error but resolves null when the plugin has no settings', async () => {
    await assert.rejects((await newStashApi(down)).getPluginSettings('stashgifs'));
    const empty = await newStashApi(() => ({ configuration: { ui: {}, plugins: {} } }));
    assert.equal(await empty.getPluginSettings('stashgifs'), null);
  });

  it('shares one configuration request between the rating config and plugin settings', async () => {
    const api = await newStashApi(() => ({ configuration: { ui: { ratingSystemOptions: { type: 'stars' } }, plugins: { stashgifs: { a: 1 } } } }));
    const [rating, settings] = await Promise.all([api.getUIConfiguration(), api.getPluginSettings('stashgifs')]);
    assert.deepEqual([rating, settings], [{ type: 'stars' }, { a: 1 }]);
    assert.equal(api.calls.length, 1);
  });
});

describe('ensureTag', () => {
  it('finds an existing tag without creating one, and shares the lookup between callers', async () => {
    const api = await newStashApi(() => ({ findTags: { tags: [{ id: '7', name: 'Fav' }] } }));
    const [a, b] = await Promise.all([api.ensureTag('Fav'), api.ensureTag('fav')]);
    assert.deepEqual([a.id, b.id], ['7', '7']);
    assert.deepEqual(api.calls.map((c) => c.op), ['FindTags']);
  });

  it('creates the tag when it is missing', async () => {
    const api = await newStashApi((op) => (op === 'FindTags' ? { findTags: { tags: [] } } : { tagCreate: { id: '11', name: 'Fav' } }));
    assert.equal((await api.ensureTag('Fav')).id, '11');
  });

  it('retries after a failure instead of remembering it', async () => {
    let healthy = false;
    const api = await newStashApi((op) => {
      if (!healthy) throw new Error('down');
      return { findTags: { tags: [{ id: '7', name: 'Fav' }] } };
    });
    await assert.rejects(api.ensureTag('Fav'));
    healthy = true;
    assert.equal((await api.ensureTag('Fav')).id, '7');
  });
});

describe('discovery lookups', () => {
  it('resolves many stash-box scenes in two requests (stash id, then url for misses) and caches the answers', async () => {
    const api = await newStashApi((op, variables) => ({
      s0: { scenes: variables.v0?.stash_id_endpoint ? [{ id: '100' }] : [] },
      s1: { scenes: [] },
      s2: { scenes: [] },
    }));
    const items = [
      { stashId: 'a', sceneUrl: 'https://box/scenes/a' },
      { stashId: 'b', sceneUrl: 'https://box/scenes/b' },
      { stashId: 'c' },
    ];
    const found = await api.findLocalSceneIdsByStashDbIds(items);
    assert.deepEqual([...found], [['a', '100']]);
    assert.equal(api.calls.length, 2, 'one stash_id request + one url request for the misses that have a url');

    await api.findLocalSceneIdsByStashDbIds(items);
    assert.equal(api.calls.length, 2, 'repeat is served from cache, including the misses');
  });
});

describe('short-form paging', () => {
  const scenes = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i), files: [{ duration: 30 }], paths: { preview: 'p', stream: 's' }, sceneStreams: [], tags: [], performers: [] }));

  it('gets the total from the page itself (one request)', async () => {
    const api = await newStashApi(() => ({ findScenes: { count: 40, scenes: scenes(24) } }));
    const result = await api.fetchShortFormVideos({ limit: 8 }, 120, 8, 0);
    assert.equal(api.calls.length, 1);
    assert.equal(result.totalCount, 40);
    assert.equal(result.markers.length, 8);
  });

  it('clamps an offset past the end to the last page', async () => {
    const api = await newStashApi((op, variables) => ({ findScenes: { count: 30, scenes: scenes(variables.filter.page === 2 ? 6 : 0) } }));
    const result = await api.fetchShortFormVideos({ limit: 8 }, 120, 8, 24 * 9);
    assert.deepEqual(api.calls.map((c) => c.variables.filter.page), [10, 2]);
    assert.equal(result.totalCount, 30);
  });
});

describe('tag source routing', () => {
  it('resolves several tags in one request', async () => {
    const api = await newStashApi(() => ({}));
    await api.getTagSources(['1', '2', '3']);
    assert.equal(api.calls.length, 1);
    assert.equal(api.calls[0].op, 'TagSources');
    await api.getTagSources(['1', '2']);
    assert.equal(api.calls.length, 1, 'already known');
  });
});

describe('batch window', () => {
  it('lets late checks start a second batch', async () => {
    const api = await newStashApi((op, variables) => ({ findScenes: { scenes: variables.ids.map((id) => ({ id, tags: [] })) } }));
    await api.sceneHasTag('1', '9');
    await settle();
    await api.sceneHasTag('2', '9');
    assert.equal(api.calls.length, 2);
  });
});

describe('galleries', () => {
  it('loads galleries in pages instead of one unbounded request', async () => {
    const page = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i), title: `g${i}` }));
    const api = await newStashApi((op, variables) => ({
      findGalleries: { count: 250, galleries: page(variables.filter.page === 1 ? 200 : 50) },
    }));
    const galleries = await api.findGalleries();
    assert.equal(galleries.length, 250);
    assert.deepEqual(api.calls.map((c) => [c.variables.filter.page, c.variables.filter.per_page]), [[1, 200], [2, 200]]);
  });
});
