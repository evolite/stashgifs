/**
 * Visibility Manager
 * Handles video playback based on viewport visibility using Intersection Observer
 */

import type { IVideoPlayer } from './types.js';
import { AudioManager, AudioPriority } from './AudioManager.js';

interface HoverHandlers {
  handleEnter: () => void;
  handleLeave: () => void;
  handleTouchEnter: () => void;
  handleTouchEnd: () => void;
  handleTouchCancel: () => void;
  touchEndTimeout?: ReturnType<typeof setTimeout>;
}

interface PlayerListeners {
  element: HTMLVideoElement;
  handlePlay: () => void;
  handlePause: () => void;
  handlePlaying: () => void;
  handleLoadedData: () => void;
}

interface VisibilityEntry {
  element: HTMLElement;
  player?: IVideoPlayer;
  postId: string;
  isVisible: boolean;
  isUnloaded: boolean;
  hoverHandlers?: HoverHandlers;
  playerListeners?: PlayerListeners;
}

export class VisibilityManager {
  private observer: IntersectionObserver;
  private readonly entries: Map<string, VisibilityEntry>;
  private readonly timers: Map<string, Map<string, ReturnType<typeof setTimeout>>> = new Map(); // Unified timer management
  private debugEnabled: boolean;
  private logger?: (event: string, payload?: Record<string, unknown>) => void;
  private scrollVelocity: number = 0;
  private lastScrollTime: number = 0;
  private lastScrollTop: number = 0;
  private lastScrollEventTime: number = 0;
  private lastAudioFocusUpdate: number = 0;
  private readonly audioManager: AudioManager; // Centralized audio management
  private hoveredPostId?: string; // Track which post is currently hovered/touched
  private touchedPostId?: string; // Track which post is currently touched (separate from hover for mobile)
  private isHDMode: boolean = false; // Track HD mode for more aggressive unloading
  private observerRoot: Element | null;
  private scrollRoot?: HTMLElement | null;
  // Note: manuallyStartedVideos tracking moved to AudioManager for single source of truth
  // Cache for getBoundingClientRect results per frame to avoid layout thrashing
  private readonly rectCache: Map<HTMLElement, DOMRect> = new Map();
  private rectCacheFrame: number = 0;
  private readonly onHoverLoadRequest?: (postId: string) => void; // Callback to trigger video loading on hover
  private readonly onPlaybackStarted?: (postId: string) => void; // Callback when playback starts
  private readonly onPrimaryPostChanged?: (postId: string) => void; // Callback when most-centered post changes
  private lastPrimaryPostId?: string;
  private scrollCleanup?: () => void; // Cleanup function for scroll velocity tracking
  private readonly options: {
    threshold: number;
    rootMargin: string;
    autoPlay: boolean;
    isReelMode?: boolean;
    root?: Element | null;
  };

  constructor(options?: {
    threshold?: number;
    rootMargin?: string;
    autoPlay?: boolean;
    debug?: boolean;
    logger?: (event: string, payload?: Record<string, unknown>) => void;
    onHoverLoadRequest?: (postId: string) => void; // Callback to trigger video loading when hovered before loaded
    onPlaybackStarted?: (postId: string) => void; // Callback when playback starts
    onPrimaryPostChanged?: (postId: string) => void; // Callback when most-centered post changes
    isReelMode?: boolean; // When true, autoplay works without hover requirement
    root?: Element | null; // Optional root for IntersectionObserver and viewport checks
  }) {
    const defaultRootMargin = '0px';

    this.options = {
      threshold: options?.threshold ?? 0, // Only pause when completely out of viewport
      rootMargin: options?.rootMargin ?? defaultRootMargin,
      autoPlay: options?.autoPlay ?? false,
      isReelMode: options?.isReelMode ?? false,
      root: options?.root ?? null,
    };

    this.entries = new Map();
    this.debugEnabled = options?.debug ?? this.detectDebugPreference();
    this.logger = options?.logger;
    this.onHoverLoadRequest = options?.onHoverLoadRequest;
    this.onPlaybackStarted = options?.onPlaybackStarted;
    this.onPrimaryPostChanged = options?.onPrimaryPostChanged;

    // Initialize AudioManager
    this.audioManager = new AudioManager(this.entries, {
      debug: this.debugEnabled,
      logger: this.logger,
      getHoveredPostId: () => this.hoveredPostId,
      getIsReelMode: () => this.options.isReelMode ?? false,
      getViewportRect: () => this.getViewportRect(),
    });

    this.observerRoot = this.options.root ?? null;
    this.scrollRoot = this.observerRoot instanceof HTMLElement ? this.observerRoot : null;
    this.observer = this.createObserver();

    // Track scroll velocity for adaptive hysteresis
    this.setupScrollTracking();
  }

  /**
   * Track scroll velocity to adjust hysteresis delays
   */
  private scrollVelocityRafHandle?: number;
  private scrollTrackingActive: boolean = false;
  private scrollEventTarget?: HTMLElement | Window;
  private scrollEventHandler?: () => void;

