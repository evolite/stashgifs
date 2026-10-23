// Shared test helpers: load TypeScript sources through esbuild, browser-global stubs, and a
// stubbed GraphQL client so StashAPI can be exercised without a server.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const loaded = new Map();

/** Bundle a TypeScript entry (relative to the repo root) and import it. Cached per entry. */
export function loadTs(entry) {
  if (!loaded.has(entry)) {
    loaded.set(entry, (async () => {
      const result = await build({
        entryPoints: [fileURLToPath(new URL(`../${entry}`, import.meta.url))],
        bundle: true,
        format: 'esm',
        platform: 'node',
        write: false,
        logLevel: 'silent',
      });
      return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
    })());
  }
  return loaded.get(entry);
}

/** Minimal in-memory localStorage plus the window/location globals the sources touch at load time. */
export function installBrowserStubs() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.window = globalThis;
  globalThis.location = { origin: 'http://stash.test', pathname: '/plugin/stashgifs/assets/app/' };
  globalThis.addEventListener ??= () => {};
  globalThis.removeEventListener ??= () => {};
  return store;
}

const operationName = (query) => query.replace(/\s+/g, ' ').match(/(?:query|mutation) (\w+)/)?.[1] ?? 'anonymous';

/**
 * Replace a StashAPI's GraphQL client. `respond(op, variables, query)` returns the `data` payload
 * (or throws to simulate a failure). Every request is recorded in `api.calls`.
 */
export function stubGraphQL(api, respond) {
  api.calls = [];
  api.gqlClient = {
    destroy() {},
    async query({ query, variables }) {
      const op = operationName(query);
      api.calls.push({ op, variables, query });
      return { data: await respond(op, variables, query) };
    },
    async mutate({ mutation, variables }) {
      const op = operationName(mutation);
      api.calls.push({ op, variables, query: mutation });
      return { data: await respond(op, variables, mutation) };
    },
  };
  return api;
}

export async function newStashApi(respond) {
  installBrowserStubs();
  const { StashAPI } = await loadTs('src/StashAPI.ts');
  return stubGraphQL(new StashAPI('http://stash.test'), respond);
}

/** Let queued microtasks and 0ms timers run (e.g. the scene-tag batch window). */
export const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
