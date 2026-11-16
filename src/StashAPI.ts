import { Scene, SceneMarker, FilterOptions, VideoSource, SavedFilterMode } from './types.js';
import { getStashBaseUrl } from './utils/baseUrl.js';
import * as queries from './graphql/queries.js';
import {
  FindFilterInput,
  SceneMarkerFilterInput,
  SceneFilterInput,
  FindSceneMarkersResponse,
  FindScenesResponse,
  PerformerExtended,
  StudioExtended,
  FindImagesResponse,
  Gallery,
  GetSavedFilterResponse,
  TypedGraphQLClient,
  GQLImage,
} from './graphql/types.js';
import { isAbortError } from './graphql/errors.js';
import { GraphQLClient } from './graphql/client.js';
import { MediaUrls } from './api/MediaUrls.js';
import { ApiIO } from './api/ApiIO.js';
import { SearchApi } from './api/SearchApi.js';
import { ConfigApi } from './api/ConfigApi.js';
import { EntityApi } from './api/EntityApi.js';
import { TagsApi, type MarkerTagUpdateData } from './api/TagsApi.js';
import { FeedFilters, type ImageFilterOptions, type ShortFormScope } from './api/FeedFilters.js';
import { generateRandomSortSeed } from './api/sortSeed.js';

interface StashPluginApi {
  GQL: {
    useFindScenesQuery?: (variables: unknown) => { data?: unknown; loading: boolean };
    client?: TypedGraphQLClient;
  };
  baseURL?: string;
  apiKey?: string;
}

export { generateRandomSortSeed };

interface ShortFormPage {
  markers: SceneMarker[];
  totalCount: number;
  nextOffset: number | null;
  sortSeed: string;
}

export class StashAPI {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly pluginApi?: StashPluginApi;
  private readonly gqlClient: GraphQLClient;
  private readonly io = new ApiIO(() => this.gqlClient);
  private readonly tags = new TagsApi(this.io);
  private readonly entities = new EntityApi(this.io);
  private readonly filters = new FeedFilters(this.tags.tagSources);
  private readonly config = new ConfigApi(this.io);
  private readonly search = new SearchApi(this.io);

  private static readonly SHORT_FORM_SCENES_PER_PAGE = 24;
  private static readonly SHORT_FORM_MAX_PAGES_PER_LOAD = 5;
  private static readonly DEFAULT_CONTENT_LIMIT = 5000;
  private _maxContentLimit = StashAPI.DEFAULT_CONTENT_LIMIT;

  set maxContentLimit(value: number) {
    this._maxContentLimit = value > 0 ? value : StashAPI.DEFAULT_CONTENT_LIMIT;
  }

  private _maxResolution = 0;

  set maxResolution(px: number) {
    this._maxResolution = Number.isFinite(px) && px > 0 ? px : 0;
  }

  constructor(baseUrl?: string, apiKey?: string) {
    const windowWithStash = globalThis as typeof globalThis & {
      PluginApi?: StashPluginApi;
      stash?: StashPluginApi;
    };
    this.pluginApi = windowWithStash.PluginApi || windowWithStash.stash;
    
    if (baseUrl) {
      this.baseUrl = baseUrl;
    } else if (this.pluginApi?.baseURL) {
      this.baseUrl = this.pluginApi.baseURL;
    } else {
      this.baseUrl = getStashBaseUrl();
    }

    this.apiKey = apiKey || this.pluginApi?.apiKey;
    this.media = new MediaUrls(this.baseUrl, () => this._maxResolution);
    
    this.gqlClient = new GraphQLClient({
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      pluginApi: this.pluginApi,
    });
  }

  destroy(): void {
    this.gqlClient.destroy();
  }

