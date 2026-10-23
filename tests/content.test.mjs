import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers.mjs';

const { computeHasMore } = await loadTs('src/content/hasMore.ts');
const { mixContent, shuffle } = await loadTs('src/content/mix.ts');

describe('computeHasMore', () => {
  const page = (overrides) => computeHasMore({
    append: true, offset: 0, expectedLimit: 8, totalContentLength: 8,
    counts: { markerCount: 0, shortFormCount: 0, imageCount: 0 },
    imagesOnly: false, imagesLoaded: 0, shouldLoadRandom: false, ...overrides,
  });

  it('uses the server totals when known', () => {
    const counts = { markerCount: 10, shortFormCount: 5, imageCount: 5 };
    assert.equal(page({ offset: 0, totalContentLength: 8, counts }), true);
    assert.equal(page({ offset: 12, totalContentLength: 8, counts }), false, 'loaded 20 of 20');
  });

  it('falls back to "a full page means more" when no totals are available', () => {
    assert.equal(page({ totalContentLength: 8 }), true);
    assert.equal(page({ totalContentLength: 5 }), false);
  });

  it('always stops on an empty page while appending, but retries an empty fresh load without totals', () => {
    assert.equal(page({ append: true, totalContentLength: 0, counts: { markerCount: 50, shortFormCount: 0, imageCount: 0 } }), false);
    assert.equal(page({ append: false, totalContentLength: 0 }), true);
  });

  it('keeps random feeds going while pages come back non-empty', () => {
    const counts = { markerCount: 8, shortFormCount: 0, imageCount: 0 };
    assert.equal(page({ offset: 0, totalContentLength: 8, counts, shouldLoadRandom: false }), false);
    assert.equal(page({ offset: 0, totalContentLength: 8, counts, shouldLoadRandom: true }), true);
  });

  it('pages images alone in images-only mode', () => {
    const base = { imagesOnly: true, counts: { markerCount: 99, shortFormCount: 0, imageCount: 20 } };
    assert.equal(page({ ...base, offset: 8, imagesLoaded: 8 }), true);
    assert.equal(page({ ...base, offset: 12, imagesLoaded: 8 }), false);
    assert.equal(page({ ...base, imagesLoaded: 0 }), false, 'empty append ends it');
    assert.equal(page({ imagesOnly: true, imagesLoaded: 8 }), true, 'no totals: full page means more');
  });
});

describe('mixContent', () => {
  const marker = (id) => ({ id: `m${id}`, scene: { id: `s${id}`, date: '2025-01-01' } });
  const image = (id) => ({ id: `i${id}`, date: '2025-02-02' });
  const ids = (items) => items.map((item) => item.data.id);
  const seeded = (seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  it('returns a single content type untouched and in order', () => {
    assert.deepEqual(ids(mixContent([marker(1), marker(2)], [], [], [])), ['m1', 'm2']);
    assert.deepEqual(ids(mixContent([], [], [image(1), image(2)], [])), ['i1', 'i2']);
  });

  it('keeps every item exactly once and each type in its original order', () => {
    const markers = [1, 2, 3, 4, 5, 6, 7].map(marker);
    const shortForm = [8, 9].map(marker);
    const images = [1, 2, 3, 4].map(image);
    const previews = [10, 11].map(marker);
    const mixed = ids(mixContent(markers, shortForm, images, previews, seeded(42)));

    assert.equal(mixed.length, 15);
    assert.equal(new Set(mixed).size, 15);
    assert.deepEqual(mixed.filter((id) => id.startsWith('i')), ['i1', 'i2', 'i3', 'i4']);
    const videos = mixed.filter((id) => id.startsWith('m') && !['m10', 'm11'].includes(id));
    assert.deepEqual(videos, ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9']);
    assert.deepEqual(mixed.filter((id) => ['m10', 'm11'].includes(id)), ['m10', 'm11']);
  });

  it('is deterministic for a given random source and tags items with their type and date', () => {
    const args = () => [[1, 2, 3, 4, 5].map(marker), [], [1, 2, 3].map(image), []];
    assert.deepEqual(ids(mixContent(...args(), seeded(7))), ids(mixContent(...args(), seeded(7))));
    const [first] = mixContent([marker(1)], [], [image(1)], [], seeded(1));
    assert.deepEqual([first.type, first.date], ['marker', '2025-01-01']);
  });

  it('never leads with more than three videos in a row before switching to images', () => {
    const mixed = mixContent([1, 2, 3, 4, 5, 6].map(marker), [], [1, 2, 3].map(image), [], () => 0.99);
    const types = mixed.map((item) => item.type[0]).join('');
    assert.ok(!types.slice(0, 4).includes('mmmm'), `unexpected run: ${types}`);
  });
});

describe('shuffle', () => {
  it('permutes in place without losing items', () => {
    const input = [1, 2, 3, 4, 5, 6];
    const out = shuffle(input, () => 0.3);
    assert.equal(out, input);
    assert.deepEqual([...out].sort(), [1, 2, 3, 4, 5, 6]);
  });
});
