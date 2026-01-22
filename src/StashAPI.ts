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
  ImageFilterInput,
  FindSceneMarkersResponse,
  FindScenesResponse,
  FindTagsResponse,
  FindTagsExtendedResponse,
  FindPerformersResponse,
  FindPerformerResponse,
  PerformerExtended,
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
  VisualFile,
  UIConfigurationResponse,
} from './graphql/types.js';
import {
  GraphQLRequestError,
  GraphQLResponseError,
  GraphQLNetworkError,
  isAbortError,
} from './graphql/errors.js';
import { GraphQLClient } from './graphql/client.js';

type Orientation = 'landscape' | 'portrait' | 'square' | null;
type ImageOrientation = 'landscape' | 'portrait' | 'square';

interface StashPluginApi {
  GQL: {
    useFindScenesQuery?: (variables: unknown) => { data?: unknown; loading: boolean };
    client?: TypedGraphQLClient;
  };
  baseURL?: string;
  apiKey?: string;
}


/**
 * Generate a random sort seed in the format random_<8-digit-number>
 * Example: random_23120320
 */
export function generateRandomSortSeed(): string {
  const randomSeed = Math.floor(Math.random() * 100000000).toString().padStart(8, '0');
  return `random_${randomSeed}`;
}

export class StashAPI {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly pluginApi?: StashPluginApi;
  // Centralized GraphQL client
  private readonly gqlClient: GraphQLClient;
  // Simple cache for autocomplete search results only (not filtered queries)
  private readonly searchCache: Map<string, { data: unknown; timestamp: number }> = new Map();
  private readonly SEARCH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  
  // Magic numbers as constants
  private static readonly SEARCH_FETCH_MULTIPLIER = 3; // Fetch 3x limit when searching to improve relevance
  private static readonly MIN_SEARCH_LIMIT = 20; // Minimum results to fetch when not searching
  private static readonly MIN_MARKER_COUNT_FOR_TAG_FILTER = 10; // Minimum markers required for tag to appear in suggestions
  private static readonly SHORT_FORM_SCENES_PER_PAGE = 24; // Number of scenes to fetch per page for short-form content
  private static readonly MAX_PAGE_FALLBACK = 100; // Fallback max page when count query fails
  private static readonly ORIENTATION_TOLERANCE = 0.05; // 5% tolerance for square aspect ratio detection
  private static readonly MAX_MARKERS_PER_SCENE_FOR_SHUFFLE = 5; // Maximum markers per scene in shuffle mode

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
    
