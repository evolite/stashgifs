/**
 * Builds the GraphQL filter inputs for the feed's content types (markers, scenes, images):
 * saved-filter merging, tag routing to the one server field that can match, excludes,
 * orientation, studios, date range.
 *
 * Pure with respect to the network. The only state is the shared tag-source map, which StashAPI
 * fills (getTagSources) and these builders read.
 */

import type { FilterOptions, Scene, DateRangeFilter } from '../types.js';
import type {
  FindFilterInput,
  SceneMarkerFilterInput,
  SceneFilterInput,
  ImageFilterInput,
  GetSavedFilterResponse,
} from '../graphql/types.js';
import { normalizeSavedObjectFilter } from './savedFilterCriteria.js';
import { generateRandomSortSeed } from './sortSeed.js';

export type ImageOrientation = 'landscape' | 'portrait' | 'square';

export type ImageFilterOptions = {
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

export type TagSource = { marker: boolean; scene: boolean; performer: boolean; image: boolean };

export class FeedFilters {
  private static readonly DATE_RANGE_DAYS: Record<DateRangeFilter, number> = {
    week: 7,
    month: 30,
    year: 365,
  };

  /** A tag id that matches nothing: forces an empty result for unsatisfiable selections. */
  private static readonly IMPOSSIBLE_TAG = '-1';

  /** @param tagSources tag id -> which content types it (and its descendants) effectively belongs to */
  constructor(private readonly tagSources: Map<string, TagSource>) {}


  /**
   * Calculate initial page number from offset
   */
  calculateInitialPage(limit: number, filters?: FilterOptions): number {
    return filters?.offset ? Math.floor(filters.offset / limit) + 1 : 1;
  }

  /**
   * Merge saved filter criteria and query into a base FindFilterInput
   */
  mergeSavedFilterAndQuery(
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
  buildFindFilter(
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
  buildSceneMarkerFilter(
    filters: FilterOptions | undefined,
    savedFilterCriteria: GetSavedFilterResponse['findSavedFilter']
  ): SceneMarkerFilterInput {
    const sceneMarkerFilterRaw: SceneMarkerFilterInput | Record<string, unknown> = 
      savedFilterCriteria?.object_filter ? { ...savedFilterCriteria.object_filter } : {};
    const sceneMarkerFilter = normalizeSavedObjectFilter(sceneMarkerFilterRaw);
    
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
      if (enabled.marker) f.tags = FeedFilters.addExcludes(f.tags, uniqueExcluded, depth);
      if (enabled.scene) f.scene_tags = FeedFilters.addExcludes(f.scene_tags, uniqueExcluded, depth);
      if (enabled.performer) {
        f.scene_filter ??= {};
        f.scene_filter.performer_tags = FeedFilters.addExcludes(f.scene_filter.performer_tags, uniqueExcluded, depth);
      }
    } else {
      const f = targetFilter as SceneFilterInput;
      if (enabled.scene) f.tags = FeedFilters.addExcludes(f.tags, uniqueExcluded, depth);
      if (enabled.performer) f.performer_tags = FeedFilters.addExcludes(f.performer_tags, uniqueExcluded, depth);
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

  private resolveCreatedAtCriterion(
    dateRangeFilter?: DateRangeFilter
  ): { value: string; modifier: 'GREATER_THAN' } | undefined {
    if (!dateRangeFilter) return undefined;
    const days = FeedFilters.DATE_RANGE_DAYS[dateRangeFilter];
    return { value: new Date(Date.now() - days * 86_400_000).toISOString(), modifier: 'GREATER_THAN' };
  }

  private resolveOrientationEnumValues(filters?: { orientationFilter?: readonly string[] }): string[] {
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

  /** Groups tagIds by effective source; returns undefined if a tag resolves to no enabled source (unsatisfiable). */
  private groupTagsBySource(
    tagIds: string[],
    enabledList: Array<'marker' | 'scene' | 'performer'>
  ): { marker: string[]; scene: string[]; performer: string[] } | undefined {
    const primary = enabledList[0];
    const groups = { marker: [] as string[], scene: [] as string[], performer: [] as string[] };
    for (const id of tagIds) {
      const src = this.tagSources.get(id);
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
      if (shape === 'marker') (targetFilter as SceneMarkerFilterInput).tags = incAll([FeedFilters.IMPOSSIBLE_TAG]);
      else (targetFilter as SceneFilterInput).tags = incAll([FeedFilters.IMPOSSIBLE_TAG]);
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
   * Build scene filter for shuffle mode
   */
  buildShuffleSceneFilter(filters?: FilterOptions): SceneFilterInput | null {
    const sceneFilter: SceneFilterInput = {};
    
    if (filters?.includeScenesWithoutMarkers) {
      sceneFilter.has_markers = 'false';
    }
    this.applyTagAndPerformerFilters(filters, sceneFilter, { isMarkerFilter: false });
    this.applyOrientationToSceneFilter(sceneFilter, filters);


    return Object.keys(sceneFilter).length > 0 ? sceneFilter : null;
  }

  /**
   * Build scene filter for short-form content
   */
  buildShortFormSceneFilter(filters?: FilterOptions, maxDuration?: number): SceneFilterInput | null {
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
  filterShortFormScenes(scenes: Scene[], maxDuration: number): Scene[] {
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
   * Build scene filter for scene-preview content
   */
  buildScenePreviewFilter(filters?: FilterOptions): SceneFilterInput | null {
    const sceneFilter: SceneFilterInput = {};
    this.applyTagAndPerformerFilters(filters, sceneFilter, { isMarkerFilter: false });
    this.applyOrientationToSceneFilter(sceneFilter, filters);
    const createdAt = this.resolveCreatedAtCriterion(filters?.dateRangeFilter);
    if (createdAt) sceneFilter.created_at = createdAt;
    return Object.keys(sceneFilter).length > 0 ? sceneFilter : null;
  }

  /**
   * Build regex pattern from file extensions
   * Converts ['.gif', '.webm'] to "(?i)\.(gif|webm)$" (case-insensitive)
   * @throws Error if fileExtensions is empty or all extensions are invalid
   */
  buildPathRegex(fileExtensions: string[]): string {
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
      const src = this.tagSources.get(id);
      if (src && !src.image && !(performerEnabled && src.performer)) {
        // resolved and in no enabled source → unsatisfiable, force empty
        imageFilter.tags = { value: [FeedFilters.IMPOSSIBLE_TAG], modifier: 'INCLUDES_ALL' };
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
      imageFilter.tags = FeedFilters.addExcludes(imageFilter.tags as ExFld | undefined, uniqueExcluded, depth) as ImageFilterInput['tags'];
      if (performerEnabled) {
        imageFilter.performer_tags = FeedFilters.addExcludes(imageFilter.performer_tags as ExFld | undefined, uniqueExcluded, depth) as ImageFilterInput['performer_tags'];
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

  buildImageFilter(
    regexPattern: string,
    filters?: ImageFilterOptions,
    savedFilterCriteria?: GetSavedFilterResponse['findSavedFilter']
  ): ImageFilterInput {
    if (filters?.savedFilterId) {
      // The saved filter is authoritative: the feed's own constraints (file-type regex, orientation,
      // date range...) are ANDed in alongside it instead of overwriting its criteria.
      const saved = normalizeSavedObjectFilter<ImageFilterInput>(savedFilterCriteria?.object_filter);
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
}
