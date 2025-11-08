/**
 * Visibility Manager
 * Handles video playback based on viewport visibility using Intersection Observer
 */

import { NativeVideoPlayer } from './NativeVideoPlayer.js';

interface VisibilityEntry {
  element: HTMLElement;
  player?: NativeVideoPlayer;
  postId: string;
  isVisible: boolean;
  pendingVisibilityPlay: boolean;
}

type VideoState = 'loading' | 'ready' | 'playing' | 'paused';
type PlaybackOrigin = 'observer' | 'ready' | 'register' | 'retry';

export class VisibilityManager {
  private observer: IntersectionObserver;
  private entries: Map<string, VisibilityEntry>;
  private activeVideos: Set<string>;
  private videoStates: Map<string, VideoState>;
  private pendingOperations: Map<string, ReturnType<typeof setTimeout>>;
  private visibilityStability: Map<string, number>; // timestamp when visibility last changed
  private playbackRetryHandles: Map<string, ReturnType<typeof setTimeout>>;
  private debugEnabled: boolean;
  private logger?: (event: string, payload?: Record<string, unknown>) => void;
  private scrollVelocity: number = 0;
  private lastScrollTime: number = 0;
  private lastScrollTop: number = 0;
  private options: {
    threshold: number;
    rootMargin: string;
    autoPlay: boolean;
    maxConcurrent: number;
  };

  constructor(options?: {
    threshold?: number;
    rootMargin?: string;
    autoPlay?: boolean;
    maxConcurrent?: number;
    debug?: boolean;
    logger?: (event: string, payload?: Record<string, unknown>) => void;
  }) {
    // On mobile, use larger rootMargin to start playing videos earlier
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    // Much larger rootMargin on mobile - start autoplay much earlier to account for slower networks
    const defaultRootMargin = isMobile ? '800px' : '300px';
    
    this.options = {
      threshold: options?.threshold ?? (isMobile ? 0.1 : 0.2), // Even lower threshold on mobile - start at 10% visible
      rootMargin: options?.rootMargin ?? defaultRootMargin,
      autoPlay: options?.autoPlay ?? false,
      maxConcurrent: options?.maxConcurrent ?? 3,
    };

    this.entries = new Map();
    this.activeVideos = new Set();
    this.videoStates = new Map();
    this.pendingOperations = new Map();
    this.visibilityStability = new Map();
    this.playbackRetryHandles = new Map();
    this.debugEnabled = options?.debug ?? this.detectDebugPreference();
    this.logger = options?.logger;

    this.observer = new IntersectionObserver(
      (intersectionEntries) => this.handleIntersection(intersectionEntries),
      {
        threshold: this.options.threshold,
        rootMargin: this.options.rootMargin,
      }
    );

    // Track scroll velocity for adaptive hysteresis
    this.setupScrollTracking();
  }

  /**
   * Track scroll velocity to adjust hysteresis delays
   */
  private setupScrollTracking(): void {
    const updateScrollVelocity = () => {
      const now = Date.now();
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const timeDelta = now - this.lastScrollTime;
      
      if (timeDelta > 0) {
        const scrollDelta = Math.abs(scrollTop - this.lastScrollTop);
        this.scrollVelocity = scrollDelta / timeDelta; // pixels per ms
      }
      
      this.lastScrollTop = scrollTop;
      this.lastScrollTime = now;
      
      requestAnimationFrame(updateScrollVelocity);
    };
    
    this.lastScrollTime = Date.now();
    this.lastScrollTop = window.scrollY || document.documentElement.scrollTop;
    updateScrollVelocity();
  }

