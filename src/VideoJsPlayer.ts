/**
 * VideoJsPlayer
 *
 * A thin wrapper around the vendored video.js engine (window.videojs, loaded via
 * <script> in index.html) that implements the IVideoPlayer surface used across the
 * app. Replaces the hand-rolled NativeVideoPlayer: video.js + @videojs/http-streaming
 * give us HLS, transcode fallback, and source selection, so scenes whose codec the
 * browser can't decode natively (HEVC/AV1) or that are HLS-only now play.
 *
 * Marker start/end clipping is handled by the videojs-offset plugin instead of the
 * old desiredStartTime/re-seek machinery.
 */

import { VideoPlayerState, VideoSource, IVideoPlayer } from './types.js';
import { normalizeMediaUrl, isMobileDevice } from './utils.js';
// fallow-ignore-next-line unresolved-import
import type { VjsPlayer } from './vendor/videojs.js';

interface VideoJsPlayerOptions {
  muted?: boolean;
  autoplay?: boolean;
  startTime?: number;
  endTime?: number;
  showLoadingIndicator?: boolean;
  objectFit?: 'cover' | 'contain';
  /** Ordered candidate sources (for codec/transcode fallback). Overrides videoUrl. */
  sources?: VideoSource[];
}

export class VideoJsPlayer implements IVideoPlayer {
  private readonly container: HTMLElement;
  private videoEl: HTMLVideoElement;
  private player?: VjsPlayer;
  private readonly state: VideoPlayerState;
  private readonly sources: VideoSource[];
  private sourceIndex: number = 0;
  // Marker clip window, handled natively (no videojs-offset). 0 = no bound.
  private readonly startAt: number;
  private readonly endAt: number;
  private readonly hasClip: boolean;

  private isUnloaded: boolean = false;
  private manuallyPaused: boolean = false;
  private destroyed: boolean = false;
  private sourcesExhausted: boolean = false;
  private clipping = false;
  private clippingResetTimer?: ReturnType<typeof setTimeout>;
  private loopTrackTime = 0;
  private onLoopCallback?: () => void;

  private readyPromise: Promise<void>;
  private readyResolver?: () => void;

  constructor(container: HTMLElement, videoUrl: string, options?: VideoJsPlayerOptions) {
    this.container = container;
    this.sources = this.buildSources(videoUrl, options?.sources);
    if (this.sources.length === 0) {
      throw new Error(`VideoJsPlayer: no valid source for ${videoUrl}`);
    }

    this.startAt = typeof options?.startTime === 'number' && options.startTime > 0 ? options.startTime : 0;
    this.endAt = typeof options?.endTime === 'number' && options.endTime > 0 ? options.endTime : 0;
    this.hasClip = this.startAt > 0 || this.endAt > 0;

    this.state = {
      isPlaying: false,
      isMuted: options?.muted ?? true,
      currentTime: 0,
      duration: 0,
      volume: 1,
      isFullscreen: false,
    };

    this.readyPromise = new Promise<void>((resolve) => { this.readyResolver = resolve; });

    this.videoEl = this.createVideoElement(options);
    this.player = this.createPlayer(options);
  }

  private buildSources(videoUrl: string, sources?: VideoSource[]): VideoSource[] {
    if (sources?.length) {
      return sources.filter((s) => !!s.src);
    }
    const normalized = normalizeMediaUrl(videoUrl);
    return normalized ? [{ src: normalized, type: 'video/mp4' }] : [];
  }

  private createVideoElement(options?: VideoJsPlayerOptions): HTMLVideoElement {
    const el = document.createElement('video');
    el.className = 'video-js video-player__element';
    el.playsInline = true;
    el.setAttribute('playsinline', 'true');
    el.setAttribute('webkit-playsinline', 'true');
    el.setAttribute('x5-playsinline', 'true');
    el.setAttribute('tabindex', '-1');
    el.muted = options?.muted ?? true;
    // The autoplay gate checks the muted ATTRIBUTE (not just the property) on a
    // cold load, so set both to keep muted autoplay eligible without a gesture.
    if (el.muted) el.setAttribute('muted', '');
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.objectFit = options?.objectFit ?? 'cover';
    this.container.appendChild(el);
    return el;
  }

  private createPlayer(options?: VideoJsPlayerOptions): VjsPlayer {
    const videojs = globalThis.videojs;
    if (!videojs) {
      throw new Error('VideoJsPlayer: window.videojs is not loaded (vendored script missing)');
    }

    const player = videojs(this.videoEl, {
      controls: false,
      muted: options?.muted ?? true,
      // Native loop only for unclipped media; clipped markers loop manually so they
      // return to startAt (not 0). See enforceClip().
      loop: !this.hasClip,
      autoplay: options?.autoplay ? 'muted' : false,
      preload: 'auto',
      playsinline: true,
      fill: true,
      bigPlayButton: false,
      controlBar: false,
      errorDisplay: false,
      loadingSpinner: options?.showLoadingIndicator ?? false,
      textTrackSettings: false,
      inactivityTimeout: 0,
      userActions: { click: false, doubleClick: false },
      sources: [this.sources[this.sourceIndex]],
    });

    // Keep object-fit on the tech element (video.js resets element styles on setup).
    player.ready(() => {
      const techEl = player.tech(true)?.el();
      if (techEl instanceof HTMLVideoElement) {
        this.videoEl = techEl;
        techEl.style.objectFit = options?.objectFit ?? 'cover';
      }
    });

    this.attachEventListeners(player);
    return player;
  }

