/**
 * Native HTML5 Video Player
 * Replaces VideoJS with native video element and custom controls
 */

import { VideoPlayerState } from './types.js';
import { formatDuration, isValidMediaUrl, hasWebkitFullscreen, hasMozFullscreen, hasMsFullscreen, hasWebkitFullscreenHTMLElement, hasMozFullscreenHTMLElement, hasMsFullscreenHTMLElement, hasWebkitFullscreenDocument, hasMozFullscreenDocument, hasMsFullscreenDocument, type ElementWebkitFullscreen, type ElementMozFullscreen, type ElementMsFullscreen, isMobileDevice, getNetworkInfo, isSlowNetwork, isCellularConnection, THEME } from './utils.js';
import { VOLUME_MUTED_SVG, VOLUME_UNMUTED_SVG } from './icons.js';
import { setupTouchHandlers, createTouchState, type TouchState } from './utils/touchHandlers.js';

/**
 * Enhanced error with additional video loading information
 */
interface EnhancedVideoError extends Error {
  originalError?: Error;
  errorType?: string;
  networkState?: number;
  readyState?: number;
}

export class NativeVideoPlayer {
  private readonly container: HTMLElement;
  private videoElement!: HTMLVideoElement;
  private controlsContainer!: HTMLElement;
  private playButton!: HTMLElement;
  private muteButton!: HTMLElement;
  private progressBar!: HTMLInputElement;
  private timeDisplay!: HTMLElement;
  private fullscreenButton!: HTMLElement;
  private readonly state: VideoPlayerState;
  private onStateChange?: (state: VideoPlayerState) => void;
  // onMuteToggle removed - mute is now controlled by overlay button in VideoPost
  private externalStateListener?: (state: VideoPlayerState) => void;
  private readyResolver?: () => void;
  private readyPromise: Promise<void>;
  private errorHandled: boolean = false;
  private desiredStartTime?: number; // Track desired start time for enforcement
  private startTimeEnforced: boolean = false; // Track if we've successfully enforced startTime
  private isUnloaded: boolean = false;
  private originalVideoUrl?: string; // Store original URL for reload
  private originalStartTime?: number; // Store original start time for reload
  private originalEndTime?: number; // Store original end time for reload
  private readonly isHDMode: boolean = false; // Track if this is HD mode (affects mute button visibility)
  private posterImage?: HTMLImageElement; // Fallback poster image for mobile
  private shouldExtractFirstFrame: boolean = false; // Track if we need to extract first frame as poster
  // Store event handlers for proper cleanup
  private fullscreenChangeHandler?: () => void;
  private webkitFullscreenChangeHandler?: () => void;
  private mozFullscreenChangeHandler?: () => void;
  private msFullscreenChangeHandler?: () => void;
  // Timeout and progress tracking for blocked requests
  private loadTimeoutId?: ReturnType<typeof setTimeout>;
  private stalledTimeoutId?: ReturnType<typeof setTimeout>;
  private waitingTimeoutId?: ReturnType<typeof setTimeout>;
  private lastProgressTime?: number;
  private progressCheckIntervalId?: ReturnType<typeof setInterval>;
  private loadStartTime?: number;
  private stalledHandler?: () => void;
  private waitingHandler?: () => void;
  private progressHandler?: () => void;
  private loadingIndicator?: HTMLElement; // Loading spinner indicator
  // Overlay and touch handling
  private overlay?: HTMLElement; // Play/pause overlay
  private overlayTimeoutId?: ReturnType<typeof setTimeout>; // Timeout for overlay fade
  // Touch tracking for play/pause (using unified touch handler)
  private touchState?: TouchState;
  private touchHandlerCleanup?: () => void;
  // Manual pause tracking - tracks when user manually pauses to prevent autoplay from resuming
  private manuallyPaused: boolean = false;
  // Hover state tracking for overlay visibility
  private isHovered: boolean = false;
  private hoverEnterHandler?: (e: MouseEvent) => void;
  private hoverLeaveHandler?: (e: MouseEvent) => void;
  // Mobile scroll detection
  private isScrollingMobile: boolean = false;
  private scrollTimeoutId?: ReturnType<typeof setTimeout>;
  private scrollHandler?: () => void;
  private playerWrapper?: HTMLElement; // Store reference to player wrapper for hover handlers

  constructor(container: HTMLElement, videoUrl: string, options?: {
    autoplay?: boolean;
    muted?: boolean;
    startTime?: number;
    endTime?: number;
    onStateChange?: (state: VideoPlayerState) => void;
    aggressivePreload?: boolean; // Use 'auto' preload for non-HD videos
    isHDMode?: boolean; // Whether this is HD mode (affects mute button visibility)
    posterUrl?: string; // Poster image URL to display before video loads
    // onMuteToggle removed - mute is now controlled by overlay button in VideoPost
  }) {
    // Validate video URL before proceeding
    if (!videoUrl || !isValidMediaUrl(videoUrl)) {
      const error = new Error(`Invalid video URL: ${videoUrl}`);
      console.error('NativeVideoPlayer: Invalid video URL provided', {
        videoUrl,
        error,
        container: container?.tagName,
      });
      throw error;
    }

    this.container = container;
    this.onStateChange = options?.onStateChange;
    // onMuteToggle removed - mute is now controlled by overlay button in VideoPost
    this.isHDMode = options?.isHDMode ?? false;

    this.state = {
      isPlaying: false,
      isMuted: options?.muted ?? false,
      currentTime: 0,
      duration: 0,
      volume: 1,
      isFullscreen: false,
    };

    this.readyPromise = new Promise<void>((resolve) => { this.readyResolver = resolve; });

    // Store original values for reload
    this.originalVideoUrl = videoUrl;
    this.originalStartTime = options?.startTime;
    this.originalEndTime = options?.endTime;

    this.createVideoElement(videoUrl, {
      autoplay: options?.autoplay,
      muted: options?.muted,
      startTime: options?.startTime,
      endTime: options?.endTime,
      aggressivePreload: options?.aggressivePreload,
      posterUrl: options?.posterUrl,
    });
    this.createControls();
    this.attachEventListeners();
    this.setupHoverHandlers();
    this.setupContainerHoverHandlers();
    this.setupMobileScrollDetection();
  }

  private resolveReady(): void {
    if (this.readyResolver) {
      const resolve = this.readyResolver;
      this.readyResolver = undefined;
      resolve();
    }
  }

  /**
   * Check if video element exists and is still valid (not removed from DOM)
   */
  private isVideoElementValid(): boolean {
    return this.videoElement != null && 
           this.videoElement instanceof HTMLVideoElement &&
           document.contains(this.videoElement);
  }