  private setupScrollTracking(): void {
    this.scrollTrackingActive = true;
    const requestFrame = globalThis.requestAnimationFrame?.bind(globalThis) ?? ((cb: FrameRequestCallback) => globalThis.setTimeout(cb, 16));
    const cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis) ?? ((id: number) => globalThis.clearTimeout(id));
    const stopLoop = () => {
      if (this.scrollVelocityRafHandle !== undefined) {
        cancelFrame(this.scrollVelocityRafHandle);
        this.scrollVelocityRafHandle = undefined;
      }
    };

    const updateScrollVelocity = () => {
      if (!this.scrollTrackingActive) {
        stopLoop();
        return;
      }

      const now = Date.now();
      const scrollTop = this.getScrollTop();
      const timeDelta = now - this.lastScrollTime;

      if (timeDelta > 0) {
        const scrollDelta = Math.abs(scrollTop - this.lastScrollTop);
        this.scrollVelocity = scrollDelta / timeDelta;
      }

      this.lastScrollTop = scrollTop;
      this.lastScrollTime = now;

      if (now - this.lastAudioFocusUpdate > 120) {
        this.reconcile();
        this.notifyPrimaryPostIfChanged();
        this.lastAudioFocusUpdate = now;
      }

      if (now - this.lastScrollEventTime > 140) {
        this.reconcile();
        this.notifyPrimaryPostIfChanged();
        stopLoop();
        return;
      }

      this.scrollVelocityRafHandle = requestFrame(updateScrollVelocity);
    };

    const handleScroll = () => {
      this.lastScrollEventTime = Date.now();
      if (this.scrollVelocityRafHandle === undefined) {
        this.lastScrollTime = this.lastScrollEventTime;
        this.lastScrollTop = this.getScrollTop();
        this.scrollVelocityRafHandle = requestFrame(updateScrollVelocity);
      }
    };

    this.scrollEventHandler = handleScroll;
    this.updateScrollTrackingTarget();

