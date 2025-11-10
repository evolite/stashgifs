/**
 * Visibility Manager
 * Handles video playback based on viewport visibility using Intersection Observer
 */

import { NativeVideoPlayer } from './NativeVideoPlayer.js';

interface HoverHandlers {
  handleEnter: () => void;
  handleLeave: () => void;
  handleTouchEnter: () => void;
  handleTouchEnd: () => void;
  handleTouchCancel: () => void;
  touchEndTimeout?: ReturnType<typeof setTimeout>;
}

interface VisibilityEntry {
  element: HTMLElement;
  player?: NativeVideoPlayer;
  postId: string;
  isVisible: boolean;
  pendingVisibilityPlay: boolean;
  isUnloaded: boolean;
  hoverHandlers?: HoverHandlers;
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
  private readonly isMobileDevice: boolean;
  private exclusiveAudioEnabled: boolean = false;
  private currentAudioPostId?: string;
  private hoveredPostId?: string; // Track which post is currently hovered/touched
  private touchedPostId?: string; // Track which post is currently touched (separate from hover for mobile)
  private isHDMode: boolean = false; // Track HD mode for more aggressive unloading
  private manuallyStartedVideos: Set<string> = new Set(); // Track videos that were manually started by user
  // Cache for getBoundingClientRect results per frame to avoid layout thrashing
  private rectCache: Map<HTMLElement, DOMRect> = new Map();
  private rectCacheFrame: number = 0;
  private onHoverLoadRequest?: (postId: string) => void; // Callback to trigger video loading on hover
  private hoverPlayDebounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map(); // Debounce rapid hover play attempts
  private hoverReloadTimers: Map<string, ReturnType<typeof setTimeout>> = new Map(); // Track reload timeouts
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
    onHoverLoadRequest?: (postId: string) => void; // Callback to trigger video loading when hovered before loaded
  }) {
    // On mobile, use larger rootMargin to start playing videos earlier
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    this.isMobileDevice = isMobile;
    // Playback decisions rely on actual viewport visibility – keep root margin tight
    const defaultRootMargin = '0px';
    
    const requestedMaxConcurrent = options?.maxConcurrent;
    const maxConcurrent =
      requestedMaxConcurrent === undefined
        ? Number.POSITIVE_INFINITY
        : requestedMaxConcurrent <= 0
          ? Number.POSITIVE_INFINITY
          : requestedMaxConcurrent;

    this.options = {
      threshold: options?.threshold ?? 0, // Only pause when completely out of viewport
      rootMargin: options?.rootMargin ?? defaultRootMargin,
      autoPlay: options?.autoPlay ?? false,
      maxConcurrent,
    };

    this.entries = new Map();
    this.activeVideos = new Set();
    this.videoStates = new Map();
    this.pendingOperations = new Map();
    this.visibilityStability = new Map();
    this.playbackRetryHandles = new Map();
    this.debugEnabled = options?.debug ?? this.detectDebugPreference();
    this.logger = options?.logger;
    this.onHoverLoadRequest = options?.onHoverLoadRequest;

    this.observer = new IntersectionObserver(
      (intersectionEntries) => this.handleIntersection(intersectionEntries),
      {
        threshold: this.options.threshold,
        rootMargin: this.options.rootMargin,
      }
    );

    // Track scroll velocity for adaptive hysteresis
    this.setupScrollTracking();
    
    // Set up scroll listener for exclusive audio re-evaluation
    this.setupAudioFocusTracking();
  }

  /**
   * Track scroll velocity to adjust hysteresis delays
   */
  private scrollVelocityRafHandle?: number;
  private scrollTrackingActive: boolean = false;

  private setupScrollTracking(): void {
    this.scrollTrackingActive = true;
    
    const updateScrollVelocity = () => {
      if (!this.scrollTrackingActive) {
        return; // Stop if deactivated
      }
      
      const now = Date.now();
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const timeDelta = now - this.lastScrollTime;
      
      if (timeDelta > 0) {
        const scrollDelta = Math.abs(scrollTop - this.lastScrollTop);
        this.scrollVelocity = scrollDelta / timeDelta; // pixels per ms
      }
      
      this.lastScrollTop = scrollTop;
      this.lastScrollTime = now;
      
      this.scrollVelocityRafHandle = requestAnimationFrame(updateScrollVelocity);
    };
    
    this.lastScrollTime = Date.now();
    this.lastScrollTop = window.scrollY || document.documentElement.scrollTop;
    this.scrollVelocityRafHandle = requestAnimationFrame(updateScrollVelocity);
    
    // Store cleanup function
    (this as any)._scrollCleanup = () => {
      this.scrollTrackingActive = false;
      if (this.scrollVelocityRafHandle !== undefined) {
        cancelAnimationFrame(this.scrollVelocityRafHandle);
        this.scrollVelocityRafHandle = undefined;
      }
    };
  }

  /**
   * Set up scroll and visibility tracking for exclusive audio focus
   */
  private setupAudioFocusTracking(): void {
    if (typeof window === 'undefined') return;
    
    let scrollTimeout: ReturnType<typeof setTimeout> | undefined;
    let lastAudioCheck = 0;
    const AUDIO_CHECK_THROTTLE = 150; // Check audio focus every 150ms during scroll
    
    const checkAudioFocus = () => {
      if (!this.exclusiveAudioEnabled) return;
      const now = Date.now();
      if (now - lastAudioCheck < AUDIO_CHECK_THROTTLE) return;
      lastAudioCheck = now;
      this.applyExclusiveAudioFocus();
    };
    
    // Throttled scroll handler
    const handleScroll = () => {
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }
      scrollTimeout = setTimeout(() => {
        checkAudioFocus();
        scrollTimeout = undefined;
      }, 50); // Debounce to 50ms
    };
    
    // Also check on scroll using requestAnimationFrame for smoother updates
    let rafHandle: number | undefined;
    let audioRafActive: boolean = false;
    
    const rafCheck = () => {
      if (!audioRafActive || !this.exclusiveAudioEnabled) {
        rafHandle = undefined;
        return; // Stop if deactivated or audio disabled
      }
      checkAudioFocus();
      rafHandle = requestAnimationFrame(rafCheck);
    };
    
    // Start RAF-based checking when exclusive audio is enabled
    const startRafCheck = () => {
      if (!rafHandle && this.exclusiveAudioEnabled) {
        audioRafActive = true;
        rafHandle = requestAnimationFrame(rafCheck);
      }
    };
    
    const stopRafCheck = () => {
      audioRafActive = false;
      if (rafHandle !== undefined) {
        cancelAnimationFrame(rafHandle);
        rafHandle = undefined;
      }
    };
    
    window.addEventListener('scroll', handleScroll, { passive: true });
    
    // Store cleanup function
    (this as any)._audioFocusCleanup = () => {
      window.removeEventListener('scroll', handleScroll);
      stopRafCheck();
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }
    };
    
    // Start RAF checking if exclusive audio is already enabled
    if (this.exclusiveAudioEnabled) {
      startRafCheck();
    }
    
    // Override setExclusiveAudio to start/stop RAF checking
    const originalSetExclusiveAudio = this.setExclusiveAudio.bind(this);
    this.setExclusiveAudio = (enabled: boolean) => {
      originalSetExclusiveAudio(enabled);
      if (enabled) {
        startRafCheck();
      } else {
        stopRafCheck();
      }
    };
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

  /**
   * Cancel hover play debounce timer
   */
  private cancelHoverPlayDebounce(postId: string): void {
    const timer = this.hoverPlayDebounceTimers.get(postId);
    if (timer) {
      clearTimeout(timer);
      this.hoverPlayDebounceTimers.delete(postId);
    }
  }

  /**
   * Cancel hover reload timer
   */
  private cancelHoverReloadTimer(postId: string): void {
    const timer = this.hoverReloadTimers.get(postId);
    if (timer) {
      clearTimeout(timer);
      this.hoverReloadTimers.delete(postId);
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
      isUnloaded: false,
    });

    // Set up hover/touch handlers for unmuting
    this.setupHoverHandlers(element, postId);

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
    // Preserve pendingVisibilityPlay if video is currently hovered
    // Don't clear it if user is hovering, as they want to play it
    if (!this.hoveredPostId || this.hoveredPostId !== postId) {
      entry.pendingVisibilityPlay = false;
    }
    this.videoStates.set(postId, 'loading');
    this.cancelPlaybackRetry(postId);

    player.setStateChangeListener((state) => {
      if (state.isPlaying) {
        this.videoStates.set(postId, 'playing');
        this.touchActive(postId);
        this.debugLog('state-playing', { postId });
        // Track if this was a manual play (not from hover)
        // If video is playing but wasn't triggered by hover, mark as manual
        if (!entry.pendingVisibilityPlay && !this.activeVideos.has(postId) && this.hoveredPostId !== postId) {
          this.manuallyStartedVideos.add(postId);
        }
      } else {
        this.videoStates.set(postId, 'paused');
        this.activeVideos.delete(postId);
        // Remove from manually started set when paused
        this.manuallyStartedVideos.delete(postId);
        this.debugLog('state-paused', { postId });
      }
    });

    this.debugLog('register-player', { postId, visible: entry.isVisible });
    this.waitForPlayerReady(postId, player);

    // Ensure video starts muted for autoplay compatibility
    // We'll apply exclusive audio AFTER play succeeds
    player.setMuted(true);
    
    // Autoplay when player is registered if visible and autoplay is enabled
    if (entry.isVisible && this.options.autoPlay) {
      this.requestPlaybackIfReady(postId, entry, 'register');
    }
    
    // If currently hovered, execute hover enter action (unmute + play)
    // Use executeHoverEnter directly since player is being registered now (no debounce needed)
    // But first verify the player has a valid video element
    if (this.hoveredPostId === postId) {
      try {
        // Check if player has video element before calling executeHoverEnter
        player.getVideoElement();
        this.executeHoverEnter(postId);
      } catch {
        // Player doesn't have video element yet, skip hover actions
        // The hover action will be handled when player becomes ready in waitForPlayerReady
        this.debugLog('register-player-hover-deferred', { postId, reason: 'video-element-not-ready' });
      }
    }

    // Apply audio focus if exclusive audio is enabled AND video is already playing
    // Don't apply before autoplay - we'll apply it after play succeeds
    if (this.exclusiveAudioEnabled) {
      const isCurrentlyPlaying = player.isPlaying();
      if (isCurrentlyPlaying) {
        // If video is already playing, apply audio focus
        // Delay slightly to avoid interrupting playback
        setTimeout(() => {
          this.applyExclusiveAudioFocus();
        }, 50);
      }
      // Don't apply audio focus if video is not playing yet - wait for autoplay to succeed
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
    // Check if there's a pending hover play request OR if currently hovered
    // This ensures hover play works even if pendingVisibilityPlay was cleared
    if (entry && (entry.pendingVisibilityPlay || this.hoveredPostId === postId)) {
      // Execute hover enter action (unmute + play) since player is ready now
      // Use executeHoverEnter directly since player is ready (no debounce needed)
      if (this.hoveredPostId === postId) {
        this.executeHoverEnter(postId);
      } else if (entry.pendingVisibilityPlay) {
        // If not hovered but pending, check if we should use autoplay or hover-based play
        // In non-HD mode (autoplay enabled), use autoplay instead of hover-based play
        if (this.options.autoPlay && entry.isVisible) {
          // Use autoplay for non-HD mode when visible
          this.requestPlaybackIfReady(postId, entry, 'ready');
        } else {
          // Only use hover-based play if actually hovered (shouldn't reach here if not hovered)
          // This is a fallback for edge cases
          if (this.hoveredPostId === postId) {
            this.executePlayOnHover(postId);
          }
        }
      }
    }
    // Also handle autoplay if enabled and visible (for non-HD mode)
    if (entry && entry.isVisible && this.options.autoPlay && !entry.pendingVisibilityPlay && this.hoveredPostId !== postId) {
      this.requestPlaybackIfReady(postId, entry, 'ready');
    }
  }

  private computeVisibilityDelay(isEntering: boolean): number {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const baseEnter = isMobile ? 40 : 60;
    const baseExit = isMobile ? 200 : 250; // Increased exit delay for more consistent pausing
    const base = isEntering ? baseEnter : baseExit;
    const multiplier = 1 + Math.min(this.scrollVelocity * 8, 2);
    return Math.round(base * multiplier);
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
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    
    // Element is visible if any part intersects with the actual viewport
    return rect.bottom > 0 && 
           rect.top < viewportHeight && 
           rect.right > 0 && 
           rect.left < viewportWidth;
  }

  /**
   * Set HD mode state for more aggressive unloading
   */
  setHDMode(enabled: boolean): void {
    this.isHDMode = !!enabled;
  }

  /**
   * Set autoplay state
   */
  setAutoPlay(enabled: boolean): void {
    this.options.autoPlay = !!enabled;
  }

  /**
   * Pause all currently playing videos
   */
  pauseAllVideos(): void {
    for (const [postId, entry] of this.entries.entries()) {
      if (entry.player) {
        try {
          entry.player.pause();
          this.videoStates.set(postId, 'paused');
          this.activeVideos.delete(postId);
          this.cancelPlaybackRetry(postId);
          entry.pendingVisibilityPlay = false;
        } catch (error) {
          // Ignore errors when pausing
        }
      }
    }
    this.debugLog('pause-all-videos', { count: this.entries.size });
  }

  /**
   * Handle intersection state transitions with hysteresis to prevent rapid toggling.
   * Playback decisions rely on true viewport visibility — the entry must intersect,
   * meet the configured threshold, and overlap with the actual viewport rectangle.
   */
  private handleIntersection(entries: IntersectionObserverEntry[]): void {
    let visibilityChanged = false;
    
    for (const entry of entries) {
      const postId = this.findPostId(entry.target as HTMLElement);
      if (!postId) continue;

      const visibilityEntry = this.entries.get(postId);
      if (!visibilityEntry) continue;

      const wasVisible = visibilityEntry.isVisible;
      const element = visibilityEntry.element;
      
      // For playing: use expanded area (with rootMargin) to start early
      const meetsThreshold = entry.intersectionRatio >= this.options.threshold;
      const isActuallyVisible = this.isActuallyInViewport(element);
      const isVisible = entry.isIntersecting && meetsThreshold && isActuallyVisible;

      if (isVisible === wasVisible) {
        continue;
      }

      visibilityChanged = true;
      visibilityEntry.isVisible = isVisible;
      // Set pendingVisibilityPlay based on visibility if autoplay is enabled
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
          const stillInViewport = this.isActuallyInViewport(currentEntry.element);
          if (!currentEntry.isVisible || !stillInViewport) {
            currentEntry.isVisible = stillInViewport;
            return;
          }
          // Autoplay when entering viewport (if enabled)
          if (this.options.autoPlay) {
            this.requestPlaybackIfReady(postId, currentEntry, 'observer');
          }
        } else {
          const stillActuallyVisible = this.isActuallyInViewport(currentEntry.element);
          if (stillActuallyVisible) {
            currentEntry.isVisible = true;
            // Autoplay when re-entering viewport (if enabled)
            if (this.options.autoPlay) {
              this.requestPlaybackIfReady(postId, currentEntry, 'observer');
            }
            return;
          }
          if (currentEntry.isVisible) {
            return;
          }
          this.handlePostExitedViewport(postId, currentEntry);
        }
      }, delay);

      this.pendingOperations.set(postId, timeoutId);
      this.debugLog('visibility-change', { postId, isVisible, delay, meetsThreshold, isActuallyVisible });
    }
    
    // Re-evaluate audio focus when visibility changes
    if (visibilityChanged && this.exclusiveAudioEnabled) {
      // Only apply audio focus if videos are already playing
      // Don't apply during autoplay - we'll apply after play succeeds
      // Check if any video is currently playing before applying audio focus
      let hasPlayingVideo = false;
      for (const [postId, entry] of this.entries) {
        if (entry.player && entry.player.isPlaying()) {
          hasPlayingVideo = true;
          break;
        }
      }
      
      if (hasPlayingVideo) {
        // Use a small delay to ensure visibility states are updated
        setTimeout(() => {
          this.applyExclusiveAudioFocus();
        }, 50);
      }
      // If no videos are playing, don't apply audio focus yet - wait for autoplay
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
    // Autoplay when entering viewport (if enabled)
    if (this.options.autoPlay) {
      this.requestPlaybackIfReady(postId, entry, 'observer');
    }
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
    
    // Unload video if it's far enough from viewport
    this.checkAndUnloadVideo(postId, entry);
  }

  /**
   * Check if video should be unloaded based on distance from viewport
   */
  private checkAndUnloadVideo(postId: string, entry: VisibilityEntry): void {
    if (!entry.player || entry.isUnloaded) {
      return; // No player or already unloaded
    }

    const rect = this.getCachedRect(entry.element);
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    
    // Calculate distance from viewport
    let distanceFromViewport = 0;
    
    // Check if element is above viewport
    if (rect.bottom < 0) {
      distanceFromViewport = Math.abs(rect.bottom);
    }
    // Check if element is below viewport
    else if (rect.top > viewportHeight) {
      distanceFromViewport = rect.top - viewportHeight;
    }
    // Check if element is to the left of viewport
    else if (rect.right < 0) {
      distanceFromViewport = Math.abs(rect.right);
    }
    // Check if element is to the right of viewport
    else if (rect.left > viewportWidth) {
      distanceFromViewport = rect.left - viewportWidth;
    }
    
    // Extremely aggressive unload threshold to save RAM: 50px in HD mode, 100px in normal mode
    // This prevents 8GB+ RAM usage when scrolling
    const unloadThreshold = this.isHDMode ? 50 : 100;
    
    if (distanceFromViewport > unloadThreshold) {
      this.debugLog('unloading-video', { postId, distanceFromViewport, isHDMode: this.isHDMode });
      entry.player.unload();
      entry.isUnloaded = true;
    }
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

    // Reload video if it was unloaded
    if (currentEntry.isUnloaded && currentEntry.player) {
      this.debugLog('reloading-video', { postId, origin });
      currentEntry.player.reload();
      currentEntry.isUnloaded = false;
      // Wait a bit for reload to start
      setTimeout(() => {
        this.requestPlaybackIfReady(postId, currentEntry, origin);
      }, 100);
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
    
    // For autoplay to work, ALL videos must be muted initially (browsers require this)
    // We'll unmute the appropriate video AFTER play succeeds
    // This ensures autoplay works while still respecting the global mute/unmute setting
    if (currentEntry.player) {
      currentEntry.player.setMuted(true);
    }
    
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
        if (this.isMobileDevice) {
          try {
            await player.waitForReady(1500);
          } catch (err) {
            this.debugLog('play-wait-ready-timeout', { postId, origin, attempt, error: err });
          }
          if (!entry.isVisible) {
            this.debugLog('play-abort-after-ready-wait', { postId, origin, attempt });
            return;
          }
        }

        await player.waitUntilCanPlay(timeout);
        if (!entry.isVisible) {
          return;
        }

        this.cancelPlaybackRetry(postId);
        // Ensure video is muted before playing (browsers require muted autoplay)
        // We'll apply exclusive audio AFTER play succeeds
        player.setMuted(true);
        
        await player.play();
        this.touchActive(postId);
        this.videoStates.set(postId, 'playing');
        this.debugLog('play-success', { postId, origin, attempt });
        
        // After play succeeds, handle unmuting based on global mute setting
        // If exclusive audio is ENABLED (volume mode ON), unmute the video
        // If exclusive audio is DISABLED (global mute ON), keep video muted
        if (this.exclusiveAudioEnabled) {
          // Volume mode is enabled: unmute the video after play succeeds
          // This allows audio to play since user interaction (autoplay) has occurred
          player.setMuted(false);
        }
        // If exclusive audio is disabled (global mute ON), video stays muted
      } catch (error: any) {
        this.debugLog('play-failed', { postId, origin, attempt, error });
        
        // Check if this is a load failure (not just playback failure)
        const isLoadFailure = error?.errorType === 'timeout' || 
                             error?.errorType === 'network' || 
                             error?.errorType === 'play' ||
                             (entry.player && entry.player.hasLoadError());
        
        if (isLoadFailure) {
          // Notify VideoPost of load failure via FeedContainer
          // We'll handle this by checking the error and letting VideoPost handle retries
          // For now, we'll let the existing retry logic handle it, but VideoPost will also handle it
          this.debugLog('load-failure-detected', { postId, errorType: error?.errorType });
        }
        
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
    if (!Number.isFinite(this.options.maxConcurrent) || this.options.maxConcurrent <= 0) {
      return;
    }

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
      return;
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
      this.cancelHoverPlayDebounce(postId);
      this.cancelHoverReloadTimer(postId);
      
      // Remove hover handlers
      this.removeHoverHandlers(entry);
      
      // Clear hover state if this was the hovered post
      if (this.hoveredPostId === postId) {
        this.hoveredPostId = undefined;
      }
      if (this.touchedPostId === postId) {
        this.touchedPostId = undefined;
      }
      
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
    for (const debounceTimer of this.hoverPlayDebounceTimers.values()) {
      clearTimeout(debounceTimer);
    }
    for (const reloadTimer of this.hoverReloadTimers.values()) {
      clearTimeout(reloadTimer);
    }
    
    // Remove all hover handlers
    for (const entry of this.entries.values()) {
      this.removeHoverHandlers(entry);
    }
    
    // Clean up scroll velocity tracking
    if ((this as any)._scrollCleanup) {
      (this as any)._scrollCleanup();
      (this as any)._scrollCleanup = undefined;
    }
    
    // Clean up audio focus tracking
    if ((this as any)._audioFocusCleanup) {
      (this as any)._audioFocusCleanup();
      (this as any)._audioFocusCleanup = undefined;
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
    this.hoverPlayDebounceTimers.clear();
    this.hoverReloadTimers.clear();
    this.rectCache.clear(); // Clear rect cache
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
   * Enable or disable exclusive audio mode
   */
  setExclusiveAudio(enabled: boolean): void {
    this.exclusiveAudioEnabled = !!enabled;
    if (!enabled) {
      // Mute all players when disabling volume mode
      for (const [postId, entry] of this.entries) {
        if (entry.player) {
          entry.player.setMuted(true);
        }
      }
      this.currentAudioPostId = undefined;
    } else {
      this.applyExclusiveAudioFocus();
    }
  }

  /**
   * Re-evaluate which visible post should have audio focus
   */
  reevaluateAudioFocus(): void {
    if (!this.exclusiveAudioEnabled) return;
    this.applyExclusiveAudioFocus();
  }

  /**
   * Optionally focus audio on a specific post id
   */
  focusAudioOn(postId?: string): void {
    if (!this.exclusiveAudioEnabled) return;
    if (postId && this.entries.has(postId)) {
      this.currentAudioPostId = postId;
    } else {
      this.currentAudioPostId = undefined;
    }
    this.applyExclusiveAudioFocus();
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
      this.hoveredPostId = postId;
      // Combined hover action: unmute and play together to avoid race conditions
      this.handleHoverEnter(postId);
    };
    
    const handleLeave = () => {
      if (this.hoveredPostId === postId) {
        this.hoveredPostId = undefined;
        this.muteOnHoverLeave(postId);
        // Pause video on hover end (if not manually started)
        this.pauseOnHoverLeave(postId);
      }
    };

    const handleTouchEnd = () => {
      // Clear any existing timeout
      if (entry.hoverHandlers?.touchEndTimeout) {
        clearTimeout(entry.hoverHandlers.touchEndTimeout);
      }

      // Delay muting on touch end to allow for tap interactions
      const timeout = setTimeout(() => {
        if (this.touchedPostId === postId) {
          this.touchedPostId = undefined;
        }
        if (this.hoveredPostId === postId) {
          handleLeave();
        }
        if (entry.hoverHandlers) {
          entry.hoverHandlers.touchEndTimeout = undefined;
        }
      }, 100);

      if (entry.hoverHandlers) {
        entry.hoverHandlers.touchEndTimeout = timeout;
      }
    };

    const handleTouchCancel = () => {
      // Clear touch end timeout if it exists
      if (entry.hoverHandlers?.touchEndTimeout) {
        clearTimeout(entry.hoverHandlers.touchEndTimeout);
        entry.hoverHandlers.touchEndTimeout = undefined;
      }

      if (this.touchedPostId === postId) {
        this.touchedPostId = undefined;
      }
      if (this.hoveredPostId === postId) {
        handleLeave();
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
      this.hoverPlayDebounceTimers.delete(postId);
      this.executeHoverEnter(postId);
    }, 50);

    this.hoverPlayDebounceTimers.set(postId, debounceTimer);
  }

  /**
   * Execute the combined hover enter action (unmute + play)
   */
  private executeHoverEnter(postId: string): void {
    // Verify still hovered
    if (this.hoveredPostId !== postId) {
      return;
    }

    const entry = this.entries.get(postId);
    if (!entry) {
      return;
    }

    // Validate element is still in DOM
    if (!entry.element.isConnected) {
      this.hoveredPostId = undefined;
      return;
    }

    // For autoplay to work, we need to play while muted first, then unmute after
    // Browsers block autoplay of unmuted videos, so we must play muted, then unmute
    // This is especially important in HD mode where videos have audio
    
    // Check if player has a valid video element before proceeding
    if (entry.player) {
      try {
        entry.player.getVideoElement();
      } catch {
        // Player doesn't have video element yet, skip hover actions
        return;
      }
    } else {
      // No player yet, skip hover actions
      return;
    }
    
    // If exclusive audio is enabled, mute all other videos first
    if (this.exclusiveAudioEnabled && entry.player) {
      // Mute all other videos
      for (const [otherPostId, otherEntry] of this.entries) {
        if (otherPostId !== postId && otherEntry.player) {
          // Check if other player has video element before muting
          try {
            otherEntry.player.getVideoElement();
            otherEntry.player.setMuted(true);
          } catch {
            // Player doesn't have video element yet, skip
            continue;
          }
        }
      }
    }

    // Play first while muted (browsers allow muted autoplay)
    // Then handle unmuting based on global mute setting after play succeeds
    this.executePlayOnHover(postId).then(() => {
      // After play succeeds, handle unmuting based on global mute setting
      // If exclusive audio is ENABLED (volume mode ON), unmute the video
      // If exclusive audio is DISABLED (global mute ON), keep video muted
      if (entry.player && this.hoveredPostId === postId) {
        if (this.exclusiveAudioEnabled) {
          // Volume mode is enabled: unmute the video
          // Hover provides user interaction, so unmuting is allowed
          entry.player.setMuted(false);
        }
        // If exclusive audio is disabled (global mute ON), video stays muted
        if (this.exclusiveAudioEnabled) {
          this.currentAudioPostId = postId;
        }
      }
    }).catch((error: any) => {
      // If play fails, check if it's a load failure
      const isLoadFailure = error?.errorType === 'timeout' || 
                           error?.errorType === 'network' || 
                           error?.errorType === 'play' ||
                           (entry.player && entry.player.hasLoadError());
      
      if (isLoadFailure) {
        this.debugLog('load-failure-on-hover', { postId, errorType: error?.errorType });
        // VideoPost will handle the retry logic via its own error checking
      }
      // If play fails, don't unmute
    });
  }

  /**
   * Unmute the hovered video and mute all others
   * @deprecated Use handleHoverEnter instead to avoid race conditions
   * NOTE: This function should NOT unmute videos - videos should stay muted by default
   * Only the user's manual unmute action or autoplay (when global mute is disabled) should unmute
   */
  private unmuteOnHover(postId: string): void {
    // This function is deprecated and should not unmute videos
    // Videos should stay muted by default
    // Only unmute via:
    // 1. User's manual unmute button click (handled by NativeVideoPlayer)
    // 2. Autoplay handler when global mute is disabled (exclusiveAudioEnabled = false)
    return;
  }

  /**
   * Mute the video when hover/touch leaves and re-apply audio focus
   */
  private muteOnHoverLeave(postId: string): void {
    if (!this.exclusiveAudioEnabled) return;
    
    // Re-apply audio focus to go back to center-based selection
    this.applyExclusiveAudioFocus();
  }

  /**
   * Play video on hover (with debouncing to prevent rapid-fire attempts)
   * @deprecated Use handleHoverEnter instead to coordinate with audio unmuting
   * This method is kept for backwards compatibility but delegates to handleHoverEnter
   */
  private playOnHover(postId: string): void {
    // Delegate to handleHoverEnter to ensure audio and playback are coordinated
    // This ensures unmute and play happen together without race conditions
    this.handleHoverEnter(postId);
  }

  /**
   * Execute the actual play on hover logic
   * Returns a Promise that resolves when play succeeds, rejects on failure
   */
  private executePlayOnHover(postId: string): Promise<void> {
    // Verify still hovered
    if (this.hoveredPostId !== postId) {
      return Promise.reject(new Error('Not hovered'));
    }

    const entry = this.entries.get(postId);
    if (!entry) {
      return Promise.reject(new Error('Entry not found'));
    }

    // Validate element is still in DOM
    if (!entry.element.isConnected) {
      this.hoveredPostId = undefined;
      return Promise.reject(new Error('Element not in DOM'));
    }

    if (!entry.player) {
      // If player doesn't exist yet, trigger loading and mark that we want to play when it's ready
      entry.pendingVisibilityPlay = true;
      // Trigger video loading if callback is available
      if (this.onHoverLoadRequest) {
        this.onHoverLoadRequest(postId);
      }
      return Promise.reject(new Error('Player not ready'));
    }

    // If already playing, just ensure it continues
    if (entry.player.isPlaying()) {
      // Clear pending flag since we're already playing
      entry.pendingVisibilityPlay = false;
      return Promise.resolve();
    }

    // Ensure video is loaded/preloaded before playing
    if (entry.isUnloaded) {
      // Cancel any existing reload timer
      this.cancelHoverReloadTimer(postId);

      // Reload video if it was unloaded
      entry.player.reload();
      entry.isUnloaded = false;
      
      // Wait a bit for reload to start, then try playing
      return new Promise((resolve, reject) => {
        const reloadTimer = setTimeout(() => {
          this.hoverReloadTimers.delete(postId);
          // Verify still hovered before retrying
          if (this.hoveredPostId === postId) {
            this.executePlayOnHover(postId).then(resolve).catch(reject);
          } else {
            reject(new Error('Hover lost during reload'));
          }
        }, 100);

        this.hoverReloadTimers.set(postId, reloadTimer);
      });
    }

    // Check if player is ready (check both state map and actual player state)
    const state = this.videoStates.get(postId);
    const isPlayerReady = state === 'ready' || state === 'playing' || state === 'paused';
    
    // Also check actual player state as fallback
    let playerActuallyReady = false;
    try {
      const videoElement = entry.player.getVideoElement();
      playerActuallyReady = videoElement.readyState >= 2; // HAVE_CURRENT_DATA or higher
    } catch {
      // Ignore errors checking player state
    }

    // If player isn't ready yet, try to play anyway (play() will handle waiting)
    // This ensures videos that loaded automatically can still play on hover
    if (!isPlayerReady && !playerActuallyReady) {
      // Try to play anyway - the play() promise will handle the wait/retry
      // But also set pending flag as fallback
      entry.pendingVisibilityPlay = true;
    }

    // Attempt to play (even if not fully ready - browser will handle buffering)
    return entry.player.play()
      .then(() => {
        // Clear pending flag on successful play
        entry.pendingVisibilityPlay = false;
        this.debugLog('hover-play-success', { postId });
      })
      .catch((error) => {
        this.debugLog('hover-play-failed', { postId, error });
        // If play fails, mark as pending to retry when ready
        entry.pendingVisibilityPlay = true;
        
        // Retry after a short delay if player state says ready but play failed
        if (isPlayerReady || playerActuallyReady) {
          setTimeout(() => {
            // Verify still hovered before retrying
            if (this.hoveredPostId === postId && entry.pendingVisibilityPlay) {
              this.executePlayOnHover(postId).catch(() => {
                // Ignore retry errors
              });
            }
          }, 200);
        }
        throw error; // Re-throw to propagate the error
      });
  }

  /**
   * Pause video on hover leave (if not manually started)
   */
  private pauseOnHoverLeave(postId: string): void {
    const entry = this.entries.get(postId);
    if (!entry || !entry.player) {
      return;
    }

    // Don't pause if video was manually started by user
    if (this.manuallyStartedVideos.has(postId)) {
      return;
    }

    // Don't pause if video is still visible in viewport
    if (entry.isVisible) {
      return;
    }

    // Pause the video
    try {
      entry.player.pause();
    } catch {
      // Ignore pause errors
    }
  }

  /**
   * Internal: compute most-centered visible entry and unmute only that one
   * Respects hover state - if a video is hovered, it takes priority
   * NOTE: This should only be called when exclusiveAudioEnabled is true
   * and videos are already playing (not for autoplay)
   */
  private applyExclusiveAudioFocus(): void {
    // Only apply if exclusive audio is enabled
    if (!this.exclusiveAudioEnabled) {
      return;
    }
    
    // If a video is hovered, use that instead of center-based selection
    // NOTE: When exclusiveAudioEnabled is true, videos should stay muted
    // This function only manages which video is "focused" but doesn't unmute
    if (this.hoveredPostId) {
      const hoveredEntry = this.entries.get(this.hoveredPostId);
      if (hoveredEntry && hoveredEntry.player) {
        // Mute all other videos, but keep the hovered video muted too
        // Videos should stay muted by default - only unmute via manual action or autoplay (when global mute disabled)
        for (const [postId, entry] of this.entries) {
          if (entry.player && postId !== this.hoveredPostId) {
            entry.player.setMuted(true);
          }
        }
        // Don't unmute the hovered video - it should stay muted
        this.currentAudioPostId = this.hoveredPostId;
        return;
      }
    }

    // Pick most-centered visible entry first (before muting)
    let bestId: string | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    const viewportCenterY = window.innerHeight / 2;
    const viewportCenterX = window.innerWidth / 2;

    // If a specific post is requested, use it if visible
    if (this.currentAudioPostId) {
      const entry = this.entries.get(this.currentAudioPostId);
      if (entry && entry.isVisible && entry.player) {
        bestId = this.currentAudioPostId;
      }
    }

    // Otherwise, find the most-centered visible entry
    if (!bestId) {
      for (const [postId, entry] of this.entries) {
        if (!entry.isVisible || !entry.player) continue;
        const rect = this.getCachedRect(entry.element);
        
        // Only consider entries that are actually in viewport
        if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
        if (rect.right < 0 || rect.left > window.innerWidth) continue;
        
        const centerY = rect.top + rect.height / 2;
        const centerX = rect.left + rect.width / 2;
        const dy = centerY - viewportCenterY;
        const dx = centerX - viewportCenterX;
        const distance = Math.hypot(dx, dy);
        
        if (distance < bestScore) {
          bestScore = distance;
          bestId = postId;
        }
      }
    }

    // Mute all first, but preserve playing state
    // CRITICAL: Only change mute state for videos that are ALREADY playing
    // Don't unmute videos that aren't playing yet - they need to be muted for autoplay
    for (const [postId, entry] of this.entries) {
      if (entry.player) {
        // Only change muted state if it's different to avoid unnecessary updates
        const shouldBeMuted = postId !== bestId;
        const isCurrentlyMuted = entry.player.getVideoElement().muted;
        const isCurrentlyPlaying = entry.player.isPlaying();
        
        // CRITICAL: Only change mute state if video is already playing
        // If video is not playing, keep it muted (required for autoplay)
        if (!isCurrentlyPlaying) {
          // Video is not playing - ensure it's muted for autoplay
          if (!isCurrentlyMuted) {
            entry.player.setMuted(true);
          }
          continue;
        }
        
        // Video is playing - can safely change mute state
        if (isCurrentlyMuted !== shouldBeMuted) {
          // Don't mute a video that was manually started by the user
          // This prevents interrupting user-initiated playback
          if (this.manuallyStartedVideos.has(postId) && shouldBeMuted && entry.isVisible) {
            // Skip muting manually started videos - let them play until user pauses
            continue;
          }
          
          if (shouldBeMuted && entry.isVisible) {
            // Delay muting to avoid interrupting playback
            setTimeout(() => {
              const currentEntry = this.entries.get(postId);
              if (currentEntry && currentEntry.player && currentEntry.isVisible) {
                // Check if it's still playing and still should be muted
                // Don't mute if it was manually started
                if (currentEntry.player.isPlaying() && 
                    postId !== this.currentAudioPostId &&
                    !this.manuallyStartedVideos.has(postId)) {
                  currentEntry.player.setMuted(true);
                }
              }
            }, 100);
            continue;
          }
          
          // When exclusiveAudioEnabled is true, ALL videos should stay muted
          // Only unmute if global mute is disabled (exclusiveAudioEnabled = false)
          // This is handled by the autoplay/hover handlers, not here
          // So we should only mute here, never unmute
          if (shouldBeMuted) {
            entry.player.setMuted(true);
          }
          // Don't unmute here - videos should stay muted by default
          // Unmuting only happens via:
          // 1. User's manual unmute button click (handled by NativeVideoPlayer)
          // 2. Autoplay/hover handler when global mute is disabled
        }
      }
    }

    // Update current audio post ID
    if (bestId) {
      this.currentAudioPostId = bestId;
    } else {
      this.currentAudioPostId = undefined;
    }
  }
}

