import type { StashAPI } from './StashAPI.js';
import type { DiscoveryPanel } from './DiscoveryPanel.js';
import type { Performer } from './types.js';
import type { StashBox, StashBoxScene } from './graphql/types.js';

type ScenePayloadItem = { scene: StashBoxScene; baseUrl: string; performerName: string; localStashId?: string };

const SCENES_PER_PERFORMER = 3;
const PREFETCH_BATCH_SIZE = 5;
const DEBOUNCE_MS = 500;
const STASHBOX_MIN_INTERVAL_MS = 300;

function sceneCounts(n: number): number[] {
  return Array(Math.min(n, 3)).fill(1);
}
const LRU_MAX = 100;
const PREFETCH_INTERVAL_MS = 600;

class RateLimiter {
  private readonly minIntervalMs: number;
  private lastTime = 0;

  constructor(minIntervalMs: number) {
    this.minIntervalMs = minIntervalMs;
  }

  async wait(signal?: AbortSignal): Promise<void> {
    const delay = this.minIntervalMs - (Date.now() - this.lastTime);
    if (delay <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delay);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
  }

  stamp(): void {
    this.lastTime = Date.now();
  }
}

interface LRUEntry {
  scenes: StashBoxScene[];
  endpoint: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class DiscoveryManager {
  private readonly api: StashAPI;
  private readonly panel: DiscoveryPanel;
  private sceneOrder: 'latest' | 'random' | 'trending' = 'latest';
  private stashBoxes: StashBox[] = [];
  private stashBoxesLoaded = false;
  private stashBoxLoadPromise?: Promise<void>;
  private shownDiscoveryKey?: string;
  private pendingDiscoveryKey = '';
  private readonly lruCache: Map<string, LRUEntry> = new Map();
  private readonly stashBoxRateLimiter = new RateLimiter(STASHBOX_MIN_INTERVAL_MS);
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private currentAbortController?: AbortController;
  private currentPostId?: string;

  // Background prefetch queue
  private readonly prefetchQueue: Array<{ performer: Performer; stashId: string }> = [];
  private prefetchTimer?: ReturnType<typeof setTimeout>;
  private prefetchRunning = false;

  // Pending state when panel is collapsed
  private pendingPerformers?: Performer[];

  constructor(api: StashAPI, panel: DiscoveryPanel, sceneOrder: 'latest' | 'random' | 'trending' = 'latest') {
    this.api = api;
    this.panel = panel;
    this.sceneOrder = sceneOrder;
    panel.setOnOpen(() => this.onPanelOpened());
  }

  setSceneOrder(order: 'latest' | 'random' | 'trending'): void {
    if (order === this.sceneOrder) return;
    this.sceneOrder = order;
    // Clear cache so next fetch uses the new order
    this.lruCache.clear();
    this.currentPostId = undefined;
    this.shownDiscoveryKey = undefined;
  }

  onPrimaryPostChanged(postId: string, performers: Performer[]): void {
    void this.ensureStashBoxes(); // warm up as soon as first post is seen
    if (postId === this.currentPostId) return;
    this.currentPostId = postId;

    clearTimeout(this.debounceTimer);
    this.currentAbortController?.abort();
    this.currentAbortController = undefined;

    const relevant = performers.filter(p => p.stash_ids?.length);

    if (this.panel.isCollapsed()) {
      this.pendingPerformers = relevant.length ? relevant : undefined;
      return;
    }

    this.triggerDiscovery(relevant);
  }

  onPanelOpened(): void {
    const relevant = this.pendingPerformers;
    this.pendingPerformers = undefined;
    if (relevant) this.triggerDiscovery(relevant);
  }

  private triggerDiscovery(relevant: Performer[]): void {
    if (!relevant.length) return;

    const key = relevant.flatMap(p => p.stash_ids!.map(s => s.stash_id)).sort((a, b) => a.localeCompare(b)).join(',');
    if (key === this.shownDiscoveryKey) return;
    this.pendingDiscoveryKey = key;

    // If already cached, show immediately with no delay or loading state
    if (this.stashBoxesLoaded && this.stashBoxes.length) {
      const resolved = this.resolvePerformers(relevant);
      if (resolved.length) {
        const allCached = resolved.every(r => this.lruCache.has(`${r.box.endpoint}::${r.stashId}`));
        if (allCached) {
          const ac = new AbortController();
          this.currentAbortController = ac;
          const payload = this.buildScenesPayload(resolved);
          void this.enrichAndShow(payload, ac.signal);
          return;
        }
      }
    }

    this.debounceTimer = setTimeout(() => {
      this.panel.showLoading();
      void this.runDiscovery(relevant);
    }, DEBOUNCE_MS);
  }

  prefetch(performers: Performer[]): void {
    if (!performers.length) return;
    for (const performer of performers) {
      for (const sid of performer.stash_ids ?? []) {
        if (!UUID_RE.test(sid.stash_id)) continue;
        const alreadyQueued = this.prefetchQueue.some(e => e.stashId === sid.stash_id);
        if (alreadyQueued) continue;
        const alreadyCached = [...this.lruCache.keys()].some(k => k.endsWith(`::${sid.stash_id}`));
        if (alreadyCached) continue;
        this.prefetchQueue.push({ performer, stashId: sid.stash_id });
      }
    }
    this.schedulePrefetch();
  }

  private schedulePrefetch(): void {
    if (this.prefetchRunning || this.prefetchTimer !== undefined) return;
    this.prefetchTimer = setTimeout(() => {
      this.prefetchTimer = undefined;
      void this.runPrefetch();
    }, PREFETCH_INTERVAL_MS);
  }

  private async runPrefetch(): Promise<void> {
    if (this.prefetchRunning || !this.prefetchQueue.length) return;
    this.prefetchRunning = true;

    try {
      await this.ensureStashBoxes();
      if (!this.stashBoxes.length) return;

      // Peek at up to PREFETCH_BATCH_SIZE items; resolve boxes for each
      const batch = this.prefetchQueue.slice(0, PREFETCH_BATCH_SIZE);
      const withBoxes = batch.map(item => ({ item, box: this.resolveBox(item.performer, item.stashId) }));

      // Split into items that need fetching vs already cached/unresolvable
      const toFetch = withBoxes.filter(
        (e): e is { item: { performer: Performer; stashId: string }; box: StashBox } =>
          e.box !== undefined && !this.lruCache.has(`${e.box.endpoint}::${e.item.stashId}`),
      );

      if (!toFetch.length) {
        this.prefetchQueue.splice(0, batch.length);
        return;
      }

      // Group by endpoint for batched fetching
      const byEndpoint = new Map<string, { box: StashBox; items: typeof toFetch }>();
      for (const entry of toFetch) {
        let group = byEndpoint.get(entry.box.endpoint);
        if (!group) {
          group = { box: entry.box, items: [] };
          byEndpoint.set(entry.box.endpoint, group);
        }
        group.items.push(entry);
      }

      const perPage = this.sceneOrder === 'random' ? 20 : SCENES_PER_PERFORMER;
      for (const { box, items } of byEndpoint.values()) {
        const batchResult = await this.fetchBatchedScenes(box, items.map(e => e.item.stashId), perPage);
        for (const { item } of items) {
          const scenes = batchResult.get(item.stashId) ?? [];
          this.lruSet(`${box.endpoint}::${item.stashId}`, { scenes, endpoint: box.endpoint });
        }
      }

      this.prefetchQueue.splice(0, batch.length);
    } catch {
      // prefetch failure is silent
    } finally {
      this.prefetchRunning = false;
      if (this.prefetchQueue.length) this.schedulePrefetch();
    }
  }

  private resolveBox(performer: Performer, stashId: string): StashBox | undefined {
    for (const sid of performer.stash_ids ?? []) {
      if (sid.stash_id === stashId) {
        const box = this.stashBoxes.find(b => b.endpoint === sid.endpoint);
        if (box) return box;
      }
    }
    return this.stashBoxes[0];
  }

  private ensureStashBoxes(signal?: AbortSignal): Promise<void> {
    if (this.stashBoxesLoaded) return Promise.resolve();
    this.stashBoxLoadPromise ??= this.api.getStashBoxes()
      .then(boxes => {
        this.stashBoxes = boxes;
        this.stashBoxesLoaded = true;
      })
      .catch(() => {
        this.stashBoxLoadPromise = undefined; // allow retry on failure
      });
    if (!signal) return this.stashBoxLoadPromise;
    return Promise.race([
      this.stashBoxLoadPromise,
      new Promise<void>((_, reject) =>
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      ),
    ]);
  }

  private async runDiscovery(performers: Performer[]): Promise<void> {
    const ac = new AbortController();
    this.currentAbortController = ac;

    try {
      await this.ensureStashBoxes(ac.signal);
      if (ac.signal.aborted) return;

      if (!this.stashBoxes.length) {
        this.panel.showEmpty('No stash-box configured in Stash');
        return;
      }

      const resolved = this.resolvePerformers(performers);
      if (!resolved.length) return;

      const allScenes = await this.fetchAllScenes(resolved, ac.signal);
      if (ac.signal.aborted) return;

      await Promise.all(allScenes.map(async (item) => {
        if (ac.signal.aborted) return;
        const localId = await this.api.findLocalSceneIdByStashDbId(item.scene.id, ac.signal);
        if (localId) item.localStashId = localId;
      }));
      if (ac.signal.aborted) return;

      this.showScenes(allScenes);
    } catch (e) {
      if (ac.signal.aborted || (e instanceof Error && e.name === 'AbortError')) return;
      this.panel.showError('Failed to load discovery data');
    }
  }

  private async fetchAllScenes(
    resolved: Array<{ performer: Performer; stashId: string; box: StashBox }>,
    signal: AbortSignal,
  ): Promise<ScenePayloadItem[]> {
    const counts = sceneCounts(resolved.length);
    const perPage = this.sceneOrder === 'random' ? 20 : SCENES_PER_PERFORMER;

    // Group uncached performers by endpoint for batched fetching
    const byEndpoint = new Map<string, { box: StashBox; indices: number[] }>();
    for (let i = 0; i < resolved.length; i++) {
      const { stashId, box } = resolved[i];
      if (this.lruCache.has(`${box.endpoint}::${stashId}`)) continue;
      let group = byEndpoint.get(box.endpoint);
      if (!group) {
        group = { box, indices: [] };
        byEndpoint.set(box.endpoint, group);
      }
      group.indices.push(i);
    }

    // One batched request per endpoint group
    for (const { box, indices } of byEndpoint.values()) {
      const stashIds = indices.map(i => resolved[i].stashId);
      const batchResult = await this.fetchBatchedScenes(box, stashIds, perPage, signal);
      if (signal.aborted) return [];
      for (const idx of indices) {
        const { stashId } = resolved[idx];
        const scenes = batchResult.get(stashId) ?? [];
        this.lruSet(`${box.endpoint}::${stashId}`, { scenes, endpoint: box.endpoint });
      }
    }
    if (signal.aborted) return [];

    // Assemble in resolved order
    const allScenes: ScenePayloadItem[] = [];
    for (let i = 0; i < resolved.length; i++) {
      const { performer, stashId, box } = resolved[i];
      const cached = this.lruGet(`${box.endpoint}::${stashId}`);
      const scenes = cached?.scenes ?? [];
      const baseUrl = box.endpoint.replace('/graphql', '');
      for (const scene of scenes.slice(0, counts[i])) {
        allScenes.push({ scene, baseUrl, performerName: performer.name });
      }
    }
    return allScenes;
  }

  private resolvePerformers(performers: Performer[]): Array<{ performer: Performer; stashId: string; box: StashBox }> {
    const results: Array<{ performer: Performer; stashId: string; box: StashBox }> = [];
    const seen = new Set<string>();
    this.resolveByEndpoint(performers, results, seen);
    if (!results.length) this.resolveByUUID(performers, results, seen);
    return results;
  }

  private resolveByEndpoint(
    performers: Performer[],
    results: Array<{ performer: Performer; stashId: string; box: StashBox }>,
    seen: Set<string>,
  ): void {
    for (const performer of performers) {
      if (results.length >= 3) break;
      for (const sid of performer.stash_ids ?? []) {
        const box = this.stashBoxes.find(b => b.endpoint === sid.endpoint);
        if (box && !seen.has(sid.stash_id)) {
          seen.add(sid.stash_id);
          results.push({ performer, stashId: sid.stash_id, box });
          break;
        }
      }
    }
  }

  private resolveByUUID(
    performers: Performer[],
    results: Array<{ performer: Performer; stashId: string; box: StashBox }>,
    seen: Set<string>,
  ): void {
    const defaultBox = this.stashBoxes[0];
    if (!defaultBox) return;
    for (const performer of performers) {
      if (results.length >= 3) break;
      for (const sid of performer.stash_ids ?? []) {
        if (UUID_RE.test(sid.stash_id) && !seen.has(sid.stash_id)) {
          seen.add(sid.stash_id);
          results.push({ performer, stashId: sid.stash_id, box: defaultBox });
          break;
        }
      }
    }
  }

  private async enrichAndShow(scenes: ScenePayloadItem[], signal?: AbortSignal): Promise<void> {
    await Promise.all(scenes.map(async (item) => {
      if (signal?.aborted) return;
      const localId = await this.api.findLocalSceneIdByStashDbId(item.scene.id, signal);
      if (localId) item.localStashId = localId;
    }));
    if (!signal?.aborted) this.showScenes(scenes);
  }

  private showScenes(scenes: ScenePayloadItem[]): void {
    this.shownDiscoveryKey = this.pendingDiscoveryKey;
    this.panel.showScenes(scenes);
  }

  private buildScenesPayload(
    resolved: Array<{ performer: Performer; stashId: string; box: StashBox }>
  ): ScenePayloadItem[] {
    const counts = sceneCounts(resolved.length);
    const result: ScenePayloadItem[] = [];
    for (let i = 0; i < resolved.length; i++) {
      const { performer, stashId, box } = resolved[i];
      const cached = this.lruCache.get(`${box.endpoint}::${stashId}`);
      if (!cached) continue;
      const baseUrl = box.endpoint.replace('/graphql', '');
      for (const scene of cached.scenes.slice(0, counts[i])) {
        result.push({ scene, baseUrl, performerName: performer.name });
      }
    }
    return result;
  }

  private async fetchBatchedScenes(
    box: StashBox,
    stashIds: string[],
    perPage: number,
    signal?: AbortSignal,
  ): Promise<Map<string, StashBoxScene[]>> {
    await this.stashBoxRateLimiter.wait(signal);
    this.stashBoxRateLimiter.stamp();

    const sort = this.sceneOrder === 'trending' ? 'TRENDING' : 'DATE';
    const aliases = stashIds.map((id, i) =>
      `p${i}: queryScenes(input: { performers: { value: ["${id}"], modifier: INCLUDES }, per_page: ${perPage}, sort: ${sort}, direction: DESC }) { scenes { id title date images { url } studio { name } } }`
    );
    const query = `query BatchDiscovery { ${aliases.join(' ')} }`;

    const response = await fetch(box.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ApiKey': box.api_key,
      },
      body: JSON.stringify({ query }),
      signal,
    });

