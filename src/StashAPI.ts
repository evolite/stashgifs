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
  FindSceneMarkersResponse,
  FindScenesResponse,
  FindTagsResponse,
  FindTagsExtendedResponse,
  FindPerformersResponse,
  FindSceneResponse,
  GetSavedMarkerFiltersResponse,
  GetSavedFilterResponse,
  CheckTagsHaveMarkersResponse,
  CheckPerformerHasMarkersResponse,
  FindSceneMarkerTagsResponse,
  TagCreateResponse,
  SceneMarkerUpdateResponse,
  SceneMarkerCreateResponse,
  SceneUpdateResponse,
  SceneAddOResponse,
  TagCreateInput,
  SceneMarkerUpdateInput,
  TypedGraphQLClient,
  GraphQLResponse,
} from './graphql/types.js';
import {
  GraphQLRequestError,
  GraphQLResponseError,
  GraphQLNetworkError,
  GraphQLAbortError,
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
  private cache: Map<K, V>;
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

export class StashAPI {
  private baseUrl: string;
  private apiKey?: string
  // Cache for tags/performers that have markers (to avoid repeated checks)
  // Using LRU cache to track access order and intelligently evict least recently used
  private tagsWithMarkersCache: LRUCache<number, boolean>;
  private performersWithMarkersCache: LRUCache<number, boolean>;
  private pluginApi?: StashPluginApi;
  // Centralized GraphQL client
  private gqlClient: GraphQLClient;
  // Simple cache for search results (TTL: 5 minutes)
  private searchCache: Map<string, { data: unknown; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private cacheCleanupInterval?: ReturnType<typeof setInterval>;
  private readonly MAX_CACHE_SIZE = 1000; // Maximum cache entries before cleanup
  private readonly MAX_TAG_CACHE_SIZE = 1000; // Maximum tag/performer cache entries (used for LRU cache)

  constructor(baseUrl?: string, apiKey?: string) {
    // Get from window if available (Stash plugin context)
    const windowWithStash = window as typeof window & {
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
      this.baseUrl = window.location.origin;
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

    const normalizeIdArray = (val: unknown): number[] | undefined => {
      if (!val) return undefined;
      const arr = Array.isArray(val) ? val : [val];
      const ids = arr
        .map((x) => (typeof x === 'object' && x !== null ? ((x as { id?: unknown; value?: unknown }).id ?? (x as { id?: unknown; value?: unknown }).value ?? x) : x))
        .map((x) => parseInt(String(x), 10))
        .filter((n) => !Number.isNaN(n));
      return ids.length > 0 ? ids : undefined;
    };

    // Handle tags shapes: either { value, modifier } OR an array of objects/ids
    if (out.tags) {
      // Case 1: array of ids/objects
      if (Array.isArray(out.tags)) {
        const ids = normalizeIdArray(out.tags);
        if (ids) {
          out.tags = { 
            value: ids.map(id => String(id)), 
            modifier: 'INCLUDES' 
          } as SceneMarkerFilterInput['tags'];
        } else {
          delete out.tags;
        }
      } else if (typeof out.tags === 'object') {
        // Case 2: { value: number[] | { items:[{id,label}], ... }, modifier? }
        const tagsObj = out.tags as { value?: unknown; modifier?: 'INCLUDES' | 'INCLUDES_ALL' | 'EXCLUDES' };
        let raw = tagsObj.value;
        // Stash saved filter format: value: { items: [{id,label},...], excluded:[], depth:-1 }
        if (raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown[] }).items)) {
          raw = (raw as { items: unknown[] }).items;
        }
        const ids = normalizeIdArray(raw);
        if (ids) {
          out.tags = { 
            value: ids.map(id => String(id)), 
            modifier: tagsObj.modifier ?? 'INCLUDES' 
          } as SceneMarkerFilterInput['tags'];
        } else {
          delete out.tags;
        }
      }
    }

    // Handle scene_tags similarly
    if (out.scene_tags) {
      if (Array.isArray(out.scene_tags)) {
        const ids = normalizeIdArray(out.scene_tags);
        if (ids) {
          out.scene_tags = { 
            value: ids.map(id => String(id)), 
            modifier: 'INCLUDES' 
          } as SceneMarkerFilterInput['scene_tags'];
        } else {
          delete out.scene_tags;
        }
      } else if (typeof out.scene_tags === 'object') {
        const sceneTagsObj = out.scene_tags as { value?: unknown; modifier?: 'INCLUDES' | 'INCLUDES_ALL' | 'EXCLUDES' };
        let raw = sceneTagsObj.value;
        if (raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown[] }).items)) {
          raw = (raw as { items: unknown[] }).items;
        }
        const ids = normalizeIdArray(raw);
        if (ids) {
          out.scene_tags = { 
            value: ids.map(id => String(id)), 
            modifier: sceneTagsObj.modifier ?? 'INCLUDES' 
          } as SceneMarkerFilterInput['scene_tags'];
        } else {
          delete out.scene_tags;
        }
      }
    }

    // Handle scene_performers similarly
    if (out.scene_performers) {
      if (Array.isArray(out.scene_performers)) {
        const ids = normalizeIdArray(out.scene_performers);
        if (ids) {
          out.scene_performers = { 
            value: ids.map(id => Number(id)), 
            modifier: 'INCLUDES' 
          } as SceneMarkerFilterInput['scene_performers'];
        } else {
          delete out.scene_performers;
        }
      } else if (typeof out.scene_performers === 'object') {
        const scenePerformersObj = out.scene_performers as { value?: unknown; modifier?: 'INCLUDES' | 'INCLUDES_ALL' | 'EXCLUDES' };
        let raw = scenePerformersObj.value;
        if (raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown[] }).items)) {
          raw = (raw as { items: unknown[] }).items;
        }
        const ids = normalizeIdArray(raw);
        if (ids) {
          out.scene_performers = { 
            value: ids.map(id => Number(id)), 
            modifier: scenePerformersObj.modifier ?? 'INCLUDES' 
          } as SceneMarkerFilterInput['scene_performers'];
        } else {
          delete out.scene_performers;
        }
      }
    }

    return out as SceneMarkerFilterInput;
  }

  /**
   * Batch check which tags have at least one marker
   * Returns a Set of tag IDs that have markers
   */
  private async batchCheckTagsHaveMarkers(tagIds: number[]): Promise<Set<number>> {
    if (tagIds.length === 0) return new Set();
    
    // Check cache first
    const results = new Set<number>();
    const uncachedIds: number[] = [];
    for (const tagId of tagIds) {
      if (this.tagsWithMarkersCache.has(tagId)) {
        // Get to update access order (move to most recently used)
        this.tagsWithMarkersCache.get(tagId);
        results.add(tagId);
      } else {
        uncachedIds.push(tagId);
      }
    }
    
    if (uncachedIds.length === 0) return results;
    
    const sceneMarkerFilter: SceneMarkerFilterInput = {
      tags: { 
        value: tagIds.map(id => String(id)), 
        modifier: 'INCLUDES' 
      }
    };
    
    try {
      const result = await this.gqlClient.query<CheckTagsHaveMarkersResponse>({
        query: queries.CHECK_TAGS_HAVE_MARKERS,
        variables: { scene_marker_filter: sceneMarkerFilter }
      });
      const count = result.data?.findSceneMarkers?.count || 0;
        // If count > 0, at least one tag has markers, but we need to check individually
        // For efficiency, we'll check in smaller batches
        if (count === 0) return results; // Return cached results
        
        // Check each tag individually (in parallel batches of 5, with multiple batches in parallel)
        const batchSize = 5;
        const maxConcurrentBatches = 3; // Process up to 3 batches concurrently
        const batches: number[][] = [];
        for (let i = 0; i < uncachedIds.length; i += batchSize) {
          batches.push(uncachedIds.slice(i, i + batchSize));
        }
        
        // Process batches with concurrency limit
        for (let i = 0; i < batches.length; i += maxConcurrentBatches) {
          const concurrentBatches = batches.slice(i, i + maxConcurrentBatches);
          const batchResults = await Promise.all(
            concurrentBatches.map(async (batch) => {
              const batchChecks = await Promise.all(
                batch.map(async (tagId) => {
                  const batchFilter: SceneMarkerFilterInput = { 
                    tags: { 
                      value: [String(tagId)], 
                      modifier: 'INCLUDES' 
                    } 
                  };
                  try {
                    const batchResult = await this.gqlClient.query<CheckTagsHaveMarkersResponse>({
                      query: queries.CHECK_TAG_HAS_MARKERS,
                      variables: { scene_marker_filter: batchFilter }
                    });
                    return (batchResult.data?.findSceneMarkers?.count ?? 0) > 0 ? tagId : null;
                  } catch {
                    return null;
                  }
                })
              );
              return batchChecks;
            })
          );
          
          // Process results from all concurrent batches
          batchResults.flat().forEach(id => { 
            if (id !== null) {
              results.add(id);
              this.tagsWithMarkersCache.set(id, true); // Cache positive results
            }
          });
        }
        return results;
    } catch (e) {
      console.warn('batchCheckTagsHaveMarkers failed', e);
      return results; // Return cached results even if new checks fail
    }
  }

  /**
   * Batch check which performers have at least one marker
   * Returns a Set of performer IDs that have markers
   */
  private async batchCheckPerformersHaveMarkers(performerIds: number[]): Promise<Set<number>> {
    if (performerIds.length === 0) return new Set();
    
    // Check cache first
    const results = new Set<number>();
    const uncachedIds: number[] = [];
    for (const performerId of performerIds) {
      if (this.performersWithMarkersCache.has(performerId)) {
        // Get to update access order (move to most recently used)
        this.performersWithMarkersCache.get(performerId);
        results.add(performerId);
      } else {
        uncachedIds.push(performerId);
      }
    }
    
    if (uncachedIds.length === 0) return results;
    
    // Check each performer individually (in parallel batches of 5, with multiple batches in parallel)
    const batchSize = 5;
    const maxConcurrentBatches = 3; // Process up to 3 batches concurrently
    const batches: number[][] = [];
    for (let i = 0; i < uncachedIds.length; i += batchSize) {
      batches.push(uncachedIds.slice(i, i + batchSize));
    }
    
    // Process batches with concurrency limit
    for (let i = 0; i < batches.length; i += maxConcurrentBatches) {
      const concurrentBatches = batches.slice(i, i + maxConcurrentBatches);
      const batchResults = await Promise.all(
        concurrentBatches.map(async (batch) => {
          const batchChecks = await Promise.all(
            batch.map(async (performerId) => {
              const sceneMarkerFilter: SceneMarkerFilterInput = { 
                performers: { 
                  value: [performerId], 
                  modifier: 'INCLUDES_ALL' 
                } 
              };
              try {
                const result = await this.gqlClient.query<CheckPerformerHasMarkersResponse>({
                  query: queries.CHECK_PERFORMER_HAS_MARKERS,
                  variables: { scene_marker_filter: sceneMarkerFilter }
                });
                return (result.data?.findSceneMarkers?.count ?? 0) > 0 ? performerId : null;
              } catch {
                return null;
              }
            })
          );
          return batchChecks;
        })
      );
      
      // Process results from all concurrent batches
      batchResults.flat().forEach(id => { 
        if (id !== null) {
          results.add(id);
          this.performersWithMarkersCache.set(id, true); // Cache positive results
        }
      });
    }
    return results;
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
    // When no search term, fetch a smaller assortment for faster loading
    // When searching, fetch more tags matching the search term
    const fetchLimit = term && term.trim() !== '' ? limit * 3 : Math.max(limit, 20);
    const filter: FindFilterInput = { 
      per_page: fetchLimit, 
      page: 1 
    };
    
    // Only add query if term is provided and not empty
    if (term && term.trim() !== '') {
      filter.q = term.trim();
    } else {
      // When no search term, use random sorting to get a diverse assortment
      filter.sort = `random_${Math.floor(Math.random() * 1000000)}`;
    }
    
    // Filter tags based on whether actively searching or getting suggestions
    // When actively searching (term provided): match any tag with more than 0 markers
    // When getting suggestions (no term): keep higher threshold for better quality suggestions
    const tag_filter: TagFilterInput = {
      marker_count: {
        value: (term && term.trim() !== '') ? 0 : 10,
        modifier: 'GREATER_THAN'
      }
    };
    
    const variables = { filter, tag_filter };

    try {
      // Check if already aborted
      if (signal?.aborted) return [];
      
      const result = await this.gqlClient.query<FindTagsResponse>({
        query: queries.FIND_TAGS,
        variables,
        signal,
      });
      // Check if aborted after query
      if (signal?.aborted) return [];
      const tags = result.data?.findTags?.tags ?? [];
      
      // Check if aborted before processing
      if (signal?.aborted) return [];
      
      // Return tags (already randomly sorted by GraphQL when no search term)
      return tags.slice(0, limit);
    } catch (error: unknown) {
      // Ignore AbortError - it's expected when cancelling
      if (isAbortError(error) || signal?.aborted) {
        return [];
      }
      // Log error for search methods (non-critical, return empty array)
      if (error instanceof GraphQLRequestError || error instanceof GraphQLResponseError || error instanceof GraphQLNetworkError) {
        console.warn('searchMarkerTags failed', error);
      } else {
        console.warn('searchMarkerTags failed', error instanceof Error ? error.message : 'Unknown error');
      }
      return [];
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
    // When no search term, fetch a smaller assortment for faster loading
    // When searching, fetch more performers matching the search term
    const fetchLimit = term && term.trim() !== '' ? limit * 3 : Math.max(limit, 20);
    const filter: FindFilterInput = { 
      per_page: fetchLimit, 
      page: 1 
    };
    
    // Only add query if term is provided and not empty
    if (term && term.trim() !== '') {
      filter.q = term.trim();
    } else {
      // When no search term, use random sorting to get a diverse assortment
      filter.sort = `random_${Math.floor(Math.random() * 1000000)}`;
    }
    
    // Filter to only performers with at least 1 scene (for autocompletion)
    const performer_filter: PerformerFilterInput = {
      scene_count: {
        value: 0,
        modifier: 'GREATER_THAN'
      }
    };
    
    const variables = { filter, performer_filter };

    try {
      // Check if already aborted
      if (signal?.aborted) return [];
      
      const result = await this.gqlClient.query<FindPerformersResponse>({
        query: queries.FIND_PERFORMERS,
        variables,
        signal,
      });
      // Check if aborted after query
      if (signal?.aborted) return [];
      const performers = result.data?.findPerformers?.performers ?? [];
      
      // Check if aborted before processing
      if (signal?.aborted) return [];
      
      // Return performers (already randomly sorted by GraphQL when no search term)
      return performers.slice(0, limit);
    } catch (e: any) {
      // Ignore AbortError - it's expected when cancelling
      if (e.name === 'AbortError' || signal?.aborted) {
        return [];
      }
      console.warn('searchPerformers failed', e);
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
  async fetchSceneMarkers(filters?: FilterOptions, signal?: AbortSignal): Promise<SceneMarker[]> {
    // Check if already aborted
    if (signal?.aborted) return [];
    
    console.log('[StashAPI] fetchSceneMarkers called with filters:', {
      primary_tags: filters?.primary_tags,
      tags: filters?.tags,
      performers: filters?.performers,
      query: filters?.query,
      savedFilterId: filters?.savedFilterId,
      shuffleMode: filters?.shuffleMode
    });
    
    // In shuffle mode, query scenes directly to include scenes with 0 markers
    if (filters?.shuffleMode) {
      return this.fetchScenesForShuffle(filters, signal);
    }
    
    // If a saved filter is specified, fetch its criteria first
    let savedFilterCriteria: GetSavedFilterResponse['findSavedFilter'] = null;
    if (filters?.savedFilterId) {
      savedFilterCriteria = await this.getSavedFilter(filters.savedFilterId);
      if (signal?.aborted) return [];
    }

    try {
      // Calculate random page if no offset specified
      let page = filters?.offset ? Math.floor(filters.offset / (filters.limit || 20)) + 1 : 1;
      const limit = filters?.limit || 20;
      
      // Check if any filters are active (tags, saved filter, or query)
      // Note: When tags are searched, we filter by tags but still use random sorting
      const hasActiveFilters = !!(filters?.primary_tags?.length || filters?.tags?.length || filters?.savedFilterId || (filters?.query && filters.query.trim() !== ''));
      
      // If we want random and no offset, get count first to calculate random page
      // Skip random page selection when filters are active - start from page 1 instead
      // But we still use random sorting even with tag filters (just filter the results)
      if (!filters?.offset && !hasActiveFilters) {
        const countFilter: FindFilterInput = { per_page: 1, page: 1 };
        // Start with saved filter criteria if available
        if (savedFilterCriteria?.find_filter) {
          Object.assign(countFilter, savedFilterCriteria.find_filter);
        }
        // Manual query only if no saved filter OR if explicitly provided
        if (filters?.query && filters.query.trim() !== '') {
          countFilter.q = filters.query;
        }
        
        // Normalize saved filter object_filter before using in variables
        const countSceneFilterRaw = savedFilterCriteria?.object_filter || {};
        const countSceneFilter = this.normalizeMarkerFilter(countSceneFilterRaw);
        
        // If a saved filter is active, ONLY use its criteria (don't combine with manual filters)
        // Otherwise, apply manual tag filters (primary_tags or tags)
        if (!filters?.savedFilterId) {
          // Use tags if provided, otherwise fall back to primary_tags
          const tagFilter = filters?.tags || filters?.primary_tags;
          if (tagFilter && tagFilter.length > 0) {
            const tagIds = tagFilter
              .map((v) => parseInt(String(v), 10))
              .filter((n) => !Number.isNaN(n));
            if (tagIds.length > 0) {
              // SceneMarkerFilterType tags filter requires: value (array of strings), excludes, modifier, depth
              // For single tag: use INCLUDES_ALL, for multiple tags: use INCLUDES (OR logic)
              countSceneFilter.tags = {
                value: tagIds.map(id => String(id)), // Array of strings, not numbers
                excludes: [],
                modifier: tagIds.length === 1 ? 'INCLUDES_ALL' : 'INCLUDES',
                depth: 0
              };
            }
          }
        }
        
        try {
          if (signal?.aborted) return [];
          const countResult = await this.gqlClient.query<CheckTagsHaveMarkersResponse>({
            query: queries.GET_MARKER_COUNT,
            variables: {
              filter: countFilter,
              scene_marker_filter: Object.keys(countSceneFilter).length > 0 ? countSceneFilter : {},
            },
            signal,
          });
          if (signal?.aborted) return [];
          const totalCount = countResult.data?.findSceneMarkers?.count || 0;
          if (totalCount > 0) {
            const totalPages = Math.ceil(totalCount / limit);
            page = Math.floor(Math.random() * totalPages) + 1;
          }
        } catch (e: unknown) {
          if (isAbortError(e) || signal?.aborted) {
            return [];
          }
          console.warn('Failed to get count for random page, using page 1', e);
        }
      }

      // Check if aborted before main query
      if (signal?.aborted) return [];
      
      {
        // Build filter - start with saved filter criteria if available, then allow manual overrides
        const filter: FindFilterInput = {
          per_page: limit,
          page: page,
        };
        // If saved filter exists, start with its find_filter criteria
        if (savedFilterCriteria?.find_filter) {
          Object.assign(filter, savedFilterCriteria.find_filter);
        }
        // Manual query overrides saved filter query (if user typed something)
        if (filters?.query && filters.query.trim() !== '') {
          filter.q = filters.query;
          console.log('[StashAPI] Applying query filter:', { query: filters.query });
        }
        // Override page with our calculated random page
        filter.page = page;
        filter.per_page = limit;
        // Use random sorting for better randomization (even when filters are active)
        // This randomizes the order of filtered results
        filter.sort = `random_${Math.floor(Math.random() * 1000000)}`;

        // Build scene_marker_filter - start with saved filter object_filter if available
        const sceneMarkerFilterRaw: any = savedFilterCriteria?.object_filter ? { ...savedFilterCriteria.object_filter } : {};
        const sceneMarkerFilter: any = this.normalizeMarkerFilter(sceneMarkerFilterRaw);
        
        // If a saved filter is active, ONLY use its criteria (don't combine with manual filters)
        // Otherwise, apply manual tag filters (primary_tags or tags)
        if (!filters?.savedFilterId) {
          // Use tags if provided, otherwise fall back to primary_tags
          const tagFilter = filters?.tags || filters?.primary_tags;
          if (tagFilter && tagFilter.length > 0) {
            const tagIds = tagFilter
              .map((v) => parseInt(String(v), 10))
              .filter((n) => !Number.isNaN(n));
            if (tagIds.length > 0) {
              // SceneMarkerFilterType tags filter requires: value (array of strings), excludes, modifier, depth
              // For single tag: use INCLUDES_ALL (works the same as INCLUDES for single tag)
              // For multiple tags: use INCLUDES (OR logic) to find markers with ANY of the tags
              // (INCLUDES_ALL would require ALL tags to be present, which is usually not what we want)
              sceneMarkerFilter.tags = {
                value: tagIds.map(id => String(id)), // Array of strings, not numbers
                excludes: [],
                modifier: tagIds.length === 1 ? 'INCLUDES_ALL' : 'INCLUDES', // INCLUDES for multiple tags (OR logic)
                depth: 0
              };
              console.log('[StashAPI] Applying tags filter:', { 
                tagIds: tagIds.map(id => String(id)), 
                modifier: tagIds.length === 1 ? 'INCLUDES_ALL' : 'INCLUDES',
                reason: tagIds.length > 1 ? 'Multiple tags - using INCLUDES (OR logic)' : 'Single tag - using INCLUDES_ALL'
              });
            }
          }
        }
        if (filters?.studios && filters.studios.length > 0) {
          sceneMarkerFilter.scene_tags = { value: filters.studios, modifier: 'INCLUDES' };
        }
        // Filter by performers using the correct field name
        if (filters?.performers && filters.performers.length > 0 && !filters?.savedFilterId) {
          const performerIds = filters.performers
            .map((v) => parseInt(String(v), 10))
            .filter((n) => !Number.isNaN(n));
          if (performerIds.length > 0) {
            // IMPORTANT: value must be an array of numbers, not strings
            // Use INCLUDES for single performer, INCLUDES_ALL for multiple
            sceneMarkerFilter.performers = { 
              value: performerIds, // Array of numbers
              modifier: performerIds.length > 1 ? 'INCLUDES_ALL' : 'INCLUDES' 
            };
            console.log('[StashAPI] Applying performer filter (plugin):', { performerIds, modifier: performerIds.length > 1 ? 'INCLUDES_ALL' : 'INCLUDES' });
          }
        }

        const result = await this.gqlClient.query<FindSceneMarkersResponse>({
          query: queries.FIND_SCENE_MARKERS,
          variables: {
            filter,
            scene_marker_filter: Object.keys(sceneMarkerFilter).length > 0 ? sceneMarkerFilter : {},
          },
          signal,
        });
        if (signal?.aborted) return [];
        const responseData = result.data?.findSceneMarkers;
        let markers = responseData?.scene_markers || [];
        if ((responseData?.count ?? 0) > 0 && markers.length === 0) {
          console.warn('[StashAPI] Count > 0 but no markers returned - retrying with page 1');
          // If count > 0 but no markers, try page 1 instead
          if (filter.page !== 1) {
            if (signal?.aborted) return [];
            filter.page = 1;
            const retryResult = await this.gqlClient.query<FindSceneMarkersResponse>({
              query: queries.FIND_SCENE_MARKERS,
              variables: {
                filter,
                scene_marker_filter: Object.keys(sceneMarkerFilter).length > 0 ? sceneMarkerFilter : {},
              },
              signal,
            });
            if (signal?.aborted) return [];
            const retryData = retryResult.data?.findSceneMarkers;
            markers = retryData?.scene_markers || [];
          }
        }
        
        if (signal?.aborted) return [];
        
        // Filter to scenes with less than 5 markers when shuffle mode is enabled
        if (filters?.shuffleMode && markers.length > 0) {
          markers = this.filterScenesByMarkerCount(markers, 5);
        }
        
        return markers;
      }

      // Fallback (should not be needed with centralized client, but kept for safety)
      // Build filter - start with saved filter criteria if available, then allow manual overrides
      const filter: FindFilterInput = {
        per_page: limit,
        page: page,
      };
      // If saved filter exists, start with its find_filter criteria
      if (savedFilterCriteria !== null && savedFilterCriteria!.find_filter) {
        Object.assign(filter, savedFilterCriteria!.find_filter);
      }
      // Manual query overrides saved filter query (if user typed something)
      const queryValue = filters?.query;
      if (queryValue !== undefined && typeof queryValue === 'string' && queryValue!.trim() !== '') {
        filter.q = queryValue;
        console.log('[StashAPI] Applying query filter (fallback):', { query: queryValue });
      }
      // Override page with our calculated random page
      filter.page = page;
      filter.per_page = limit;
      // Use random sorting for better randomization (even when filters are active)
      // This randomizes the order of filtered results
      filter.sort = `random_${Math.floor(Math.random() * 1000000)}`;

      // Build scene_marker_filter - start with saved filter object_filter if available
      let sceneMarkerFilterRaw: Record<string, unknown> = {};
      if (savedFilterCriteria !== null && savedFilterCriteria!.object_filter) {
        sceneMarkerFilterRaw = { ...(savedFilterCriteria!.object_filter as Record<string, unknown>) };
      }
      const sceneMarkerFilter = this.normalizeMarkerFilter(sceneMarkerFilterRaw);
      
      // If a saved filter is active, ONLY use its criteria (don't combine with manual filters)
      // Otherwise, apply manual tag filters (primary_tags or tags)
      if (filters !== undefined && filters !== null && !filters!.savedFilterId) {
        // Use tags if provided, otherwise fall back to primary_tags
        const tagFilter = filters!.tags || filters!.primary_tags;
        if (tagFilter !== undefined && Array.isArray(tagFilter) && tagFilter!.length > 0) {
          const tagIds = tagFilter!
            .map((v) => parseInt(String(v), 10))
            .filter((n) => !Number.isNaN(n));
          if (tagIds.length > 0) {
                // SceneMarkerFilterType tags filter requires: value (array of strings), excludes, modifier, depth
                // For single tag: use INCLUDES_ALL (works the same as INCLUDES for single tag)
                // For multiple tags: use INCLUDES (OR logic) to find markers with ANY of the tags
                // (INCLUDES_ALL would require ALL tags to be present, which is usually not what we want)
                sceneMarkerFilter.tags = {
                  value: tagIds.map(id => String(id)), // Array of strings, not numbers
                  excludes: [],
                  modifier: tagIds.length === 1 ? 'INCLUDES_ALL' : 'INCLUDES', // INCLUDES for multiple tags (OR logic)
                  depth: 0
                };
                console.log('[StashAPI] Applying tags filter (fallback):', { 
                  tagIds: tagIds.map(id => String(id)), 
                  modifier: tagIds.length === 1 ? 'INCLUDES_ALL' : 'INCLUDES',
                  reason: tagIds.length > 1 ? 'Multiple tags - using INCLUDES (OR logic)' : 'Single tag - using INCLUDES_ALL'
                });
              } else {
            console.warn('Scene marker tags must be numeric IDs; ignoring provided values', { tagFilter });
          }
        }
      }
      // Filter by performers using the correct field name
      if (filters !== undefined && filters !== null && !filters!.savedFilterId && filters!.performers !== undefined && Array.isArray(filters!.performers) && filters!.performers!.length > 0) {
        const performerIds = filters!.performers!
          .map((v) => parseInt(String(v), 10))
          .filter((n) => !Number.isNaN(n));
        if (performerIds.length > 0) {
                // IMPORTANT: value must be an array of numbers, not strings
                // Use INCLUDES for single performer, INCLUDES_ALL for multiple
                sceneMarkerFilter.performers = { 
                  value: performerIds, // Array of numbers
                  modifier: performerIds.length > 1 ? 'INCLUDES_ALL' : 'INCLUDES' 
                };
          console.log('[StashAPI] Applying performer filter:', { performerIds, modifier: performerIds.length > 1 ? 'INCLUDES_ALL' : 'INCLUDES' });
        }
      }

      const variables = { 
        filter,
        scene_marker_filter: Object.keys(sceneMarkerFilter).length > 0 ? sceneMarkerFilter : {}
      };

      const result = await this.gqlClient.query<FindSceneMarkersResponse>({
        query: queries.FIND_SCENE_MARKERS,
        variables,
        signal,
      });

      if (signal?.aborted) return [];
      
      const responseData = result.data?.findSceneMarkers;
      let markers = responseData?.scene_markers || [];
      if ((responseData?.count ?? 0) > 0 && markers.length === 0) {
        console.warn('[StashAPI] Count > 0 but no markers returned - possible page calculation issue');
        // If count > 0 but no markers, try page 1 instead
        if (filter.page !== 1) {
          if (signal?.aborted) return [];
          filter.page = 1;
          const retryResponse = await fetch(`${this.baseUrl}/graphql`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(this.apiKey && { 'ApiKey': this.apiKey }),
            },
            body: JSON.stringify({
              query: queries.FIND_SCENE_MARKERS,
              variables: {
                filter,
                scene_marker_filter: Object.keys(sceneMarkerFilter).length > 0 ? sceneMarkerFilter : {}
              },
            }),
            signal,
          });
          if (signal?.aborted) return [];
          if (retryResponse.ok) {
            const retryData = await retryResponse.json() as GraphQLResponse<FindSceneMarkersResponse>;
            if (signal?.aborted) return [];
            if (!retryData.errors) {
              markers = retryData.data?.findSceneMarkers?.scene_markers || [];
            }
          }
        }
      }
      
      if (signal?.aborted) return [];
      
      // Filter to scenes with less than 5 markers when shuffle mode is enabled
      if (filters?.shuffleMode && markers.length > 0) {
        markers = this.filterScenesByMarkerCount(markers, 5);
      }
      
      return markers;
    } catch (e: any) {
      // Ignore AbortError - it's expected when cancelling
      if (e.name === 'AbortError' || signal?.aborted) {
        return [];
      }
      console.error('Error fetching scene markers:', e);
      return [];
    }
  }

  /**
   * Fetch scene markers from Stash using REST API endpoint
   * Uses /scenes/markers endpoint with query parameters for filtering and sorting
   * This is the primary method - GraphQL is kept as fallback
   */
  async fetchSceneMarkersREST(filters?: FilterOptions, signal?: AbortSignal): Promise<SceneMarker[]> {
    // Check if already aborted
    if (signal?.aborted) return [];
    
    // In shuffle mode, query scenes directly to include scenes with 0 markers
    if (filters?.shuffleMode) {
      return this.fetchScenesForShuffle(filters, signal);
    }

    try {
      const limit = filters?.limit || 32;
      const perPage = limit;
      
      // Build query parameters
      const params = new URLSearchParams();
      
      // Random sorting - generate random sort key
      // Always use random sorting for better randomization
      const randomSortKey = Math.floor(Math.random() * 1000000);
      params.set('sortby', `random_${randomSortKey}`);
      params.set('sortdir', 'desc');
      params.set('perPage', perPage.toString());
      
      // Handle tag filtering - prioritize primary_tags over tags
      // Use primary_tags if available, otherwise fall back to tags
      const tagFilter = filters?.primary_tags || filters?.tags;
      if (tagFilter && tagFilter.length > 0) {
        const tagIds = tagFilter
          .map((v) => String(v)) // Keep as strings to match GraphQL format
          .filter((id) => id && id.trim().length > 0);
        
        if (tagIds.length > 0) {
          // Build filter criteria in REST API format
          // Based on GraphQL structure: tags with modifier, value (array of string IDs), depth, excludes
          // REST API format: {"type":"tags","modifier":"INCLUDES_ALL","value":{"items":[{"id":"159","label":"Ball Sucking"}],"excluded":[],"depth":0}}
          // But we can also try the simpler format that matches GraphQL more closely
          const filterCriteria = {
            type: 'tags',
            modifier: tagIds.length > 1 ? 'INCLUDES_ALL' : 'INCLUDES',
            value: {
              items: tagIds.map(id => ({ id: String(id), label: '' })), // Label not needed for filtering by ID
              excluded: [],
              depth: 0
            }
          };
          
          // URL-encode the JSON filter criteria
          // URLSearchParams will handle encoding, but we need to ensure proper format
          const filterJson = JSON.stringify(filterCriteria);
          params.set('c', filterJson);
        }
      }
      
      // Handle query string if provided
      if (filters?.query && filters.query.trim() !== '') {
        params.set('q', filters.query.trim());
      }
      
      // Build the full URL
      const url = `${this.baseUrl}/scenes/markers?${params.toString()}`;
      
      // Make the request
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { 'ApiKey': this.apiKey }),
        },
        signal,
      });

      if (signal?.aborted) return [];
      if (!response.ok) {
        const errorText = await response.text();
        console.error('REST API request failed', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        throw new Error(`REST API request failed: ${response.status} ${response.statusText}`);
      }

      // Check content type before parsing
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.warn('REST API returned non-JSON response, falling back to GraphQL', {
          contentType,
          preview: text.substring(0, 200)
        });
        throw new Error('REST API returned non-JSON response');
      }

      const data = await response.json();
      if (signal?.aborted) return [];
      
      // Parse REST API response and convert to SceneMarker format
      // The REST API response structure may vary, but typically returns an array of markers
      // or an object with a markers/scene_markers property
      let markers: any[] = [];
      
      if (Array.isArray(data)) {
        markers = data;
      } else if (data.scene_markers && Array.isArray(data.scene_markers)) {
        markers = data.scene_markers;
      } else if (data.markers && Array.isArray(data.markers)) {
        markers = data.markers;
      } else if (data.results && Array.isArray(data.results)) {
        markers = data.results;
      }
      
      // Convert REST API marker format to SceneMarker format
      const sceneMarkers: SceneMarker[] = markers.map((marker: any) => {
        // Handle different possible REST API response formats
        const markerId = marker.id || marker.marker_id;
        const sceneId = marker.scene?.id || marker.scene_id;
        const sceneData = marker.scene || {};
        
        return {
          id: String(markerId),
          title: marker.title || marker.name || '',
          seconds: marker.seconds || marker.start_time || 0,
          end_seconds: marker.end_seconds || marker.end_time,
          stream: marker.stream || marker.stream_url,
          preview: marker.preview || marker.preview_url,
          primary_tag: marker.primary_tag ? {
            id: String(marker.primary_tag.id || marker.primary_tag.tag_id),
            name: marker.primary_tag.name || marker.primary_tag.tag_name || ''
          } : undefined,
          tags: (marker.tags || []).map((tag: any) => ({
            id: String(tag.id || tag.tag_id),
            name: tag.name || tag.tag_name || ''
          })),
          scene: {
            id: String(sceneId),
            title: sceneData.title,
            date: sceneData.date,
            details: sceneData.details,
            url: sceneData.url,
            rating100: sceneData.rating100 || sceneData.rating,
            o_counter: sceneData.o_counter || sceneData.oCounter,
            studio: sceneData.studio ? {
              id: String(sceneData.studio.id || sceneData.studio.studio_id),
              name: sceneData.studio.name || sceneData.studio.studio_name || ''
            } : undefined,
            performers: (sceneData.performers || []).map((perf: any) => ({
              id: String(perf.id || perf.performer_id),
              name: perf.name || perf.performer_name || '',
              image_path: perf.image_path || perf.imagePath
            })),
            tags: (sceneData.tags || []).map((tag: any) => ({
              id: String(tag.id || tag.tag_id),
              name: tag.name || tag.tag_name || ''
            })),
            files: (sceneData.files || []).map((file: any) => ({
              id: String(file.id || file.file_id),
              path: file.path || file.file_path || '',
              size: file.size,
              duration: file.duration,
              video_codec: file.video_codec || file.videoCodec,
              audio_codec: file.audio_codec || file.audioCodec,
              width: file.width,
              height: file.height,
              bit_rate: file.bit_rate || file.bitRate
            })),
            paths: sceneData.paths ? {
              screenshot: sceneData.paths.screenshot,
              preview: sceneData.paths.preview,
              stream: sceneData.paths.stream,
              webp: sceneData.paths.webp,
              vtt: sceneData.paths.vtt
            } : undefined,
            sceneStreams: sceneData.sceneStreams || sceneData.scene_streams || []
          }
        };
      });
      
      // Filter to scenes with less than 5 markers when shuffle mode is enabled
      if (filters?.shuffleMode && sceneMarkers.length > 0) {
        return this.filterScenesByMarkerCount(sceneMarkers, 5);
      }
      
      return sceneMarkers;
    } catch (e: any) {
      // Ignore AbortError - it's expected when cancelling
      if (e.name === 'AbortError' || signal?.aborted) {
        return [];
      }
      console.warn('REST API request failed, falling back to GraphQL:', e);
      // Fallback to GraphQL method if REST API fails
      return this.fetchSceneMarkers(filters, signal);
    }
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

      // Calculate random page if no offset
      if (!filters?.offset) {
        const countFilter: FindFilterInput = { per_page: 1, page: 1 };
        let sceneFilter: SceneFilterInput | null = null;
        
        // Use has_markers filter based on includeScenesWithoutMarkers preference
        // Mode 1 (includeScenesWithoutMarkers = false): All scenes (no filter)
        // Mode 2 (includeScenesWithoutMarkers = true): Only scenes with no markers (has_markers = false)
        if (filters?.includeScenesWithoutMarkers) {
          // Only scenes with no markers - use string "false"
          sceneFilter = { has_markers: 'false' };
        }
        // If includeScenesWithoutMarkers is false, sceneFilter stays null (no filter = all scenes)

        try {
          if (signal?.aborted) return [];
          const countResult = await this.gqlClient.query<FindScenesResponse>({
            query: queries.GET_SCENE_COUNT,
            variables: { filter: countFilter, ...(sceneFilter && { scene_filter: sceneFilter }) },
            signal,
          });
          if (signal?.aborted) return [];
          const totalCount = countResult.data?.findScenes?.count || 0;
          if (totalCount > 0) {
            const totalPages = Math.ceil(totalCount / limit);
            page = Math.floor(Math.random() * totalPages) + 1;
          }
        } catch (e: unknown) {
          if (isAbortError(e) || signal?.aborted) {
            return [];
          }
          console.warn('Failed to get scene count for shuffle, using page 1', e);
        }
      }

      if (signal?.aborted) return [];

      const filter: FindFilterInput = {
        per_page: limit,
        page: page,
        sort: `random_${Math.floor(Math.random() * 1000000)}`,
      };

      let sceneFilter: SceneFilterInput | null = null;
      
      // Use has_markers filter based on includeScenesWithoutMarkers preference
      // Mode 1 (includeScenesWithoutMarkers = false): All scenes (no filter)
      // Mode 2 (includeScenesWithoutMarkers = true): Only scenes with no markers (has_markers = false)
      if (filters?.includeScenesWithoutMarkers) {
        // Only scenes with no markers - use string "false"
        sceneFilter = { has_markers: 'false' };
      }
      // If includeScenesWithoutMarkers is false, sceneFilter stays null (no filter = all scenes)

      let scenes: Scene[] = [];

      const result = await this.gqlClient.query<FindScenesResponse>({
        query: queries.FIND_SCENES,
        variables: { filter, ...(sceneFilter && { scene_filter: sceneFilter }) },
        signal,
      });
      if (signal?.aborted) return [];
      scenes = result.data?.findScenes?.scenes || [];

      // Create synthetic markers for each scene (one per scene, starting at 0 seconds)
      // This allows us to display scenes with 0 markers
      // Note: Synthetic markers don't have marker stream URLs, so they won't work in non-HD mode
      // They will only work in HD mode (which uses full scene videos)
      const syntheticMarkers: SceneMarker[] = scenes.map((scene) => ({
        id: `synthetic-${scene.id}-${Date.now()}-${Math.random()}`,
        title: scene.title || 'Untitled',
        seconds: 0, // Will be randomized in createPost when shuffle mode is active
        stream: undefined, // No marker stream for synthetic markers - they require HD mode
        scene: scene,
        primary_tag: undefined,
        tags: [],
      }));

      return syntheticMarkers;
    } catch (e: unknown) {
      if (isAbortError(e) || signal?.aborted) {
        return [];
      }
      console.error('Error fetching scenes for shuffle', e);
      return [];
    }
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
    // Use marker stream URL if available
    if (marker.stream) {
      // Check for empty or whitespace-only stream
      const stream = marker.stream.trim();
      if (!stream || stream.length === 0) {
        // Fallback to scene stream
        return this.getVideoUrl(marker.scene);
      }
      
      let url = stream.startsWith('http') 
        ? stream 
        : `${this.baseUrl}${stream}`;
      
      // Validate URL before returning
      if (!isValidMediaUrl(url)) {
        // Fallback to scene stream
        return this.getVideoUrl(marker.scene);
      }
      
      // Add cache-busting to prevent 304 responses with empty/corrupted cache
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}t=${Date.now()}`;
      
      return url;
    }
    // Fallback to scene stream
    return this.getVideoUrl(marker.scene);
  }

  /**
   * Get video URL for a scene
   */
  getVideoUrl(scene: Scene): string | undefined {
    let url: string | undefined;
    
    // Prefer sceneStreams if available (often provides mp4)
    if (scene.sceneStreams && scene.sceneStreams.length > 0) {
      const streamUrl = scene.sceneStreams[0]?.url;
      if (!streamUrl || streamUrl.trim().length === 0) {
        // Try next fallback
      } else {
        url = streamUrl.startsWith('http') ? streamUrl : `${this.baseUrl}${streamUrl}`;
        if (isValidMediaUrl(url)) {
          // Add cache-busting to prevent 304 responses with empty/corrupted cache
          const separator = url.includes('?') ? '&' : '?';
          return `${url}${separator}t=${Date.now()}`;
        }
      }
    }
    // Use stream path if available, otherwise use file path
    if (scene.paths?.stream) {
      const streamPath = scene.paths.stream.trim();
      if (streamPath && streamPath.length > 0) {
        url = streamPath.startsWith('http') 
          ? streamPath 
          : `${this.baseUrl}${streamPath}`;
        if (isValidMediaUrl(url)) {
          // Add cache-busting to prevent 304 responses with empty/corrupted cache
          const separator = url.includes('?') ? '&' : '?';
          return `${url}${separator}t=${Date.now()}`;
        }
      }
    }
    if (scene.files && scene.files.length > 0) {
      const filePath = scene.files[0]?.path;
      if (filePath && filePath.trim().length > 0) {
        url = filePath.startsWith('http')
          ? filePath
          : `${this.baseUrl}${filePath}`;
        if (isValidMediaUrl(url)) {
          // Add cache-busting to prevent 304 responses with empty/corrupted cache
          const separator = url.includes('?') ? '&' : '?';
          return `${url}${separator}t=${Date.now()}`;
        }
      }
    }
    return undefined;
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
      return tags.length > 0 ? tags[0] : null;
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
    } catch (error: any) {
      // If tag already exists, try to find it
      const errorMessage = error?.message || '';
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
   * Add a tag to a scene (kept for backwards compatibility)
   */
  async addTagToScene(sceneId: string, tagId: string): Promise<void> {
    // First get current scene tags
    const query = `query FindScene($id: ID!) {
      findScene(id: $id) {
        id
        tags {
          id
        }
      }
    }`;

    const mutation = `mutation SceneUpdate($input: SceneUpdateInput!) {
      sceneUpdate(input: $input) {
        id
      }
    }`;

    try {
      // Get current tags
      const result = await this.gqlClient.query<FindSceneResponse>({
        query: query,
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
    const query = `query FindScene($id: ID!) {
      findScene(id: $id) {
        id
        tags {
          id
        }
      }
    }`;

    const mutation = `mutation SceneUpdate($input: SceneUpdateInput!) {
      sceneUpdate(input: $input) {
        id
      }
    }`;

    try {
      // Get current tags
      const result = await this.gqlClient.query<FindSceneResponse>({
        query: query,
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
        mutation: mutation,
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
    const mutation = `mutation SceneAddO($id: ID!, $times: [Timestamp!]) {
      sceneAddO(id: $id, times: $times) {
        count
        history
      }
    }`;

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
      if (sceneAddO && 'o_counter' in sceneAddO) {
        return { count: sceneAddO.o_counter ?? 0, history: times || [] };
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
  ): Promise<{ id: string; title: string; seconds: number; end_seconds?: number; stream?: string; preview?: string; scene: any; primary_tag: { id: string; name: string }; tags: Array<{ id: string; name: string }> }> {
    const mutation = `mutation SceneMarkerCreate($title: String!, $seconds: Float!, $end_seconds: Float, $scene_id: ID!, $primary_tag_id: ID!, $tag_ids: [ID!] = []) {
      sceneMarkerCreate(
        input: {title: $title, seconds: $seconds, end_seconds: $end_seconds, scene_id: $scene_id, primary_tag_id: $primary_tag_id, tag_ids: $tag_ids}
      ) {
        id
        title
        seconds
        end_seconds
        stream
        preview
        screenshot
        scene {
          id
          title
          files {
            width
            height
            path
          }
          performers {
            id
            name
            image_path
          }
        }
        primary_tag {
          id
          name
        }
        tags {
          id
          name
        }
      }
    }`;

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
    // Note: sceneMarkerTags may return an array or a single object depending on Stash version
    // We handle both cases in the parsing logic below

    try {
      if (signal?.aborted) return [];

      const result = await this.gqlClient.query<FindSceneMarkerTagsResponse>({
        query: queries.FIND_SCENE_MARKER_TAGS,
        variables: { id: sceneId },
        signal,
      });
      if (signal?.aborted) return [];
      
      const sceneMarkerTags = result.data?.sceneMarkerTags;
      if (!sceneMarkerTags) {
        return [];
      }

      // Extract seconds from all markers
      // sceneMarkerTags can be an array (multiple tag groups) or a single object
      const markerTimes: number[] = [];
      const tagGroups = Array.isArray(sceneMarkerTags) ? sceneMarkerTags : [sceneMarkerTags];
      
      for (const tagGroup of tagGroups) {
        if (tagGroup.scene_markers && Array.isArray(tagGroup.scene_markers)) {
          for (const marker of tagGroup.scene_markers) {
            if (typeof marker.seconds === 'number') {
              markerTimes.push(marker.seconds);
            }
          }
        }
      }
      return markerTimes;
    } catch (e: unknown) {
      if (isAbortError(e) || signal?.aborted) {
        return [];
      }
      console.warn('StashAPI: Failed to fetch scene marker tags', e);
      return [];
    }
  }
}



