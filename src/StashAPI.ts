/**
 * Stash API integration
 * This will interface with the Stash GraphQL API
 */

import { Scene, SceneMarker, FilterOptions, VideoSource, Performer, DateRangeFilter, SavedFilterMode } from './types.js';
import { normalizeMediaUrl, stripApiKey } from './utils.js';
import { getStashBaseUrl } from './utils/baseUrl.js';
import * as queries from './graphql/queries.js';
import * as mutations from './graphql/mutations.js';
import {
  FindFilterInput,
  SceneMarkerFilterInput,
  SceneFilterInput,
  TagFilterInput,
  ImageFilterInput,
  FindSceneMarkersResponse,
  FindScenesResponse,
  FindTagsResponse,
  FindTagsExtendedResponse,
  FindStudiosResponse,
  FindPerformersResponse,
  FindPerformerResponse,
  PerformerExtended,
  FindStudioResponse,
  StudioExtended,
  FindImagesResponse,
  FindGalleriesResponse,
  Gallery,
  GetSavedFiltersResponse,
  GetSavedFilterResponse,
  CheckTagsHaveMarkersResponse,
  TagCreateResponse,
  SceneMarkerUpdateResponse,
  SceneMarkerCreateResponse,
  SceneUpdateResponse,
  SceneAddOResponse,
  SceneIncrementPlayCountResponse,
  SceneSaveActivityResponse,
  ImageUpdateResponse,
  ImageIncrementOResponse,
  TagCreateInput,
  SceneMarkerUpdateInput,
  TypedGraphQLClient,
  GQLImage,
  ConfigurationResponse,
  ConfigurePluginResponse,
  StashBox,
  GetStashBoxConfigResponse,
} from './graphql/types.js';
import {
  GraphQLRequestError,
  GraphQLResponseError,
  GraphQLNetworkError,
  isAbortError,
} from './graphql/errors.js';
import { GraphQLClient } from './graphql/client.js';
import { TtlCache } from './api/TtlCache.js';
import { MediaUrls } from './api/MediaUrls.js';
import { ApiIO } from './api/ApiIO.js';
import { FeedFilters, type ImageFilterOptions, type TagSource } from './api/FeedFilters.js';
import { Batcher } from './api/Batcher.js';
import { generateRandomSortSeed } from './api/sortSeed.js';
import { runAliased } from './api/aliased.js';

interface MarkerTagUpdateData {
  id: string;
  title: string;
  seconds: number;
  end_seconds?: number | null;
  scene: { id: string };
  primary_tag?: { id: string } | null;
  tags?: Array<{ id: string }>;
}

interface StashPluginApi {
  GQL: {
    useFindScenesQuery?: (variables: unknown) => { data?: unknown; loading: boolean };
    client?: TypedGraphQLClient;
  };
  baseURL?: string;
  apiKey?: string;
}


export { generateRandomSortSeed };

export class StashAPI {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly pluginApi?: StashPluginApi;
  // Centralized GraphQL client
  private readonly gqlClient: GraphQLClient;
  // Simple cache for autocomplete search results only (not filtered queries)
  private readonly searchCache = new TtlCache<unknown[]>(5 * 60 * 1000, 300);
  /** Per-tag EFFECTIVE presence across sources (own counts ∪ all descendants' counts, > 0), used
   *  to route a tag to the single filter field that can match it — including parent-only tags,
   *  which resolve to the sources their subtree lives in. Cached for the session. */
  private readonly _tagSourceCache = new Map<string, TagSource>();
  private readonly filters = new FeedFilters(this._tagSourceCache);
  private readonly io = new ApiIO(() => this.gqlClient);

  // Magic numbers as constants
  private static readonly SEARCH_FETCH_MULTIPLIER = 3; // Fetch 3x limit when searching to improve relevance
  private static readonly MIN_SEARCH_LIMIT = 20; // Minimum results to fetch when not searching
  private static readonly MIN_MARKER_COUNT_FOR_TAG_FILTER = 10; // Minimum markers required for tag to appear in suggestions
  private static readonly SHORT_FORM_SCENES_PER_PAGE = 24; // Number of scenes to fetch per page for short-form content
  private static readonly MAX_MARKERS_PER_SCENE_FOR_SHUFFLE = 5; // Maximum markers per scene in shuffle mode
  private static readonly DEFAULT_CONTENT_LIMIT = 5000; // Default cap for users with extreme amounts
  private _maxContentLimit = StashAPI.DEFAULT_CONTENT_LIMIT;

  set maxContentLimit(value: number) {
    this._maxContentLimit = value > 0 ? value : StashAPI.DEFAULT_CONTENT_LIMIT;
  }

  /** Playback resolution cap in px (scene height). 0 = off. Scenes taller than this
   *  are forced through Stash's transcoded stream at the capped resolution. */
  private _maxResolution = 0;

  set maxResolution(px: number) {
    this._maxResolution = Number.isFinite(px) && px > 0 ? px : 0;
  }

  constructor(baseUrl?: string, apiKey?: string) {
    // Get from globalThis if available (Stash plugin context)
    const windowWithStash = globalThis as typeof globalThis & {
      PluginApi?: StashPluginApi;
      stash?: StashPluginApi;
    };
    this.pluginApi = windowWithStash.PluginApi || windowWithStash.stash;
    
    // Try to get base URL from various sources
    if (baseUrl) {
      this.baseUrl = baseUrl;
    } else if (this.pluginApi?.baseURL) {
      this.baseUrl = this.pluginApi.baseURL;
    } else {
      // Fallback: derive base (origin + any path prefix) for standalone-app context
      this.baseUrl = getStashBaseUrl();
    }

    this.apiKey = apiKey || this.pluginApi?.apiKey;
    this.media = new MediaUrls(this.baseUrl, () => this._maxResolution);
    
    // Result caching is selective and lives in StashAPI; the client only dedupes in-flight queries.
    this.gqlClient = new GraphQLClient({
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      pluginApi: this.pluginApi,
    });
  }

  destroy(): void {
    this.gqlClient.destroy();
  }

  /**
   * Build cache key with proper escaping to prevent collisions
   */
  private buildCacheKey(prefix: string, term: string, limit: number): string {
    // Escape colons and other special characters that could cause collisions
    const escapedTerm = term.replaceAll(':', '::').replaceAll('|', '||');
    return `${prefix}|${escapedTerm}|${limit}`;
  }

  /**
   * Generic search method for autocomplete results with caching
   */
  private async searchWithCache<T>(
    cacheKey: string,
    isEmptyTerm: boolean,
    queryFn: () => Promise<T[]>,
    signal?: AbortSignal
  ): Promise<T[]> {
    if (this.io.isAborted(signal)) return [];

    // Check cache first (only for non-empty terms)
    if (!isEmptyTerm) {
      const cached = this.searchCache.peek(cacheKey);
      if (cached) return (await cached) as T[];
    }

    try {
      const results = await queryFn();
      
      if (this.io.isAborted(signal)) return [];
      
      // Cache the result (only for non-empty terms)
      if (!isEmptyTerm) {
        this.searchCache.set(cacheKey, results);
      }
      
      return results;
    } catch (error: unknown) {
      return this.io.handleError('searchWithCache', error, signal, []);
    }
  }

  private buildSearchFilter(term: string, limit: number): { hasSearchTerm: boolean; filter: FindFilterInput } {
    const hasSearchTerm = !!(term && term.trim() !== '');
    const fetchLimit = hasSearchTerm ? limit * StashAPI.SEARCH_FETCH_MULTIPLIER : Math.max(limit, StashAPI.MIN_SEARCH_LIMIT);
    const filter: FindFilterInput = {
      per_page: fetchLimit,
      page: 1,
      ...(hasSearchTerm ? { q: term.trim() } : { sort: generateRandomSortSeed() })
    };
    return { hasSearchTerm, filter };
  }

