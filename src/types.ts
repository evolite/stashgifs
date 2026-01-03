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

export interface Studio {
  id: string;
  name: string;
}

export interface Performer {
  id: string;
  name: string;
  image_path?: string;
}

export interface Tag {
  id: string;
  name: string;
}

export interface SceneFile {
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

export interface ScenePaths {
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
}

export interface FeedSettings {
  autoPlay: boolean;
  autoPlayThreshold: number; // 0-1, how much of video must be visible
  unloadDistance: number; // pixels from viewport to unload
  cardMaxWidth: number; // pixels
  aspectRatio: 'preserve' | '16:9' | '9:16' | '1:1';
  showControls: 'always' | 'hover' | 'never';
  enableFullscreen: boolean;
  backgroundPreloadEnabled?: boolean;
  backgroundPreloadDelay?: number; // ms, default: 150ms delay between videos
  backgroundPreloadFastScrollDelay?: number; // ms, default: 400ms delay during fast scrolling
  backgroundPreloadScrollVelocityThreshold?: number; // pixels/ms, default: 2.0 for fast scroll detection
  enabledFileTypes?: string[]; // File extensions to include (e.g., ['.gif', '.webm']), default: ['.gif']
  includeImagesInFeed?: boolean; // Whether to include images in feed, default: true
  imagesOnly?: boolean; // When true, only load images and skip videos
  orientationFilter?: ('landscape' | 'portrait' | 'square')[]; // Filter content by orientation
  includeShortFormContent?: boolean; // Enable/disable short-form content (videos < duration)
  shortFormInHDMode?: boolean; // Include short-form in HD mode
  shortFormInNonHDMode?: boolean; // Include short-form in non-HD mode
  shortFormMaxDuration?: number; // Maximum duration in seconds for short-form content, default: 120
  shortFormOnly?: boolean; // When true, only load short-form content and skip regular markers
  snapToCards?: boolean; // When true, scroll/swipe snaps to center next/previous card
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
  tags?: Tag[];
  performers?: Performer[];
  visualFiles?: Array<{
    path?: string;
    video_codec?: string;
    duration?: number;
  }>;
}

/**
 * ImagePostData - Data structure for image posts in feed
 */
export interface ImagePostData {
  image: Image;
  imageUrl?: string;
  aspectRatio?: number; // width/height
}

