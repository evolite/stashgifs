/**
 * Visibility Manager
 * Handles video playback based on viewport visibility using Intersection Observer
 */

import { NativeVideoPlayer } from './NativeVideoPlayer.js';
import { AudioManager, AudioPriority } from './AudioManager.js';
import { isMobileDevice } from './utils.js';

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

type VideoState = 'loading' | 'ready' | 'playing' | 'paused' | 'failed';
type PlaybackOrigin = 'observer' | 'ready' | 'register' | 'retry';

export class VisibilityManager {
  private readonly observer: IntersectionObserver;
  private readonly entries: Map<string, VisibilityEntry>;
  private readonly activeVideos: Set<string>;
  private readonly videoStates: Map<string, VideoState>;
  private readonly pendingOperations: Map<string, ReturnType<typeof setTimeout>>;
  private readonly visibilityStability: Map<string, number>; // timestamp when visibility last changed
  private readonly playbackRetryHandles: Map<string, ReturnType<typeof setTimeout>>;
  private debugEnabled: boolean;
  private logger?: (event: string, payload?: Record<string, unknown>) => void;
  private scrollVelocity: number = 0;
  private lastScrollTime: number = 0;
  private lastScrollTop: number = 0;
  private readonly isMobileDevice: boolean;
  private audioManager: AudioManager; // Centralized audio management
  private hoveredPostId?: string; // Track which post is currently hovered/touched
  private touchedPostId?: string; // Track which post is currently touched (separate from hover for mobile)
  private isHDMode: boolean = false; // Track HD mode for more aggressive unloading
  // Note: manuallyStartedVideos tracking moved to AudioManager for single source of truth
  // Cache for getBoundingClientRect results per frame to avoid layout thrashing
  private readonly rectCache: Map<HTMLElement, DOMRect> = new Map();
  private rectCacheFrame: number = 0;
  private readonly onHoverLoadRequest?: (postId: string) => void; // Callback to trigger video loading on hover
  private readonly hoverPlayDebounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map(); // Debounce rapid hover play attempts
  private readonly hoverReloadTimers: Map<string, ReturnType<typeof setTimeout>> = new Map(); // Track reload timeouts
  private scrollCleanup?: () => void; // Cleanup function for scroll velocity tracking
  private audioFocusCleanup?: () => void; // Cleanup function for audio focus tracking
  private readonly options: {
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
    const isMobile = isMobileDevice();
    this.isMobileDevice = isMobile;
    // Playback decisions rely on actual viewport visibility – keep root margin tight
    const defaultRootMargin = '0px';
    
    const requestedMaxConcurrent = options?.maxConcurrent;
    let maxConcurrent = Number.POSITIVE_INFINITY;
    if (requestedMaxConcurrent !== undefined && requestedMaxConcurrent > 0) {
      maxConcurrent = requestedMaxConcurrent;
    }

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

    // Initialize AudioManager
    this.audioManager = new AudioManager(this.entries, {
      debug: this.debugEnabled,
      logger: this.logger,
      getHoveredPostId: () => this.hoveredPostId
    });

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
      const scrollTop = globalThis.window.scrollY || document.documentElement.scrollTop;
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
    this.lastScrollTop = globalThis.window.scrollY || document.documentElement.scrollTop;
    this.scrollVelocityRafHandle = requestAnimationFrame(updateScrollVelocity);
    
    // Store cleanup function
    this.scrollCleanup = () => {
      this.scrollTrackingActive = false;
      if (this.scrollVelocityRafHandle !== undefined) {
        cancelAnimationFrame(this.scrollVelocityRafHandle);
        this.scrollVelocityRafHandle = undefined;
      }
    };
  }