  private attachEventListeners(player: VjsPlayer): void {
    const resolveReady = () => {
      if (this.readyResolver) {
        const r = this.readyResolver;
        this.readyResolver = undefined;
        r();
      }
    };

    player.on('loadedmetadata', () => {
      this.state.duration = this.safeNumber(() => player.duration());
      // Seek to the marker's start once metadata is available.
      if (this.startAt > 0) {
        try { player.currentTime(this.startAt); } catch { /* not seekable yet */ }
      }
    });
    player.on('loadeddata', resolveReady);
    player.on('canplay', resolveReady);

    player.on('play', () => {
      this.state.isPlaying = true;
      this.manuallyPaused = false;
    });
    player.on('playing', () => {
      this.state.isPlaying = true;
    });
    player.on('pause', () => {
      this.state.isPlaying = false;
    });
    player.on('timeupdate', () => {
      const t = this.safeNumber(() => player.currentTime());
      // Detect native loops for non-clipped videos (loop:true suppresses 'ended').
      if (!this.hasClip && this.loopTrackTime > 0.5 && t + 0.4 < this.loopTrackTime) {
        this.fireLoop();
      }
      this.loopTrackTime = t;
      this.state.currentTime = t;
      this.enforceClip(player);
    });
    player.on('ended', () => {
      if (this.hasClip) {
        this.restartClip(player); // restartClip fires onLoop itself
      }
    });
    player.on('volumechange', () => {
      this.state.isMuted = this.safeBool(() => player.muted());
      this.state.volume = this.safeNumber(() => player.volume());
    });
    player.on('error', () => this.handleSourceError());
  }

  /** Loop a marker clip back to its start once it passes the end boundary. */
  private enforceClip(player: VjsPlayer): void {
    if (!this.hasClip || this.endAt <= 0) return;
    const t = this.safeNumber(() => player.currentTime());
    if (t >= this.endAt) {
      this.restartClip(player);
    }
  }

  private restartClip(player: VjsPlayer): void {
    if (this.clipping) return;
    this.clipping = true;
    clearTimeout(this.clippingResetTimer);
    try {
      player.currentTime(this.startAt);
      if (player.paused()) player.play()?.catch(() => {});
      this.fireLoop();
    } catch { /* not seekable */ }
    const clearClipping = () => {
      clearTimeout(this.clippingResetTimer);
      this.clippingResetTimer = undefined;
      this.clipping = false;
    };
    player.one('seeked', clearClipping);
    this.clippingResetTimer = setTimeout(clearClipping, 500);
  }

  private fireLoop(): void {
    this.onLoopCallback?.();
  }

  /**
   * On a media error, advance to the next candidate source (HLS/transcode fallback).
   * This is how a HEVC/AV1 "direct" source that the browser can't decode gets
   * replaced by Stash's transcoded stream.
   */
  private handleSourceError(): void {
    if (this.destroyed || !this.player) return;
    if (this.sourceIndex + 1 < this.sources.length) {
      this.sourceIndex += 1;
      this.applyCurrentSource();
      this.player.play()?.catch(() => {});
    } else {
      this.sourcesExhausted = true;
    }
  }

  private applyCurrentSource(): void {
    if (!this.player) return;
    this.player.src(this.sources[this.sourceIndex]);
    // The clip start is re-applied by the 'loadedmetadata' handler after the
    // new source loads, so nothing extra is needed here.
  }

  private isUsable(): boolean {
    return !this.destroyed && !!this.player && !this.player.isDisposed();
  }

  private safeNumber(fn: () => number): number {
    try {
      const v = fn();
      return Number.isFinite(v) ? v : 0;
    } catch {
      return 0;
    }
  }

  private safeBool(fn: () => boolean): boolean {
    try {
      return fn();
    } catch {
      return false;
    }
  }

  // ---- IVideoPlayer ----

  async play(): Promise<void> {
    if (!this.isUsable() || this.isUnloaded) return;
    const player = this.player!;

    // Browsers only allow autoplay without a gesture while muted (touch devices).
    if (isMobileDevice() && !this.safeBool(() => player.muted())) {
      player.muted(true);
      this.state.isMuted = true;
    }

    try {
      await player.play();
    } catch {
      // Non-fatal: blocked autoplay or transient interruption. The next reconcile()
      // (scroll/intersection/gesture) calls play() again. Codec errors go through
      // the 'error' event → source fallback.
      return;
    }
    if (this.isUsable()) {
      this.state.isPlaying = !player.paused();
      this.manuallyPaused = false;
    }
  }

