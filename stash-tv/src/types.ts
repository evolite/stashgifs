/**
 * Type definitions for Stash TV Feed UI
 */

export interface Scene {
  id: string;
  title?: string;
  date?: string;
  details?: string;
  url?: string;
  rating?: number;
  studio?: Studio;
  performers?: Performer[];
  tags?: Tag[];
  files?: SceneFile[];
  paths?: ScenePath[];
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

export interface ScenePath {
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
  rating?: number;
  query?: string;
  limit?: number;
  offset?: number;
}

export interface FeedSettings {
  autoPlay: boolean;
  autoPlayThreshold: number; // 0-1, how much of video must be visible
  maxConcurrentVideos: number;
  unloadDistance: number; // pixels from viewport to unload
  cardMaxWidth: number; // pixels
  aspectRatio: 'preserve' | '16:9' | '9:16' | '1:1';
  showControls: 'always' | 'hover' | 'never';
  enableFullscreen: boolean;
}

export interface VideoPostData {
  scene: Scene;
  videoUrl?: string;
  thumbnailUrl?: string;
  aspectRatio?: number; // width/height
}

export interface VideoPlayerState {
  isPlaying: boolean;
  isMuted: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isFullscreen: boolean;
}

