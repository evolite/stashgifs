/**
 * Type definitions for Stashgifs Feed UI
 */

export interface Scene {
  id: string;
  title?: string;
  date?: string;
  details?: string;
  url?: string;
  rating100?: number; // Stash uses rating100 (0-100) instead of rating
  o_counter?: number; // Orgasm count
  play_count?: number; // Number of times the scene has been played
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
  seconds: number; // Start time in seconds
  end_seconds?: number; // End time in seconds
  stream?: string; // Stream URL for the marker
  preview?: string; // Marker-specific preview image
  primary_tag?: Tag;
  tags?: Tag[];
  scene: Scene; // Parent scene
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
  favorite?: boolean;
  birthdate?: string;
  stash_ids?: Array<{ stash_id: string; endpoint: string }>;
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

export interface FilterOptions {
  studios?: string[];
  performers?: string[];
  tags?: string[];
  primary_tags?: string[]; // For scene markers
  rating?: number; // User-facing, will be converted to rating100 in query
  rating100?: number; // Direct rating100 filter (0-100)
  query?: string;
  limit?: number;
  offset?: number;
  savedFilterId?: string; // Saved filter id from Stash (scene markers)
  shuffleMode?: boolean; // When true, use shuffle mode (query scenes directly)
  includeScenesWithoutMarkers?: boolean; // When true in shuffle mode, include scenes with 0 markers
  orientationFilter?: ('landscape' | 'portrait' | 'square')[]; // Filter content by orientation
  sortSeed?: string; // Sort seed for consistent pagination (reused across pages)
  excludedTagIds?: string[]; // Tags to exclude (resolved IDs)
  tagDepth?: number; // Depth for tag hierarchy traversal (-1 = all subtags, 0 = exact match only)
  studioDepth?: number; // Depth for studio hierarchy traversal (-1 = all child studios, 0 = exact match only)
}

export interface FeedSettings {
  hdMode?: boolean; // Whether to load full HD scene videos instead of preview clips
  cardMaxWidth: number; // pixels
  aspectRatio: 'preserve' | '16:9' | '9:16' | '1:1';
  enabledFileTypes?: string[]; // File extensions to include (e.g., ['.gif', '.webm']), default: ['.gif']
  includeMarkersInFeed?: boolean; // Whether to include scene markers in feed, default: true
  searchMarkersByName?: boolean; // Show a Markers section in search suggestions, default: false
  includeRandomInFeed?: boolean; // Include random scenes played from a random timeframe, default: false
  randomIncludeScenesWithMarkers?: boolean; // Random mode includes scenes that have existing markers, default: false
  includeImagesInFeed?: boolean; // Whether to include images in feed, default: true
  imagesOnly?: boolean; // When true, only load images and skip videos
  orientationFilter?: ('landscape' | 'portrait' | 'square')[]; // Filter content by orientation
  includeShortForm?: boolean; // Include short-form content (videos < shortFormMaxDuration), default: true
  shortFormMaxDuration?: number; // Maximum duration in seconds for short-form content, default: 120
  reelAutoScroll?: boolean; // Auto-advance to next post when video loops
  autoHideSearchBar?: boolean; // Hide search bar on scroll-down, default: true
  themeBackground?: string; // Background color for app + search overlay
  themePrimary?: string; // Primary surface color for cards
  themeSecondary?: string; // Secondary surface color for inputs/panels
  themeAccent?: string; // Accent color for highlights
  showVerifiedCheckmarks?: boolean; // Toggle verified checkmark badges
  showProductionAge?: boolean; // Show performer age at production next to name
  excludedTagNames?: string[]; // Tags to exclude from feed (names)
  imagesInGalleryOnly?: boolean; // When true, only show images that belong to a gallery
  galleryIds?: string[]; // Gallery IDs to filter to; empty = any gallery (NOT_NULL)
  seenHistorySize?: number; // Max IDs tracked in seen ring buffer (0 = disabled, default 500)
  contentLimit?: number; // Max items per content type to paginate through (default 5000)
  includeSubtags?: boolean; // When true, tag and studio search includes all descendants
  showStudioChips?: boolean; // Show studio logo + name chips alongside performer chips, default: true
  enableDiscoveryPanel?: boolean; // Show StashDB discovery sidebar panel, default: true
  discoveryPanelSize?: number; // Panel width in px (1–1000), default 260
  discoverySceneOrder?: 'latest' | 'random' | 'trending'; // Scene selection: latest (default), random, or trending
  showSceneTitle?: boolean; // Show scene/image title above performers in each post, default: false
  showOCountButton?: boolean; // Show O-count button in button group, default: true
  showViewCountBadge?: boolean; // Show view-count badge in button group, default: true
  showAddTagButton?: boolean; // Show "Add tag" button in button group, default: true
  whisparrBaseUrl?: string; // Whisparr base URL, e.g. http://localhost:6969
  whisparrApiKey?: string; // Whisparr API key (X-Api-Key header)
  whisparrRootFolderPath?: string; // Selected Whisparr root folder path
  whisparrQualityProfileId?: number; // Selected Whisparr quality profile id
}

export interface VideoPostData {
  marker: SceneMarker;
  videoUrl?: string;
  aspectRatio?: number; // width/height
  startTime?: number; // Start time in seconds for markers
  endTime?: number; // End time in seconds for markers
}

export interface VideoPlayerState {
  isPlaying: boolean;
  isMuted: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isFullscreen: boolean;
}

/** A playable media source (URL + optional MIME type for player source selection). */
export interface VideoSource {
  src: string;
  type?: string;
}

/**
 * The video-player surface that the rest of the app depends on. Both the legacy
 * NativeVideoPlayer and the video.js-backed VideoJsPlayer implement this, so the
 * post/visibility/audio layers stay player-agnostic.
 */
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
  /** Playback position as 0–1 within the clip window (respects startAt/endAt). */
  getProgress(): number;
  /** Seek to a 0–1 position within the clip window. */
  seekToProgress(ratio: number): void;
  setMuted(isMuted: boolean): void;
  setVolume(volume: number): void;
  unload(): void;
  reload(): void;
  getIsUnloaded(): boolean;
  hasLoadError(): boolean;
  /** Register a callback fired once each time the media loops back to its start. */
  onLoop(callback: () => void): void;
  /** Remove the registered loop callback. */
  offLoop(): void;
  /** Register a callback fired on each playback time update. */
  onTimeUpdate(callback: () => void): void;
  /** Remove the registered time-update callback. */
  offTimeUpdate(): void;
  destroy(): void;
}

/**
 * Image type (simplified for feed display)
 */
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

/**
 * Shared base for image-backed post types (ImagePost, ImageVideoPost).
 * BasePost's default method implementations operate on this shape.
 * VideoPost does NOT extend this — it overrides those methods entirely.
 */
export interface ImageBasedPostData {
  image: Image;
  aspectRatio?: number; // width/height
}

/**
 * ImagePostData - Data structure for image posts in feed
 */
export interface ImagePostData extends ImageBasedPostData {
  imageUrl?: string;
}

/**
 * ImageVideoPostData - Data structure for image videos (MP4/M4V images treated as videos)
 */
export interface ImageVideoPostData extends ImageBasedPostData {
  videoUrl?: string;
}
