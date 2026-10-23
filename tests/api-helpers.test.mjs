import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers.mjs';

const { TtlCache } = await loadTs('src/api/TtlCache.ts');
const { Batcher } = await loadTs('src/api/Batcher.ts');
const { runAliased } = await loadTs('src/api/aliased.ts');

describe('TtlCache', () => {
  it('shares one load between concurrent callers', async () => {
    const cache = new TtlCache(1000);
    let loads = 0;
    const load = () => { loads++; return Promise.resolve('v'); };
    const results = await Promise.all([cache.getOrLoad('k', load), cache.getOrLoad('k', load)]);
    assert.deepEqual(results, ['v', 'v']);
    assert.equal(loads, 1);
  });

  it('does not remember failed loads, so the next call retries', async () => {
    const cache = new TtlCache(1000);
    await assert.rejects(cache.getOrLoad('k', () => Promise.reject(new Error('down'))));
    assert.equal(await cache.getOrLoad('k', () => Promise.resolve('up')), 'up');
  });

  it('lets the caller refuse to remember a result (e.g. "tag not found")', async () => {
    const cache = new TtlCache(1000);
    await cache.getOrLoad('k', () => Promise.resolve(null), (v) => v !== null);
    assert.equal(cache.has('k'), false);
  });

  it('expires entries after the ttl and evicts the oldest past its size cap', () => {
    const expiring = new TtlCache(0);
    expiring.set('a', 1);
    assert.equal(expiring.has('a'), false);

    const capped = new TtlCache(1000, 2);
    capped.set('a', 1); capped.set('b', 2); capped.set('c', 3);
    assert.deepEqual([capped.has('a'), capped.has('b'), capped.has('c')], [false, true, true]);
  });

  it('keeps a newer value when an older in-flight load fails afterwards', async () => {
    const cache = new TtlCache(1000);
    const slow = new Promise((_, reject) => setTimeout(() => reject(new Error('late')), 5));
    cache.set('k', slow);
    cache.set('k', 'fresh');
    await slow.catch(() => {});
    assert.equal(await cache.peek('k'), 'fresh');
  });
});

describe('Batcher', () => {
  it('coalesces loads made inside the window into one call and fills in missing keys', async () => {
    const batches = [];
    const batcher = new Batcher(5, async (keys) => { batches.push(keys); return new Map([['a', 1]]); }, () => 0);
    const values = await Promise.all([batcher.load('a'), batcher.load('b'), batcher.load('a')]);
    assert.deepEqual(values, [1, 0, 1]);
    assert.deepEqual(batches, [['a', 'b']]);
  });

  it('rejects every waiter when the batch fails', async () => {
    const batcher = new Batcher(5, async () => { throw new Error('boom'); }, () => 0);
    const results = await Promise.allSettled([batcher.load('a'), batcher.load('b')]);
    assert.deepEqual(results.map((r) => r.status), ['rejected', 'rejected']);
  });
});

describe('runAliased', () => {
  it('builds one aliased query per chunk and returns rows in input order', async () => {
    const queries = [];
    const exec = async (query, variables) => {
      queries.push(query);
      return Object.fromEntries(Object.keys(variables).map((name) => [`a${name.slice(1)}`, { id: variables[name] }]));
    };
    const rows = await runAliased(exec, 'Op', 'ID!', ['x', 'y', 'z'], { a: 'thing(id: $v) { id }' }, 2);
    assert.equal(queries.length, 2);
    assert.match(queries[0], /query Op\(\$v0: ID!, \$v1: ID!\)/);
    assert.match(queries[0], /a0: thing\(id: \$v0\)/);
    assert.deepEqual(rows.map((r) => r.a), [{ id: 'x' }, { id: 'y' }, { id: 'z' }]);
  });
});