  /**
   * Search marker tags (by name) for autocomplete
   * Only returns tags that have more than 10 markers (filtered directly in GraphQL)
   * Includes caching for autocomplete results only
   */
  async searchMarkerTags(term: string, limit: number = 10, signal?: AbortSignal): Promise<Array<{ id: string; name: string }>> {
    const isEmptyTerm = !term || term.trim() === '';
    const cacheKey = this.buildCacheKey('tags', term, limit);
    const { hasSearchTerm, filter } = this.buildSearchFilter(term, limit);
    
    // When searching, remove marker_count filter to show all tags (including newly created ones and tags with only scenes/images)
    // When not searching (suggestions), keep marker_count > 10 filter to show only popular/relevant tags
    const tag_filter: TagFilterInput = hasSearchTerm
      ? {} // No filter - show all tags when searching
      : {
          marker_count: {
            value: StashAPI.MIN_MARKER_COUNT_FOR_TAG_FILTER,
            modifier: 'GREATER_THAN'
          }
        };
    
    return this.searchWithCache(
      cacheKey,
      isEmptyTerm,
      async () => {
        const result = await this.gqlClient.query<FindTagsResponse>({
          query: queries.FIND_TAGS,
          variables: { filter, tag_filter },
          signal,
        });
        
        const tags = result.data?.findTags?.tags ?? [];
        return tags.slice(0, limit);
      },
      signal
    );
  }

  /**
   * Search scene markers by title (for autocomplete).
   * Uses the free-text `q` filter, which Stash matches against the marker title.
   * Returns distinct titles (multiple markers can share a title).
   */
  async searchMarkersByTitle(term: string, limit: number = 20, signal?: AbortSignal): Promise<Array<{ id: string; title: string }>> {
    const trimmed = term?.trim() ?? '';
    if (trimmed === '') return [];

    const cacheKey = this.buildCacheKey('markers', trimmed, limit);

    return this.searchWithCache(
      cacheKey,
      false,
      async () => {
        const result = await this.gqlClient.query<FindSceneMarkersResponse>({
          query: queries.FIND_SCENE_MARKERS,
          variables: {
            filter: { q: trimmed, per_page: limit, page: 1 },
            scene_marker_filter: {},
          },
          signal,
        });

        const markers = result.data?.findSceneMarkers?.scene_markers ?? [];
        const seen = new Set<string>();
        const distinct: Array<{ id: string; title: string }> = [];
        for (const marker of markers) {
          const title = marker.title?.trim();
          if (!title) continue;
          const key = title.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          distinct.push({ id: String(marker.id), title });
          if (distinct.length >= limit) break;
        }
        return distinct;
      },
      signal
    );
  }

  /**
   * Search performers (by name) for autocomplete
   * Returns performers regardless of scene/image counts
   * Includes caching for autocomplete results only
   */
  async searchPerformers(term: string, limit: number = 10, signal?: AbortSignal): Promise<Array<{ id: string; name: string; aliases?: string[]; image_path?: string }>> {
    const isEmptyTerm = !term || term.trim() === '';
    const cacheKey = this.buildCacheKey('performers-v2', term, limit);
    const { filter } = this.buildSearchFilter(term, limit);
    
    return this.searchWithCache(
      cacheKey,
      isEmptyTerm,
      async () => {
        const result = await this.gqlClient.query<FindPerformersResponse>({
          query: queries.FIND_PERFORMERS,
          variables: { filter },
          signal,
        });
        
        const performers = result.data?.findPerformers?.performers ?? [];
        return performers.slice(0, limit);
      },
      signal
    );
  }

  // fallow-ignore-next-line unused-class-member
  async searchStudios(term: string, limit: number = 10, signal?: AbortSignal): Promise<Array<{ id: string; name: string; image_path?: string }>> {
    const isEmptyTerm = !term || term.trim() === '';
    const cacheKey = this.buildCacheKey('studios', term, limit);
    const { filter } = this.buildSearchFilter(term, limit);

    return this.searchWithCache(
      cacheKey,
      isEmptyTerm,
      async () => {
        const result = await this.gqlClient.query<FindStudiosResponse>({
          query: queries.FIND_STUDIOS,
          variables: { filter },
          signal,
        });
        const studios = result.data?.findStudios?.studios ?? [];
        return studios.slice(0, limit);
      },
      signal
    );
  }

  /**
   * Get detailed performer information by ID
   * Used for hover overlay display
   */
  async getPerformerDetails(performerId: string, signal?: AbortSignal): Promise<PerformerExtended | null> {
    if (this.io.isAborted(signal)) return null;

    try {
      const result = await this.gqlClient.query<FindPerformerResponse>({
        query: queries.FIND_PERFORMER,
        variables: { ids: [performerId] },
        signal,
      });

      if (this.io.isAborted(signal)) return null;

      const performers = result.data?.findPerformers?.performers ?? [];
      return performers[0] ?? null;
    } catch (error: unknown) {
      return this.io.handleError('getPerformerDetails', error, signal, null);
    }
  }

  // fallow-ignore-next-line unused-class-member
  async getStudioDetails(studioId: string, signal?: AbortSignal): Promise<StudioExtended | null> {
    if (this.io.isAborted(signal)) return null;
    try {
      const result = await this.gqlClient.query<FindStudioResponse>({
        query: queries.FIND_STUDIO,
        variables: { id: studioId },
        signal,
      });
      if (this.io.isAborted(signal)) return null;
      return result.data?.findStudio ?? null;
    } catch (error: unknown) {
      return this.io.handleError('getStudioDetails', error, signal, null);
    }
  }

  /**
   * Get detailed tag information by ID
   */
  async getTagDetails(tagId: string, signal?: AbortSignal): Promise<{ id: string; name: string; image_path?: string; description?: string; favorite?: boolean } | null> {
    if (this.io.isAborted(signal)) return null;

    try {
      const result = await this.gqlClient.query<FindTagsExtendedResponse>({
        query: queries.FIND_TAGS_FOR_SELECT,
        variables: { ids: [tagId], filter: null, tag_filter: null },
        signal,
      });

      if (this.io.isAborted(signal)) return null;

      const tags = result.data?.findTags?.tags ?? [];
      return tags[0] ?? null;
    } catch (error: unknown) {
      return this.io.handleError('getTagDetails', error, signal, null);
    }
  }


  /**
   * Fetch saved filters the feed can apply (scene markers and images) from Stash
   */
  async fetchSavedFilters(signal?: AbortSignal): Promise<Array<{ id: string; name: string; mode: SavedFilterMode }>> {
    if (this.io.isAborted(signal)) return [];
    
    try {
      const result = await this.gqlClient.query<GetSavedFiltersResponse>({
        query: queries.GET_SAVED_FILTERS,
        signal,
      });
      
      if (this.io.isAborted(signal)) return [];
      return (result.data?.findSavedFilters || []).filter(
        (f): f is { id: string; name: string; mode: SavedFilterMode } => f.mode === 'SCENE_MARKERS' || f.mode === 'IMAGES'
      );
    } catch (error: unknown) {
      return this.io.rethrowUnlessAbort('fetchSavedFilters', error, signal, []);
    }
  }

  /** Saved-filter criteria by id: re-read for every page of a saved-filter feed otherwise. */
  private readonly _savedFilters = new TtlCache<GetSavedFilterResponse['findSavedFilter']>(60_000, 50);

  /**
   * Get a saved filter's criteria. Resolves null when it doesn't exist; a failed request throws
   * so the feed can't silently fall back to unfiltered results.
   */
  async getSavedFilter(id: string, signal?: AbortSignal): Promise<GetSavedFilterResponse['findSavedFilter']> {
    if (this.io.isAborted(signal)) return null;

    try {
      // Shared, signal-free load (see TtlCache): one caller aborting must not fail the others.
      const filter = await this._savedFilters.getOrLoad(id, async () => {
        const result = await this.gqlClient.query<GetSavedFilterResponse>({ query: queries.GET_SAVED_FILTER, variables: { id } });
        return result.data?.findSavedFilter || null;
      }, (f) => f !== null);
      return this.io.isAborted(signal) ? null : filter;
    } catch (error: unknown) {
      return this.io.rethrowUnlessAbort('getSavedFilter', error, signal, null);
    }
  }

