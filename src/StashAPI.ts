/**
 * Stash API integration
 * This will interface with the Stash GraphQL API
 */

import { Scene, SceneMarker, FilterOptions } from './types.js';
import { isValidMediaUrl } from './utils.js';
import * as queries from './graphql/queries.js';
import * as mutations from './graphql/mutations.js';
import {
  FindFilterInput,
  SceneMarkerFilterInput,
  SceneFilterInput,
  TagFilterInput,
  PerformerFilterInput,
  ImageFilterInput,
  FindSceneMarkersResponse,
  FindScenesResponse,
  FindTagsResponse,
  FindTagsExtendedResponse,
  FindPerformersResponse,
  FindSceneResponse,
  FindImagesResponse,
  GetSavedMarkerFiltersResponse,
  GetSavedFilterResponse,
  CheckTagsHaveMarkersResponse,
  FindSceneMarkerTagsResponse,
  TagCreateResponse,
  SceneMarkerUpdateResponse,
  SceneMarkerCreateResponse,
  SceneUpdateResponse,
  SceneAddOResponse,
  ImageUpdateResponse,
  ImageIncrementOResponse,
  TagCreateInput,
  SceneMarkerUpdateInput,
  TypedGraphQLClient,
  Image,
} from './graphql/types.js';
import {
  GraphQLRequestError,
  GraphQLResponseError,
  GraphQLNetworkError,
  isAbortError,
} from './graphql/errors.js';
import { GraphQLClient } from './graphql/client.js';

interface StashPluginApi {
  GQL: {
    useFindScenesQuery?: (variables: unknown) => { data?: unknown; loading: boolean };
    client?: TypedGraphQLClient;
  };
  baseURL?: string;
  apiKey?: string;
}

/**
 * LRU Cache implementation for tracking access order
 * Uses Map to maintain insertion order (most recently accessed at end)
 */
class LRUCache<K, V> {
  private readonly cache: Map<K, V>;
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  /**
   * Get value from cache and move to end (most recently used)
   */
  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  /**
   * Set value in cache, evicting least recently used if at capacity
   */
  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      // Update existing: remove and re-add to end
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict least recently used (first item in Map)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  /**
   * Check if key exists in cache (without updating access order)
   */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * Delete key from cache
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * Get current size of cache
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear();
  }
}

// Constants for random sorting
const RANDOM_SORT_MULTIPLIER = 1000000;

/**
 * Generate a random sort seed in the format random_<8-digit-number>
 * Example: random_23120320
 */
function generateRandomSortSeed(): string {
  const randomSeed = Math.floor(Math.random() * 100000000).toString().padStart(8, '0');
  return `random_${randomSeed}`;
}

export class StashAPI {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  // Cache for tags/performers that have markers (to avoid repeated checks)
  // Using LRU cache to track access order and intelligently evict least recently used
  private readonly tagsWithMarkersCache: LRUCache<number, boolean>;
  private readonly performersWithMarkersCache: LRUCache<number, boolean>;
  private readonly pluginApi?: StashPluginApi;
  // Centralized GraphQL client
  private readonly gqlClient: GraphQLClient;
  // Simple cache for search results (TTL: 5 minutes)
  private readonly searchCache: Map<string, { data: unknown; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private cacheCleanupInterval?: ReturnType<typeof setInterval>;
  private readonly MAX_CACHE_SIZE = 1000; // Maximum cache entries before cleanup
  private readonly MAX_TAG_CACHE_SIZE = 1000; // Maximum tag/performer cache entries (used for LRU cache)

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
      // Fallback: use current origin (for plugin context)
      this.baseUrl = globalThis.location.origin;
    }
    
    this.apiKey = apiKey || this.pluginApi?.apiKey;
    
    // Initialize GraphQL client
    this.gqlClient = new GraphQLClient({
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      pluginApi: this.pluginApi,
    });
    
    // Initialize LRU caches
    this.tagsWithMarkersCache = new LRUCache(this.MAX_TAG_CACHE_SIZE);
    this.performersWithMarkersCache = new LRUCache(this.MAX_TAG_CACHE_SIZE);
    