  private detectDebugPreference(): boolean {
    try {
      if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
        return window.localStorage.getItem('stashgifs-visibility-debug') === '1';
      }
    } catch (error) {
      // Ignore storage access errors (e.g., Safari private mode)
      this.logger?.('debug-pref-error', { error: String(error) });
    }
    return false;
  }

  private debugLog(event: string, payload?: Record<string, unknown>): void {
    if (!this.debugEnabled) {
      return;
    }
    if (this.logger) {
      this.logger(event, payload ?? {});
    } else if (typeof console !== 'undefined' && console.debug) {
      console.debug('[VisibilityManager]', event, payload ?? {});
    }
  }

  /**
   * Cancel pending operation for a post
   */
  private cancelPendingOperation(postId: string): void {
    const timeoutId = this.pendingOperations.get(postId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.pendingOperations.delete(postId);
    }
  }

  private cancelPlaybackRetry(postId: string): void {
    const retryHandle = this.playbackRetryHandles.get(postId);
    if (retryHandle) {
      clearTimeout(retryHandle);
      this.playbackRetryHandles.delete(postId);
    }
  }

  /**
   * Observe a post element
   */
  observePost(element: HTMLElement, postId: string): void {
    if (this.entries.has(postId)) {
      return;
    }

    this.entries.set(postId, {
      element,
      postId,
      isVisible: false,
      pendingVisibilityPlay: false,
    });

    this.observer.observe(element);
  }

  /**
   * Register a video player for a post
   */
  registerPlayer(postId: string, player: NativeVideoPlayer): void {
    const entry = this.entries.get(postId);
    if (!entry) {
      this.debugLog('register-player-missing-entry', { postId });
      return;
    }

    entry.player = player;
    entry.pendingVisibilityPlay = entry.isVisible;
    this.videoStates.set(postId, 'loading');
    this.cancelPlaybackRetry(postId);

    player.setStateChangeListener((state) => {
      if (state.isPlaying) {
        this.videoStates.set(postId, 'playing');
        this.touchActive(postId);
        this.debugLog('state-playing', { postId });
      } else {
        this.videoStates.set(postId, 'paused');
        this.activeVideos.delete(postId);
        this.debugLog('state-paused', { postId });
      }
    });

    this.debugLog('register-player', { postId, visible: entry.isVisible });
    this.waitForPlayerReady(postId, player);

    if (entry.isVisible && this.options.autoPlay) {
      this.requestPlaybackIfReady(postId, entry, 'register');
    }
  }

  /**
   * Wait for player to be ready before allowing play attempts
   */
  private async waitForPlayerReady(postId: string, player: NativeVideoPlayer): Promise<void> {
    try {
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      const timeout = isMobile ? 500 : 2000;
      await player.waitUntilCanPlay(timeout);
      this.videoStates.set(postId, 'ready');
      this.debugLog('player-ready', { postId });
    } catch (error) {
      // Player might not be ready yet, but mark as ready anyway
      // Visibility manager will handle retries
      this.videoStates.set(postId, 'ready');
      this.debugLog('player-ready-timeout', { postId, error });
    }

    const entry = this.entries.get(postId);
    if (entry && entry.isVisible && this.options.autoPlay) {
      this.requestPlaybackIfReady(postId, entry, 'ready');
    }
  }

  private computeVisibilityDelay(isEntering: boolean): number {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const baseEnter = isMobile ? 40 : 60;
    const baseExit = isMobile ? 140 : 180;
    const base = isEntering ? baseEnter : baseExit;
    const multiplier = 1 + Math.min(this.scrollVelocity * 8, 2);
    return Math.round(base * multiplier);
  }

  /**
   * Handle intersection changes with hysteresis to prevent rapid toggling
   */
  private handleIntersection(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const postId = this.findPostId(entry.target as HTMLElement);
      if (!postId) continue;

      const visibilityEntry = this.entries.get(postId);
      if (!visibilityEntry) continue;

      const wasVisible = visibilityEntry.isVisible;
      const isVisible = entry.isIntersecting && entry.intersectionRatio >= this.options.threshold;

      if (isVisible === wasVisible) {
        continue;
      }

      visibilityEntry.isVisible = isVisible;
      visibilityEntry.pendingVisibilityPlay = isVisible && this.options.autoPlay;

      this.cancelPendingOperation(postId);
      this.cancelPlaybackRetry(postId);

      this.visibilityStability.set(postId, Date.now());
      const delay = this.computeVisibilityDelay(isVisible);

      const timeoutId = setTimeout(() => {
        this.pendingOperations.delete(postId);
        const currentEntry = this.entries.get(postId);
        if (!currentEntry) {
          return;
        }

        if (isVisible) {
          if (!currentEntry.isVisible) {
            return;
          }
          this.requestPlaybackIfReady(postId, currentEntry, 'observer');
        } else {
          if (currentEntry.isVisible) {
            return;
          }
          this.handlePostExitedViewport(postId, currentEntry);
        }
      }, delay);

      this.pendingOperations.set(postId, timeoutId);
      this.debugLog('visibility-change', { postId, isVisible, delay });
    }
  }

  private findPostId(element: HTMLElement): string | null {
    // Traverse up to find the post container
    let current: HTMLElement | null = element;
    while (current) {
      if (current.dataset.postId) {
        return current.dataset.postId;
      }
      current = current.parentElement;
    }
    return null;
  }

  private handlePostEnteredViewport(postId: string, entry: VisibilityEntry): void {
    this.requestPlaybackIfReady(postId, entry, 'observer');
  }

  private handlePostExitedViewport(postId: string, entry: VisibilityEntry): void {
    // Double-check visibility hasn't changed back
    const currentEntry = this.entries.get(postId);
    if (currentEntry && currentEntry.isVisible) {
      return; // Visibility changed back, don't pause
    }
    this.debugLog('visibility-exit', { postId });
    entry.pendingVisibilityPlay = false;
    this.pauseVideo(postId);
  }

  private pauseVideo(postId: string): void {
    const entry = this.entries.get(postId);
    if (!entry) {
      return;
    }

    this.cancelPlaybackRetry(postId);
    entry.pendingVisibilityPlay = false;

    if (entry.player) {
      entry.player.pause();
    }

    this.activeVideos.delete(postId);
    this.videoStates.set(postId, 'paused');
    this.debugLog('pause-video', { postId });
  }

  private requestPlaybackIfReady(postId: string, entry: VisibilityEntry, origin: PlaybackOrigin): void {
    const currentEntry = this.entries.get(postId) ?? entry;

    if (!currentEntry.isVisible) {
      this.debugLog('play-abort-not-visible', { postId, origin });
      return;
    }

    if (!currentEntry.player) {
      currentEntry.pendingVisibilityPlay = true;
      this.debugLog('play-deferred-no-player', { postId, origin });
      return;
    }

    const state = this.videoStates.get(postId);
    if (state === 'loading' || state === undefined) {
      currentEntry.pendingVisibilityPlay = true;
      this.debugLog('play-deferred-loading', { postId, origin, state });
      return;
    }

    if (currentEntry.player.isPlaying()) {
      this.touchActive(postId);
      this.videoStates.set(postId, 'playing');
      this.debugLog('play-already-active', { postId, origin });
      return;
    }

    currentEntry.pendingVisibilityPlay = false;
    this.startPlaybackSequence(postId, origin, 1);
  }

  private startPlaybackSequence(postId: string, origin: PlaybackOrigin, attempt: number): void {
    const entry = this.entries.get(postId);
    if (!entry || !entry.player) {
      return;
    }

    if (!entry.isVisible) {
      this.debugLog('play-abort-not-visible', { postId, origin, attempt });
      return;
    }

    if (!this.options.autoPlay) {
      this.debugLog('play-skipped-autoplay-disabled', { postId, origin });
      return;
    }

    this.enforceConcurrency(postId);

    const player = entry.player;
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const timeout = isMobile ? 250 : 1500;

    const perform = async (): Promise<void> => {
      try {
        await player.waitUntilCanPlay(timeout);
        if (!entry.isVisible) {
          return;
        }

        this.cancelPlaybackRetry(postId);
        await player.play();
        this.touchActive(postId);
        this.videoStates.set(postId, 'playing');
        this.debugLog('play-success', { postId, origin, attempt });
      } catch (error) {
        this.debugLog('play-failed', { postId, origin, attempt, error });
        if (!entry.isVisible) {
          return;
        }

        if (attempt >= 5) {
          this.videoStates.set(postId, 'paused');
          return;
        }

        const delay = this.computeRetryDelay(isMobile, attempt);
        this.schedulePlaybackRetry(postId, attempt + 1, delay);
      }
    };

    perform().catch(() => {});
  }

  private computeRetryDelay(isMobile: boolean, attempt: number): number {
    const base = isMobile ? 120 : 220;
    const maxDelay = isMobile ? 1000 : 2000;
    return Math.min(base * Math.pow(2, attempt - 1), maxDelay);
  }

  private schedulePlaybackRetry(postId: string, nextAttempt: number, delay: number): void {
    this.cancelPlaybackRetry(postId);
    const entry = this.entries.get(postId);
    if (entry) {
      entry.pendingVisibilityPlay = true;
    }
    const handle = setTimeout(() => {
      this.playbackRetryHandles.delete(postId);
      const entry = this.entries.get(postId);
      if (!entry || !entry.isVisible) {
        return;
      }
      this.startPlaybackSequence(postId, 'retry', nextAttempt);
    }, delay);
    this.playbackRetryHandles.set(postId, handle);
    this.debugLog('play-retry-scheduled', { postId, nextAttempt, delay });
  }

  private enforceConcurrency(postId: string): void {
    if (this.activeVideos.has(postId)) {
      this.touchActive(postId);
      return;
    }

    if (this.activeVideos.size < this.options.maxConcurrent) {
      return;
    }

    const active = Array.from(this.activeVideos);
    let candidate = active.find((id) => {
      if (id === postId) return false;
      const entry = this.entries.get(id);
      return entry ? !entry.isVisible : true;
    });

    if (!candidate) {
      candidate = active.find((id) => id !== postId);
    }

    if (candidate) {
      this.debugLog('concurrency-evict', { pausedId: candidate, incoming: postId });
      this.pauseVideo(candidate);
    }
  }

  private touchActive(postId: string): void {
    if (this.activeVideos.has(postId)) {
      this.activeVideos.delete(postId);
    }
    this.activeVideos.add(postId);
  }

  /**
   * Unobserve a post
   */
  unobservePost(postId: string): void {
    const entry = this.entries.get(postId);
    if (entry) {
      this.cancelPendingOperation(postId);
      this.cancelPlaybackRetry(postId);
      this.observer.unobserve(entry.element);
      if (entry.player) {
        entry.player.destroy();
      }
      this.entries.delete(postId);
      this.activeVideos.delete(postId);
      this.videoStates.delete(postId);
      this.visibilityStability.delete(postId);
    }
  }

  /**
   * Retry playing all currently visible videos
   * Useful for unlocking autoplay on mobile after user interaction
   */
  retryVisibleVideos(): void {
    for (const [postId, entry] of this.entries.entries()) {
      if (!entry.isVisible || !entry.player) {
        continue;
      }

      const state = this.videoStates.get(postId);
      if (state === 'loading') {
        continue;
      }

      entry.pendingVisibilityPlay = true;
      this.requestPlaybackIfReady(postId, entry, 'retry');
    }
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    // Cancel all pending operations
    for (const timeoutId of this.pendingOperations.values()) {
      clearTimeout(timeoutId);
    }
    for (const retryId of this.playbackRetryHandles.values()) {
      clearTimeout(retryId);
    }
    
    this.observer.disconnect();
    for (const entry of this.entries.values()) {
      if (entry.player) {
        entry.player.destroy();
      }
    }
    this.entries.clear();
    this.activeVideos.clear();
    this.videoStates.clear();
    this.pendingOperations.clear();
    this.visibilityStability.clear();
    this.playbackRetryHandles.clear();
  }

  setDebug(enabled: boolean): void {
    this.debugEnabled = enabled;
  }

  setLogger(logger?: (event: string, payload?: Record<string, unknown>) => void): void {
    this.logger = logger;
  }
}

