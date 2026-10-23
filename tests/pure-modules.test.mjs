import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs, installBrowserStubs } from './helpers.mjs';

describe('saved-filter criteria', () => {
  it('converts Stash UI shapes to GraphQL input and drops what it cannot convert', async () => {
    const { normalizeSavedObjectFilter } = await loadTs('src/api/savedFilterCriteria.ts');
    const originalWarn = console.warn;
    console.warn = () => {};
    const out = normalizeSavedObjectFilter({
      rating100: { modifier: 'BETWEEN', value: { value: 20, value2: 80 } },
      o_counter: { modifier: 'GREATER_THAN', value: { value: 1, value2: null } },
      resolution: { modifier: 'EQUALS', value: '720p' },
      organized: 'true',
      tags: { modifier: 'INCLUDES_ALL', value: { depth: 0, excluded: [], items: [{ id: '16', label: 'x' }] } },
      weird: { modifier: 'X', value: { nope: 1 } },
    });
    console.warn = originalWarn;

    assert.deepEqual(out.rating100, { modifier: 'BETWEEN', value: 20, value2: 80 });
    assert.deepEqual(out.o_counter, { modifier: 'GREATER_THAN', value: 1 });
    assert.deepEqual(out.resolution, { modifier: 'EQUALS', value: 'STANDARD_HD' });
    assert.equal(out.organized, true);
    assert.deepEqual(out.tags, { value: ['16'], modifier: 'INCLUDES_ALL', depth: 0 });
    assert.equal('weird' in out, false);
  });
});

describe('MediaUrls', () => {
  async function media(maxResolution = 0) {
    const { MediaUrls } = await loadTs('src/api/MediaUrls.ts');
    return { MediaUrls, urls: new MediaUrls('http://stash.test', () => maxResolution) };
  }

  it('maps a pixel cap to the nearest Stash transcode size', async () => {
    const { MediaUrls } = await media();
    assert.deepEqual([240, 720, 1080, 2160].map((px) => MediaUrls.resolutionEnum(px)), ['LOW', 'STANDARD_HD', 'FULL_HD', 'FOUR_K']);
  });

  it('sets or replaces the resolution param and keeps other params and fragments', async () => {
    const { MediaUrls } = await media();
    assert.equal(MediaUrls.capStreamUrl('http://s/stream.m3u8', 'FULL_HD'), 'http://s/stream.m3u8?resolution=FULL_HD');
    assert.equal(MediaUrls.capStreamUrl('http://s/stream.mp4?apikey=x&resolution=ORIGINAL#t=5', 'FULL_HD'), 'http://s/stream.mp4?apikey=x&resolution=FULL_HD#t=5');
  });

  it('keeps stream URLs stable between calls (a changing URL would restart Stash transcodes)', async () => {
    const { urls } = await media(720);
    const scene = {
      files: [{ height: 2160, video_codec: 'h264' }],
      paths: { stream: '/scene/1/stream' },
      sceneStreams: [{ url: '/scene/1/stream.mp4?resolution=ORIGINAL', label: 'MP4' }],
    };
    const first = urls.getVideoUrl(scene);
    const again = urls.getVideoUrl(scene);
    assert.equal(first, again);
    assert.ok(!/[?&]t=/.test(first), `unexpected cache-busting param in ${first}`);
    assert.equal(urls.getMarkerVideoUrl({ stream: '/scene/1/scene_marker/2/stream', scene }), 'http://stash.test/scene/1/scene_marker/2/stream');
  });

  it('skips the direct stream for scenes above the resolution cap', async () => {
    const scene = {
      files: [{ height: 2160, video_codec: 'h264' }],
      sceneStreams: [{ url: '/direct', label: 'Direct stream' }, { url: '/hls.m3u8', label: 'HLS', mime_type: 'application/vnd.apple.mpegurl' }],
    };
    const uncapped = (await media(0)).urls.getSceneSources(scene).map((s) => s.src);
    const capped = (await media(720)).urls.getSceneSources(scene).map((s) => s.src);
    assert.ok(uncapped[0].includes('/direct'), 'direct first when playable and uncapped');
    assert.ok(capped.every((src) => !src.includes('/direct')) && capped[0].includes('resolution=STANDARD_HD'));
  });
});

describe('SeenHistory', () => {
  let store;
  let max;
  beforeEach(() => { store = installBrowserStubs(); max = 3; });
  const item = (type, id) => ({ type, data: { id } });

  async function history() {
    const { SeenHistory } = await loadTs('src/SeenHistory.ts');
    return new SeenHistory(() => max);
  }

  it('keeps the most recent entries, separates content types, and persists', async () => {
    const seen = await history();
    seen.mark('marker', '1'); seen.mark('image', '1'); seen.mark('marker', '2'); seen.mark('marker', '3');
    assert.deepEqual(
      seen.filter([item('marker', '1'), item('image', '1'), item('marker', '3')], true, false).map((i) => `${i.type}:${i.data.id}`),
      ['marker:1'],
      'marker 1 fell out of the cap; image 1 is a different key and is still seen',
    );
    seen.dispose();
    assert.deepEqual(JSON.parse(store.get('stashgifs-seen-ids')), ['image:1', 'marker:2', 'marker:3']);
  });

  it('removes seen items while scrolling, falls back on a fresh load, and never thins saved filters', async () => {
    const seen = await history();
    seen.mark('marker', '2');
    const all = [item('marker', '2')];
    assert.deepEqual(seen.filter(all, true, false), []);
    assert.deepEqual(seen.filter(all, false, false), all);
    assert.deepEqual(seen.filter(all, true, true), all);
    max = 0;
    assert.deepEqual(seen.filter(all, true, false), all, 'size 0 disables the history');
  });
});
