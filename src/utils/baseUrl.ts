export function stripSlashes(s: string, { leading = false, trailing = false } = {}): string {
  let start = 0;
  let end = s.length;
  if (leading) while (start < end && s[start] === '/') start++;
  if (trailing) while (end > start && s[end - 1] === '/') end--;
  return s.slice(start, end);
}

export function getStashBaseUrl(): string {
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

  const { origin, pathname } = globalThis.location;
  const i = pathname.indexOf('/plugin/');
  return origin + (i > 0 ? pathname.slice(0, i) : '');
}
