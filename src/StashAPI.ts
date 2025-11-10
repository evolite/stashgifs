/**
 * Stash API integration
 * This will interface with the Stash GraphQL API
 */

import { Scene, SceneMarker, FilterOptions, Performer } from './types.js';
import { isValidMediaUrl, getOptimizedThumbnailUrl } from './utils.js';

interface StashPluginApi {
  GQL: {
    useFindScenesQuery?: (variables: any) => { data?: any; loading: boolean };
    client?: {
      query: (options: { query: any; variables?: any }) => Promise<{ data: any }>;
      mutate?: (options: { mutation: any; variables?: any }) => Promise<{ data: any }>;
    };
  };
  baseURL?: string;
  apiKey?: string;
}

export class StashAPI {
  private baseUrl: string;
  private apiKey?: string
  // Cache for tags/performers that have markers (to avoid repeated checks)
  private tagsWithMarkersCache: Set<number> = new Set();
  private performersWithMarkersCache: Set<number> = new Set();;
  private pluginApi?: StashPluginApi;
  // Request deduplication - cache in-flight requests
  private pendingRequests: Map<string, Promise<any>> = new Map();
  // Simple cache for search results (TTL: 5 minutes)
  private searchCache: Map<string, { data: any; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private cacheCleanupInterval?: ReturnType<typeof setInterval>;
  private readonly MAX_CACHE_SIZE = 1000; // Maximum cache entries before cleanup
  private readonly MAX_TAG_CACHE_SIZE = 1000; // Maximum tag/performer cache entries

  constructor(baseUrl?: string, apiKey?: string) {
    // Get from window if available (Stash plugin context)
    const windowAny = window as any;
    this.pluginApi = windowAny.PluginApi || windowAny.stash;
    
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
    
    // Limit tag cache size (remove oldest entries if over limit)
    // Since Set doesn't track insertion order, we'll clear and rebuild if too large
    if (this.tagsWithMarkersCache.size > this.MAX_TAG_CACHE_SIZE) {
      // Clear half of the cache (simple approach)
      const entries = Array.from(this.tagsWithMarkersCache);
      this.tagsWithMarkersCache.clear();
      // Keep the most recent half (approximation)
      const keepCount = Math.floor(this.MAX_TAG_CACHE_SIZE / 2);
      for (let i = entries.length - keepCount; i < entries.length; i++) {
        this.tagsWithMarkersCache.add(entries[i]);
      }
    }
    
    // Limit performer cache size (same approach)
    if (this.performersWithMarkersCache.size > this.MAX_TAG_CACHE_SIZE) {
      const entries = Array.from(this.performersWithMarkersCache);
      this.performersWithMarkersCache.clear();
      const keepCount = Math.floor(this.MAX_TAG_CACHE_SIZE / 2);
      for (let i = entries.length - keepCount; i < entries.length; i++) {
        this.performersWithMarkersCache.add(entries[i]);
      }
    }
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
  private normalizeMarkerFilter(input: any): any {
    if (!input || typeof input !== 'object') return {};
    const out = { ...input };

    const normalizeIdArray = (val: any): number[] | undefined => {
      if (!val) return undefined;
      const arr = Array.isArray(val) ? val : [val];
      const ids = arr
        .map((x) => (typeof x === 'object' && x !== null ? (x.id ?? x.value ?? x) : x))
        .map((x) => parseInt(String(x), 10))
        .filter((n) => !Number.isNaN(n));
      return ids.length ? ids : undefined;
    };

    // Handle tags shapes: either { value, modifier } OR an array of objects/ids
    if (out.tags) {
      // Case 1: array of ids/objects
      if (Array.isArray(out.tags)) {
        const ids = normalizeIdArray(out.tags);
        if (ids) out.tags = { value: ids, modifier: 'INCLUDES' };
        else delete out.tags;
      } else if (typeof out.tags === 'object') {
        // Case 2: { value: number[] | { items:[{id,label}], ... }, modifier? }
        let raw = out.tags.value;
        // Stash saved filter format: value: { items: [{id,label},...], excluded:[], depth:-1 }
        if (raw && typeof raw === 'object' && Array.isArray(raw.items)) {
          raw = raw.items;
        }
        const ids = normalizeIdArray(raw);
        if (ids) out.tags = { value: ids, modifier: out.tags.modifier ?? 'INCLUDES' };
        else delete out.tags;
      }
    }

    // Handle scene_tags similarly
    if (out.scene_tags) {
      if (Array.isArray(out.scene_tags)) {
        const ids = normalizeIdArray(out.scene_tags);
        if (ids) out.scene_tags = { value: ids, modifier: 'INCLUDES' };
        else delete out.scene_tags;
      } else if (typeof out.scene_tags === 'object') {
        let raw = out.scene_tags.value;
        if (raw && typeof raw === 'object' && Array.isArray(raw.items)) {
          raw = raw.items;
        }
        const ids = normalizeIdArray(raw);
        if (ids) out.scene_tags = { value: ids, modifier: out.scene_tags.modifier ?? 'INCLUDES' };
        else delete out.scene_tags;
      }
    }

    // Handle scene_performers similarly
    if (out.scene_performers) {
      if (Array.isArray(out.scene_performers)) {
        const ids = normalizeIdArray(out.scene_performers);
        if (ids) out.scene_performers = { value: ids, modifier: 'INCLUDES' };
        else delete out.scene_performers;
      } else if (typeof out.scene_performers === 'object') {
        let raw = out.scene_performers.value;
        if (raw && typeof raw === 'object' && Array.isArray(raw.items)) {
          raw = raw.items;
        }
        const ids = normalizeIdArray(raw);
        if (ids) out.scene_performers = { value: ids, modifier: out.scene_performers.modifier ?? 'INCLUDES' };
        else delete out.scene_performers;
      }
    }

    return out;
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
        results.add(tagId);
      } else {
        uncachedIds.push(tagId);
      }
    }
    
    if (uncachedIds.length === 0) return results;
    
    const query = `query CheckTagsHaveMarkers($scene_marker_filter: SceneMarkerFilterType) {
      findSceneMarkers(scene_marker_filter: $scene_marker_filter) {
        count
      }
    }`;
    
    const sceneMarkerFilter = {
      tags: { value: tagIds, modifier: 'INCLUDES' as const }
    };
    
    try {
      if (this.pluginApi?.GQL?.client) {
        const result = await this.pluginApi.GQL.client.query({
          query: query as any,
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
                  const batchQuery = `query CheckTagHasMarkers($scene_marker_filter: SceneMarkerFilterType) {
                    findSceneMarkers(scene_marker_filter: $scene_marker_filter) {
                      count
                    }
                  }`;
                  const batchFilter = { tags: { value: [tagId], modifier: 'INCLUDES' as const } };
                  try {
                    if (this.pluginApi?.GQL?.client) {
                      const batchResult = await this.pluginApi.GQL.client.query({
                        query: batchQuery as any,
                        variables: { scene_marker_filter: batchFilter }
                      });
                      return batchResult.data?.findSceneMarkers?.count > 0 ? tagId : null;
                    } else {
                      const response = await fetch(`${this.baseUrl}/graphql`, {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          ...(this.apiKey && { 'ApiKey': this.apiKey }),
                        },
                        body: JSON.stringify({ query: batchQuery, variables: { scene_marker_filter: batchFilter } }),
                      });
                      const data = await response.json();
                      return data.data?.findSceneMarkers?.count > 0 ? tagId : null;
                    }
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
              this.tagsWithMarkersCache.add(id); // Cache positive results
            }
          });
        }
        return results;
      } else {
        // Fallback: check individually but in smaller batches (with parallel batch processing)
        const batchSize = 5;
        const maxConcurrentBatches = 3;
        const batches: number[][] = [];
        for (let i = 0; i < uncachedIds.length; i += batchSize) {
          batches.push(uncachedIds.slice(i, i + batchSize));
        }
        
        for (let i = 0; i < batches.length; i += maxConcurrentBatches) {
          const concurrentBatches = batches.slice(i, i + maxConcurrentBatches);
          const batchResults = await Promise.all(
            concurrentBatches.map(async (batch) => {
              const batchChecks = await Promise.all(
                batch.map(async (tagId) => {
                  const batchQuery = `query CheckTagHasMarkers($scene_marker_filter: SceneMarkerFilterType) {
                    findSceneMarkers(scene_marker_filter: $scene_marker_filter) {
                      count
                    }
                  }`;
                  const batchFilter = { tags: { value: [tagId], modifier: 'INCLUDES' } };
                  try {
                    const response = await fetch(`${this.baseUrl}/graphql`, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        ...(this.apiKey && { 'ApiKey': this.apiKey }),
                      },
                      body: JSON.stringify({ query: batchQuery, variables: { scene_marker_filter: batchFilter } }),
                    });
                    const data = await response.json();
                    return data.data?.findSceneMarkers?.count > 0 ? tagId : null;
                  } catch {
                    return null;
                  }
                })
              );
              return batchChecks;
            })
          );
          