    if (!response.ok) throw new Error(`stash-box fetch failed: ${response.status}`);

    const json = await response.json() as { data?: Record<string, { scenes: StashBoxScene[] }>; errors?: unknown[] };
    if (json.errors?.length) throw new Error('stash-box GraphQL error');

    const result = new Map<string, StashBoxScene[]>();
    for (let i = 0; i < stashIds.length; i++) {
      let scenes = json.data?.[`p${i}`]?.scenes ?? [];
      if (this.sceneOrder === 'random') {
        for (let j = scenes.length - 1; j > 0; j--) {
          const k = Math.floor(Math.random() * (j + 1));
          [scenes[j], scenes[k]] = [scenes[k], scenes[j]];
        }
      }
      result.set(stashIds[i], scenes);
    }
    return result;
  }

  private lruGet(key: string): LRUEntry | undefined {
    const entry = this.lruCache.get(key);
    if (!entry) return undefined;
    this.lruCache.delete(key);
    this.lruCache.set(key, entry);
    return entry;
  }

  private lruSet(key: string, value: LRUEntry): void {
    if (this.lruCache.size >= LRU_MAX) {
      const oldest = this.lruCache.keys().next().value;
      if (oldest) this.lruCache.delete(oldest);
    }
    this.lruCache.set(key, value);
  }

  destroy(): void {
    clearTimeout(this.debounceTimer);
    clearTimeout(this.prefetchTimer);
    this.currentAbortController?.abort();
    this.prefetchQueue.length = 0;
    this.pendingPerformers = undefined;
  }
}
