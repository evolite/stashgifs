/**
 * VideoJsPlayer
 *
 * A thin wrapper around the vendored video.js engine (window.videojs, loaded via
 * <script> in index.html) that implements the IVideoPlayer surface used across the
 * app. Replaces the hand-rolled NativeVideoPlayer: video.js + @videojs/http-streaming
 * give us HLS, transcode fallback, and source selection, so scenes whose codec the
 * browser can't decode natively (HEVC/AV1) or that are HLS-only now play.
 *
 * Clip start/end and looping are handled natively here: seek to startAt on load,
 * and loopBack() (driven by timeupdate + ended) returns every video — clipped or
 * not — to its start and fires onLoop for reel auto-advance.
 */

import { VideoPlayerState, VideoSource, IVideoPlayer } from './types.js';
import { normalizeMediaUrl } from './utils.js';
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
  // Clip window. startAt > 0 = seek there on load; endAt > 0 = loop at that bound.
  private readonly startAt: number;
  private readonly endAt: number;

  private isUnloaded: boolean = false;
  private manuallyPaused: boolean = false;
  private destroyed: boolean = false;
  private sourcesExhausted: boolean = false;
  // Re-entrancy guard so a single loop-back doesn't fire twice from the
  // overlapping timeupdate/ended events.
  private looping = false;
  private startSeekFixed = false;
  private onLoopCallback?: () => void;

  constructor(container: HTMLElement, videoUrl: string, options?: VideoJsPlayerOptions) {
    this.container = container;
    this.sources = this.buildSources(videoUrl, options?.sources);
    if (this.sources.length === 0) {
      throw new Error(`VideoJsPlayer: no valid source for ${videoUrl}`);
    }

    this.startAt = typeof options?.startTime === 'number' && options.startTime > 0 ? options.startTime : 0;
    this.endAt = typeof options?.endTime === 'number' && options.endTime > 0 ? options.endTime : 0;

    this.state = {
      isPlaying: false,
      isMuted: options?.muted ?? true,
      currentTime: 0,
      duration: 0,
      volume: 1,
      isFullscreen: false,
    };

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
      // All media loops manually via loopBack() so it returns to startAt (not 0)
      // and fires onLoop for reel auto-advance. Native loop is never used.
      loop: false,
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
    player.on('loadedmetadata', () => {
      this.state.duration = this.safeNumber(() => player.duration());
      // Seek to the clip's start once metadata is available.
      if (this.startAt > 0) {
        try { player.currentTime(this.startAt); } catch { /* not seekable yet */ }
      }
    });

    player.on('play', () => {
      this.state.isPlaying = true;
      this.manuallyPaused = false;
    });
    player.on('playing', () => {
      this.state.isPlaying = true;
      this.fixStartSeek(player);
    });
    player.on('pause', () => {
      this.state.isPlaying = false;
    });
    player.on('timeupdate', () => {
      const t = this.safeNumber(() => player.currentTime());
      this.state.currentTime = t;
      const endBound = this.endAt > 0 ? this.endAt : this.state.duration;
      if (endBound > 0 && t >= endBound) {
        this.loopBack(player);
      }
    });
    player.on('ended', () => this.loopBack(player));
    player.on('volumechange', () => {
      this.state.isMuted = this.safeBool(() => player.muted());
      this.state.volume = this.safeNumber(() => player.volume());
    });
    player.on('error', () => this.handleSourceError());
  }

  /**
   * Loop all media back to its start (startAt, not 0), resume if paused, and
   * fire onLoop for reel auto-advance. Driven from both timeupdate (clip end)
   * and the native 'ended' event; the re-entrancy guard collapses the two into
   * a single loop.
   */
  private loopBack(player: VjsPlayer): void {
    if (this.looping) return;
    this.looping = true;
    try {
      player.currentTime(this.startAt);
      if (player.paused()) player.play()?.catch(() => {});
      this.onLoopCallback?.();
    } catch { /* not seekable */ }
    // Release the guard only once the seek actually lands. A timer fallback here
    // could clear it mid-seek and let a second timeupdate/ended re-enter loopBack
    // (double reel auto-advance), so the 'seeked' event is the single release.
    player.one('seeked', () => { this.looping = false; });
  }

  /**
   * Some browsers reset currentTime when play() runs right after a seek, so the
   * first frame can land at 0 instead of the clip start. Re-seek once on the
   * first 'playing' event if the position drifted from startAt.
   */
  private fixStartSeek(player: VjsPlayer): void {
    if (this.startSeekFixed || this.startAt <= 0) return;
    this.startSeekFixed = true;
    if (Math.abs(this.safeNumber(() => player.currentTime()) - this.startAt) > 0.5) {
      try { player.currentTime(this.startAt); } catch { /* not seekable */ }
    }
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

    // The caller (ReelPlaybackController.enforceActive) guarantees the player is
    // already muted on the gesture-less autoplay path, so no mute reconciliation
    // is needed here — keeping the engine's muted state the single owner.
    try {
      await player.play();
    } catch {
      // Non-fatal: blocked autoplay or transient interruption. The next reconcile
      // (scroll/intersection/gesture) calls play() again. Codec errors go through
      // the 'error' event → source fallback.
    }
    // state.isPlaying / manuallyPaused are owned by the 'playing'/'play'/'pause'
    // event handlers — no imperative write needed here.
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
    this.looping = false;
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
    this.looping = false;
    this.startSeekFixed = false;
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

  onLoop(callback: () => void): void {
    this.onLoopCallback = callback;
  }

  offLoop(): void {
    this.onLoopCallback = undefined;
  }

  destroy(): void {
    this.destroyed = true;
    this.looping = false;
    this.onLoopCallback = undefined;
    if (this.player) {
      try {
        if (!this.player.isDisposed()) this.player.dispose();
      } catch { /* already disposed */ }
      this.player = undefined;
    }
  }
}
