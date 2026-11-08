import { it } from 'node:test';
import assert from 'node:assert/strict';
import { installBrowserStubs, loadTs } from './helpers.mjs';

installBrowserStubs();
const { FeedContainer } = await loadTs('src/FeedContainer.ts');
const { VideoPost } = await loadTs('src/VideoPost.ts');
const { VideoJsPlayer } = await loadTs('src/VideoJsPlayer.ts');

const sceneUrl = 'http://stash.test/scene/1/stream.m3u8';
const markerUrl = 'http://stash.test/scene/1/scene_marker/2/stream';
const sceneSources = [{ src: sceneUrl, type: 'application/x-mpegURL' }];

it('preserves the cursor when the first short-form batch is empty', async () => {
  const offsets = [];
  const rendered = [];
  const marker = { id: 'shortform-121', scene: { id: '121' } };
  const feed = Object.assign(Object.create(FeedContainer.prototype), {
    currentFilters: {},
    latestLoadId: 0,
    postOrder: [],
    excludedTagIds: [],
    filterState: { tags: new Map() },
    settings: { includeMarkersInFeed: false, includeImagesInFeed: false },
    api: {
      async fetchShortFormVideos(filters, _duration, _limit, offset) {
        offsets.push(offset);
        return { markers: offset === 0 ? [] : [marker], totalCount: 121,
          nextOffset: offset === 0 ? 120 : null, sortSeed: filters.sortSeed };
      },
    },
    seenHistory: { filter: items => items },
    updateExcludedTagIds() {},
    hideError() {},
    clearPosts() {},
    showSkeletonLoaders() {},
    hideSkeletonLoaders() {},
    updateEndCard() {},
    handleLoadError(error) { throw error; },
    renderPostsProgressively(content) { rendered.push(...content); },
    finalizeLoadState(_append, _page, firstCards) { assert.equal(firstCards, true); },
  });

  await feed.loadVideos();
  assert.deepEqual(offsets, [0]);
  assert.equal(feed.shortFormScanPaused, true);
  assert.equal(feed.hasMore, false, 'the feed waits for the user to continue');

  await feed.loadVideos(undefined, true);
  assert.deepEqual(offsets, [0, 120]);
  assert.deepEqual(rendered.map(item => item.data.id), [marker.id]);
  assert.equal(feed.shortFormScanPaused, false);
});

it('passes the long-scene threshold to Random even when Short-Form is disabled', async () => {
  const requests = [];
  const feed = Object.assign(Object.create(FeedContainer.prototype), {
    settings: { includeShortForm: false, shortFormMaxDuration: 42, randomLongScenesOnly: true },
    api: {
      fetchSceneMarkers: async filters => {
        requests.push(filters);
        return { markers: [], totalCount: 0 };
      },
    },
    filterMarkersByName: markers => markers,
  });
  await feed.fetchRandomScenesForLoad({}, 8);
  feed.settings.randomLongScenesOnly = false;
  await feed.fetchRandomScenesForLoad({}, 8);
  assert.equal(requests[0].randomMinSceneDuration, 42);
  assert.equal(requests[0].shuffleMode, true);
  assert.equal(requests[1].randomMinSceneDuration, undefined);
});

it('selects the full scene only for real markers in the new mode, even with HD off', async () => {
  const feed = Object.assign(Object.create(FeedContainer.prototype), {
    settings: { playMarkersToEnd: true },
    api: { getSceneSources: () => sceneSources },
    getVideoUrlForPost: () => markerUrl,
    isVideoCodecSupported: () => true,
    useHDMode: false,
    posts: new Map(),
    postOrder: [],
    createPostContainer: () => ({}),
  });
  const calls = [];
  feed.createVideoPostInstance = (_container, marker, url, playToEnd) => calls.push([marker.id, url, playToEnd]);
  const marker = { id: '2', seconds: 30, end_seconds: 35, scene: { id: '1' } };
  await feed.createPost(marker);
  await feed.createPost({ ...marker, id: 'shortform-1' });
  await feed.createPost({ ...marker, id: 'synthetic-1' });
  await feed.createPost({ ...marker, id: 'scenepreview-1' });
  assert.deepEqual(calls, [
    ['2', sceneUrl, true],
    ['shortform-1', markerUrl, false],
    ['synthetic-1', markerUrl, false],
    ['scenepreview-1', markerUrl, false],
  ]);
});

function preloadMarker({ hd, playMarkerToEnd, end }) {
  const post = Object.assign(Object.create(VideoPost.prototype), {
    data: {
      videoUrl: hd || playMarkerToEnd ? sceneUrl : markerUrl,
      marker: { id: '2', seconds: 30, end_seconds: end, stream: markerUrl, scene: { id: '1' } },
      endTime: end ?? 50,
      playMarkerToEnd,
    },
    playerContainer: {},
    isHQMode: hd || playMarkerToEnd,
    api: { getSceneSources: () => sceneSources },
    attachLoadErrorHandler() {},
    attachReelAutoAdvance() {},
    setupProgressBar() {},
    startWatchTracking() {},
    createVideoPlayer: (_container, url, options) => ({ url, ...options }),
  });
  return post.preload();
}

it('plays past a stored marker end or fallback clip bound until the scene ends', () => {
  for (const hd of [false, true]) {
    for (const end of [35, undefined]) {
      const options = preloadMarker({ hd, playMarkerToEnd: true, end });
      assert.equal(options.url, sceneUrl);
      assert.equal(options.sources, sceneSources);
      assert.equal(options.startTime, 30);
      assert.equal(options.endTime, undefined);

      let time = 0;
      const events = new Map();
      const player = {
        on: (name, callback) => events.set(name, callback),
        one() {},
        duration: () => 120,
        currentTime: (next) => next === undefined ? time : (time = next),
        paused: () => false,
      };
      const playback = Object.assign(Object.create(VideoJsPlayer.prototype), {
        startAt: options.startTime,
        endAt: options.endTime ?? 0,
        state: {},
      });
      playback.attachEventListeners(player);
      events.get('loadedmetadata')();
      assert.equal(time, 30);
      time = 60;
      events.get('timeupdate')();
      assert.equal(time, 60);
      time = 120;
      events.get('ended')();
      assert.equal(time, 30);
    }
  }
});

it('retains the preview and the HD clip bound with the new mode off', () => {
  const preview = preloadMarker({ hd: false, playMarkerToEnd: false, end: 35 });
  assert.equal(preview.url, markerUrl);
  assert.equal(preview.startTime, undefined);
  const hd = preloadMarker({ hd: true, playMarkerToEnd: false, end: 35 });
  assert.equal(hd.url, sceneUrl);
  assert.equal(hd.endTime, 35);
});
