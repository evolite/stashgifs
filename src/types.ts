export interface Scene {
  id: string;
  title?: string;
  date?: string;
  details?: string;
  url?: string;
  rating100?: number;
  o_counter?: number;
  play_count?: number;
  studio?: Studio;
  performers?: Performer[];
  tags?: Tag[];
  files?: SceneFile[];
  paths?: ScenePaths;
  sceneStreams?: Array<{
    url: string;
    mime_type?: string;
    label?: string;
  }>;
}

export interface SceneMarker {
  id: string;
  title: string;
  seconds: number;
  end_seconds?: number;
  stream?: string;
  preview?: string;
  primary_tag?: Tag;
  tags?: Tag[];
  scene: Scene;
}

interface Studio {
  id: string;
  name: string;
  image_path?: string;
}

export interface Performer {
  id: string;
  name: string;
  image_path?: string;
  gender?: string;
  favorite?: boolean;
  birthdate?: string;
  stash_ids?: Array<{ stash_id: string; endpoint: string }>;
  tags?: Tag[];
  rating100?: number;
}

export interface Tag {
  id: string;
  name: string;
}

interface SceneFile {
  id: string;
  path: string;
  size?: number;
  duration?: number;
  video_codec?: string;
  audio_codec?: string;
  width?: number;
  height?: number;
  bit_rate?: number;
}

interface ScenePaths {
  screenshot?: string;
  preview?: string;
  stream?: string;
  webp?: string;
  vtt?: string;
}

export type DateRangeFilter = 'week' | 'month' | 'year';
export type SavedFilterMode = 'SCENE_MARKERS' | 'IMAGES';

export interface FilterOptions {
  studios?: string[];
  performers?: string[];
  tags?: string[];
  primary_tags?: string[];
  rating?: number;
  rating100?: number;
  query?: string;
  limit?: number;
  offset?: number;
  savedFilterId?: string;
  savedFilterMode?: SavedFilterMode;
  shuffleMode?: boolean;
  includeScenesWithoutMarkers?: boolean;
  randomMinSceneDuration?: number;
  orientationFilter?: ('landscape' | 'portrait' | 'square')[];
  dateRangeFilter?: DateRangeFilter;
  sortSeed?: string;
  excludedTagIds?: string[];
  tagDepth?: number;
  studioDepth?: number;
  includeSceneTagsInMarkerFilter?: boolean;
  showPerformerTags?: boolean;
}

export interface FeedSettings {
  hdMode?: boolean;
  maxResolution?: number;
  cardMaxWidth: number;
  aspectRatio: 'preserve' | '16:9' | '9:16' | '1:1';
  enabledFileTypes?: string[];
  includeMarkersInFeed?: boolean;
  playMarkersToEnd?: boolean;
  searchMarkersByName?: boolean;
  includeRandomInFeed?: boolean;
  randomIncludeScenesWithMarkers?: boolean;
  randomLongScenesOnly?: boolean;
  includeImagesInFeed?: boolean;
  imagesOnly?: boolean;
  orientationFilter?: ('landscape' | 'portrait' | 'square')[];
  includeShortForm?: boolean;
  shortFormMaxDuration?: number;
  shortFormTags?: Tag[];
  shortFormFolder?: string;
  randomSnippetDuration?: number;
  includeScenePreviews?: boolean;
  reelAutoScroll?: boolean;
  autoHideSearchBar?: boolean;
  hideBrowserBars?: boolean;
  themeBackground?: string;
  themePrimary?: string;
  themeSecondary?: string;
  themeAccent?: string;
  showVerifiedCheckmarks?: boolean;
  showProductionAge?: boolean;
  excludedTagNames?: string[];
  imagesInGalleryOnly?: boolean;
  galleryIds?: string[];
  seenHistorySize?: number;
  trackWatchHistory?: boolean;
  contentLimit?: number;
  includeSubtags?: boolean;
  showPerformerTags?: boolean;
  showSceneTags?: boolean;
  tagDisplayLimit?: number;
  performerDisplayLimit?: number;
  showStudioChips?: boolean;
  showPerformerEmbellishment?: boolean;
  showMalePerformers?: boolean;
  showFemalePerformers?: boolean;
  showOtherGenderPerformers?: boolean;
  showSceneTitle?: boolean;
  showOCountButton?: boolean;
  showRatingButton?: boolean;
  enableRatingHotkeys?: boolean;
  arrowSeekSeconds?: number;
  showViewCountBadge?: boolean;
  showBookmarkButton?: boolean;
  savedSearches?: SavedSearch[];
}

export interface SavedSearch {
  id: string;
  name: string;
  tags: [number, string][];
  performers: [number, string][];
  studios: [number, string][];
  markerName?: string;
  dateRange?: DateRangeFilter;
}

export interface VideoPostData {
  marker: SceneMarker;
  videoUrl?: string;
  aspectRatio?: number;
  startTime?: number;
  endTime?: number;
  playMarkerToEnd?: boolean;
}

export interface VideoPlayerState {
  isPlaying: boolean;
  isMuted: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isFullscreen: boolean;
}

export interface VideoSource {
  src: string;
  type?: string;
}

export interface IVideoPlayer {
  play(): Promise<void>;
  pause(): void;
  pauseManually(): void;
  isPlaying(): boolean;
  isManuallyPaused(): boolean;
  clearManualPause(): void;
  getVideoElement(): HTMLVideoElement;
  getState(): VideoPlayerState;
  seekTo(time: number): void;
  getProgress(): number;
  seekToProgress(ratio: number): void;
  seekBy(seconds: number): void;
  setMuted(isMuted: boolean): void;
  setVolume(volume: number): void;
  unload(): void;
  reload(): void;
  getIsUnloaded(): boolean;
  hasLoadError(): boolean;
  onSourcesExhausted(callback: () => void): void;
  offSourcesExhausted(): void;
  onLoop(callback: () => void): void;
  offLoop(): void;
  onTimeUpdate(callback: () => void): void;
  offTimeUpdate(): void;
  destroy(): void;
}

export interface Image {
  id: string;
  title?: string;
  date?: string;
  rating100?: number;
  o_counter?: number;
  width?: number;
  height?: number;
  aspectRatio?: number;
  paths?: {
    thumbnail?: string;
    preview?: string;
    image?: string;
  };
  studio?: Studio;
  tags?: Tag[];
  performers?: Performer[];
  visualFiles?: Array<{
    path?: string;
    video_codec?: string;
    duration?: number;
    width?: number;
    height?: number;
  }>;
}

export interface ImageBasedPostData {
  image: Image;
  aspectRatio?: number;
}

export interface ImagePostData extends ImageBasedPostData {
  imageUrl?: string;
}

export interface ImageVideoPostData extends ImageBasedPostData {
  videoUrl?: string;
}
