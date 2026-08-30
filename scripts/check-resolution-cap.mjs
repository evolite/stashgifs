// ponytail: standalone self-check for the two pure helpers in StashAPI (resolutionEnum
// + capStreamUrl). No test runner in this repo; run manually: `node scripts/check-resolution-cap.mjs`.
// Keep in sync with src/StashAPI.ts if that logic changes.
import assert from 'node:assert/strict';

const resolutionEnum = (px) => {
  if (px <= 240) return 'LOW';
  if (px <= 480) return 'STANDARD';
  if (px <= 720) return 'STANDARD_HD';
  if (px <= 1080) return 'FULL_HD';
  return 'FOUR_K';
};

const capStreamUrl = (url, resolutionEnum) => {
  const [base, hash] = url.split('#');
  const [path, query = ''] = base.split('?');
  const params = query.split('&').filter((p) => p && !p.startsWith('resolution='));
  params.push(`resolution=${resolutionEnum}`);
  return `${path}?${params.join('&')}${hash ? `#${hash}` : ''}`;
};

assert.equal(resolutionEnum(1080), 'FULL_HD');
assert.equal(resolutionEnum(720), 'STANDARD_HD');
assert.equal(resolutionEnum(2160), 'FOUR_K');
assert.equal(resolutionEnum(4320), 'FOUR_K');
assert.equal(resolutionEnum(240), 'LOW');

// no existing query
assert.equal(capStreamUrl('http://s/scene/1/stream.m3u8', 'FULL_HD'), 'http://s/scene/1/stream.m3u8?resolution=FULL_HD');
// existing unrelated query preserved
assert.equal(capStreamUrl('http://s/scene/1/stream.mp4?apikey=x', 'STANDARD_HD'), 'http://s/scene/1/stream.mp4?apikey=x&resolution=STANDARD_HD');
// existing resolution replaced, not duplicated
assert.equal(capStreamUrl('http://s/scene/1/stream.mp4?resolution=ORIGINAL&apikey=x', 'FULL_HD'), 'http://s/scene/1/stream.mp4?apikey=x&resolution=FULL_HD');

console.log('resolution-cap self-check OK');