  /**
   * Fetch scene markers from Stash
   */
  async fetchSceneMarkers(filters?: FilterOptions, signal?: AbortSignal): Promise<{ markers: SceneMarker[]; totalCount: number; sortSeed?: string }> {
    if (this.io.isAborted(signal)) return { markers: [], totalCount: 0 };
    
    // Fetching scene markers with filters
    
    if (filters?.shuffleMode) {
      const { markers, sortSeed, totalCount } = await this.fetchScenesForShuffle(filters, signal);
      return { markers, totalCount, sortSeed };
    }
    
    const savedFilterCriteria = await this.getSavedFilterCriteria(filters, signal);
    if (this.io.isAborted(signal)) return { markers: [], totalCount: 0 };

    try {
      const limit = filters?.limit || 20;
      // The sort is a fresh random seed, so page 1 is already a random sample: no count query needed.
      const page = this.filters.calculateInitialPage(limit, filters);

      const filter = this.filters.buildFindFilter(filters, savedFilterCriteria, page, limit);
      // buildSceneMarkerFilter routes each selected tag to its source field (tags / scene_tags /
      // scene_filter.performer_tags) and ANDs them — one exact, tight query, no client narrowing
      // for single-source tags. Multi-source tags are deferred to FeedContainer's union check.
      const sceneMarkerFilter = this.filters.buildSceneMarkerFilter(filters, savedFilterCriteria);

      const { markers, totalCount } = await this.executeMarkerQueryWithCount(filter, sceneMarkerFilter, signal);
      if (this.io.isAborted(signal)) return { markers: [], totalCount: 0 };

      return { markers, totalCount, sortSeed: filter.sort };
    } catch (error: unknown) {
      return this.io.handleError('fetchSceneMarkers', error, signal, { markers: [], totalCount: 0 });
    }
  }

  /**
   * Get saved filter criteria if a saved filter ID is provided
   */
  private async getSavedFilterCriteria(filters?: { savedFilterId?: string }, signal?: AbortSignal): Promise<GetSavedFilterResponse['findSavedFilter']> {
    if (!filters?.savedFilterId) return null;
    return await this.getSavedFilter(filters.savedFilterId, signal);
  }

  extractTagAndPerformerFilters(filters?: FilterOptions): ReturnType<FeedFilters['extractTagAndPerformerFilters']> {
    return this.filters.extractTagAndPerformerFilters(filters);
  }

  /**
   * Prime the tag→effective-source cache (session-cached). A tag's "effective" sources are the
   * union of its own counts AND all its descendants' counts, so a parent-only organizational tag
   * resolves to the sources its subtree actually lives in (the routing then matches by depth).
   * One query per uncached tag: the tag itself + every descendant (via parents/depth).
   */
  async getTagSources(ids: string[]): Promise<void> {
    const missing = [...new Set(ids)].filter((id) => id && !this._tagSourceCache.has(id));
    if (missing.length === 0) return;
    type Counts = { scene_count?: number; scene_marker_count?: number; performer_count?: number; image_count?: number };
    // One request for every uncached tag. Descendants are asked as four count-only queries
    // (> 0 per source) instead of downloading the whole subtree with per_page:-1.
    const desc = (field: string) =>
      `findTags(tag_filter:{parents:{value:[$v],modifier:INCLUDES,depth:-1},${field}:{value:0,modifier:GREATER_THAN}},filter:{per_page:1}){count}`;
    try {
      const rows = await runAliased(this.io.aliasedExec, 'TagSources', 'ID!', missing, {
        self: 'findTags(ids:[$v]){tags{scene_count scene_marker_count performer_count image_count}}',
        dm: desc('marker_count'),
        ds: desc('scene_count'),
        dp: desc('performer_count'),
        di: desc('image_count'),
      });
      const count = (row: Record<string, unknown>, alias: string) => (row[alias] as { count?: number } | undefined)?.count ?? 0;
      missing.forEach((id, i) => {
        const row = rows[i];
        const own = (row.self as { tags?: Counts[] } | undefined)?.tags?.[0];
        this._tagSourceCache.set(id, {
          marker: (own?.scene_marker_count ?? 0) > 0 || count(row, 'dm') > 0,
          scene: (own?.scene_count ?? 0) > 0 || count(row, 'ds') > 0,
          performer: (own?.performer_count ?? 0) > 0 || count(row, 'dp') > 0,
          image: (own?.image_count ?? 0) > 0 || count(row, 'di') > 0,
        });
      });
    } catch { /* leave uncached — routing falls back to the primary enabled source */ }
  }

  /**
   * Route each selected tag to exactly ONE server-side field so filtering is fully server-side
   * (no client union check, so pagination stays correct). A tag is placed in the highest-priority
   * enabled source it effectively belongs to (marker > scene > performer for markers; scene >
   * performer for scenes). Uncached tags fall back to the primary enabled source. A tag known to
   * be in no enabled source forces an empty result. A tag effectively in multiple enabled sources
   * is matched in the highest-priority one (Stash can't OR across sources).
   */

  /**
   * Execute marker query with retry logic and return count
   */
  private async executeMarkerQueryWithCount(
    filter: FindFilterInput,
    sceneMarkerFilter: SceneMarkerFilterInput,
    signal?: AbortSignal
  ): Promise<{ markers: SceneMarker[]; totalCount: number }> {
    const result = await this.gqlClient.query<FindSceneMarkersResponse>({
      query: queries.FIND_SCENE_MARKERS,
      variables: {
        filter,
        scene_marker_filter: Object.keys(sceneMarkerFilter).length > 0 ? sceneMarkerFilter : {},
      },
      signal,
    });
    
    if (this.io.isAborted(signal)) return { markers: [], totalCount: 0 };
    
    const responseData = result.data?.findSceneMarkers;
    const markers = responseData?.scene_markers || [];
    const totalCount = Math.min(responseData?.count ?? 0, this._maxContentLimit);

    // A positive count with no markers on PAGE 1 indicates a genuine race/inconsistency
    // worth retrying. On a later page it just means we've paged past the end of the
    // available markers — return empty so the feed moves on to other content. Retrying
    // page 1 here would re-fetch the first markers, duplicating them and making the feed
    // loop the same handful of markers once they're exhausted.
    const page = typeof filter.page === 'number' ? filter.page : 1;
    if (totalCount > 0 && markers.length === 0 && page <= 1) {
      return this.retryMarkerQueryWithCount(filter, sceneMarkerFilter, signal);
    }

    return { markers, totalCount };
  }

  /**
   * Retry marker query with page 1 and return count
   */
  private async retryMarkerQueryWithCount(
    filter: FindFilterInput,
    sceneMarkerFilter: SceneMarkerFilterInput,
    signal?: AbortSignal
  ): Promise<{ markers: SceneMarker[]; totalCount: number }> {
    this.io.logError('retryMarkerQueryWithCount', new Error('Count > 0 but no markers returned - retrying with page 1'));
    
    if (this.io.isAborted(signal)) return { markers: [], totalCount: 0 };
    
    // Create a copy of the filter to avoid mutating the input parameter
    const retryFilter = { ...filter, page: 1 };
    const retryResult = await this.gqlClient.query<FindSceneMarkersResponse>({
      query: queries.FIND_SCENE_MARKERS,
      variables: {
        filter: retryFilter,
        scene_marker_filter: Object.keys(sceneMarkerFilter).length > 0 ? sceneMarkerFilter : {},
      },
      signal,
    });
    
    if (this.io.isAborted(signal)) return { markers: [], totalCount: 0 };
    
    const retryData = retryResult.data?.findSceneMarkers;
    return {
      markers: retryData?.scene_markers || [],
      totalCount: retryData?.count ?? 0
    };
  }

  /**
   * Fetch scenes directly for shuffle mode (includes scenes with 0 markers)
   * @param filters Filter options
   * @param signal Abort signal
   * @returns Array of synthetic scene markers (one per scene) and sortSeed
   */
  private async fetchScenesForShuffle(filters?: FilterOptions, signal?: AbortSignal): Promise<{ markers: SceneMarker[]; sortSeed: string; totalCount: number }> {
    try {
      const limit = filters?.limit || 20;
      // A fresh random sort seed makes page 1 a random sample; the page's own count drives paging.
      const page = filters?.offset ? Math.floor(filters.offset / limit) + 1 : 1;

      const sortSeed = filters?.sortSeed || generateRandomSortSeed();
      const filter: FindFilterInput = { per_page: limit, page, sort: sortSeed };
      const sceneFilter = this.filters.buildShuffleSceneFilter(filters);
      const { scenes, count: totalCount } = await this.fetchScenesQuery(filter, sceneFilter, signal);

      if (this.io.isAborted(signal)) return { markers: [], sortSeed, totalCount: 0 };

      return { markers: this.createSyntheticMarkers(scenes, 'synthetic', limit), sortSeed, totalCount };
    } catch (error: unknown) {
      const emptyResult = { markers: [] as SceneMarker[], sortSeed: generateRandomSortSeed(), totalCount: 0 };
      return this.io.handleError('fetchScenesForShuffle', error, signal, emptyResult);
    }
  }

