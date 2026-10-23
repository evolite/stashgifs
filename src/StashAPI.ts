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
  FindSceneResponse,
  FindImagesResponse,
  FindGalleriesResponse,
  Gallery,
  GetSavedFiltersResponse,
  GetSavedFilterResponse,
  CheckTagsHaveMarkersResponse,
  FindSceneMarkerTagsResponse,
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
  UIConfigurationResponse,
  PluginConfigurationResponse,
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

type ImageOrientation = 'landscape' | 'portrait' | 'square';

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


/**
 * Generate a random sort seed in the format random_<8-digit-number>
 * Example: random_23120320
 */
export function generateRandomSortSeed(): string {
  const randomSeed = Math.floor(Math.random() * 100000000).toString().padStart(8, '0');
  return `random_${randomSeed}`;
}

type ImageFilterOptions = {
  performerIds?: number[];
  tagIds?: string[];
  excludedTagIds?: string[];
  studioIds?: string[];
  studioDepth?: number;
  tagDepth?: number;
  orientationFilter?: ImageOrientation[];
  dateRangeFilter?: DateRangeFilter;
  imagesInGalleryOnly?: boolean;
  galleryIds?: string[];
  showPerformerTags?: boolean;
  savedFilterId?: string; // IMAGES-mode saved filter; replaces tag/performer/studio selection
  sortSeed?: string;
};

export class StashAPI {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly pluginApi?: StashPluginApi;
  // Centralized GraphQL client
  private readonly gqlClient: GraphQLClient;
  // Simple cache for autocomplete search results only (not filtered queries)
  private readonly searchCache: Map<string, { data: unknown; timestamp: number }> = new Map();
  private readonly SEARCH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly _performerTagsCache = new Map<string, Array<{ id: string; name: string }>>();
  /** Per-tag EFFECTIVE presence across sources (own counts ∪ all descendants' counts, > 0), used
   *  to route a tag to the single filter field that can match it — including parent-only tags,
   *  which resolve to the sources their subtree lives in. Cached for the session. */
  private readonly _tagSourceCache = new Map<string, { marker: boolean; scene: boolean; performer: boolean; image: boolean }>();

  // Magic numbers as constants
  private static readonly SEARCH_FETCH_MULTIPLIER = 3; // Fetch 3x limit when searching to improve relevance
  private static readonly MIN_SEARCH_LIMIT = 20; // Minimum results to fetch when not searching
  private static readonly MIN_MARKER_COUNT_FOR_TAG_FILTER = 10; // Minimum markers required for tag to appear in suggestions
  private static readonly SHORT_FORM_SCENES_PER_PAGE = 24; // Number of scenes to fetch per page for short-form content
  private static readonly MAX_PAGE_FALLBACK = 100; // Fallback max page when count query fails
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
    
