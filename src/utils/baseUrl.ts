/**
 * Resolve the base URL of the Stash server this plugin is talking to, including any
 * custom path prefix (e.g. Stash served at `https://host/stash/`).
 *
 * `location.origin` alone is wrong for path-prefixed installs — it never includes the
 * `/stash` segment. The standalone app opens in its own tab (no `window.PluginApi`), so
 * we recover the prefix from our own path, which is always `<prefix>/plugin/stashgifs/…`.
 *
 * Returns an absolute URL with no trailing slash, e.g. `https://host/stash` or
 * `https://host`.
 */
export function stripSlashes(s: string, { leading = false, trailing = false } = {}): string {
  let start = 0;
  let end = s.length;
  if (leading) while (start < end && s[start] === '/') start++;
  if (trailing) while (end > start && s[end - 1] === '/') end--;
  return s.slice(start, end);
}

export function getStashBaseUrl(): string {
  // Embedded-in-Stash context (if ever present): trust the host-provided base.
  const w = globalThis as typeof globalThis & {
    PluginApi?: { baseURL?: string };
    stash?: { baseURL?: string };
  };
  const api = w.PluginApi?.baseURL ?? w.stash?.baseURL;
  if (api) {
    return /^https?:\/\//i.test(api)
      ? stripSlashes(api, { trailing: true })
      : globalThis.location.origin + '/' + stripSlashes(api, { leading: true, trailing: true });
  }

  // Standalone app: recover the prefix from our own path (…/plugin/stashgifs/…).
  const { origin, pathname } = globalThis.location;
  const i = pathname.indexOf('/plugin/');
  return origin + (i > 0 ? pathname.slice(0, i) : '');
}