  /**
   * Fetch scenes query (shared by shuffle mode and short-form content)
   */
  private async fetchScenesQuery(
    filter: FindFilterInput,
    sceneFilter: SceneFilterInput | null,
    signal?: AbortSignal
  ): Promise<{ scenes: Scene[]; count: number }> {
    const result = await this.gqlClient.query<FindScenesResponse>({
      query: queries.FIND_SCENES,
      variables: { filter, ...(sceneFilter && { scene_filter: sceneFilter }) },
      signal,
    });
    
    if (this.io.isAborted(signal)) return { scenes: [], count: 0 };
    
    return { scenes: result.data?.findScenes?.scenes || [], count: result.data?.findScenes?.count ?? 0 };
  }

  /**
   * Create synthetic markers from scenes
   * @param scenes Scenes to convert to markers
   * @param idPrefix Prefix for marker IDs (default: 'synthetic')
   */
  private createSyntheticMarkers(scenes: Scene[], idPrefix: string = 'synthetic', limit: number = scenes.length): SceneMarker[] {
    const nonce = Math.random().toString(36).slice(2, 7);
    const perScene = Math.min(4, Math.max(1, Math.ceil((limit || 1) / Math.max(1, scenes.length))));
    const markers: SceneMarker[] = [];
    for (const scene of scenes) {
      for (let i = 0; i < perScene; i++) {
        markers.push({
          id: `${idPrefix}-${scene.id}-${nonce}-${i}`,
          title: scene.title || 'Untitled',
          seconds: this.randomStartTime(scene),
          end_seconds: undefined,
          stream: undefined,
          scene: scene,
          primary_tag: undefined,
          tags: [], // scene tags render via the scene-tag slot (see VideoPost.addTagChips), like short-form
        });
      }
    }
    return markers;
  }

  private randomStartTime(scene: Scene): number {
    const duration = scene.files?.[0]?.duration;
    if (duration && duration > 0) {
      return Math.floor(Math.random() * Math.floor(duration * 0.9));
    }
    return 0;
  }

  /**
   * Fetch short-form videos (videos with duration < maxDuration)
   * @param filters Filter options
   * @param maxDuration Maximum duration in seconds (default: 120)
   * @param limit Maximum number of scenes to return
   * @param offset Offset for pagination
   * @param signal Abort signal
   * @returns Array of synthetic scene markers for short-form content
   */
  async fetchShortFormVideos(
    filters?: FilterOptions,
    maxDuration: number = 120,
    limit: number = 20,
    offset: number = 0,
    signal?: AbortSignal
  ): Promise<{ markers: SceneMarker[]; totalCount: number; unfilteredOffsetConsumed: number; sortSeed: string }> {
    if (this.io.isAborted(signal)) return { markers: [], totalCount: 0, unfilteredOffsetConsumed: 0, sortSeed: generateRandomSortSeed() };

    try {

      
      const sceneFilter = this.filters.buildShortFormSceneFilter(filters, maxDuration);
      
      // Reuse existing sort seed for pagination, or generate new one for first page
      const sortSeed = filters?.sortSeed || generateRandomSortSeed();

      const page = await this.fetchSceneListPage(sceneFilter, offset, sortSeed, signal);
      if (!page || this.io.isAborted(signal)) {
        return { markers: [], totalCount: 0, unfilteredOffsetConsumed: 0, sortSeed: generateRandomSortSeed() };
      }
      const { scenes, totalCount, offsetInPage } = page;
      
      // Filter by duration (GraphQL filter should handle this, but filter client-side as backup)
      const shortFormScenes = this.filters.filterShortFormScenes(scenes, maxDuration);
      
      // Apply offset within page and limit to results
      const limitedScenes = shortFormScenes.slice(offsetInPage, offsetInPage + limit);
      
      const markers = this.createShortFormMarkers(limitedScenes);
      
      // Calculate unfiltered offset consumed: offsetInPage + number of scenes we actually processed
      // Since we slice from offsetInPage and take up to limit, we process at most offsetInPage + limit scenes
      const unfilteredOffsetConsumed = offsetInPage + limitedScenes.length;
      
      return { markers, totalCount, unfilteredOffsetConsumed, sortSeed };
    } catch (error: unknown) {
      return this.io.handleError('fetchShortFormVideos', error, signal, { markers: [], totalCount: 0, unfilteredOffsetConsumed: 0, sortSeed: generateRandomSortSeed() });
    }
  }

  /**
   * One page of a short-form/scene-preview scene list. The total comes back with the page itself;
   * an offset past the (capped) end is clamped to the last page. Null when there are no scenes.
   */
  private async fetchSceneListPage(
    sceneFilter: SceneFilterInput | null,
    offset: number,
    sortSeed: string,
    signal?: AbortSignal
  ): Promise<{ scenes: Scene[]; totalCount: number; offsetInPage: number } | null> {
    const perPage = StashAPI.SHORT_FORM_SCENES_PER_PAGE;
    const wantedPage = Math.floor(offset / perPage) + 1;
    const query = (page: number) => this.fetchScenesQuery({ per_page: perPage, page, sort: sortSeed }, sceneFilter, signal);

    let { scenes, count } = await query(wantedPage);
    if (this.io.isAborted(signal)) return null;

    const totalCount = Math.min(count, this._maxContentLimit);
    if (totalCount === 0) return null;

    const maxPage = Math.max(1, Math.ceil(totalCount / perPage));
    if (wantedPage > maxPage) {
      ({ scenes } = await query(maxPage));
      if (this.io.isAborted(signal)) return null;
    }
    return { scenes, totalCount, offsetInPage: offset % perPage };
  }


  /**
   * Create synthetic markers for short-form content
   * These play from start to end (seconds: 0, no end_seconds)
   */
  private createShortFormMarkers(scenes: Scene[]): SceneMarker[] {
    const nonce = Math.random().toString(36).slice(2, 7);
    return scenes.map((scene, i) => ({
      id: `shortform-${scene.id}-${nonce}-${i}`,
      title: scene.title || 'Untitled',
      seconds: 0,
      end_seconds: undefined,
      stream: undefined,
      scene,
      primary_tag: undefined,
      tags: [],
    }));
  }

