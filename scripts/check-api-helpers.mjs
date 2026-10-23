#!/usr/bin/env node
// Offline check: TtlCache (sharing, expiry, eviction on failure/keep) and runAliased (query shape, chunking).
// Run: node scripts/check-api-helpers.mjs
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';

const { TtlCache } = await loadTs('src/api/TtlCache.ts');
const { runAliased } = await loadTs('src/api/aliased.ts');

// --- TtlCache
{
  const cache = new TtlCache(1000);
  let loads = 0;
  const load = () => { loads++; return Promise.resolve('v'); };
  const [a, b] = await Promise.all([cache.getOrLoad('k', load), cache.getOrLoad('k', load)]);
  assert.equal(a, 'v'); assert.equal(b, 'v'); assert.equal(loads, 1, 'concurrent callers share one load');

  await assert.rejects(cache.getOrLoad('bad', () => Promise.reject(new Error('x'))));
  await Promise.resolve();
  assert.equal(cache.has('bad'), false, 'failed loads are evicted');

  await cache.getOrLoad('miss', () => Promise.resolve(null), (v) => v !== null);
  await Promise.resolve();
  assert.equal(cache.has('miss'), false, 'keep() can refuse to remember a result');

  const small = new TtlCache(1000, 2);
  small.set('a', 1); small.set('b', 2); small.set('c', 3);
  assert.equal(small.has('a'), false, 'oldest entry evicted past max');
  assert.equal(small.has('c'), true);

  const expiring = new TtlCache(0);
  expiring.set('a', 1);
  assert.equal(expiring.has('a'), false, 'ttl 0 expires immediately');

  const newer = new TtlCache(1000);
  const slow = new Promise((_, rej) => setTimeout(() => rej(new Error('late')), 5));
  newer.set('k', slow);
  newer.set('k', 'fresh');
  await slow.catch(() => {});
  assert.equal(await newer.peek('k'), 'fresh', 'a failing old load does not evict a newer value');
}

// --- runAliased
{
  const calls = [];
  const exec = async (query, variables) => {
    calls.push({ query, variables });
    const data = {};
    Object.keys(variables).forEach((name) => { const i = name.slice(1); data[`a${i}`] = { id: variables[name] }; });
    return data;
  };
  const out = await runAliased(exec, 'Op', 'ID!', ['x', 'y', 'z'], { a: 'thing(id: $v) { id }' }, 2);
  assert.equal(calls.length, 2, 'splits into chunks');
  assert.match(calls[0].query, /query Op\(\$v0: ID!, \$v1: ID!\) \{ a0: thing\(id: \$v0\) \{ id \}\na1: thing\(id: \$v1\) \{ id \} \}/);
  assert.deepEqual(out.map((o) => o.a), [{ id: 'x' }, { id: 'y' }, { id: 'z' }]);
}

console.log('api helpers OK');
