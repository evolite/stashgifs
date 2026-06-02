/**
 * Minimal ambient typings for the vendored video.js UMD build (loaded via a
 * <script> tag in index.html, exposed as `window.videojs`). Only the surface
 * the VideoJsPlayer wrapper actually uses is declared — not the full library.
 *
 * The `offset(...)` method is added at runtime by the videojs-offset plugin.
 */

export interface VjsSource {
  src: string;
  type?: string;
}

export interface VjsError {
  code: number;
  message: string;
}

export interface VjsTech {
  el(): Element | null;
}

export interface VjsOffsetOptions {
  start?: number;
  end?: number;
  restart_beginning?: boolean;
}

export interface VjsPlayer {
  play(): Promise<void> | undefined;
  pause(): void;
  paused(): boolean;
  ended(): boolean;
  muted(value?: boolean): boolean;
  volume(value?: number): number;
  currentTime(seconds?: number): number;
  duration(): number;
  readyState(): number;
  autoplay(value?: boolean | string): boolean | string;
  loop(value?: boolean): boolean;
  controls(value?: boolean): boolean;
  src(source?: VjsSource | VjsSource[] | string): void;
  currentSrc(): string;
  poster(value?: string): string;
  load(): void;
  reset(): void;
  dispose(): void;
  isDisposed(): boolean;
  error(): VjsError | null;
  el(): Element;
  tech(safe?: boolean): VjsTech;
  ready(callback: () => void): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  one(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler?: (...args: unknown[]) => void): void;
  // Added by the videojs-offset plugin.
  offset(options: VjsOffsetOptions): void;
  // requestFullscreen / exitFullscreen exist but are unused by the wrapper.
}

export interface VjsOptions {
  controls?: boolean;
  autoplay?: boolean | 'muted' | 'play' | 'any';
  muted?: boolean;
  loop?: boolean;
  preload?: 'auto' | 'metadata' | 'none';
  playsinline?: boolean;
  fluid?: boolean;
  fill?: boolean;
  sources?: VjsSource[];
  poster?: string;
  bigPlayButton?: boolean;
  errorDisplay?: boolean;
  loadingSpinner?: boolean;
  textTrackSettings?: boolean;
  userActions?: { click?: boolean; doubleClick?: boolean };
  controlBar?: boolean;
  inactivityTimeout?: number;
  plugins?: { offset?: VjsOffsetOptions };
}

export type VideoJsFactory = (
  el: Element | string,
  options?: VjsOptions,
  ready?: () => void
) => VjsPlayer;

declare global {
  interface Window {
    videojs?: VideoJsFactory;
  }
  // eslint-disable-next-line no-var
  var videojs: VideoJsFactory | undefined;
}