    this.scrollCleanup = () => {
      this.scrollTrackingActive = false;
      stopLoop();
      if (this.scrollEventTarget && this.scrollEventHandler) {
        this.scrollEventTarget.removeEventListener('scroll', this.scrollEventHandler);
      }
      this.scrollEventTarget = undefined;
      this.scrollEventHandler = undefined;
    };
  }

  private updateScrollTrackingTarget(): void {
    if (!this.scrollEventHandler) {
      return;
    }
    if (this.scrollEventTarget) {
      this.scrollEventTarget.removeEventListener('scroll', this.scrollEventHandler);
    }
    const target = this.scrollRoot ?? globalThis.window;
    if (!target) {
      this.scrollEventTarget = undefined;
      return;
    }
    this.scrollEventTarget = target;
    this.scrollEventTarget.addEventListener('scroll', this.scrollEventHandler, { passive: true });
  }

  private createObserver(): IntersectionObserver {
    return new IntersectionObserver(
      (intersectionEntries) => this.handleIntersection(intersectionEntries),
      {
        threshold: this.options.threshold,
        rootMargin: this.options.rootMargin,
        root: this.observerRoot ?? null,
      }
    );
  }

  private getScrollTop(): number {
    if (this.scrollRoot) {
      return this.scrollRoot.scrollTop;
    }
    return globalThis.window.scrollY || document.documentElement.scrollTop;
  }

  private getViewportRect(): { top: number; left: number; width: number; height: number } {
    if (this.observerRoot) {
      const rect = this.observerRoot.getBoundingClientRect();
      return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
    }
    return { top: 0, left: 0, width: globalThis.window.innerWidth, height: globalThis.window.innerHeight };
  }

  setObserverRoot(root: Element | null): void {
    if (this.observerRoot === root) {
      return;
    }
    this.observerRoot = root;
    this.scrollRoot = root instanceof HTMLElement ? root : null;

    if (this.scrollTrackingActive) {
      this.updateScrollTrackingTarget();
    }

    this.observer.disconnect();
    this.observer = this.createObserver();
    for (const entry of this.entries.values()) {
      this.observer.observe(entry.element);
    }
    this.reconcile();
  }


  private detectDebugPreference(): boolean {
    try {
      const localStorage = globalThis.window?.localStorage;
      if (localStorage !== undefined) {
        return localStorage.getItem('stashgifs-visibility-debug') === '1';
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
    }
    // Debug logging removed - use logger if needed
  }

  /**
   * Unified timer management - set a timer for a post
   */
  private setTimer(postId: string, timerType: 'hoverDebounce' | 'touchEnd', timer: ReturnType<typeof setTimeout>): void {
    let postTimers = this.timers.get(postId);
    if (!postTimers) {
      postTimers = new Map();
      this.timers.set(postId, postTimers);
    }
    // Cancel existing timer of this type if any
    const existing = postTimers.get(timerType);
    if (existing) {
      clearTimeout(existing);
    }
    postTimers.set(timerType, timer);
  }

  /**
   * Cancel a specific timer for a post
   */
  private cancelTimer(postId: string, timerType: 'hoverDebounce' | 'touchEnd'): void {
    const postTimers = this.timers.get(postId);
    if (!postTimers) return;
    
    const timer = postTimers.get(timerType);
    if (timer) {
      clearTimeout(timer);
      postTimers.delete(timerType);
    }
  }

  /**
   * Cancel all timers for a post
   */
  private cancelAllTimers(postId: string): void {
    const postTimers = this.timers.get(postId);
    if (!postTimers) return;
    
    for (const timer of postTimers.values()) {
      clearTimeout(timer);
    }
    this.timers.delete(postId);
  }

  private cancelHoverPlayDebounce(postId: string): void {
    this.cancelTimer(postId, 'hoverDebounce');
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
      isUnloaded: false,
    });

    // Set up hover/touch handlers for unmuting
    this.setupHoverHandlers(element, postId);

    this.observer.observe(element);
  }

  /**
   * Register a video player for a post
   */
  registerPlayer(postId: string, player: IVideoPlayer): void {
    const entry = this.entries.get(postId);
    if (!entry) {
      this.debugLog('register-player-missing-entry', { postId });
      return;
    }

    entry.player = player;
    entry.isUnloaded = false;

    // Videos start muted so the browser can autoplay them without a gesture;
    // AudioManager unmutes the audio owner afterward.
    player.setMuted(true);

    // Wire up the AudioManager play/pause listeners.
    this.setupPlayerEventListeners(postId, player);

    // If currently hovered, run the hover action (unmute + ensure playing) now
    // that the player exists.
    if (this.hoveredPostId === postId) {
      try {
        player.getVideoElement();
        this.executeHoverAction(postId);
      } catch {
        this.debugLog('register-player-hover-deferred', { postId, reason: 'video-element-not-ready' });
      }
    }

    this.debugLog('register-player', { postId });

    // Decide playback now. reconcile() computes visibility from live rects, so the
    // IntersectionObserver not having fired yet is irrelevant.
    this.reconcile();
  }

  /**
   * Get cached or fresh getBoundingClientRect() result (cached per frame to avoid layout thrashing)
   */
  private getCachedRect(element: HTMLElement): DOMRect {
    const currentFrame = performance.now();
    // Clear cache if we're in a new frame (approximate - using 16ms threshold)
    if (currentFrame - this.rectCacheFrame > 16) {
      this.rectCache.clear();
      this.rectCacheFrame = currentFrame;
    }
    
    // Return cached rect if available
    if (this.rectCache.has(element)) {
      return this.rectCache.get(element)!;
    }
    
    // Get fresh rect and cache it
    const rect = element.getBoundingClientRect();
    this.rectCache.set(element, rect);
    return rect;
  }

  /**
   * Check if element is actually visible in viewport using cached getBoundingClientRect()
   */
  private isActuallyInViewport(element: HTMLElement): boolean {
    const rect = this.getCachedRect(element);
    const viewport = this.getViewportRect();
    
    // Element is visible if any part intersects with the actual viewport
    return rect.bottom > viewport.top && 
           rect.top < viewport.top + viewport.height && 
           rect.right > viewport.left && 
           rect.left < viewport.left + viewport.width;
  }

  /**
   * Set HD mode state for more aggressive unloading
   */
  setHDMode(enabled: boolean): void {
    this.isHDMode = !!enabled;
  }

  getAudioManager(): AudioManager {
    return this.audioManager;
  }

  /**
   * Trigger snap playback for a snapped card: force visibility, mark manually
   * started, elevate to hover priority, and request playback.
   * Returns true if an entry was found and playback was attempted.
   */
  triggerSnapPlayback(postId: string, isActuallyVisible: boolean): boolean {
    const entry = this.entries.get(postId);
    if (!entry) return false;

    if (isActuallyVisible && !entry.isVisible) {
      entry.isVisible = true;
      this.audioManager.onVisibilityChange(postId, true);
    }

    this.audioManager.markManuallyStarted(postId);
    this.hoveredPostId = postId;
    this.audioManager.onHoverEnter(postId);

    // The snapped post becomes the hovered target, so reconcile() will play it
    // (and pause/keep others per policy).
    this.reconcile();
    return true;
  }

  /**
   * Grant audio focus to a post at HOVER priority and apply mute state.
   */
  grantSnapAudioFocus(postId: string): void {
    this.audioManager.requestAudioFocus(postId, AudioPriority.HOVER);
    this.audioManager.applyMuteStateToAll();
  }

  /**
   * Set reel mode state to enable autoplay without hover requirement
   */
  setReelMode(enabled: boolean): void {
    this.options.isReelMode = !!enabled;
    // Re-evaluate playback if reel mode is enabled to trigger autoplay
    if (this.options.autoPlay) {
      this.refreshVisibilityAndAutoplay();
    }
  }

  private getMostCenteredVisiblePost(): string | undefined {
    let bestId: string | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    const viewport = this.getViewportRect();
    const viewportCenterY = viewport.top + viewport.height / 2;
    const viewportCenterX = viewport.left + viewport.width / 2;

    for (const [postId, entry] of this.entries) {
      if (!entry.isVisible) continue;
      const rect = this.getCachedRect(entry.element);
      if (rect.bottom < viewport.top || rect.top > viewport.top + viewport.height) continue;
      if (rect.right < viewport.left || rect.left > viewport.left + viewport.width) continue;
      const dy = (rect.top + rect.height / 2) - viewportCenterY;
      const dx = (rect.left + rect.width / 2) - viewportCenterX;
      const distance = Math.hypot(dx, dy);
      if (distance < bestScore) {
        bestScore = distance;
        bestId = postId;
      }
    }
    return bestId;
  }

  private notifyPrimaryPostIfChanged(): void {
    if (!this.onPrimaryPostChanged) return;
    const id = this.getMostCenteredVisiblePost();
    if (id && id !== this.lastPrimaryPostId) {
      this.lastPrimaryPostId = id;
      this.onPrimaryPostChanged(id);
    }
  }

  /**
   * The single play decision. Computes visibility from live rects (the only
   * source of truth — the IntersectionObserver and scroll loop just trigger this),
   * then plays the target set, pauses everything else, and unloads far videos.
   * Idempotent and cheap: it guards on isPlaying()/isManuallyPaused() before acting.
   */
  private reconcile(): void {
    // Refresh visibility from rects; rects always win over a stale observer flag.
    for (const [postId, entry] of this.entries) {
      const nowVisible = this.isActuallyInViewport(entry.element);
      if (nowVisible !== entry.isVisible) {
        entry.isVisible = nowVisible;
        this.audioManager.onVisibilityChange(postId, nowVisible);
        if (!nowVisible) {
          entry.player?.clearManualPause();
        }
      }
    }

    const targets = this.getPlaybackTargets();

    for (const [postId, entry] of this.entries) {
      const player = entry.player;
      if (!player) continue;

      if (targets.has(postId)) {
        if (entry.isUnloaded) {
          player.reload();
          entry.isUnloaded = false;
        }
        if (!player.isPlaying() && !player.isManuallyPaused()) {
          player.play(); // fire-and-forget; element autoplay also covers not-ready
        }
      } else if (player.isPlaying()) {
        player.pause();
      }
    }

    this.audioManager.updateAudioFocus();
    this.unloadFarVideos();
  }

  /**
   * The set of posts that should be playing right now.
   * - Hovered/touched/snapped post always plays (hover has priority).
   * - autoPlay off (HD non-reel): only the hovered post plays.
   * - Otherwise: only the most-centered visible post.
   *
   * Single-video playback is deliberate: each video.js player holds a real media
   * decoder, and browsers/hardware cap concurrent decoders. Playing every visible
   * post at once (two are partly on screen at any time) exceeds that cap and leaves
   * the non-primary video a black frame. One decoder at a time is also lighter.
   */
  private getPlaybackTargets(): Set<string> {
    const targets = new Set<string>();

    if (this.hoveredPostId) {
      const hovered = this.entries.get(this.hoveredPostId);
      if (hovered?.isVisible && hovered.player) {
        targets.add(this.hoveredPostId);
      }
    }

    if (!this.options.autoPlay) {
      return targets;
    }

    const centered = this.getMostCenteredVisiblePost();
    if (centered && this.entries.get(centered)?.player) {
      targets.add(centered);
    }
    return targets;
  }

  /**
   * Unload players that have scrolled far enough from the viewport to free memory.
   */
  private unloadFarVideos(): void {
    for (const [postId, entry] of this.entries) {
      if (entry.isVisible || !entry.player || entry.isUnloaded) {
        continue;
      }
      this.checkAndUnloadVideo(postId, entry);
    }
  }

  /**
   * Set autoplay state
   */
  setAutoPlay(enabled: boolean): void {
    this.options.autoPlay = !!enabled;
    this.reconcile();
  }

  /**
   * Pause all currently playing videos
   */
  pauseAllVideos(): void {
    for (const [, entry] of this.entries.entries()) {
      if (entry.player) {
        try {
          entry.player.pause();
        } catch {
          // Ignore errors when pausing
        }
      }
    }
    this.debugLog('pause-all-videos', { count: this.entries.size });
  }

  /**
   * IntersectionObserver is just a cheap trigger — reconcile() recomputes
   * visibility from live rects and makes all play/pause/unload decisions.
   */
  private handleIntersection(_entries: IntersectionObserverEntry[]): void {
    this.reconcile();
    this.notifyPrimaryPostIfChanged();
  }

  /**
   * Check if video should be unloaded based on distance from viewport
   */
  private checkAndUnloadVideo(postId: string, entry: VisibilityEntry): void {
    if (!entry.player || entry.isUnloaded) {
      return; // No player or already unloaded
    }

    const rect = this.getCachedRect(entry.element);
    const viewport = this.getViewportRect();
    
    // Calculate distance from viewport
    let distanceFromViewport = 0;
    
    // Check if element is above viewport
    if (rect.bottom < viewport.top) {
      distanceFromViewport = viewport.top - rect.bottom;
    }
    // Check if element is below viewport
    else if (rect.top > viewport.top + viewport.height) {
      distanceFromViewport = rect.top - (viewport.top + viewport.height);
    }
    // Check if element is to the left of viewport
    else if (rect.right < viewport.left) {
      distanceFromViewport = viewport.left - rect.right;
    }
    // Check if element is to the right of viewport
    else if (rect.left > viewport.left + viewport.width) {
      distanceFromViewport = rect.left - (viewport.left + viewport.width);
    }
    
    // Keep videos within roughly one screen of the viewport resident so small
    // scrolls don't tear down and re-download a video the user is likely to
    // scroll back to. The FeedContainer count cap remains the hard memory ceiling.
    const unloadThreshold = viewport.height;
    if (distanceFromViewport > unloadThreshold) {
      this.debugLog('unloading-video', { postId, distanceFromViewport, unloadThreshold, isHDMode: this.isHDMode });
      entry.player.unload();
      entry.isUnloaded = true;
    }
  }

  /**
   * Re-evaluate visibility and playback for all posts. Used after layout changes
   * and after a user gesture (which lifts any browser autoplay block).
   */
  refreshVisibilityAndAutoplay(): void {
    this.reconcile();
  }

  /**
   * Recompute playback. A user gesture lifts browser autoplay restrictions, so
   * calling this from a gesture handler unblocks any video the browser refused
   * to autoplay. (Kept as a distinct name for FeedContainer's unlock handler.)
   */
  retryVisibleVideos(): void {
    this.reconcile();
  }

  /**
   * Unobserve a post
   */
  unobservePost(postId: string): void {
    const entry = this.entries.get(postId);
    if (entry) {
      this.cancelAllTimers(postId);

      // Remove hover and player event handlers
      this.removeHoverHandlers(entry);
      this.removePlayerEventListeners(entry);

      // Clear hover state if this was the hovered post
      if (this.hoveredPostId === postId) {
        this.hoveredPostId = undefined;
      }
      if (this.touchedPostId === postId) {
        this.touchedPostId = undefined;
      }
      if (this.lastPrimaryPostId === postId) {
        this.lastPrimaryPostId = undefined;
      }

      this.observer.unobserve(entry.element);
      if (entry.player) {
        entry.player.destroy();
      }
      this.entries.delete(postId);
    }
  }


  /**
   * Cleanup
   */
  cleanup(): void {
    // Cancel all timers
    for (const postId of this.timers.keys()) {
      this.cancelAllTimers(postId);
    }
    
    // Remove all hover and player event handlers
    for (const entry of this.entries.values()) {
      this.removeHoverHandlers(entry);
      this.removePlayerEventListeners(entry);
    }
    
    // Clean up scroll velocity tracking
    if (this.scrollCleanup) {
      this.scrollCleanup();
      this.scrollCleanup = undefined;
    }
    
    this.observer.disconnect();
    for (const entry of this.entries.values()) {
      if (entry.player) {
        entry.player.destroy();
      }
    }
    this.entries.clear();
    this.timers.clear();
    this.rectCache.clear();
    this.hoveredPostId = undefined;
    this.touchedPostId = undefined;
  }

  setDebug(enabled: boolean): void {
    this.debugEnabled = enabled;
  }

  setLogger(logger?: (event: string, payload?: Record<string, unknown>) => void): void {
    this.logger = logger;
  }

  /**
   * Re-evaluate which visible post should have audio focus
   */
  reevaluateAudioFocus(): void {
    this.audioManager.updateAudioFocus();
  }

  /**
   * Optionally focus audio on a specific post id
   */
  focusAudioOn(postId?: string): void {
    if (postId && this.entries.has(postId)) {
      // Request audio focus with MANUAL priority
      this.audioManager.requestAudioFocus(postId, AudioPriority.MANUAL);
    } else {
      this.audioManager.updateAudioFocus();
    }
  }

  /**
   * Clear touch timeout for a post
   */
  private clearTouchTimeout(postId: string, entry: VisibilityEntry): void {
    this.cancelTimer(postId, 'touchEnd');
    if (entry.hoverHandlers?.touchEndTimeout) {
      clearTimeout(entry.hoverHandlers.touchEndTimeout);
      entry.hoverHandlers.touchEndTimeout = undefined;
    }
  }

  /**
   * Restore visual feedback after touch
   */
  private restoreVisualFeedback(entry: VisibilityEntry): void {
    if (entry.element) {
      entry.element.style.transition = 'opacity 0.2s ease-out';
      entry.element.style.opacity = '1';
    }
  }

  /**
   * Schedule cleanup of touch state after delay
   */
  private scheduleTouchEndCleanup(postId: string, entry: VisibilityEntry, handleLeave: () => void): void {
    const isManuallyPaused = entry.player?.isManuallyPaused() ?? false;
    const timeoutDuration = isManuallyPaused || entry.player?.isPlaying() ? 500 : 100;
    
    const timeout = setTimeout(() => {
      this.cancelTimer(postId, 'touchEnd');
      this.cleanupTouchState(postId, entry, handleLeave);
    }, timeoutDuration);

    this.setTimer(postId, 'touchEnd', timeout);
    if (entry.hoverHandlers) {
      entry.hoverHandlers.touchEndTimeout = timeout;
    }
  }

  /**
   * Clean up touch state after delay
   */
  private cleanupTouchState(postId: string, entry: VisibilityEntry, handleLeave: () => void): void {
    if (this.touchedPostId === postId) {
      this.touchedPostId = undefined;
    }
    
    const stillManuallyPaused = entry.player?.isManuallyPaused() ?? false;
    if (stillManuallyPaused) {
      // Keep hoveredPostId if manually paused and still visible
      if (this.hoveredPostId === postId && !entry.isVisible) {
        handleLeave();
      }
      if (entry.hoverHandlers) {
        entry.hoverHandlers.touchEndTimeout = undefined;
      }
      return;
    }
    
    // Clear hover state based on visibility
    if (this.hoveredPostId === postId && !entry.isVisible) {
      handleLeave();
    } else if (this.hoveredPostId === postId) {
      this.hoveredPostId = undefined;
    }
    
    if (entry.hoverHandlers) {
      entry.hoverHandlers.touchEndTimeout = undefined;
    }
  }

  /**
   * Remove hover handlers from an entry
   */
  private removeHoverHandlers(entry: VisibilityEntry): void {
    if (!entry.hoverHandlers) {
      return;
    }

    const { handleEnter, handleLeave, handleTouchEnter, handleTouchEnd, handleTouchCancel, touchEndTimeout } = entry.hoverHandlers;

    // Clear touch end timeout if it exists
    if (touchEndTimeout) {
      clearTimeout(touchEndTimeout);
    }

    // Remove mouse event listeners
    entry.element.removeEventListener('mouseenter', handleEnter);
    entry.element.removeEventListener('mouseleave', handleLeave);

    // Remove touch event listeners
    entry.element.removeEventListener('touchstart', handleTouchEnter);
    entry.element.removeEventListener('touchend', handleTouchEnd);
    entry.element.removeEventListener('touchcancel', handleTouchCancel);

    entry.hoverHandlers = undefined;
  }

  /**
   * Set up hover and touch handlers to unmute videos on hover/touch
   */
  private setupHoverHandlers(element: HTMLElement, postId: string): void {
    const entry = this.entries.get(postId);
    if (!entry) {
      return;
    }

    // Remove existing handlers if any (prevent duplicates)
    if (entry.hoverHandlers) {
      this.removeHoverHandlers(entry);
    }

    const handleEnter = () => {
      // Validate element is still in DOM
      if (!entry.element.isConnected) {
        this.hoveredPostId = undefined;
        this.touchedPostId = undefined;
        return;
      }

      this.hoveredPostId = postId;
      // Combined hover action: unmute and play together to avoid race conditions
      this.handleHoverEnter(postId);
    };

    const handleTouchEnter = () => {
      // Validate element is still in DOM
      if (!entry.element.isConnected) {
        this.hoveredPostId = undefined;
        this.touchedPostId = undefined;
        return;
      }

      this.touchedPostId = postId;
      
      // Add visual feedback on touch start (subtle highlight)
      if (entry.element) {
        entry.element.style.transition = 'opacity 0.1s ease-out';
        entry.element.style.opacity = '0.95';
      }
      
      // For quick taps, don't unmute - let NativeVideoPlayer handle play/pause
      // For longer touches (> 250ms), treat as hover and unmute
      // Use a timeout to detect long touch
      const longTouchTimeout = setTimeout(() => {
        // This is a long touch (> 250ms) - treat as hover and unmute
        if (this.touchedPostId === postId) {
          this.hoveredPostId = postId;
          this.handleHoverEnter(postId);
        }
      }, 250);
      
      // Store timeout for cleanup
      if (entry.hoverHandlers) {
        entry.hoverHandlers.touchEndTimeout = longTouchTimeout;
      }
    };
    
    const handleLeave = () => {
      if (this.hoveredPostId === postId) {
        this.hoveredPostId = undefined;
        this.muteOnHoverLeave(postId);
        // Pause video on hover end (if not manually started) - only in HD mode
        if (this.isHDMode) {
          this.pauseOnHoverLeave(postId);
        }
      }
    };

    const handleTouchEnd = () => {
      this.clearTouchTimeout(postId, entry);
      this.restoreVisualFeedback(entry);
      this.scheduleTouchEndCleanup(postId, entry, handleLeave);
    };

    const handleTouchCancel = () => {
      this.clearTouchTimeout(postId, entry);
      this.restoreVisualFeedback(entry);
      
      if (this.touchedPostId === postId) {
        this.touchedPostId = undefined;
      }
      
      // On touch cancel, only pause if video is no longer visible
      if (this.hoveredPostId === postId && !entry.isVisible) {
        handleLeave();
      } else if (this.hoveredPostId === postId) {
        this.hoveredPostId = undefined;
      }
    };
    
    // Desktop: use mouse events
    element.addEventListener('mouseenter', handleEnter);
    element.addEventListener('mouseleave', handleLeave);
    
    // Mobile: use touch events
    element.addEventListener('touchstart', handleTouchEnter, { passive: true });
    element.addEventListener('touchend', handleTouchEnd, { passive: true });
    
    // Also handle touch cancel (with same delay behavior for consistency)
    element.addEventListener('touchcancel', handleTouchCancel, { passive: true });

    // Store handlers for cleanup
    entry.hoverHandlers = {
      handleEnter,
      handleLeave,
      handleTouchEnter,
      handleTouchEnd,
      handleTouchCancel,
    };
  }

  /**
   * Combined hover enter handler: handles both unmuting and playing to avoid race conditions
   * This ensures audio and playback are coordinated properly
   */
  private handleHoverEnter(postId: string): void {
    // Cancel any existing debounce timer
    this.cancelHoverPlayDebounce(postId);

    // Validate hover state matches DOM
    const entry = this.entries.get(postId);
    if (!entry) {
      return;
    }

    // Clear stale hover state if element is no longer in DOM
    if (!entry.element.isConnected) {
      if (this.hoveredPostId === postId) {
        this.hoveredPostId = undefined;
      }
      if (this.touchedPostId === postId) {
        this.touchedPostId = undefined;
      }
      return;
    }

    // Debounce rapid hover events (50ms debounce) to coordinate both actions
    const debounceTimer = setTimeout(() => {
      this.cancelTimer(postId, 'hoverDebounce');
      this.executeHoverAction(postId);
    }, 50);

    this.setTimer(postId, 'hoverDebounce', debounceTimer);
  }

  /**
   * Execute the combined hover enter action (unmute + play)
   */
  private executeHoverAction(postId: string): void {
    const entry = this.validateHoverEntry(postId);
    if (!entry) {
      return;
    }

    if (!this.isHDMode) {
      // For non-HD videos, request audio focus on hover
      // Videos are already playing via autoplay, so we can request audio immediately
      if (entry.player) {
        this.audioManager.onHoverEnter(postId);
      }
      return;
    }

    // HD mode: pause others, play this
    this.pauseOtherVideosOnHover(postId);
    this.playAndUnmuteOnHover(postId, entry);
  }

  /**
   * Validate hover entry and player
   */
  private validateHoverEntry(postId: string): VisibilityEntry | undefined {
    // Verify still hovered
    if (this.hoveredPostId !== postId) {
      return undefined;
    }

    const entry = this.entries.get(postId);
    if (!entry) {
      return undefined;
    }

    // Validate element is still in DOM
    if (!entry.element.isConnected) {
      this.hoveredPostId = undefined;
      return undefined;
    }

    // Check if player has a valid video element before proceeding
    if (entry.player) {
      try {
        const videoElement = entry.player.getVideoElement();
        if (!videoElement) {
          // Player doesn't have video element yet, skip hover actions
          return undefined;
        }
      } catch {
        // Player doesn't have video element yet, skip hover actions
        return undefined;
      }
    } else {
      // No player yet, skip hover actions
      return undefined;
    }

    return entry;
  }



  /**
   * Pause all other playing videos on hover
   */
  private pauseOtherVideosOnHover(postId: string): void {
    for (const [otherPostId, otherEntry] of this.entries) {
      if (otherPostId !== postId && otherEntry.player) {
        try {
          // Check if other player has video element and is playing
          otherEntry.player.getVideoElement();
          if (otherEntry.player.isPlaying()) {
            // Don't pause manually started videos - check via AudioManager
            const isManual = this.audioManager.isManuallyStarted(otherPostId);
            if (!isManual) {
              otherEntry.player.pause();
              this.debugLog('hover-pause-other', { pausedId: otherPostId, hoveredId: postId });
            }
          }
        } catch {
          // Player doesn't have video element yet, skip
          continue;
        }
      }
    }
  }

  /**
   * Play and unmute video on hover
   */
  private playAndUnmuteOnHover(postId: string, entry: VisibilityEntry): void {
    // Play first while muted (browsers allow muted autoplay)
    // Then handle unmuting based on global mute setting after play succeeds
    this.executePlayOnHover(postId).then(() => {
      this.handleHoverPlaySuccess(postId, entry);
    }).catch((error: unknown) => {
      this.handleHoverPlayError(postId, entry, error);
    });
  }

  /**
   * Handle successful hover play
   */
  private handleHoverPlaySuccess(postId: string, entry: VisibilityEntry): void {
    // After play succeeds, notify AudioManager of hover
    // AudioManager will handle audio focus and muting
    if (entry.player && this.hoveredPostId === postId) {
      // Video is now playing, so AudioManager can grant audio focus
      this.audioManager.onHoverEnter(postId);
    }
  }

  /**
   * Handle hover play error. play() is fire-and-forget so this rarely fires;
   * VideoPost handles real load failures via its own error checking.
   */
  private handleHoverPlayError(postId: string, _entry: VisibilityEntry, error: unknown): void {
    this.debugLog('hover-play-failed', { postId, error });
  }

  /**
   * Mute the video when hover/touch leaves and re-apply audio focus
   */
  private muteOnHoverLeave(postId: string): void {
    // Notify AudioManager of hover leave
    this.audioManager.onHoverLeave(postId);
  }


  /**
   * Execute the actual play on hover logic
   * Returns a Promise that resolves when play succeeds, rejects on failure
   */
  private executePlayOnHover(postId: string): Promise<void> {
    if (this.hoveredPostId !== postId) {
      return Promise.reject(new Error('Not hovered'));
    }

    const entry = this.entries.get(postId);
    if (!entry) {
      return Promise.reject(new Error('Entry not found'));
    }

    if (!entry.element.isConnected) {
      this.hoveredPostId = undefined;
      return Promise.reject(new Error('Element not in DOM'));
    }

    if (!entry.player) {
      // Player not created yet — trigger loading; reconcile() will play it once registered.
      if (this.onHoverLoadRequest) {
        this.onHoverLoadRequest(postId);
      }
      return Promise.reject(new Error('Player not ready'));
    }

    if (entry.isUnloaded) {
      entry.player.reload();
      entry.isUnloaded = false;
    }

    // play() is fire-and-forget (never rejects); the element handles buffering.
    return entry.player.play();
  }

  /**
   * Pause video on hover leave (if not manually started)
   * Hover has priority over viewport-based autoplay, so always pause on hover leave
   */
  private pauseOnHoverLeave(postId: string): void {
    // In non-HD mode, skip hover pause - let autoplay handle playback
    if (!this.isHDMode) {
      return;
    }

    const entry = this.entries.get(postId);
    if (!entry?.player) {
      return;
    }

    // Don't pause if video was manually started by user - check via AudioManager
    const isManual = this.audioManager.isManuallyStarted(postId);
    if (isManual) {
      return;
    }

    // Always pause on hover leave - hover has priority over viewport visibility
    // This ensures hover has full control over playback
    try {
      entry.player.pause();
      this.debugLog('hover-leave-pause', { postId, wasVisible: entry.isVisible });
    } catch {
      // Ignore pause errors
    }
  }

  /**
   * Remove stored play/pause/playing listeners from a post's video element.
   */
  private removePlayerEventListeners(entry: VisibilityEntry): void {
    const pl = entry.playerListeners;
    if (!pl) return;
    pl.element.removeEventListener('play', pl.handlePlay);
    pl.element.removeEventListener('pause', pl.handlePause);
    pl.element.removeEventListener('playing', pl.handlePlaying);
    pl.element.removeEventListener('loadeddata', pl.handleLoadedData);
    entry.playerListeners = undefined;
  }

  /**
   * Setup play/pause event listeners for AudioManager
   */
  private setupPlayerEventListeners(postId: string, player: IVideoPlayer): void {
    const entry = this.entries.get(postId);
    if (!entry) return;

    // Remove any listeners from a previous player registration (e.g. HQ upgrade)
    this.removePlayerEventListeners(entry);

    try {
      const videoElement = player.getVideoElement();

      const handlePlay = () => {
        const isManual = this.audioManager.isManuallyStarted(postId);
        this.audioManager.onVideoPlay(postId, isManual);
        if (this.onPlaybackStarted) {
          this.onPlaybackStarted(postId);
        }
      };

      const handlePause = () => {
        this.audioManager.onVideoPause(postId);
      };

      // Re-run the play decision once this video actually has data. On a cold load
      // the initial play() (from registerPlayer's reconcile) can fire before the
      // media is ready and get dropped; nothing else re-triggers it until the user
      // scrolls/taps. This makes the centered video start as soon as it can.
      const handleLoadedData = () => {
        this.reconcile();
      };

      // 'playing' fires when frames actually start rendering — important on mobile
      // where isPlaying() may still return false immediately after play() resolves.
      const handlePlaying = () => {
        this.audioManager.applyMuteStateToAll();
        const currentOwner = this.audioManager.getCurrentAudioOwner();
        if (currentOwner !== postId && player.isPlaying()) {
          const isManual = this.audioManager.isManuallyStarted(postId);
          const priority = isManual ? AudioPriority.MANUAL : AudioPriority.CENTER;
          this.audioManager.requestAudioFocus(postId, priority);
          this.audioManager.applyMuteStateToAll();
        }
      };

      videoElement.addEventListener('play', handlePlay);
      videoElement.addEventListener('pause', handlePause);
      videoElement.addEventListener('playing', handlePlaying);
      videoElement.addEventListener('loadeddata', handleLoadedData);

      entry.playerListeners = { element: videoElement, handlePlay, handlePause, handlePlaying, handleLoadedData };
    } catch {
      // Player doesn't have a video element yet; will be set up when ready
    }
  }
}