    // Initialize GraphQL client (response caching disabled - we handle caching selectively)
    this.gqlClient = new GraphQLClient({
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      pluginApi: this.pluginApi,
      enableResponseCache: false, // Disabled: filtered queries should not be cached
    });
  }

  /**
   * Normalize a scene_marker_filter coming from a saved filter
   * Ensures fields like tags/scene_tags have numeric ID arrays
   */
  private normalizeMarkerFilter(input: unknown): SceneMarkerFilterInput {
    if (!input || typeof input !== 'object') return {};
    const out: Record<string, unknown> = { ...(input as Record<string, unknown>) };

    const normalizedTags = this.normalizeTagFieldAsStrings(out.tags);
    if (normalizedTags) {
      out.tags = normalizedTags;
    } else {
      delete out.tags;
    }

    const normalizedSceneTags = this.normalizeTagFieldAsStrings(out.scene_tags);
    if (normalizedSceneTags) {
      out.scene_tags = normalizedSceneTags;
    } else {
      delete out.scene_tags;
    }

    const normalizedScenePerformers = this.normalizeTagFieldAsNumbers(out.scene_performers);
    if (normalizedScenePerformers) {
      out.scene_performers = normalizedScenePerformers;
    } else {
      delete out.scene_performers;
    }

    return out as SceneMarkerFilterInput;
  }

  /**
   * Extract ID from various object formats
   */
  private extractId(x: unknown): unknown {
    if (typeof x === 'object' && x !== null) {
      const obj = x as { id?: unknown; value?: unknown };
      return obj.id ?? obj.value ?? x;
    }
    return x;
  }

  /**
   * Normalize an array or single value to an array of numeric IDs
   */
  private normalizeIdArray(val: unknown): number[] | undefined {
    if (!val) return undefined;
    const arr = Array.isArray(val) ? val : [val];
    const ids = arr
      .map((x) => this.extractId(x))
      .map((x) => Number.parseInt(String(x), 10))
      .filter((n) => !Number.isNaN(n));
    return ids.length > 0 ? ids : undefined;
  }

  /**
   * Normalize a tag field (tags, scene_tags, or scene_performers)
   * @param fieldValue The field value to normalize
   * @returns Normalized field value or undefined if invalid
   */
  private normalizeTagFieldAsStrings(fieldValue: unknown): unknown {
    return this.normalizeTagField(fieldValue, (values) => values.map(String));
  }

  private normalizeTagFieldAsNumbers(fieldValue: unknown): unknown {
    return this.normalizeTagField(fieldValue, (values) => values.map(Number));
  }

  private normalizeTagField(
    fieldValue: unknown,
    normalizeValueArray: (values: number[]) => Array<string | number>
  ): unknown {
    if (!fieldValue) return undefined;

    type TagsModifier = 'INCLUDES' | 'INCLUDES_ALL' | 'EXCLUDES';

    const normalizeFieldValue = (rawValue: unknown): number[] | undefined => {
      let raw = rawValue;
      if (raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown[] }).items)) {
        raw = (raw as { items: unknown[] }).items;
      }
      return this.normalizeIdArray(raw);
    };

    if (Array.isArray(fieldValue)) {
      const ids = this.normalizeIdArray(fieldValue);
      if (!ids) return undefined;
      return {
        value: normalizeValueArray(ids),
        modifier: 'INCLUDES' as TagsModifier
      };
    }

    if (typeof fieldValue === 'object') {
      const fieldObj = fieldValue as {
        value?: unknown;
        modifier?: TagsModifier;
        excludes?: unknown;
        depth?: number | string;
        include_subtags?: boolean | number | string;
      };
      const valueObj = fieldObj.value as { depth?: unknown; include_subtags?: unknown; excludes?: unknown; modifier?: TagsModifier } | undefined;
      const ids = normalizeFieldValue(fieldObj.value);
      if (!ids) return undefined;

      const excludesSource = fieldObj.excludes ?? valueObj?.excludes;
      const normalizedExcludes = normalizeFieldValue(excludesSource);
      const depthSource = fieldObj.depth ?? valueObj?.depth;
      const includeSubtags = fieldObj.include_subtags ?? valueObj?.include_subtags;
      const depth = this.resolveTagDepth(depthSource, includeSubtags);

      return {
        value: normalizeValueArray(ids),
        modifier: fieldObj.modifier ?? valueObj?.modifier ?? 'INCLUDES',
        ...(normalizedExcludes ? { excludes: normalizeValueArray(normalizedExcludes) } : {}),
        ...(Number.isFinite(depth) ? { depth } : {})
      };
    }

    return undefined;
  }

  private resolveTagDepth(depthSource: unknown, includeSubtags: unknown): number | undefined {
    if (typeof depthSource === 'number') {
      return depthSource;
    }
    if (typeof depthSource === 'string') {
      return Number.parseInt(depthSource, 10);
    }
    if (includeSubtags === true) {
      return 1;
    }
    if (typeof includeSubtags === 'string') {
      return Number.parseInt(includeSubtags, 10);
    }
    if (typeof includeSubtags === 'number') {
      return includeSubtags;
    }
    return undefined;
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
    if (this.isAborted(signal)) return [];

    // Check cache first (only for non-empty terms)
    if (!isEmptyTerm) {
      const cached = this.searchCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.SEARCH_CACHE_TTL) {
        return cached.data as T[];
      }
    }

    try {
      const results = await queryFn();
      
      if (this.isAborted(signal)) return [];
      
      // Cache the result (only for non-empty terms)
      if (!isEmptyTerm) {
        this.searchCache.set(cacheKey, { data: results, timestamp: Date.now() });
      }
      
      return results;
    } catch (error: unknown) {
      return this.handleError('searchWithCache', error, signal, []);
    }
  }

  /**
   * Search marker tags (by name) for autocomplete
   * Only returns tags that have more than 10 markers (filtered directly in GraphQL)
   * Includes caching for autocomplete results only
   */
  async searchMarkerTags(term: string, limit: number = 10, signal?: AbortSignal): Promise<Array<{ id: string; name: string }>> {
    const isEmptyTerm = !term || term.trim() === '';
    const cacheKey = this.buildCacheKey('tags', term, limit);
    const hasSearchTerm = term && term.trim() !== '';
    const fetchLimit = hasSearchTerm ? limit * StashAPI.SEARCH_FETCH_MULTIPLIER : Math.max(limit, StashAPI.MIN_SEARCH_LIMIT);
    
    const filter: FindFilterInput = { 
      per_page: fetchLimit, 
      page: 1,
      ...(hasSearchTerm ? { q: term.trim() } : { sort: generateRandomSortSeed() })
    };
    
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
   * Check if operation is aborted (only check at critical points)
   */
  private isAborted(signal?: AbortSignal): boolean {
    return signal?.aborted ?? false;
  }

  /**
   * Standardized error logging
   */
  private logError(method: string, error: unknown): void {
    if (error instanceof GraphQLRequestError || error instanceof GraphQLResponseError || error instanceof GraphQLNetworkError) {
      console.warn(`[StashAPI] ${method} failed`, error);
    } else {
      console.warn(`[StashAPI] ${method} failed`, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Handle errors consistently - returns empty result for aborted operations, logs others
   */
  private handleError<T>(method: string, error: unknown, signal: AbortSignal | undefined, emptyResult: T): T {
    if (isAbortError(error) || this.isAborted(signal)) {
      return emptyResult;
    }
    this.logError(method, error);
    return emptyResult;
  }

  /**
   * Search performers (by name) for autocomplete
   * Returns performers regardless of scene/image counts
   * Includes caching for autocomplete results only
   */
  async searchPerformers(term: string, limit: number = 10, signal?: AbortSignal): Promise<Array<{ id: string; name: string; image_path?: string }>> {
    const isEmptyTerm = !term || term.trim() === '';
    const cacheKey = this.buildCacheKey('performers-v2', term, limit);
    const hasSearchTerm = term && term.trim() !== '';
    const fetchLimit = hasSearchTerm ? limit * StashAPI.SEARCH_FETCH_MULTIPLIER : Math.max(limit, StashAPI.MIN_SEARCH_LIMIT);
    
    const filter: FindFilterInput = { 
      per_page: fetchLimit, 
      page: 1,
      ...(hasSearchTerm ? { q: term.trim() } : { sort: generateRandomSortSeed() })
    };
    
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

  /**
   * Get detailed performer information by ID
   * Used for hover overlay display
   */
  async getPerformerDetails(performerId: string, signal?: AbortSignal): Promise<PerformerExtended | null> {
    if (this.isAborted(signal)) return null;

    try {
      const result = await this.gqlClient.query<FindPerformerResponse>({
        query: queries.FIND_PERFORMER,
        variables: { ids: [performerId] },
        signal,
      });

      if (this.isAborted(signal)) return null;

      const performers = result.data?.findPerformers?.performers ?? [];
      return performers[0] ?? null;
    } catch (error: unknown) {
      return this.handleError('getPerformerDetails', error, signal, null);
    }
  }

  /**
   * Get detailed tag information by ID
   */
  async getTagDetails(tagId: string, signal?: AbortSignal): Promise<{ id: string; name: string; image_path?: string; description?: string; favorite?: boolean } | null> {
    if (this.isAborted(signal)) return null;

    try {
      const result = await this.gqlClient.query<FindTagsExtendedResponse>({
        query: queries.FIND_TAGS_FOR_SELECT,
        variables: { ids: [tagId], filter: null, tag_filter: null },
        signal,
      });

      if (this.isAborted(signal)) return null;

      const tags = result.data?.findTags?.tags ?? [];
      return tags[0] ?? null;
    } catch (error: unknown) {
      return this.handleError('getTagDetails', error, signal, null);
    }
  }


  /**
   * Fetch saved marker filters from Stash
   */
  async fetchSavedMarkerFilters(signal?: AbortSignal): Promise<Array<{ id: string; name: string }>> {
    if (this.isAborted(signal)) return [];
    
    try {
      const result = await this.gqlClient.query<GetSavedMarkerFiltersResponse>({
        query: queries.GET_SAVED_MARKER_FILTERS,
        signal,
      });
      
      if (this.isAborted(signal)) return [];
      return result.data?.findSavedFilters || [];
    } catch (error: unknown) {
      return this.handleError('fetchSavedMarkerFilters', error, signal, []);
    }
  }

  /**
   * Get a saved filter's criteria
   */
  async getSavedFilter(id: string, signal?: AbortSignal): Promise<GetSavedFilterResponse['findSavedFilter']> {
    if (this.isAborted(signal)) return null;
    
    try {
      const result = await this.gqlClient.query<GetSavedFilterResponse>({
        query: queries.GET_SAVED_FILTER,
        variables: { id },
        signal
      });
      
      if (this.isAborted(signal)) return null;
      
      return result.data?.findSavedFilter || null;
    } catch (error: unknown) {
      return this.handleError('getSavedFilter', error, signal, null);
    }
  }

  /**
   * Fetch scene markers from Stash
   * Note: Stash's SceneMarkerFilterType only supports filtering by primary_tag, not by tags array.
   * For non-primary tags, we fetch markers and filter client-side.
   */
  async fetchSceneMarkers(filters?: FilterOptions, signal?: AbortSignal): Promise<{ markers: SceneMarker[]; totalCount: number; sortSeed?: string }> {
    if (this.isAborted(signal)) return { markers: [], totalCount: 0 };
    
    // Fetching scene markers with filters
    
    if (filters?.shuffleMode) {
      const { markers, sortSeed } = await this.fetchScenesForShuffle(filters, signal);
      // For shuffle mode, we don't have a reliable count, so return markers with 0 count
      // The caller should handle this case
      return { markers, totalCount: 0, sortSeed };
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
      
      return { markers, totalCount, sortSeed: filter.sort };
    } catch (error: unknown) {
      return this.handleError('fetchSceneMarkers', error, signal, { markers: [], totalCount: 0 });
    }
  }

  /**
   * Get saved filter criteria if a saved filter ID is provided
   */
  private async getSavedFilterCriteria(filters?: FilterOptions, signal?: AbortSignal): Promise<GetSavedFilterResponse['findSavedFilter']> {
    if (!filters?.savedFilterId) return null;
    return await this.getSavedFilter(filters.savedFilterId, signal);
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
    } catch (error: unknown) {
      if (isAbortError(error) || this.isAborted(signal)) {
        return 1;
      }
      this.logError('calculateRandomPage', error);
    }
    
    return 1;
  }

  /**
   * Merge saved filter criteria and query into a base FindFilterInput
   */
  private mergeSavedFilterAndQuery(
    baseFilter: FindFilterInput,
    filters: FilterOptions | undefined,
    savedFilterCriteria: GetSavedFilterResponse['findSavedFilter']
  ): FindFilterInput {
    const merged = { ...baseFilter };
    
    if (savedFilterCriteria?.find_filter) {
      Object.assign(merged, savedFilterCriteria.find_filter);
    }
    
    if (filters?.query?.trim()) {
      merged.q = filters.query.trim();
    }
    
    return merged;
  }

  /**
   * Build count filter for random page calculation
   */
  private buildCountFilter(filters: FilterOptions | undefined, savedFilterCriteria: GetSavedFilterResponse['findSavedFilter']): FindFilterInput {
    return this.mergeSavedFilterAndQuery(
      { per_page: 1, page: 1 },
      filters,
      savedFilterCriteria
    );
  }

  /**
   * Build count scene filter for random page calculation
   */
  private buildCountSceneFilter(filters: FilterOptions | undefined, savedFilterCriteria: GetSavedFilterResponse['findSavedFilter']): SceneMarkerFilterInput {
    const countSceneFilter = this.normalizeMarkerFilter(savedFilterCriteria?.object_filter || {});
    
    if (!filters?.savedFilterId && filters?.tags?.length) {
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

    const { excludedTagIds } = this.extractTagAndPerformerFilters(filters);
    if (excludedTagIds.length > 0) {
      this.applyExcludedTagsToMarkerFilter(countSceneFilter, excludedTagIds);
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
   * Extract tag and performer IDs from filters consistently
   * Handles both tags and primary_tags for unified filtering
   */
  extractTagAndPerformerFilters(filters?: FilterOptions): {
    tagIds: string[];
    performerIds: number[];
    excludedTagIds: string[];
  } {
    const tagIds: string[] = [];
    const performerIds: number[] = [];
    const excludedTagIds: string[] = [];
    
    // Extract tags (include both tags and primary_tags)
    if (filters?.tags && filters.tags.length > 0) {
      const parsed = this.parseTagIds(filters.tags);
      tagIds.push(...parsed.map(String));
    }
    if (filters?.primary_tags && filters.primary_tags.length > 0) {
      const parsed = this.parseTagIds(filters.primary_tags);
      tagIds.push(...parsed.map(String));
    }

    if (filters?.excludedTagIds && filters.excludedTagIds.length > 0) {
      const parsed = this.parseTagIds(filters.excludedTagIds);
      excludedTagIds.push(...parsed.map(String));
    }
    
    // Extract performers
    if (filters?.performers && filters.performers.length > 0) {
      performerIds.push(...this.parseTagIds(filters.performers));
    }
    
    return {
      tagIds,
      performerIds,
      excludedTagIds
    };
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
    const sortSeed = filters?.sortSeed || generateRandomSortSeed();
    
    const baseFilter: FindFilterInput = {
      per_page: limit,
      page: page,
      sort: sortSeed,
    };
    
    const merged = this.mergeSavedFilterAndQuery(baseFilter, filters, savedFilterCriteria);
    
    // Ensure page and per_page are set correctly (may have been overridden by saved filter)
    merged.page = page;
    merged.per_page = limit;
    
    return merged;
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
      this.applyTagAndPerformerFilters(filters, sceneMarkerFilter, { isMarkerFilter: true });
    }
    
    return sceneMarkerFilter;
  }

  /**
   * Apply tag filters to a scene marker filter
   */
  private applyTagsToMarkerFilter(targetFilter: SceneMarkerFilterInput, tagIds: string[]): void {
    if (tagIds.length > 0) {
      targetFilter.tags = {
        value: tagIds,
        excludes: [],
        modifier: tagIds.length === 1 ? 'INCLUDES_ALL' : 'INCLUDES',
        depth: 0
      };
    }
  }

  /**
   * Apply tag filters to a scene filter
   */
  private applyTagsToSceneFilter(targetFilter: SceneFilterInput, tagIds: string[]): void {
    if (tagIds.length > 0) {
      targetFilter.tags = {
        value: tagIds,
        modifier: tagIds.length === 1 ? 'INCLUDES_ALL' : 'INCLUDES'
      };
    }
  }

  private applyExcludedTagsToMarkerFilter(targetFilter: SceneMarkerFilterInput, excludedTagIds: string[]): void {
    const uniqueExcluded = Array.from(new Set(excludedTagIds));
    if (uniqueExcluded.length === 0) {
      return;
    }

    if (!targetFilter.tags) {
      targetFilter.tags = {
        value: [],
        excludes: uniqueExcluded,
        modifier: 'INCLUDES',
        depth: 0,
      };
      return;
    }

    targetFilter.tags.excludes = uniqueExcluded;
    targetFilter.tags.value ??= [];
    targetFilter.tags.depth ??= 0;
  }

  private applyExcludedTagsToSceneFilter(targetFilter: SceneFilterInput, excludedTagIds: string[]): void {
    const uniqueExcluded = Array.from(new Set(excludedTagIds));
    if (uniqueExcluded.length === 0) {
      return;
    }

    targetFilter.tags ??= {
      value: [],
      modifier: 'INCLUDES',
    };

    const tagsFilter = targetFilter.tags as { excludes?: string[]; value?: string[] };
    tagsFilter.excludes = uniqueExcluded;
    tagsFilter.value ??= [];
  }

  /**
   * Apply performer filters to a filter object
   */
  private applyPerformersToFilter(targetFilter: SceneMarkerFilterInput | SceneFilterInput, performerIds: number[]): void {
    if (performerIds.length > 0) {
      targetFilter.performers = {
        value: performerIds,
        modifier: performerIds.length === 1 ? 'INCLUDES_ALL' : 'INCLUDES'
      };
    }
  }

  /**
   * Apply tag and performer filters to a filter object
   */
  private applyTagAndPerformerFilters(
    filters: FilterOptions | undefined,
    targetFilter: SceneMarkerFilterInput | SceneFilterInput,
    options: { isMarkerFilter: boolean }
  ): void {
    const { tagIds, performerIds, excludedTagIds } = this.extractTagAndPerformerFilters(filters);
    
    if (tagIds.length > 0) {
      if (options.isMarkerFilter) {
        this.applyTagsToMarkerFilter(targetFilter as SceneMarkerFilterInput, tagIds);
      } else {
        this.applyTagsToSceneFilter(targetFilter as SceneFilterInput, tagIds);
      }
    }

    if (excludedTagIds.length > 0) {
      if (options.isMarkerFilter) {
        this.applyExcludedTagsToMarkerFilter(targetFilter as SceneMarkerFilterInput, excludedTagIds);
      } else {
        this.applyExcludedTagsToSceneFilter(targetFilter as SceneFilterInput, excludedTagIds);
      }
    }
    
    this.applyPerformersToFilter(targetFilter, performerIds);
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
    
    // Retry if we have a count but no markers (can happen due to race conditions or data inconsistencies)
    if (totalCount > 0 && markers.length === 0) {
      const retryResult = await this.retryMarkerQueryWithCount(filter, sceneMarkerFilter, signal);
      return retryResult;
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
    this.logError('retryMarkerQueryWithCount', new Error('Count > 0 but no markers returned - retrying with page 1'));
    
    if (this.isAborted(signal)) return { markers: [], totalCount: 0 };
    
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
   * @returns Array of synthetic scene markers (one per scene) and sortSeed
   */
  private async fetchScenesForShuffle(filters?: FilterOptions, signal?: AbortSignal): Promise<{ markers: SceneMarker[]; sortSeed: string }> {
    try {
      const limit = filters?.limit || 20;
      let page = filters?.offset ? Math.floor(filters?.offset / limit) + 1 : 1;

      if (!filters?.offset) {
        page = await this.calculateRandomScenePage(filters, limit, signal);
        if (this.isAborted(signal)) return { markers: [], sortSeed: generateRandomSortSeed() };
      }

      if (this.isAborted(signal)) return { markers: [], sortSeed: generateRandomSortSeed() };

      // Reuse existing sort seed for pagination, or generate new one for first page
      const sortSeed = filters?.sortSeed || generateRandomSortSeed();

      const filter: FindFilterInput = {
        per_page: limit,
        page: page,
        sort: sortSeed,
      };

      const sceneFilter = this.buildShuffleSceneFilter(filters);
      const scenes = await this.fetchScenesQuery(filter, sceneFilter, signal);
      
      if (this.isAborted(signal)) return { markers: [], sortSeed };

      let markers = this.createSyntheticMarkers(scenes);
      
      return { markers, sortSeed };
    } catch (error: unknown) {
      const emptyResult = { markers: [] as SceneMarker[], sortSeed: generateRandomSortSeed() };
      return this.handleError('fetchScenesForShuffle', error, signal, emptyResult);
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
      this.logError('calculateRandomScenePage', e);
    }
    
    return 1;
  }

  /**
   * Build scene filter for shuffle mode
   */
  private buildShuffleSceneFilter(filters?: FilterOptions): SceneFilterInput | null {
    const sceneFilter: SceneFilterInput = {};
    
    if (filters?.includeScenesWithoutMarkers) {
      sceneFilter.has_markers = 'false';
    }
    this.applyTagAndPerformerFilters(filters, sceneFilter, { isMarkerFilter: false });

    
    return Object.keys(sceneFilter).length > 0 ? sceneFilter : null;
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
   * @param scenes Scenes to convert to markers
   * @param idPrefix Prefix for marker IDs (default: 'synthetic')
   */
  private createSyntheticMarkers(scenes: Scene[], idPrefix: string = 'synthetic'): SceneMarker[] {
    return scenes.map((scene) => ({
      id: `${idPrefix}-${scene.id}`,
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
    if (this.isAborted(signal)) return { markers: [], totalCount: 0, unfilteredOffsetConsumed: 0, sortSeed: generateRandomSortSeed() };

    try {

      const scenesPerPage = StashAPI.SHORT_FORM_SCENES_PER_PAGE;
      
      const sceneFilter = this.buildShortFormSceneFilter(filters, maxDuration);
      
      const { maxPage, totalCount } = await this.getMaxPageForShortForm(sceneFilter, scenesPerPage, signal);
      if (maxPage === 0) {
        return { markers: [], totalCount: 0, unfilteredOffsetConsumed: 0, sortSeed: generateRandomSortSeed() };
      }
      
      // Calculate page from offset based on scenesPerPage
      const page = Math.floor(offset / scenesPerPage) + 1;
      // Ensure page doesn't exceed maxPage
      const actualPage = Math.min(page, maxPage);
      
      // Calculate offset within the page
      const offsetInPage = offset % scenesPerPage;
      
      // Reuse existing sort seed for pagination, or generate new one for first page
      const sortSeed = filters?.sortSeed || generateRandomSortSeed();
      
      // Fetch only the single page needed
      const filter: FindFilterInput = {
        per_page: scenesPerPage,
        page: actualPage,
        sort: sortSeed,
      };
      
      const scenes = await this.fetchScenesQuery(filter, sceneFilter, signal);
      if (this.isAborted(signal)) return { markers: [], totalCount: 0, unfilteredOffsetConsumed: 0, sortSeed: generateRandomSortSeed() };
      
      // Filter by duration (GraphQL filter should handle this, but filter client-side as backup)
      const shortFormScenes = this.filterShortFormScenes(scenes, maxDuration);
      
      // Apply offset within page and limit to results
      const limitedScenes = shortFormScenes.slice(offsetInPage, offsetInPage + limit);
      
      const markers = this.createShortFormMarkers(limitedScenes);
      
      // Calculate unfiltered offset consumed: offsetInPage + number of scenes we actually processed
      // Since we slice from offsetInPage and take up to limit, we process at most offsetInPage + limit scenes
      const unfilteredOffsetConsumed = offsetInPage + limitedScenes.length;
      
      return { markers, totalCount, unfilteredOffsetConsumed, sortSeed };
    } catch (error: unknown) {
      return this.handleError('fetchShortFormVideos', error, signal, { markers: [], totalCount: 0, unfilteredOffsetConsumed: 0, sortSeed: generateRandomSortSeed() });
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
    let maxPage = StashAPI.MAX_PAGE_FALLBACK;
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
        this.logError('getMaxPageForShortForm', new Error('No scenes found matching filter'));
        return { maxPage: 0, totalCount: 0 };
      }
    } catch (error: unknown) {
      this.logError('getMaxPageForShortForm', error);
      // If we can't get count, we can't reliably calculate totalCount, so return 0
      return { maxPage, totalCount: 0 };
    }
    return { maxPage, totalCount };
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

    if (maxDuration !== undefined && maxDuration > 0) {
      sceneFilter.duration = {
        value: maxDuration,
        modifier: 'LESS_THAN'
      };
    }

    this.applyTagAndPerformerFilters(filters, sceneFilter, { isMarkerFilter: false });

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
    return this.createSyntheticMarkers(scenes, 'shortform');
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
   * Tries multiple sources in order: sceneStreams, stream path, file path
   */
  getVideoUrl(scene: Scene): string | undefined {
    // Try scene streams first
    const streamUrl = this.tryGetUrlFromStreams(scene);
    if (streamUrl) return streamUrl;
    
    // Try stream path
    const streamPathUrl = this.tryGetUrlFromPath(scene.paths?.stream);
    if (streamPathUrl) return streamPathUrl;
    
    // Try file path as last resort
    const filePathUrl = this.tryGetUrlFromFiles(scene.files);
    if (filePathUrl) return filePathUrl;
    
    return undefined;
  }

  private tryGetUrlFromStreams(scene: Scene): string | undefined {
    if (!scene.sceneStreams?.length) return undefined;
    const streamUrl = scene.sceneStreams[0]?.url?.trim();
    if (!streamUrl) return undefined;
    return this.buildAndValidateUrl(streamUrl);
  }

  private tryGetUrlFromPath(path?: string | null): string | undefined {
    const trimmedPath = path?.trim();
    if (!trimmedPath) return undefined;
    return this.buildAndValidateUrl(trimmedPath);
  }

  private tryGetUrlFromFiles(files?: Array<{ path?: string | null }>): string | undefined {
    if (!files?.length) return undefined;
    const filePath = files[0]?.path?.trim();
    if (!filePath) return undefined;
    return this.buildAndValidateUrl(filePath);
  }

  private buildAndValidateUrl(path: string): string | undefined {
    const url = this.buildUrl(path);
    if (!isValidMediaUrl(url)) return undefined;
    return this.addCacheBusting(url);
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
  async findTagByName(tagName: string, signal?: AbortSignal): Promise<{ id: string; name: string } | null> {
    if (this.isAborted(signal)) return null;
    
    const variables = {
      filter: { per_page: 1, page: 1 },
      tag_filter: { name: { value: tagName, modifier: 'EQUALS' } }
    };

    try {
      // Use findTags (plural) instead of findTag (singular) as it's more widely supported
      const result = await this.gqlClient.query<FindTagsResponse>({
        query: queries.FIND_TAGS,
        variables,
        signal,
      });
      
      if (this.isAborted(signal)) return null;
      
      const tags = result.data?.findTags?.tags || [];
      if (tags.length > 0) {
        const tag = tags[0];
        // Validate exact match (case-insensitive) - EQUALS modifier might not work as expected
        if (tag.name.toLowerCase() === tagName.toLowerCase()) {
          // Found matching tag
          return tag;
        } else {
          this.logError('findTagByName', new Error(`Tag name mismatch: searched="${tagName}", found="${tag.name}"`));
          return null;
        }
      }
      return null;
    } catch (error: unknown) {
      return this.handleError('findTagByName', error, signal, null);
    }
  }

  /**
   * Create a new tag
   * If the tag already exists, attempts to find and return it
   */
  async createTag(tagName: string, signal?: AbortSignal): Promise<{ id: string; name: string } | null> {
    if (this.isAborted(signal)) return null;
    
    const variables: { input: TagCreateInput } = {
      input: { name: tagName }
    };

    try {
      const result = await this.gqlClient.mutate<TagCreateResponse>({
        mutation: mutations.TAG_CREATE,
        variables,
        signal,
      });
      
      if (this.isAborted(signal)) return null;
      
      return result.data?.tagCreate || null;
    } catch (error: unknown) {
      if (isAbortError(error) || this.isAborted(signal)) {
        return null;
      }
      
      // If tag already exists, try to find it
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('already exists') || errorMessage.includes('duplicate')) {
        this.logError('createTag', new Error(`Tag "${tagName}" already exists, attempting to find it`));
        // Try to find the existing tag
        const existingTag = await this.findTagByName(tagName, signal);
        if (existingTag) {
          return existingTag;
        }
      }
      this.logError('createTag', error);
      return null;
    }
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
    if (this.isAborted(signal)) return false;
    
    // If tags array is provided, use it directly (more efficient)
    if (tags) {
      return tags.some((tag) => tag.id === tagId);
    }
    
    // Otherwise, query for scene tags
    const variables = { id: sceneId };

    try {
      const result = await this.gqlClient.query<FindSceneResponse>({
        query: queries.FIND_SCENE_MINIMAL,
        variables,
        signal,
      });
      
      if (this.isAborted(signal)) return false;
      
      const sceneTags = result.data?.findScene?.tags || [];
      return sceneTags.some((tag: { id: string }) => tag.id === tagId);
    } catch (error: unknown) {
      return this.handleError('sceneHasTag', error, signal, false);
    }
  }

  /**
   * Update tags on a scene marker
   */
  private async updateMarkerTags(
    marker: {
      id: string;
      title: string;
      seconds: number;
      end_seconds?: number | null;
      scene: { id: string };
      primary_tag?: { id: string } | null;
      tags?: Array<{ id: string }>;
    },
    newTagIds: string[],
    signal?: AbortSignal
  ): Promise<void> {
    if (this.isAborted(signal)) return;
    
    // Ensure we have required fields
    if (!marker.primary_tag?.id) {
      throw new Error('Marker must have a primary_tag');
    }

    await this.updateMarkerTagsWithPrimary(marker, marker.primary_tag.id, newTagIds, signal);
  }

  async updateMarkerTagsWithPrimary(
    marker: {
      id: string;
      title: string;
      seconds: number;
      end_seconds?: number | null;
      scene: { id: string };
    },
    primaryTagId: string,
    tagIds: string[],
    signal?: AbortSignal
  ): Promise<void> {
    if (this.isAborted(signal)) return;

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
    
    if (this.isAborted(signal)) return;
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
    tagId: string,
    signal?: AbortSignal
  ): Promise<void> {
    if (this.isAborted(signal)) return;
    
    try {
      // Get current tags from marker data
      const currentTags: string[] = (marker.tags || []).map(t => t.id);

      // Add the new tag if not already present
      if (!currentTags.includes(tagId)) {
        await this.updateMarkerTags(marker, [...currentTags, tagId], signal);
      }
    } catch (error) {
      if (isAbortError(error) || this.isAborted(signal)) {
        return;
      }
      this.logError('addTagToMarker', error);
      throw error;
    }
  }

  /**
   * Update tags for an image
   */
  async updateImageTags(imageId: string, tagIds: string[], signal?: AbortSignal): Promise<void> {
    if (this.isAborted(signal)) return;
    
    try {
      await this.gqlClient.mutate<ImageUpdateResponse>({
        mutation: mutations.IMAGE_UPDATE,
        variables: {
          input: {
            id: imageId,
            tag_ids: tagIds,
          },
        },
        signal,
      });
      
      if (this.isAborted(signal)) return;
    } catch (error) {
      if (isAbortError(error) || this.isAborted(signal)) {
        return;
      }
      this.logError('updateImageTags', error);
      throw error;
    }
  }

  /**
   * Update performers for an image
   */
  async updateImagePerformers(imageId: string, performerIds: string[], signal?: AbortSignal): Promise<void> {
    if (this.isAborted(signal)) return;

    try {
      await this.gqlClient.mutate<ImageUpdateResponse>({
        mutation: mutations.IMAGE_UPDATE,
        variables: {
          input: {
            id: imageId,
            performer_ids: performerIds,
          },
        },
        signal,
      });

      if (this.isAborted(signal)) return;
    } catch (error) {
      if (isAbortError(error) || this.isAborted(signal)) {
        return;
      }
      this.logError('updateImagePerformers', error);
      throw error;
    }
  }

  /**
   * Increment image o-counter
   */
  async incrementImageOCount(imageId: string, signal?: AbortSignal): Promise<number> {
    if (this.isAborted(signal)) return 0;
    
    try {
      const result = await this.gqlClient.mutate<ImageIncrementOResponse>({
        mutation: mutations.IMAGE_INCREMENT_O,
        variables: {
          id: imageId,
        },
        signal,
      });
      
      if (this.isAborted(signal)) return 0;
      
      return result.data?.imageIncrementO ?? 0;
    } catch (error) {
      if (isAbortError(error) || this.isAborted(signal)) {
        return 0;
      }
      this.logError('incrementImageOCount', error);
      throw error;
    }
  }

  /**
   * Update performers on a scene
   */
  async updateScenePerformers(sceneId: string, performerIds: string[], signal?: AbortSignal): Promise<void> {
    if (this.isAborted(signal)) return;

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

    if (this.isAborted(signal)) return;
  }

  /**
   * Update tags on a scene
   */
  private async updateSceneTags(sceneId: string, tagIds: string[], signal?: AbortSignal): Promise<void> {
    if (this.isAborted(signal)) return;
    
    const variables = {
      input: {
        id: sceneId,
        tag_ids: tagIds
      }
    };

    await this.gqlClient.mutate<SceneUpdateResponse>({
      mutation: mutations.SCENE_UPDATE,
      variables,
      signal,
    });
    
    if (this.isAborted(signal)) return;
  }

  /**
   * Add a tag to a scene (kept for backwards compatibility)
   */
  async addTagToScene(sceneId: string, tagId: string, signal?: AbortSignal): Promise<void> {
    if (this.isAborted(signal)) return;
    
    // First get current scene tags
    try {
      // Get current tags
      const result = await this.gqlClient.query<FindSceneResponse>({
        query: queries.FIND_SCENE_MINIMAL,
        variables: { id: sceneId },
        signal,
      });
      
      if (this.isAborted(signal)) return;
      
      const currentTags: string[] = (result.data?.findScene?.tags || []).map((t: { id: string }) => t.id);

      // Add the new tag if not already present
      if (!currentTags.includes(tagId)) {
        await this.updateSceneTags(sceneId, [...currentTags, tagId], signal);
      }
    } catch (error) {
      if (isAbortError(error) || this.isAborted(signal)) {
        return;
      }
      this.logError('addTagToScene', error);
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
    tagId: string,
    signal?: AbortSignal
  ): Promise<void> {
    if (this.isAborted(signal)) return;
    
    try {
      // Get current tags from marker data
      const currentTags: string[] = (marker.tags || []).map(t => t.id);

      // Remove the tag
      const tagIds = currentTags.filter(id => id !== tagId);

      await this.updateMarkerTags(marker, tagIds, signal);
    } catch (error) {
      if (isAbortError(error) || this.isAborted(signal)) {
        return;
      }
      this.logError('removeTagFromMarker', error);
      throw error;
    }
  }

  /**
   * Remove a tag from a scene (kept for backwards compatibility)
   */
  async removeTagFromScene(sceneId: string, tagId: string, signal?: AbortSignal): Promise<void> {
    if (this.isAborted(signal)) return;
    
    // First get current scene tags
    try {
      // Get current tags
      const result = await this.gqlClient.query<FindSceneResponse>({
        query: queries.FIND_SCENE_MINIMAL,
        variables: { id: sceneId },
        signal,
      });
      
      if (this.isAborted(signal)) return;
      
      const currentTags: string[] = (result.data?.findScene?.tags || []).map((t: { id: string }) => t.id);

      // Remove the tag
      const tagIds = currentTags.filter(id => id !== tagId);

      await this.updateSceneTags(sceneId, tagIds, signal);
    } catch (error) {
      if (isAbortError(error) || this.isAborted(signal)) {
        return;
      }
      this.logError('removeTagFromScene', error);
      throw error;
    }
  }

  /**
   * Increment the o count for a scene
   * @param sceneId The scene ID
   * @param times Optional array of timestamps (if not provided, uses current time)
   * @param signal Optional abort signal
   * @returns The updated o count and history
   */
  async incrementOCount(sceneId: string, times?: string[], signal?: AbortSignal): Promise<{ count: number; history: string[] }> {
    if (this.isAborted(signal)) return { count: 0, history: [] };
    
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
      
      if (this.isAborted(signal)) return { count: 0, history: [] };
      
      const sceneAddO = result.data?.sceneAddO;
      if (sceneAddO && 'count' in sceneAddO) {
        return { count: sceneAddO.count ?? 0, history: times || [] };
      }
      // Return provided times in history even when count is missing
      return { count: 0, history: times || [] };
    } catch (error) {
      if (isAbortError(error) || this.isAborted(signal)) {
        return { count: 0, history: [] };
      }
      this.logError('incrementOCount', error);
      throw error;
    }
  }

  /**
   * Update the rating for a scene (0-10 scale → rating100)
   * @param sceneId Scene identifier
   * @param rating10 Rating on a 0-10 scale (can include decimals)
   * @param signal Optional abort signal
   * @returns Updated rating100 value from Stash
   */
  async updateSceneRating(sceneId: string, rating10: number, signal?: AbortSignal): Promise<number> {
    if (this.isAborted(signal)) return 0;
    
    // Input validation
    if (!sceneId || typeof sceneId !== 'string' || sceneId.trim() === '') {
      throw new Error('updateSceneRating: sceneId is required and must be a non-empty string');
    }
    if (typeof rating10 !== 'number' || !Number.isFinite(rating10)) {
      throw new TypeError('updateSceneRating: rating10 must be a finite number');
    }
    
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
        signal,
      });
      
      if (this.isAborted(signal)) return 0;

      // SceneUpdateResponse doesn't include rating100, so we return the value we set
      return rating100;
    } catch (error) {
      if (isAbortError(error) || this.isAborted(signal)) {
        return 0;
      }
      this.logError('updateSceneRating', error);
      throw error;
    }
  }

  /**
   * Update image rating
   * @param imageId Image ID
   * @param rating10 Rating value (0-10 scale)
   * @param signal Optional abort signal
   * @returns Updated rating100 value (0-100 scale)
   */
  async updateImageRating(imageId: string, rating10: number, signal?: AbortSignal): Promise<number> {
    if (this.isAborted(signal)) return 0;
    
    // Input validation
    if (!imageId || typeof imageId !== 'string' || imageId.trim() === '') {
      throw new Error('updateImageRating: imageId is required and must be a non-empty string');
    }
    if (typeof rating10 !== 'number' || !Number.isFinite(rating10)) {
      throw new TypeError('updateImageRating: rating10 must be a finite number');
    }
    
    const normalized = Number.isFinite(rating10) ? rating10 : 0;
    const clamped = Math.min(10, Math.max(0, normalized));
    const rating100 = Math.round(clamped * 10);

    const variables = {
      input: {
        id: imageId,
        rating100,
      },
    };

    try {
      await this.gqlClient.mutate<{ imageUpdate: { id: string } }>({
        mutation: mutations.IMAGE_UPDATE,
        variables,
        signal,
      });
      
      if (this.isAborted(signal)) return 0;

      // ImageUpdateResponse doesn't include rating100, so we return the value we set
      return rating100;
    } catch (error) {
      if (isAbortError(error) || this.isAborted(signal)) {
        return 0;
      }
      this.logError('updateImageRating', error);
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
      if (this.isAborted(signal)) {
        return [];
      }
      return result.data?.findTags?.tags || [];
    } catch (error: unknown) {
      if (isAbortError(error) || this.isAborted(signal)) {
        return [];
      }
      this.logError('findTagsForSelect', error);
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
    if (this.isAborted(signal)) {
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
      
      if (this.isAborted(signal)) {
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
      if (isAbortError(error) || this.isAborted(signal)) {
        throw new Error('Operation aborted');
      }
      this.logError('createSceneMarker', error);
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
      return this.handleError('fetchSceneMarkerTags', e, signal, []);
    }
  }

  /**
   * Extract marker times from scene marker tags response
   * Consolidates the extraction logic into a single method
   */
  private extractMarkerTimes(sceneMarkerTags: unknown): number[] {
    const tagGroups = Array.isArray(sceneMarkerTags) ? sceneMarkerTags : [sceneMarkerTags];
    const markerTimes: number[] = [];
    
    for (const tagGroup of tagGroups) {
      // Check if value is a tag group with scene_markers
      if (typeof tagGroup === 'object' && tagGroup !== null && 'scene_markers' in tagGroup) {
        const sceneMarkers = (tagGroup as { scene_markers?: Array<{ seconds?: number }> }).scene_markers;
        if (Array.isArray(sceneMarkers)) {
          const times = sceneMarkers
            .map(marker => marker.seconds)
            .filter((seconds): seconds is number => typeof seconds === 'number');
          markerTimes.push(...times);
        }
      }
    }
    
    return markerTimes;
  }

  /**
   * Determine orientation from width and height
   * @param width Width in pixels
   * @param height Height in pixels
   * @returns 'landscape', 'portrait', or 'square'
   */
  private getOrientation(width?: number, height?: number): Orientation {
    if (!width || !height || width <= 0 || height <= 0) {
      return null;
    }
    
    const aspectRatio = width / height;
    
    if (Math.abs(aspectRatio - 1) < StashAPI.ORIENTATION_TOLERANCE) {
      return 'square';
    } else if (aspectRatio > 1) {
      return 'landscape';
    } else {
      return 'portrait';
    }
  }

  /**
   * Get visual file dimensions from image
   */
  private getImageDimensions(image: Image): { width?: number; height?: number } | null {
    if (!image.visual_files || image.visual_files.length === 0) {
      return null;
    }
    
    const visualFile = image.visual_files.find(
      (file): file is VisualFile & { width: number; height: number } =>
        typeof file.width === 'number' &&
        typeof file.height === 'number'
    );
    
    return visualFile ? { width: visualFile.width, height: visualFile.height } : null;
  }

  /**
   * Filter images by orientation
   */
  private filterImagesByOrientation(
    images: Image[],
    orientationFilter: ImageOrientation[]
  ): Image[] {
    if (orientationFilter.length === 0) {
      return images;
    }
    
    return images.filter(image => {
      const dimensions = this.getImageDimensions(image);
      if (!dimensions?.width || !dimensions?.height) {
        // If orientation cannot be determined, include the image
        return true;
      }
      
      const orientation = this.getOrientation(dimensions.width, dimensions.height);
      return orientation === null || orientationFilter.includes(orientation);
    });
  }

  /**
   * Filter items by orientation (generic version for other types)
   * @param items Array of items with width/height properties
   * @param orientationFilter Array of allowed orientations
   * @param getWidth Function to get width from item
   * @param getHeight Function to get height from item
   * @returns Filtered array of items
   */
  private filterByOrientation<T>(
    items: T[],
    orientationFilter: ImageOrientation[] | undefined,
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
   * Converts ['.gif', '.webm'] to "(?i)\.(gif|webm)$" (case-insensitive)
   * @throws Error if fileExtensions is empty or all extensions are invalid
   */
  private buildPathRegex(fileExtensions: string[]): string {
    if (fileExtensions.length === 0) {
      throw new Error('buildPathRegex: fileExtensions array cannot be empty');
    }
    
    // Strip leading dots and validate
    const extensions = fileExtensions
      .map(ext => ext.trim().toLowerCase().replace(/^\./, ''))
      .filter(ext => ext.length > 0 && /^[a-z0-9]+$/i.test(ext));
    
    if (extensions.length === 0) {
      throw new Error('buildPathRegex: all file extensions are invalid');
    }
    
    // Build regex: (?i)\.(gif|webm|mp4)$ (case-insensitive)
    return String.raw`(?i)\.(${extensions.join('|')})$`;
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
      excludedTagIds?: string[];
      orientationFilter?: ImageOrientation[];
      sortSeed?: string;
    },
    limit: number = 40,
    offset: number = 0,
    signal?: AbortSignal
  ): Promise<{ images: Image[]; totalCount: number; sortSeed: string }> {
    if (this.isAborted(signal)) return { images: [], totalCount: 0, sortSeed: generateRandomSortSeed() };

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

    const excludedTagIds = filters?.excludedTagIds ?? [];

    // Add tag filter if provided
    if ((filters?.tagIds && filters.tagIds.length > 0) || excludedTagIds.length > 0) {
      imageFilter.tags = {
        value: filters?.tagIds ?? [],
        modifier: 'INCLUDES',
      };
      (imageFilter.tags as { excludes?: string[] }).excludes = excludedTagIds;
    }

    // Reuse existing sort seed for pagination, or generate new one for first page
    const sortSeed = filters?.sortSeed || generateRandomSortSeed();
    
    const findFilter: FindFilterInput = {
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

      if (this.isAborted(signal)) return { images: [], totalCount: 0, sortSeed: generateRandomSortSeed() };

      let images = result.data?.findImages?.images || [];
      const totalCount = result.data?.findImages?.count ?? 0;
      
      // Filter by orientation if specified
      if (filters?.orientationFilter && filters.orientationFilter.length > 0) {
        images = this.filterImagesByOrientation(images, filters.orientationFilter);
      }
      
      return { images, totalCount, sortSeed };
    } catch (e: unknown) {
      if (isAbortError(e) || this.isAborted(signal)) {
        return { images: [], totalCount: 0, sortSeed: generateRandomSortSeed() };
      }
      return this.handleError('findImages', e, signal, { images: [], totalCount: 0, sortSeed: generateRandomSortSeed() });
    }
  }

  /**
   * Get current UI configuration, including rating system settings
   * @param signal Optional abort signal
   * @returns Current rating system configuration or null if unavailable
   */
  async getUIConfiguration(signal?: AbortSignal): Promise<{ type?: string; starPrecision?: string } | null> {
    if (this.isAborted(signal)) return null;
    
    try {
      const result = await this.gqlClient.query<UIConfigurationResponse>({
        query: queries.GET_UI_CONFIGURATION,
        signal,
      });
      
      if (this.isAborted(signal)) return null;
      
      // UI is returned as a JSON string, need to parse it
      const uiConfig = result.data?.configuration?.ui;
      if (typeof uiConfig === 'string') {
        try {
          const parsed = JSON.parse(uiConfig) as { ratingSystemOptions?: { type?: string; starPrecision?: string } };
          return parsed.ratingSystemOptions || null;
        } catch {
          return null;
        }
      } else if (uiConfig && typeof uiConfig === 'object' && 'ratingSystemOptions' in uiConfig) {
        return (uiConfig as { ratingSystemOptions?: { type?: string; starPrecision?: string } }).ratingSystemOptions || null;
      }
      return null;
    } catch (error) {
      return this.handleError('getUIConfiguration', error, signal, null);
    }
  }

}