  /**
   * Create synthetic markers for scene-preview content, sourced from each scene's
   * generated hover-preview clip. Play from start to end (seconds: 0, no end_seconds).
   * Scenes without a generated preview are dropped.
   */
  private createScenePreviewMarkers(scenes: Scene[]): SceneMarker[] {
    // Uses crypto.getRandomValues (not Math.random) purely to keep SonarQube's insecure-PRNG
    // rule quiet — this nonce only disambiguates DOM/marker IDs, no security property needed.
    const nonce = crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 5);
    return scenes
      .filter((scene) => !!scene.paths?.preview)
      .map((scene, i) => ({
        id: `scenepreview-${scene.id}-${nonce}-${i}`,
        title: scene.title || 'Untitled',
        seconds: 0,
        end_seconds: undefined,
        stream: scene.paths?.preview,
        scene,
        primary_tag: undefined,
        tags: [],
      }));
  }

  /**
   * Fetch scene-preview clips (each scene's generated hover-preview mp4)
   * @param filters Filter options
   * @param limit Maximum number of scenes to return
   * @param offset Offset for pagination
   * @param signal Abort signal
   * @returns Array of synthetic scene markers for scene-preview content
   */
  async fetchScenePreviews(
    filters?: FilterOptions,
    limit: number = 20,
    offset: number = 0,
    signal?: AbortSignal
  ): Promise<{ markers: SceneMarker[]; totalCount: number; unfilteredOffsetConsumed: number; sortSeed: string }> {
    if (this.io.isAborted(signal)) return { markers: [], totalCount: 0, unfilteredOffsetConsumed: 0, sortSeed: generateRandomSortSeed() };

    try {

      const sceneFilter = this.filters.buildScenePreviewFilter(filters);

      const sortSeed = filters?.sortSeed || generateRandomSortSeed();

      const page = await this.fetchSceneListPage(sceneFilter, offset, sortSeed, signal);
      if (!page || this.io.isAborted(signal)) {
        return { markers: [], totalCount: 0, unfilteredOffsetConsumed: 0, sortSeed: generateRandomSortSeed() };
      }
      const { scenes, totalCount, offsetInPage } = page;

      // Drop scenes without a generated preview (client-side backup filter)
      const previewableScenes = scenes.filter((scene) => !!scene.paths?.preview);

      const limitedScenes = previewableScenes.slice(offsetInPage, offsetInPage + limit);

      const markers = this.createScenePreviewMarkers(limitedScenes);

      const unfilteredOffsetConsumed = offsetInPage + limitedScenes.length;

      return { markers, totalCount, unfilteredOffsetConsumed, sortSeed };
    } catch (error: unknown) {
      return this.io.handleError('fetchScenePreviews', error, signal, { markers: [], totalCount: 0, unfilteredOffsetConsumed: 0, sortSeed: generateRandomSortSeed() });
    }
  }

  // ---- media URLs (see api/MediaUrls.ts) ----

  private readonly media: MediaUrls;

  getMarkerVideoUrl(marker: SceneMarker): string | undefined {
    return this.media.getMarkerVideoUrl(marker);
  }

  getVideoUrl(scene: Scene): string | undefined {
    return this.media.getVideoUrl(scene);
  }

  getSceneSources(scene: Scene): VideoSource[] {
    return this.media.getSceneSources(scene);
  }

  /**
   * Find a tag by name
   */
  /** Resolved tags by lowercase name — callers re-resolve the same few tags (favorite, bookmark, excluded) on every load. Misses aren't cached (the tag may be created later). */
  private readonly _tagByName = new TtlCache<{ id: string; name: string } | null>(Number.POSITIVE_INFINITY, 200);

  async findTagByName(tagName: string, signal?: AbortSignal): Promise<{ id: string; name: string } | null> {
    if (this.io.isAborted(signal)) return null;
    try {
      // The shared lookup carries no caller signal (tiny query; one caller aborting must not fail the rest).
      const tag = await this._tagByName.getOrLoad(tagName.toLowerCase(), () => this.queryTagByName(tagName), (t) => t !== null);
      return this.io.isAborted(signal) ? null : tag;
    } catch (error: unknown) {
      return this.io.rethrowUnlessAbort('findTagByName', error, signal, null);
    }
  }

  private async queryTagByName(tagName: string): Promise<{ id: string; name: string } | null> {
    // Use findTags (plural) instead of findTag (singular) as it's more widely supported
    const result = await this.gqlClient.query<FindTagsResponse>({
      query: queries.FIND_TAGS,
      variables: {
        filter: { per_page: 1, page: 1 },
        tag_filter: { name: { value: tagName, modifier: 'EQUALS' } },
      },
    });
    const tag = result.data?.findTags?.tags?.[0];
    if (!tag) return null;
    // Validate exact match (case-insensitive) - EQUALS modifier might not work as expected
    if (tag.name.toLowerCase() !== tagName.toLowerCase()) {
      this.io.logError('findTagByName', new Error(`Tag name mismatch: searched="${tagName}", found="${tag.name}"`));
      return null;
    }
    return tag;
  }

  /**
   * Create a new tag
   * If the tag already exists, attempts to find and return it
   */
  async createTag(tagName: string, signal?: AbortSignal): Promise<{ id: string; name: string } | null> {
    if (this.io.isAborted(signal)) return null;
    
    const variables: { input: TagCreateInput } = {
      input: { name: tagName }
    };

    try {
      const result = await this.gqlClient.mutate<TagCreateResponse>({
        mutation: mutations.TAG_CREATE,
        variables,
        signal,
      });
      
      if (this.io.isAborted(signal)) return null;
      
      return result.data?.tagCreate || null;
    } catch (error: unknown) {
      if (isAbortError(error) || this.io.isAborted(signal)) {
        return null;
      }
      
      // If tag already exists, try to find it
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('already exists') || errorMessage.includes('duplicate')) {
        this.io.logError('createTag', new Error(`Tag "${tagName}" already exists, attempting to find it`));
        // Try to find the existing tag
        const existingTag = await this.findTagByName(tagName, signal);
        if (existingTag) {
          return existingTag;
        }
      }
      this.io.logError('createTag', error);
      return null;
    }
  }

  /** Tags this plugin owns (favorite, bookmark, marker), resolved once per session. */
  private readonly _ensuredTags = new TtlCache<{ id: string; name: string } | null>(Number.POSITIVE_INFINITY, 20);

  /** Find the tag by name, creating it if missing. Concurrent callers share one lookup; failures throw and aren't remembered. */
  ensureTag(tagName: string): Promise<{ id: string; name: string } | null> {
    return this._ensuredTags.getOrLoad(
      tagName.toLowerCase(),
      async () => (await this.findTagByName(tagName)) ?? (await this.createTag(tagName)),
      (tag) => tag !== null,
    );
  }

  /**
   * Check if a scene marker has a specific tag
   * Uses the marker's existing tags array
   */
  async markerHasTag(marker: { id: string; tags?: Array<{ id: string }> }, tagId: string): Promise<boolean> {
    return marker.tags?.some(tag => tag.id === tagId) ?? false;
  }

  /**
   * Check if a scene has a specific tag
   * @param sceneId Scene ID
   * @param tagId Tag ID to check
   * @param tags Optional array of tags to check against (avoids query if provided)
   * @param signal Optional abort signal
   * @returns True if scene has the tag
   */
  async sceneHasTag(sceneId: string, tagId: string, tags?: Array<{ id: string }>, signal?: AbortSignal): Promise<boolean> {
    if (this.io.isAborted(signal)) return false;
    
    // If tags array is provided, use it directly (more efficient)
    if (tags) {
      return tags.some((tag) => tag.id === tagId);
    }
    
    try {
      const sceneTagIds = await this.getSceneTagIdSet(sceneId);
      if (this.io.isAborted(signal)) return false;
      return sceneTagIds.has(tagId);
    } catch (error: unknown) {
      return this.io.rethrowUnlessAbort('sceneHasTag', error, signal, false);
    }
  }

  /** Scene tag ids fetched so far, so repeat checks and toggles don't re-query. */
  private readonly _sceneTagIds = new TtlCache<Set<string>>(60_000, 1000);

  /** Per-post checks made while a page renders coalesce into one findScenes(ids: [...]) instead of one findScene each. */
  private readonly _sceneTagBatcher = new Batcher<string, Set<string>>(
    10,
    async (ids) => {
      const result = await this.gqlClient.query<{ findScenes?: { scenes?: Array<{ id: string; tags?: Array<{ id: string }> }> } }>({
        query: queries.FIND_SCENES_TAG_IDS,
        variables: { ids, filter: { per_page: -1 } },
      });
      return new Map((result.data?.findScenes?.scenes ?? []).map((scene) => [scene.id, new Set((scene.tags ?? []).map((t) => t.id))]));
    },
    () => new Set<string>(),
  );

  private getSceneTagIdSet(sceneId: string): Promise<Set<string>> {
    return this._sceneTagIds.getOrLoad(sceneId, () => this._sceneTagBatcher.load(sceneId));
  }

  /**
   * Update tags on a scene marker
   */
  private async updateMarkerTags(
    marker: MarkerTagUpdateData,
    newTagIds: string[],
    signal?: AbortSignal
  ): Promise<void> {
    if (this.io.isAborted(signal)) return;
    
    // Ensure we have required fields
    if (!marker.primary_tag?.id) {
      throw new Error('Marker must have a primary_tag');
    }

    await this.updateMarkerTagsWithPrimary(marker, marker.primary_tag.id, newTagIds, signal);
  }

  async updateMarkerTagsWithPrimary(
    marker: Pick<MarkerTagUpdateData, 'id' | 'title' | 'seconds' | 'end_seconds' | 'scene'>,
    primaryTagId: string,
    tagIds: string[],
    signal?: AbortSignal
  ): Promise<void> {
    if (this.io.isAborted(signal)) return;

    const variables: SceneMarkerUpdateInput = {
      id: marker.id,
      title: marker.title,
      seconds: marker.seconds,
      end_seconds: marker.end_seconds ?? null,
      scene_id: marker.scene.id,
      primary_tag_id: primaryTagId,
      tag_ids: tagIds
    };

    await this.gqlClient.mutate<SceneMarkerUpdateResponse>({
      mutation: mutations.SCENE_MARKER_UPDATE,
      variables: variables as unknown as Record<string, unknown>,
      signal,
    });
    
    if (this.io.isAborted(signal)) return;
  }

  /**
   * Add a tag to a scene marker
   * Requires full marker data to include all required fields in the mutation
   */
  private extractMarkerTagIds(marker: MarkerTagUpdateData): string[] {
    return (marker.tags || []).map(t => t.id);
  }

  async addTagToMarker(
    marker: MarkerTagUpdateData,
    tagId: string,
    signal?: AbortSignal
  ): Promise<void> {
    if (this.io.isAborted(signal)) return;

    try {
      const currentTags = this.extractMarkerTagIds(marker);

      // Add the new tag if not already present
      if (!currentTags.includes(tagId)) {
        await this.updateMarkerTags(marker, [...currentTags, tagId], signal);
      }
    } catch (error) {
      if (isAbortError(error) || this.io.isAborted(signal)) {
        return;
      }
      this.io.logError('addTagToMarker', error);
      throw error;
    }
  }

  private async updateImageField(
    imageId: string,
    field: 'tag_ids' | 'performer_ids',
    ids: string[],
    signal: AbortSignal | undefined,
    logContext: string
  ): Promise<void> {
    if (this.io.isAborted(signal)) return;

    try {
      await this.gqlClient.mutate<ImageUpdateResponse>({
        mutation: mutations.IMAGE_UPDATE,
        variables: {
          input: {
            id: imageId,
            [field]: ids,
          },
        },
        signal,
      });

      if (this.io.isAborted(signal)) return;
    } catch (error) {
      if (isAbortError(error) || this.io.isAborted(signal)) {
        return;
      }
      this.io.logError(logContext, error);
      throw error;
    }
  }

  /**
   * Update tags for an image
   */
  async updateImageTags(imageId: string, tagIds: string[], signal?: AbortSignal): Promise<void> {
    return this.updateImageField(imageId, 'tag_ids', tagIds, signal, 'updateImageTags');
  }

  /**
   * Update performers for an image
   */
  async updateImagePerformers(imageId: string, performerIds: string[], signal?: AbortSignal): Promise<void> {
    return this.updateImageField(imageId, 'performer_ids', performerIds, signal, 'updateImagePerformers');
  }

  /**
   * Increment image o-counter
   */
  async incrementImageOCount(imageId: string, signal?: AbortSignal): Promise<number> {
    if (this.io.isAborted(signal)) return 0;
    
    try {
      const result = await this.gqlClient.mutate<ImageIncrementOResponse>({
        mutation: mutations.IMAGE_INCREMENT_O,
        variables: {
          id: imageId,
        },
        signal,
      });
      
      if (this.io.isAborted(signal)) return 0;
      
      return result.data?.imageIncrementO ?? 0;
    } catch (error) {
      if (isAbortError(error) || this.io.isAborted(signal)) {
        return 0;
      }
      this.io.logError('incrementImageOCount', error);
      throw error;
    }
  }

  /**
   * Update performers on a scene
   */
  async updateScenePerformers(sceneId: string, performerIds: string[], signal?: AbortSignal): Promise<void> {
    if (this.io.isAborted(signal)) return;

    const variables = {
      input: {
        id: sceneId,
        performer_ids: performerIds
      }
    };

    await this.gqlClient.mutate<SceneUpdateResponse>({
      mutation: mutations.SCENE_UPDATE,
      variables,
      signal,
    });

    if (this.io.isAborted(signal)) return;
  }

  /**
   * Update performer favorite flag
   */
  async updatePerformerFavorite(performerId: string, favorite: boolean, signal?: AbortSignal): Promise<void> {
    if (this.io.isAborted(signal)) return;

    const variables = {
      input: {
        id: performerId,
        favorite,
      }
    };

    await this.gqlClient.mutate({
      mutation: mutations.PERFORMER_UPDATE,
      variables,
      signal,
    });

    if (this.io.isAborted(signal)) return;
  }

  /**
   * Add or remove one tag on a scene in a single server-side mutation (no read-modify-write,
   * so concurrent toggles can't clobber each other's tag list). The response carries the
   * scene's resulting tags, which refresh the local cache.
   */
  private async bulkModifySceneTag(
    methodName: string,
    sceneId: string,
    tagId: string,
    mode: 'ADD' | 'REMOVE',
    signal?: AbortSignal
  ): Promise<void> {
    if (this.io.isAborted(signal)) return;
    try {
      const result = await this.gqlClient.mutate<{ bulkSceneUpdate?: Array<{ id: string; tags?: Array<{ id: string }> }> }>({
        mutation: mutations.BULK_SCENE_UPDATE,
        variables: { input: { ids: [sceneId], tag_ids: { ids: [tagId], mode } } },
        signal,
      });
      const updated = result.data?.bulkSceneUpdate?.find((sc) => sc.id === sceneId);
      if (updated?.tags) {
        this._sceneTagIds.set(sceneId, new Set(updated.tags.map((t) => t.id)));
      } else {
        this._sceneTagIds.delete(sceneId);
      }
    } catch (error) {
      if (isAbortError(error) || this.io.isAborted(signal)) return;
      this.io.logError(methodName, error);
      throw error;
    }
  }

  /**
   * Add a tag to a scene
   */
  async addTagToScene(sceneId: string, tagId: string, signal?: AbortSignal): Promise<void> {
    await this.bulkModifySceneTag('addTagToScene', sceneId, tagId, 'ADD', signal);
  }

  /**
   * Remove a tag from a scene marker
   * Requires full marker data to include all required fields in the mutation
   */
  async removeTagFromMarker(
    marker: MarkerTagUpdateData,
    tagId: string,
    signal?: AbortSignal
  ): Promise<void> {
    if (this.io.isAborted(signal)) return;

    try {
      const currentTags = this.extractMarkerTagIds(marker);
      const tagIds = currentTags.filter(id => id !== tagId);
      await this.updateMarkerTags(marker, tagIds, signal);
    } catch (error) {
      if (isAbortError(error) || this.io.isAborted(signal)) return;
      this.io.logError('removeTagFromMarker', error);
      throw error;
    }
  }

  /**
   * Remove a tag from a scene
   */
  async removeTagFromScene(sceneId: string, tagId: string, signal?: AbortSignal): Promise<void> {
    await this.bulkModifySceneTag('removeTagFromScene', sceneId, tagId, 'REMOVE', signal);
  }

  /**
   * Increment the o count for a scene
   * @param sceneId The scene ID
   * @param times Optional array of timestamps (if not provided, uses current time)
   * @param signal Optional abort signal
   * @returns The updated o count and history
   */
  async incrementOCount(sceneId: string, times?: string[], signal?: AbortSignal): Promise<{ count: number; history: string[] }> {
    if (this.io.isAborted(signal)) return { count: 0, history: [] };
    
    const variables = {
      id: sceneId,
      times: times || undefined
    };

    try {
      const result = await this.gqlClient.mutate<SceneAddOResponse>({
        mutation: mutations.SCENE_ADD_O,
        variables,
        signal,
      });
      
      if (this.io.isAborted(signal)) return { count: 0, history: [] };
      
      const sceneAddO = result.data?.sceneAddO;
      if (sceneAddO && 'count' in sceneAddO) {
        return { count: sceneAddO.count ?? 0, history: times || [] };
      }
      // Return provided times in history even when count is missing
      return { count: 0, history: times || [] };
    } catch (error) {
      if (isAbortError(error) || this.io.isAborted(signal)) {
        return { count: 0, history: [] };
      }
      this.io.logError('incrementOCount', error);
      throw error;
    }
  }

  /**
   * Increment the play count for a scene. Fire-and-forget — never throws.
   */
  // fallow-ignore-next-line unused-class-member
  async incrementScenePlayCount(sceneId: string): Promise<void> {
    if (!sceneId) return;
    try {
      await this.gqlClient.mutate<SceneIncrementPlayCountResponse>({
        mutation: mutations.SCENE_INCREMENT_PLAY_COUNT,
        variables: { id: sceneId },
      });
    } catch (error) {
      this.io.logError('incrementScenePlayCount', error);
    }
  }

  /**
   * Save scene watch activity. Fire-and-forget — never throws.
   * @param resumeTime Current playback position in the scene (seconds), or undefined
   * @param playDuration Seconds watched in this session
   */
  // fallow-ignore-next-line unused-class-member
  async saveSceneActivity(sceneId: string, resumeTime: number | undefined, playDuration: number): Promise<void> {
    if (!sceneId || playDuration <= 0) return;
    try {
      await this.gqlClient.mutate<SceneSaveActivityResponse>({
        mutation: mutations.SCENE_SAVE_ACTIVITY,
        variables: { id: sceneId, resume_time: resumeTime, playDuration },
      });
    } catch (error) {
      this.io.logError('saveSceneActivity', error);
    }
  }

  /**
   * Validate and normalize a rating10 value to rating100
   */
  private validateAndNormalizeRating(methodName: string, entityId: string, rating10: number): number {
    if (!entityId || typeof entityId !== 'string' || entityId.trim() === '') {
      throw new Error(`${methodName}: entityId is required and must be a non-empty string`);
    }
    if (typeof rating10 !== 'number' || !Number.isFinite(rating10)) {
      throw new TypeError(`${methodName}: rating10 must be a finite number`);
    }
    const normalized = Number.isFinite(rating10) ? rating10 : 0;
    const clamped = Math.min(10, Math.max(0, normalized));
    return Math.round(clamped * 10);
  }

  /**
   * Perform a rating mutation (shared by scene and image rating updates)
   */
  private async performRatingMutation<T>(
    methodName: string,
    entityId: string,
    rating100: number,
    mutation: string,
    signal?: AbortSignal
  ): Promise<number> {
    if (this.io.isAborted(signal)) return 0;

    try {
      await this.gqlClient.mutate<T>({
        mutation,
        variables: { input: { id: entityId, rating100 } },
        signal,
      });

      if (this.io.isAborted(signal)) return 0;
      return rating100;
    } catch (error) {
      if (isAbortError(error) || this.io.isAborted(signal)) {
        return 0;
      }
      this.io.logError(methodName, error);
      throw error;
    }
  }

  /**
   * Update the rating for a scene (0-10 scale → rating100)
   */
  async updateSceneRating(sceneId: string, rating10: number, signal?: AbortSignal): Promise<number> {
    const rating100 = this.validateAndNormalizeRating('updateSceneRating', sceneId, rating10);
    return this.performRatingMutation<SceneUpdateResponse>('updateSceneRating', sceneId, rating100, mutations.SCENE_UPDATE, signal);
  }

  /**
   * Update image rating (0-10 scale → rating100)
   */
  async updateImageRating(imageId: string, rating10: number, signal?: AbortSignal): Promise<number> {
    const rating100 = this.validateAndNormalizeRating('updateImageRating', imageId, rating10);
    return this.performRatingMutation<{ imageUpdate: { id: string } }>('updateImageRating', imageId, rating100, mutations.IMAGE_UPDATE, signal);
  }

  /**
   * Find tags for selection (used in marker creation autocomplete)
   * @param searchTerm Search term for tag name
   * @param limit Maximum number of results
   * @param signal Optional abort signal
   * @returns Array of tags with id, name, and other fields
   */
  async findTagsForSelect(searchTerm: string = '', limit: number = 200, signal?: AbortSignal): Promise<Array<{ id: string; name: string; sort_name?: string; favorite?: boolean; description?: string; aliases?: string[]; image_path?: string; parents?: Array<{ id: string; name: string }> }>> {
    const variables = {
      filter: {
        q: searchTerm,
        sort: 'name',
        direction: 'ASC' as const,
        page: 1,
        per_page: limit,
      },
      tag_filter: {} as TagFilterInput,
      ids: null as string[] | null,
    };

    try {
      const result = await this.gqlClient.query<FindTagsExtendedResponse>({
        query: queries.FIND_TAGS_FOR_SELECT,
        variables,
        signal,
      });
      if (this.io.isAborted(signal)) {
        return [];
      }
      return result.data?.findTags?.tags || [];
    } catch (error: unknown) {
      if (isAbortError(error) || this.io.isAborted(signal)) {
        return [];
      }
      this.io.logError('findTagsForSelect', error);
      throw error;
    }
  }

  /**
   * Find all galleries (for gallery selector in settings)
   * @param signal Optional abort signal
   * @returns Array of galleries with id, title, and folder path
   */
  async findGalleries(signal?: AbortSignal): Promise<Gallery[]> {
    if (this.io.isAborted(signal)) return [];
    try {
      const result = await this.gqlClient.query<FindGalleriesResponse>({
        query: queries.FIND_GALLERIES,
        variables: { filter: { per_page: -1, sort: 'title', direction: 'ASC' } },
        signal,
      });
      if (this.io.isAborted(signal)) return [];
      return result.data?.findGalleries?.galleries ?? [];
    } catch (error: unknown) {
      if (isAbortError(error) || this.io.isAborted(signal)) return [];
      this.io.logError('findGalleries', error);
      return [];
    }
  }

  /**
   * Create a new scene marker
   * @param sceneId Scene ID
   * @param seconds Start time in seconds
   * @param primaryTagId Primary tag ID (required)
   * @param title Optional title (defaults to empty string)
   * @param endSeconds Optional end time in seconds
   * @param tagIds Optional array of additional tag IDs
   * @param signal Optional abort signal
   * @returns Created marker data
   */
  /**
   * Validate createSceneMarker input parameters
   */
  private validateCreateSceneMarkerInput(
    sceneId: string,
    seconds: number,
    primaryTagId: string,
    endSeconds: number | null | undefined,
    tagIds: string[]
  ): void {
    if (!sceneId || typeof sceneId !== 'string' || sceneId.trim() === '') {
      throw new Error('createSceneMarker: sceneId is required and must be a non-empty string');
    }
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
      throw new TypeError('createSceneMarker: seconds must be a non-negative number');
    }
    if (!primaryTagId || typeof primaryTagId !== 'string' || primaryTagId.trim() === '') {
      throw new Error('createSceneMarker: primaryTagId is required and must be a non-empty string');
    }
    if (endSeconds !== null && endSeconds !== undefined) {
      if (typeof endSeconds !== 'number' || !Number.isFinite(endSeconds) || endSeconds < 0) {
        throw new TypeError('createSceneMarker: endSeconds must be a non-negative number or null');
      }
      if (endSeconds < seconds) {
        throw new Error('createSceneMarker: endSeconds must be greater than or equal to seconds');
      }
    }
    if (!Array.isArray(tagIds)) {
      throw new TypeError('createSceneMarker: tagIds must be an array');
    }
  }

  async createSceneMarker(
    sceneId: string,
    seconds: number,
    primaryTagId: string,
    title: string = '',
    endSeconds?: number | null,
    tagIds: string[] = [],
    signal?: AbortSignal
  ): Promise<{ id: string; title: string; seconds: number; end_seconds?: number; stream?: string; preview?: string; scene: { id: string; title?: string; files?: Array<{ width?: number; height?: number; path?: string }>; performers?: Array<{ id: string; name: string; image_path?: string }> } | Scene; primary_tag: { id: string; name: string }; tags: Array<{ id: string; name: string }> }> {
    if (this.io.isAborted(signal)) {
      throw new Error('Operation aborted');
    }
    
    // Input validation
    this.validateCreateSceneMarkerInput(sceneId, seconds, primaryTagId, endSeconds, tagIds);
    
    const variables = {
      title,
      seconds,
      end_seconds: endSeconds ?? null,
      scene_id: sceneId,
      primary_tag_id: primaryTagId,
      tag_ids: tagIds,
    };

    try {
      const result = await this.gqlClient.mutate<SceneMarkerCreateResponse>({
        mutation: mutations.SCENE_MARKER_CREATE,
        variables,
        signal,
      });
      
      if (this.io.isAborted(signal)) {
        throw new Error('Operation aborted');
      }
      
      const marker = result.data?.sceneMarkerCreate;
      if (!marker) {
        throw new Error('Failed to create scene marker: response was null');
      }
      // Convert null end_seconds to undefined to match return type
      return {
        ...marker,
        end_seconds: marker.end_seconds ?? undefined,
      };
    } catch (error) {
      if (isAbortError(error) || this.io.isAborted(signal)) {
        throw new Error('Operation aborted');
      }
      this.io.logError('createSceneMarker', error);
      throw error;
    }
  }

  /**
   * Find images with filtering by file extension, performers, and tags
   * @param fileExtensions Array of file extensions (e.g., ['.gif', '.webm'])
   * @param filters Optional filters for performers, tags, and orientation
   * @param limit Maximum number of images to return
   * @param offset Offset for pagination
   * @param signal AbortSignal for cancellation
   */
  async findImages(
    fileExtensions: string[],
    filters?: ImageFilterOptions,
    limit: number = 40,
    offset: number = 0,
    signal?: AbortSignal
  ): Promise<{ images: GQLImage[]; totalCount: number; sortSeed: string }> {
    if (this.io.isAborted(signal)) return { images: [], totalCount: 0, sortSeed: generateRandomSortSeed() };

    // Input validation
    if (!Array.isArray(fileExtensions)) {
      throw new TypeError('findImages: fileExtensions must be an array');
    }
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1) {
      throw new TypeError('findImages: limit must be a positive number');
    }
    if (typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0) {
      throw new TypeError('findImages: offset must be a non-negative number');
    }

    // Build regex pattern from file extensions
    const regexPattern = this.filters.buildPathRegex(fileExtensions);
    const savedFilterCriteria = await this.getSavedFilterCriteria(filters, signal);
    if (this.io.isAborted(signal)) return { images: [], totalCount: 0, sortSeed: generateRandomSortSeed() };
    const imageFilter = this.filters.buildImageFilter(regexPattern, filters, savedFilterCriteria);

    // Reuse existing sort seed for pagination, or generate new one for first page
    const sortSeed = filters?.sortSeed || generateRandomSortSeed();
    
    const findFilter: FindFilterInput = {
      ...this.filters.mergeSavedFilterAndQuery({}, undefined, savedFilterCriteria),
      per_page: limit,
      page: Math.floor(offset / limit) + 1,
      sort: sortSeed,
      direction: 'DESC',
    };

    const variables = {
      filter: findFilter,
      image_filter: imageFilter,
      image_ids: null as number[] | null,
    };

    try {
      const result = await this.gqlClient.query<FindImagesResponse>({
        query: queries.FIND_IMAGES,
        variables,
        signal,
      });

      if (this.io.isAborted(signal)) return { images: [], totalCount: 0, sortSeed: generateRandomSortSeed() };

      const images = result.data?.findImages?.images || [];
      const totalCount = Math.min(result.data?.findImages?.count ?? 0, this._maxContentLimit);

      return { images, totalCount, sortSeed };
    } catch (e: unknown) {
      if (isAbortError(e) || this.io.isAborted(signal)) {
        return { images: [], totalCount: 0, sortSeed: generateRandomSortSeed() };
      }
      return this.io.handleError('findImages', e, signal, { images: [], totalCount: 0, sortSeed: generateRandomSortSeed() });
    }
  }

  /** ui + plugin configuration share one request; callers within a few seconds reuse it. */
  private readonly _configuration = new TtlCache<ConfigurationResponse['configuration']>(5_000, 1);

  private getConfiguration(): Promise<ConfigurationResponse['configuration']> {
    return this._configuration.getOrLoad('configuration', async () => {
      const result = await this.gqlClient.query<ConfigurationResponse>({ query: queries.GET_CONFIGURATION });
      return result.data?.configuration ?? {};
    });
  }

  /**
   * Get the rating system options from the UI configuration
   */
  async getUIConfiguration(signal?: AbortSignal): Promise<{ type?: string; starPrecision?: string } | null> {
    if (this.io.isAborted(signal)) return null;

    try {
      const { ui } = await this.getConfiguration();
      if (this.io.isAborted(signal)) return null;

      // UI is returned as a JSON string in some Stash versions
      if (typeof ui === 'string') {
        try {
          return (JSON.parse(ui) as { ratingSystemOptions?: { type?: string; starPrecision?: string } }).ratingSystemOptions || null;
        } catch {
          return null;
        }
      }
      return ui?.ratingSystemOptions || null;
    } catch (error) {
      return this.io.handleError('getUIConfiguration', error, signal, null);
    }
  }

  /**
   * Get plugin-specific settings from Stash server. Resolves null when the server has none;
   * a failed request throws so callers don't mistake it for "no settings".
   */
  async getPluginSettings(pluginId: string, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
    if (this.io.isAborted(signal)) return null;

    try {
      const { plugins } = await this.getConfiguration();
      if (this.io.isAborted(signal)) return null;
      const pluginConfig = plugins && typeof plugins === 'object' ? plugins[pluginId] : undefined;
      return pluginConfig && typeof pluginConfig === 'object' ? pluginConfig : null;
    } catch (error) {
      return this.io.rethrowUnlessAbort('getPluginSettings', error, signal, null);
    }
  }

  /**
   * Save plugin-specific settings to Stash server
   */
  async savePluginSettings(pluginId: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<boolean> {
    if (this.io.isAborted(signal)) return false;

    try {
      await this.gqlClient.mutate<ConfigurePluginResponse>({
        mutation: mutations.CONFIGURE_PLUGIN,
        variables: { plugin_id: pluginId, input },
        signal,
      });
      this._configuration.clear();
      return true;
    } catch (error) {
      this.io.handleError('savePluginSettings', error, signal, false);
      return false;
    }
  }

  /** stash-box scene id -> local scene id (null = not in library). Misses are cached too: they're the common case. */
  private readonly _localSceneIds = new TtlCache<string | null>(5 * 60_000, 1000);

  /**
   * Resolve many stash-box scenes to local scene ids in at most two requests (stash_id lookups,
   * then URL lookups for the misses), instead of one or two requests per scene.
   */
  async findLocalSceneIdsByStashDbIds(
    items: Array<{ stashId: string; sceneUrl?: string }>,
    signal?: AbortSignal
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (this.io.isAborted(signal)) return out;

    const todo = new Map<string, string | undefined>();
    for (const { stashId, sceneUrl } of items) {
      if (!this._localSceneIds.has(stashId)) todo.set(stashId, sceneUrl);
    }

    if (todo.size > 0) {
      // One shared lookup for everything missing; each id's cache entry resolves from it.
      // No caller signal: the entries are shared with other callers.
      const lookup = this.lookupLocalSceneIds(todo);
      for (const stashId of todo.keys()) {
        this._localSceneIds.set(stashId, lookup.then((found) => found.get(stashId) ?? null));
      }
    }

    try {
      await Promise.all(items.map(async ({ stashId }) => {
        const localId = await this._localSceneIds.peek(stashId);
        if (localId) out.set(stashId, localId);
      }));
    } catch (error: unknown) {
      this.io.handleError('findLocalSceneIdsByStashDbIds', error, signal, null);
    }
    return out;
  }

  private async lookupLocalSceneIds(todo: Map<string, string | undefined>): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    const stashIds = [...todo.keys()];
    // Stash matches stash_id regardless of endpoint; URL lookup covers scenes added without a stash_id link.
    const byStashId = await this.lookupSceneIds(
      stashIds.map((stashId) => ({ stash_id_endpoint: { stash_id: stashId, modifier: 'EQUALS' } }))
    );
    const misses: string[] = [];
    stashIds.forEach((stashId, i) => {
      const localId = byStashId[i];
      if (localId) found.set(stashId, localId);
      else if (todo.get(stashId)) misses.push(stashId);
    });
    if (misses.length > 0) {
      const byUrl = await this.lookupSceneIds(
        misses.map((stashId) => ({ url: { modifier: 'EQUALS', value: todo.get(stashId) } }))
      );
      misses.forEach((stashId, i) => {
        const localId = byUrl[i];
        if (localId) found.set(stashId, localId);
      });
    }
    return found;
  }

  /** First matching scene id (or null) per scene filter, in order, in one request. */
  private async lookupSceneIds(filters: Array<Record<string, unknown>>): Promise<Array<string | null>> {
    const rows = await runAliased(this.io.aliasedExec, 'FindLocalScenes', 'SceneFilterType', filters, {
      s: 'findScenes(scene_filter: $v, filter: { per_page: 1 }) { scenes { id } }',
    });
    return rows.map((row) => (row.s as { scenes: Array<{ id: string }> } | undefined)?.scenes[0]?.id ?? null);
  }

  // fallow-ignore-next-line unused-class-member
  async getStashBoxes(signal?: AbortSignal): Promise<StashBox[]> {
    if (this.io.isAborted(signal)) return [];

    try {
      const result = await this.gqlClient.query<GetStashBoxConfigResponse>({
        query: queries.GET_STASH_BOX_CONFIG,
        signal,
      });

      if (this.io.isAborted(signal)) return [];

      return result.data?.configuration?.general?.stashBoxes ?? [];
    } catch (error: unknown) {
      return this.io.rethrowUnlessAbort('getStashBoxes', error, signal, []);
    }
  }

}
