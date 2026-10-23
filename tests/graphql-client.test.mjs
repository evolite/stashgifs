import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs, installBrowserStubs } from './helpers.mjs';

installBrowserStubs();
const { GraphQLClient } = await loadTs('src/graphql/client.ts');

const realFetch = globalThis.fetch;
let requests;
let respond;

const json = (body, init = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

beforeEach(() => {
  requests = [];
  respond = () => json({ data: { ok: true } });
  globalThis.fetch = async (url, init) => {
    requests.push(JSON.parse(init.body));
    if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return respond(init);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

const client = (config = {}) => new GraphQLClient({ baseUrl: 'http://stash.test', ...config });

describe('GraphQLClient', () => {
  it('sends identical in-flight queries once', async () => {
    const c = client();
    const [a, b] = await Promise.all([c.query({ query: '{ a }' }), c.query({ query: '{ a }' })]);
    assert.deepEqual([a.data, b.data], [{ ok: true }, { ok: true }]);
    assert.equal(requests.length, 1);
  });

  it('does not share a request between callers with different abort signals', async () => {
    const c = client();
    await Promise.all([
      c.query({ query: '{ a }', signal: new AbortController().signal }),
      c.query({ query: '{ a }', signal: new AbortController().signal }),
    ]);
    assert.equal(requests.length, 2);
  });

  it('never dedupes mutations', async () => {
    const c = client();
    await Promise.all([c.mutate({ mutation: 'mutation { a }' }), c.mutate({ mutation: 'mutation { a }' })]);
    assert.equal(requests.length, 2);
  });

  it('maps failures onto typed errors', async () => {
    const c = client();
    respond = () => json({ errors: [{ message: 'bad field' }] }, { status: 400 });
    await assert.rejects(c.query({ query: '{ x }' }), { name: 'GraphQLNetworkError', message: /bad field/ });

    respond = () => json({ errors: [{ message: 'nope' }] });
    await assert.rejects(c.query({ query: '{ y }' }), { name: 'GraphQLResponseError' });

    globalThis.fetch = async () => { throw new TypeError('offline'); };
    await assert.rejects(c.query({ query: '{ z }' }), { name: 'GraphQLNetworkError' });
  });

  it('rejects with an abort error when the caller aborts, before or during the request', async () => {
    const c = client();
    const early = new AbortController();
    early.abort();
    await assert.rejects(c.query({ query: '{ a }', signal: early.signal }), { name: 'GraphQLAbortError' });

    const late = new AbortController();
    respond = () => new Promise(() => {});
    globalThis.fetch = async (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    const pending = c.query({ query: '{ b }', signal: late.signal });
    late.abort();
    await assert.rejects(pending, { name: 'GraphQLAbortError' });
  });

  it('gives up after the timeout', async () => {
    globalThis.fetch = async (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    await assert.rejects(client({ timeout: 10 }).query({ query: '{ slow }' }), { name: 'GraphQLAbortError' });
  });

  it('sends the API key header when configured', async () => {
    let headers;
    globalThis.fetch = async (_url, init) => { headers = init.headers; return json({ data: {} }); };
    await client({ apiKey: 'secret' }).query({ query: '{ a }' });
    assert.equal(headers.ApiKey, 'secret');
  });
});