  pause(): void {
    if (!this.isUsable()) return;
    try { this.player!.pause(); } catch { /* disposed */ }
  }

  pauseManually(): void {
    this.manuallyPaused = true;
    this.pause();
  }

  isManuallyPaused(): boolean {
    return this.manuallyPaused;
  }

  clearManualPause(): void {
    this.manuallyPaused = false;
  }

  isPlaying(): boolean {
    if (!this.isUsable()) return false;
    const player = this.player!;
    try {
      return !player.paused() && !player.ended() && player.readyState() > 0;
    } catch {
      return false;
    }
  }

  getVideoElement(): HTMLVideoElement {
    return this.videoEl;
  }

  getState(): VideoPlayerState {
    return { ...this.state };
  }

  waitForReady(timeoutMs: number = 3000): Promise<void> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return this.readyPromise;
    }
    let handle: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      this.readyPromise,
      new Promise<void>((resolve) => { handle = setTimeout(resolve, timeoutMs); }),
    ]).finally(() => { if (handle !== undefined) clearTimeout(handle); });
  }

  seekTo(time: number): void {
    if (!this.isUsable()) return;
    try { this.player!.currentTime(time); } catch { /* disposed */ }
  }

  getProgress(): number {
    if (!this.isUsable()) return 0;
    const current = this.safeNumber(() => this.player!.currentTime());
    const start = this.startAt;
    const end = this.endAt > 0 ? this.endAt : this.safeNumber(() => this.player!.duration());
    const span = end - start;
    if (span <= 0) return 0;
    return Math.max(0, Math.min(1, (current - start) / span));
  }

  seekToProgress(ratio: number): void {
    if (!this.isUsable()) return;
    const clamped = Math.max(0, Math.min(1, ratio));
    const start = this.startAt;
    const end = this.endAt > 0 ? this.endAt : this.safeNumber(() => this.player!.duration());
    const span = end - start;
    if (span <= 0) return;
    this.seekTo(start + clamped * span);
  }

  setMuted(isMuted: boolean): void {
    if (!this.isUsable()) return;
    try {
      this.player!.muted(!!isMuted);
      this.state.isMuted = !!isMuted;
    } catch { /* disposed */ }
  }

  setVolume(volume: number): void {
    if (!this.isUsable()) return;
    const clamped = Math.max(0, Math.min(1, volume));
    try {
      this.player!.volume(clamped);
      this.state.volume = clamped;
    } catch { /* disposed */ }
  }

  /**
   * Free the media buffers while keeping the player instance for a cheap reload.
   * video.js reset() detaches the source and releases the tech's buffers.
   */
  unload(): void {
    if (this.isUnloaded || !this.isUsable()) {
      this.isUnloaded = true;
      return;
    }
    clearTimeout(this.clippingResetTimer);
    this.clippingResetTimer = undefined;
    this.clipping = false;
    this.loopTrackTime = 0;
    try {
      this.player!.pause();
      this.player!.reset();
    } catch { /* disposed */ }
    this.isUnloaded = true;
    this.state.isPlaying = false;
    this.state.currentTime = 0;
  }

  reload(): void {
    if (!this.isUnloaded || !this.isUsable()) return;
    this.sourceIndex = 0;
    this.sourcesExhausted = false;
    this.loopTrackTime = 0;
    this.readyPromise = new Promise<void>((resolve) => { this.readyResolver = resolve; });
    this.applyCurrentSource();
    this.isUnloaded = false;
  }

  getIsUnloaded(): boolean {
    return this.isUnloaded;
  }

  hasLoadError(): boolean {
    if (this.sourcesExhausted) return true;
    if (!this.isUsable()) return false;
    try {
      return this.player!.error() !== null;
    } catch {
      return false;
    }
  }

  getLoadErrorType(): 'timeout' | 'network' | 'play' | null {
    if (!this.isUsable()) return this.sourcesExhausted ? 'play' : null;
    let code: number | undefined;
    try {
      code = this.player!.error()?.code;
    } catch {
      code = undefined;
    }
    if (code === undefined && !this.sourcesExhausted) return null;
    // MediaError codes: 2 = NETWORK, 3 = DECODE, 4 = SRC_NOT_SUPPORTED.
    if (code === 2) return 'network';
    if (code === 3 || code === 4 || this.sourcesExhausted) return 'play';
    return 'play';
  }

  onLoop(callback: () => void): void {
    this.onLoopCallback = callback;
  }

  destroy(): void {
    this.destroyed = true;
    this.clipping = false;
    clearTimeout(this.clippingResetTimer);
    this.clippingResetTimer = undefined;
    this.readyResolver = undefined;
    this.onLoopCallback = undefined;
    if (this.player) {
      try {
        if (!this.player.isDisposed()) this.player.dispose();
      } catch { /* already disposed */ }
      this.player = undefined;
    }
  }
}