    // Initialize GraphQL client (response caching disabled - we handle caching selectively)
    this.gqlClient = new GraphQLClient({
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      pluginApi: this.pluginApi,
      enableResponseCache: false, // Disabled: filtered queries should not be cached
    });
  }

  destroy(): void {
    this.gqlClient.destroy();
  }

  /** Stash UI resolution labels -> ResolutionEnum (saved filters store the label). */
  private static readonly RESOLUTION_ENUMS: Record<string, string> = {
    '144p': 'VERY_LOW', '240p': 'LOW', '360p': 'R360P', '480p': 'STANDARD', '540p': 'WEB_HD',
    '720p': 'STANDARD_HD', '1080p': 'FULL_HD', '1440p': 'QUAD_HD', '4k': 'FOUR_K', '5k': 'FIVE_K',
    '6k': 'SIX_K', '7k': 'SEVEN_K', '8k': 'EIGHT_K', '8k+': 'HUGE',
  };

  private static readonly TEXT_CRITERIA = new Set(['title', 'details', 'path', 'url', 'code', 'photographer', 'checksum', 'name']);

  /** Range-style saved criterion ({value, value2} object) -> flat input. Undefined when it has no usable value. */
  private flattenSavedRange(key: string, modifier: string | undefined, range: { value?: unknown; value2?: unknown }): unknown {
    const isNullCheck = modifier === 'IS_NULL' || modifier === 'NOT_NULL';
    const hasValue = range.value !== null && range.value !== undefined;
    if (!hasValue && !isNullCheck) return undefined;
    const fallback = StashAPI.TEXT_CRITERIA.has(key) ? '' : 0;
    const hasValue2 = range.value2 !== null && range.value2 !== undefined;
    return {
      ...(modifier ? { modifier } : {}),
      value: hasValue ? range.value : fallback,
      ...(hasValue2 ? { value2: range.value2 } : {}),
    };
  }

  /**
   * Convert one non-ID criterion from Stash's saved-filter shape to the GraphQL input shape.
   * Saved filters store ranges as {modifier, value: {value, value2}} and booleans as strings, which the API
   * rejects wholesale. Returns undefined for anything we cannot convert (the criterion is then dropped).
   */
  private normalizeSavedCriterion(key: string, raw: unknown): unknown {
    if (raw === null || raw === undefined) return undefined;
    if (raw === 'true' || raw === 'false') return raw === 'true';
    if (typeof raw !== 'object' || Array.isArray(raw)) return raw;

    const crit = raw as { modifier?: string; value?: unknown };
    if (!('modifier' in crit) && !('value' in crit)) return raw;

    const { modifier, value } = crit;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return 'value' in value ? this.flattenSavedRange(key, modifier, value) : undefined;
    }
    const resolved = key === 'resolution' && typeof value === 'string'
      ? (StashAPI.RESOLUTION_ENUMS[value.toLowerCase()] ?? value)
      : value;
    return { ...(modifier ? { modifier } : {}), value: resolved };
  }

  /**
   * Normalize an object_filter coming from a saved filter (scene markers or images)
   * Stash stores criteria in its UI shape; this converts them to GraphQL input shapes (ID lists, ranges,
   * booleans, resolution) and drops criteria that can't be converted rather than sending a query Stash rejects.
   */
  private normalizeSavedObjectFilter<T = SceneMarkerFilterInput>(input: unknown): T {
    if (!input || typeof input !== 'object') return {} as T;
    const out: Record<string, unknown> = { ...(input as Record<string, unknown>) };
    const idStrings = new Set(['tags', 'scene_tags', 'performer_tags', 'studios', 'galleries']);
    const idNumbers = new Set(['scene_performers', 'performers']);
    const dropped: string[] = [];

    for (const key of Object.keys(out)) {
      const value = out[key];
      let normalized: unknown;
      if (idStrings.has(key)) normalized = this.normalizeTagFieldAsStrings(value);
      else if (idNumbers.has(key)) normalized = this.normalizeTagFieldAsNumbers(value);
      else if (key === 'AND' || key === 'OR' || key === 'NOT' || key.endsWith('_filter')) {
        normalized = value && typeof value === 'object' ? this.normalizeSavedObjectFilter<Record<string, unknown>>(value) : undefined;
      } else normalized = this.normalizeSavedCriterion(key, value);

      if (normalized === undefined) {
        delete out[key];
        dropped.push(key);
      } else {
        out[key] = normalized;
      }
    }

    if (dropped.length > 0) console.warn('[StashAPI] Saved filter criteria ignored (unsupported format):', dropped.join(', '));
    return out as T;
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
  /** Batch-fetch performer tags for a list of performers, populating tags in-place. Results are cached. */
  async enrichPerformerTags(performers: Performer[]): Promise<void> {
    const uncachedIds = [...new Set(
      // Performers that already arrived with a tags array (SceneFields/SlimImageData include it) need no lookup.
      performers.filter(p => p.id && !Array.isArray(p.tags) && !this._performerTagsCache.has(p.id)).map(p => p.id)
    )];
    if (uncachedIds.length > 0) {
      try {
        const result = await this.gqlClient.query<FindPerformerResponse>({
          query: queries.FIND_PERFORMER_TAGS,
          variables: { ids: uncachedIds },
        });
        for (const p of result.data?.findPerformers?.performers ?? []) {
          this._performerTagsCache.set(p.id, p.tags ?? []);
        }
      } catch { /* non-fatal — posts just show without performer tags */ }
    }
    for (const p of performers) {
      if (p.id && !p.tags?.length) {
        p.tags = this._performerTagsCache.get(p.id) ?? [];
      }
    }
  }

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

  // fallow-ignore-next-line unused-class-member
  async getStudioDetails(studioId: string, signal?: AbortSignal): Promise<StudioExtended | null> {
    if (this.isAborted(signal)) return null;
    try {
      const result = await this.gqlClient.query<FindStudioResponse>({
        query: queries.FIND_STUDIO,
        variables: { id: studioId },
        signal,
      });
      if (this.isAborted(signal)) return null;
      return result.data?.findStudio ?? null;
    } catch (error: unknown) {
      return this.handleError('getStudioDetails', error, signal, null);
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
   * Fetch saved filters the feed can apply (scene markers and images) from Stash
   */
  async fetchSavedFilters(signal?: AbortSignal): Promise<Array<{ id: string; name: string; mode: SavedFilterMode }>> {
    if (this.isAborted(signal)) return [];
    
    try {
      const result = await this.gqlClient.query<GetSavedFiltersResponse>({
        query: queries.GET_SAVED_FILTERS,
        signal,
      });
      
      if (this.isAborted(signal)) return [];
      return (result.data?.findSavedFilters || []).filter(
        (f): f is { id: string; name: string; mode: SavedFilterMode } => f.mode === 'SCENE_MARKERS' || f.mode === 'IMAGES'
      );
    } catch (error: unknown) {
      return this.handleError('fetchSavedFilters', error, signal, []);
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
   */
  async fetchSceneMarkers(filters?: FilterOptions, signal?: AbortSignal): Promise<{ markers: SceneMarker[]; totalCount: number; sortSeed?: string }> {
    if (this.isAborted(signal)) return { markers: [], totalCount: 0 };
    
    // Fetching scene markers with filters
    
    if (filters?.shuffleMode) {
      const { markers, sortSeed, totalCount } = await this.fetchScenesForShuffle(filters, signal);
      return { markers, totalCount, sortSeed };
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
      // buildSceneMarkerFilter routes each selected tag to its source field (tags / scene_tags /
      // scene_filter.performer_tags) and ANDs them — one exact, tight query, no client narrowing
      // for single-source tags. Multi-source tags are deferred to FeedContainer's union check.
      const sceneMarkerFilter = this.buildSceneMarkerFilter(filters, savedFilterCriteria);

      const { markers, totalCount } = await this.executeMarkerQueryWithCount(filter, sceneMarkerFilter, signal);
      if (this.isAborted(signal)) return { markers: [], totalCount: 0 };

      await this.maybeEnrichPerformerTags(markers, filters);
      return { markers, totalCount, sortSeed: filter.sort };
    } catch (error: unknown) {
      return this.handleError('fetchSceneMarkers', error, signal, { markers: [], totalCount: 0 });
    }
  }

  private async maybeEnrichPerformerTags(markers: SceneMarker[], filters?: FilterOptions): Promise<void> {
    if (filters?.showPerformerTags) await this.enrichPerformerTags(markers.flatMap(m => m.scene?.performers ?? []));
  }

  /**
   * Get saved filter criteria if a saved filter ID is provided
   */
  private async getSavedFilterCriteria(filters?: { savedFilterId?: string }, signal?: AbortSignal): Promise<GetSavedFilterResponse['findSavedFilter']> {
    if (!filters?.savedFilterId) return null;
    return await this.getSavedFilter(filters.savedFilterId, signal);
  }

  /**
   * Check if any active filters are present
   */
  private hasActiveFilters(filters?: FilterOptions): boolean {
    return !!(
      filters?.tags?.length ||
      filters?.studios?.length ||
      filters?.performers?.length ||
      filters?.savedFilterId ||
      (filters?.query && filters.query.trim() !== '')
    );
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
      
      const markerVariables = {
        filter: countFilter,
        scene_marker_filter: Object.keys(countSceneFilter).length > 0 ? countSceneFilter : {},
      };
      const rawCount = await this.cachedCount(`markers:${JSON.stringify(markerVariables)}`, async () => {
        const countResult = await this.gqlClient.query<CheckTagsHaveMarkersResponse>({
          query: queries.GET_MARKER_COUNT,
          variables: markerVariables, // no caller signal: shared promise (see cachedCount)
        });
        return countResult.data?.findSceneMarkers?.count || 0;
      });
      
      if (this.isAborted(signal)) return 1;
      
      const totalCount = Math.min(rawCount, this._maxContentLimit);
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
    const countSceneFilter = this.normalizeSavedObjectFilter(savedFilterCriteria?.object_filter || {});

    // Mirror the main marker query's routing so the random-page count matches what the feed shows.
    if (!filters?.savedFilterId) {
      this.applyTagAndPerformerFilters(filters, countSceneFilter, { isMarkerFilter: true });
    }

    this.applyOrientationToMarkerFilter(countSceneFilter, filters);
    
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
    studioIds: string[];
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

    const studioIds: string[] = filters?.studios && filters.studios.length > 0 ? [...filters.studios] : [];

    return {
      tagIds,
      performerIds,
      excludedTagIds,
      studioIds,
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
    const sceneMarkerFilter = this.normalizeSavedObjectFilter(sceneMarkerFilterRaw);
    
    if (!filters?.savedFilterId) {
      this.applyTagAndPerformerFilters(filters, sceneMarkerFilter, { isMarkerFilter: true });
    }

    this.applyOrientationToMarkerFilter(sceneMarkerFilter, filters);
    const createdAt = this.resolveCreatedAtCriterion(filters?.dateRangeFilter);
    if (createdAt) sceneMarkerFilter.created_at = createdAt;

    return sceneMarkerFilter;
  }

  /** Add an `excludes` list to a hierarchical tag criterion, creating it (excludes-only) if the
   *  field has no positive value yet, or merging onto an existing positive criterion. */
  private static addExcludes(
    field: { value?: string[]; modifier?: 'INCLUDES' | 'INCLUDES_ALL' | 'EXCLUDES'; depth?: number; excludes?: string[] } | undefined,
    excludes: string[],
    depth: number
  ): { value: string[]; modifier: 'INCLUDES' | 'INCLUDES_ALL' | 'EXCLUDES'; depth: number; excludes: string[] } {
    return {
      value: field?.value ?? [],
      modifier: field?.modifier ?? 'INCLUDES',
      depth: field?.depth ?? depth,
      excludes,
    };
  }

  /**
   * Exclude tags server-side from every ENABLED source field (ANDed = "not present in any enabled
   * source"), so exclusion needs no client-side pass. Merges onto positive criteria already
   * written by applyRoutedTags. Uses the same depth as positive matching so excluding a parent
   * hides its subtree.
   */
  private applyExcludedTags(
    targetFilter: SceneMarkerFilterInput | SceneFilterInput,
    excludedTagIds: string[],
    depth: number,
    enabled: { marker: boolean; scene: boolean; performer: boolean },
    shape: 'marker' | 'scene'
  ): void {
    const uniqueExcluded = Array.from(new Set(excludedTagIds));
    if (uniqueExcluded.length === 0) return;
    if (shape === 'marker') {
      const f = targetFilter as SceneMarkerFilterInput;
      if (enabled.marker) f.tags = StashAPI.addExcludes(f.tags, uniqueExcluded, depth);
      if (enabled.scene) f.scene_tags = StashAPI.addExcludes(f.scene_tags, uniqueExcluded, depth);
      if (enabled.performer) {
        f.scene_filter ??= {};
        f.scene_filter.performer_tags = StashAPI.addExcludes(f.scene_filter.performer_tags, uniqueExcluded, depth);
      }
    } else {
      const f = targetFilter as SceneFilterInput;
      if (enabled.scene) f.tags = StashAPI.addExcludes(f.tags, uniqueExcluded, depth);
      if (enabled.performer) f.performer_tags = StashAPI.addExcludes(f.performer_tags, uniqueExcluded, depth);
    }
  }

  /**
   * Apply performer filters to a filter object
   */
  private applyPerformersToFilter(targetFilter: SceneMarkerFilterInput | SceneFilterInput, performerIds: number[]): void {
    if (performerIds.length > 0) {
      targetFilter.performers = {
        value: performerIds,
        modifier: 'INCLUDES_ALL'
      };
    }
  }

  private static readonly DATE_RANGE_DAYS: Record<DateRangeFilter, number> = {
    week: 7,
    month: 30,
    year: 365,
  };

  private resolveCreatedAtCriterion(
    dateRangeFilter?: DateRangeFilter
  ): { value: string; modifier: 'GREATER_THAN' } | undefined {
    if (!dateRangeFilter) return undefined;
    const days = StashAPI.DATE_RANGE_DAYS[dateRangeFilter];
    return { value: new Date(Date.now() - days * 86_400_000).toISOString(), modifier: 'GREATER_THAN' };
  }

  private resolveOrientationEnumValues(filters?: FilterOptions): string[] {
    const orientationFilter = filters?.orientationFilter ?? [];
    if (orientationFilter.length === 0) {
      return [];
    }

    const orientationMap: Record<string, string> = {
      portrait: 'PORTRAIT',
      landscape: 'LANDSCAPE',
      square: 'SQUARE'
    };

    return orientationFilter
      .map((value) => orientationMap[value])
      .filter((value): value is string => Boolean(value));
  }

  private applyStudiosToSceneFilter(targetFilter: SceneFilterInput, studioIds: string[], depth: number = 0): void {
    if (studioIds.length > 0) {
      targetFilter.studios = { value: studioIds, modifier: 'INCLUDES', depth };
    }
  }

  private applyOrientationToSceneFilter(targetFilter: SceneFilterInput, filters?: FilterOptions): void {
    const orientations = this.resolveOrientationEnumValues(filters);
    if (orientations.length === 0) {
      return;
    }

    targetFilter.orientation = {
      value: orientations.length === 1 ? orientations[0] : orientations
    };
  }

  private applyOrientationToMarkerFilter(targetFilter: SceneMarkerFilterInput, filters?: FilterOptions): void {
    const orientations = this.resolveOrientationEnumValues(filters);
    if (orientations.length === 0) {
      return;
    }

    const sceneFilter: SceneFilterInput = targetFilter.scene_filter ?? {};
    sceneFilter.orientation = {
      value: orientations.length === 1 ? orientations[0] : orientations
    };
    targetFilter.scene_filter = sceneFilter;
  }

  /** A tag id that no item can have — used to force an empty result when a tag selection is
   *  unsatisfiable in the current feed (its only source is disabled). */
  private static readonly IMPOSSIBLE_TAG = '-1';

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
    const desc = (alias: string, field: string) =>
      `${alias}:findTags(tag_filter:{parents:{value:[$id],modifier:INCLUDES,depth:-1},${field}:{value:0,modifier:GREATER_THAN}},filter:{per_page:1}){count}`;
    const variables: Record<string, string> = {};
    const defs: string[] = [];
    const fields: string[] = [];
    missing.forEach((id, i) => {
      variables[`id${i}`] = id;
      defs.push(`$id${i}:ID!`);
      fields.push(
        `self${i}:findTags(ids:[$id${i}]){tags{scene_count scene_marker_count performer_count image_count}}`,
        desc(`dm${i}`, 'marker_count').replaceAll('$id', `$id${i}`),
        desc(`ds${i}`, 'scene_count').replaceAll('$id', `$id${i}`),
        desc(`dp${i}`, 'performer_count').replaceAll('$id', `$id${i}`),
        desc(`di${i}`, 'image_count').replaceAll('$id', `$id${i}`),
      );
    });
    try {
      const result = await this.gqlClient.query<Record<string, { tags?: Counts[]; count?: number } | undefined>>({
        query: `query TagSources(${defs.join(',')}){${fields.join('\n')}}`,
        variables,
      });
      const data = result.data ?? {};
      missing.forEach((id, i) => {
        const own = data[`self${i}`]?.tags?.[0];
        this._tagSourceCache.set(id, {
          marker: (own?.scene_marker_count ?? 0) > 0 || (data[`dm${i}`]?.count ?? 0) > 0,
          scene: (own?.scene_count ?? 0) > 0 || (data[`ds${i}`]?.count ?? 0) > 0,
          performer: (own?.performer_count ?? 0) > 0 || (data[`dp${i}`]?.count ?? 0) > 0,
          image: (own?.image_count ?? 0) > 0 || (data[`di${i}`]?.count ?? 0) > 0,
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
  /** Groups tagIds by effective source; returns undefined if a tag resolves to no enabled source (unsatisfiable). */
  private groupTagsBySource(
    tagIds: string[],
    enabledList: Array<'marker' | 'scene' | 'performer'>
  ): { marker: string[]; scene: string[]; performer: string[] } | undefined {
    const primary = enabledList[0];
    const groups = { marker: [] as string[], scene: [] as string[], performer: [] as string[] };
    for (const id of tagIds) {
      const src = this._tagSourceCache.get(id);
      // uncached → primary enabled source (best-effort, still server-side)
      const target = src ? enabledList.find((s) => src[s]) : primary;
      if (src && !target) return undefined; // resolved and in no enabled source → unsatisfiable, force empty
      if (target) groups[target].push(id);
    }
    return groups;
  }

  private assignRoutedTagGroups(
    targetFilter: SceneMarkerFilterInput | SceneFilterInput,
    groups: { marker: string[]; scene: string[]; performer: string[] },
    shape: 'marker' | 'scene',
    incAll: (value: string[]) => { value: string[]; modifier: 'INCLUDES_ALL'; depth: number }
  ): void {
    if (shape === 'marker') {
      const f = targetFilter as SceneMarkerFilterInput;
      if (groups.marker.length) f.tags = incAll(groups.marker);
      if (groups.scene.length) f.scene_tags = incAll(groups.scene);
      if (groups.performer.length) { f.scene_filter ??= {}; f.scene_filter.performer_tags = incAll(groups.performer); }
    } else {
      const f = targetFilter as SceneFilterInput;
      if (groups.scene.length) f.tags = incAll(groups.scene);
      if (groups.performer.length) f.performer_tags = incAll(groups.performer);
    }
  }

  private applyRoutedTags(
    targetFilter: SceneMarkerFilterInput | SceneFilterInput,
    tagIds: string[],
    depth: number,
    enabled: { marker: boolean; scene: boolean; performer: boolean },
    shape: 'marker' | 'scene'
  ): void {
    const incAll = (value: string[]) => ({ value, modifier: 'INCLUDES_ALL' as const, depth });
    const priority = (shape === 'marker' ? ['marker', 'scene', 'performer'] : ['scene', 'performer']) as Array<'marker' | 'scene' | 'performer'>;
    const enabledList = priority.filter((s) => enabled[s]);

    const groups = this.groupTagsBySource(tagIds, enabledList);
    if (!groups) {
      if (shape === 'marker') (targetFilter as SceneMarkerFilterInput).tags = incAll([StashAPI.IMPOSSIBLE_TAG]);
      else (targetFilter as SceneFilterInput).tags = incAll([StashAPI.IMPOSSIBLE_TAG]);
      return;
    }
    this.assignRoutedTagGroups(targetFilter, groups, shape, incAll);
  }

  /**
   * Apply tag and performer filters to a filter object
   */
  private applyTagAndPerformerFilters(
    filters: FilterOptions | undefined,
    targetFilter: SceneMarkerFilterInput | SceneFilterInput,
    options: { isMarkerFilter: boolean }
  ): void {
    const { tagIds, performerIds, excludedTagIds, studioIds } = this.extractTagAndPerformerFilters(filters);
    const tagDepth = filters?.tagDepth ?? 0;
    const shape = options.isMarkerFilter ? 'marker' : 'scene';
    const enabled = options.isMarkerFilter
      ? { marker: true, scene: !!filters?.includeSceneTagsInMarkerFilter, performer: !!filters?.showPerformerTags }
      : { marker: false, scene: true, performer: !!filters?.showPerformerTags };

    if (tagIds.length > 0) {
      this.applyRoutedTags(targetFilter, tagIds, tagDepth, enabled, shape);
    }

    if (excludedTagIds.length > 0) {
      this.applyExcludedTags(targetFilter, excludedTagIds, tagDepth, enabled, shape);
    }

    this.applyPerformersToFilter(targetFilter, performerIds);

    if (studioIds.length > 0) {
      const studioDepth = filters?.studioDepth ?? 0;
      if (options.isMarkerFilter) {
        const markerFilter = targetFilter as SceneMarkerFilterInput;
        markerFilter.scene_filter ??= {};
        this.applyStudiosToSceneFilter(markerFilter.scene_filter, studioIds, studioDepth);
      } else {
        this.applyStudiosToSceneFilter(targetFilter as SceneFilterInput, studioIds, studioDepth);
      }
    }
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
  private async fetchScenesForShuffle(filters?: FilterOptions, signal?: AbortSignal): Promise<{ markers: SceneMarker[]; sortSeed: string; totalCount: number }> {
    try {
      const limit = filters?.limit || 20;
      let page: number;
      let totalCount: number;

      if (filters?.offset) {
        page = Math.floor(filters.offset / limit) + 1;
        totalCount = await this.getShuffleSceneCount(filters, signal);
      } else {
        const result = await this.calculateRandomScenePage(filters, limit, signal);
        if (this.isAborted(signal)) return { markers: [], sortSeed: generateRandomSortSeed(), totalCount: 0 };
        page = result.page;
        totalCount = result.totalCount;
      }

      if (this.isAborted(signal)) return { markers: [], sortSeed: generateRandomSortSeed(), totalCount: 0 };

      const sortSeed = filters?.sortSeed || generateRandomSortSeed();
      const filter: FindFilterInput = { per_page: limit, page, sort: sortSeed };
      const sceneFilter = this.buildShuffleSceneFilter(filters);
      const scenes = await this.fetchScenesQuery(filter, sceneFilter, signal);

      if (this.isAborted(signal)) return { markers: [], sortSeed, totalCount: 0 };

      return { markers: this.createSyntheticMarkers(scenes, 'synthetic', limit), sortSeed, totalCount };
    } catch (error: unknown) {
      const emptyResult = { markers: [] as SceneMarker[], sortSeed: generateRandomSortSeed(), totalCount: 0 };
      return this.handleError('fetchScenesForShuffle', error, signal, emptyResult);
    }
  }

  private async getShuffleSceneCount(filters?: FilterOptions, signal?: AbortSignal): Promise<number> {
    const countFilter: FindFilterInput = { per_page: 1, page: 1 };
    const sceneFilter = this.buildShuffleSceneFilter(filters);
    try {
      if (this.isAborted(signal)) return 0;
      const result = await this.gqlClient.query<FindScenesResponse>({
        query: queries.GET_SCENE_COUNT,
        variables: { filter: countFilter, ...(sceneFilter && { scene_filter: sceneFilter }) },
        signal,
      });
      return result.data?.findScenes?.count || 0;
    } catch (e: unknown) {
      if (isAbortError(e) || this.isAborted(signal)) return 0;
      this.logError('getShuffleSceneCount', e);
      return 0;
    }
  }

  /**
   * Calculate random page for shuffle mode
   */
  /**
   * Short-lived memo for count-only queries. Paging re-asks the same count for the same filter on
   * every page; the answer only matters for page math, so a minute of staleness is harmless.
   * Failures/aborts are evicted so the next call retries.
   */
  private readonly _countCache = new Map<string, { at: number; value: Promise<number> }>();
  private static readonly COUNT_TTL_MS = 60_000;

  private cachedCount(key: string, load: () => Promise<number>): Promise<number> {
    const hit = this._countCache.get(key);
    if (hit && Date.now() - hit.at < StashAPI.COUNT_TTL_MS) return hit.value;
    const value = load();
    this._countCache.set(key, { at: Date.now(), value });
    value.catch(() => {
      if (this._countCache.get(key)?.value === value) this._countCache.delete(key);
    });
    return value;
  }

  /** Runs the GET_SCENE_COUNT query (per_page:1, page:1 — count only, no rows) shared by shuffle-mode and short-form page math. */
  private fetchSceneCount(sceneFilter: SceneFilterInput | null, signal?: AbortSignal): Promise<number> {
    const countFilter: FindFilterInput = { per_page: 1, page: 1 };
    return this.cachedCount(`scenes:${JSON.stringify(sceneFilter)}`, async () => {
      const countResult = await this.gqlClient.query<FindScenesResponse>({
        query: queries.GET_SCENE_COUNT,
        variables: { filter: countFilter, ...(sceneFilter && { scene_filter: sceneFilter }) },
        // No caller signal: the promise is shared, so one caller aborting must not fail the others.
      });
      return countResult.data?.findScenes?.count || 0;
    });
  }

  private async calculateRandomScenePage(filters: FilterOptions | undefined, limit: number, signal?: AbortSignal): Promise<{ page: number; totalCount: number }> {
    const sceneFilter = this.buildShuffleSceneFilter(filters);

    try {
      if (this.isAborted(signal)) return { page: 1, totalCount: 0 };

      const totalCount = await this.fetchSceneCount(sceneFilter, signal);

      if (this.isAborted(signal)) return { page: 1, totalCount: 0 };

      if (totalCount > 0) {
        const totalPages = Math.ceil(totalCount / limit);
        return { page: Math.floor(Math.random() * totalPages) + 1, totalCount };
      }
    } catch (e: unknown) {
      if (isAbortError(e) || this.isAborted(signal)) {
        return { page: 1, totalCount: 0 };
      }
      this.logError('calculateRandomScenePage', e);
    }

    return { page: 1, totalCount: 0 };
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
    this.applyOrientationToSceneFilter(sceneFilter, filters);


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
      const rawCount = await this.fetchSceneCount(sceneFilter, signal);

      if (this.isAborted(signal)) return { maxPage: 0, totalCount: 0 };

      totalCount = Math.min(rawCount, this._maxContentLimit);
      
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
    this.applyOrientationToSceneFilter(sceneFilter, filters);
    const createdAt = this.resolveCreatedAtCriterion(filters?.dateRangeFilter);
    if (createdAt) sceneFilter.created_at = createdAt;

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
   * Build scene filter for scene-preview content
   */
  private buildScenePreviewFilter(filters?: FilterOptions): SceneFilterInput | null {
    const sceneFilter: SceneFilterInput = {};
    this.applyTagAndPerformerFilters(filters, sceneFilter, { isMarkerFilter: false });
    this.applyOrientationToSceneFilter(sceneFilter, filters);
    const createdAt = this.resolveCreatedAtCriterion(filters?.dateRangeFilter);
    if (createdAt) sceneFilter.created_at = createdAt;
    return Object.keys(sceneFilter).length > 0 ? sceneFilter : null;
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
    if (this.isAborted(signal)) return { markers: [], totalCount: 0, unfilteredOffsetConsumed: 0, sortSeed: generateRandomSortSeed() };

    try {
      const scenesPerPage = StashAPI.SHORT_FORM_SCENES_PER_PAGE;

      const sceneFilter = this.buildScenePreviewFilter(filters);

      const { maxPage, totalCount } = await this.getMaxPageForShortForm(sceneFilter, scenesPerPage, signal);
      if (maxPage === 0) {
        return { markers: [], totalCount: 0, unfilteredOffsetConsumed: 0, sortSeed: generateRandomSortSeed() };
      }

      const page = Math.floor(offset / scenesPerPage) + 1;
      const actualPage = Math.min(page, maxPage);
      const offsetInPage = offset % scenesPerPage;

      const sortSeed = filters?.sortSeed || generateRandomSortSeed();

      const filter: FindFilterInput = {
        per_page: scenesPerPage,
        page: actualPage,
        sort: sortSeed,
      };

      const scenes = await this.fetchScenesQuery(filter, sceneFilter, signal);
      if (this.isAborted(signal)) return { markers: [], totalCount: 0, unfilteredOffsetConsumed: 0, sortSeed: generateRandomSortSeed() };

      // Drop scenes without a generated preview (client-side backup filter)
      const previewableScenes = scenes.filter((scene) => !!scene.paths?.preview);

      const limitedScenes = previewableScenes.slice(offsetInPage, offsetInPage + limit);

      const markers = this.createScenePreviewMarkers(limitedScenes);

      const unfilteredOffsetConsumed = offsetInPage + limitedScenes.length;

      return { markers, totalCount, unfilteredOffsetConsumed, sortSeed };
    } catch (error: unknown) {
      return this.handleError('fetchScenePreviews', error, signal, { markers: [], totalCount: 0, unfilteredOffsetConsumed: 0, sortSeed: generateRandomSortSeed() });
    }
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
    const normalizedUrl = normalizeMediaUrl(url);
    if (!normalizedUrl) {
      return this.getVideoUrl(marker.scene);
    }
    
    return this.addCacheBusting(normalizedUrl);
  }

  /**
   * Get video URL for a scene
   * Tries multiple sources in order: sceneStreams, stream path, file path
   */
  getVideoUrl(scene: Scene): string | undefined {
    const cap = this.resolutionCapFor(scene);

    // A capped scene must NOT use the direct stream (it ignores ?resolution=);
    // go straight to the transcoded stream path so the cap takes effect.
    if (!cap) {
      const streamUrl = this.tryGetUrlFromStreams(scene);
      if (streamUrl) return streamUrl;
    }

    // Try stream path
    const streamPathUrl = this.tryGetUrlFromPath(scene.paths?.stream, cap);
    if (streamPathUrl) return streamPathUrl;

    if (cap) {
      // Last-ditch: a non-direct transcode entry from sceneStreams.
      const transcoded = this.pickTranscodedStream(scene);
      if (transcoded) return this.buildAndValidateUrl(StashAPI.capStreamUrl(transcoded, cap));
    }

    // Try file path as last resort
    const filePathUrl = this.tryGetUrlFromFiles(scene.files);
    if (filePathUrl) return filePathUrl;

    return undefined;
  }

  /** Stash transcode-resolution enum for the current cap, or undefined when the
   *  scene is within the cap (or the cap is off). */
  private resolutionCapFor(scene: Scene): string | undefined {
    if (this._maxResolution <= 0) return undefined;
    const file = scene.files?.[0];
    const height = file?.height ?? file?.width ?? 0;
    if (height <= this._maxResolution) return undefined;
    return StashAPI.resolutionEnum(this._maxResolution);
  }

  /** Map a cap in px to the nearest Stash transcode-size enum at or below it. */
  static resolutionEnum(px: number): string {
    if (px <= 240) return 'LOW';
    if (px <= 480) return 'STANDARD';
    if (px <= 720) return 'STANDARD_HD';
    if (px <= 1080) return 'FULL_HD';
    return 'FOUR_K';
  }

  /** Set/replace the `resolution` query param on a Stash stream URL. */
  static capStreamUrl(url: string, resolutionEnum: string): string {
    const [base, hash] = url.split('#');
    const [path, query = ''] = base.split('?');
    const params = query
      .split('&')
      .filter((p) => p && !p.startsWith('resolution='));
    params.push(`resolution=${resolutionEnum}`);
    const fragment = hash ? `#${hash}` : '';
    return `${path}?${params.join('&')}${fragment}`;
  }

  private pickTranscodedStream(scene: Scene): string | undefined {
    const streams = scene.sceneStreams ?? [];
    const nonDirect = streams.find((s) => !(s.label ?? '').toLowerCase().includes('direct'));
    return nonDirect?.url?.trim() || undefined;
  }

  private tryGetUrlFromStreams(scene: Scene): string | undefined {
    if (!scene.sceneStreams?.length) return undefined;
    const streamUrl = scene.sceneStreams[0]?.url?.trim();
    if (!streamUrl) return undefined;
    return this.buildAndValidateUrl(streamUrl);
  }

  /**
   * Build an ordered list of playable sources for a scene, for a player (video.js)
   * that selects/falls-back by MIME type. Order:
   *   1. Direct stream first IF the browser can decode the file's codec (cheapest, best quality).
   *   2. HLS (Stash transcodes/remuxes to a browser-compatible codec — always plays).
   *   3. Other forced-transcode variants (MP4/WebM), then DASH.
   *   4. Direct stream last as a final fallback when codec support is unknown.
   * URLs are NOT cache-busted: Stash keys transcode sessions on the URL, so a stable
   * URL lets it resume an existing transcode instead of restarting one each load.
   */
  getSceneSources(scene: Scene): VideoSource[] {
    const out: VideoSource[] = [];
    const seen = new Set<string>();
    const cap = this.resolutionCapFor(scene);
    const push = (rawUrl: string | undefined, type?: string): void => {
      const capped = rawUrl && cap ? StashAPI.capStreamUrl(rawUrl, cap) : rawUrl;
      const built = this.buildStreamUrl(capped);
      if (built && !seen.has(built)) {
        seen.add(built);
        out.push(type ? { src: built, type } : { src: built });
      }
    };

    const streams = scene.sceneStreams ?? [];
    const isHls = (s: { mime_type?: string; label?: string }) =>
      (s.mime_type ?? '').toLowerCase().includes('mpegurl') || (s.label ?? '').toUpperCase().includes('HLS');
    const isDash = (s: { mime_type?: string; label?: string }) =>
      (s.mime_type ?? '').toLowerCase().includes('dash') || (s.label ?? '').toUpperCase().includes('DASH');
    const isDirect = (s: { label?: string }) => (s.label ?? '').toLowerCase().includes('direct');

    const direct = streams.filter(isDirect);
    const hls = streams.filter(isHls);
    const dash = streams.filter(isDash);
    const rest = streams.filter((s) => !isDirect(s) && !isHls(s) && !isDash(s));

    // A capped scene skips the direct stream entirely — it can't be resolution-limited.
    const directPlayable = !cap && this.isDirectPlayable(scene);
    if (directPlayable) {
      for (const s of direct) push(s.url, s.mime_type || 'video/mp4');
    }
    for (const s of hls) push(s.url, s.mime_type || 'application/x-mpegURL');
    for (const s of rest) push(s.url, s.mime_type || 'video/mp4');
    for (const s of dash) push(s.url, s.mime_type || 'application/dash+xml');
    if (!directPlayable && !cap) {
      for (const s of direct) push(s.url, s.mime_type || 'video/mp4');
    }

    // Fallbacks when sceneStreams is empty (older Stash or odd configs).
    if (out.length === 0) {
      push(scene.paths?.stream ?? undefined, 'video/mp4');
      push(scene.files?.[0]?.path, 'video/mp4');
    }
    return out;
  }

  /**
   * Whether the browser is likely able to directly decode the scene's primary
   * video codec. Conservative: H.264/AVC always; HEVC/AV1/VP9 only if canPlayType
   * reports support. Unknown codecs default to true (the error-fallback in the
   * player handles a wrong guess).
   */
  private isDirectPlayable(scene: Scene): boolean {
    const codec = scene.files?.find((f) => f.video_codec)?.video_codec?.toLowerCase();
    if (!codec) return true;
    if (codec.includes('264') || codec.includes('avc')) return true;

    const probe = (mime: string): boolean => {
      try {
        return !!document.createElement('video').canPlayType(mime);
      } catch {
        return false;
      }
    };
    if (codec.includes('hevc') || codec.includes('265')) {
      return probe('video/mp4; codecs="hvc1"') || probe('video/mp4; codecs="hev1"');
    }
    if (codec.includes('av1') || codec.includes('av01')) {
      return probe('video/mp4; codecs="av01.0.05M.08"');
    }
    if (codec.includes('vp9')) return probe('video/webm; codecs="vp9"');
    if (codec.includes('vp8')) return probe('video/webm; codecs="vp8"');
    return true;
  }

  /** Build a full, normalized stream URL without cache-busting (see getSceneSources). */
  private buildStreamUrl(path?: string | null): string | undefined {
    const trimmed = path?.trim();
    if (!trimmed) return undefined;
    return normalizeMediaUrl(this.buildUrl(trimmed)) ?? undefined;
  }

  private tryGetUrlFromPath(path?: string | null, resolutionEnum?: string): string | undefined {
    const trimmedPath = path?.trim();
    if (!trimmedPath) return undefined;
    const capped = resolutionEnum ? StashAPI.capStreamUrl(trimmedPath, resolutionEnum) : trimmedPath;
    return this.buildAndValidateUrl(capped);
  }

  private tryGetUrlFromFiles(files?: Array<{ path?: string | null }>): string | undefined {
    if (!files?.length) return undefined;
    const filePath = files[0]?.path?.trim();
    if (!filePath) return undefined;
    return this.buildAndValidateUrl(filePath);
  }

  private buildAndValidateUrl(path: string): string | undefined {
    const url = this.buildUrl(path);
    const normalizedUrl = normalizeMediaUrl(url);
    if (!normalizedUrl) return undefined;
    return this.addCacheBusting(normalizedUrl);
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
    const clean = stripApiKey(url);
    const separator = clean.includes('?') ? '&' : '?';
    return `${clean}${separator}t=${Date.now()}`;
  }


  /**
   * Find a tag by name
   */
  /** Resolved tags by lowercase name — callers re-resolve the same few tags (favorite, bookmark, excluded) on every load. Misses aren't cached (the tag may be created later). */
  private readonly _tagByNameCache = new Map<string, { id: string; name: string }>();

  async findTagByName(tagName: string, signal?: AbortSignal): Promise<{ id: string; name: string } | null> {
    if (this.isAborted(signal)) return null;
    const cacheKey = tagName.toLowerCase();
    const cached = this._tagByNameCache.get(cacheKey);
    if (cached) return cached;
    
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
          this._tagByNameCache.set(cacheKey, tag);
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
    
    try {
      const sceneTagIds = await this.getSceneTagIdSet(sceneId);
      if (this.isAborted(signal)) return false;
      return sceneTagIds.has(tagId);
    } catch (error: unknown) {
      return this.handleError('sceneHasTag', error, signal, false);
    }
  }

  /** Scene tag ids fetched so far, so repeat checks and toggles don't re-query. */
  private readonly _sceneTagIdCache = new Map<string, { at: number; ids: Set<string> }>();
  private static readonly SCENE_TAGS_TTL_MS = 60_000;
  private _sceneTagBatch: Map<string, Array<{ resolve: (ids: Set<string>) => void; reject: (e: unknown) => void }>> | undefined;

  /**
   * Tag ids of a scene. Requests made within a few ms (one per post while a page renders)
   * coalesce into a single findScenes(ids: [...]) instead of one findScene per post.
   */
  private getSceneTagIdSet(sceneId: string): Promise<Set<string>> {
    const cached = this._sceneTagIdCache.get(sceneId);
    if (cached && Date.now() - cached.at < StashAPI.SCENE_TAGS_TTL_MS) return Promise.resolve(cached.ids);

    return new Promise((resolve, reject) => {
      if (!this._sceneTagBatch) {
        const batch = new Map<string, Array<{ resolve: (ids: Set<string>) => void; reject: (e: unknown) => void }>>();
        this._sceneTagBatch = batch;
        setTimeout(() => {
          this._sceneTagBatch = undefined;
          void this.flushSceneTagBatch(batch);
        }, 10);
      }
      const waiters = this._sceneTagBatch.get(sceneId) ?? [];
      waiters.push({ resolve, reject });
      this._sceneTagBatch.set(sceneId, waiters);
    });
  }

  private async flushSceneTagBatch(batch: Map<string, Array<{ resolve: (ids: Set<string>) => void; reject: (e: unknown) => void }>>): Promise<void> {
    const startedAt = Date.now();
    try {
      const result = await this.gqlClient.query<{ findScenes?: { scenes?: Array<{ id: string; tags?: Array<{ id: string }> }> } }>({
        query: queries.FIND_SCENES_TAG_IDS,
        variables: { ids: [...batch.keys()], filter: { per_page: -1 } },
      });
      const found = new Map<string, Set<string>>();
      for (const scene of result.data?.findScenes?.scenes ?? []) {
        found.set(scene.id, new Set((scene.tags ?? []).map((t) => t.id)));
      }
      for (const [sceneId, waiters] of batch) {
        // A tag mutation that landed while this read was in flight is newer than the snapshot: keep it.
        const newer = this._sceneTagIdCache.get(sceneId);
        const ids = newer && newer.at >= startedAt ? newer.ids : (found.get(sceneId) ?? new Set<string>());
        if (ids !== newer?.ids) this._sceneTagIdCache.set(sceneId, { at: Date.now(), ids });
        for (const w of waiters) w.resolve(ids);
      }
    } catch (error) {
      for (const waiters of batch.values()) for (const w of waiters) w.reject(error);
    }
  }

  /**
   * Update tags on a scene marker
   */
  private async updateMarkerTags(
    marker: MarkerTagUpdateData,
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
    marker: Pick<MarkerTagUpdateData, 'id' | 'title' | 'seconds' | 'end_seconds' | 'scene'>,
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
  private extractMarkerTagIds(marker: MarkerTagUpdateData): string[] {
    return (marker.tags || []).map(t => t.id);
  }

  async addTagToMarker(
    marker: MarkerTagUpdateData,
    tagId: string,
    signal?: AbortSignal
  ): Promise<void> {
    if (this.isAborted(signal)) return;

    try {
      const currentTags = this.extractMarkerTagIds(marker);

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

  private async updateImageField(
    imageId: string,
    field: 'tag_ids' | 'performer_ids',
    ids: string[],
    signal: AbortSignal | undefined,
    logContext: string
  ): Promise<void> {
    if (this.isAborted(signal)) return;

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

      if (this.isAborted(signal)) return;
    } catch (error) {
      if (isAbortError(error) || this.isAborted(signal)) {
        return;
      }
      this.logError(logContext, error);
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
   * Update performer favorite flag
   */
  async updatePerformerFavorite(performerId: string, favorite: boolean, signal?: AbortSignal): Promise<void> {
    if (this.isAborted(signal)) return;

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

    if (this.isAborted(signal)) return;
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
    if (this.isAborted(signal)) return;
    try {
      const result = await this.gqlClient.mutate<{ bulkSceneUpdate?: Array<{ id: string; tags?: Array<{ id: string }> }> }>({
        mutation: mutations.BULK_SCENE_UPDATE,
        variables: { input: { ids: [sceneId], tag_ids: { ids: [tagId], mode } } },
        signal,
      });
      const updated = result.data?.bulkSceneUpdate?.find((sc) => sc.id === sceneId);
      if (updated?.tags) {
        this._sceneTagIdCache.set(sceneId, { at: Date.now(), ids: new Set(updated.tags.map((t) => t.id)) });
      } else {
        this._sceneTagIdCache.delete(sceneId);
      }
    } catch (error) {
      if (isAbortError(error) || this.isAborted(signal)) return;
      this.logError(methodName, error);
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
    if (this.isAborted(signal)) return;

    try {
      const currentTags = this.extractMarkerTagIds(marker);
      const tagIds = currentTags.filter(id => id !== tagId);
      await this.updateMarkerTags(marker, tagIds, signal);
    } catch (error) {
      if (isAbortError(error) || this.isAborted(signal)) return;
      this.logError('removeTagFromMarker', error);
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
      this.logError('incrementScenePlayCount', error);
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
      this.logError('saveSceneActivity', error);
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
    if (this.isAborted(signal)) return 0;

    try {
      await this.gqlClient.mutate<T>({
        mutation,
        variables: { input: { id: entityId, rating100 } },
        signal,
      });

      if (this.isAborted(signal)) return 0;
      return rating100;
    } catch (error) {
      if (isAbortError(error) || this.isAborted(signal)) {
        return 0;
      }
      this.logError(methodName, error);
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
   * Find all galleries (for gallery selector in settings)
   * @param signal Optional abort signal
   * @returns Array of galleries with id, title, and folder path
   */
  async findGalleries(signal?: AbortSignal): Promise<Gallery[]> {
    if (this.isAborted(signal)) return [];
    try {
      const result = await this.gqlClient.query<FindGalleriesResponse>({
        query: queries.FIND_GALLERIES,
        variables: { filter: { per_page: -1, sort: 'title', direction: 'ASC' } },
        signal,
      });
      if (this.isAborted(signal)) return [];
      return result.data?.findGalleries?.galleries ?? [];
    } catch (error: unknown) {
      if (isAbortError(error) || this.isAborted(signal)) return [];
      this.logError('findGalleries', error);
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
   * Route each positive tag to exactly ONE server-side field (image `tags` > `performer_tags`)
   * so filtering is fully server-side and pagination stays correct. A tag's effective source
   * (own ∪ descendants) resolves parent-only tags; uncached tags fall back to image tags.
   * A tag effectively in both image and performer is matched as an image tag (highest priority).
   * Applies excludes too. Returns true if the selection is unsatisfiable (forces an empty result).
   */
  private applyImageTagFilters(imageFilter: ImageFilterInput, filters: ImageFilterOptions | undefined, depth: number): boolean {
    const performerEnabled = !!filters?.showPerformerTags;
    const imageGroup: string[] = [];
    const performerGroup: string[] = [];
    for (const id of filters?.tagIds ?? []) {
      const src = this._tagSourceCache.get(id);
      if (src && !src.image && !(performerEnabled && src.performer)) {
        // resolved and in no enabled source → unsatisfiable, force empty
        imageFilter.tags = { value: [StashAPI.IMPOSSIBLE_TAG], modifier: 'INCLUDES_ALL' };
        return true;
      }
      if (src && !src.image && performerEnabled && src.performer) performerGroup.push(id);
      else imageGroup.push(id); // image source, or uncached fallback
    }
    // depth cast: the server accepts depth on image tag criteria, but the generated type omits it.
    if (imageGroup.length) imageFilter.tags = { value: imageGroup, modifier: 'INCLUDES_ALL', depth } as ImageFilterInput['tags'];
    if (performerGroup.length) imageFilter.performer_tags = { value: performerGroup, modifier: 'INCLUDES_ALL', depth } as ImageFilterInput['performer_tags'];

    const excludedTagIds = filters?.excludedTagIds ?? [];
    if (excludedTagIds.length > 0) {
      const uniqueExcluded = Array.from(new Set(excludedTagIds));
      type ExFld = { value?: string[]; modifier?: 'INCLUDES' | 'INCLUDES_ALL' | 'EXCLUDES'; depth?: number; excludes?: string[] };
      imageFilter.tags = StashAPI.addExcludes(imageFilter.tags as ExFld | undefined, uniqueExcluded, depth) as ImageFilterInput['tags'];
      if (performerEnabled) {
        imageFilter.performer_tags = StashAPI.addExcludes(imageFilter.performer_tags as ExFld | undefined, uniqueExcluded, depth) as ImageFilterInput['performer_tags'];
      }
    }
    return false;
  }

  private applyImageMiscFilters(imageFilter: ImageFilterInput, filters: ImageFilterOptions | undefined): void {
    const imageOrientations = this.resolveOrientationEnumValues(filters);
    if (imageOrientations.length > 0) {
      imageFilter.orientation = {
        value: imageOrientations.length === 1 ? imageOrientations[0] : imageOrientations,
      };
    }

    if (filters?.imagesInGalleryOnly) {
      const ids = filters.galleryIds ?? [];
      imageFilter.galleries = {
        value: ids,
        modifier: ids.length > 0 ? 'INCLUDES' : 'NOT_NULL',
      };
    }

    if (filters?.studioIds && filters.studioIds.length > 0) {
      imageFilter.studios = { value: filters.studioIds, modifier: 'INCLUDES', depth: filters.studioDepth ?? 0 };
    }

    const createdAt = this.resolveCreatedAtCriterion(filters?.dateRangeFilter);
    if (createdAt) imageFilter.created_at = createdAt;
  }

  private buildImageFilter(
    regexPattern: string,
    filters?: ImageFilterOptions,
    savedFilterCriteria?: GetSavedFilterResponse['findSavedFilter']
  ): ImageFilterInput {
    if (filters?.savedFilterId) {
      // The saved filter is authoritative: the feed's own constraints (file-type regex, orientation,
      // date range...) are ANDed in alongside it instead of overwriting its criteria.
      const saved = this.normalizeSavedObjectFilter<ImageFilterInput>(savedFilterCriteria?.object_filter);
      const extra: ImageFilterInput = { path: { value: regexPattern, modifier: 'MATCHES_REGEX' } };
      this.applyImageMiscFilters(extra, filters);
      if (saved.AND) extra.AND = saved.AND;
      return { ...saved, AND: extra };
    }

    const imageFilter: ImageFilterInput = {
      path: {
        value: regexPattern,
        modifier: 'MATCHES_REGEX',
      },
    };

    if (filters?.performerIds && filters.performerIds.length > 0) {
      imageFilter.performers = {
        value: filters.performerIds,
        modifier: 'INCLUDES_ALL',
      };
    }

    const depth = filters?.tagDepth ?? 0;
    if (this.applyImageTagFilters(imageFilter, filters, depth)) {
      return imageFilter;
    }

    this.applyImageMiscFilters(imageFilter, filters);
    return imageFilter;
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
    const savedFilterCriteria = await this.getSavedFilterCriteria(filters, signal);
    if (this.isAborted(signal)) return { images: [], totalCount: 0, sortSeed: generateRandomSortSeed() };
    const imageFilter = this.buildImageFilter(regexPattern, filters, savedFilterCriteria);

    // Reuse existing sort seed for pagination, or generate new one for first page
    const sortSeed = filters?.sortSeed || generateRandomSortSeed();
    
    const findFilter: FindFilterInput = {
      ...this.mergeSavedFilterAndQuery({}, undefined, savedFilterCriteria),
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

      const images = result.data?.findImages?.images || [];
      const totalCount = Math.min(result.data?.findImages?.count ?? 0, this._maxContentLimit);

      if (filters?.showPerformerTags) {
        const imagePerformers = images.flatMap(img => (img.performers ?? []) as Performer[]);
        await this.enrichPerformerTags(imagePerformers);
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

  /**
   * Get plugin-specific settings from Stash server
   */
  async getPluginSettings(pluginId: string, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
    if (this.isAborted(signal)) return null;

    try {
      const result = await this.gqlClient.query<PluginConfigurationResponse>({
        query: queries.GET_PLUGIN_CONFIGURATION,
        signal,
      });

      if (this.isAborted(signal)) return null;

      const plugins = result.data?.configuration?.plugins;
      if (!plugins || typeof plugins !== 'object') return null;

      const pluginConfig = plugins[pluginId];
      if (!pluginConfig || typeof pluginConfig !== 'object') return null;

      return pluginConfig;
    } catch (error) {
      return this.handleError('getPluginSettings', error, signal, null);
    }
  }

  /**
   * Save plugin-specific settings to Stash server
   */
  async savePluginSettings(pluginId: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<boolean> {
    if (this.isAborted(signal)) return false;

    try {
      await this.gqlClient.mutate<ConfigurePluginResponse>({
        mutation: mutations.CONFIGURE_PLUGIN,
        variables: { plugin_id: pluginId, input },
        signal,
      });
      return true;
    } catch (error) {
      this.handleError('savePluginSettings', error, signal, false);
      return false;
    }
  }

  /** stash-box scene id -> local scene id (null = not in library). Misses are cached too: they're the common case. */
  private readonly _localSceneIdCache = new Map<string, { at: number; id: string | null }>();
  private static readonly LOCAL_ID_TTL_MS = 5 * 60_000;

  /**
   * Resolve many stash-box scenes to local scene ids in at most two requests (stash_id lookups,
   * then URL lookups for the misses) by aliasing one findScenes per scene into a single query,
   * instead of one or two requests per scene.
   */
  // fallow-ignore-next-line unused-class-member
  async findLocalSceneIdsByStashDbIds(
    items: Array<{ stashId: string; sceneUrl?: string }>,
    signal?: AbortSignal
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (this.isAborted(signal)) return out;

    const now = Date.now();
    const todo = new Map<string, string | undefined>();
    for (const { stashId, sceneUrl } of items) {
      const cached = this._localSceneIdCache.get(stashId);
      if (cached && now - cached.at < StashAPI.LOCAL_ID_TTL_MS) {
        if (cached.id) out.set(stashId, cached.id);
      } else {
        todo.set(stashId, sceneUrl);
      }
    }
    if (todo.size === 0) return out;

    try {
      // Stash matches stash_id regardless of endpoint; URL lookup covers scenes added without a stash_id link.
      const ids = [...todo.keys()];
      const byStashId = await this.lookupSceneIds(
        ids.map((stashId) => ({ stash_id_endpoint: { stash_id: stashId, modifier: 'EQUALS' } })),
        signal
      );
      if (this.isAborted(signal)) return out;

      const misses: string[] = [];
      ids.forEach((stashId, i) => {
        const localId = byStashId[i];
        if (localId) this.recordLocalSceneId(stashId, localId, out);
        else if (todo.get(stashId)) misses.push(stashId);
        else this._localSceneIdCache.set(stashId, { at: Date.now(), id: null });
      });

      if (misses.length > 0) {
        const byUrl = await this.lookupSceneIds(
          misses.map((stashId) => ({ url: { modifier: 'EQUALS', value: todo.get(stashId) } })),
          signal
        );
        if (this.isAborted(signal)) return out;
        misses.forEach((stashId, i) => {
          const localId = byUrl[i];
          if (localId) this.recordLocalSceneId(stashId, localId, out);
          else this._localSceneIdCache.set(stashId, { at: Date.now(), id: null });
        });
      }
    } catch (error: unknown) {
      this.handleError('findLocalSceneIdsByStashDbIds', error, signal, null);
    }
    return out;
  }

  private recordLocalSceneId(stashId: string, localId: string, out: Map<string, string>): void {
    out.set(stashId, localId);
    this._localSceneIdCache.set(stashId, { at: Date.now(), id: localId });
  }

  /** One request, one aliased findScenes per filter; returns the first matching scene id (or null) per filter, in order. */
  private async lookupSceneIds(filters: Array<Record<string, unknown>>, signal?: AbortSignal): Promise<Array<string | null>> {
    const variables: Record<string, unknown> = {};
    const defs: string[] = [];
    const fields: string[] = [];
    filters.forEach((filter, i) => {
      variables[`f${i}`] = filter;
      defs.push(`$f${i}: SceneFilterType`);
      fields.push(`s${i}: findScenes(scene_filter: $f${i}, filter: { per_page: 1 }) { scenes { id } }`);
    });
    const result = await this.gqlClient.query<Record<string, { scenes: Array<{ id: string }> } | undefined>>({
      query: `query FindLocalScenes(${defs.join(', ')}) { ${fields.join(' ')} }`,
      variables,
      signal,
    });
    return filters.map((_, i) => result.data?.[`s${i}`]?.scenes[0]?.id ?? null);
  }

  // fallow-ignore-next-line unused-class-member
  async getStashBoxes(signal?: AbortSignal): Promise<StashBox[]> {
    if (this.isAborted(signal)) return [];

    try {
      const result = await this.gqlClient.query<GetStashBoxConfigResponse>({
        query: queries.GET_STASH_BOX_CONFIG,
        signal,
      });

      if (this.isAborted(signal)) return [];

      return result.data?.configuration?.general?.stashBoxes ?? [];
    } catch (error: unknown) {
      return this.handleError('getStashBoxes', error, signal, []) ?? [];
    }
  }

}
