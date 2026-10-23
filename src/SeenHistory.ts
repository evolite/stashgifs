/**
 * Recently shown items, persisted so a reload doesn't replay the same cards.
 *
 * Marker, scene and image ids are separate sequences, so keys carry the content type
 * ("marker:12"). Most-recent-last, capped at `getMax()`; 0 disables the history.
 */

export type SeenType = 'marker' | 'image';

const STORAGE_KEY = 'stashgifs-seen-ids';
const FLUSH_DELAY_MS = 500;

export class SeenHistory {
  private cache?: { ids: string[]; set: Set<string> };
  private flushTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly getMax: () => number) {}

  private static key(type: SeenType, id: string): string {
    return `${type}:${id}`;
  }

  private load(): { ids: string[]; set: Set<string> } {
    if (this.cache) return this.cache;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      // Keys are "<type>:<id>"; bare legacy ids could match an unrelated item of another type.
      const ids: string[] = raw ? (JSON.parse(raw) as string[]).filter((k) => k.includes(':')) : [];
      this.cache = { ids, set: new Set(ids) };
    } catch {
      this.cache = { ids: [], set: new Set() };
    }
    return this.cache;
  }

  mark(type: SeenType, id: string): void {
    const max = this.getMax();
    if (max === 0) return;
    const cache = this.load();
    const key = SeenHistory.key(type, id);
    if (cache.set.has(key)) {
      // Move to end (most recent)
      const idx = cache.ids.indexOf(key);
      if (idx !== -1) cache.ids.splice(idx, 1);
    } else {
      cache.set.add(key);
    }
    cache.ids.push(key);
    if (cache.ids.length > max) {
      for (const removed of cache.ids.splice(0, cache.ids.length - max)) cache.set.delete(removed);
    }
    // Debounce the write — flush once after the render batch settles
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flush();
    }, FLUSH_DELAY_MS);
  }

  /**
   * Drop already-seen items. A saved filter is a curated pool the user explicitly picked: never thinned.
   * While scrolling (append) seen content is strictly removed; on a fresh load an exhausted pool falls back to everything.
   */
  filter<T extends { type: SeenType; data: { id: string } }>(content: T[], append: boolean, savedFilterActive: boolean): T[] {
    if (this.getMax() === 0 || savedFilterActive) return content;
    const { set } = this.load();
    if (set.size === 0) return content;
    const unseen = content.filter((item) => !set.has(SeenHistory.key(item.type, item.data.id)));
    return !append && unseen.length === 0 ? content : unseen;
  }

  flush(): void {
    if (!this.cache) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.cache.ids));
    } catch {
      // ignore localStorage errors
    }
  }

  /** Persist pending changes and drop the in-memory copy. */
  dispose(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
      this.flush();
    }
    this.cache = undefined;
  }
}
