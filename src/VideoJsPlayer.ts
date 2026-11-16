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
  sources?: VideoSource[];
}

export class VideoJsPlayer implements IVideoPlayer {
  private readonly container: HTMLElement;
  private videoEl: HTMLVideoElement;
  private player?: VjsPlayer;
  private readonly state: VideoPlayerState;
  private readonly sources: VideoSource[];
  private sourceIndex: number = 0;
  private readonly startAt: number;
  private readonly endAt: number;

  private isUnloaded: boolean = false;
  private manuallyPaused: boolean = false;
  private wantsToPlay: boolean = false;
  private destroyed: boolean = false;
  private sourcesExhausted: boolean = false;
  private looping = false;
  private startSeekFixed = false;
  private resumeAt = 0;
  private onLoopCallback?: () => void;
  private onSourcesExhaustedCallback?: () => void;
  private onTimeUpdateCallback?: () => void;

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
    if (el.muted) el.setAttribute('muted', '');
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.objectFit = options?.objectFit ?? 'contain';
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

    player.ready(() => {
      const techEl = player.tech(true)?.el();
      if (techEl instanceof HTMLVideoElement) {
        this.videoEl = techEl;
        techEl.style.objectFit = options?.objectFit ?? 'contain';
      }
    });

    this.attachEventListeners(player);
    return player;
  }

  private attachEventListeners(player: VjsPlayer): void {
    player.on('loadedmetadata', () => {
      this.state.duration = this.safeNumber(() => player.duration());
      const target = this.seekTarget();
      if (target > 0) {
        try { player.currentTime(target); } catch { /* not seekable yet */ }
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
      this.onTimeUpdateCallback?.();
    });
    player.on('ended', () => this.loopBack(player));
    player.on('canplay', () => this.resumeIfWanted());
    player.on('loadeddata', () => this.resumeIfWanted());
    player.on('volumechange', () => {
      this.state.isMuted = this.safeBool(() => player.muted());
      this.state.volume = this.safeNumber(() => player.volume());
    });
    player.on('error', () => this.handleSourceError());
  }

  private loopBack(player: VjsPlayer): void {
    if (this.looping) return;
    this.looping = true;
    try {
      player.currentTime(this.startAt);
      if (player.paused()) player.play()?.catch(() => {});
      this.onLoopCallback?.();
    } catch { /* not seekable */ }
    player.one('seeked', () => { this.looping = false; });
  }

  private fixStartSeek(player: VjsPlayer): void {
    const target = this.seekTarget();
    if (this.startSeekFixed || target <= 0) return;
    this.startSeekFixed = true;
    if (Math.abs(this.safeNumber(() => player.currentTime()) - target) > 0.5) {
      try { player.currentTime(target); } catch { /* not seekable */ }
    }
  }

  private seekTarget(): number {
    return this.resumeAt > 0 ? this.resumeAt : this.startAt;
  }

  private rememberPosition(): void {
    const at = this.safeNumber(() => this.player!.currentTime());
    const end = this.endAt > 0 ? this.endAt : this.state.duration;
    const meaningful = at > this.startAt + 1 && (end <= 0 || at < end - 1);
    this.resumeAt = meaningful ? at : 0;
  }

  private handleSourceError(): void {
    if (this.destroyed || !this.player) return;
    if (this.sourceIndex + 1 < this.sources.length) {
      this.sourceIndex += 1;
      this.applyCurrentSource();
      this.player.play()?.catch(() => {});
    } else {
      this.sourcesExhausted = true;
      this.onSourcesExhaustedCallback?.();
    }
  }

  private applyCurrentSource(): void {
    if (!this.player) return;
    this.player.src(this.sources[this.sourceIndex]);
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

  async play(): Promise<void> {
    if (!this.isUsable() || this.isUnloaded) return;
    const player = this.player!;
    this.wantsToPlay = true;
    this.manuallyPaused = false;

    try {
      await player.play();
    } catch {
      // Non-fatal: blocked autoplay, or play() issued before the source was ready
      // (common on a fast reel scroll). wantsToPlay stays set, so the next
      // canplay/loadeddata event resumes playback. Codec errors go through the
      // 'error' event → source fallback.
    }
  }

  private resumeIfWanted(): void {
    if (!this.wantsToPlay || this.manuallyPaused || !this.isUsable() || this.isUnloaded) return;
    const player = this.player!;
    try {
      if (player.paused()) player.play()?.catch(() => {});
    } catch { /* disposed */ }
  }

  pause(): void {
    if (!this.isUsable()) return;
    this.wantsToPlay = false;
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
    const el = this.player?.tech(true)?.el();
    return el instanceof HTMLVideoElement ? el : this.videoEl;
  }

  getState(): VideoPlayerState {
    return { ...this.state };
  }

  seekTo(time: number): void {
    if (!this.isUsable()) return;
    try { this.player!.currentTime(time); } catch { /* disposed */ }
  }

  private clipWindow(): { start: number; span: number } {
    const start = this.startAt;
    const end = this.endAt > 0 ? this.endAt : this.safeNumber(() => this.player!.duration());
    return { start, span: end - start };
  }

  getProgress(): number {
    if (!this.isUsable()) return 0;
    const { start, span } = this.clipWindow();
    if (span <= 0) return 0;
    const current = this.safeNumber(() => this.player!.currentTime());
    return Math.max(0, Math.min(1, (current - start) / span));
  }

  seekToProgress(ratio: number): void {
    if (!this.isUsable()) return;
    const { start, span } = this.clipWindow();
    if (span <= 0) return;
    const clamped = Math.max(0, Math.min(1, ratio));
    this.seekTo(start + clamped * span);
  }

  seekBy(seconds: number): void {
    if (!this.isUsable()) return;
    const { start, span } = this.clipWindow();
    if (span <= 0) return;
    const current = this.safeNumber(() => this.player!.currentTime());
    this.seekTo(Math.max(start, Math.min(start + span, current + seconds)));
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

  unload(): void {
    if (this.isUnloaded || !this.isUsable()) {
      this.isUnloaded = true;
      return;
    }
    this.looping = false;
    this.rememberPosition();
    try {
      this.player!.pause();
      this.player!.reset();
      const el = this.player!.tech(true)?.el();
      if (el instanceof HTMLVideoElement) {
        el.removeAttribute('src');
        el.load();
      }
    } catch { /* disposed */ }
    this.isUnloaded = true;
    this.wantsToPlay = false;
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
    if (this.isUnloaded) return false;
    if (this.sourcesExhausted) return true;
    if (!this.isUsable()) return false;
    try {
      return this.player!.error() !== null;
    } catch {
      return false;
    }
  }

  onSourcesExhausted(callback: () => void): void {
    this.onSourcesExhaustedCallback = callback;
  }

  offSourcesExhausted(): void {
    this.onSourcesExhaustedCallback = undefined;
  }

  onLoop(callback: () => void): void {
    this.onLoopCallback = callback;
  }

  offLoop(): void {
    this.onLoopCallback = undefined;
  }

  onTimeUpdate(callback: () => void): void {
    this.onTimeUpdateCallback = callback;
  }

  offTimeUpdate(): void {
    this.onTimeUpdateCallback = undefined;
  }

  destroy(): void {
    this.destroyed = true;
    this.looping = false;
    this.onLoopCallback = undefined;
    this.onSourcesExhaustedCallback = undefined;
    this.onTimeUpdateCallback = undefined;
    if (this.player) {
      try {
        if (!this.player.isDisposed()) this.player.dispose();
      } catch { /* already disposed */ }
      this.player = undefined;
    }
  }
}
