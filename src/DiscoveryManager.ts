import type { StashAPI } from './StashAPI.js';
import type { DiscoveryPanel } from './DiscoveryPanel.js';
import type { Performer } from './types.js';
import type { StashBox, StashBoxScene, StashBoxScenesResponse } from './graphql/types.js';

const SCENES_PER_PERFORMER = 3;
const DEBOUNCE_MS = 2000;
const STASHBOX_MIN_INTERVAL_MS = 300; // minimum gap between outgoing StashBox requests

function sceneCounts(n: number): number[] {
  if (n === 1) return [3];
  if (n === 2) return [2, 1];
  return [1, 1, 1];
}
const LRU_MAX = 100;
const PREFETCH_INTERVAL_MS = 600; // delay between background prefetch requests

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

const STASHBOX_SCENES_QUERY = `
  query DiscoveryScenes($performerId: ID!, $perPage: Int!) {
    queryScenes(input: {
      performers: { value: [$performerId], modifier: INCLUDES }
      per_page: $perPage
      sort: DATE
      direction: DESC
    }) {
      count
      scenes {
        id
        title
        date
        images { url }
        studio { name }
      }
    }
  }
`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class DiscoveryManager {
  private readonly api: StashAPI;
  private readonly panel: DiscoveryPanel;
  private sceneOrder: 'latest' | 'random' = 'latest';
  private stashBoxes: StashBox[] = [];
  private stashBoxesLoaded = false;
  private stashBoxesLoading = false;
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

  constructor(api: StashAPI, panel: DiscoveryPanel, sceneOrder: 'latest' | 'random' = 'latest') {
    this.api = api;
    this.panel = panel;
    this.sceneOrder = sceneOrder;
    panel.setOnOpen(() => this.onPanelOpened());
  }

  setSceneOrder(order: 'latest' | 'random'): void {
    if (order === this.sceneOrder) return;
    this.sceneOrder = order;
    // Clear cache so next fetch uses the new order
    this.lruCache.clear();
    this.currentPostId = undefined;
  }

  onPrimaryPostChanged(postId: string, performers: Performer[]): void {
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
    if (!relevant.length) {
      this.panel.showEmpty('No StashDB data for this performer');
      return;
    }

    // If already cached, show immediately with no delay or loading state
    if (this.stashBoxesLoaded && this.stashBoxes.length) {
      const resolved = this.resolvePerformers(relevant);
      if (resolved.length) {
        const allCached = resolved.every(r => this.lruCache.has(`${r.box.endpoint}::${r.stashId}`));
        if (allCached) {
          const payload = this.buildScenesPayload(resolved);
          void this.enrichAndShow(payload);
          return;
        }
      }
    }

    this.debounceTimer = setTimeout(() => {
      this.panel.showLoading();
      this.panel.showSpinner();
      void this.runDiscovery(relevant);
    }, DEBOUNCE_MS);
  }

  prefetch(performers: Performer[]): void {
    if (!performers.length) return;
    // Queue performers that have a UUID stash_id and aren't already cached/queued
    for (const performer of performers) {
      for (const sid of performer.stash_ids ?? []) {
        if (!UUID_RE.test(sid.stash_id)) continue;
        // Use a placeholder key to check cache (endpoint may not be known yet)
        const alreadyQueued = this.prefetchQueue.some(e => e.stashId === sid.stash_id);
        if (alreadyQueued) continue;
        // Check if any cache key contains this stash_id
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
      // Ensure stash-boxes are loaded (share with the main discovery flow)
      if (!this.stashBoxesLoaded && !this.stashBoxesLoading) {
        this.stashBoxesLoading = true;
        this.stashBoxes = await this.api.getStashBoxes();
        this.stashBoxesLoaded = true;
        this.stashBoxesLoading = false;
      }
      if (!this.stashBoxes.length) return;

      const item = this.prefetchQueue.shift();
      if (!item) return;

      const box = this.resolveBox(item.performer, item.stashId);
      if (!box) return;

      const cacheKey = `${box.endpoint}::${item.stashId}`;
      if (this.lruCache.has(cacheKey)) return; // already cached between schedule and run

      const scenes = await this.fetchScenesFromStashBox(box, item.stashId);
      this.lruSet(cacheKey, { scenes, endpoint: box.endpoint });
    } catch {
      // prefetch failure is silent
    } finally {
      this.prefetchRunning = false;
      if (this.prefetchQueue.length) this.schedulePrefetch();
    }
  }

  private resolveBox(performer: Performer, stashId: string): StashBox | undefined {
    // Exact endpoint match first
    for (const sid of performer.stash_ids ?? []) {
      if (sid.stash_id === stashId) {
        const box = this.stashBoxes.find(b => b.endpoint === sid.endpoint);
        if (box) return box;
      }
    }
    // Fallback: first configured stash-box
    return this.stashBoxes[0];
  }

  private async runDiscovery(performers: Performer[]): Promise<void> {
    const ac = new AbortController();
    this.currentAbortController = ac;

    try {
      if (!this.stashBoxesLoaded) {
        this.stashBoxesLoading = true;
        const boxes = await this.api.getStashBoxes(ac.signal);
        if (ac.signal.aborted) return;
        this.stashBoxes = boxes;
        this.stashBoxesLoaded = true;
        this.stashBoxesLoading = false;
      }

      if (!this.stashBoxes.length) {
        this.panel.showEmpty('No stash-box configured in Stash');
        return;
      }

      const resolved = this.resolvePerformers(performers);
      if (!resolved.length) {
        this.panel.showEmpty('Performer not found on any configured stash-box');
        return;
      }

      const counts = sceneCounts(resolved.length);
      const allScenes: Array<{ scene: import('./graphql/types.js').StashBoxScene; baseUrl: string; performerName: string; localStashId?: string }> = [];

      for (let i = 0; i < resolved.length; i++) {
        const { performer, stashId, box } = resolved[i];
        const cacheKey = `${box.endpoint}::${stashId}`;
        const cached = this.lruGet(cacheKey);
        let scenes = cached?.scenes;
        if (!scenes) {
          scenes = await this.fetchScenesFromStashBox(box, stashId, ac.signal);
          if (ac.signal.aborted) return;
          this.lruSet(cacheKey, { scenes, endpoint: box.endpoint });
        }
        const baseUrl = box.endpoint.replace('/graphql', '');
        for (const scene of scenes.slice(0, counts[i])) {
          allScenes.push({ scene, baseUrl, performerName: performer.name });
        }
      }

      await Promise.all(allScenes.map(async (item) => {
        if (ac.signal.aborted) return;
        const localId = await this.api.findLocalSceneIdByStashDbId(item.scene.id, ac.signal);
        if (localId) item.localStashId = localId;
      }));
      if (ac.signal.aborted) return;

      this.panel.hideSpinner();
      this.panel.showScenes(allScenes);
    } catch (e) {
      this.panel.hideSpinner();
      if (ac.signal.aborted || (e instanceof Error && e.name === 'AbortError')) return;
      this.panel.showError('Failed to load discovery data');
    }
  }

  private resolvePerformers(performers: Performer[]): Array<{ performer: Performer; stashId: string; box: StashBox }> {
    const results: Array<{ performer: Performer; stashId: string; box: StashBox }> = [];
    const seen = new Set<string>();

    // Pass 1: exact endpoint match
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

    // Pass 2: UUID fallback to first stash-box (only if pass 1 found nothing)
    if (!results.length) {
      const defaultBox = this.stashBoxes[0];
      if (!defaultBox) return results;
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

    return results;
  }

  private async enrichAndShow(
    scenes: Array<{ scene: import('./graphql/types.js').StashBoxScene; baseUrl: string; performerName: string; localStashId?: string }>,
    signal?: AbortSignal,
  ): Promise<void> {
    await Promise.all(scenes.map(async (item) => {
      if (signal?.aborted) return;
      const localId = await this.api.findLocalSceneIdByStashDbId(item.scene.id, signal);
      if (localId) item.localStashId = localId;
    }));
    if (!signal?.aborted) this.panel.showScenes(scenes);
  }

  private buildScenesPayload(
    resolved: Array<{ performer: Performer; stashId: string; box: StashBox }>
  ): Array<{ scene: import('./graphql/types.js').StashBoxScene; baseUrl: string; performerName: string; localStashId?: string }> {
    const counts = sceneCounts(resolved.length);
    const result: Array<{ scene: import('./graphql/types.js').StashBoxScene; baseUrl: string; performerName: string; localStashId?: string }> = [];
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

  private async fetchScenesFromStashBox(box: StashBox, stashId: string, signal?: AbortSignal): Promise<StashBoxScene[]> {
    await this.stashBoxRateLimiter.wait(signal);
    this.stashBoxRateLimiter.stamp();

    const response = await fetch(box.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ApiKey': box.api_key,
      },
      body: JSON.stringify({
        query: STASHBOX_SCENES_QUERY,
        variables: {
          performerId: stashId,
          perPage: this.sceneOrder === 'random' ? 20 : SCENES_PER_PERFORMER,
        },
      }),
      signal,
    });

    if (!response.ok) throw new Error(`stash-box fetch failed: ${response.status}`);

    const json = await response.json() as { data?: StashBoxScenesResponse; errors?: unknown[] };
    if (json.errors?.length) throw new Error('stash-box GraphQL error');

    const scenes = json.data?.queryScenes?.scenes ?? [];
    if (this.sceneOrder === 'random') {
      for (let i = scenes.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [scenes[i], scenes[j]] = [scenes[j], scenes[i]];
      }
    }
    return scenes;
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