    // Start periodic cache cleanup
    this.startCacheCleanup();
  }

  /**
   * Start periodic cache cleanup to prevent memory leaks
   */
  private startCacheCleanup(): void {
    // Clean up every 5 minutes
    this.cacheCleanupInterval = setInterval(() => {
      this.cleanupCache();
    }, 5 * 60 * 1000);
  }

  /**
   * Clean up expired and oversized cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();
    
    // Clean up expired search cache entries
    for (const [key, value] of this.searchCache.entries()) {
      if (now - value.timestamp > this.CACHE_TTL) {
        this.searchCache.delete(key);
      }
    }
    
    // Limit search cache size (LRU: remove oldest entries if over limit)
    if (this.searchCache.size > this.MAX_CACHE_SIZE) {
      const entries = Array.from(this.searchCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toRemove = entries.slice(0, this.searchCache.size - this.MAX_CACHE_SIZE);
      for (const [key] of toRemove) {
        this.searchCache.delete(key);
      }
    }
    
    // LRU caches automatically evict least recently used items when at capacity
    // No manual cleanup needed - LRU handles eviction on set()
    // The cleanup here is just for the search cache which uses TTL
  }

  /**
   * Stop cache cleanup (for cleanup/destroy)
   */
  private stopCacheCleanup(): void {
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
      this.cacheCleanupInterval = undefined;
    }
  }

  /**
   * Normalize a scene_marker_filter coming from a saved filter
   * Ensures fields like tags/scene_tags have numeric ID arrays
   */
  private normalizeMarkerFilter(input: unknown): SceneMarkerFilterInput {
    if (!input || typeof input !== 'object') return {};
    const out: Record<string, unknown> = { ...(input as Record<string, unknown>) };

    const normalizedTags = this.normalizeTagField(out.tags, true);
    if (normalizedTags) {
      out.tags = normalizedTags;
    } else {
      delete out.tags;
    }

    const normalizedSceneTags = this.normalizeTagField(out.scene_tags, true);
    if (normalizedSceneTags) {
      out.scene_tags = normalizedSceneTags;
    } else {
      delete out.scene_tags;
    }

    const normalizedScenePerformers = this.normalizeTagField(out.scene_performers, false);
    if (normalizedScenePerformers) {
      out.scene_performers = normalizedScenePerformers;
    } else {
      delete out.scene_performers;
    }

    return out as SceneMarkerFilterInput;
  }

  /**
   * Normalize a tag field (tags, scene_tags, or scene_performers)
   * @param fieldValue The field value to normalize
   * @param asString Whether to convert IDs to strings (true for tags/scene_tags, false for scene_performers)
   * @returns Normalized field value or undefined if invalid
   */
  private normalizeTagField(fieldValue: unknown, asString: boolean): unknown {
    if (!fieldValue) return undefined;

    const normalizeIdArray = (val: unknown): number[] | undefined => {
      if (!val) return undefined;
      const arr = Array.isArray(val) ? val : [val];
      const ids = arr
        .map((x) => (typeof x === 'object' && x !== null ? ((x as { id?: unknown; value?: unknown }).id ?? (x as { id?: unknown; value?: unknown }).value ?? x) : x))
        .map((x) => Number.parseInt(String(x), 10))
        .filter((n) => !Number.isNaN(n));
      return ids.length > 0 ? ids : undefined;
    };

    type TagsModifier = 'INCLUDES' | 'INCLUDES_ALL' | 'EXCLUDES';

    if (Array.isArray(fieldValue)) {
      const ids = normalizeIdArray(fieldValue);
      if (!ids) return undefined;
      return {
        value: asString ? ids.map(String) : ids.map(Number),
        modifier: 'INCLUDES' as TagsModifier
      };
    }

    if (typeof fieldValue === 'object') {
      const fieldObj = fieldValue as { value?: unknown; modifier?: TagsModifier };
      let raw = fieldObj.value;
      if (raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown[] }).items)) {
        raw = (raw as { items: unknown[] }).items;
      }
      const ids = normalizeIdArray(raw);
      if (!ids) return undefined;
      return {
        value: asString ? ids.map(String) : ids.map(Number),
        modifier: fieldObj.modifier ?? 'INCLUDES'
      };
    }

    return undefined;
  }

  /**
   * Search marker tags (by name) for autocomplete
   * Only returns tags that have more than 10 markers (filtered directly in GraphQL)
   * Includes request deduplication and caching
   */
  async searchMarkerTags(term: string, limit: number = 10, signal?: AbortSignal): Promise<Array<{ id: string; name: string }>> {
    // Skip caching for empty terms to ensure fresh random suggestions
    const isEmptyTerm = !term || term.trim() === '';
    
    // Check cache first (only for non-empty terms)
    if (!isEmptyTerm) {
      const cacheKey = `tags:${term}:${limit}`;
      const cached = this.searchCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return cached.data as Promise<Array<{ id: string; name: string }>>;
      }
    }
    
    // Create new request (deduplication handled by GraphQL client)
    const request = this._searchMarkerTags(term, limit, signal);
    
    try {
      const result = await request;
      // Cache the result (only for non-empty terms)
      if (!isEmptyTerm) {
        const cacheKey = `tags:${term}:${limit}`;
        this.searchCache.set(cacheKey, { data: result, timestamp: Date.now() });
      }
      return result;
    } catch (error: unknown) {
      // Re-throw to maintain error handling
      throw error;
    }
  }
  
  /**
   * Internal implementation of searchMarkerTags
   */
  private async _searchMarkerTags(term: string, limit: number = 10, signal?: AbortSignal): Promise<Array<{ id: string; name: string }>> {
    if (this.isAborted(signal)) return [];

    const hasSearchTerm = term && term.trim() !== '';
    const fetchLimit = hasSearchTerm ? limit * 3 : Math.max(limit, 20);
    
    const filter: FindFilterInput = { 
      per_page: fetchLimit, 
      page: 1,
      ...(hasSearchTerm ? { q: term.trim() } : { sort: generateRandomSortSeed() })
    };
    
    const tag_filter: TagFilterInput = {
      marker_count: {
        value: hasSearchTerm ? 0 : 10,
        modifier: 'GREATER_THAN'
      }
    };
    
    const variables = { filter, tag_filter };

    try {
      const result = await this.gqlClient.query<FindTagsResponse>({
        query: queries.FIND_TAGS,
        variables,
        signal,
      });
      
      if (this.isAborted(signal)) return [];
      
      const tags = result.data?.findTags?.tags ?? [];
      return tags.slice(0, limit);
    } catch (error: unknown) {
      if (isAbortError(error) || this.isAborted(signal)) {
        return [];
      }
      this.logSearchError('searchMarkerTags', error);
      return [];
    }
  }

  /**
   * Check if operation is aborted
   */
  private isAborted(signal?: AbortSignal): boolean {
    return signal?.aborted ?? false;
  }

  /**
   * Log search error with appropriate detail level
   */
  private logSearchError(method: string, error: unknown): void {
    if (error instanceof GraphQLRequestError || error instanceof GraphQLResponseError || error instanceof GraphQLNetworkError) {
      console.warn(`${method} failed`, error);
    } else {
      console.warn(`${method} failed`, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Search performers (by name) for autocomplete
   * Only returns performers that have more than 1 scene (filtered directly in GraphQL)
   * Includes request deduplication and caching
   */
  async searchPerformers(term: string, limit: number = 10, signal?: AbortSignal): Promise<Array<{ id: string; name: string; image_path?: string }>> {
    // Skip caching for empty terms to ensure fresh random suggestions
    const isEmptyTerm = !term || term.trim() === '';
    
    // Check cache first (only for non-empty terms)
    if (!isEmptyTerm) {
      const cacheKey = `performers:${term}:${limit}`;
      const cached = this.searchCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return cached.data as Promise<Array<{ id: string; name: string; image_path?: string }>>;
      }
    }
    
    // Create new request (deduplication handled by GraphQL client)
    const request = this._searchPerformers(term, limit, signal);
    
    try {
      const result = await request;
      // Cache the result (only for non-empty terms)
      if (!isEmptyTerm) {
        const cacheKey = `performers:${term}:${limit}`;
        this.searchCache.set(cacheKey, { data: result, timestamp: Date.now() });
      }
      return result;
    } catch (error: unknown) {
      // Re-throw to maintain error handling
      throw error;
    }
  }
  
  /**
   * Internal implementation of searchPerformers
   */
  private async _searchPerformers(term: string, limit: number = 10, signal?: AbortSignal): Promise<Array<{ id: string; name: string; image_path?: string }>> {
    if (this.isAborted(signal)) return [];

    const hasSearchTerm = term && term.trim() !== '';
    const fetchLimit = hasSearchTerm ? limit * 3 : Math.max(limit, 20);
    
    const filter: FindFilterInput = { 
      per_page: fetchLimit, 
      page: 1,
      ...(hasSearchTerm ? { q: term.trim() } : { sort: generateRandomSortSeed() })
    };
    
    const performer_filter: PerformerFilterInput = {
      scene_count: {
        value: 0,
        modifier: 'GREATER_THAN'
      }
    };
    
    const variables = { filter, performer_filter };

    try {
      const result = await this.gqlClient.query<FindPerformersResponse>({
        query: queries.FIND_PERFORMERS,
        variables,
        signal,
      });
      
      if (this.isAborted(signal)) return [];
      
      const performers = result.data?.findPerformers?.performers ?? [];
      return performers.slice(0, limit);
    } catch (e: unknown) {
      if (isAbortError(e) || this.isAborted(signal)) {
        return [];
      }
      this.logSearchError('searchPerformers', e);
      return [];
    }
  }


  /**
   * Fetch saved marker filters from Stash
   */
  async fetchSavedMarkerFilters(signal?: AbortSignal): Promise<Array<{ id: string; name: string }>> {
    try {
      // Check if already aborted
      if (signal?.aborted) return [];
      
      const result = await this.gqlClient.query<GetSavedMarkerFiltersResponse>({
        query: queries.GET_SAVED_MARKER_FILTERS,
        signal,
      });
      // Check if aborted after query
      if (signal?.aborted) return [];
      return result.data?.findSavedFilters || [];
    } catch (e: unknown) {
      // Ignore AbortError - it's expected when cancelling
      if (isAbortError(e) || signal?.aborted) {
        return [];
      }
      console.error('Error fetching saved marker filters:', e);
      return [];
    }
  }

  /**
   * Get a saved filter's criteria
   */
  async getSavedFilter(id: string): Promise<GetSavedFilterResponse['findSavedFilter']> {
    try {
      const result = await this.gqlClient.query<GetSavedFilterResponse>({
        query: queries.GET_SAVED_FILTER,
        variables: { id }
      });
      return result.data?.findSavedFilter || null;
    } catch (e) {
      console.error('Error fetching saved filter:', e);
      return null;
    }
  }

  /**
   * Fetch scene markers from Stash
   * Note: Stash's SceneMarkerFilterType only supports filtering by primary_tag, not by tags array.
   * For non-primary tags, we fetch markers and filter client-side.
   */
  async fetchSceneMarkers(filters?: FilterOptions, signal?: AbortSignal): Promise<{ markers: SceneMarker[]; totalCount: number }> {
    if (this.isAborted(signal)) return { markers: [], totalCount: 0 };
    
    // Fetching scene markers with filters
    
    if (filters?.shuffleMode) {
      const markers = await this.fetchScenesForShuffle(filters, signal);
      // For shuffle mode, we don't have a reliable count, so return markers with 0 count
      // The caller should handle this case
      return { markers, totalCount: 0 };
    }
    
    const savedFilterCriteria = await this.getSavedFilterCriteria(filters, signal);
    if (this.isAborted(signal)) return { markers: [], totalCount: 0 };

    try {
      const limit = filters?.limit || 20;
      let page = this.calculateInitialPage(limit, filters);
      
      if (!filters?.offset && !this.hasActiveFilters(filters)) {
        page = await this.calculateRandomPage(filters, savedFilterCriteria, limit, signal);
        if (this.isAborted(signal)) return { markers: [], totalCount: 0 };
      }

      const filter = this.buildFindFilter(filters, savedFilterCriteria, page, limit);
      const sceneMarkerFilter = this.buildSceneMarkerFilter(filters, savedFilterCriteria);
      
      const { markers, totalCount } = await this.executeMarkerQueryWithCount(filter, sceneMarkerFilter, signal);
      if (this.isAborted(signal)) return { markers: [], totalCount: 0 };
      
      let finalMarkers = markers;
      if (filters?.shuffleMode && finalMarkers.length > 0) {
        finalMarkers = this.filterScenesByMarkerCount(finalMarkers, 5);
      }
      
      return { markers: finalMarkers, totalCount };
    } catch (e: unknown) {
      if ((e instanceof Error && e.name === 'AbortError') || this.isAborted(signal)) {
        return { markers: [], totalCount: 0 };
      }
      console.error('Error fetching scene markers:', e);
      return { markers: [], totalCount: 0 };
    }
  }

  /**
   * Get saved filter criteria if a saved filter ID is provided
   */
  private async getSavedFilterCriteria(filters?: FilterOptions, signal?: AbortSignal): Promise<GetSavedFilterResponse['findSavedFilter']> {
    if (!filters?.savedFilterId) return null;
    return await this.getSavedFilter(filters.savedFilterId);
  }

  /**
   * Check if any active filters are present
   */
  private hasActiveFilters(filters?: FilterOptions): boolean {
    return !!(filters?.tags?.length || filters?.savedFilterId || (filters?.query && filters.query.trim() !== ''));
  }

  /**
   * Calculate initial page number from offset
   */
  private calculateInitialPage(limit: number, filters?: FilterOptions): number {
    return filters?.offset ? Math.floor(filters.offset / limit) + 1 : 1;
  }

  /**
   * Calculate random page for unfiltered queries
   */
  private async calculateRandomPage(
    filters: FilterOptions | undefined,
    savedFilterCriteria: GetSavedFilterResponse['findSavedFilter'],
    limit: number,
    signal?: AbortSignal
  ): Promise<number> {
    const countFilter = this.buildCountFilter(filters, savedFilterCriteria);
    const countSceneFilter = this.buildCountSceneFilter(filters, savedFilterCriteria);

    try {
      if (this.isAborted(signal)) return 1;
      
      const countResult = await this.gqlClient.query<CheckTagsHaveMarkersResponse>({
        query: queries.GET_MARKER_COUNT,
        variables: {
          filter: countFilter,
          scene_marker_filter: Object.keys(countSceneFilter).length > 0 ? countSceneFilter : {},
        },
        signal,
      });
      
      if (this.isAborted(signal)) return 1;
      
      const totalCount = countResult.data?.findSceneMarkers?.count || 0;
      if (totalCount > 0) {
        const totalPages = Math.ceil(totalCount / limit);
        return Math.floor(Math.random() * totalPages) + 1;
      }
    } catch (e: unknown) {
      if (isAbortError(e) || this.isAborted(signal)) {
        return 1;
      }
      console.warn('Failed to get count for random page, using page 1', e);
    }
    
    return 1;
  }

  /**
   * Build count filter for random page calculation
   */
  private buildCountFilter(filters: FilterOptions | undefined, savedFilterCriteria: GetSavedFilterResponse['findSavedFilter']): FindFilterInput {
    const countFilter: FindFilterInput = { per_page: 1, page: 1 };
    
    if (savedFilterCriteria?.find_filter) {
      Object.assign(countFilter, savedFilterCriteria.find_filter);
    }
    
    if (filters?.query && filters.query.trim() !== '') {
      countFilter.q = filters.query;
    }
    
    return countFilter;
  }

  /**
   * Build count scene filter for random page calculation
   */
  private buildCountSceneFilter(filters: FilterOptions | undefined, savedFilterCriteria: GetSavedFilterResponse['findSavedFilter']): SceneMarkerFilterInput {
    const countSceneFilterRaw = savedFilterCriteria?.object_filter || {};
    const countSceneFilter = this.normalizeMarkerFilter(countSceneFilterRaw);
    
    if (!filters?.savedFilterId && filters?.tags && filters.tags.length > 0) {
      const tagIds = this.parseTagIds(filters.tags);
      if (tagIds.length > 0) {
        countSceneFilter.tags = {
          value: tagIds.map(String),
          excludes: [],
          modifier: tagIds.length === 1 ? 'INCLUDES_ALL' : 'INCLUDES',
          depth: 0
        };
      }
    }
    
    return countSceneFilter;
  }

  /**
   * Parse tag IDs from filter array
   */
  private parseTagIds(tags: (string | number)[]): number[] {
    return tags
      .map((v) => Number.parseInt(String(v), 10))
      .filter((n) => !Number.isNaN(n));
  }

  /**
   * Build find filter for main query
   */
  private buildFindFilter(
    filters: FilterOptions | undefined,
    savedFilterCriteria: GetSavedFilterResponse['findSavedFilter'],
    page: number,
    limit: number
  ): FindFilterInput {
    const filter: FindFilterInput = {
      per_page: limit,
      page: page,
      sort: generateRandomSortSeed(),
    };
    
    if (savedFilterCriteria?.find_filter) {
      Object.assign(filter, savedFilterCriteria.find_filter);
    }
    
    if (filters?.query && filters.query.trim() !== '') {
      filter.q = filters.query;
      // Applying query filter
    }
    
    filter.page = page;
    filter.per_page = limit;
    
    return filter;
  }

  /**
   * Build scene marker filter
   */
  private buildSceneMarkerFilter(
    filters: FilterOptions | undefined,
    savedFilterCriteria: GetSavedFilterResponse['findSavedFilter']
  ): SceneMarkerFilterInput {
    const sceneMarkerFilterRaw: SceneMarkerFilterInput | Record<string, unknown> = 
      savedFilterCriteria?.object_filter ? { ...savedFilterCriteria.object_filter } : {};
    const sceneMarkerFilter = this.normalizeMarkerFilter(sceneMarkerFilterRaw);
    
    if (!filters?.savedFilterId) {
      this.applyTagFilter(filters, sceneMarkerFilter);
      this.applyPerformerFilter(filters, sceneMarkerFilter);
    }
    
    if (filters?.studios && filters.studios.length > 0) {
      sceneMarkerFilter.scene_tags = { value: filters.studios, modifier: 'INCLUDES' };
    }
    
    return sceneMarkerFilter;
  }

  /**
   * Apply tag filter to scene marker filter
   */
  private applyTagFilter(filters: FilterOptions | undefined, sceneMarkerFilter: SceneMarkerFilterInput): void {
    if (!filters?.tags || filters.tags.length === 0) return;
    
    const tagIds = this.parseTagIds(filters.tags);
    if (tagIds.length === 0) return;
    
    sceneMarkerFilter.tags = {
      value: tagIds.map(String),
      excludes: [],
      modifier: tagIds.length === 1 ? 'INCLUDES_ALL' : 'INCLUDES',
      depth: 0
    };
    
    // Applying tags filter
  }

  /**
   * Apply performer filter to scene marker filter
   */
  private applyPerformerFilter(filters: FilterOptions | undefined, sceneMarkerFilter: SceneMarkerFilterInput): void {
    if (!filters?.performers || filters.performers.length === 0) return;
    
    const performerIds = this.parseTagIds(filters.performers);
    if (performerIds.length === 0) return;
    
    sceneMarkerFilter.performers = { 
      value: performerIds,
      modifier: performerIds.length > 1 ? 'INCLUDES_ALL' : 'INCLUDES' 
    };
    
    // Applying performer filter
  }

  /**
   * Execute marker query with retry logic
   */
  private async executeMarkerQuery(
    filter: FindFilterInput,
    sceneMarkerFilter: SceneMarkerFilterInput,
    signal?: AbortSignal
  ): Promise<SceneMarker[]> {
    const { markers } = await this.executeMarkerQueryWithCount(filter, sceneMarkerFilter, signal);
    return markers;
  }

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
    
    if (this.isAborted(signal)) return { markers: [], totalCount: 0 };
    
    const responseData = result.data?.findSceneMarkers;
    let markers = responseData?.scene_markers || [];
    const totalCount = responseData?.count ?? 0;
    
    if (totalCount > 0 && markers.length === 0 && filter.page !== 1) {
      const retryResult = await this.retryMarkerQueryWithCount(filter, sceneMarkerFilter, signal);
      return retryResult;
    }
    
    return { markers, totalCount };
  }

  /**
   * Retry marker query with page 1
   */
  private async retryMarkerQuery(
    filter: FindFilterInput,
    sceneMarkerFilter: SceneMarkerFilterInput,
    signal?: AbortSignal
  ): Promise<SceneMarker[]> {
    const { markers } = await this.retryMarkerQueryWithCount(filter, sceneMarkerFilter, signal);
    return markers;
  }

  /**
   * Retry marker query with page 1 and return count
   */
  private async retryMarkerQueryWithCount(
    filter: FindFilterInput,
    sceneMarkerFilter: SceneMarkerFilterInput,
    signal?: AbortSignal
  ): Promise<{ markers: SceneMarker[]; totalCount: number }> {
    console.warn('[StashAPI] Count > 0 but no markers returned - retrying with page 1');
    
    if (this.isAborted(signal)) return { markers: [], totalCount: 0 };
    
    filter.page = 1;
    const retryResult = await this.gqlClient.query<FindSceneMarkersResponse>({
      query: queries.FIND_SCENE_MARKERS,
      variables: {
        filter,
        scene_marker_filter: Object.keys(sceneMarkerFilter).length > 0 ? sceneMarkerFilter : {},
      },
      signal,
    });
    
    if (this.isAborted(signal)) return { markers: [], totalCount: 0 };
    
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
   * @returns Array of synthetic scene markers (one per scene)
   */
  private async fetchScenesForShuffle(filters?: FilterOptions, signal?: AbortSignal): Promise<SceneMarker[]> {
    try {
      const limit = filters?.limit || 20;
      let page = filters?.offset ? Math.floor(filters?.offset / limit) + 1 : 1;

      if (!filters?.offset) {
        page = await this.calculateRandomScenePage(filters, limit, signal);
        if (this.isAborted(signal)) return [];
      }

      if (this.isAborted(signal)) return [];

      const filter: FindFilterInput = {
        per_page: limit,
        page: page,
        sort: generateRandomSortSeed(),
      };

      const sceneFilter = this.buildShuffleSceneFilter(filters);
      const scenes = await this.fetchScenesQuery(filter, sceneFilter, signal);
      
      if (this.isAborted(signal)) return [];

      let markers = this.createSyntheticMarkers(scenes);
      
      return markers;
    } catch (e: unknown) {
      if (isAbortError(e) || this.isAborted(signal)) {
        return [];
      }
      console.error('Error fetching scenes for shuffle', e);
      return [];
    }
  }

  /**
   * Calculate random page for shuffle mode
   */
  private async calculateRandomScenePage(filters: FilterOptions | undefined, limit: number, signal?: AbortSignal): Promise<number> {
    const countFilter: FindFilterInput = { per_page: 1, page: 1 };
    const sceneFilter = this.buildShuffleSceneFilter(filters);

    try {
      if (this.isAborted(signal)) return 1;
      
      const countResult = await this.gqlClient.query<FindScenesResponse>({
        query: queries.GET_SCENE_COUNT,
        variables: { filter: countFilter, ...(sceneFilter && { scene_filter: sceneFilter }) },
        signal,
      });
      
      if (this.isAborted(signal)) return 1;
      
      const totalCount = countResult.data?.findScenes?.count || 0;
      if (totalCount > 0) {
        const totalPages = Math.ceil(totalCount / limit);
        return Math.floor(Math.random() * totalPages) + 1;
      }
    } catch (e: unknown) {
      if (isAbortError(e) || this.isAborted(signal)) {
        return 1;
      }
      console.warn('Failed to get scene count for shuffle, using page 1', e);
    }
    
    return 1;
  }

  /**
   * Build scene filter for shuffle mode
   */
  private buildShuffleSceneFilter(filters?: FilterOptions): SceneFilterInput | null {
    if (filters?.includeScenesWithoutMarkers) {
      return { has_markers: 'false' };
    }
    return null;
  }

  /**
   * Fetch scenes query (shared by shuffle mode and short-form content)
   */
  private async fetchScenesQuery(
    filter: FindFilterInput,
    sceneFilter: SceneFilterInput | null,
    signal?: AbortSignal
  ): Promise<Scene[]> {
    const result = await this.gqlClient.query<FindScenesResponse>({
      query: queries.FIND_SCENES,
      variables: { filter, ...(sceneFilter && { scene_filter: sceneFilter }) },
      signal,
    });
    
    if (this.isAborted(signal)) return [];
    
    return result.data?.findScenes?.scenes || [];
  }

  /**
   * Create synthetic markers from scenes
   */
  private createSyntheticMarkers(scenes: Scene[]): SceneMarker[] {
    return scenes.map((scene) => ({
      id: `synthetic-${scene.id}-${Date.now()}-${Math.random()}`,
      title: scene.title || 'Untitled',
      seconds: 0,
      stream: undefined,
      scene: scene,
      primary_tag: undefined,
      tags: [],
    }));
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
  ): Promise<{ markers: SceneMarker[]; totalCount: number }> {
    if (this.isAborted(signal)) return { markers: [], totalCount: 0 };

    try {
      if (this.isAborted(signal)) return { markers: [], totalCount: 0 };

      const scenesPerPage = 24; // Fetch 24 scenes per page
      
      const sceneFilter = this.buildShortFormSceneFilter(filters, maxDuration);
      
      const { maxPage, totalCount } = await this.getMaxPageForShortForm(sceneFilter, scenesPerPage, signal);
      if (maxPage === 0) {
        return { markers: [], totalCount: 0 };
      }
      
      // Calculate page from offset based on scenesPerPage
      const page = Math.floor(offset / scenesPerPage) + 1;
      // Ensure page doesn't exceed maxPage
      const actualPage = Math.min(page, maxPage);
      
      // Calculate offset within the page
      const offsetInPage = offset % scenesPerPage;
      
      // Fetch only the single page needed
      const filter: FindFilterInput = {
        per_page: scenesPerPage,
        page: actualPage,
        sort: generateRandomSortSeed(),
      };
      
      const scenes = await this.fetchScenesQuery(filter, sceneFilter, signal);
      if (this.isAborted(signal)) return { markers: [], totalCount: 0 };
      
      // Filter by duration (in case any scenes don't match the duration filter)
      const shortFormScenes = this.filterShortFormScenes(scenes, maxDuration);
      
      // Apply offset within page and limit to results
      const limitedScenes = shortFormScenes.slice(offsetInPage, offsetInPage + limit);
      
      const markers = this.createShortFormMarkers(limitedScenes);
      
      return { markers, totalCount };
    } catch (e: unknown) {
      if (isAbortError(e) || this.isAborted(signal)) {
        return { markers: [], totalCount: 0 };
      }
      console.error('[ShortForm] Error fetching short-form videos', e);
      return { markers: [], totalCount: 0 };
    }
  }

  /**
   * Get maximum valid page number for short-form content
   */
  private async getMaxPageForShortForm(
    sceneFilter: SceneFilterInput | null,
    scenesPerPage: number,
    signal?: AbortSignal
  ): Promise<{ maxPage: number; totalCount: number }> {
    let maxPage = 100; // Default fallback
    let totalCount = 0;
    try {
      const countFilter: FindFilterInput = { per_page: 1, page: 1 };
      const countResult = await this.gqlClient.query<FindScenesResponse>({
        query: queries.GET_SCENE_COUNT,
        variables: { filter: countFilter, ...(sceneFilter && { scene_filter: sceneFilter }) },
        signal,
      });
      
      if (this.isAborted(signal)) return { maxPage: 0, totalCount: 0 };
      
      totalCount = countResult.data?.findScenes?.count || 0;
      
      if (totalCount > 0) {
        maxPage = Math.max(1, Math.ceil(totalCount / scenesPerPage));
      } else {
        console.warn('[ShortForm] No scenes found matching filter');
        return { maxPage: 0, totalCount: 0 };
      }
    } catch (countError: unknown) {
      console.warn('[ShortForm] Failed to get scene count, using default max page:', maxPage, countError);
      // If we can't get count, we can't reliably calculate totalCount, so return 0
      return { maxPage, totalCount: 0 };
    }
    return { maxPage, totalCount };
  }

  /**
   * Generate unique random page numbers (legacy method, kept for backwards compatibility)
   */
  private generateUniqueRandomPages(pagesToFetch: number, maxPage: number): number[] {
    const selectedPages = new Set<number>();
    
    // Generate unique random pages
    while (selectedPages.size < pagesToFetch && selectedPages.size < maxPage) {
      const randomPage = Math.floor(Math.random() * maxPage) + 1;
      selectedPages.add(randomPage);
    }
    
    // If we don't have enough unique pages, fill with sequential pages
    if (selectedPages.size < pagesToFetch) {
      for (let page = 1; page <= maxPage && selectedPages.size < pagesToFetch; page++) {
        selectedPages.add(page);
      }
    }
    
    return Array.from(selectedPages);
  }

  /**
   * Generate pages for a specific offset using deterministic randomness
   * Ensures pagination progression while maintaining variety
   */
  private generatePagesForOffset(
    basePage: number,
    pageRange: number,
    pagesToFetch: number,
    maxPage: number,
    offset: number
  ): number[] {
    const selectedPages = new Set<number>();
    
    // Calculate page range bounds
    const minPage = Math.max(1, basePage - pageRange);
    const maxPageInRange = Math.min(maxPage, basePage + pageRange);
    const availablePages = maxPageInRange - minPage + 1;
    
    // Use offset as seed for deterministic randomness
    // Same offset always generates same pages, but different offsets get different pages
    let seed = offset;
    const seededRandom = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    
    // Generate unique pages within the range
    while (selectedPages.size < pagesToFetch && selectedPages.size < availablePages) {
      const randomValue = seededRandom();
      const pageInRange = Math.floor(randomValue * availablePages);
      const page = minPage + pageInRange;
      selectedPages.add(page);
    }
    
    // If we don't have enough unique pages in range, fill with sequential pages from the range
    if (selectedPages.size < pagesToFetch) {
      for (let page = minPage; page <= maxPageInRange && selectedPages.size < pagesToFetch; page++) {
        selectedPages.add(page);
      }
    }
    
    // If still not enough, fall back to any available pages
    if (selectedPages.size < pagesToFetch) {
      for (let page = 1; page <= maxPage && selectedPages.size < pagesToFetch; page++) {
        selectedPages.add(page);
      }
    }
    
    return Array.from(selectedPages);
  }

  /**
   * Fetch multiple pages of scenes with error handling
   */
  private async fetchShortFormPages(
    selectedPages: number[],
    scenesPerPage: number,
    sceneFilter: SceneFilterInput | null,
    maxPage: number,
    signal?: AbortSignal
  ): Promise<Array<{ scenes: Scene[]; page: number }>> {
    const fetchPromises: Array<Promise<{ scenes: Scene[]; page: number }>> = [];
    
    for (const randomPage of selectedPages) {
      const filter: FindFilterInput = {
        per_page: scenesPerPage,
        page: randomPage,
        sort: generateRandomSortSeed(), // Different random seed for each page
      };
      
      // Wrap fetchScenesQuery with error handling
      fetchPromises.push(
        this.fetchScenesQuery(filter, sceneFilter, signal)
          .then((scenes) => {
            return { scenes, page: randomPage };
          })
          .catch((error: unknown) => {
            console.error('[ShortForm] Error fetching page', randomPage, ':', error);
            return { scenes: [], page: randomPage };
          })
      );
    }
    
    return await Promise.all(fetchPromises);
  }

  /**
   * Combine scenes from multiple pages and remove duplicates
   */
  private combineAndDeduplicateScenes(
    allPageResults: Array<{ scenes: Scene[]; page: number }>
  ): Scene[] {
    const sceneMap = new Map<string, Scene>();
    let totalFetched = 0;
    
    for (const { scenes } of allPageResults) {
      totalFetched += scenes.length;
      for (const scene of scenes) {
        if (scene.id) {
          sceneMap.set(scene.id, scene);
        }
      }
    }
    
    const allScenes = Array.from(sceneMap.values());
    return allScenes;
  }

  /**
   * Filter scenes by duration, shuffle, and limit
   */
  private filterAndShuffleShortFormScenes(
    allScenes: Scene[],
    maxDuration: number,
    limit: number
  ): Scene[] {
    const shortFormScenes = this.filterShortFormScenes(allScenes, maxDuration);
    
    if (shortFormScenes.length === 0) {
      console.warn('[ShortForm] No scenes match duration criteria');
      return [];
    }
    
    // Shuffle the filtered results with a fresh random seed each time
    const shuffled = this.shuffleArray([...shortFormScenes]);
    
    // Limit to requested amount
    const limitedScenes = shuffled.slice(0, limit);
    
    return limitedScenes;
  }

  /**
   * Shuffle an array using Fisher-Yates algorithm
   */
  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Build scene filter for short-form content
   */
  private buildShortFormSceneFilter(filters?: FilterOptions, maxDuration?: number): SceneFilterInput | null {
    const sceneFilter: SceneFilterInput = {
      file_count: {
        value: 0,
        modifier: 'GREATER_THAN'
      }
    };

    // Add duration filter if maxDuration is provided
    if (maxDuration !== undefined && maxDuration > 0) {
      sceneFilter.duration = {
        value: maxDuration,
        modifier: 'LESS_THAN'
      };
    }

    // Apply performer filter if provided
    if (filters?.performers && filters.performers.length > 0) {
      const performerIds = this.parseTagIds(filters.performers);
      if (performerIds.length > 0) {
        sceneFilter.performers = {
          value: performerIds,
          modifier: performerIds.length > 1 ? 'INCLUDES_ALL' : 'INCLUDES'
        };
      }
    }

    // Apply tag filter if provided
    if (filters?.tags && filters.tags.length > 0) {
      const tagIds = this.parseTagIds(filters.tags);
      if (tagIds.length > 0) {
        sceneFilter.tags = {
          value: tagIds.map(String),
          modifier: tagIds.length === 1 ? 'INCLUDES_ALL' : 'INCLUDES'
        };
      }
    }

    return Object.keys(sceneFilter).length > 0 ? sceneFilter : null;
  }


  /**
   * Filter scenes for short-form content (duration < maxDuration)
   */
  private filterShortFormScenes(scenes: Scene[], maxDuration: number): Scene[] {
    return scenes.filter((scene) => {
      const file = scene.files?.[0];
      if (!file) return false;

      const duration = file.duration;

      // Must have valid duration
      if (!duration) return false;

      // Must be shorter than max duration
      if (duration >= maxDuration) return false;

      return true;
    });
  }

  /**
   * Create synthetic markers for short-form content
   * These play from start to end (seconds: 0, no end_seconds)
   */
  private createShortFormMarkers(scenes: Scene[]): SceneMarker[] {
    return scenes.map((scene) => ({
      id: `shortform-${scene.id}-${Date.now()}-${Math.random()}`,
      title: scene.title || 'Untitled',
      seconds: 0,
      end_seconds: undefined,
      stream: undefined,
      scene: scene,
      primary_tag: undefined,
      tags: [],
    }));
  }

  /**
   * Filter markers to only include those from scenes with less than maxMarkers
   * @param markers Array of scene markers
   * @param maxMarkers Maximum number of markers per scene (exclusive)
   * @returns Filtered array of markers
   */
  private filterScenesByMarkerCount(markers: SceneMarker[], maxMarkers: number): SceneMarker[] {
    // Group markers by scene ID
    const sceneMarkerCounts = new Map<string, number>();
    const sceneMarkers = new Map<string, SceneMarker[]>();

    for (const marker of markers) {
      const sceneId = marker.scene?.id;
      if (!sceneId) continue;

      const count = sceneMarkerCounts.get(sceneId) || 0;
      sceneMarkerCounts.set(sceneId, count + 1);

      if (!sceneMarkers.has(sceneId)) {
        sceneMarkers.set(sceneId, []);
      }
      sceneMarkers.get(sceneId)!.push(marker);
    }

    // Filter to only scenes with less than maxMarkers
    const filteredMarkers: SceneMarker[] = [];
    for (const [sceneId, count] of sceneMarkerCounts.entries()) {
      if (count < maxMarkers) {
        const sceneMarkersList = sceneMarkers.get(sceneId);
        if (sceneMarkersList) {
          filteredMarkers.push(...sceneMarkersList);
        }
      }
    }

    return filteredMarkers;
  }

  /**
   * Get video URL for a scene marker
   */
  getMarkerVideoUrl(marker: SceneMarker): string | undefined {
    if (!marker.stream) {
      return this.getVideoUrl(marker.scene);
    }
    
    const stream = marker.stream.trim();
    if (!stream || stream.length === 0) {
      return this.getVideoUrl(marker.scene);
    }
    
    const url = this.buildUrl(stream);
    if (!isValidMediaUrl(url)) {
      return this.getVideoUrl(marker.scene);
    }
    
    return this.addCacheBusting(url);
  }

  /**
   * Get video URL for a scene
   */
  getVideoUrl(scene: Scene): string | undefined {
    const url = this.trySceneStreams(scene) || 
                this.tryStreamPath(scene) || 
                this.tryFilePath(scene);
    
    return url ? this.addCacheBusting(url) : undefined;
  }

  /**
   * Try to get URL from scene streams
   */
  private trySceneStreams(scene: Scene): string | undefined {
    if (!scene.sceneStreams || scene.sceneStreams.length === 0) {
      return undefined;
    }
    
    const streamUrl = scene.sceneStreams[0]?.url;
    if (!streamUrl || streamUrl.trim().length === 0) {
      return undefined;
    }
    
    const url = this.buildUrl(streamUrl);
    return isValidMediaUrl(url) ? url : undefined;
  }

  /**
   * Try to get URL from stream path
   */
  private tryStreamPath(scene: Scene): string | undefined {
    const streamPath = scene.paths?.stream?.trim();
    if (!streamPath || streamPath.length === 0) {
      return undefined;
    }
    
    const url = this.buildUrl(streamPath);
    return isValidMediaUrl(url) ? url : undefined;
  }

  /**
   * Try to get URL from file path
   */
  private tryFilePath(scene: Scene): string | undefined {
    if (!scene.files || scene.files.length === 0) {
      return undefined;
    }
    
    const filePath = scene.files[0]?.path?.trim();
    if (!filePath || filePath.length === 0) {
      return undefined;
    }
    
    const url = this.buildUrl(filePath);
    return isValidMediaUrl(url) ? url : undefined;
  }

  /**
   * Build full URL from path
   */
  private buildUrl(path: string): string {
    return path.startsWith('http') ? path : `${this.baseUrl}${path}`;
  }

  /**
   * Add cache-busting parameter to URL
   */
  private addCacheBusting(url: string): string {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}t=${Date.now()}`;
  }


  /**
   * Find a tag by name
   */
  async findTagByName(tagName: string): Promise<{ id: string; name: string } | null> {
    const variables = {
      filter: { per_page: 1, page: 1 },
      tag_filter: { name: { value: tagName, modifier: 'EQUALS' } }
    };

    try {
      // Use findTags (plural) instead of findTag (singular) as it's more widely supported
      const result = await this.gqlClient.query<FindTagsResponse>({
        query: queries.FIND_TAGS,
        variables,
      });
      const tags = result.data?.findTags?.tags || [];
      if (tags.length > 0) {
        const tag = tags[0];
        // Validate exact match (case-insensitive) - EQUALS modifier might not work as expected
        if (tag.name.toLowerCase() === tagName.toLowerCase()) {
          // Found matching tag
          return tag;
        } else {
          console.warn('[StashAPI] Tag name mismatch:', { searched: tagName, found: tag.name, id: tag.id });
          return null;
        }
      }
      return null;
    } catch (error) {
      console.error('StashAPI: Failed to find tag', error);
      return null;
    }
  }

  /**
   * Create a new tag
   * If the tag already exists, attempts to find and return it
   */
  async createTag(tagName: string): Promise<{ id: string; name: string } | null> {
    const variables: { input: TagCreateInput } = {
      input: { name: tagName }
    };

    try {
      const result = await this.gqlClient.mutate<TagCreateResponse>({
        mutation: mutations.TAG_CREATE,
        variables,
      });
      return result.data?.tagCreate || null;
    } catch (error: unknown) {
      // If tag already exists, try to find it
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('already exists') || errorMessage.includes('duplicate')) {
        console.warn(`StashAPI: Tag "${tagName}" already exists, attempting to find it`, error);
        // Try to find the existing tag
        const existingTag = await this.findTagByName(tagName);
        if (existingTag) {
          return existingTag;
        }
      }
      console.error('StashAPI: Failed to create tag', error);
      return null;
    }
  }

  /**
   * Check if a scene marker has a specific tag
   * Uses the marker's existing tags array if available, otherwise queries
   */
  async markerHasTag(marker: { id: string; tags?: Array<{ id: string }> }, tagId: string): Promise<boolean> {
    // If we have tags in the marker data, use them directly
    if (marker.tags && marker.tags.length > 0) {
      return marker.tags.some(tag => tag.id === tagId);
    }

    // Otherwise, fall back to querying (though this shouldn't be necessary)
    // Since we always have marker data with tags, this is just a safety fallback
    return false;
  }

  /**
   * Check if a scene has a specific tag (kept for backwards compatibility)
   */
  async sceneHasTag(sceneId: string, tagId: string): Promise<boolean> {
    const variables = { id: sceneId };

    try {
      const result = await this.gqlClient.query<FindSceneResponse>({
        query: queries.FIND_SCENE_MINIMAL,
        variables,
      });
      const tags = result.data?.findScene?.tags || [];
      return tags.some((tag: { id: string }) => tag.id === tagId);
    } catch (error) {
      console.error('StashAPI: Failed to check scene tag', error);
      return false;
    }
  }

  /**
   * Add a tag to a scene marker
   * Requires full marker data to include all required fields in the mutation
   */
  async addTagToMarker(
    marker: {
      id: string;
      title: string;
      seconds: number;
      end_seconds?: number | null;
      scene: { id: string };
      primary_tag?: { id: string } | null;
      tags?: Array<{ id: string }>;
    },
    tagId: string
  ): Promise<void> {
    try {
      // Get current tags from marker data
      const currentTags: string[] = (marker.tags || []).map(t => t.id);

      // Add the new tag if not already present
      if (!currentTags.includes(tagId)) {
        const tagIds = [...currentTags, tagId];

        // Ensure we have required fields
        if (!marker.primary_tag?.id) {
          throw new Error('Marker must have a primary_tag');
        }

        const variables: SceneMarkerUpdateInput = {
          id: marker.id,
          title: marker.title,
          seconds: marker.seconds,
          end_seconds: marker.end_seconds ?? null,
          scene_id: marker.scene.id,
          primary_tag_id: marker.primary_tag.id,
          tag_ids: tagIds
        };

        await this.gqlClient.mutate<SceneMarkerUpdateResponse>({
          mutation: mutations.SCENE_MARKER_UPDATE,
          variables: variables as unknown as Record<string, unknown>,
        });
      }
    } catch (error) {
      console.error('StashAPI: Failed to add tag to marker', error);
      throw error;
    }
  }

  /**
   * Update tags for an image
   */
  async updateImageTags(imageId: string, tagIds: string[]): Promise<void> {
    try {
      await this.gqlClient.mutate<ImageUpdateResponse>({
        mutation: mutations.IMAGE_UPDATE,
        variables: {
          input: {
            id: imageId,
            tag_ids: tagIds,
          },
        },
      });
    } catch (error) {
      console.error('StashAPI: Failed to update image tags', error);
      throw error;
    }
  }

  /**
   * Increment image o-counter
   */
  async incrementImageOCount(imageId: string): Promise<number> {
    try {
      const result = await this.gqlClient.mutate<ImageIncrementOResponse>({
        mutation: mutations.IMAGE_INCREMENT_O,
        variables: {
          id: imageId,
        },
      });
      return result.data?.imageIncrementO ?? 0;
    } catch (error) {
      console.error('StashAPI: Failed to increment image o-counter', error);
      throw error;
    }
  }

  /**
   * Add a tag to a scene (kept for backwards compatibility)
   */
  async addTagToScene(sceneId: string, tagId: string): Promise<void> {
    // First get current scene tags
    try {
      // Get current tags
      const result = await this.gqlClient.query<FindSceneResponse>({
        query: queries.FIND_SCENE_MINIMAL,
        variables: { id: sceneId },
      });
      const currentTags: string[] = (result.data?.findScene?.tags || []).map((t: { id: string }) => t.id);

      // Add the new tag if not already present
      if (!currentTags.includes(tagId)) {
        const tagIds = [...currentTags, tagId];

        const variables = {
          input: {
            id: sceneId,
            tag_ids: tagIds
          }
        };

        await this.gqlClient.mutate<SceneUpdateResponse>({
          mutation: mutations.SCENE_UPDATE,
          variables,
        });
      }
    } catch (error) {
      console.error('StashAPI: Failed to add tag to scene', error);
      throw error;
    }
  }

  /**
   * Remove a tag from a scene marker
   * Requires full marker data to include all required fields in the mutation
   */
  async removeTagFromMarker(
    marker: {
      id: string;
      title: string;
      seconds: number;
      end_seconds?: number | null;
      scene: { id: string };
      primary_tag?: { id: string } | null;
      tags?: Array<{ id: string }>;
    },
    tagId: string
  ): Promise<void> {
    try {
      // Get current tags from marker data
      const currentTags: string[] = (marker.tags || []).map(t => t.id);

      // Remove the tag
      const tagIds = currentTags.filter(id => id !== tagId);

      // Ensure we have required fields
      if (!marker.primary_tag?.id) {
        throw new Error('Marker must have a primary_tag');
      }

      const variables = {
        id: marker.id,
        title: marker.title,
        seconds: marker.seconds,
        end_seconds: marker.end_seconds ?? null,
        scene_id: marker.scene.id,
        primary_tag_id: marker.primary_tag.id,
        tag_ids: tagIds
      };

      await this.gqlClient.mutate<SceneMarkerUpdateResponse>({
        mutation: mutations.SCENE_MARKER_UPDATE,
        variables,
      });
    } catch (error) {
      console.error('StashAPI: Failed to remove tag from marker', error);
      throw error;
    }
  }

  /**
   * Remove a tag from a scene (kept for backwards compatibility)
   */
  async removeTagFromScene(sceneId: string, tagId: string): Promise<void> {
    // First get current scene tags
    try {
      // Get current tags
      const result = await this.gqlClient.query<FindSceneResponse>({
        query: queries.FIND_SCENE_MINIMAL,
        variables: { id: sceneId },
      });
      const currentTags: string[] = (result.data?.findScene?.tags || []).map((t: { id: string }) => t.id);

      // Remove the tag
      const tagIds = currentTags.filter(id => id !== tagId);

      const variables = {
        input: {
          id: sceneId,
          tag_ids: tagIds
        }
      };

      await this.gqlClient.mutate<SceneUpdateResponse>({
        mutation: mutations.SCENE_UPDATE,
        variables,
      });
    } catch (error) {
      console.error('StashAPI: Failed to remove tag from scene', error);
      throw error;
    }
  }

  /**
   * Increment the o count for a scene
   * @param sceneId The scene ID
   * @param times Optional array of timestamps (if not provided, uses current time)
   * @returns The updated o count and history
   */
  async incrementOCount(sceneId: string, times?: string[]): Promise<{ count: number; history: string[] }> {
    const variables = {
      id: sceneId,
      times: times || undefined
    };

    try {
      const result = await this.gqlClient.mutate<SceneAddOResponse>({
        mutation: mutations.SCENE_ADD_O,
        variables,
      });
      const sceneAddO = result.data?.sceneAddO;
      if (sceneAddO && 'count' in sceneAddO) {
        return { count: sceneAddO.count ?? 0, history: times || [] };
      }
      return { count: 0, history: [] };
    } catch (error) {
      console.error('StashAPI: Failed to increment o count', error);
      throw error;
    }
  }

  /**
   * Update the rating for a scene (0-10 scale → rating100)
   * @param sceneId Scene identifier
   * @param rating10 Rating on a 0-10 scale (can include decimals)
   * @returns Updated rating100 value from Stash
   */
  async updateSceneRating(sceneId: string, rating10: number): Promise<number> {
    const normalized = Number.isFinite(rating10) ? rating10 : 0;
    const clamped = Math.min(10, Math.max(0, normalized));
    const rating100 = Math.round(clamped * 10);

    const variables = {
      input: {
        id: sceneId,
        rating100,
      },
    };

    try {
      await this.gqlClient.mutate<SceneUpdateResponse>({
        mutation: mutations.SCENE_UPDATE,
        variables,
      });

      // SceneUpdateResponse doesn't include rating100, so we return the value we set
      return rating100;
    } catch (error) {
      console.error('StashAPI: Failed to save scene rating', error);
      throw error;
    }
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
      if (signal?.aborted) {
        return [];
      }
      return result.data?.findTags?.tags || [];
    } catch (error: unknown) {
      if (isAbortError(error) || signal?.aborted) {
        return [];
      }
      console.error('StashAPI: Failed to find tags for select', error);
      throw error;
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
   * @returns Created marker data
   */
  async createSceneMarker(
    sceneId: string,
    seconds: number,
    primaryTagId: string,
    title: string = '',
    endSeconds?: number | null,
    tagIds: string[] = []
  ): Promise<{ id: string; title: string; seconds: number; end_seconds?: number; stream?: string; preview?: string; scene: { id: string; title?: string; files?: Array<{ width?: number; height?: number; path?: string }>; performers?: Array<{ id: string; name: string; image_path?: string }> } | Scene; primary_tag: { id: string; name: string }; tags: Array<{ id: string; name: string }> }> {
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
      });
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
      console.error('StashAPI: Failed to create scene marker', error);
      throw error;
    }
  }

  /**
   * Fetch marker times for a scene using FindSceneMarkerTags query
   * Returns array of marker seconds values
   */
  async fetchSceneMarkerTags(sceneId: string, signal?: AbortSignal): Promise<number[]> {
    try {
      if (this.isAborted(signal)) return [];

      const result = await this.gqlClient.query<FindSceneMarkerTagsResponse>({
        query: queries.FIND_SCENE_MARKER_TAGS,
        variables: { id: sceneId },
        signal,
      });
      
      if (this.isAborted(signal)) return [];
      
      const sceneMarkerTags = result.data?.sceneMarkerTags;
      if (!sceneMarkerTags) {
        return [];
      }

      return this.extractMarkerTimes(sceneMarkerTags);
    } catch (e: unknown) {
      if (isAbortError(e) || this.isAborted(signal)) {
        return [];
      }
      console.warn('StashAPI: Failed to fetch scene marker tags', e);
      return [];
    }
  }

  /**
   * Extract marker times from scene marker tags response
   */
  private extractMarkerTimes(sceneMarkerTags: unknown): number[] {
    const tagGroups = Array.isArray(sceneMarkerTags) ? sceneMarkerTags : [sceneMarkerTags];
    const markerTimes: number[] = [];
    
    for (const tagGroup of tagGroups) {
      if (this.isTagGroup(tagGroup)) {
        const times = this.extractTimesFromTagGroup(tagGroup);
        markerTimes.push(...times);
      }
    }
    
    return markerTimes;
  }

  /**
   * Check if value is a tag group with scene_markers
   */
  private isTagGroup(value: unknown): value is { scene_markers?: Array<{ seconds?: number }> } {
    return typeof value === 'object' && value !== null && 'scene_markers' in value;
  }

  /**
   * Extract times from a tag group
   */
  private extractTimesFromTagGroup(tagGroup: { scene_markers?: Array<{ seconds?: number }> }): number[] {
    if (!Array.isArray(tagGroup.scene_markers)) {
      return [];
    }
    
    return tagGroup.scene_markers
      .map(marker => marker.seconds)
      .filter((seconds): seconds is number => typeof seconds === 'number');
  }

  /**
   * Determine orientation from width and height
   * @param width Width in pixels
   * @param height Height in pixels
   * @returns 'landscape', 'portrait', or 'square'
   */
  private getOrientation(width?: number, height?: number): 'landscape' | 'portrait' | 'square' | null {
    if (!width || !height || width <= 0 || height <= 0) {
      return null;
    }
    
    const aspectRatio = width / height;
    const tolerance = 0.05; // 5% tolerance for square detection
    
    if (Math.abs(aspectRatio - 1) < tolerance) {
      return 'square';
    } else if (aspectRatio > 1) {
      return 'landscape';
    } else {
      return 'portrait';
    }
  }

  /**
   * Filter items by orientation
   * @param items Array of items with width/height properties
   * @param orientationFilter Array of allowed orientations
   * @param getWidth Function to get width from item
   * @param getHeight Function to get height from item
   * @returns Filtered array of items
   */
  private filterByOrientation<T>(
    items: T[],
    orientationFilter: ('landscape' | 'portrait' | 'square')[] | undefined,
    getWidth: (item: T) => number | undefined,
    getHeight: (item: T) => number | undefined
  ): T[] {
    if (!orientationFilter || orientationFilter.length === 0) {
      return items;
    }
    
    return items.filter(item => {
      const width = getWidth(item);
      const height = getHeight(item);
      const orientation = this.getOrientation(width, height);
      
      if (orientation === null) {
        // If orientation cannot be determined, include the item
        return true;
      }
      
      return orientationFilter.includes(orientation);
    });
  }

  /**
   * Build regex pattern from file extensions
   * Converts ['.gif', '.webm'] to "\.(gif|webm)$" (case-insensitive)
   */
  private buildPathRegex(fileExtensions: string[]): string {
    if (fileExtensions.length === 0) {
      return String.raw`\.(gif)$`; // Default to .gif if empty
    }
    
    // Strip leading dots and validate
    const extensions = fileExtensions
      .map(ext => ext.trim().toLowerCase().replace(/^\./, ''))
      .filter(ext => ext.length > 0 && /^[a-z0-9]+$/i.test(ext));
    
    if (extensions.length === 0) {
      return String.raw`\.(gif)$`; // Default to .gif if all invalid
    }
    
    // Build regex: \.(gif|webm|mp4)$
    return String.raw`\.(${extensions.join('|')})$`;
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
    filters?: {
      performerIds?: number[];
      tagIds?: string[];
      orientationFilter?: ('landscape' | 'portrait' | 'square')[];
    },
    limit: number = 40,
    offset: number = 0,
    signal?: AbortSignal
  ): Promise<{ images: Image[]; totalCount: number }> {
    if (signal?.aborted) return { images: [], totalCount: 0 };

    // Build regex pattern from file extensions
    const regexPattern = this.buildPathRegex(fileExtensions);
    
    // Build image filter
    const imageFilter: ImageFilterInput = {
      path: {
        value: regexPattern,
        modifier: 'MATCHES_REGEX',
      },
    };

    // Add performer filter if provided
    if (filters?.performerIds && filters.performerIds.length > 0) {
      imageFilter.performers = {
        value: filters.performerIds,
        modifier: 'INCLUDES',
      };
    }

    // Add tag filter if provided
    if (filters?.tagIds && filters.tagIds.length > 0) {
      imageFilter.tags = {
        value: filters.tagIds,
        modifier: 'INCLUDES',
      };
    }

    const findFilter: FindFilterInput = {
      per_page: limit,
      page: Math.floor(offset / limit) + 1,
      sort: generateRandomSortSeed(),
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

      if (signal?.aborted) return { images: [], totalCount: 0 };

      let images = result.data?.findImages?.images || [];
      const totalCount = result.data?.findImages?.count ?? 0;
      
      // Filter by orientation if specified
      if (filters?.orientationFilter && filters.orientationFilter.length > 0) {
        images = this.filterByOrientation(
          images,
          filters.orientationFilter,
          (img) => {
            const visualFile = img.visual_files?.find(
              (file) => typeof (file as { width?: number }).width === 'number' && typeof (file as { height?: number }).height === 'number'
            ) as { width?: number; height?: number } | undefined;
            return visualFile?.width;
          },
          (img) => {
            const visualFile = img.visual_files?.find(
              (file) => typeof (file as { width?: number }).width === 'number' && typeof (file as { height?: number }).height === 'number'
            ) as { width?: number; height?: number } | undefined;
            return visualFile?.height;
          }
        );
      }
      
      return { images, totalCount };
    } catch (e: unknown) {
      if (isAbortError(e) || signal?.aborted) {
        return { images: [], totalCount: 0 };
      }
      console.error('StashAPI: Failed to find images', e);
      return { images: [], totalCount: 0 };
    }
  }
}