  /**
   * Set up scroll listener for exclusive audio re-evaluation
   * Now uses event-driven approach via AudioManager
   */
  private setupAudioFocusTracking(): void {
    if (globalThis.window === undefined) return;
    
    const handleScroll = () => {
      // Scroll-based audio selection removed - using hover-based only
    };
    
    globalThis.window.addEventListener('scroll', handleScroll, { passive: true });
    
    // Store cleanup function
    this.audioFocusCleanup = () => {
      globalThis.window.removeEventListener('scroll', handleScroll);
    };
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
          // Use AudioManager's tracking for single source of truth
          this.audioManager.markManuallyStarted(postId);
        }
      } else {
        const wasManuallyStarted = this.audioManager.isManuallyStarted(postId);
        this.videoStates.set(postId, 'paused');
        this.activeVideos.delete(postId);
        // Remove from manually started set when paused - use AudioManager
        this.audioManager.unmarkManuallyStarted(postId);
        this.debugLog('state-paused', { postId });
        
        // Manual video pause handled by normal autoplay logic
      }
    });

    // Check visibility immediately (IntersectionObserver might not have fired yet on initial load)
    const isCurrentlyVisible = this.isActuallyInViewport(entry.element);
    if (isCurrentlyVisible && !entry.isVisible) {
      // Update visibility state immediately if we detect it's actually visible
      entry.isVisible = true;
      entry.pendingVisibilityPlay = this.options.autoPlay;
      this.debugLog('register-player-visibility-update', { postId, wasVisible: false, nowVisible: true });
    }
    
    this.debugLog('register-player', { postId, visible: entry.isVisible, isCurrentlyVisible });
    
    // Ensure video starts muted for autoplay compatibility
    // We'll apply exclusive audio AFTER play succeeds
    player.setMuted(true);
    
    // Set pending autoplay if visible and autoplay is enabled
    // This will be handled when the player becomes ready
    if (entry.isVisible && this.options.autoPlay) {
      entry.pendingVisibilityPlay = true;
      this.debugLog('register-player-autoplay-pending', { postId });
    }
    
    // Add play/pause event listeners for AudioManager
    this.setupPlayerEventListeners(postId, player);
    
    // Wait for player to be ready (this will trigger autoplay when ready)
    this.waitForPlayerReady(postId, player);
    
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
    const isCurrentlyPlaying = player.isPlaying();
    if (isCurrentlyPlaying) {
      // If video is already playing, update audio focus
      // Delay slightly to avoid interrupting playback
      setTimeout(() => {
        this.audioManager.updateAudioFocus();
      }, 50);
    }
    // Don't apply audio focus if video is not playing yet - wait for autoplay to succeed

    // Apply global mute state immediately to newly registered videos
    // This ensures videos respect the global mute setting as soon as they're registered
    // But first, check if we need to respect the global mute state from FeedContainer
    // The player was muted for autoplay, but we should apply the actual global mute state
    this.audioManager.applyMuteStateToAll();
    
    // Also ensure the player respects the global mute state if it's available
    // This is a fallback in case AudioManager hasn't been initialized with the global state yet
    // The FeedContainer will call applyGlobalMuteState() which will update all posts
  }

  /**
   * Wait for player to be ready before allowing play attempts
   */
  private async waitForPlayerReady(postId: string, player: NativeVideoPlayer): Promise<void> {
    try {
      const isMobile = isMobileDevice();
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
    
    this.updateVisibilityOnReady(postId, entry);
    this.handlePlaybackOnReady(postId, entry);
  }

  /**
   * Update visibility state when player becomes ready
   */
  private updateVisibilityOnReady(postId: string, entry: VisibilityEntry | undefined): void {
    if (!entry) return;
    
    // Re-check visibility when player becomes ready (in case IntersectionObserver hadn't fired yet)
    const isCurrentlyVisible = this.isActuallyInViewport(entry.element);
    if (isCurrentlyVisible && !entry.isVisible) {
      // Update visibility state immediately if we detect it's actually visible
      entry.isVisible = true;
      entry.pendingVisibilityPlay = this.options.autoPlay;
      this.debugLog('wait-ready-visibility-update', { postId, wasVisible: false, nowVisible: true });
    }
  }

  /**
   * Handle playback when player becomes ready
   */
  private handlePlaybackOnReady(postId: string, entry: VisibilityEntry | undefined): void {
    if (!entry) return;
    
    // Check if there's a pending hover play request OR if currently hovered
    // This ensures hover play works even if pendingVisibilityPlay was cleared
    if (entry.pendingVisibilityPlay || this.hoveredPostId === postId) {
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
        } else if (this.hoveredPostId === postId) {
          // Only use hover-based play if actually hovered (shouldn't reach here if not hovered)
          // This is a fallback for edge cases
          this.executePlayOnHover(postId);
        }
      }
    }
    // Also handle autoplay if enabled and visible
    // In HD mode, uses AudioManager priority logic to determine which video should play
    // But respect manual pause state - don't resume if user manually paused
    if (entry.isVisible && this.options.autoPlay && !entry.pendingVisibilityPlay && !entry.player?.isManuallyPaused()) {
      this.requestPlaybackIfReady(postId, entry, 'ready');
    }
  }

  private computeVisibilityDelay(isEntering: boolean): number {
    const isMobile = isMobileDevice();
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
    const viewportHeight = globalThis.window.innerHeight;
    const viewportWidth = globalThis.window.innerWidth;
    
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
   * Determine which video should play based on AudioManager priority logic
   * Returns the postId that should be playing, or undefined if none should play
   * In HD mode, only the most centered visible video should autoplay
   */
  private getVideoThatShouldPlay(): string | undefined {
    // Find most centered visible video (like audio logic)
    let bestId: string | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    const viewportCenterY = globalThis.window.innerHeight / 2;
    const viewportCenterX = globalThis.window.innerWidth / 2;

    for (const [postId, entry] of this.entries) {
      if (!entry.isVisible || !entry.player) continue;

      const rect = this.getCachedRect(entry.element);
      
      // Only consider entries that are actually in viewport
      if (rect.bottom < 0 || rect.top > globalThis.window.innerHeight) continue;
      if (rect.right < 0 || rect.left > globalThis.window.innerWidth) continue;
      
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

    return bestId;
  }

  /**
   * Check if a video should play based on AudioManager priority logic (for HD mode)
   */
  private shouldVideoPlay(postId: string): boolean {
    if (!this.isHDMode) {
      // In non-HD mode, use standard autoplay logic
      return true;
    }

    // In HD mode, use AudioManager priority logic
    const videoThatShouldPlay = this.getVideoThatShouldPlay();
    return videoThatShouldPlay === postId;
  }

  /**
   * Re-evaluate which video should play based on priority (for HD mode)
   * Only the most centered video should autoplay, like audio logic
   */
  private reevaluatePlayback(): void {
    if (!this.isHDMode || !this.options.autoPlay) {
      return;
    }

    const videoThatShouldPlay = this.getVideoThatShouldPlay();
    
    // Pause any videos that shouldn't be playing (but respect manual pause)
    // The most centered video takes priority, but don't pause manually paused videos
    for (const [postId, entry] of this.entries) {
      if (entry.player && entry.player.isPlaying() && postId !== videoThatShouldPlay) {
        // Don't pause if video was manually paused - user's intent should be respected
        // But if it's playing and shouldn't be, pause it (unless manually paused)
        if (!entry.player.isManuallyPaused()) {
          this.pauseVideo(postId);
        }
      }
    }

    // Start playback for the video that should be playing
    if (videoThatShouldPlay) {
      const entry = this.entries.get(videoThatShouldPlay);
      if (entry?.isVisible && entry.player && !entry.player.isPlaying()) {
        // Request playback for the video that should be playing
        // But respect manual pause state
        if (!entry.player.isManuallyPaused()) {
          this.requestPlaybackIfReady(videoThatShouldPlay, entry, 'observer');
        }
      }
    }
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
        } catch {
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
    const changedPostIds: string[] = [];
    
    for (const entry of entries) {
      const postId = this.findPostId(entry.target as HTMLElement);
      if (!postId) continue;

      const visibilityEntry = this.entries.get(postId);
      if (!visibilityEntry) continue;

      if (this.processIntersectionEntry(entry, postId, visibilityEntry)) {
        changedPostIds.push(postId);
      }
    }
    
    // Notify AudioManager of visibility changes
    if (changedPostIds.length > 0) {
      for (const postId of changedPostIds) {
        const changedEntry = this.entries.get(postId);
        if (changedEntry) {
          this.audioManager.onVisibilityChange(postId, changedEntry.isVisible);
        }
      }
    }
  }

  /**
   * Handle visibility timeout callback
   */
  private handleVisibilityTimeout(postId: string, isVisible: boolean): void {
    this.pendingOperations.delete(postId);
    const currentEntry = this.entries.get(postId);
    if (!currentEntry) {
      return;
    }

    if (isVisible) {
      this.handleVisibilityEnterTimeout(postId, currentEntry);
    } else {
      this.handleVisibilityExitTimeout(postId, currentEntry);
    }
  }

  /**
   * Handle visibility enter timeout
   */
  private handleVisibilityEnterTimeout(postId: string, currentEntry: VisibilityEntry): void {
    const stillInViewport = this.isActuallyInViewport(currentEntry.element);
    if (!currentEntry.isVisible || !stillInViewport) {
      currentEntry.isVisible = stillInViewport;
      return;
    }
    // Autoplay when entering viewport (if enabled)
    // In non-HD mode, don't check hover state - autoplay should work regardless
    // But respect manual pause state - don't resume if user manually paused
    if (this.options.autoPlay && !currentEntry.player?.isManuallyPaused()) {
      this.requestPlaybackIfReady(postId, currentEntry, 'observer');
    }
  }

  /**
   * Handle visibility exit timeout
   */
  private handleVisibilityExitTimeout(postId: string, currentEntry: VisibilityEntry): void {
    const stillActuallyVisible = this.isActuallyInViewport(currentEntry.element);
    if (stillActuallyVisible) {
      currentEntry.isVisible = true;
      // Autoplay when re-entering viewport (if enabled)
      // In non-HD mode, don't check hover state - autoplay should work regardless
      // But respect manual pause state - don't resume if user manually paused
      if (this.options.autoPlay && !currentEntry.player?.isManuallyPaused()) {
        this.requestPlaybackIfReady(postId, currentEntry, 'observer');
      }
      return;
    }
    if (currentEntry.isVisible) {
      return;
    }
    this.handlePostExitedViewport(postId, currentEntry);
  }

  /**
   * Process a single intersection entry
   */
  private processIntersectionEntry(
    entry: IntersectionObserverEntry,
    postId: string,
    visibilityEntry: VisibilityEntry
  ): boolean {
    const wasVisible = visibilityEntry.isVisible;
    const element = visibilityEntry.element;
    
    // For playing: use expanded area (with rootMargin) to start early
    const meetsThreshold = entry.intersectionRatio >= this.options.threshold;
    const isActuallyVisible = this.isActuallyInViewport(element);
    const isVisible = entry.isIntersecting && meetsThreshold && isActuallyVisible;

    if (isVisible === wasVisible) {
      return false;
    }

    visibilityEntry.isVisible = isVisible;
    // Set pendingVisibilityPlay based on visibility if autoplay is enabled
    visibilityEntry.pendingVisibilityPlay = isVisible && this.options.autoPlay;

    this.cancelPendingOperation(postId);
    this.cancelPlaybackRetry(postId);

    this.visibilityStability.set(postId, Date.now());
    const delay = this.computeVisibilityDelay(isVisible);

    const timeoutId = setTimeout(() => {
      this.handleVisibilityTimeout(postId, isVisible);
    }, delay);

    this.pendingOperations.set(postId, timeoutId);
    this.debugLog('visibility-change', { postId, isVisible, delay, meetsThreshold, isActuallyVisible });
    return true;
  }

  /**
   * Handle visibility changes for audio focus
   */

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
    // In non-HD mode, don't check hover state - autoplay should work regardless
    // But respect manual pause state - don't resume if user manually paused
    if (this.options.autoPlay && !entry.player?.isManuallyPaused()) {
      this.requestPlaybackIfReady(postId, entry, 'observer');
    }
  }

  private handlePostExitedViewport(postId: string, entry: VisibilityEntry): void {
    // Double-check visibility hasn't changed back
    const currentEntry = this.entries.get(postId);
    if (currentEntry?.isVisible) {
      return; // Visibility changed back, don't pause
    }
    this.debugLog('visibility-exit', { postId });
    entry.pendingVisibilityPlay = false;
    this.pauseVideo(postId);
    
    // Clear manual pause flag when video becomes invisible
    // This allows autoplay to work again when video becomes visible
    if (entry.player) {
      entry.player.clearManualPause();
    }
    
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
    const viewportHeight = globalThis.window.innerHeight;
    const viewportWidth = globalThis.window.innerWidth;
    
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
    
    // Unload threshold to save RAM: more aggressive on mobile
    // Mobile devices have less RAM, so unload sooner
    const unloadThreshold = this.isMobileDevice ? 50 : 100;
    
    if (distanceFromViewport > unloadThreshold) {
      this.debugLog('unloading-video', { postId, distanceFromViewport, isHDMode: this.isHDMode, isMobile: this.isMobileDevice });
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
      // Use pause() not pauseManually() here - this is called by visibility manager
      // Manual pause should only be set when user explicitly pauses via togglePlay
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

    // Check if video was manually paused - don't resume autoplay if user manually paused
    if (currentEntry.player?.isManuallyPaused()) {
      this.debugLog('play-abort-manually-paused', { postId, origin });
      return;
    }

    // Hover has priority in HD mode: don't start autoplay if any video is hovered (unless this is the hovered video)
    // In non-HD mode (autoPlay: true), allow autoplay even if another video is hovered
    if (!this.options.autoPlay && this.hoveredPostId && this.hoveredPostId !== postId) {
      this.debugLog('play-abort-hover-active', { postId, origin, hoveredId: this.hoveredPostId });
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
    if (!entry?.player) {
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
    const isMobile = isMobileDevice();

    const perform = async (): Promise<void> => {
      try {
        await this.waitForPlayerReadyBeforePlay(postId, player, entry);
        await this.executePlayback(postId, player, entry, origin, attempt, isMobile);
      } catch (error: unknown) {
        this.handlePlaybackError(postId, entry, error, attempt, isMobile);
      }
    };

    // Intentionally ignore errors - errors are handled within perform() function
    perform().catch(() => {
      // Errors are handled within perform() function
    });
  }

  /**
   * Wait for player to be ready before playing (mobile-specific)
   */
  private async waitForPlayerReadyBeforePlay(
    postId: string,
    player: NativeVideoPlayer,
    entry: VisibilityEntry
  ): Promise<void> {
    if (this.isMobileDevice) {
      try {
        await player.waitForReady(1500);
      } catch (err) {
        this.debugLog('play-wait-ready-timeout', { postId, error: err });
      }
      if (!entry.isVisible) {
        this.debugLog('play-abort-after-ready-wait', { postId });
        throw new Error('Not visible after ready wait');
      }
    }
  }

  /**
   * Execute playback
   */
  private async executePlayback(
    postId: string,
    player: NativeVideoPlayer,
    entry: VisibilityEntry,
    origin: PlaybackOrigin,
    attempt: number,
    isMobile: boolean
  ): Promise<void> {
    // On mobile, use shorter timeout for faster perceived performance
    // But ensure video is muted for autoplay compatibility
    const timeout = isMobile ? 500 : 2000;
    
    // On mobile, ensure video is muted before attempting play (required for autoplay)
    if (isMobile) {
      player.setMuted(true);
    }
    await player.waitUntilCanPlay(timeout);
    if (!entry.isVisible) {
      throw new Error('Not visible');
    }

    this.cancelPlaybackRetry(postId);
    // Ensure video is muted before playing (browsers require muted autoplay)
    // We'll apply exclusive audio AFTER play succeeds
    // But first check the global mute state - if it's false, we'll unmute after play succeeds
    player.setMuted(true);
    
    await player.play();
    
    this.touchActive(postId);
    this.videoStates.set(postId, 'playing');
    this.debugLog('play-success', { postId, origin, attempt });
    
    // After play succeeds, notify AudioManager first
    // Check if this was a manual play (user clicked/tapped)
    // Check if manual via AudioManager (single source of truth)
    const isManual = origin === 'register' || this.audioManager.isManuallyStarted(postId);
    if (isManual) {
      this.audioManager.markManuallyStarted(postId);
    }
    
    // Notify AudioManager of play event - it will handle unmuting based on audio focus
    // Only the audio owner (hovered/touched video) will get unmuted when global mute is off
    this.audioManager.onVideoPlay(postId, isManual);
    // Ensure mute state is applied after AudioManager updates audio focus
    this.audioManager.applyMuteStateToAll();
  }

  /**
   * Handle playback errors
   */
  private handlePlaybackError(
    postId: string,
    entry: VisibilityEntry,
    error: unknown,
    attempt: number,
    isMobile: boolean
  ): void {
    this.debugLog('play-failed', { postId, attempt, error });
    
    // Check if this is a "Video element is not valid" error - this means the video element
    // was removed from DOM or is invalid, and we should hide the post
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isInvalidElementError = errorMessage.includes('Video element is not valid') || 
                                  errorMessage.includes('Video element not in DOM');
    
    if (isInvalidElementError) {
      // Video element is invalid - hide the post permanently
      this.debugLog('video-element-invalid-hiding-post', { postId, error: errorMessage });
      this.hidePost(postId);
      return;
    }
    
    // Check if this is a load failure (not just playback failure)
    const errorObj = error && typeof error === 'object' && 'errorType' in error 
      ? error as { errorType?: string }
      : null;
    const isLoadFailure = errorObj?.errorType === 'timeout' || 
                         errorObj?.errorType === 'network' || 
                         errorObj?.errorType === 'play' ||
                         entry.player?.hasLoadError();
    
    if (isLoadFailure) {
      // Notify VideoPost of load failure via FeedContainer
      // We'll handle this by checking the error and letting VideoPost handle retries
      // For now, we'll let the existing retry logic handle it, but VideoPost will also handle it
      this.debugLog('load-failure-detected', { postId, errorType: errorObj?.errorType });
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

  /**
   * Hide a post that has failed permanently
   */
  private hidePost(postId: string): void {
    const entry = this.entries.get(postId);
    if (!entry) return;
    
    // Hide the post element
    if (entry.element) {
      entry.element.style.display = 'none';
    }
    
    // Mark as permanently failed
    this.videoStates.set(postId, 'failed');
    entry.pendingVisibilityPlay = false;
    
    // Clean up
    this.cancelPendingOperation(postId);
    this.cancelPlaybackRetry(postId);
    this.activeVideos.delete(postId);
    
    this.debugLog('post-hidden-permanently', { postId });
  }

  private computeRetryDelay(isMobile: boolean, attempt: number): number {
    // On mobile, use shorter retry delays for faster recovery
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
      if (!entry?.isVisible) {
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
    if (this.scrollCleanup) {
      this.scrollCleanup();
      this.scrollCleanup = undefined;
    }
    
    // Clean up audio focus tracking
    if (this.audioFocusCleanup) {
      this.audioFocusCleanup();
      this.audioFocusCleanup = undefined;
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
      // Clear any existing timeout
      if (entry.hoverHandlers?.touchEndTimeout) {
        clearTimeout(entry.hoverHandlers.touchEndTimeout);
      }

      // Remove visual feedback on touch end
      if (entry.element) {
        entry.element.style.transition = 'opacity 0.2s ease-out';
        entry.element.style.opacity = '1';
      }

      // If touch ended before 250ms, it was a quick tap - NativeVideoPlayer handles it
      // If touch lasted > 250ms, we already triggered hover/unmute in handleTouchEnter
      // So we just need to clean up the touched state
      
      // On mobile, touchend doesn't mean the user moved away - just that they lifted their finger
      // Only clear the touched state, but keep the video playing if it's still visible
      // The video will pause when:
      // 1. User touches a different video (which will set a new hoveredPostId)
      // 2. User scrolls away (visibility manager will handle pausing)
      // 3. User manually pauses
      
      // Check if video was manually paused - if so, don't clear hoveredPostId too quickly
      // This prevents autoplay from resuming a manually paused video
      const isManuallyPaused = entry.player?.isManuallyPaused() ?? false;
      
      // Use longer timeout if video is manually paused or still playing
      // This prevents autoplay from interfering with user's manual pause
      const timeoutDuration = isManuallyPaused || entry.player?.isPlaying() ? 500 : 100;
      
      const timeout = setTimeout(() => {
        if (this.touchedPostId === postId) {
          this.touchedPostId = undefined;
        }
        
        // Check again if video is manually paused before clearing hover state
        const stillManuallyPaused = entry.player?.isManuallyPaused() ?? false;
        if (stillManuallyPaused) {
          // Video is manually paused - keep hoveredPostId to prevent autoplay from resuming
          // Only clear if video becomes invisible
          if (this.hoveredPostId === postId && !entry.isVisible) {
            handleLeave();
          }
          // Don't clear hoveredPostId if manually paused and still visible
          if (entry.hoverHandlers) {
            entry.hoverHandlers.touchEndTimeout = undefined;
          }
          return;
        }
        
        // Only clear hoveredPostId if video is no longer visible
        // This allows the video to keep playing after touch ends
        if (this.hoveredPostId === postId && !entry.isVisible) {
          handleLeave();
        } else if (this.hoveredPostId === postId) {
          // Video is still visible, so keep it playing but clear hoveredPostId
          // This allows viewport-based autoplay to take over if needed
          // But only if video is not manually paused
          this.hoveredPostId = undefined;
        }
        if (entry.hoverHandlers) {
          entry.hoverHandlers.touchEndTimeout = undefined;
        }
      }, timeoutDuration);

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

      // Remove visual feedback on touch cancel
      if (entry.element) {
        entry.element.style.transition = 'opacity 0.2s ease-out';
        entry.element.style.opacity = '1';
      }

      if (this.touchedPostId === postId) {
        this.touchedPostId = undefined;
      }
      // On touch cancel, only pause if video is no longer visible
      // This handles cases like scrolling during touch
      if (this.hoveredPostId === postId && !entry.isVisible) {
        handleLeave();
      } else if (this.hoveredPostId === postId) {
        // Video is still visible, just clear the hover state
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
      this.hoverPlayDebounceTimers.delete(postId);
      this.executeHoverEnter(postId);
    }, 50);

    this.hoverPlayDebounceTimers.set(postId, debounceTimer);
  }

  /**
   * Execute the combined hover enter action (unmute + play)
   */
  private executeHoverEnter(postId: string): void {
    const entry = this.validateHoverEntry(postId);
    if (!entry) {
      return;
    }

    // AudioManager will handle muting through applyMuteState()

    if (!this.isHDMode) {
      this.handleNonHDHover(postId, entry);
      return;
    }

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
   * Handle hover in non-HD mode
   */
  private handleNonHDHover(postId: string, entry: VisibilityEntry): void {
    // For non-HD videos, request audio focus on hover if exclusiveAudio is enabled
    // Videos are already playing via autoplay, so we can request audio immediately
    if (entry.player) {
      this.audioManager.onHoverEnter(postId);
    }
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
              this.videoStates.set(otherPostId, 'paused');
              this.activeVideos.delete(otherPostId);
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
   * Handle hover play error
   */
  private handleHoverPlayError(postId: string, entry: VisibilityEntry, error: unknown): void {
    // If play fails, check if it's a load failure
    const errorObj = error && typeof error === 'object' && 'errorType' in error 
      ? error as { errorType?: string }
      : null;
    const isLoadFailure = errorObj?.errorType === 'timeout' ||
                         errorObj?.errorType === 'network' ||
                         errorObj?.errorType === 'play' ||
                         entry.player?.hasLoadError();
    
    if (isLoadFailure) {
      this.debugLog('load-failure-on-hover', { postId, errorType: errorObj?.errorType });
      // VideoPost will handle the retry logic via its own error checking
    }
    // If play fails, don't unmute
  }

  /**
   * Mute the video when hover/touch leaves and re-apply audio focus
   */
  private muteOnHoverLeave(postId: string): void {
    // Notify AudioManager of hover leave
    this.audioManager.onHoverLeave(postId);
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
      if (videoElement) {
        playerActuallyReady = videoElement.readyState >= 2; // HAVE_CURRENT_DATA or higher
      }
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
      this.videoStates.set(postId, 'paused');
      this.activeVideos.delete(postId);
      entry.pendingVisibilityPlay = false;
      this.debugLog('hover-leave-pause', { postId, wasVisible: entry.isVisible });
    } catch {
      // Ignore pause errors
    }
  }

  /**
   * Setup play/pause event listeners for AudioManager
   */
  private setupPlayerEventListeners(postId: string, player: NativeVideoPlayer): void {
    try {
      const videoElement = player.getVideoElement();
      
      const handlePlay = () => {
        // Check if this was a manual play (user clicked/tapped)
        // Check if manual via AudioManager
        const isManual = this.audioManager.isManuallyStarted(postId);
        this.audioManager.onVideoPlay(postId, isManual);
      };

      const handlePause = () => {
        this.audioManager.onVideoPause(postId);
      };

      // CRITICAL: Also listen for 'playing' event to ensure audio works on mobile
      // The 'playing' event fires when video actually starts rendering frames
      // On mobile, AudioManager needs to check isPlaying() when video is actually playing,
      // not just when play() is called, because isPlaying() might return false initially
      const handlePlaying = () => {
        // Re-apply mute state when video actually starts playing
        // This ensures isPlaying() returns true and AudioManager can properly unmute on mobile
        this.audioManager.applyMuteStateToAll();
        
        // Re-request audio focus if video is playing but doesn't have it
        // This catches cases where the initial request failed due to timing
        const currentOwner = this.audioManager.getCurrentAudioOwner();
        if (currentOwner !== postId && player.isPlaying()) {
          // Determine priority: manual > center
          const isManual = this.audioManager.isManuallyStarted(postId);
          const priority = isManual ? AudioPriority.MANUAL : AudioPriority.CENTER;
          this.audioManager.requestAudioFocus(postId, priority);
          // Re-apply mute state after requesting focus
          this.audioManager.applyMuteStateToAll();
        }
      };
      
      videoElement.addEventListener('play', handlePlay);
      videoElement.addEventListener('pause', handlePause);
      videoElement.addEventListener('playing', handlePlaying);
      
      // Store handlers for cleanup (we'll need to track these)
      // For now, we'll rely on the video element being removed when player is destroyed
    } catch {
      // Player doesn't have video element yet, will be handled when ready
    }
  }
}