  waitForReady(timeoutMs: number = 3000): Promise<void> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return this.readyPromise;
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    return Promise.race([
      this.readyPromise,
      new Promise<void>((resolve) => {
        timeoutHandle = setTimeout(() => {
          timeoutHandle = undefined;
          resolve();
        }, timeoutMs);
      }),
    ]).finally(() => {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    });
  }

  /**
   * Check codec support before setting src (helps with HEVC detection)
   */
  private checkCodecSupport(url: string): void {
    // Try to detect HEVC/H.265 files
    const isHevc = url.toLowerCase().includes('hevc') || 
                   url.toLowerCase().includes('h265') ||
                   url.toLowerCase().includes('h.265');
    
    if (isHevc) {
      // Check if browser supports HEVC
      const hevcSupport1 = this.videoElement.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0,mp4a.40.2"');
      const hevcSupport2 = this.videoElement.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0,mp4a.40.2"');
      const hevcSupport3 = this.videoElement.canPlayType('video/mp4; codecs="hev1"');
      const hevcSupport4 = this.videoElement.canPlayType('video/mp4; codecs="hvc1"');
      
      const hevcSupport = hevcSupport1 || hevcSupport2 || hevcSupport3 || hevcSupport4;
      
      // canPlayType returns "" (empty string), "maybe", or "probably"
      // Empty string means not supported
      if (!hevcSupport || hevcSupport.length === 0) {
        console.warn('NativeVideoPlayer: HEVC/H.265 codec may not be supported in this browser', {
          url,
          canPlayType: hevcSupport || '(empty)',
        });
      }
    }
  }

  /**
   * Setup basic video element properties
   */
  private setupVideoElementBasicProperties(options?: { startTime?: number; muted?: boolean; posterUrl?: string }): void {
    // Set poster image if provided
    const isMobile = isMobileDevice();
    if (options?.posterUrl) {
      // On mobile, don't use video element's poster attribute - use fallback image instead
      // This prevents browser from showing video preview/thumbnail instead of static image
      if (!isMobile) {
        this.videoElement.poster = options.posterUrl;
      }
      
      // On mobile, create fallback poster image element and don't use video element's poster
      // This ensures we always show the static image, not a video preview
      if (isMobile) {
        this.createPosterFallback(options.posterUrl);
      }
    } else {
      // No poster URL provided - will extract first frame from video as fallback
      // This is handled after video metadata loads
      // Don't set video element's poster attribute - we'll use extracted frame instead
      this.shouldExtractFirstFrame = true;
    }
    
    // Set object-fit for proper video display
    this.videoElement.style.objectFit = 'cover';
    
    // On mobile, set video element to opacity 0 initially to prevent animated previews
    // Video will fade in smoothly when playing event fires
    if (isMobile) {
      this.videoElement.style.opacity = '0';
      this.videoElement.style.transition = 'opacity 0.3s ease-out';
    }
    
    // Optimize preload strategy for mobile
    // On mobile: use 'metadata' by default to reduce bandwidth
    // On desktop: use 'auto' for non-HD videos, 'metadata' for HD videos
    const hasStartTimeForPreload = typeof options?.startTime === 'number' && Number.isFinite(options.startTime) && options.startTime > 0;
    
    if (isMobile) {
      // Mobile: always start with 'metadata' to save bandwidth
      // Will switch to 'auto' when video is about to play
      this.videoElement.preload = 'metadata';
    } else {
      // Desktop: use 'auto' for non-HD videos, 'metadata' for HD videos
      this.videoElement.preload = hasStartTimeForPreload ? 'metadata' : 'auto';
    }
    
    this.videoElement.playsInline = true; // Required for iOS inline playback
    this.videoElement.muted = options?.muted ?? false; // Default to unmuted (markers don't have sound anyway)
    this.videoElement.loop = true; // Enable looping
    this.videoElement.className = 'video-player__element';
    
    // Mobile-specific attributes
    this.videoElement.setAttribute('playsinline', 'true'); // iOS Safari requires lowercase
    this.videoElement.setAttribute('webkit-playsinline', 'true'); // Legacy iOS support
    this.videoElement.setAttribute('x5-playsinline', 'true'); // Android X5 browser
    this.videoElement.setAttribute('x-webkit-airplay', 'allow'); // AirPlay support
    
    // Prevent video element from receiving focus via tab navigation or card clicks
    // This ensures the video only gets focus when clicked directly
    this.videoElement.setAttribute('tabindex', '-1');
    
    // Apply adaptive buffering based on network conditions
    this.applyAdaptiveBuffering();
  }

  /**
   * Apply adaptive buffering based on network conditions
   * Adjusts video buffering behavior for slow or cellular connections
   */
  private applyAdaptiveBuffering(): void {
    if (!isMobileDevice()) {
      return; // Only apply on mobile
    }

    const networkInfo = getNetworkInfo();
    if (!networkInfo) {
      return; // Network info not available
    }

    // On slow networks or cellular connections, be more conservative with buffering
    if (isSlowNetwork() || isCellularConnection()) {
      // Reduce buffering by setting a lower buffer target
      // This is done implicitly by using 'metadata' preload
      // We can also add additional optimizations here if needed
      if (this.videoElement.preload === 'auto') {
        // If we were going to use 'auto', consider using 'metadata' instead on slow networks
        // But only if not about to play immediately
        this.videoElement.preload = 'metadata';
      }
    }
  }

  /**
   * Switch preload to 'auto' when video is about to play
   * This optimizes bandwidth usage on mobile by only loading full video when needed
   */
  private switchToAutoPreload(): void {
    if (this.videoElement.preload === 'metadata' && isMobileDevice()) {
      // Only switch if on mobile and currently using metadata preload
      this.videoElement.preload = 'auto';
      // Hide fallback poster when switching to auto preload
      this.hidePosterFallback();
    }
  }

  /**
   * Create a fallback poster image element for mobile
   * This ensures the poster is visible even when the video element's poster attribute doesn't display
   * Poster will fade out smoothly when video plays, and fade in when video pauses
   */
  private createPosterFallback(posterUrl: string): void {
    // Remove existing poster fallback if any
    if (this.posterImage) {
      this.posterImage.remove();
    }

    const img = document.createElement('img');
    img.src = posterUrl;
    img.className = 'video-player__poster-fallback';
    img.style.position = 'absolute';
    img.style.top = '0';
    img.style.left = '0';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    // On mobile, put poster above video element (z-index 2) to ensure it covers video
    // Poster starts visible (opacity 1) and will fade out when video plays
    const isMobile = isMobileDevice();
    img.style.zIndex = isMobile ? '2' : '0'; // Above video element on mobile (z-index 2), behind on desktop
    img.style.pointerEvents = 'none';
    img.style.opacity = '1'; // Start visible - will fade out when video plays
    img.style.transition = 'opacity 0.3s ease-out'; // Smooth fade transition
    
    // On mobile, video element starts with opacity 0 (set in setupVideoElementBasicProperties)
    // Video will fade in smoothly when playing event fires
    // We don't show video on loadeddata/canplay - only when actually playing to prevent animated previews
    
    // Add error handler - if poster fails to load, extract first frame from video
    img.addEventListener('error', () => {
      console.warn('NativeVideoPlayer: Poster image failed to load, extracting first frame from video', { posterUrl });
      this.extractFirstFrameAsPoster();
    }, { once: true });
    
    this.posterImage = img;
    
    // Insert before video element in the player wrapper
    const playerWrapper = this.videoElement.parentElement;
    if (playerWrapper) {
      playerWrapper.insertBefore(img, this.videoElement);
    } else {
      // If no wrapper yet, store and insert later
      this.container.appendChild(img);
    }
  }

  /**
   * Extract first frame from video and use as poster
   * Used when screenshot poster is unavailable or fails to load
   */
  private extractFirstFrameAsPoster(): void {
    // Only extract if video element exists and is valid
    if (!this.videoElement?.src) {
      return;
    }

    // Remove existing poster fallback if any
    if (this.posterImage) {
      this.posterImage.remove();
      this.posterImage = undefined;
    }

    // Store original currentTime to restore later
    const originalCurrentTime = this.videoElement.currentTime;
    const originalPaused = this.videoElement.paused;

    // Ensure video is paused
    this.videoElement.pause();

    // Seek to first frame (0 seconds)
    this.videoElement.currentTime = 0;

    // Wait for seeked event to ensure frame is loaded
    const handleSeeked = () => {
      try {
        // Get video dimensions - use actual dimensions if available, otherwise use reasonable defaults
        const videoWidth = this.videoElement.videoWidth || this.videoElement.clientWidth || 1920;
        const videoHeight = this.videoElement.videoHeight || this.videoElement.clientHeight || 1080;
        
        // Ensure we have valid dimensions
        if (videoWidth === 0 || videoHeight === 0) {
          console.warn('NativeVideoPlayer: Video dimensions not available for first frame extraction');
          this.videoElement.removeEventListener('seeked', handleSeeked);
          return;
        }
        
        // Create canvas to capture frame
        const canvas = document.createElement('canvas');
        canvas.width = videoWidth;
        canvas.height = videoHeight;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          console.warn('NativeVideoPlayer: Failed to get canvas context for first frame extraction');
          this.videoElement.removeEventListener('seeked', handleSeeked);
          return;
        }

        // Draw video frame to canvas
        ctx.drawImage(this.videoElement, 0, 0, canvas.width, canvas.height);

        // Convert to data URL
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        
        // Create poster image from data URL
        const img = document.createElement('img');
        img.src = dataUrl;
        img.className = 'video-player__poster-fallback';
        img.style.position = 'absolute';
        img.style.top = '0';
        img.style.left = '0';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        const isMobile = isMobileDevice();
        img.style.zIndex = isMobile ? '2' : '0';
        img.style.pointerEvents = 'none';
        img.style.opacity = '1';
        img.style.transition = 'opacity 0.3s ease-out';

        this.posterImage = img;

        // Insert before video element in the player wrapper
        const playerWrapper = this.videoElement.parentElement;
        if (playerWrapper) {
          playerWrapper.insertBefore(img, this.videoElement);
        } else {
          this.container.appendChild(img);
        }

        // Restore original state if needed
        if (originalCurrentTime > 0 && !originalPaused) {
          // Only restore if we had a startTime and video was playing
          // For most cases, we want to stay at 0
        }
      } catch (error) {
        console.warn('NativeVideoPlayer: Failed to extract first frame from video', error);
      } finally {
        this.videoElement.removeEventListener('seeked', handleSeeked);
      }
    };

    // Add timeout to prevent hanging if seeked never fires
    const timeoutId = setTimeout(() => {
      this.videoElement.removeEventListener('seeked', handleSeeked);
      console.warn('NativeVideoPlayer: Timeout waiting for video seeked event for first frame extraction');
    }, 5000);

    this.videoElement.addEventListener('seeked', () => {
      clearTimeout(timeoutId);
      handleSeeked();
    }, { once: true });
  }

  /**
   * Hide the fallback poster image (fade out)
   * Called when video starts playing to create seamless crossfade
   */
  private hidePosterFallback(): void {
    if (this.posterImage) {
      const isMobile = isMobileDevice();
      // Fade out poster smoothly
      this.posterImage.style.opacity = '0';
      
      // On mobile, keep poster in DOM so we can show it again when video pauses
      // On desktop, remove it after transition to save memory
      if (!isMobile) {
        // Remove after transition
        setTimeout(() => {
          if (this.posterImage) {
            this.posterImage.remove();
            this.posterImage = undefined;
          }
        }, 300);
      }
    }
  }

  /**
   * Show the fallback poster image (mobile only)
   * Used when video pauses to prevent black screen
   * Fades in poster smoothly while video fades out
   */
  private showPosterFallback(): void {
    const isMobile = isMobileDevice();
    if (!isMobile || !this.posterImage) {
      return;
    }

    // Check if poster is still in the DOM (should be on mobile since we don't remove it)
    if (!this.posterImage.isConnected) {
      return;
    }

    // Fade in poster smoothly (opacity 0 → 1)
    this.posterImage.style.opacity = '1';
  }

  /**
   * Set video source for videos with startTime
   */
  private setVideoSourceWithStartTime(videoUrl: string, initialStartTime: number): boolean {
    // HD videos with startTime: use complex approach to enforce startTime
    // Set initial currentTime BEFORE setting src to prevent showing last frame
    try {
      this.videoElement.currentTime = initialStartTime;
    } catch {
      // Ignore - will set in event handlers
    }
    
    // Ensure video is paused to prevent auto-playing
    this.videoElement.pause();
    
    // Now set src - this will trigger loading
    try {
      if (videoUrl && isValidMediaUrl(videoUrl)) {
        this.videoElement.src = videoUrl;
        this.showLoadingIndicator();
      } else {
        // URL is invalid, don't set src to prevent error
        this.errorHandled = true;
        return false;
      }
    } catch {
      // If setting src throws an error, mark as handled and return
      this.errorHandled = true;
      return false;
    }
    
    // Ensure video stays paused after setting src
    this.videoElement.pause();
    
    // Immediately try to set currentTime again after setting src
    // This is critical to prevent showing last frame
    try {
      this.videoElement.currentTime = initialStartTime;
    } catch {
      // Ignore - metadata not loaded yet, will be set in event handlers below
    }
    
    // Use loadstart event to set currentTime as early as possible and ensure paused
    const onLoadStart = () => {
      // Ensure video is paused
      this.videoElement.pause();
      this.showLoadingIndicator(); // Show loading indicator on loadstart as backup
      try {
        if (this.videoElement.readyState >= 0) {
          this.videoElement.currentTime = initialStartTime;
        }
      } catch {
        // Ignore
      }
    };
    this.videoElement.addEventListener('loadstart', onLoadStart, { once: true });
    return true;
  }

  /**
   * Setup end time handler
   */
  private setupEndTimeHandler(endTime?: number): void {
    // Handle end time if provided (only if endTime is greater than a small tolerance)
    // Loop back to 0 when reaching endTime
    if (endTime !== undefined && endTime > 0.25) {
      this.videoElement.addEventListener('timeupdate', () => {
        if (!this.isVideoElementValid()) return;
        if (this.videoElement.currentTime >= endTime) {
          this.videoElement.currentTime = 0;
          // Continue playing if it was playing
          if (!this.videoElement.paused) {
            // Intentionally ignore play() errors - browser will handle autoplay restrictions
            this.videoElement.play().catch(() => {
              // Browser handles autoplay restrictions silently
            });
          }
        }
      });
    }
  }

  /**
   * Setup error handler and load timeout
   */
  private setupErrorHandlerAndTimeout(): void {
    // Add error handler (with guard to prevent loops)
    // Use capture phase to catch errors early and prevent browser logging
    this.videoElement.addEventListener('error', (e) => {
      // Prevent error handler from running multiple times
      if (this.errorHandled) {
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      
      if (!this.isVideoElementValid()) return;
      
      const errorCode = this.videoElement.error?.code;
      const errorMessage = this.videoElement.error?.message;
      
      // Check if this is a known invalid URL error (MediaLoadInvalidURI)
      // Error code 4 = MEDIA_ERR_SRC_NOT_SUPPORTED / MediaLoadInvalidURI
      // Also check for empty/blank error messages (Firefox with privacy.resistFingerprinting)
      const isInvalidUriError = errorCode === 4 || 
        (errorMessage && (errorMessage.includes('MediaLoadInvalidURI') || errorMessage.includes('INVALID_STATE_ERR'))) ||
        (!errorMessage && errorCode === 4); // Firefox may blank the message when privacy.resistFingerprinting is enabled
      
      // Check for codec/format errors (including HEVC)
      const isCodecError = errorCode === 4 && 
        errorMessage &&
        (errorMessage.includes('codec') || 
         errorMessage.includes('format') ||
         errorMessage.includes('not supported') ||
         errorMessage.toLowerCase().includes('hevc') ||
         errorMessage.toLowerCase().includes('h.265'));
      
      if (isInvalidUriError && !isCodecError) {
        // Mark as handled and silently suppress - validation should have caught this
        this.errorHandled = true;
        // Stop propagation to prevent browser from logging the error
        e.stopPropagation();
        e.preventDefault();
        // Don't clear src or do anything that could trigger more events
        return;
      }
      
      // Mark as handled and log errors (including codec errors)
      this.errorHandled = true;
      this.hideLoadingIndicator(); // Hide loading indicator on error
      
      if (isCodecError) {
        console.error('NativeVideoPlayer: Video codec not supported (possibly HEVC/H.265)', {
          error: e,
          errorCode,
          errorMessage,
          src: this.videoElement.src,
          hint: 'HEVC/H.265 codec may not be supported in this browser. Consider using H.264 or transcoding the video.',
        });
      } else {
        console.error('NativeVideoPlayer: Video error', {
          error: e,
          errorCode,
          errorMessage,
          src: this.videoElement.src,
        });
      }
    }, { once: true, capture: true }); // Use capture phase to catch errors early
    
    // Track load start time for timeout detection
    this.loadStartTime = Date.now();
    
    // Set up timeout detection (15 seconds)
    this.loadTimeoutId = setTimeout(() => {
      if (!this.isVideoElementValid()) return;
      if (this.videoElement.readyState === 0) {
        // Video still hasn't loaded after 15 seconds
        this.errorHandled = true;
        console.warn('NativeVideoPlayer: Video load timeout - readyState still 0 after 15 seconds', {
          src: this.videoElement.src,
          networkState: this.videoElement.networkState,
          readyState: this.videoElement.readyState,
        });
      }
    }, 15000);
  }

  /**
   * Setup ready handlers
   */
  private setupReadyHandlers(): void {
    // Clear timeout when video successfully loads
    const clearLoadTimeout = () => {
      if (this.loadTimeoutId) {
        clearTimeout(this.loadTimeoutId);
        this.loadTimeoutId = undefined;
      }
    };
    
    // Resolve ready promise when video can play
    // Don't show video yet - let VideoPost control visibility
    const handleReady = () => {
      // Keep video hidden until ready
      // This prevents flash during transition
      clearLoadTimeout();
      this.hideLoadingIndicator();
      this.resolveReady();
    };
    this.videoElement.addEventListener('loadeddata', handleReady, { once: true });
    this.videoElement.addEventListener('canplay', handleReady, { once: true });
    
    // Also clear timeout on loadedmetadata (video has metadata)
    this.videoElement.addEventListener('loadedmetadata', clearLoadTimeout, { once: true });
    
    // Extract first frame as poster if no poster URL was provided
    if (this.shouldExtractFirstFrame) {
      const extractFirstFrame = () => {
        if (this.isVideoElementValid() && this.videoElement.readyState >= 1) {
          this.extractFirstFrameAsPoster();
        }
      };
      // Try to extract when metadata is loaded
      this.videoElement.addEventListener('loadedmetadata', extractFirstFrame, { once: true });
      // Also try when video can play (in case loadedmetadata fires too early)
      this.videoElement.addEventListener('loadeddata', extractFirstFrame, { once: true });
    }
  }

  /**
   * Setup start time handlers if startTime is provided
   */
  private setupStartTimeHandlers(startTime?: number, aggressivePreload?: boolean): void {
    // If a startTime is provided, ensure we seek to it as soon as metadata is available,
    // and also attempt an immediate seek if already ready.
    const hasStart = typeof startTime === 'number' && Number.isFinite(startTime);
    this.desiredStartTime = hasStart && startTime !== undefined ? Math.max(0, startTime) : undefined;
    this.startTimeEnforced = false;
    
    if (!hasStart || this.desiredStartTime === undefined) {
      return;
    }
    
    // Immediate attempt if metadata is already loaded
    if (this.videoElement.readyState >= 1) {
      this.trySeekToStartTime();
    }
    
    // Ensure seek once metadata is loaded - do this early to prevent showing last frame
    const onMeta = () => {
      // Ensure video is paused to prevent auto-playing
      this.videoElement.pause();
      this.trySeekToStartTime();
      
      // Also check if video is positioned at the end or wrong position and seek immediately
      // This prevents the browser from showing the last frame or starting at 0
      // Check position immediately after trySeek() and also with a delayed check as backup
      const checkAndSeek = () => {
        if (this.desiredStartTime !== undefined && this.videoElement.readyState >= 1) {
          const current = this.videoElement.currentTime;
          const desired = this.desiredStartTime;
          const duration = this.videoElement.duration;
          const isNearEnd = duration > 0 && (duration - current) < 0.5;
          const isPastStart = current > desired + 0.5;
          const isBeforeStart = desired > 0.5 && (desired - current) > 0.5; // Video is significantly before marker start time (e.g., at 0 when should be at 30)
          
          // Seek immediately on metadata load if we're at the wrong position
          if (isNearEnd || isPastStart || isBeforeStart) {
            try {
              this.videoElement.currentTime = desired;
              this.startTimeEnforced = true;
            } catch {
              // Ignore seek errors
            }
          } else if (Math.abs(current - desired) <= 0.1) {
            // If we're at the correct position, mark as enforced
            this.startTimeEnforced = true;
          }
        }
      };
      
      // Check immediately
      checkAndSeek();
      
      // Also check after a short delay as backup (in case seek didn't work immediately)
      setTimeout(checkAndSeek, 50);
      
      // Keep preload as 'metadata'
      // For non-HD videos with aggressivePreload, we can switch to 'auto' after seek completes
      if (aggressivePreload) {
        // Switch to auto preload after metadata is loaded and seek is attempted
        // This allows better loading
        this.videoElement.preload = 'auto';
      }
    };
    this.videoElement.addEventListener('loadedmetadata', onMeta, { once: true });
    this.videoElement.addEventListener('canplay', onMeta, { once: true });
    
    // Also ensure seek when first frame loads - prevents showing last frame
    // This catches cases where browser initially positions video at end or at 0
    const onLoadedData = () => {
      // Ensure video is paused to prevent auto-playing
      this.videoElement.pause();
      
      if (this.desiredStartTime !== undefined && this.videoElement.readyState >= 2) {
        const current = this.videoElement.currentTime;
        const desired = this.desiredStartTime;
        // If video is positioned at or near the end (likely the last frame), seek to start
        // Check if current time is close to duration (within 0.5s) or significantly past startTime
        const duration = this.videoElement.duration;
        const isNearEnd = duration > 0 && (duration - current) < 0.5;
        const isPastStart = current > desired + 0.5;
        const isBeforeStart = desired > 0.5 && (desired - current) > 0.5; // Video is significantly before marker start time (e.g., at 0 when should be at 30)
        
        // Always check and seek if needed, regardless of startTimeEnforced flag
        // This ensures we catch cases where previous seeks didn't work
        if (isNearEnd || isPastStart || isBeforeStart) {
          try {
            this.videoElement.currentTime = desired;
            this.startTimeEnforced = true;
          } catch {
            // Ignore seek errors
          }
        } else if (Math.abs(current - desired) <= 0.1) {
          // If we're at the correct position, mark as enforced
          this.startTimeEnforced = true;
        }
        
        // For non-HD videos with aggressivePreload, switch to auto after loadeddata
        if (aggressivePreload) {
          this.videoElement.preload = 'auto';
        }
      }
    };
    this.videoElement.addEventListener('loadeddata', onLoadedData, { once: true });
    
    // On mobile, also enforce startTime in timeupdate to catch browsers that reset on play()
    // Only enforce if we have a startTime > 0 and video is actually at the wrong position
    const isMobile = isMobileDevice();
    if (isMobile && this.desiredStartTime !== undefined && this.desiredStartTime > 0) {
      const enforceStartTime = () => {
        // Only enforce if we haven't successfully enforced yet, or if video reset to 0
        if (this.videoElement.readyState >= 1 && !this.startTimeEnforced) {
          const current = this.videoElement.currentTime;
          const desired = this.desiredStartTime!;
          const diff = Math.abs(current - desired);
          
          // Only seek if we're significantly off AND video is at 0 or very early
          // This prevents interfering with normal playback
          if (diff > 0.5 && current < 1) {
            try {
              this.videoElement.currentTime = desired;
              this.startTimeEnforced = true;
            } catch {
              // Ignore seek errors
            }
          } else if (diff <= 0.1) {
            // Once we're at or very close to startTime, mark as enforced and stop checking
            this.startTimeEnforced = true;
          }
        }
      };
      // Use a throttled version to avoid excessive seeks
      let lastEnforceTime = 0;
      const throttledEnforce = () => {
        // Stop enforcing once we're at the correct position
        if (this.startTimeEnforced) {
          return;
        }
        const now = Date.now();
        if (now - lastEnforceTime > 200) { // Throttle to every 200ms
          lastEnforceTime = now;
          enforceStartTime();
        }
      };
      this.videoElement.addEventListener('timeupdate', throttledEnforce);
      
      // Add persistent playing event listener to re-seek when video starts playing
      // This catches cases where mobile browsers reset currentTime to 0 on play()
      // Only fire once per play session
      let playingSeekAttempted = false;
      const onPlaying = () => {
        if (this.desiredStartTime !== undefined && this.videoElement.readyState >= 1 && !playingSeekAttempted) {
          const current = this.videoElement.currentTime;
          const desired = this.desiredStartTime;
          const diff = Math.abs(current - desired);
          // If video is significantly off from desired start time (especially if at 0), seek to it
          if (diff > 0.5 && current < 1) {
            try {
              this.videoElement.currentTime = desired;
              this.startTimeEnforced = true;
              playingSeekAttempted = true;
            } catch {
              // Ignore seek errors
            }
          } else if (diff <= 0.1) {
            this.startTimeEnforced = true;
            playingSeekAttempted = true;
          }
        }
      };
      this.videoElement.addEventListener('playing', onPlaying);
      
      // Reset playing seek flag when video pauses
      const onPause = () => {
        playingSeekAttempted = false;
      };
      this.videoElement.addEventListener('pause', onPause);
    }
  }

  /**
   * Set video source for videos without startTime
   */
  private setVideoSourceWithoutStartTime(videoUrl: string): boolean {
    // Simple approach: set src directly, no currentTime manipulation
    // Ensure video is paused to prevent auto-playing
    this.videoElement.pause();
    
    // Set src - this will trigger loading
    try {
      if (videoUrl && isValidMediaUrl(videoUrl)) {
        this.videoElement.src = videoUrl;
        this.showLoadingIndicator();
      } else {
        // URL is invalid, don't set src to prevent error
        this.errorHandled = true;
        return false;
      }
    } catch {
      // If setting src throws an error, mark as handled and return
      this.errorHandled = true;
      return false;
    }
    
    // Ensure video stays paused after setting src
    this.videoElement.pause();
    
    // Show loading indicator on loadstart as backup
    this.videoElement.addEventListener('loadstart', () => {
      this.showLoadingIndicator();
    }, { once: true });
    return true;
  }

  private createVideoElement(videoUrl: string, options?: { autoplay?: boolean; muted?: boolean; startTime?: number; endTime?: number; aggressivePreload?: boolean; posterUrl?: string }): void {
    // Defensive validation - validate URL again before setting src
    // This is a last line of defense in case validation was bypassed
    // If invalid, create element but don't set src - error handler will catch it
    this.videoElement = document.createElement('video');
    
    if (!videoUrl || !isValidMediaUrl(videoUrl)) {
      console.warn('NativeVideoPlayer: Invalid URL detected in createVideoElement, skipping src', {
        videoUrl,
      });
      // Don't set src if URL is invalid - error handler will suppress the error
      // This prevents the MediaLoadInvalidURI error from being logged repeatedly
      return;
    }

    // Check codec support before setting src (helps with HEVC detection)
    this.checkCodecSupport(videoUrl);
    
    // Setup basic video element properties
    this.setupVideoElementBasicProperties(options);
    
    // Determine if we have a startTime that needs to be enforced
    const hasStartTime = typeof options?.startTime === 'number' && Number.isFinite(options.startTime) && options.startTime > 0;
    const initialStartTime = hasStartTime ? Math.max(0, options.startTime as number) : 0;
    
    // Set video source based on whether we have startTime
    const sourceSet = hasStartTime 
      ? this.setVideoSourceWithStartTime(videoUrl, initialStartTime)
      : this.setVideoSourceWithoutStartTime(videoUrl);
    if (!sourceSet) {
      return;
    }
    
    // Handle end time if provided
    this.setupEndTimeHandler(options?.endTime);
    
    // Setup error handler and load timeout
    this.setupErrorHandlerAndTimeout();
    
    // Setup ready handlers
    this.setupReadyHandlers();

    // Setup start time handlers if needed
    this.setupStartTimeHandlers(options?.startTime, options?.aggressivePreload);

    if (this.videoElement.readyState >= 2) {
      this.resolveReady();
    }

    const playerWrapper = document.createElement('div');
    playerWrapper.className = 'video-player';
    playerWrapper.style.position = 'absolute';
    playerWrapper.style.top = '0';
    playerWrapper.style.left = '0';
    playerWrapper.style.width = '100%';
    playerWrapper.style.height = '100%';
    playerWrapper.style.zIndex = '1';
    // Set transparent background
    playerWrapper.style.backgroundColor = 'transparent';
    // Enable hardware acceleration for video wrapper
    playerWrapper.style.transform = 'translateZ(0)';
    playerWrapper.style.willChange = 'transform';
    // Set pointer-events: none by default to prevent blocking clicks on header/footer buttons
    // Will be enabled when hovering over the player container
    playerWrapper.style.pointerEvents = 'none';
    this.playerWrapper = playerWrapper; // Store reference for hover handlers
    
    this.videoElement.style.position = 'relative';
    // On mobile, video z-index is 1 (below poster which is 2) to ensure poster covers video
    // On desktop, z-index is 1 as well
    this.videoElement.style.zIndex = '1';
    // Set background to transparent
    this.videoElement.style.backgroundColor = 'transparent';
    // Set pointer-events: none on video element to prevent blocking clicks on header/footer buttons
    // Will be enabled when hovering over the player container
    this.videoElement.style.pointerEvents = 'none';
    // Enable hardware acceleration for video element
    this.videoElement.style.transform = 'translateZ(0)';
    this.videoElement.style.willChange = 'auto'; // Browser will optimize based on video playback
    // Additional GPU acceleration hints
    this.videoElement.style.backfaceVisibility = 'hidden';
    this.videoElement.style.perspective = '1000px';
    
    playerWrapper.appendChild(this.videoElement);
    
    // Create play/pause overlay
    this.createOverlay();
    if (this.overlay) {
      playerWrapper.appendChild(this.overlay);
    }
    
    // Create loading indicator
    this.loadingIndicator = document.createElement('div');
    this.loadingIndicator.className = 'video-player__loading';
    this.loadingIndicator.style.display = 'none'; // Start hidden, will show when loading starts
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    this.loadingIndicator.appendChild(spinner);
    playerWrapper.appendChild(this.loadingIndicator);
    
    this.container.appendChild(playerWrapper);
  }

  private createControls(): void {
    this.controlsContainer = document.createElement('div');
    this.controlsContainer.className = 'video-player__controls';
    // Ensure controls are always on top
    this.controlsContainer.style.zIndex = '10';
    this.controlsContainer.style.color = THEME.colors.textSecondary;

    // Play/Pause button (hidden - using click on video instead)
    this.playButton = document.createElement('button');
    this.playButton.className = 'video-player__play-button';
    this.playButton.setAttribute('aria-label', 'Play');
    this.playButton.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    this.playButton.style.display = 'none'; // Hide play button
    this.controlsContainer.appendChild(this.playButton);

    // Progress bar
    const progressContainer = document.createElement('div');
    progressContainer.className = 'video-player__progress-container';
    this.progressBar = document.createElement('input');
    this.progressBar.type = 'range';
    this.progressBar.min = '0';
    this.progressBar.max = '100';
    this.progressBar.value = '0';
    this.progressBar.className = 'video-player__progress';
    this.progressBar.setAttribute('aria-label', 'Video progress');
    this.progressBar.style.accentColor = THEME.colors.accentPrimary;
    this.progressBar.style.height = '4px';
    this.progressBar.style.borderRadius = THEME.radius.button;
    this.progressBar.style.background = THEME.colors.border;
    progressContainer.appendChild(this.progressBar);

    // Time display (hidden - cleaner UI)
    this.timeDisplay = document.createElement('span');
    this.timeDisplay.className = 'video-player__time';
    this.timeDisplay.textContent = '0:00 / 0:00';
    this.timeDisplay.style.display = 'none'; // Hide time display
    progressContainer.appendChild(this.timeDisplay);
    this.controlsContainer.appendChild(progressContainer);

    // Mute button (hidden - using overlay button in VideoPost instead)
    this.muteButton = document.createElement('button');
    this.muteButton.className = 'video-player__mute-button';
    this.muteButton.setAttribute('aria-label', 'Mute');
    this.updateMuteButton();
    // Hide mute button - overlay button in VideoPost controls global mute state
    this.muteButton.style.display = 'none';
    this.controlsContainer.appendChild(this.muteButton);

    // Fullscreen button
    this.fullscreenButton = document.createElement('button');
    this.fullscreenButton.className = 'video-player__fullscreen-button';
    this.fullscreenButton.setAttribute('aria-label', 'Fullscreen');
    this.fullscreenButton.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>';
    this.controlsContainer.appendChild(this.fullscreenButton);

    this.container.appendChild(this.controlsContainer);
  }

  private attachEventListeners(): void {
    // Video events
    this.videoElement.addEventListener('loadedmetadata', () => {
      if (!this.isVideoElementValid()) return;
      this.state.duration = this.videoElement.duration;
      this.progressBar.max = this.videoElement.duration.toString();
      this.updateTimeDisplay();
      this.notifyStateChange();
    });

    // Track progress events to detect blocked requests
    this.progressHandler = () => {
      if (!this.isVideoElementValid()) return;
      this.lastProgressTime = Date.now();
    };
    this.videoElement.addEventListener('progress', this.progressHandler);

    // Set up progress check interval (check every 2 seconds)
    this.progressCheckIntervalId = setInterval(() => {
      if (!this.isVideoElementValid()) {
        // Clear interval if element is no longer valid
        if (this.progressCheckIntervalId) {
          clearInterval(this.progressCheckIntervalId);
          this.progressCheckIntervalId = undefined;
        }
        return;
      }
      if (this.lastProgressTime && this.videoElement.readyState === 0) {
        const timeSinceLastProgress = Date.now() - this.lastProgressTime;
        // If no progress for >10 seconds and still at readyState 0, consider it blocked
        if (timeSinceLastProgress > 10000) {
          this.errorHandled = true;
          console.warn('NativeVideoPlayer: Video appears blocked - no progress for >10 seconds', {
            src: this.videoElement.src,
            networkState: this.videoElement.networkState,
            readyState: this.videoElement.readyState,
            timeSinceLastProgress,
          });
          // Clear interval since we've detected the issue
          if (this.progressCheckIntervalId) {
            clearInterval(this.progressCheckIntervalId);
            this.progressCheckIntervalId = undefined;
          }
        }
      }
    }, 2000);

    // Handle stalled event (video stops loading)
    this.stalledHandler = () => {
      if (!this.isVideoElementValid()) return;
      // Clear any existing stalled timeout
      if (this.stalledTimeoutId) {
        clearTimeout(this.stalledTimeoutId);
      }
      // Set timeout - if still stalled after 10 seconds, mark as error
      this.stalledTimeoutId = setTimeout(() => {
        if (!this.isVideoElementValid()) return;
        if (this.videoElement.readyState === 0 || this.videoElement.networkState === 2) {
          this.errorHandled = true;
          console.warn('NativeVideoPlayer: Video stalled for >10 seconds', {
            src: this.videoElement.src,
            networkState: this.videoElement.networkState,
            readyState: this.videoElement.readyState,
          });
        }
      }, 10000);
    };
    this.videoElement.addEventListener('stalled', this.stalledHandler);

    // Handle waiting event (video is buffering)
    this.waitingHandler = () => {
      if (!this.isVideoElementValid()) return;
      // Clear any existing waiting timeout
      if (this.waitingTimeoutId) {
        clearTimeout(this.waitingTimeoutId);
      }
      // Set timeout - if still waiting after 10 seconds, mark as error
      this.waitingTimeoutId = setTimeout(() => {
        if (!this.isVideoElementValid()) return;
        if (this.videoElement.readyState === 0 || this.videoElement.networkState === 2) {
          this.errorHandled = true;
          console.warn('NativeVideoPlayer: Video waiting/buffering for >10 seconds', {
            src: this.videoElement.src,
            networkState: this.videoElement.networkState,
            readyState: this.videoElement.readyState,
          });
        }
      }, 10000);
    };
    this.videoElement.addEventListener('waiting', this.waitingHandler);

    // Clear stalled/waiting timeouts when video makes progress
    const clearStalledWaitingTimeouts = () => {
      if (this.stalledTimeoutId) {
        clearTimeout(this.stalledTimeoutId);
        this.stalledTimeoutId = undefined;
      }
      if (this.waitingTimeoutId) {
        clearTimeout(this.waitingTimeoutId);
        this.waitingTimeoutId = undefined;
      }
    };
    this.videoElement.addEventListener('progress', clearStalledWaitingTimeouts);
    
    // Update overlay when video becomes ready (but don't show unless hovered)
    const handleReady = () => {
      clearStalledWaitingTimeouts();
      // Only update overlay state if already hovered - don't show on initial ready
      if (this.isHovered) {
        this.updateOverlayState();
      }
    };
    this.videoElement.addEventListener('canplay', handleReady, { once: true });
    this.videoElement.addEventListener('loadeddata', handleReady, { once: true });

    // Fullscreen change events (desktop and Android)
    // Store handlers for proper cleanup
    this.fullscreenChangeHandler = () => this.handleFullscreenChange();
    this.webkitFullscreenChangeHandler = () => this.handleFullscreenChange();
    this.mozFullscreenChangeHandler = () => this.handleFullscreenChange();
    this.msFullscreenChangeHandler = () => this.handleFullscreenChange();
    
    document.addEventListener('fullscreenchange', this.fullscreenChangeHandler);
    document.addEventListener('webkitfullscreenchange', this.webkitFullscreenChangeHandler);
    document.addEventListener('mozfullscreenchange', this.mozFullscreenChangeHandler);
    document.addEventListener('MSFullscreenChange', this.msFullscreenChangeHandler);

    // iOS fullscreen events
    this.videoElement.addEventListener('webkitbeginfullscreen', () => {
      if (!this.isVideoElementValid()) return;
      this.state.isFullscreen = true;
      this.notifyStateChange();
    });
    this.videoElement.addEventListener('webkitendfullscreen', () => {
      if (!this.isVideoElementValid()) return;
      this.state.isFullscreen = false;
      this.notifyStateChange();
    });

    this.videoElement.addEventListener('timeupdate', () => {
      if (!this.isVideoElementValid()) return;
      this.state.currentTime = this.videoElement.currentTime;
      this.progressBar.value = this.videoElement.currentTime.toString();
      this.updateTimeDisplay();
    });

    this.videoElement.addEventListener('play', () => {
      if (!this.isVideoElementValid()) return;
      this.state.isPlaying = true;
      this.updatePlayButton();
      this.updateOverlayState();
      
      // On mobile, make video visible when play() is called to ensure audio works
      // Some mobile browsers require video to be visible for audio playback
      const isMobile = isMobileDevice();
      if (isMobile) {
        // Fade in video (opacity 0 → 1) when play() is called
        // This ensures audio works on mobile while still preventing animated previews
        this.videoElement.style.opacity = '1';
      }
      
      this.notifyStateChange();
    });

    // Use 'playing' event for poster crossfade - fires when video actually starts rendering
    // This ensures poster fades out smoothly when video is actually playing
    this.videoElement.addEventListener('playing', () => {
      if (!this.isVideoElementValid()) return;
      
      // On mobile, fade out poster when video is actually playing
      const isMobile = isMobileDevice();
      if (isMobile) {
        // Fade out poster (opacity 1 → 0) when video starts rendering
        this.hidePosterFallback();
      }
    });

    this.videoElement.addEventListener('pause', () => {
      if (!this.isVideoElementValid()) return;
      this.state.isPlaying = false;
      this.updatePlayButton();
      this.updateOverlayState();
      
      // On pause, keep video visible to show current frame
      // No need to fade to poster - video frame is already visible
      
      this.notifyStateChange();
    });

    this.videoElement.addEventListener('volumechange', () => {
      if (!this.isVideoElementValid()) return;
      this.state.volume = this.videoElement.volume;
      this.state.isMuted = this.videoElement.muted;
      this.updateMuteButton();
      this.notifyStateChange();
    });

    // Control buttons
    this.playButton.addEventListener('click', () => this.togglePlay());
    // Mute button click handler removed - using overlay button in VideoPost instead
    this.fullscreenButton.addEventListener('click', () => this.toggleFullscreen());

    // Progress bar
    this.progressBar.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      this.seekTo(Number.parseFloat(target.value));
    });

    // Video element click/touch handlers for play/pause
    this.setupVideoClickHandlers();
    
    // Don't show overlay initially - only show on hover
    // Overlay will be shown when user hovers over video element
  }

  /**
   * Create play/pause overlay element
   */
  private createOverlay(): void {
    this.overlay = document.createElement('div');
    this.overlay.className = 'video-player__overlay';
    this.overlay.style.position = 'absolute';
    this.overlay.style.top = '50%';
    this.overlay.style.left = '50%';
    this.overlay.style.transform = 'translate(-50%, -50%)';
    this.overlay.style.width = '80px';
    this.overlay.style.height = '80px';
    this.overlay.style.borderRadius = '50%';
    this.overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
    this.overlay.style.display = 'flex';
    this.overlay.style.alignItems = 'center';
    this.overlay.style.justifyContent = 'center';
    this.overlay.style.zIndex = '5';
    this.overlay.style.pointerEvents = 'none';
    // Start hidden - only show on hover
    this.overlay.style.opacity = '0';
    this.overlay.style.transition = 'opacity 0.3s ease-out';
    this.overlay.innerHTML = '<svg viewBox="0 0 24 24" width="48" height="48" fill="white"><path d="M8 5v14l11-7z"/></svg>';
  }

  /**
   * Show play/pause overlay (temporary, fades out after 1.5s)
   */
  private showOverlay(isPlaying: boolean): void {
    if (!this.overlay) return;
    
    // Clear any existing timeout
    if (this.overlayTimeoutId) {
      clearTimeout(this.overlayTimeoutId);
    }
    
    // Update icon based on play state
    if (isPlaying) {
      this.overlay.innerHTML = '<svg viewBox="0 0 24 24" width="48" height="48" fill="white"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>';
    } else {
      this.overlay.innerHTML = '<svg viewBox="0 0 24 24" width="48" height="48" fill="white"><path d="M8 5v14l11-7z"/></svg>';
    }
    
    // Show overlay
    this.overlay.style.opacity = '1';
    
    // Hide after 1.5 seconds
    this.overlayTimeoutId = setTimeout(() => {
      if (this.overlay) {
        this.overlay.style.opacity = '0';
      }
      this.overlayTimeoutId = undefined;
    }, 1500);
  }

  /**
   * Update overlay state based on video play/pause state and hover state
   * Shows play icon only when hovered, paused, and ready (and not scrolling on mobile)
   */
  private updateOverlayState(): void {
    if (!this.overlay || !this.isVideoElementValid()) return;
    
    const isPaused = this.videoElement.paused;
    const isReady = this.videoElement.readyState > 0;
    const isMobile = isMobileDevice();
    
    // Clear any existing timeout (we want persistent display for paused state when hovered)
    if (this.overlayTimeoutId) {
      clearTimeout(this.overlayTimeoutId);
      this.overlayTimeoutId = undefined;
    }
    
    // Only show overlay when:
    // 1. Video is paused and ready
    // 2. User is hovering over the player
    // 3. Not scrolling on mobile
    if (isPaused && isReady && this.isHovered && (!isMobile || !this.isScrollingMobile)) {
      // Video is paused and ready, and user is hovering - show play icon
      this.overlay.innerHTML = '<svg viewBox="0 0 24 24" width="48" height="48" fill="white"><path d="M8 5v14l11-7z"/></svg>';
      this.overlay.style.opacity = '1';
    } else {
      // Video is playing, not ready, not hovered, or scrolling on mobile - hide overlay
      this.overlay.style.opacity = '0';
    }
  }

  /**
   * Setup hover handlers for video player overlay
   */
  private setupHoverHandlers(): void {
    if (!this.isVideoElementValid()) return;
    
    this.hoverEnterHandler = (_e: MouseEvent) => {
      // User is hovering over the video element
      this.isHovered = true;
      this.updateOverlayState();
    };
    
    this.hoverLeaveHandler = (e: MouseEvent) => {
      // Check if we're leaving to go to buttons/footer/header
      const relatedTarget = e.relatedTarget as HTMLElement | null;
      if (relatedTarget) {
        // If moving to footer, header, or button elements, don't clear hover yet
        // This prevents flicker when moving mouse from video to buttons
        if (relatedTarget.closest('.video-post__footer') || 
            relatedTarget.closest('.video-post__header') ||
            relatedTarget.closest('button')) {
          // Keep hover state but hide overlay since we're not over video anymore
          this.isHovered = false;
          this.updateOverlayState();
          return;
        }
      }
      // Leaving video area - clear hover
      this.isHovered = false;
      this.updateOverlayState();
    };
    
    // Attach to video element itself - this ensures we only detect hover over the actual video
    this.videoElement.addEventListener('mouseenter', this.hoverEnterHandler);
    this.videoElement.addEventListener('mouseleave', this.hoverLeaveHandler);
  }

  /**
   * Setup hover handlers for the container to enable pointer-events on video wrapper
   * This allows the video to be interactive when hovering over the player container area
   */
  private setupContainerHoverHandlers(): void {
    if (!this.playerWrapper) return;
    
    const containerEnterHandler = () => {
      // Enable pointer-events when hovering over the container
      if (this.playerWrapper) {
        this.playerWrapper.style.pointerEvents = 'auto';
      }
      // Also enable pointer-events on the video element itself
      if (this.isVideoElementValid()) {
        this.videoElement.style.pointerEvents = 'auto';
      }
    };
    
    const containerLeaveHandler = (e: MouseEvent) => {
      // Check if we're leaving to go to buttons/footer/header
      const relatedTarget = e.relatedTarget as HTMLElement | null;
      if (relatedTarget) {
        // If moving to footer, header, or button elements, disable pointer-events
        if (relatedTarget.closest('.video-post__footer') || 
            relatedTarget.closest('.video-post__header') ||
            relatedTarget.closest('button')) {
          if (this.playerWrapper) {
            this.playerWrapper.style.pointerEvents = 'none';
          }
          // Also disable pointer-events on the video element
          if (this.isVideoElementValid()) {
            this.videoElement.style.pointerEvents = 'none';
          }
          return;
        }
      }
      // Leaving container area - disable pointer-events
      if (this.playerWrapper) {
        this.playerWrapper.style.pointerEvents = 'none';
      }
      // Also disable pointer-events on the video element
      if (this.isVideoElementValid()) {
        this.videoElement.style.pointerEvents = 'none';
      }
    };
    
    // Attach to container to enable pointer-events when hovering over player area
    this.container.addEventListener('mouseenter', containerEnterHandler);
    this.container.addEventListener('mouseleave', containerLeaveHandler);
  }

  /**
   * Setup mobile scroll detection to prevent showing overlay during scrolling
   */
  private setupMobileScrollDetection(): void {
    const isMobile = isMobileDevice();
    if (!isMobile) return;
    
    let lastScrollY = globalThis.scrollY || globalThis.pageYOffset;
    
    this.scrollHandler = () => {
      const currentScrollY = globalThis.scrollY || globalThis.pageYOffset;
      const scrollDelta = Math.abs(currentScrollY - lastScrollY);
      
      // If scroll delta is significant, user is scrolling
      if (scrollDelta > 5) {
        this.isScrollingMobile = true;
        this.updateOverlayState(); // Hide overlay during scroll
        
        // Clear existing timeout
        if (this.scrollTimeoutId) {
          clearTimeout(this.scrollTimeoutId);
        }
        
        // Set timeout to clear scroll state after scroll ends
        this.scrollTimeoutId = setTimeout(() => {
          this.isScrollingMobile = false;
          this.updateOverlayState(); // Show overlay again if hovered
          this.scrollTimeoutId = undefined;
        }, 150);
      }
      
      lastScrollY = currentScrollY;
    };
    
    // Use passive listener for better scroll performance
    window.addEventListener('scroll', this.scrollHandler, { passive: true });
  }

  /**
   * Setup click and touch handlers for video element
   */
  private setupVideoClickHandlers(): void {
    const isMobile = isMobileDevice();
    
    if (isMobile) {
      // Mobile: use unified touch handler utility
      this.touchState = createTouchState();
      
      this.touchHandlerCleanup = setupTouchHandlers(this.videoElement, {
        onTap: (e) => {
          // Single tap - toggle play/pause
          e.preventDefault();
          e.stopImmediatePropagation(); // Prevent other handlers but allow parent handlers
          
          // Don't show overlay during tap - only show when actually paused
          // The play/pause event handlers will update overlay state correctly
          this.togglePlay();
        },
        onDoubleTap: (e) => {
          // Double tap - toggle fullscreen
          e.preventDefault();
          e.stopImmediatePropagation(); // Prevent other handlers but allow parent handlers
          
          // Don't show overlay for double tap - just toggle fullscreen
          this.toggleFullscreen();
        },
        preventDefault: true,
        stopImmediatePropagation: true,
      });
    } else {
      // Desktop: use click event
      let clickCount = 0;
      let clickTimer: ReturnType<typeof setTimeout> | undefined;
      const doubleTapTimeThreshold = 300; // ms - time window for double tap
      
      this.videoElement.addEventListener('click', (e) => {
        // Only handle clicks directly on the video element, not bubbled from child elements
        if (e.target !== this.videoElement) {
          return;
        }
        
        // Stop propagation immediately to prevent event from bubbling to card container
        e.stopPropagation();
        
        clickCount++;
        
        if (clickCount === 1) {
          // Wait to see if there's a second click
          clickTimer = setTimeout(() => {
            // Single click - toggle play/pause
            this.togglePlay();
            clickCount = 0;
            clickTimer = undefined;
          }, doubleTapTimeThreshold);
        } else if (clickCount === 2) {
          // Double click - toggle fullscreen
          if (clickTimer) {
            clearTimeout(clickTimer);
            clickTimer = undefined;
          }
          e.preventDefault();
          this.toggleFullscreen();
          clickCount = 0;
        }
      });
    }
  }

  private updatePlayButton(): void {
    if (this.state.isPlaying) {
      this.playButton.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>';
      this.playButton.setAttribute('aria-label', 'Pause');
    } else {
      this.playButton.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
      this.playButton.setAttribute('aria-label', 'Play');
    }
  }

  private updateMuteButton(): void {
    if (this.state.isMuted || this.state.volume === 0) {
      this.muteButton.innerHTML = VOLUME_MUTED_SVG;
      this.muteButton.setAttribute('aria-label', 'Unmute');
    } else {
      this.muteButton.innerHTML = VOLUME_UNMUTED_SVG;
      this.muteButton.setAttribute('aria-label', 'Mute');
    }
  }

  private updateTimeDisplay(): void {
    const current = formatDuration(this.state.currentTime);
    const total = formatDuration(this.state.duration);
    this.timeDisplay.textContent = `${current} / ${total}`;
  }

  private showLoadingIndicator(): void {
    if (this.loadingIndicator) {
      this.loadingIndicator.style.display = 'flex';
    }
  }

  private hideLoadingIndicator(): void {
    if (this.loadingIndicator) {
      this.loadingIndicator.style.display = 'none';
    }
  }

  private notifyStateChange(): void {
    const snapshot = { ...this.state };
    if (this.onStateChange) {
      this.onStateChange(snapshot);
    }
    if (this.externalStateListener) {
      this.externalStateListener(snapshot);
    }
  }

  setStateChangeListener(listener?: (state: VideoPlayerState) => void): void {
    this.externalStateListener = listener;
  }

  /**
   * Prepare video for playback (mute on mobile, wait for ready state)
   */
  private async prepareForPlay(isMobile: boolean): Promise<void> {
    // On mobile, mute for autoplay policies if not already muted
    if (isMobile && !this.videoElement.muted) {
      this.videoElement.muted = true;
      this.state.isMuted = true;
      this.updateMuteButton();
    }
    const minReadyState = isMobile ? 2 : 3; // Lower threshold on mobile
    
    // Wait for video to be ready if not already (shorter wait on mobile)
    if (this.videoElement.readyState < minReadyState) {
      try {
        const timeout = isMobile ? 1000 : 3000;
        await this.waitUntilCanPlay(timeout);
      } catch (e) {
        // On mobile, try playing even if not fully ready
        if (!isMobile || this.videoElement.readyState < 1) {
          console.warn('NativeVideoPlayer: Video not fully ready, attempting play anyway', e);
        }
      }
    }
  }

  /**
   * Set start time before play if needed
   */
  private setStartTimeBeforePlay(isMobile: boolean): void {
    if (this.desiredStartTime === undefined || this.desiredStartTime <= 0 || this.videoElement.readyState < 1) {
      return;
    }
    
    try {
      const currentTime = this.videoElement.currentTime;
      // Only set to desiredStartTime if:
      // 1. Video is at or near the beginning (< 1 second), OR
      // 2. Video is at or before the startTime (for initial load)
      // This preserves the paused position if video was paused mid-playback
      if (currentTime < 1 || currentTime <= this.desiredStartTime) {
        // Reset flag to allow re-seeking
        if (isMobile) {
          this.startTimeEnforced = false;
        }
        this.videoElement.currentTime = this.desiredStartTime;
      }
    } catch {
      // Ignore seek errors
    }
  }

  /**
   * Perform re-seek after play() in case browser reset currentTime
   */
  private performReSeekAfterPlay(): void {
    if (this.desiredStartTime === undefined || this.desiredStartTime <= 0) {
      return;
    }
    
    const performReSeek = (attempt: number = 0) => {
      if (!this.isVideoElementValid()) return;
      try {
        if (this.videoElement.readyState >= 1) {
          const current = this.videoElement.currentTime;
          const desired = this.desiredStartTime!;
          const diff = Math.abs(current - desired);
          
          // Only seek if video is significantly off AND:
          // 1. At 0 or very early (< 1 second), OR
          // 2. Before the startTime (for initial load)
          // This preserves the paused position if video was paused mid-playback
          if (diff > 0.5 && (current < 1 || current < desired)) {
            this.videoElement.currentTime = desired;
            this.startTimeEnforced = true;
            
            // For HD videos, make 1 additional attempt after a delay
            // Attempt 0: immediate (requestAnimationFrame)
            // Attempt 1: after 300ms
            if (attempt < 1) {
              setTimeout(() => performReSeek(attempt + 1), 300);
            }
          } else if (diff <= 0.1) {
            // Successfully at desired time, mark as enforced
            this.startTimeEnforced = true;
          }
        } else if (attempt < 1) {
          // Video not ready yet, try again after a delay
          setTimeout(() => performReSeek(attempt + 1), 300);
        }
      } catch {
        // Ignore seek errors
      }
    };
    
    // Start first attempt using requestAnimationFrame to ensure play() has fully started
    requestAnimationFrame(() => performReSeek(0));
  }

  /**
   * Handle play error and enhance with load failure information
   */
  private handlePlayError(err: unknown): never {
    const isLoadFailure = this.hasLoadError();
    const errorType = isLoadFailure ? this.getLoadErrorType() : null;
    
    const isValid = this.isVideoElementValid();
    console.error('NativeVideoPlayer: play() failed', {
      error: err,
      readyState: isValid ? this.videoElement.readyState : 'N/A',
      paused: isValid ? this.videoElement.paused : 'N/A',
      muted: isValid ? this.videoElement.muted : 'N/A',
      src: isValid ? this.videoElement.src : 'N/A',
      networkState: isValid ? this.videoElement.networkState : 'N/A',
      isLoadFailure,
      errorType
    });
    
    // Enhance error with load failure information
    if (isLoadFailure && errorType && isValid) {
      const enhancedError: EnhancedVideoError = new Error(`Video load failed: ${errorType}`);
      enhancedError.originalError = err instanceof Error ? err : undefined;
      enhancedError.errorType = errorType;
      enhancedError.networkState = this.videoElement.networkState;
      enhancedError.readyState = this.videoElement.readyState;
      throw enhancedError;
    }
    
    throw err;
  }

  async play(): Promise<void> {
    if (!this.isVideoElementValid()) {
      throw new Error('Video element is not valid');
    }
    
    const isMobile = isMobileDevice();
    
    // Switch to auto preload when about to play (mobile optimization)
    this.switchToAutoPreload();
    
    await this.prepareForPlay(isMobile);
    
    // Ensure video element is in the DOM and visible
    if (!this.videoElement.isConnected) {
      throw new Error('Video element not in DOM');
    }
    
    // Hint browser to allow autoplay of muted content
    this.videoElement.autoplay = true;
    
    // Ensure startTime is set right before play (browsers may reset on play)
    this.setStartTimeBeforePlay(isMobile);
    
    try {
      const playPromise = this.videoElement.play();
      if (playPromise !== undefined) {
        await playPromise;
        
        // Re-seek after play() in case browser reset currentTime
        this.performReSeekAfterPlay();
        
        // Update state after successful play
        if (this.isVideoElementValid()) {
          this.state.isPlaying = !this.videoElement.paused;
          // Clear manual pause flag when play succeeds (user or autoplay)
          // This allows autoplay to work, but manual pause will set it again
          this.manuallyPaused = false;
          this.updatePlayButton();
          this.notifyStateChange();
        }
      }
    } catch (err: unknown) {
      this.handlePlayError(err);
    }
  }

  pause(): void {
    if (!this.isVideoElementValid()) return;
    this.videoElement.pause();
    // Don't set manuallyPaused here - only set it when called from user interaction (togglePlay)
  }

  /**
   * Pause video and mark as manually paused by user
   * This prevents autoplay from resuming the video
   */
  pauseManually(): void {
    if (!this.isVideoElementValid()) return;
    this.manuallyPaused = true;
    this.videoElement.pause();
  }

  /**
   * Check if video was manually paused by user
   */
  isManuallyPaused(): boolean {
    return this.manuallyPaused;
  }

  /**
   * Clear manual pause flag (called when user explicitly plays or video becomes invisible)
   */
  clearManualPause(): void {
    this.manuallyPaused = false;
  }

  /**
   * Check if the video is currently playing
   */
  isPlaying(): boolean {
    if (!this.isVideoElementValid()) return false;
    return !this.videoElement.paused && !this.videoElement.ended && this.videoElement.readyState > 0;
  }

  togglePlay(): void {
    const wasPlaying = this.state.isPlaying;
    if (wasPlaying) {
      // User manually paused - mark as manually paused
      this.pauseManually();
    } else {
      // User manually played - clear manual pause flag
      this.clearManualPause();
      this.play();
    }
    // Don't show overlay during interaction - play/pause event handlers will update overlay state
    // Overlay will only show when video is actually paused (via updateOverlayState)
  }

  // toggleMute() removed - mute is now controlled by overlay button in VideoPost

  setMuted(isMuted: boolean): void {
    if (!this.isVideoElementValid()) return;
    this.videoElement.muted = !!isMuted;
    this.state.isMuted = this.videoElement.muted;
    this.updateMuteButton();
  }

  setVolume(volume: number): void {
    if (!this.isVideoElementValid()) return;
    // Clamp volume between 0 and 1
    const clampedVolume = Math.max(0, Math.min(1, volume));
    this.videoElement.volume = clampedVolume;
    this.state.volume = clampedVolume;
    // Update mute button state if volume is 0
    this.updateMuteButton();
  }

  seekTo(time: number): void {
    if (!this.isVideoElementValid()) return;
    this.videoElement.currentTime = time;
  }

  getVideoElement(): HTMLVideoElement {
    return this.videoElement;
  }

  /**
   * Check if video has exceeded load timeout
   */
  private hasLoadTimeout(): boolean {
    if (!this.isVideoElementValid() || !this.loadStartTime || this.videoElement.readyState !== 0) {
      return false;
    }
    const timeSinceLoadStart = Date.now() - this.loadStartTime;
    return timeSinceLoadStart > 15000;
  }

  /**
   * Check if video is in a stuck loading state
   */
  private isStuckLoading(): boolean {
    if (!this.isVideoElementValid() || this.videoElement.networkState !== 2 || this.videoElement.readyState !== 0) {
      return false;
    }
    return this.hasLoadTimeout();
  }

  /**
   * Check if video has a load error
   */
  hasLoadError(): boolean {
    if (!this.isVideoElementValid()) return false;
    
    // networkState 3 = NETWORK_NO_SOURCE (no source available)
    if (this.videoElement.networkState === 3) {
      return true;
    }
    
    // Check for timeout
    if (this.hasLoadTimeout()) {
      return true;
    }
    
    // Check for stuck loading state
    if (this.isStuckLoading()) {
      return true;
    }
    
    // Check for networkState 1 (NETWORK_IDLE) with readyState 0 (indicates failed load)
    if (this.videoElement.networkState === 1 && this.videoElement.readyState === 0) {
      return true;
    }
    
    // Check if error was explicitly handled (from timeout, stalled, waiting, etc.)
    if (this.errorHandled && this.videoElement.readyState === 0) {
      return true;
    }
    
    // Original check: readyState 0 with networkState !== 0
    if (this.videoElement.readyState === 0 && this.videoElement.networkState !== 0) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if error is a network-related error
   */
  private isNetworkError(): boolean {
    if (!this.isVideoElementValid()) {
      return false;
    }
    
    // Check for explicit network error
    if (this.videoElement.networkState === 3) {
      return true;
    }
    
    // Check for blocked request (networkState 2 stuck or networkState 1 with readyState 0)
    if ((this.videoElement.networkState === 2 || this.videoElement.networkState === 1) && 
        this.videoElement.readyState === 0) {
      // If we've been in this state for >15 seconds, it's a network issue
      if (this.hasLoadTimeout()) {
        return true;
      }
      // Otherwise, still likely a network issue
      return true;
    }
    
    // Check if error was explicitly handled (from stalled/waiting/progress timeout)
    if (this.errorHandled && this.videoElement.readyState === 0) {
      return true;
    }
    
    return false;
  }

  /**
   * Get the type of load error
   */
  getLoadErrorType(): 'timeout' | 'network' | 'play' | null {
    if (!this.isVideoElementValid()) return null;
    
    // Check for timeout (readyState 0 for >15 seconds)
    if (this.hasLoadTimeout()) {
      return 'timeout';
    }
    
    // Check for network error
    if (this.isNetworkError()) {
      return 'network';
    }
    
    // Original check: readyState 0 with networkState !== 0
    if (this.videoElement.readyState === 0 && this.videoElement.networkState !== 0) {
      return 'play';
    }
    
    return null;
  }

  /**
   * Enter fullscreen on iOS
   */
  private enterIOSFullscreen(): void {
    if (hasWebkitFullscreen(this.videoElement)) {
      const element = this.videoElement as ElementWebkitFullscreen;
      if (element.webkitEnterFullscreen) {
        try {
          element.webkitEnterFullscreen();
          // State will be updated via webkitbeginfullscreen event
        } catch (error) {
          console.error('Failed to enter fullscreen on iOS', error);
        }
      } else {
        console.warn('Fullscreen not supported on this iOS device');
      }
    } else {
      console.warn('Fullscreen not supported on this iOS device');
    }
  }

  /**
   * Get video element fullscreen request function for Android
   */
  private getVideoFullscreenRequest(): (() => Promise<void>) | undefined {
    if (this.videoElement.requestFullscreen) {
      return this.videoElement.requestFullscreen.bind(this.videoElement);
    }
    if (hasWebkitFullscreen(this.videoElement)) {
      const element = this.videoElement as ElementWebkitFullscreen;
      if (element.webkitRequestFullscreen) {
        return () => element.webkitRequestFullscreen!();
      }
    }
    if (hasMozFullscreen(this.videoElement)) {
      const element = this.videoElement as ElementMozFullscreen;
      if (element.mozRequestFullscreen) {
        return () => element.mozRequestFullscreen!();
      }
    }
    if (hasMsFullscreen(this.videoElement)) {
      const element = this.videoElement as ElementMsFullscreen;
      if (element.msRequestFullscreen) {
        return () => element.msRequestFullscreen!();
      }
    }
    return undefined;
  }

  /**
   * Enter fullscreen on Android
   */
  private enterAndroidFullscreen(): void {
    const videoRequestFullscreen = this.getVideoFullscreenRequest();
    if (videoRequestFullscreen) {
      videoRequestFullscreen().then(() => {
        this.state.isFullscreen = true;
        this.notifyStateChange();
      }).catch((error: unknown) => {
        console.error('Failed to enter fullscreen on Android', error);
        // Fallback to container fullscreen
        this.tryContainerFullscreen();
      });
    } else {
      // Fallback to container fullscreen
      this.tryContainerFullscreen();
    }
  }

  toggleFullscreen(): void {
    if (!this.isVideoElementValid()) return;
    
    const isMobile = isMobileDevice();
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (isIOS) {
      this.enterIOSFullscreen();
    } else if (isMobile) {
      this.enterAndroidFullscreen();
    } else {
      // Desktop: Use container fullscreen
      this.tryContainerFullscreen();
    }
  }

  private tryContainerFullscreen(): void {
    const containerRequestFullscreen =
      this.container.requestFullscreen ||
      (hasWebkitFullscreenHTMLElement(this.container) && this.container.webkitRequestFullscreen) ||
      (hasMozFullscreenHTMLElement(this.container) && this.container.mozRequestFullscreen) ||
      (hasMsFullscreenHTMLElement(this.container) && this.container.msRequestFullscreen);

    if (this.isFullscreen()) {
      const exitFullscreen =
        document.exitFullscreen ||
        (hasWebkitFullscreenDocument(document) && document.webkitExitFullscreen) ||
        (hasMozFullscreenDocument(document) && document.mozCancelFullscreen) ||
        (hasMsFullscreenDocument(document) && document.msExitFullscreen);

      if (exitFullscreen) {
        exitFullscreen.call(document).then(() => {
          this.state.isFullscreen = false;
          this.notifyStateChange();
        }).catch((error: unknown) => {
          console.error('Failed to exit fullscreen', error);
        });
      }
      return;
    }
    
    if (containerRequestFullscreen) {
      containerRequestFullscreen.call(this.container).then(() => {
        this.state.isFullscreen = true;
        this.notifyStateChange();
      }).catch((error: unknown) => {
        console.error('Failed to enter fullscreen', error);
      });
    }
  }

  private isFullscreen(): boolean {
    return !!(
      document.fullscreenElement ||
      (hasWebkitFullscreenDocument(document) && document.webkitFullscreenElement) ||
      (hasMozFullscreenDocument(document) && document.mozFullScreenElement) ||
      (hasMsFullscreenDocument(document) && document.msFullscreenElement)
    );
  }

  private handleFullscreenChange(): void {
    const wasFullscreen = this.state.isFullscreen;
    const isNowFullscreen = this.isFullscreen();
    
    if (wasFullscreen !== isNowFullscreen) {
      this.state.isFullscreen = isNowFullscreen;
      this.notifyStateChange();
    }
  }

  getState(): VideoPlayerState {
    return { ...this.state };
  }

  /**
   * Wait until the video can play (readyState >= 4 for HAVE_ENOUGH_DATA)
   * On mobile, accepts lower readyState to start playing faster
   */
  async waitUntilCanPlay(timeoutMs: number = 5000): Promise<void> {
    const isMobile = isMobileDevice();
    // On mobile, accept readyState >= 2 (HAVE_CURRENT_DATA) for faster start
    // On very slow networks, accept readyState >= 1 (HAVE_METADATA) for even faster start
    const isSlow = isSlowNetwork();
    let minReadyState: number;
    if (isMobile && isSlow) {
      minReadyState = 1;
    } else if (isMobile) {
      minReadyState = 2;
    } else {
      minReadyState = 4;
    }
    
    // Check if already ready
    if (this.videoElement.readyState >= minReadyState) {
      return;
    }
    
    // Wait for canplay event (faster than canplaythrough on mobile)
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        // On mobile, be more lenient - accept lower readyState
        if (this.videoElement.readyState >= minReadyState) {
          resolve();
        } else if (isMobile && this.videoElement.readyState >= 1) {
          // On mobile, even HAVE_METADATA (1) might be enough to start
          resolve();
        } else {
          const timeoutError: EnhancedVideoError = new Error('Video not ready within timeout');
          timeoutError.errorType = 'timeout';
          timeoutError.readyState = this.videoElement.readyState;
          timeoutError.networkState = this.videoElement.networkState;
          reject(timeoutError);
        }
      }, timeoutMs);
      
      const onCanPlay = () => {
        cleanup();
        resolve();
      };
      
      const onLoadedData = () => {
        // If we have enough data, resolve early
        if (this.videoElement.readyState >= minReadyState) {
          cleanup();
          resolve();
        }
      };
      
      const cleanup = () => {
        clearTimeout(timeout);
        if (this.isVideoElementValid()) {
          try {
            this.videoElement.removeEventListener('canplay', onCanPlay);
            this.videoElement.removeEventListener('loadeddata', onLoadedData);
          } catch {
            // Element may have been removed, ignore
          }
        }
      };
      
      // On mobile, use 'canplay' instead of 'canplaythrough' for faster start
      const eventName = isMobile ? 'canplay' : 'canplaythrough';
      this.videoElement.addEventListener(eventName, onCanPlay, { once: true });
      this.videoElement.addEventListener('loadeddata', onLoadedData, { once: true });
      
      // Also check if it becomes ready while we're waiting (faster polling on mobile)
      const pollInterval = isMobile ? 50 : 100;
      const checkInterval = setInterval(() => {
        if (!this.isVideoElementValid()) {
          clearInterval(checkInterval);
          cleanup();
          resolve();
          return;
        }
        if (this.videoElement.readyState >= minReadyState) {
          clearInterval(checkInterval);
          cleanup();
          resolve();
        }
      }, pollInterval);
      
      // Clean up interval on timeout
      setTimeout(() => clearInterval(checkInterval), timeoutMs);
    });
  }

  /**
   * Attempts to seek to the desired start time if the video is ready
   */
  private trySeekToStartTime(): void {
    try {
      if (this.videoElement.readyState >= 1 && this.desiredStartTime !== undefined) {
        this.videoElement.currentTime = this.desiredStartTime;
        this.startTimeEnforced = true;
      }
    } catch {
      // Some browsers require metadata; handled by events below
    }
  }

  /**
   * Clears all timeouts and intervals
   */
  private clearTimeoutsAndIntervals(): void {
    if (this.loadTimeoutId) {
      clearTimeout(this.loadTimeoutId);
      this.loadTimeoutId = undefined;
    }
    if (this.stalledTimeoutId) {
      clearTimeout(this.stalledTimeoutId);
      this.stalledTimeoutId = undefined;
    }
    if (this.waitingTimeoutId) {
      clearTimeout(this.waitingTimeoutId);
      this.waitingTimeoutId = undefined;
    }
    if (this.progressCheckIntervalId) {
      clearInterval(this.progressCheckIntervalId);
      this.progressCheckIntervalId = undefined;
    }
    if (this.overlayTimeoutId) {
      clearTimeout(this.overlayTimeoutId);
      this.overlayTimeoutId = undefined;
    }
  }

  /**
   * Removes event listeners from video element
   */
  private removeVideoEventListeners(): void {
    if (this.videoElement && this.isVideoElementValid()) {
      try {
        if (this.stalledHandler) {
          this.videoElement.removeEventListener('stalled', this.stalledHandler);
          this.stalledHandler = undefined;
        }
        if (this.waitingHandler) {
          this.videoElement.removeEventListener('waiting', this.waitingHandler);
          this.waitingHandler = undefined;
        }
        if (this.progressHandler) {
          this.videoElement.removeEventListener('progress', this.progressHandler);
          this.progressHandler = undefined;
        }
      } catch {
        // Element may have been removed, ignore
      }
    }
  }

  /**
   * Cleans up the video element by clearing sources and removing from DOM
   */
  private cleanupVideoElement(): void {
    if (!this.videoElement || !this.isVideoElementValid()) {
      return;
    }

    // Pause and stop all playback
    try {
      this.videoElement.pause();
      this.videoElement.currentTime = 0;
    } catch {
      // Element may have been removed, ignore
    }

    // Get parent BEFORE removing element - we need it for clone-and-replace
    const parent = this.videoElement.parentNode;

    try {
      // Clear all sources to stop network requests
      this.videoElement.src = '';
      this.videoElement.srcObject = null;

      // Remove all child nodes (source elements, etc.)
      while (this.videoElement.firstChild) {
        this.videoElement.firstChild?.remove();
      }

      // Clear all attributes that might hold references
      this.videoElement.removeAttribute('src');
      this.videoElement.removeAttribute('preload');

      // Force browser to release video buffers
      this.videoElement.load();
    } catch {
      // Element may have been removed or is invalid, ignore
    }

    // Clone and replace to break all event listener references
    this.cloneAndReplaceVideoElement(parent);
    this.removePlayerWrapper(parent);
  }

  /**
   * Clones and replaces video element to break event listener references
   */
  private cloneAndReplaceVideoElement(parent: Node | null): void {
    if (!parent?.contains(this.videoElement)) {
      if (parent) {
        // Element not in parent anymore, but parent exists - try to remove it anyway
        try {
          if (parent.contains(this.videoElement)) {
            this.videoElement.remove();
          }
        } catch {
          // Element already removed, ignore
        }
      }
      return;
    }

    try {
      const newVideo = this.videoElement.cloneNode(false) as HTMLVideoElement;
      parent.replaceChild(newVideo, this.videoElement);
      newVideo.remove();
    } catch {
      // If replaceChild fails, the element may have been removed already
      // Try to remove it directly if it's still in the parent
      try {
        if (parent.contains(this.videoElement)) {
          this.videoElement.remove();
        }
      } catch {
        // Element already removed or parent changed, ignore
      }
    }
  }

  /**
   * Removes the player wrapper element if it exists
   */
  private removePlayerWrapper(parent: Node | null): void {
    if (parent && parent instanceof HTMLElement && parent.classList.contains('video-player')) {
      const playerWrapper = parent;
      const wrapperParent = playerWrapper.parentNode;
      if (wrapperParent?.contains(playerWrapper)) {
        try {
          playerWrapper.remove();
        } catch {
          // Wrapper may have been removed already, ignore
        }
      }
    }
  }

  /**
   * Removes all fullscreen event listeners
   */
  private removeFullscreenListeners(): void {
    if (this.fullscreenChangeHandler) {
      document.removeEventListener('fullscreenchange', this.fullscreenChangeHandler);
      this.fullscreenChangeHandler = undefined;
    }
    if (this.webkitFullscreenChangeHandler) {
      document.removeEventListener('webkitfullscreenchange', this.webkitFullscreenChangeHandler);
      this.webkitFullscreenChangeHandler = undefined;
    }
    if (this.mozFullscreenChangeHandler) {
      document.removeEventListener('mozfullscreenchange', this.mozFullscreenChangeHandler);
      this.mozFullscreenChangeHandler = undefined;
    }
    if (this.msFullscreenChangeHandler) {
      document.removeEventListener('MSFullscreenChange', this.msFullscreenChangeHandler);
      this.msFullscreenChangeHandler = undefined;
    }
  }

  /**
   * Unload the video to free memory while preserving state for reload
   * Aggressively clears all video data to reduce RAM usage
   */
  unload(): void {
    if (this.isUnloaded) {
      return; // Already unloaded
    }

    if (!this.isVideoElementValid()) {
      this.isUnloaded = true;
      return;
    }

    this.videoElement.pause();
    this.videoElement.currentTime = 0;
    
    // Remove from DOM first to release references and help GC
    this.videoElement.remove();
    
    // Clear all sources to stop network requests and release buffers
    this.videoElement.src = '';
    // Clear srcObject to fully release video buffers (critical for memory)
    if (this.videoElement.srcObject) {
      this.videoElement.srcObject = null;
    }
    
    // Remove all source elements to clear browser cache
    while (this.videoElement.firstChild) {
      this.videoElement.firstChild.remove();
    }
    
    this.videoElement.removeAttribute('src');
    
    // Force browser to release video buffer
    this.videoElement.load();
    
    this.isUnloaded = true;
    this.state.isPlaying = false;
    this.state.currentTime = 0;
    this.state.duration = 0;
    this.updatePlayButton();
    this.notifyStateChange();
  }

  /**
   * Clean up duplicate player wrappers and video elements
   */
  private cleanupDuplicates(): void {
    // Remove any duplicate playerWrapper elements (keep only the first one)
    const allPlayerWrappers = this.container.querySelectorAll('.video-player');
    if (allPlayerWrappers.length > 1) {
      // Keep the first one, remove the rest
      for (let i = 1; i < allPlayerWrappers.length; i++) {
        const duplicate = allPlayerWrappers[i];
        duplicate.remove();
      }
    }
    
    // Remove any duplicate video elements (keep only the one we're managing)
    const allVideoElements = this.container.querySelectorAll('video.video-player__element');
    if (allVideoElements.length > 1) {
      for (const video of allVideoElements) {
        if (video !== this.videoElement) {
          video.remove();
        }
      }
    }
  }

  /**
   * Find or create player wrapper for video element
   */
  private findOrCreatePlayerWrapper(): HTMLElement {
    let playerWrapper = this.videoElement.parentElement;
    
    // Check if parent is the correct playerWrapper (has class 'video-player')
    if (!playerWrapper?.classList.contains('video-player')) {
      // Find existing playerWrapper in container
      playerWrapper = this.container.querySelector('.video-player') as HTMLElement;
      
      // If no playerWrapper exists, create it
      if (!playerWrapper) {
        playerWrapper = document.createElement('div');
        playerWrapper.className = 'video-player';
        playerWrapper.style.position = 'absolute';
        playerWrapper.style.top = '0';
        playerWrapper.style.left = '0';
        playerWrapper.style.width = '100%';
        playerWrapper.style.height = '100%';
        playerWrapper.style.zIndex = '1';
        playerWrapper.style.backgroundColor = 'transparent';
        playerWrapper.style.transform = 'translateZ(0)';
        playerWrapper.style.willChange = 'transform';
        
        // Insert playerWrapper before controlsContainer if it exists
        if (this.controlsContainer && this.controlsContainer.parentNode === this.container) {
          this.container.insertBefore(playerWrapper, this.controlsContainer);
        } else {
          this.container.appendChild(playerWrapper);
        }
      }
    }
    
    return playerWrapper;
  }

  /**
   * Ensure video element and loading indicator are in the correct player wrapper
   */
  private ensureElementsInWrapper(playerWrapper: HTMLElement): void {
    // Ensure video element is in the playerWrapper (remove from any other parent first)
    if (this.videoElement.parentElement !== playerWrapper) {
      if (this.videoElement.parentElement) {
        this.videoElement.remove();
      }
      playerWrapper.appendChild(this.videoElement);
    }
    
    // Ensure loadingIndicator is in playerWrapper if it exists
    if (this.loadingIndicator && this.loadingIndicator.parentElement !== playerWrapper) {
      if (this.loadingIndicator.parentElement) {
        this.loadingIndicator.remove();
      }
      playerWrapper.appendChild(this.loadingIndicator);
    }
  }

  /**
   * Re-setup start time handling for reload
   */
  private setupReloadStartTimeHandling(): void {
    if (this.originalStartTime === undefined) {
      return;
    }
    
    const hasStart = typeof this.originalStartTime === 'number' && Number.isFinite(this.originalStartTime);
    this.desiredStartTime = hasStart ? Math.max(0, this.originalStartTime) : undefined;
    this.startTimeEnforced = false;

    if (hasStart && this.desiredStartTime !== undefined) {
      if (this.videoElement.readyState >= 1) {
        this.trySeekToStartTime();
      }

      const onMeta = () => {
        this.trySeekToStartTime();
      };
      this.videoElement.addEventListener('loadedmetadata', onMeta, { once: true });
      this.videoElement.addEventListener('canplay', onMeta, { once: true });
    }
  }

  /**
   * Re-setup end time handling for reload
   */
  private setupReloadEndTimeHandling(): void {
    if (this.originalEndTime === undefined || this.originalEndTime <= 0.25) {
      return;
    }
    
    this.videoElement.addEventListener('timeupdate', () => {
      if (this.videoElement.currentTime >= this.originalEndTime!) {
        this.videoElement.currentTime = 0;
        if (!this.videoElement.paused) {
          // Intentionally ignore play() errors - browser will handle autoplay restrictions
          this.videoElement.play().catch(() => {
            // Browser handles autoplay restrictions silently
          });
        }
      }
    });
  }

  /**
   * Re-resolve ready promise for reload
   */
  private setupReloadReadyHandlers(): void {
    this.readyPromise = new Promise<void>((resolve) => { this.readyResolver = resolve; });
    const handleReady = () => this.resolveReady();
    this.videoElement.addEventListener('loadeddata', handleReady, { once: true });
    this.videoElement.addEventListener('canplay', handleReady, { once: true });

    if (this.videoElement.readyState >= 2) {
      this.resolveReady();
    }
  }

  /**
   * Reload the video after being unloaded
   */
  reload(): void {
    if (!this.isUnloaded || !this.originalVideoUrl) {
      return; // Not unloaded or no original URL
    }

    // Clean up duplicates FIRST, before any other operations
    this.cleanupDuplicates();

    // Ensure video element structure is correct before reloading
    const playerWrapper = this.findOrCreatePlayerWrapper();
    this.ensureElementsInWrapper(playerWrapper);

    // Recreate video element with original URL and settings
    this.videoElement.src = this.originalVideoUrl;
    this.videoElement.load();
    this.isUnloaded = false;
    this.errorHandled = false;
    this.startTimeEnforced = false;
    this.desiredStartTime = this.originalStartTime;

    // Re-setup handlers
    this.setupReloadStartTimeHandling();
    this.setupReloadEndTimeHandling();
    this.setupReloadReadyHandlers();
  }

  /**
   * Check if the video is currently unloaded
   */
  getIsUnloaded(): boolean {
    return this.isUnloaded;
  }

  destroy(): void {
    this.clearTimeoutsAndIntervals();
    this.removeVideoEventListeners();

    // Remove hover handlers from video element
    if (this.isVideoElementValid() && this.hoverEnterHandler && this.hoverLeaveHandler) {
      this.videoElement.removeEventListener('mouseenter', this.hoverEnterHandler);
      this.videoElement.removeEventListener('mouseleave', this.hoverLeaveHandler);
      this.hoverEnterHandler = undefined;
      this.hoverLeaveHandler = undefined;
    }

    // Remove scroll handler
    if (this.scrollHandler) {
      window.removeEventListener('scroll', this.scrollHandler);
      this.scrollHandler = undefined;
    }

    // Clear scroll timeout
    if (this.scrollTimeoutId) {
      clearTimeout(this.scrollTimeoutId);
      this.scrollTimeoutId = undefined;
    }

    // Clean up touch handlers
    if (this.touchHandlerCleanup) {
      this.touchHandlerCleanup();
      this.touchHandlerCleanup = undefined;
    }
    this.touchState = undefined;

    // Remove poster fallback if exists
    if (this.posterImage) {
      this.posterImage.remove();
      this.posterImage = undefined;
    }

    // Aggressively clean up all resources to free RAM
    if (!this.isUnloaded) {
      this.unload();
    }

    this.cleanupVideoElement();

    // Also remove controlsContainer if it exists
    if (this.controlsContainer) {
      try {
        this.controlsContainer.remove();
      } catch {
        // Controls may have been removed already, ignore
      }
    }

    this.removeFullscreenListeners();

    // Clear all references to help garbage collection
    // Using null! to satisfy TypeScript's definite assignment requirement
    this.videoElement = null!;
    this.controlsContainer = null!;
    this.playButton = null!;
    this.muteButton = null!;
    this.progressBar = null!;
    this.timeDisplay = null!;
    this.fullscreenButton = null!;
    this.loadingIndicator = undefined;
    this.playerWrapper = undefined;
    this.onStateChange = undefined;
    this.externalStateListener = undefined;
    this.readyResolver = undefined;
    this.originalVideoUrl = undefined;
    this.originalStartTime = undefined;
    this.originalEndTime = undefined;
  }
}

