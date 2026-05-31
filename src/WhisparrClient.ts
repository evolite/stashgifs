/**
 * Minimal Whisparr (v3 API) client.
 *
 * Mirrors the relevant surface of the StashSeer userscript:
 *  - list root folders and quality profiles for settings UI
 *  - look up a scene by StashDB id (used to drive the per-card button state)
 *  - check the download queue for a movie
 *  - add a scene (monitored + auto-search)
 *
 * Errors surface as thrown Error with the HTTP status in the message.
 * All methods accept an optional AbortSignal for cancellation, matching the
 * pattern used in DiscoveryManager for StashBox fetches.
 */

export interface WhisparrRootFolder {
  id: number;
  path: string;
}

export interface WhisparrQualityProfile {
  id: number;
  name: string;
}

export interface WhisparrScene {
  id: number;
  stashId?: string;
  foreignId?: string;
  monitored: boolean;
  hasFile: boolean;
  title?: string;
  path?: string;
  qualityProfileId?: number;
  rootFolderPath?: string;
  tags?: number[];
}

export interface WhisparrQueueItem {
  id: number;
  movieId: number;
  size?: number;
  sizeleft?: number;
  status?: string;
  trackedDownloadState?: string;
}

export interface WhisparrClientConfig {
  baseUrl: string;
  apiKey: string;
  rootFolderPath?: string;
  qualityProfileId?: number;
}

const MOVIE_CACHE_TTL_MS = 30_000;
const QUEUE_CACHE_TTL_MS = 5_000;

export class WhisparrClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  readonly rootFolderPath?: string;
  readonly qualityProfileId?: number;

  private movieListCache?: { fetchedAt: number; promise: Promise<WhisparrScene[]> };
  private queueCache?: { fetchedAt: number; promise: Promise<WhisparrQueueItem[]> };

  constructor(config: WhisparrClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.rootFolderPath = config.rootFolderPath;
    this.qualityProfileId = config.qualityProfileId;
  }

  static fromSettings(settings: {
    whisparrBaseUrl?: string;
    whisparrApiKey?: string;
    whisparrRootFolderPath?: string;
    whisparrQualityProfileId?: number;
  }): WhisparrClient | undefined {
    if (!settings.whisparrBaseUrl || !settings.whisparrApiKey) return undefined;
    return new WhisparrClient({
      baseUrl: settings.whisparrBaseUrl,
      apiKey: settings.whisparrApiKey,
      rootFolderPath: settings.whisparrRootFolderPath,
      qualityProfileId: settings.whisparrQualityProfileId,
    });
  }

  isFullyConfigured(): boolean {
    return !!(this.rootFolderPath && typeof this.qualityProfileId === 'number');
  }

  invalidateCaches(): void {
    this.movieListCache = undefined;
    this.queueCache = undefined;
  }

  private async request<T>(path: string, init: RequestInit & { signal?: AbortSignal } = {}): Promise<T> {
    const url = `${this.baseUrl}/api/v3${path}`;
    const headers = new Headers(init.headers);
    headers.set('X-Api-Key', this.apiKey);
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(url, { ...init, headers });
    if (!response.ok) {
      throw new Error(`Whisparr ${init.method ?? 'GET'} ${path} failed: HTTP ${response.status}`);
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }

  async getRootFolders(signal?: AbortSignal): Promise<WhisparrRootFolder[]> {
    return await this.request<WhisparrRootFolder[]>('/rootfolder', { method: 'GET', signal });
  }

  async getQualityProfiles(signal?: AbortSignal): Promise<WhisparrQualityProfile[]> {
    return await this.request<WhisparrQualityProfile[]>('/qualityprofile', { method: 'GET', signal });
  }

  private getMovieList(signal?: AbortSignal): Promise<WhisparrScene[]> {
    const now = Date.now();
    if (this.movieListCache && now - this.movieListCache.fetchedAt < MOVIE_CACHE_TTL_MS) {
      return this.movieListCache.promise;
    }
    const promise = this.request<WhisparrScene[]>('/movie', { method: 'GET', signal })
      .catch((err) => {
        this.movieListCache = undefined;
        throw err;
      });
    this.movieListCache = { fetchedAt: now, promise };
    return promise;
  }

  async getSceneByStashId(stashId: string, signal?: AbortSignal): Promise<WhisparrScene | null> {
    const list = await this.getMovieList(signal);
    return list.find((m) => m.stashId === stashId || m.foreignId === stashId) ?? null;
  }

  private getQueue(signal?: AbortSignal): Promise<WhisparrQueueItem[]> {
    const now = Date.now();
    if (this.queueCache && now - this.queueCache.fetchedAt < QUEUE_CACHE_TTL_MS) {
      return this.queueCache.promise;
    }
    const promise = this.request<{ records?: WhisparrQueueItem[] } | WhisparrQueueItem[]>(
      '/queue/details?includeMovie=false',
      { method: 'GET', signal },
    )
      .then((data) => {
        if (Array.isArray(data)) return data;
        return data.records ?? [];
      })
      .catch((err) => {
        this.queueCache = undefined;
        throw err;
      });
    this.queueCache = { fetchedAt: now, promise };
    return promise;
  }

  async getQueueForMovie(movieId: number, signal?: AbortSignal): Promise<WhisparrQueueItem | null> {
    const queue = await this.getQueue(signal);
    return queue.find((q) => q.movieId === movieId) ?? null;
  }

  async addScene(stashId: string, signal?: AbortSignal): Promise<WhisparrScene> {
    if (!this.rootFolderPath || typeof this.qualityProfileId !== 'number') {
      throw new Error('Whisparr is not fully configured (missing root folder or quality profile).');
    }
    const body = {
      foreignId: stashId,
      stashId,
      monitored: true,
      qualityProfileId: this.qualityProfileId,
      rootFolderPath: this.rootFolderPath,
      tags: [],
      title: 'added via stashgifs',
      addOptions: { monitor: 'none', searchForMovie: true },
    };
    const result = await this.request<WhisparrScene>('/movie', {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    });
    // Newly-added scene invalidates our cached lookup.
    this.movieListCache = undefined;
    return result;
  }
}
