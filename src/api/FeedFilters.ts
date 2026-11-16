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
  savedFilterId?: string;
  sortSeed?: string;
};

export type TagSource = { marker: boolean; scene: boolean; performer: boolean; image: boolean };

export interface ShortFormScope {
  tagIds?: string[];
  folder?: string;
}

function shortFormFolderPattern(folder?: string): { source: string; ignoreCase: boolean } | undefined {
  const path = folder?.trim();
  if (!path) return undefined;

  const windows = /^(?:[a-z]:[\\/]|[\\/]{2})/i.test(path);
  const separator = windows ? String.raw`[/\\]` : '/';
  const segments = windows ? path.split(/[\\/]/) : path.split('/');
  while (segments.at(-1) === '') segments.pop();
  const prefix = segments.map(segment => segment.replace(/[.*+?^()|[\]\\{}$]/g, String.raw`\$&`)).join(separator);
  return { source: '^' + prefix + separator, ignoreCase: windows };
}

export class FeedFilters {
  private static readonly DATE_RANGE_DAYS: Record<DateRangeFilter, number> = {
    week: 7,
    month: 30,
    year: 365,
  };

  private static readonly IMPOSSIBLE_TAG = '-1';

  constructor(private readonly tagSources: Map<string, TagSource>) {}

  calculateInitialPage(limit: number, filters?: FilterOptions): number {
    return filters?.offset ? Math.floor(filters.offset / limit) + 1 : 1;
  }

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

  private parseTagIds(tags: (string | number)[]): number[] {
    return tags
      .map((v) => Number.parseInt(String(v), 10))
      .filter((n) => !Number.isNaN(n));
  }

  extractTagAndPerformerFilters(filters?: FilterOptions): {
    tagIds: string[];
    performerIds: number[];
    excludedTagIds: string[];
    studioIds: string[];
  } {
    const tagIds: string[] = [];
    const performerIds: number[] = [];
    const excludedTagIds: string[] = [];

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
    
    merged.page = page;
    merged.per_page = limit;
    
    return merged;
  }

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

  private groupTagsBySource(
    tagIds: string[],
    enabledList: Array<'marker' | 'scene' | 'performer'>
  ): { marker: string[]; scene: string[]; performer: string[] } | undefined {
    const primary = enabledList[0];
    const groups = { marker: [] as string[], scene: [] as string[], performer: [] as string[] };
    for (const id of tagIds) {
      const src = this.tagSources.get(id);
      const target = src ? enabledList.find((s) => src[s]) : primary;
      if (src && !target) return undefined;
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

  buildShuffleSceneFilter(filters?: FilterOptions): SceneFilterInput | null {
    const sceneFilter: SceneFilterInput = {};
    
    if (filters?.includeScenesWithoutMarkers) {
      sceneFilter.has_markers = 'false';
    }
    if (filters?.randomMinSceneDuration !== undefined) {
      sceneFilter.duration = { value: Math.ceil(filters.randomMinSceneDuration) - 1, modifier: 'GREATER_THAN' };
    }
    this.applyTagAndPerformerFilters(filters, sceneFilter, { isMarkerFilter: false });
    this.applyOrientationToSceneFilter(sceneFilter, filters);

    return Object.keys(sceneFilter).length > 0 ? sceneFilter : null;
  }

  buildShortFormSceneFilter(filters?: FilterOptions, maxDuration?: number, scope?: ShortFormScope): SceneFilterInput {
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

    const tagIds = scope?.tagIds ?? [];
    if (tagIds.length > 0 && sceneFilter.tags?.value.length) return sceneFilter;

    const folder = shortFormFolderPattern(scope?.folder);
    const path: SceneFilterInput['path'] = folder && {
      value: (folder.ignoreCase ? '(?i)' : '') + folder.source,
      modifier: 'MATCHES_REGEX',
    };
    if (tagIds.length > 0) {
      sceneFilter.AND = { tags: { value: tagIds, modifier: 'INCLUDES', depth: 0 } };
      if (path) sceneFilter.AND.OR = { path };
    } else if (path) {
      sceneFilter.path = path;
    }
    return sceneFilter;
  }

  shortFormSceneMatcher(maxDuration: number, scope?: ShortFormScope): (scene: Scene) => boolean {
    const folder = shortFormFolderPattern(scope?.folder);
    const path = folder && new RegExp(folder.source, folder.ignoreCase ? 'i' : '');
    const tagIds = new Set(scope?.tagIds);
    return (scene) => {
      const duration = scene.files?.[0]?.duration ?? 0;
      if (!Number.isFinite(duration) || duration <= 0 || duration >= maxDuration) return false;
      return (tagIds.size === 0 && !path)
        || !!scene.tags?.some(tag => tagIds.has(tag.id))
        || !!(path && scene.files?.some(file => path.test(file.path)));
    };
  }

  buildScenePreviewFilter(filters?: FilterOptions): SceneFilterInput | null {
    const sceneFilter: SceneFilterInput = {};
    this.applyTagAndPerformerFilters(filters, sceneFilter, { isMarkerFilter: false });
    this.applyOrientationToSceneFilter(sceneFilter, filters);
    const createdAt = this.resolveCreatedAtCriterion(filters?.dateRangeFilter);
    if (createdAt) sceneFilter.created_at = createdAt;
    return Object.keys(sceneFilter).length > 0 ? sceneFilter : null;
  }

  buildPathRegex(fileExtensions: string[]): string {
    if (fileExtensions.length === 0) {
      throw new Error('buildPathRegex: fileExtensions array cannot be empty');
    }
    
    const extensions = fileExtensions
      .map(ext => ext.trim().toLowerCase().replace(/^\./, ''))
      .filter(ext => ext.length > 0 && /^[a-z0-9]+$/i.test(ext));
    
    if (extensions.length === 0) {
      throw new Error('buildPathRegex: all file extensions are invalid');
    }
    
    return String.raw`(?i)\.(${extensions.join('|')})$`;
  }

  private applyImageTagFilters(imageFilter: ImageFilterInput, filters: ImageFilterOptions | undefined, depth: number): boolean {
    const performerEnabled = !!filters?.showPerformerTags;
    const imageGroup: string[] = [];
    const performerGroup: string[] = [];
    for (const id of filters?.tagIds ?? []) {
      const src = this.tagSources.get(id);
      if (src && !src.image && !(performerEnabled && src.performer)) {
        imageFilter.tags = { value: [FeedFilters.IMPOSSIBLE_TAG], modifier: 'INCLUDES_ALL' };
        return true;
      }
      if (src && !src.image && performerEnabled && src.performer) performerGroup.push(id);
      else imageGroup.push(id);
    }
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