          batchResults.flat().forEach(id => { 
            if (id !== null) {
              results.add(id);
              this.tagsWithMarkersCache.add(id); // Cache positive results
            }
          });
        }
        return results;
      }
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
              const query = `query CheckPerformerHasMarkers($scene_marker_filter: SceneMarkerFilterType) {
                findSceneMarkers(scene_marker_filter: $scene_marker_filter) {
                  count
                }
              }`;
              const sceneMarkerFilter = { performers: { value: [performerId], modifier: 'INCLUDES_ALL' as const } };
              try {
                if (this.pluginApi?.GQL?.client) {
                  const result = await this.pluginApi.GQL.client.query({
                    query: query as any,
                    variables: { scene_marker_filter: sceneMarkerFilter }
                  });
                  return result.data?.findSceneMarkers?.count > 0 ? performerId : null;
                } else {
                  const response = await fetch(`${this.baseUrl}/graphql`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      ...(this.apiKey && { 'ApiKey': this.apiKey }),
                    },
                    body: JSON.stringify({ query, variables: { scene_marker_filter: sceneMarkerFilter } }),
                  });
                  const data = await response.json();
                  return data.data?.findSceneMarkers?.count > 0 ? performerId : null;
                }
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
          this.performersWithMarkersCache.add(id); // Cache positive results
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
        return cached.data;
      }
    }
    
    // Check for in-flight request (deduplication)
    const requestKey = `searchMarkerTags:${term}:${limit}`;
    const pending = this.pendingRequests.get(requestKey);
    if (pending) {
      return pending;
    }
    
    // Create new request
    const request = this._searchMarkerTags(term, limit, signal);
    this.pendingRequests.set(requestKey, request);
    
    try {
      const result = await request;
      // Cache the result (only for non-empty terms)
      if (!isEmptyTerm) {
        const cacheKey = `tags:${term}:${limit}`;
        this.searchCache.set(cacheKey, { data: result, timestamp: Date.now() });
      }
      return result;
    } finally {
      // Remove from pending requests
      this.pendingRequests.delete(requestKey);
    }
  }
  
  /**
   * Internal implementation of searchMarkerTags
   */
  private async _searchMarkerTags(term: string, limit: number = 10, signal?: AbortSignal): Promise<Array<{ id: string; name: string }>> {
    const query = `query FindTags($filter: FindFilterType, $tag_filter: TagFilterType) {
      findTags(filter: $filter, tag_filter: $tag_filter) {
        tags { id name }
      }
    }`;
    
    // When no search term, fetch a smaller assortment for faster loading
    // When searching, fetch more tags matching the search term
    const fetchLimit = term && term.trim() !== '' ? limit * 3 : Math.max(limit, 20);
    const filter: any = { per_page: fetchLimit, page: 1 };
    
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
    const tag_filter: any = {
      marker_count: {
        value: (term && term.trim() !== '') ? 0 : 10,
        modifier: 'GREATER_THAN'
      }
    };
    
    const variables = { filter, tag_filter };

    try {
      // Check if already aborted
      if (signal?.aborted) return [];
      
      let tags: Array<{ id: string; name: string }> = [];
      if (this.pluginApi?.GQL?.client) {
        const result = await this.pluginApi.GQL.client.query({ query: query as any, variables });
        // Check if aborted after query
        if (signal?.aborted) return [];
        tags = result.data?.findTags?.tags ?? [];
      } else {
        const response = await fetch(`${this.baseUrl}/graphql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey && { 'ApiKey': this.apiKey }),
          },
          body: JSON.stringify({ query, variables }),
          signal,
        });
        if (signal?.aborted) return [];
        if (!response.ok) return [];
        const data = await response.json();
        if (signal?.aborted) return [];
        tags = data.data?.findTags?.tags ?? [];
      }
      
      // Check if aborted before processing
      if (signal?.aborted) return [];
      
      // Return tags (already randomly sorted by GraphQL when no search term)
      return tags.slice(0, limit);
    } catch (e: any) {
      // Ignore AbortError - it's expected when cancelling
      if (e.name === 'AbortError' || signal?.aborted) {
        return [];
      }
      console.warn('searchMarkerTags failed', e);
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
        return cached.data;
      }
    }
    
    // Check for in-flight request (deduplication)
    const requestKey = `searchPerformers:${term}:${limit}`;
    const pending = this.pendingRequests.get(requestKey);
    if (pending) {
      return pending;
    }
    
    // Create new request
    const request = this._searchPerformers(term, limit, signal);
    this.pendingRequests.set(requestKey, request);
    
    try {
      const result = await request;
      // Cache the result (only for non-empty terms)
      if (!isEmptyTerm) {
        const cacheKey = `performers:${term}:${limit}`;
        this.searchCache.set(cacheKey, { data: result, timestamp: Date.now() });
      }
      return result;
    } finally {
      // Remove from pending requests
      this.pendingRequests.delete(requestKey);
    }
  }
  
  /**
   * Internal implementation of searchPerformers
   */
  private async _searchPerformers(term: string, limit: number = 10, signal?: AbortSignal): Promise<Array<{ id: string; name: string; image_path?: string }>> {
    const query = `query FindPerformers($filter: FindFilterType, $performer_filter: PerformerFilterType) {
      findPerformers(filter: $filter, performer_filter: $performer_filter) {
        performers { id name image_path }
      }
    }`;
    
    // When no search term, fetch a smaller assortment for faster loading
    // When searching, fetch more performers matching the search term
    const fetchLimit = term && term.trim() !== '' ? limit * 3 : Math.max(limit, 20);
    const filter: any = { per_page: fetchLimit, page: 1 };
    
    // Only add query if term is provided and not empty
    if (term && term.trim() !== '') {
      filter.q = term.trim();
    } else {
      // When no search term, use random sorting to get a diverse assortment
      filter.sort = `random_${Math.floor(Math.random() * 1000000)}`;
    }
    
    // Filter to only performers with at least 1 scene (for autocompletion)
    const performer_filter: any = {
      scene_count: {
        value: 0,
        modifier: 'GREATER_THAN'
      }
    };
    
    const variables = { filter, performer_filter };

    try {
      // Check if already aborted
      if (signal?.aborted) return [];
      
      let performers: Array<{ id: string; name: string; image_path?: string }> = [];
      if (this.pluginApi?.GQL?.client) {
        const result = await this.pluginApi.GQL.client.query({ query: query as any, variables });
        // Check if aborted after query
        if (signal?.aborted) return [];
        performers = result.data?.findPerformers?.performers ?? [];
      } else {
        const response = await fetch(`${this.baseUrl}/graphql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey && { 'ApiKey': this.apiKey }),
          },
          body: JSON.stringify({ query, variables }),
          signal,
        });
        if (signal?.aborted) return [];
        if (!response.ok) return [];
        const data = await response.json();
        if (signal?.aborted) return [];
        performers = data.data?.findPerformers?.performers ?? [];
      }
      
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
    const query = `query GetSavedMarkerFilters { findSavedFilters(mode: SCENE_MARKERS) { id name } }`;
    try {
      // Check if already aborted
      if (signal?.aborted) return [];
      
      if (this.pluginApi?.GQL?.client) {
        const result = await this.pluginApi.GQL.client.query({ query: query as any });
        // Check if aborted after query
        if (signal?.aborted) return [];
        return result.data?.findSavedFilters || [];
      }
      const response = await fetch(`${this.baseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { 'ApiKey': this.apiKey }),
        },
        body: JSON.stringify({ query }),
        signal,
      });
      if (signal?.aborted) return [];
      if (!response.ok) return [];
      const data = await response.json();
      if (signal?.aborted) return [];
      return data.data?.findSavedFilters || [];
    } catch (e: any) {
      // Ignore AbortError - it's expected when cancelling
      if (e.name === 'AbortError' || signal?.aborted) {
        return [];
      }
      console.error('Error fetching saved marker filters:', e);
      return [];
    }
  }

  /**
   * Get a saved filter's criteria
   */
  async getSavedFilter(id: string): Promise<any> {
    const query = `query GetSavedFilter($id: ID!) {
      findSavedFilter(id: $id) {
        id
        name
        mode
        find_filter {
          q
          per_page
          page
        }
        object_filter
      }
    }`;
    try {
      if (this.pluginApi?.GQL?.client) {
        const result = await this.pluginApi.GQL.client.query({ 
          query: query as any,
          variables: { id }
        });
        return result.data?.findSavedFilter;
      }
      const response = await fetch(`${this.baseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { 'ApiKey': this.apiKey }),
        },
        body: JSON.stringify({ query, variables: { id } }),
      });
      const data = await response.json();
      return data.data?.findSavedFilter;
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
    
    // In shuffle mode, query scenes directly to include scenes with 0 markers
    if (filters?.shuffleMode) {
      return this.fetchScenesForShuffle(filters, signal);
    }
    
    // If a saved filter is specified, fetch its criteria first
    let savedFilterCriteria: any = null;
    if (filters?.savedFilterId) {
      savedFilterCriteria = await this.getSavedFilter(filters.savedFilterId);
      if (signal?.aborted) return [];
    }

    // Query for scene markers based on FindSceneMarkersForTv
    const query = `query FindSceneMarkers($filter: FindFilterType, $scene_marker_filter: SceneMarkerFilterType) {
  findSceneMarkers(filter: $filter, scene_marker_filter: $scene_marker_filter) {
    count
    scene_markers {
      id
      title
      seconds
      end_seconds
      stream
      primary_tag {
        id
        name
      }
      tags {
        id
        name
      }
      scene {
        id
        title
        date
        details
        url
        rating100
        o_counter
        studio {
          id
          name
        }
        performers {
          id
          name
          image_path
        }
        tags {
          id
          name
        }
        files {
          id
          path
          size
          duration
          video_codec
          audio_codec
          width
          height
          bit_rate
        }
        paths {
          screenshot
          preview
          stream
          webp
          vtt
        }
        sceneStreams {
          url
          mime_type
          label
        }
      }
    }
  }
}`;

    try {
      // Calculate random page if no offset specified
      let page = filters?.offset ? Math.floor(filters.offset / (filters.limit || 20)) + 1 : 1;
      const limit = filters?.limit || 20;
      
      // Check if any filters are active (tags, saved filter, or query)
      const hasActiveFilters = !!(filters?.primary_tags?.length || filters?.savedFilterId || (filters?.query && filters.query.trim() !== ''));
      
      // If we want random and no offset, get count first to calculate random page
      // Skip random page selection when filters are active - start from page 1 instead
      if (!filters?.offset && !hasActiveFilters) {
        const countQuery = `query GetMarkerCount($filter: FindFilterType, $scene_marker_filter: SceneMarkerFilterType) {
          findSceneMarkers(filter: $filter, scene_marker_filter: $scene_marker_filter) {
            count
          }
        }`;
        
        const countFilter: any = { per_page: 1, page: 1 };
        // Start with saved filter criteria if available
        if (savedFilterCriteria?.find_filter) {
          Object.assign(countFilter, savedFilterCriteria.find_filter);
        }
        // Manual query only if no saved filter OR if explicitly provided
        if (filters?.query && filters.query.trim() !== '') {
          countFilter.q = filters.query;
        }
        
        // Normalize saved filter object_filter before using in variables
        const countSceneFilterRaw: any = savedFilterCriteria?.object_filter || {};
        const countSceneFilter: any = this.normalizeMarkerFilter(countSceneFilterRaw);
        
        // If a saved filter is active, ONLY use its criteria (don't combine with manual filters)
        // Otherwise, apply manual primary tag filters
        if (!filters?.savedFilterId) {
          if (filters?.primary_tags && filters.primary_tags.length > 0) {
            const tagIds = filters.primary_tags
              .map((v) => parseInt(String(v), 10))
              .filter((n) => !Number.isNaN(n));
            if (tagIds.length > 0) {
              countSceneFilter.tags = { value: tagIds, modifier: 'INCLUDES' };
            }
          }
        }
        
        try {
          if (signal?.aborted) return [];
          if (this.pluginApi?.GQL?.client) {
            const countResult = await this.pluginApi.GQL.client.query({
              query: countQuery as any,
              variables: {
                filter: countFilter,
                scene_marker_filter: Object.keys(countSceneFilter).length > 0 ? countSceneFilter : {},
              },
            });
            if (signal?.aborted) return [];
            const totalCount = countResult.data?.findSceneMarkers?.count || 0;
            if (totalCount > 0) {
              const totalPages = Math.ceil(totalCount / limit);
              page = Math.floor(Math.random() * totalPages) + 1;
            }
          } else {
            const countResponse = await fetch(`${this.baseUrl}/graphql`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(this.apiKey && { 'ApiKey': this.apiKey }),
              },
              body: JSON.stringify({
                query: countQuery,
                variables: {
                  filter: countFilter,
                  scene_marker_filter: Object.keys(countSceneFilter).length > 0 ? countSceneFilter : {},
                },
              }),
              signal,
            });
            if (signal?.aborted) return [];
            if (!countResponse.ok) return [];
            const countData = await countResponse.json();
            if (signal?.aborted) return [];
            const totalCount = countData.data?.findSceneMarkers?.count || 0;
            if (totalCount > 0) {
              const totalPages = Math.ceil(totalCount / limit);
              page = Math.floor(Math.random() * totalPages) + 1;
            }
          }
        } catch (e: any) {
          if (e.name === 'AbortError' || signal?.aborted) {
            return [];
          }
          console.warn('Failed to get count for random page, using page 1', e);
        }
      }

      // Check if aborted before main query
      if (signal?.aborted) return [];
      
      // Try using PluginApi GraphQL client if available
      if (this.pluginApi?.GQL?.client) {
        // Build filter - start with saved filter criteria if available, then allow manual overrides
        const filter: any = {
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
        }
        // Override page with our calculated random page
        filter.page = page;
        filter.per_page = limit;
        // Use random sorting for better randomization
        filter.sort = `random_${Math.floor(Math.random() * 1000000)}`;

        // Build scene_marker_filter - start with saved filter object_filter if available
        const sceneMarkerFilterRaw: any = savedFilterCriteria?.object_filter ? { ...savedFilterCriteria.object_filter } : {};
        const sceneMarkerFilter: any = this.normalizeMarkerFilter(sceneMarkerFilterRaw);
        
        // If a saved filter is active, ONLY use its criteria (don't combine with manual filters)
        // Otherwise, apply manual primary tag filters
        if (!filters?.savedFilterId) {
          if (filters?.primary_tags && filters.primary_tags.length > 0) {
            const tagIds = filters.primary_tags
              .map((v) => parseInt(String(v), 10))
              .filter((n) => !Number.isNaN(n));
            if (tagIds.length > 0) {
              // Primary tags can be filtered server-side
              sceneMarkerFilter.tags = { value: tagIds, modifier: 'INCLUDES' };
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
            sceneMarkerFilter.performers = { value: performerIds, modifier: 'INCLUDES_ALL' };
          }
        }

        const result = await this.pluginApi.GQL.client.query({
          query: query as any,
          variables: {
            filter,
            scene_marker_filter: Object.keys(sceneMarkerFilter).length > 0 ? sceneMarkerFilter : {},
          },
        });
        if (signal?.aborted) return [];
        const responseData = result.data?.findSceneMarkers;
        let markers = responseData?.scene_markers || [];
        if (responseData?.count > 0 && markers.length === 0) {
          console.warn('[StashAPI] Count > 0 but no markers returned - retrying with page 1');
          // If count > 0 but no markers, try page 1 instead
          if (filter.page !== 1) {
            if (signal?.aborted) return [];
            filter.page = 1;
            const retryResult = await this.pluginApi.GQL.client.query({
              query: query as any,
              variables: {
                filter,
                scene_marker_filter: Object.keys(sceneMarkerFilter).length > 0 ? sceneMarkerFilter : {},
              },
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

      // Fallback to direct fetch
      // Build filter - start with saved filter criteria if available, then allow manual overrides
      const filter: any = {
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
      }
      // Override page with our calculated random page
      filter.page = page;
      filter.per_page = limit;
      // Use random sorting for better randomization
      filter.sort = `random_${Math.floor(Math.random() * 1000000)}`;

      // Build scene_marker_filter - start with saved filter object_filter if available
      const sceneMarkerFilterRaw: any = savedFilterCriteria?.object_filter ? { ...savedFilterCriteria.object_filter } : {};
      const sceneMarkerFilter: any = this.normalizeMarkerFilter(sceneMarkerFilterRaw);
      
      // If a saved filter is active, ONLY use its criteria (don't combine with manual filters)
      // Otherwise, apply manual primary tag filters
      if (!filters?.savedFilterId) {
        if (filters?.primary_tags && filters.primary_tags.length > 0) {
          const tagIds = filters.primary_tags
            .map((v) => parseInt(String(v), 10))
            .filter((n) => !Number.isNaN(n));
          if (tagIds.length > 0) {
            // Primary tags can be filtered server-side
            sceneMarkerFilter.tags = { value: tagIds, modifier: 'INCLUDES' };
          } else {
            console.warn('Scene marker primary_tags must be numeric IDs; ignoring provided values');
          }
        }
        // Filter by performers using the correct field name
        if (filters?.performers && filters.performers.length > 0 && !filters?.savedFilterId) {
          const performerIds = filters.performers
            .map((v) => parseInt(String(v), 10))
            .filter((n) => !Number.isNaN(n));
          if (performerIds.length > 0) {
            sceneMarkerFilter.performers = { value: performerIds, modifier: 'INCLUDES_ALL' };
          }
        }
      }

      const variables: any = { 
        filter,
        scene_marker_filter: Object.keys(sceneMarkerFilter).length > 0 ? sceneMarkerFilter : {}
      };


      const response = await fetch(`${this.baseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { 'ApiKey': this.apiKey }),
        },
        body: JSON.stringify({
          query: query.trim(),
          variables,
        }),
        signal,
      });

      if (signal?.aborted) return [];
      if (!response.ok) {
        const errorText = await response.text();
        console.error('GraphQL request failed', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      if (signal?.aborted) return [];
      
      if (data.errors) {
        console.error('GraphQL errors:', data.errors);
        throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
      }
      
      const responseData = data.data?.findSceneMarkers;
      let markers = responseData?.scene_markers || [];
      if (responseData?.count > 0 && markers.length === 0) {
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
              query: query.trim(),
              variables: {
                filter,
                scene_marker_filter: Object.keys(sceneMarkerFilter).length > 0 ? sceneMarkerFilter : {}
              },
            }),
            signal,
          });
          if (signal?.aborted) return [];
          if (retryResponse.ok) {
            const retryData = await retryResponse.json();
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
   * Fetch scenes directly for shuffle mode (includes scenes with 0 markers)
   * @param filters Filter options
   * @param signal Abort signal
   * @returns Array of synthetic scene markers (one per scene)
   */
  private async fetchScenesForShuffle(filters?: FilterOptions, signal?: AbortSignal): Promise<SceneMarker[]> {
    const query = `query FindScenes($filter: FindFilterType, $scene_filter: SceneFilterType) {
      findScenes(filter: $filter, scene_filter: $scene_filter) {
        count
        scenes {
          id
          title
          date
          details
          url
          rating100
          o_counter
          studio {
            id
            name
          }
          performers {
            id
            name
            image_path
          }
          tags {
            id
            name
          }
          files {
            id
            path
            size
            duration
            video_codec
            audio_codec
            width
            height
            bit_rate
          }
          paths {
            screenshot
            preview
            stream
            webp
            vtt
          }
          sceneStreams {
            url
            mime_type
            label
          }
          scene_markers {
            id
          }
        }
      }
    }`;

    try {
      const limit = filters?.limit || 20;
      let page = filters?.offset ? Math.floor(filters?.offset / limit) + 1 : 1;

      // Calculate random page if no offset
      if (!filters?.offset) {
        const countQuery = `query GetSceneCount($filter: FindFilterType, $scene_filter: SceneFilterType) {
          findScenes(filter: $filter, scene_filter: $scene_filter) {
            count
          }
        }`;

        const countFilter: any = { per_page: 1, page: 1 };
        const sceneFilter: any = {};
        
        // Use has_markers filter based on includeScenesWithoutMarkers preference
        if (filters?.includeScenesWithoutMarkers) {
          // Include all scenes (both with and without markers)
          // Don't filter by has_markers when including scenes without markers
        } else {
          // Only scenes with markers - use boolean directly, not object
          sceneFilter.has_markers = true;
        }

        try {
          if (signal?.aborted) return [];
          if (this.pluginApi?.GQL?.client) {
            const countResult = await this.pluginApi.GQL.client.query({
              query: countQuery as any,
              variables: { filter: countFilter, scene_filter: sceneFilter },
            });
            if (signal?.aborted) return [];
            const totalCount = countResult.data?.findScenes?.count || 0;
            if (totalCount > 0) {
              const totalPages = Math.ceil(totalCount / limit);
              page = Math.floor(Math.random() * totalPages) + 1;
            }
          } else {
            const countResponse = await fetch(`${this.baseUrl}/graphql`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(this.apiKey && { 'ApiKey': this.apiKey }),
              },
              body: JSON.stringify({ query: countQuery, variables: { filter: countFilter, scene_filter: sceneFilter } }),
              signal,
            });
            if (signal?.aborted) return [];
            if (!countResponse.ok) return [];
            const countData = await countResponse.json();
            if (signal?.aborted) return [];
            const totalCount = countData.data?.findScenes?.count || 0;
            if (totalCount > 0) {
              const totalPages = Math.ceil(totalCount / limit);
              page = Math.floor(Math.random() * totalPages) + 1;
            }
          }
        } catch (e: any) {
          if (e.name === 'AbortError' || signal?.aborted) {
            return [];
          }
          console.warn('Failed to get scene count for shuffle, using page 1', e);
        }
      }

      if (signal?.aborted) return [];

      const filter: any = {
        per_page: limit,
        page: page,
        sort: `random_${Math.floor(Math.random() * 1000000)}`,
      };

      const sceneFilter: any = {};
      
      // Use has_markers filter based on includeScenesWithoutMarkers preference
      if (filters?.includeScenesWithoutMarkers) {
        // Include all scenes (both with and without markers)
        // Don't filter by has_markers when including scenes without markers
      } else {
        // Only scenes with markers - use boolean directly, not object
        sceneFilter.has_markers = true;
      }

      let scenes: any[] = [];

      if (this.pluginApi?.GQL?.client) {
        const result = await this.pluginApi.GQL.client.query({
          query: query as any,
          variables: { filter, scene_filter: sceneFilter },
        });
        if (signal?.aborted) return [];
        scenes = result.data?.findScenes?.scenes || [];
      } else {
        const response = await fetch(`${this.baseUrl}/graphql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey && { 'ApiKey': this.apiKey }),
          },
          body: JSON.stringify({ query, variables: { filter, scene_filter: sceneFilter } }),
          signal,
        });

        if (signal?.aborted) return [];
        if (!response.ok) return [];

        const data = await response.json();
        if (signal?.aborted) return [];
        if (data.errors) {
          throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
        }

        scenes = data.data?.findScenes?.scenes || [];
      }

      // Create synthetic markers for each scene (one per scene, starting at 0 seconds)
      // This allows us to display scenes with 0 markers
      const syntheticMarkers: SceneMarker[] = scenes.map((scene) => ({
        id: `synthetic-${scene.id}-${Date.now()}-${Math.random()}`,
        title: scene.title || 'Untitled',
        seconds: 0, // Will be randomized in createPost when shuffle mode is active
        scene: scene,
        primary_tag: undefined,
        tags: [],
      }));

      return syntheticMarkers;
    } catch (e: any) {
      if (e.name === 'AbortError' || signal?.aborted) {
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
      
      const url = stream.startsWith('http') 
        ? stream 
        : `${this.baseUrl}${stream}`;
      
      // Validate URL before returning
      if (!isValidMediaUrl(url)) {
        // Fallback to scene stream
        return this.getVideoUrl(marker.scene);
      }
      
      return url;
    }
    // Fallback to scene stream
    return this.getVideoUrl(marker.scene);
  }

  /**
   * Get video URL for a scene
   */
  getVideoUrl(scene: Scene): string | undefined {
    // Prefer sceneStreams if available (often provides mp4)
    if (scene.sceneStreams && scene.sceneStreams.length > 0) {
      const streamUrl = scene.sceneStreams[0].url;
      if (!streamUrl || streamUrl.trim().length === 0) {
        // Try next fallback
      } else {
        const url = streamUrl.startsWith('http') ? streamUrl : `${this.baseUrl}${streamUrl}`;
        if (isValidMediaUrl(url)) {
          return url;
        }
      }
    }
    // Use stream path if available, otherwise use file path
    if (scene.paths?.stream) {
      const streamPath = scene.paths.stream.trim();
      if (streamPath && streamPath.length > 0) {
        const url = streamPath.startsWith('http') 
          ? streamPath 
          : `${this.baseUrl}${streamPath}`;
        if (isValidMediaUrl(url)) {
          return url;
        }
      }
    }
    if (scene.files && scene.files.length > 0) {
      const filePath = scene.files[0].path;
      if (filePath && filePath.trim().length > 0) {
        const url = filePath.startsWith('http')
          ? filePath
          : `${this.baseUrl}${filePath}`;
        if (isValidMediaUrl(url)) {
          return url;
        }
      }
    }
    return undefined;
  }

  /**
   * Get thumbnail URL for a scene marker (uses marker-specific screenshot endpoint)
   * Optimized to prefer WebP/AVIF formats when supported
   * @param marker - Scene marker
   * @param maxWidth - Optional max width for optimized thumbnail (reduces memory)
   * @param maxHeight - Optional max height for optimized thumbnail
   */
  getMarkerThumbnailUrl(marker: SceneMarker, maxWidth?: number, maxHeight?: number): string | undefined {
    // Skip marker screenshot for synthetic markers (created in random/shuffle mode)
    // Synthetic markers have IDs like "synthetic-{sceneId}-{timestamp}-{random}"
    const markerId = typeof marker.id === 'string' ? marker.id : String(marker.id);
    const isSyntheticMarker = markerId.startsWith('synthetic-');
    
    // Use marker-specific screenshot endpoint: /scene/{sceneId}/scene_marker/{markerId}/screenshot
    // Only if it's a real marker (not synthetic)
    if (!isSyntheticMarker && marker.id && marker.scene?.id) {
      const sceneId = typeof marker.scene.id === 'string' ? marker.scene.id : String(marker.scene.id);
      let baseUrl = `${this.baseUrl}/scene/${sceneId}/scene_marker/${markerId}/screenshot`;
      
      // Optimize thumbnail size if dimensions provided (reduces memory usage)
      if (maxWidth) {
        baseUrl = getOptimizedThumbnailUrl(baseUrl, maxWidth, maxHeight);
      }
      
      return baseUrl;
    }
    // Fallback to scene preview if marker screenshot not available (or synthetic marker)
    return this.getThumbnailUrl(marker.scene, maxWidth, maxHeight);
  }

  /**
   * Get thumbnail URL for a scene
   * Prefers WebP format when available for better performance
   * @param scene - Scene object
   * @param maxWidth - Optional max width for optimized thumbnail (reduces memory)
   * @param maxHeight - Optional max height for optimized thumbnail
   */
  getThumbnailUrl(scene: Scene, maxWidth?: number, maxHeight?: number): string | undefined {
    let url: string | undefined;
    
    // Prefer WebP format for better compression and performance
    if (scene.paths?.webp) {
      url = scene.paths.webp.startsWith('http')
        ? scene.paths.webp
        : `${this.baseUrl}${scene.paths.webp}`;
    }
    // Fallback to screenshot
    else if (scene.paths?.screenshot) {
      url = scene.paths.screenshot.startsWith('http')
        ? scene.paths.screenshot
        : `${this.baseUrl}${scene.paths.screenshot}`;
    }
    // Fallback to preview
    else if (scene.paths?.preview) {
      url = scene.paths.preview.startsWith('http')
        ? scene.paths.preview
        : `${this.baseUrl}${scene.paths.preview}`;
    }
    
    if (!url) return undefined;
    
    // Optimize thumbnail size if dimensions provided (reduces memory usage)
    if (maxWidth) {
      return getOptimizedThumbnailUrl(url, maxWidth, maxHeight);
    }
    
    return url;
  }

  /**
   * Get preview URL for a scene
   */
  getPreviewUrl(scene: Scene): string | undefined {
    if (scene.paths?.preview) {
      const url = scene.paths.preview.startsWith('http')
        ? scene.paths.preview
        : `${this.baseUrl}${scene.paths.preview}`;
      return url;
    }
    return this.getThumbnailUrl(scene);
  }

  /**
   * Find a tag by name
   */
  async findTagByName(tagName: string): Promise<{ id: string; name: string } | null> {
    const query = `query FindTag($filter: FindFilterType, $tag_filter: TagFilterType) {
      findTags(filter: $filter, tag_filter: $tag_filter) {
        tags {
          id
          name
        }
      }
    }`;

    const variables = {
      filter: { per_page: 1, page: 1 },
      tag_filter: { name: { value: tagName, modifier: 'EQUALS' } }
    };

    try {
      if (this.pluginApi?.GQL?.client) {
        const result = await this.pluginApi.GQL.client.query({
          query: query as any,
          variables,
        });
        const tags = result.data?.findTags?.tags || [];
        return tags.length > 0 ? tags[0] : null;
      }

      const response = await fetch(`${this.baseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { 'ApiKey': this.apiKey }),
        },
        body: JSON.stringify({ query, variables }),
      });

      if (!response.ok) {
        throw new Error(`GraphQL request failed: ${response.status}`);
      }

      const data = await response.json();
      if (data.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
      }

      const tags = data.data?.findTags?.tags || [];
      return tags.length > 0 ? tags[0] : null;
    } catch (error) {
      console.error('StashAPI: Failed to find tag', error);
      return null;
    }
  }

  /**
   * Create a new tag
   */
  async createTag(tagName: string): Promise<{ id: string; name: string } | null> {
    const mutation = `mutation TagCreate($input: TagCreateInput!) {
      tagCreate(input: $input) {
        id
        name
      }
    }`;

    const variables = {
      input: { name: tagName }
    };

    try {
      if (this.pluginApi?.GQL?.client) {
        // Use mutate if available, otherwise fall back to query
        const client = this.pluginApi.GQL.client;
        let result;
        try {
          if (client.mutate) {
            result = await client.mutate({ mutation: mutation as any, variables });
          } else {
            // Some GraphQL clients accept mutations via query method
            result = await client.query({ query: mutation as any, variables });
          }
          return result.data?.tagCreate || null;
        } catch (err: any) {
          console.error('StashAPI: Mutation error details', {
            error: err,
            message: err?.message,
            graphQLErrors: err?.graphQLErrors,
            networkError: err?.networkError
          });
          throw err;
        }
      }

      const response = await fetch(`${this.baseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { 'ApiKey': this.apiKey }),
        },
        body: JSON.stringify({ query: mutation, variables }),
      });

      if (!response.ok) {
        throw new Error(`GraphQL request failed: ${response.status}`);
      }

      const data = await response.json();
      if (data.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
      }

      return data.data?.tagCreate || null;
    } catch (error) {
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
    const query = `query FindScene($id: ID!) {
      findScene(id: $id) {
        id
        tags {
          id
        }
      }
    }`;

    const variables = { id: sceneId };

    try {
      if (this.pluginApi?.GQL?.client) {
        const result = await this.pluginApi.GQL.client.query({
          query: query as any,
          variables,
        });
        const tags = result.data?.findScene?.tags || [];
        return tags.some((tag: { id: string }) => tag.id === tagId);
      }

      const response = await fetch(`${this.baseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { 'ApiKey': this.apiKey }),
        },
        body: JSON.stringify({ query, variables }),
      });

      if (!response.ok) {
        throw new Error(`GraphQL request failed: ${response.status}`);
      }

      const data = await response.json();
      if (data.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
      }

      const tags = data.data?.findScene?.tags || [];
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
    const mutation = `mutation SceneMarkerUpdate($id: ID!, $title: String!, $seconds: Float!, $end_seconds: Float, $scene_id: ID!, $primary_tag_id: ID!, $tag_ids: [ID!]!) {
      sceneMarkerUpdate(
        input: {
          id: $id
          title: $title
          seconds: $seconds
          end_seconds: $end_seconds
          scene_id: $scene_id
          primary_tag_id: $primary_tag_id
          tag_ids: $tag_ids
        }
      ) {
        id
      }
    }`;

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

        const variables = {
          id: marker.id,
          title: marker.title,
          seconds: marker.seconds,
          end_seconds: marker.end_seconds ?? null,
          scene_id: marker.scene.id,
          primary_tag_id: marker.primary_tag.id,
          tag_ids: tagIds
        };

        if (this.pluginApi?.GQL?.client) {
          // Use mutate if available, otherwise fall back to query
          const client = this.pluginApi.GQL.client;
          try {
            if (client.mutate) {
              await client.mutate({ mutation: mutation as any, variables });
            } else {
              await client.query({ query: mutation as any, variables });
            }
          } catch (err: any) {
            console.error('StashAPI: Failed to add tag to marker', {
              error: err,
              message: err?.message,
              graphQLErrors: err?.graphQLErrors,
              networkError: err?.networkError,
              markerId: marker.id,
              tagId
            });
            throw err;
          }
        } else {
          const response = await fetch(`${this.baseUrl}/graphql`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(this.apiKey && { 'ApiKey': this.apiKey }),
            },
            body: JSON.stringify({ query: mutation, variables }),
          });

          if (!response.ok) {
            throw new Error(`GraphQL request failed: ${response.status}`);
          }

          const data = await response.json();
          if (data.errors) {
            throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
          }
        }
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
      let currentTags: string[] = [];
      if (this.pluginApi?.GQL?.client) {
        const result = await this.pluginApi.GQL.client.query({
          query: query as any,
          variables: { id: sceneId },
        });
        currentTags = (result.data?.findScene?.tags || []).map((t: { id: string }) => t.id);
      } else {
        const response = await fetch(`${this.baseUrl}/graphql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey && { 'ApiKey': this.apiKey }),
          },
          body: JSON.stringify({ query, variables: { id: sceneId } }),
        });

        if (!response.ok) {
          throw new Error(`GraphQL request failed: ${response.status}`);
        }

        const data = await response.json();
        if (data.errors) {
          throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
        }

        currentTags = (data.data?.findScene?.tags || []).map((t: { id: string }) => t.id);
      }

      // Add the new tag if not already present
      if (!currentTags.includes(tagId)) {
        const tagIds = [...currentTags, tagId];

        const variables = {
          input: {
            id: sceneId,
            tag_ids: tagIds
          }
        };

        if (this.pluginApi?.GQL?.client) {
          // Use mutate if available, otherwise fall back to query
          const client = this.pluginApi.GQL.client;
          try {
            if (client.mutate) {
              await client.mutate({ mutation: mutation as any, variables });
            } else {
              await client.query({ query: mutation as any, variables });
            }
          } catch (err: any) {
            console.error('StashAPI: Failed to add tag to scene', {
              error: err,
              message: err?.message,
              graphQLErrors: err?.graphQLErrors,
              networkError: err?.networkError,
              sceneId,
              tagId
            });
            throw err;
          }
        } else {
          const response = await fetch(`${this.baseUrl}/graphql`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(this.apiKey && { 'ApiKey': this.apiKey }),
            },
            body: JSON.stringify({ query: mutation, variables }),
          });

          if (!response.ok) {
            throw new Error(`GraphQL request failed: ${response.status}`);
          }

          const data = await response.json();
          if (data.errors) {
            throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
          }
        }
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
    const mutation = `mutation SceneMarkerUpdate($id: ID!, $title: String!, $seconds: Float!, $end_seconds: Float, $scene_id: ID!, $primary_tag_id: ID!, $tag_ids: [ID!]!) {
      sceneMarkerUpdate(
        input: {
          id: $id
          title: $title
          seconds: $seconds
          end_seconds: $end_seconds
          scene_id: $scene_id
          primary_tag_id: $primary_tag_id
          tag_ids: $tag_ids
        }
      ) {
        id
      }
    }`;

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

      if (this.pluginApi?.GQL?.client) {
        // Use mutate if available, otherwise fall back to query
        const client = this.pluginApi.GQL.client;
        try {
          if (client.mutate) {
            await client.mutate({ mutation: mutation as any, variables });
          } else {
            await client.query({ query: mutation as any, variables });
          }
        } catch (err: any) {
          console.error('StashAPI: Failed to remove tag from marker', {
            error: err,
            message: err?.message,
            graphQLErrors: err?.graphQLErrors,
            networkError: err?.networkError,
            markerId: marker.id,
            tagId
          });
          throw err;
        }
      } else {
        const response = await fetch(`${this.baseUrl}/graphql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey && { 'ApiKey': this.apiKey }),
          },
          body: JSON.stringify({ query: mutation, variables }),
        });

        if (!response.ok) {
          throw new Error(`GraphQL request failed: ${response.status}`);
        }

        const data = await response.json();
        if (data.errors) {
          throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
        }
      }
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
      let currentTags: string[] = [];
      if (this.pluginApi?.GQL?.client) {
        const result = await this.pluginApi.GQL.client.query({
          query: query as any,
          variables: { id: sceneId },
        });
        currentTags = (result.data?.findScene?.tags || []).map((t: { id: string }) => t.id);
      } else {
        const response = await fetch(`${this.baseUrl}/graphql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey && { 'ApiKey': this.apiKey }),
          },
          body: JSON.stringify({ query, variables: { id: sceneId } }),
        });

        if (!response.ok) {
          throw new Error(`GraphQL request failed: ${response.status}`);
        }

        const data = await response.json();
        if (data.errors) {
          throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
        }

        currentTags = (data.data?.findScene?.tags || []).map((t: { id: string }) => t.id);
      }

      // Remove the tag
      const tagIds = currentTags.filter(id => id !== tagId);

      const variables = {
        input: {
          id: sceneId,
          tag_ids: tagIds
        }
      };

      if (this.pluginApi?.GQL?.client) {
        // Use mutate if available, otherwise fall back to query
        const client = this.pluginApi.GQL.client;
        try {
          if (client.mutate) {
            await client.mutate({ mutation: mutation as any, variables });
          } else {
            await client.query({ query: mutation as any, variables });
          }
        } catch (err: any) {
          console.error('StashAPI: Failed to remove tag from scene', {
            error: err,
            message: err?.message,
            graphQLErrors: err?.graphQLErrors,
            networkError: err?.networkError,
            sceneId,
            tagId
          });
          throw err;
        }
      } else {
        const response = await fetch(`${this.baseUrl}/graphql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey && { 'ApiKey': this.apiKey }),
          },
          body: JSON.stringify({ query: mutation, variables }),
        });

        if (!response.ok) {
          throw new Error(`GraphQL request failed: ${response.status}`);
        }

        const data = await response.json();
        if (data.errors) {
          throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
        }
      }
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
      if (this.pluginApi?.GQL?.client) {
        const client = this.pluginApi.GQL.client;
        try {
          if (client.mutate) {
            const result = await client.mutate({ mutation: mutation as any, variables });
            return result.data?.sceneAddO || { count: 0, history: [] };
          } else {
            const result = await client.query({ query: mutation as any, variables });
            return result.data?.sceneAddO || { count: 0, history: [] };
          }
        } catch (err: any) {
          console.error('StashAPI: Failed to increment o count', {
            error: err,
            message: err?.message,
            graphQLErrors: err?.graphQLErrors,
            networkError: err?.networkError,
            sceneId
          });
          throw err;
        }
      } else {
        const response = await fetch(`${this.baseUrl}/graphql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey && { 'ApiKey': this.apiKey }),
          },
          body: JSON.stringify({ query: mutation, variables }),
        });

        if (!response.ok) {
          throw new Error(`GraphQL request failed: ${response.status}`);
        }

        const data = await response.json();
        if (data.errors) {
          throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
        }

        return data.data?.sceneAddO || { count: 0, history: [] };
      }
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
    const mutation = `mutation SceneUpdate($input: SceneUpdateInput!) {
      sceneUpdate(input: $input) {
        id
        rating100
      }
    }`;

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
      if (this.pluginApi?.GQL?.client) {
        const client = this.pluginApi.GQL.client;
        let result;
        try {
          if (client.mutate) {
            result = await client.mutate({ mutation: mutation as any, variables });
          } else {
            result = await client.query({ query: mutation as any, variables });
          }
        } catch (err: any) {
          console.error('StashAPI: Failed to update scene rating', {
            error: err,
            message: err?.message,
            graphQLErrors: err?.graphQLErrors,
            networkError: err?.networkError,
            sceneId,
            rating10,
          });
          throw err;
        }

        const updated = result.data?.sceneUpdate?.rating100;
        return typeof updated === 'number' ? updated : rating100;
      }

      const response = await fetch(`${this.baseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { ApiKey: this.apiKey }),
        },
        body: JSON.stringify({ query: mutation, variables }),
      });

      if (!response.ok) {
        throw new Error(`GraphQL request failed: ${response.status}`);
      }

      const data = await response.json();
      if (data.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
      }

      const updated = data.data?.sceneUpdate?.rating100;
      return typeof updated === 'number' ? updated : rating100;
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
    const query = `query FindTagsForSelect($filter: FindFilterType, $tag_filter: TagFilterType, $ids: [ID!]) {
      findTags(filter: $filter, tag_filter: $tag_filter, ids: $ids) {
        count
        tags {
          id
          name
          sort_name
          favorite
          description
          aliases
          image_path
          parents {
            id
            name
            sort_name
          }
        }
      }
    }`;

    const variables = {
      filter: {
        q: searchTerm,
        sort: 'name',
        direction: 'ASC',
        page: 1,
        per_page: limit,
      },
      tag_filter: {},
      ids: null as string[] | null,
    };

    try {
      if (this.pluginApi?.GQL?.client) {
        const client = this.pluginApi.GQL.client;
        try {
          // Note: Plugin API client may not support abort signal in query options
          // If signal is aborted, we'll catch it in the error handler
          const result = await client.query({ query: query as any, variables });
          if (signal?.aborted) {
            return [];
          }
          return result.data?.findTags?.tags || [];
        } catch (err: any) {
          if (err.name === 'AbortError' || signal?.aborted) {
            return [];
          }
          console.error('StashAPI: Failed to find tags for select', {
            error: err,
            message: err?.message,
            graphQLErrors: err?.graphQLErrors,
            networkError: err?.networkError,
            searchTerm,
          });
          throw err;
        }
      }

      const response = await fetch(`${this.baseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { ApiKey: this.apiKey }),
        },
        body: JSON.stringify({ query, variables }),
        signal,
      });

      if (!response.ok) {
        throw new Error(`GraphQL request failed: ${response.status}`);
      }

      const data = await response.json();
      if (data.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
      }

      return data.data?.findTags?.tags || [];
    } catch (error: any) {
      if (error.name === 'AbortError' || signal?.aborted) {
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
      if (this.pluginApi?.GQL?.client) {
        const client = this.pluginApi.GQL.client;
        try {
          if (client.mutate) {
            const result = await client.mutate({ mutation: mutation as any, variables });
            return result.data?.sceneMarkerCreate;
          } else {
            const result = await client.query({ query: mutation as any, variables });
            return result.data?.sceneMarkerCreate;
          }
        } catch (err: any) {
          console.error('StashAPI: Failed to create scene marker', {
            error: err,
            message: err?.message,
            graphQLErrors: err?.graphQLErrors,
            networkError: err?.networkError,
            sceneId,
            seconds,
            primaryTagId,
          });
          throw err;
        }
      }

      const response = await fetch(`${this.baseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { ApiKey: this.apiKey }),
        },
        body: JSON.stringify({ query: mutation, variables }),
      });

      if (!response.ok) {
        throw new Error(`GraphQL request failed: ${response.status}`);
      }

      const data = await response.json();
      if (data.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
      }

      return data.data?.sceneMarkerCreate;
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
    const query = `query FindSceneMarkerTags($id: ID!) {
      sceneMarkerTags(scene_id: $id) {
        scene_markers {
          seconds
        }
      }
    }`;
    
    // Note: sceneMarkerTags may return an array or a single object depending on Stash version
    // We handle both cases in the parsing logic below

    try {
      if (signal?.aborted) return [];

      if (this.pluginApi?.GQL?.client) {
        const result = await this.pluginApi.GQL.client.query({
          query: query as any,
          variables: { id: sceneId },
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
      } else {
        const response = await fetch(`${this.baseUrl}/graphql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey && { 'ApiKey': this.apiKey }),
          },
          body: JSON.stringify({ query, variables: { id: sceneId } }),
          signal,
        });

        if (signal?.aborted) return [];
        if (!response.ok) return [];

        const data = await response.json();
        if (signal?.aborted) return [];
        if (data.errors) {
          console.warn('StashAPI: GraphQL errors fetching scene marker tags', data.errors);
          return [];
        }

        const sceneMarkerTags = data.data?.sceneMarkerTags;
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
      }
    } catch (e: any) {
      if (e.name === 'AbortError' || signal?.aborted) {
        return [];
      }
      console.warn('StashAPI: Failed to fetch scene marker tags', e);
      return [];
    }
  }
}