  async fetchSceneMarkers(filters?: FilterOptions, signal?: AbortSignal): Promise<{ markers: SceneMarker[]; totalCount: number; sortSeed?: string }> {
    if (this.io.isAborted(signal)) return { markers: [], totalCount: 0 };

    if (filters?.shuffleMode) {
      const { markers, sortSeed, totalCount } = await this.fetchScenesForShuffle(filters, signal);
      return { markers, totalCount, sortSeed };
    }
    
    const savedFilterCriteria = await this.getSavedFilterCriteria(filters, signal);
    if (this.io.isAborted(signal)) return { markers: [], totalCount: 0 };

    try {
      const limit = filters?.limit || 20;
      const page = this.filters.calculateInitialPage(limit, filters);

      const filter = this.filters.buildFindFilter(filters, savedFilterCriteria, page, limit);
      const sceneMarkerFilter = this.filters.buildSceneMarkerFilter(filters, savedFilterCriteria);

      const { markers, totalCount } = await this.executeMarkerQueryWithCount(filter, sceneMarkerFilter, signal);
      if (this.io.isAborted(signal)) return { markers: [], totalCount: 0 };

      return { markers, totalCount, sortSeed: filter.sort };
    } catch (error: unknown) {
      return this.io.handleError('fetchSceneMarkers', error, signal, { markers: [], totalCount: 0 });
    }
  }

  private async getSavedFilterCriteria(filters?: { savedFilterId?: string }, signal?: AbortSignal): Promise<GetSavedFilterResponse['findSavedFilter']> {
    if (!filters?.savedFilterId) return null;
    return await this.getSavedFilter(filters.savedFilterId, signal);
  }

  extractTagAndPerformerFilters(filters?: FilterOptions): ReturnType<FeedFilters['extractTagAndPerformerFilters']> {
    return this.filters.extractTagAndPerformerFilters(filters);
  }

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

    const page = typeof filter.page === 'number' ? filter.page : 1;
    if (totalCount > 0 && markers.length === 0 && page <= 1) {
      return this.retryMarkerQueryWithCount(filter, sceneMarkerFilter, signal);
    }

