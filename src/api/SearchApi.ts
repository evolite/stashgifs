import * as queries from '../graphql/queries.js';
import type {
  FindFilterInput,
  TagFilterInput,
  FindTagsResponse,
  FindTagsExtendedResponse,
  FindStudiosResponse,
  FindPerformersResponse,
  FindSceneMarkersResponse,
} from '../graphql/types.js';
import { isAbortError } from '../graphql/errors.js';
import type { ApiIO } from './ApiIO.js';
import { TtlCache } from './TtlCache.js';
import { generateRandomSortSeed } from './sortSeed.js';

export class SearchApi {
  private static readonly SEARCH_FETCH_MULTIPLIER = 3;
  private static readonly MIN_SEARCH_LIMIT = 20;
  private static readonly MIN_MARKER_COUNT_FOR_TAG_FILTER = 10;

  private readonly searchCache = new TtlCache<unknown[]>(5 * 60 * 1000, 300);

  constructor(private readonly io: ApiIO) {}

  private buildCacheKey(prefix: string, term: string, limit: number): string {
    const escapedTerm = term.replaceAll(':', '::').replaceAll('|', '||');
    return `${prefix}|${escapedTerm}|${limit}`;
  }

  private async searchWithCache<T>(
    cacheKey: string,
    isEmptyTerm: boolean,
    queryFn: () => Promise<T[]>,
    signal?: AbortSignal
  ): Promise<T[]> {
    if (this.io.isAborted(signal)) return [];

    if (!isEmptyTerm) {
      const cached = this.searchCache.peek(cacheKey);
      if (cached) return (await cached) as T[];
    }

    try {
      const results = await queryFn();
      
      if (this.io.isAborted(signal)) return [];
      
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
    const fetchLimit = hasSearchTerm ? limit * SearchApi.SEARCH_FETCH_MULTIPLIER : Math.max(limit, SearchApi.MIN_SEARCH_LIMIT);
    const filter: FindFilterInput = {
      per_page: fetchLimit,
      page: 1,
      ...(hasSearchTerm ? { q: term.trim() } : { sort: generateRandomSortSeed() })
    };
    return { hasSearchTerm, filter };
  }

  async searchMarkerTags(term: string, limit: number = 10, signal?: AbortSignal): Promise<Array<{ id: string; name: string }>> {
    const isEmptyTerm = !term || term.trim() === '';
    const cacheKey = this.buildCacheKey('tags', term, limit);
    const { hasSearchTerm, filter } = this.buildSearchFilter(term, limit);
    
    const tag_filter: TagFilterInput = hasSearchTerm
      ? {}
      : {
          marker_count: {
            value: SearchApi.MIN_MARKER_COUNT_FOR_TAG_FILTER,
            modifier: 'GREATER_THAN'
          }
        };
    
    return this.searchWithCache(
      cacheKey,
      isEmptyTerm,
      async () => {
        const result = await this.io.gql.query<FindTagsResponse>({
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

  async searchMarkersByTitle(term: string, limit: number = 20, signal?: AbortSignal): Promise<Array<{ id: string; title: string }>> {
    const trimmed = term?.trim() ?? '';
    if (trimmed === '') return [];

    const cacheKey = this.buildCacheKey('markers', trimmed, limit);

    return this.searchWithCache(
      cacheKey,
      false,
      async () => {
        const result = await this.io.gql.query<FindSceneMarkersResponse>({
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

  async searchPerformers(term: string, limit: number = 10, signal?: AbortSignal): Promise<Array<{ id: string; name: string; aliases?: string[]; image_path?: string }>> {
    const isEmptyTerm = !term || term.trim() === '';
    const cacheKey = this.buildCacheKey('performers-v2', term, limit);
    const { filter } = this.buildSearchFilter(term, limit);
    
    return this.searchWithCache(
      cacheKey,
      isEmptyTerm,
      async () => {
        const result = await this.io.gql.query<FindPerformersResponse>({
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

  async searchStudios(term: string, limit: number = 10, signal?: AbortSignal): Promise<Array<{ id: string; name: string; image_path?: string }>> {
    const isEmptyTerm = !term || term.trim() === '';
    const cacheKey = this.buildCacheKey('studios', term, limit);
    const { filter } = this.buildSearchFilter(term, limit);

    return this.searchWithCache(
      cacheKey,
      isEmptyTerm,
      async () => {
        const result = await this.io.gql.query<FindStudiosResponse>({
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
      const result = await this.io.gql.query<FindTagsExtendedResponse>({
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
}