    return { markers, totalCount };
  }

  private async retryMarkerQueryWithCount(
    filter: FindFilterInput,
    sceneMarkerFilter: SceneMarkerFilterInput,
    signal?: AbortSignal
  ): Promise<{ markers: SceneMarker[]; totalCount: number }> {
    this.io.logError('retryMarkerQueryWithCount', new Error('Count > 0 but no markers returned - retrying with page 1'));
    
    if (this.io.isAborted(signal)) return { markers: [], totalCount: 0 };
    
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

  private async fetchScenesForShuffle(filters?: FilterOptions, signal?: AbortSignal): Promise<{ markers: SceneMarker[]; sortSeed: string; totalCount: number }> {
    try {
      const limit = filters?.limit || 20;
      const page = filters?.offset ? Math.floor(filters.offset / limit) + 1 : 1;

      const sortSeed = filters?.sortSeed || generateRandomSortSeed();
      const filter: FindFilterInput = { per_page: limit, page, sort: sortSeed };
      const sceneFilter = this.filters.buildShuffleSceneFilter(filters);
      const { scenes, count: totalCount } = await this.fetchScenesQuery(filter, sceneFilter, signal);

      if (this.io.isAborted(signal)) return { markers: [], sortSeed, totalCount: 0 };

      const minDuration = filters?.randomMinSceneDuration;
      const eligibleScenes = minDuration === undefined ? scenes : scenes.filter((scene) => {
        const duration = scene.files?.[0]?.duration ?? 0;
        return Number.isFinite(duration) && duration >= minDuration;
      });
      return { markers: this.createSyntheticMarkers(eligibleScenes, 'synthetic', limit), sortSeed, totalCount };
    } catch (error: unknown) {
      const emptyResult = { markers: [] as SceneMarker[], sortSeed: generateRandomSortSeed(), totalCount: 0 };
      return this.io.handleError('fetchScenesForShuffle', error, signal, emptyResult);
    }
  }

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
          tags: [],
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

  async fetchShortFormVideos(
    filters?: FilterOptions,
    maxDuration: number = 120,
    limit: number = 20,
    offset: number = 0,
    signal?: AbortSignal,
    scope?: ShortFormScope
  ): Promise<ShortFormPage> {
    const sortSeed = filters?.sortSeed || generateRandomSortSeed();
    const retry: ShortFormPage = { markers: [], totalCount: 0, nextOffset: offset, sortSeed };
    if (this.io.isAborted(signal)) return retry;

    try {
      const sceneFilter = this.filters.buildShortFormSceneFilter(filters, maxDuration, scope);
      const matches = this.filters.shortFormSceneMatcher(maxDuration, scope);
      const selected: Scene[] = [];
      let nextOffset: number | null = offset;
      let totalCount = 0;

      for (let pages = 0; pages < StashAPI.SHORT_FORM_MAX_PAGES_PER_LOAD && selected.length < limit && nextOffset !== null; pages++) {
        const page = await this.fetchSceneListPage(sceneFilter, nextOffset, sortSeed, signal, false);
        if (this.io.isAborted(signal)) return retry;
        totalCount = page?.totalCount ?? 0;
        nextOffset = page && nextOffset < totalCount
          ? StashAPI.scanShortFormPage(page, nextOffset, totalCount, limit, matches, selected)
          : null;
      }

      return {
        markers: this.createShortFormMarkers(selected),
        totalCount,
        nextOffset: totalCount > 0 ? nextOffset : null,
        sortSeed,
      };
    } catch (error: unknown) {
      return this.io.handleError('fetchShortFormVideos', error, signal, retry);
    }
  }

  private static scanShortFormPage(
    page: { scenes: Scene[]; offsetInPage: number },
    cursor: number,
    totalCount: number,
    limit: number,
    matches: (scene: Scene) => boolean,
    selected: Scene[],
  ): number | null {
    for (const scene of page.scenes.slice(page.offsetInPage)) {
      cursor++;
      if (matches(scene)) selected.push(scene);
      if (selected.length === limit || cursor >= totalCount) break;
    }
    const more = cursor < totalCount
      && (selected.length === limit || page.scenes.length === StashAPI.SHORT_FORM_SCENES_PER_PAGE);
    return more ? cursor : null;
  }

  private async fetchSceneListPage(
    sceneFilter: SceneFilterInput | null,
    offset: number,
    sortSeed: string,
    signal?: AbortSignal,
    clampToLastPage = true
  ): Promise<{ scenes: Scene[]; totalCount: number; offsetInPage: number } | null> {
    const perPage = StashAPI.SHORT_FORM_SCENES_PER_PAGE;
    const wantedPage = Math.floor(offset / perPage) + 1;
    const query = (page: number) => this.fetchScenesQuery({ per_page: perPage, page, sort: sortSeed }, sceneFilter, signal);

    let { scenes, count } = await query(wantedPage);
    if (this.io.isAborted(signal)) return null;

    const totalCount = Math.min(count, this._maxContentLimit);
    if (totalCount === 0) return null;

    const maxPage = Math.max(1, Math.ceil(totalCount / perPage));
    if (clampToLastPage && wantedPage > maxPage) {
      ({ scenes } = await query(maxPage));
      if (this.io.isAborted(signal)) return null;
    }
    return { scenes, totalCount, offsetInPage: offset % perPage };
  }

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

  private createScenePreviewMarkers(scenes: Scene[]): SceneMarker[] {
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

      const previewableScenes = scenes.filter((scene) => !!scene.paths?.preview);

      const limitedScenes = previewableScenes.slice(offsetInPage, offsetInPage + limit);

      const markers = this.createScenePreviewMarkers(limitedScenes);

      const unfilteredOffsetConsumed = offsetInPage + limitedScenes.length;

      return { markers, totalCount, unfilteredOffsetConsumed, sortSeed };
    } catch (error: unknown) {
      return this.io.handleError('fetchScenePreviews', error, signal, { markers: [], totalCount: 0, unfilteredOffsetConsumed: 0, sortSeed: generateRandomSortSeed() });
    }
  }

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

  async findImages(
    fileExtensions: string[],
    filters?: ImageFilterOptions,
    limit: number = 40,
    offset: number = 0,
    signal?: AbortSignal
  ): Promise<{ images: GQLImage[]; totalCount: number; sortSeed: string }> {
    if (this.io.isAborted(signal)) return { images: [], totalCount: 0, sortSeed: generateRandomSortSeed() };

    if (!Array.isArray(fileExtensions)) {
      throw new TypeError('findImages: fileExtensions must be an array');
    }
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1) {
      throw new TypeError('findImages: limit must be a positive number');
    }
    if (typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0) {
      throw new TypeError('findImages: offset must be a non-negative number');
    }

    const regexPattern = this.filters.buildPathRegex(fileExtensions);
    const savedFilterCriteria = await this.getSavedFilterCriteria(filters, signal);
    if (this.io.isAborted(signal)) return { images: [], totalCount: 0, sortSeed: generateRandomSortSeed() };
    const imageFilter = this.filters.buildImageFilter(regexPattern, filters, savedFilterCriteria);

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

  searchMarkerTags(term: string, limit: number = 10, signal?: AbortSignal): Promise<Array<{ id: string; name: string }>> {
    return this.search.searchMarkerTags(term, limit, signal);
  }

  searchMarkersByTitle(term: string, limit: number = 20, signal?: AbortSignal): Promise<Array<{ id: string; title: string }>> {
    return this.search.searchMarkersByTitle(term, limit, signal);
  }

  searchPerformers(term: string, limit: number = 10, signal?: AbortSignal): Promise<Array<{ id: string; name: string; aliases?: string[]; image_path?: string }>> {
    return this.search.searchPerformers(term, limit, signal);
  }

  searchStudios(term: string, limit: number = 10, signal?: AbortSignal): Promise<Array<{ id: string; name: string; image_path?: string }>> {
    return this.search.searchStudios(term, limit, signal);
  }

  findTagsForSelect(searchTerm: string = '', limit: number = 200, signal?: AbortSignal): Promise<Array<{ id: string; name: string; sort_name?: string; favorite?: boolean; description?: string; aliases?: string[]; image_path?: string; parents?: Array<{ id: string; name: string }> }>> {
    return this.search.findTagsForSelect(searchTerm, limit, signal);
  }

  getUIConfiguration(signal?: AbortSignal): Promise<{ type?: string; starPrecision?: string } | null> {
    return this.config.getUIConfiguration(signal);
  }

  getPluginSettings(pluginId: string, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
    return this.config.getPluginSettings(pluginId, signal);
  }

  savePluginSettings(pluginId: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<boolean> {
    return this.config.savePluginSettings(pluginId, input, signal);
  }

  fetchSavedFilters(signal?: AbortSignal): Promise<Array<{ id: string; name: string; mode: SavedFilterMode }>> {
    return this.config.fetchSavedFilters(signal);
  }

  getSavedFilter(id: string, signal?: AbortSignal): Promise<GetSavedFilterResponse['findSavedFilter']> {
    return this.config.getSavedFilter(id, signal);
  }

  getTagDetails(tagId: string, signal?: AbortSignal): Promise<{ id: string; name: string; image_path?: string; description?: string; favorite?: boolean } | null> {
    return this.tags.getTagDetails(tagId, signal);
  }

  findTagByName(tagName: string, signal?: AbortSignal): Promise<{ id: string; name: string } | null> {
    return this.tags.findTagByName(tagName, signal);
  }

  createTag(tagName: string, signal?: AbortSignal): Promise<{ id: string; name: string } | null> {
    return this.tags.createTag(tagName, signal);
  }

  ensureTag(tagName: string): Promise<{ id: string; name: string } | null> {
    return this.tags.ensureTag(tagName);
  }

  markerHasTag(marker: { id: string; tags?: Array<{ id: string }> }, tagId: string): boolean {
    return this.tags.markerHasTag(marker, tagId);
  }

  sceneHasTag(sceneId: string, tagId: string, tags?: Array<{ id: string }>, signal?: AbortSignal): Promise<boolean> {
    return this.tags.sceneHasTag(sceneId, tagId, tags, signal);
  }

  updateMarkerTagsWithPrimary(
    marker: Pick<MarkerTagUpdateData, 'id' | 'title' | 'seconds' | 'end_seconds' | 'scene'>,
    primaryTagId: string,
    tagIds: string[],
    signal?: AbortSignal
  ): Promise<void> {
    return this.tags.updateMarkerTagsWithPrimary(marker, primaryTagId, tagIds, signal);
  }

  addTagToMarker(
    marker: MarkerTagUpdateData,
    tagId: string,
    signal?: AbortSignal
  ): Promise<void> {
    return this.tags.addTagToMarker(marker, tagId, signal);
  }

  addTagToScene(sceneId: string, tagId: string, signal?: AbortSignal): Promise<void> {
    return this.tags.addTagToScene(sceneId, tagId, signal);
  }

  removeTagFromMarker(
    marker: MarkerTagUpdateData,
    tagId: string,
    signal?: AbortSignal
  ): Promise<void> {
    return this.tags.removeTagFromMarker(marker, tagId, signal);
  }

  removeTagFromScene(sceneId: string, tagId: string, signal?: AbortSignal): Promise<void> {
    return this.tags.removeTagFromScene(sceneId, tagId, signal);
  }

  getTagSources(ids: string[]): Promise<void> {
    return this.tags.getTagSources(ids);
  }

  getPerformerDetails(performerId: string, signal?: AbortSignal): Promise<PerformerExtended | null> {
    return this.entities.getPerformerDetails(performerId, signal);
  }

  getStudioDetails(studioId: string, signal?: AbortSignal): Promise<StudioExtended | null> {
    return this.entities.getStudioDetails(studioId, signal);
  }

  updateImageTags(imageId: string, tagIds: string[], signal?: AbortSignal): Promise<void> {
    return this.entities.updateImageTags(imageId, tagIds, signal);
  }

  updateImagePerformers(imageId: string, performerIds: string[], signal?: AbortSignal): Promise<void> {
    return this.entities.updateImagePerformers(imageId, performerIds, signal);
  }

  incrementImageOCount(imageId: string, signal?: AbortSignal): Promise<number> {
    return this.entities.incrementImageOCount(imageId, signal);
  }

  updateScenePerformers(sceneId: string, performerIds: string[], signal?: AbortSignal): Promise<void> {
    return this.entities.updateScenePerformers(sceneId, performerIds, signal);
  }

  updatePerformerFavorite(performerId: string, favorite: boolean, signal?: AbortSignal): Promise<void> {
    return this.entities.updatePerformerFavorite(performerId, favorite, signal);
  }

  incrementOCount(sceneId: string, times?: string[], signal?: AbortSignal): Promise<{ count: number; history: string[] }> {
    return this.entities.incrementOCount(sceneId, times, signal);
  }

  incrementScenePlayCount(sceneId: string): Promise<void> {
    return this.entities.incrementScenePlayCount(sceneId);
  }

  saveSceneActivity(sceneId: string, resumeTime: number | undefined, playDuration: number): Promise<void> {
    return this.entities.saveSceneActivity(sceneId, resumeTime, playDuration);
  }

  updateSceneRating(sceneId: string, rating10: number, signal?: AbortSignal): Promise<number> {
    return this.entities.updateSceneRating(sceneId, rating10, signal);
  }

  updateImageRating(imageId: string, rating10: number, signal?: AbortSignal): Promise<number> {
    return this.entities.updateImageRating(imageId, rating10, signal);
  }

  findGalleries(signal?: AbortSignal): Promise<Gallery[]> {
    return this.entities.findGalleries(signal);
  }

  createSceneMarker(
    sceneId: string,
    seconds: number,
    primaryTagId: string,
    title: string = '',
    endSeconds?: number | null,
    tagIds: string[] = [],
    signal?: AbortSignal
  ): Promise<{ id: string; title: string; seconds: number; end_seconds?: number; stream?: string; preview?: string; scene: { id: string; title?: string; files?: Array<{ width?: number; height?: number; path?: string }>; performers?: Array<{ id: string; name: string; image_path?: string }> } | Scene; primary_tag: { id: string; name: string }; tags: Array<{ id: string; name: string }> }> {
    return this.entities.createSceneMarker(sceneId, seconds, primaryTagId, title, endSeconds, tagIds, signal);
  }
}
