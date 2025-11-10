/**
 * Native HTML5 Video Player
 * Replaces VideoJS with native video element and custom controls
 */

import { VideoPlayerState } from './types.js';
import { formatDuration, isValidMediaUrl } from './utils.js';

export class NativeVideoPlayer {
  private container: HTMLElement;
  private videoElement!: HTMLVideoElement;
  private controlsContainer!: HTMLElement;
  private playButton!: HTMLElement;
  private muteButton!: HTMLElement;
  private progressBar!: HTMLInputElement;
  private timeDisplay!: HTMLElement;
  private fullscreenButton!: HTMLElement;
  private state: VideoPlayerState;
  private onStateChange?: (state: VideoPlayerState) => void;
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
  private isHDMode: boolean = false; // Track if this is HD mode (affects mute button visibility)
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

  constructor(container: HTMLElement, videoUrl: string, options?: {
    autoplay?: boolean;
    muted?: boolean;
    startTime?: number;
    endTime?: number;
    onStateChange?: (state: VideoPlayerState) => void;
    aggressivePreload?: boolean; // Use 'auto' preload for non-HD videos
    isHDMode?: boolean; // Whether this is HD mode (affects mute button visibility)
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
    });
    this.createControls();
    this.attachEventListeners();
  }

  private resolveReady(): void {
    if (this.readyResolver) {
      const resolve = this.readyResolver;
      this.readyResolver = undefined;
      resolve();
    }
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

  private createVideoElement(videoUrl: string, options?: { autoplay?: boolean; muted?: boolean; startTime?: number; endTime?: number; aggressivePreload?: boolean }): void {
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
    // Note: canPlayType() may not always be accurate, but it's a good first check
    const checkCodecSupport = (url: string): boolean => {
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
      
      return true; // Always try to load, let error handler catch issues
    };
    
    checkCodecSupport(videoUrl);
    
    // Set object-fit for proper video display
    this.videoElement.style.objectFit = 'cover';
    
    // Set preload based on whether we have startTime
    // For non-HD videos (no startTime), use 'auto' like the old version
    // For HD videos (with startTime), use 'metadata' to prevent showing last frame
    const hasStartTimeForPreload = typeof options?.startTime === 'number' && Number.isFinite(options.startTime) && options.startTime > 0;
    this.videoElement.preload = hasStartTimeForPreload ? 'metadata' : 'auto';
    this.videoElement.playsInline = true; // Required for iOS inline playback
    this.videoElement.muted = options?.muted ?? false; // Default to unmuted (markers don't have sound anyway)
    this.videoElement.loop = true; // Enable looping
    this.videoElement.className = 'video-player__element';
    
    // Don't hide video - let it render but ensure it's positioned correctly
    
    // Mobile-specific attributes
    this.videoElement.setAttribute('playsinline', 'true'); // iOS Safari requires lowercase
    this.videoElement.setAttribute('webkit-playsinline', 'true'); // Legacy iOS support
    this.videoElement.setAttribute('x5-playsinline', 'true'); // Android X5 browser
    this.videoElement.setAttribute('x-webkit-airplay', 'allow'); // AirPlay support
    
    // Determine if we have a startTime that needs to be enforced
    const hasStartTime = typeof options?.startTime === 'number' && Number.isFinite(options.startTime) && options.startTime > 0;
    const initialStartTime = hasStartTime ? Math.max(0, options.startTime as number) : 0;
    
    // For non-HD videos (no startTime or startTime = 0), use simple approach:
    // Just set src directly and let browser show first frame naturally
    // This matches the old behavior and prevents showing last frame
    if (!hasStartTime) {
      // Simple approach: set src directly, no currentTime manipulation
      // Ensure video is paused to prevent auto-playing
      this.videoElement.pause();
      
      // Set src - this will trigger loading
      try {
        if (videoUrl && isValidMediaUrl(videoUrl)) {
          this.videoElement.src = videoUrl;
        } else {
          // URL is invalid, don't set src to prevent error
          this.errorHandled = true;
          return;
        }
      } catch (error) {
        // If setting src throws an error, mark as handled and return
        this.errorHandled = true;
        return;
      }
      
      // Ensure video stays paused after setting src
      this.videoElement.pause();
    } else {
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
        } else {
          // URL is invalid, don't set src to prevent error
          this.errorHandled = true;
          return;
        }
      } catch (error) {
        // If setting src throws an error, mark as handled and return
        this.errorHandled = true;
        return;
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
        try {
          if (this.videoElement.readyState >= 0) {
            this.videoElement.currentTime = initialStartTime;
          }
        } catch {
          // Ignore
        }
      };
      this.videoElement.addEventListener('loadstart', onLoadStart, { once: true });
    }
    
    // Handle end time if provided (only if endTime is greater than a small tolerance)
    // Loop back to 0 when reaching endTime
    if (options?.endTime !== undefined && options.endTime > 0.25) {
      this.videoElement.addEventListener('timeupdate', () => {
        if (this.videoElement.currentTime >= options.endTime!) {
          this.videoElement.currentTime = 0;
          // Continue playing if it was playing
          if (!this.videoElement.paused) {
            this.videoElement.play().catch(() => {});
          }
        }
      });
    }
    
    // Add error handler (with guard to prevent loops)
    // Use capture phase to catch errors early and prevent browser logging
    this.videoElement.addEventListener('error', (e) => {
      // Prevent error handler from running multiple times
      if (this.errorHandled) {
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      
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
      this.resolveReady();
    };
    this.videoElement.addEventListener('loadeddata', handleReady, { once: true });
    this.videoElement.addEventListener('canplay', handleReady, { once: true });
    
    // Also clear timeout on loadedmetadata (video has metadata)
    this.videoElement.addEventListener('loadedmetadata', clearLoadTimeout, { once: true });

    // If a startTime is provided, ensure we seek to it as soon as metadata is available,
    // and also attempt an immediate seek if already ready.
    const hasStart = typeof options?.startTime === 'number' && Number.isFinite(options?.startTime as number);
    this.desiredStartTime = hasStart ? Math.max(0, options!.startTime as number) : undefined;
    this.startTimeEnforced = false;
    
    if (hasStart && this.desiredStartTime !== undefined) {
      const trySeek = () => {
        try {
          if (this.videoElement.readyState >= 1 && this.desiredStartTime !== undefined) {
            this.videoElement.currentTime = this.desiredStartTime;
            this.startTimeEnforced = true;
          }
        } catch {
          // Some browsers require metadata; handled by events below
        }
      };
      // Immediate attempt if metadata is already loaded
      if (this.videoElement.readyState >= 1) {
        trySeek();
      }
      // Ensure seek once metadata is loaded - do this early to prevent showing last frame
      const onMeta = () => {
        // Ensure video is paused to prevent auto-playing
        this.videoElement.pause();
        trySeek();
        
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
        
        // Don't show video yet - let VideoPost control visibility
        // This prevents flash during video loading
        
        // Keep preload as 'metadata'
        // For non-HD videos with aggressivePreload, we can switch to 'auto' after seek completes
        if (options?.aggressivePreload) {
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
        
        // Don't show video yet - let VideoPost control visibility
        // This prevents flash during video loading
        
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
          if (options?.aggressivePreload) {
            this.videoElement.preload = 'auto';
          }
        }
      };
      this.videoElement.addEventListener('loadeddata', onLoadedData, { once: true });
      
      // On mobile, also enforce startTime in timeupdate to catch browsers that reset on play()
      // Only enforce if we have a startTime > 0 and video is actually at the wrong position
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
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
    
    this.videoElement.style.position = 'relative';
    this.videoElement.style.zIndex = '1';
    // Set background to transparent
    this.videoElement.style.backgroundColor = 'transparent';
    // Enable hardware acceleration for video element
    this.videoElement.style.transform = 'translateZ(0)';
    this.videoElement.style.willChange = 'auto'; // Browser will optimize based on video playback
    // Additional GPU acceleration hints
    (this.videoElement.style as any).webkitTransform = 'translateZ(0)';
    (this.videoElement.style as any).backfaceVisibility = 'hidden';
    (this.videoElement.style as any).perspective = '1000px';
    
    playerWrapper.appendChild(this.videoElement);
    this.container.appendChild(playerWrapper);
  }

  private createControls(): void {
    this.controlsContainer = document.createElement('div');
    this.controlsContainer.className = 'video-player__controls';
    // Ensure controls are always on top
    this.controlsContainer.style.zIndex = '10';

    // Play/Pause button
    this.playButton = document.createElement('button');
    this.playButton.className = 'video-player__play-button';
    this.playButton.setAttribute('aria-label', 'Play');
    this.playButton.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
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
    progressContainer.appendChild(this.progressBar);

    // Time display
    this.timeDisplay = document.createElement('span');
    this.timeDisplay.className = 'video-player__time';
    this.timeDisplay.textContent = '0:00 / 0:00';
    progressContainer.appendChild(this.timeDisplay);
    this.controlsContainer.appendChild(progressContainer);

    // Mute button (hidden in HD mode - use global volume toggle instead)
    this.muteButton = document.createElement('button');
    this.muteButton.className = 'video-player__mute-button';
    this.muteButton.setAttribute('aria-label', 'Mute');
    this.updateMuteButton();
    // Hide mute button in HD mode - global volume toggle in header controls muting
    // Also hide in non-HD mode (marker videos don't have audio)
    this.muteButton.style.display = 'none';
    this.controlsContainer.appendChild(this.muteButton); // Still append but hidden

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
      this.state.duration = this.videoElement.duration;
      this.progressBar.max = this.videoElement.duration.toString();
      this.updateTimeDisplay();
      this.notifyStateChange();
    });

    // Track progress events to detect blocked requests
    this.progressHandler = () => {
      this.lastProgressTime = Date.now();
    };
    this.videoElement.addEventListener('progress', this.progressHandler);

    // Set up progress check interval (check every 2 seconds)
    this.progressCheckIntervalId = setInterval(() => {
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
      // Clear any existing stalled timeout
      if (this.stalledTimeoutId) {
        clearTimeout(this.stalledTimeoutId);
      }
      // Set timeout - if still stalled after 10 seconds, mark as error
      this.stalledTimeoutId = setTimeout(() => {
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
      // Clear any existing waiting timeout
      if (this.waitingTimeoutId) {
        clearTimeout(this.waitingTimeoutId);
      }
      // Set timeout - if still waiting after 10 seconds, mark as error
      this.waitingTimeoutId = setTimeout(() => {
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
    this.videoElement.addEventListener('canplay', clearStalledWaitingTimeouts, { once: true });
    this.videoElement.addEventListener('loadeddata', clearStalledWaitingTimeouts, { once: true });

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
      this.state.isFullscreen = true;
      this.notifyStateChange();
    });
    this.videoElement.addEventListener('webkitendfullscreen', () => {
      this.state.isFullscreen = false;
      this.notifyStateChange();
    });

    this.videoElement.addEventListener('timeupdate', () => {
      this.state.currentTime = this.videoElement.currentTime;
      this.progressBar.value = this.videoElement.currentTime.toString();
      this.updateTimeDisplay();
    });

    this.videoElement.addEventListener('play', () => {
      this.state.isPlaying = true;
      this.updatePlayButton();
      this.notifyStateChange();
    });

    this.videoElement.addEventListener('pause', () => {
      this.state.isPlaying = false;
      this.updatePlayButton();
      this.notifyStateChange();
    });

    this.videoElement.addEventListener('volumechange', () => {
      this.state.volume = this.videoElement.volume;
      this.state.isMuted = this.videoElement.muted;
      this.updateMuteButton();
      this.notifyStateChange();
    });

    // Control buttons
    this.playButton.addEventListener('click', () => this.togglePlay());
    this.muteButton.addEventListener('click', () => this.toggleMute());
    this.fullscreenButton.addEventListener('click', () => this.toggleFullscreen());

    // Progress bar
    this.progressBar.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      this.seekTo(parseFloat(target.value));
    });

    // Video element click/touch handlers removed
    // Play/pause is now only controlled via the play button in the controls
    // Videos will still pause automatically when removed from viewport (handled by VisibilityManager)
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
      this.muteButton.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>';
      this.muteButton.setAttribute('aria-label', 'Unmute');
    } else {
      this.muteButton.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
      this.muteButton.setAttribute('aria-label', 'Mute');
    }
  }

  private updateTimeDisplay(): void {
    const current = formatDuration(this.state.currentTime);
    const total = formatDuration(this.state.duration);
    this.timeDisplay.textContent = `${current} / ${total}`;
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

  async play(): Promise<void> {
    // On mobile, mute for autoplay policies if not already muted
    // (markers don't have sound anyway, so this is just for autoplay compatibility)
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
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
    
    // Ensure video element is in the DOM and visible
    if (!this.videoElement.isConnected) {
      throw new Error('Video element not in DOM');
    }
    
    // Hint browser to allow autoplay of muted content
    this.videoElement.autoplay = true;
    
    // Ensure startTime is set right before play (browsers may reset on play)
    // This applies to both mobile and desktop
    if (this.desiredStartTime !== undefined && this.desiredStartTime > 0 && this.videoElement.readyState >= 1) {
      // Reset flag to allow re-seeking
      if (isMobile) {
        this.startTimeEnforced = false;
      }
      try {
        this.videoElement.currentTime = this.desiredStartTime;
      } catch {
        // Ignore seek errors
      }
    }
    
    try {
      const playPromise = this.videoElement.play();
      if (playPromise !== undefined) {
        await playPromise;
        
        // Re-seek after play() in case browser reset currentTime
        // This applies to both mobile and desktop for HD videos
        if (this.desiredStartTime !== undefined && this.desiredStartTime > 0) {
          const performReSeek = (attempt: number = 0) => {
            try {
              if (this.videoElement.readyState >= 1) {
                const current = this.videoElement.currentTime;
                const desired = this.desiredStartTime!;
                const diff = Math.abs(current - desired);
                
                // Only seek if video is significantly off AND at 0 or very early
                // This prevents interfering with normal playback
                if (diff > 0.5 && current < 1) {
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
          // This applies to both mobile and desktop
          requestAnimationFrame(() => performReSeek(0));
        }
        
        // Update state after successful play
        this.state.isPlaying = !this.videoElement.paused;
        this.updatePlayButton();
        this.notifyStateChange();
      }
    } catch (err: any) {
      // Check if this is a load failure
      const isLoadFailure = this.hasLoadError();
      const errorType = isLoadFailure ? this.getLoadErrorType() : null;
      
      console.error('NativeVideoPlayer: play() failed', {
        error: err,
        readyState: this.videoElement.readyState,
        paused: this.videoElement.paused,
        muted: this.videoElement.muted,
        src: this.videoElement.src,
        networkState: this.videoElement.networkState,
        isLoadFailure,
        errorType
      });
      
      // Enhance error with load failure information
      if (isLoadFailure && errorType) {
        const enhancedError = new Error(`Video load failed: ${errorType}`);
        (enhancedError as any).originalError = err;
        (enhancedError as any).errorType = errorType;
        (enhancedError as any).networkState = this.videoElement.networkState;
        (enhancedError as any).readyState = this.videoElement.readyState;
        throw enhancedError;
      }
      
      throw err;
    }
  }

  pause(): void {
    this.videoElement.pause();
  }

  /**
   * Check if the video is currently playing
   */
  isPlaying(): boolean {
    return !this.videoElement.paused && !this.videoElement.ended && this.videoElement.readyState > 0;
  }

  togglePlay(): void {
    if (this.state.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  toggleMute(): void {
    this.videoElement.muted = !this.videoElement.muted;
  }

  setMuted(isMuted: boolean): void {
    // Check if video element exists before accessing it
    if (!this.videoElement) {
      return;
    }
    this.videoElement.muted = !!isMuted;
    this.state.isMuted = this.videoElement.muted;
    this.updateMuteButton();
  }

  setVolume(volume: number): void {
    // Clamp volume between 0 and 1
    const clampedVolume = Math.max(0, Math.min(1, volume));
    this.videoElement.volume = clampedVolume;
    this.state.volume = clampedVolume;
    // Update mute button state if volume is 0
    this.updateMuteButton();
  }

  seekTo(time: number): void {
    this.videoElement.currentTime = time;
  }

  getVideoElement(): HTMLVideoElement {
    return this.videoElement;
  }

  /**
   * Check if video has a load error
   */
  hasLoadError(): boolean {
    // networkState 3 = NETWORK_NO_SOURCE (no source available)
    // networkState 2 = NETWORK_LOADING (but might be stuck)
    // networkState 1 = NETWORK_IDLE (but might indicate failed load)
    // readyState 0 = HAVE_NOTHING (no information available)
    
    // Check for explicit error state
    if (this.videoElement.networkState === 3) {
      return true;
    }
    
    // Check if video has been at readyState 0 for >15 seconds (timeout)
    if (this.loadStartTime && this.videoElement.readyState === 0) {
      const timeSinceLoadStart = Date.now() - this.loadStartTime;
      if (timeSinceLoadStart > 15000) {
        return true;
      }
    }
    
    // Check for networkState 2 (NETWORK_LOADING) but stuck with readyState 0
    if (this.videoElement.networkState === 2 && this.videoElement.readyState === 0) {
      // If we've been loading for >15 seconds, consider it blocked
      if (this.loadStartTime) {
        const timeSinceLoadStart = Date.now() - this.loadStartTime;
        if (timeSinceLoadStart > 15000) {
          return true;
        }
      }
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
   * Get the type of load error
   */
  getLoadErrorType(): 'timeout' | 'network' | 'play' | null {
    // Check for timeout (readyState 0 for >15 seconds)
    if (this.loadStartTime && this.videoElement.readyState === 0) {
      const timeSinceLoadStart = Date.now() - this.loadStartTime;
      if (timeSinceLoadStart > 15000) {
        return 'timeout';
      }
    }
    
    // Check for explicit network error
    if (this.videoElement.networkState === 3) {
      return 'network';
    }
    
    // Check for blocked request (networkState 2 stuck or networkState 1 with readyState 0)
    if ((this.videoElement.networkState === 2 || this.videoElement.networkState === 1) && 
        this.videoElement.readyState === 0) {
      // If we've been in this state for >15 seconds, it's a network issue
      if (this.loadStartTime) {
        const timeSinceLoadStart = Date.now() - this.loadStartTime;
        if (timeSinceLoadStart > 15000) {
          return 'network';
        }
      }
      // Otherwise, still likely a network issue
      return 'network';
    }
    
    // Check if error was explicitly handled (from stalled/waiting/progress timeout)
    if (this.errorHandled && this.videoElement.readyState === 0) {
      return 'network';
    }
    
    // Original check: readyState 0 with networkState !== 0
    if (this.videoElement.readyState === 0 && this.videoElement.networkState !== 0) {
      return 'play';
    }
    
    return null;
  }

  toggleFullscreen(): void {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (isIOS) {
      // iOS Safari: Use webkitEnterFullscreen on video element
      const webkitEnterFullscreen = (this.videoElement as any).webkitEnterFullscreen;
      if (webkitEnterFullscreen) {
        try {
          webkitEnterFullscreen.call(this.videoElement);
          // State will be updated via webkitbeginfullscreen event
        } catch (error) {
          console.error('Failed to enter fullscreen on iOS', error);
        }
      } else {
        console.warn('Fullscreen not supported on this iOS device');
      }
    } else if (isMobile) {
      // Android: Try video element fullscreen first, then container
      const videoRequestFullscreen = 
        this.videoElement.requestFullscreen ||
        (this.videoElement as any).webkitRequestFullscreen ||
        (this.videoElement as any).mozRequestFullscreen ||
        (this.videoElement as any).msRequestFullscreen;

      if (videoRequestFullscreen) {
        videoRequestFullscreen.call(this.videoElement).then(() => {
          this.state.isFullscreen = true;
          this.notifyStateChange();
        }).catch((error: any) => {
          console.error('Failed to enter fullscreen on Android', error);
          // Fallback to container fullscreen
          this.tryContainerFullscreen();
        });
      } else {
        // Fallback to container fullscreen
        this.tryContainerFullscreen();
      }
    } else {
      // Desktop: Use container fullscreen
      this.tryContainerFullscreen();
    }
  }

  private tryContainerFullscreen(): void {
    const containerRequestFullscreen =
      this.container.requestFullscreen ||
      (this.container as any).webkitRequestFullscreen ||
      (this.container as any).mozRequestFullscreen ||
      (this.container as any).msRequestFullscreen;

    if (!this.isFullscreen()) {
      if (containerRequestFullscreen) {
        containerRequestFullscreen.call(this.container).then(() => {
          this.state.isFullscreen = true;
          this.notifyStateChange();
        }).catch((error: any) => {
          console.error('Failed to enter fullscreen', error);
        });
      }
    } else {
      const exitFullscreen =
        document.exitFullscreen ||
        (document as any).webkitExitFullscreen ||
        (document as any).mozCancelFullscreen ||
        (document as any).msExitFullscreen;

      if (exitFullscreen) {
        exitFullscreen.call(document).then(() => {
          this.state.isFullscreen = false;
          this.notifyStateChange();
        }).catch((error: any) => {
          console.error('Failed to exit fullscreen', error);
        });
      }
    }
  }

  private isFullscreen(): boolean {
    return !!(
      document.fullscreenElement ||
      (document as any).webkitFullscreenElement ||
      (document as any).mozFullScreenElement ||
      (document as any).msFullscreenElement
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
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    // On mobile, accept readyState >= 2 (HAVE_CURRENT_DATA) for faster start
    const minReadyState = isMobile ? 2 : 4;
    
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
          const timeoutError = new Error('Video not ready within timeout');
          (timeoutError as any).errorType = 'timeout';
          (timeoutError as any).readyState = this.videoElement.readyState;
          (timeoutError as any).networkState = this.videoElement.networkState;
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
        this.videoElement.removeEventListener('canplay', onCanPlay);
        this.videoElement.removeEventListener('loadeddata', onLoadedData);
      };
      
      // On mobile, use 'canplay' instead of 'canplaythrough' for faster start
      const eventName = isMobile ? 'canplay' : 'canplaythrough';
      this.videoElement.addEventListener(eventName, onCanPlay, { once: true });
      this.videoElement.addEventListener('loadeddata', onLoadedData, { once: true });
      
      // Also check if it becomes ready while we're waiting (faster polling on mobile)
      const pollInterval = isMobile ? 50 : 100;
      const checkInterval = setInterval(() => {
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
   * Unload the video to free memory while preserving state for reload
   * Aggressively clears all video data to reduce RAM usage
   */
  unload(): void {
    if (this.isUnloaded) {
      return; // Already unloaded
    }

    this.videoElement.pause();
    this.videoElement.currentTime = 0;
    
    // Remove from DOM first to release references and help GC
    const parent = this.videoElement.parentNode;
    if (parent) {
      parent.removeChild(this.videoElement);
    }
    
    // Clear all sources to stop network requests and release buffers
    this.videoElement.src = '';
    // Clear srcObject to fully release video buffers (critical for memory)
    if (this.videoElement.srcObject) {
      this.videoElement.srcObject = null;
    }
    
    // Remove all source elements to clear browser cache
    while (this.videoElement.firstChild) {
      this.videoElement.removeChild(this.videoElement.firstChild);
    }
    
    this.videoElement.removeAttribute('src');
    
    // Force browser to release video buffer
    this.videoElement.load();
    
    // Re-insert to DOM (needed for reload functionality)
    if (parent) {
      parent.appendChild(this.videoElement);
    }
    
    this.isUnloaded = true;
    this.state.isPlaying = false;
    this.state.currentTime = 0;
    this.state.duration = 0;
    this.updatePlayButton();
    this.notifyStateChange();
  }

  /**
   * Reload the video after being unloaded
   */
  reload(): void {
    if (!this.isUnloaded || !this.originalVideoUrl) {
      return; // Not unloaded or no original URL
    }

    // Recreate video element with original URL and settings
    this.videoElement.src = this.originalVideoUrl;
    this.videoElement.load();
    this.isUnloaded = false;
    this.errorHandled = false;
    this.startTimeEnforced = false;
    this.desiredStartTime = this.originalStartTime;

    // Re-setup start time handling if needed
    if (this.originalStartTime !== undefined) {
      const hasStart = typeof this.originalStartTime === 'number' && Number.isFinite(this.originalStartTime);
      this.desiredStartTime = hasStart ? Math.max(0, this.originalStartTime) : undefined;
      this.startTimeEnforced = false;

      if (hasStart && this.desiredStartTime !== undefined) {
        const trySeek = () => {
          try {
            if (this.videoElement.readyState >= 1 && this.desiredStartTime !== undefined) {
              this.videoElement.currentTime = this.desiredStartTime;
              this.startTimeEnforced = true;
            }
          } catch {
            // Some browsers require metadata; handled by events below
          }
        };

        if (this.videoElement.readyState >= 1) {
          trySeek();
        }

        const onMeta = () => {
          trySeek();
        };
        this.videoElement.addEventListener('loadedmetadata', onMeta, { once: true });
        this.videoElement.addEventListener('canplay', onMeta, { once: true });
      }
    }

    // Re-setup end time handling if needed
    if (this.originalEndTime !== undefined && this.originalEndTime > 0.25) {
      this.videoElement.addEventListener('timeupdate', () => {
        if (this.videoElement.currentTime >= this.originalEndTime!) {
          this.videoElement.currentTime = 0;
          if (!this.videoElement.paused) {
            this.videoElement.play().catch(() => {});
          }
        }
      });
    }

    // Re-resolve ready promise
    this.readyPromise = new Promise<void>((resolve) => { this.readyResolver = resolve; });
    const handleReady = () => this.resolveReady();
    this.videoElement.addEventListener('loadeddata', handleReady, { once: true });
    this.videoElement.addEventListener('canplay', handleReady, { once: true });

    if (this.videoElement.readyState >= 2) {
      this.resolveReady();
    }
  }

  /**
   * Check if the video is currently unloaded
   */
  getIsUnloaded(): boolean {
    return this.isUnloaded;
  }

  destroy(): void {
    // Clear all timeouts and intervals
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

    // Remove event listeners
    if (this.videoElement) {
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
    }

    // Aggressively clean up all resources to free RAM
    if (!this.isUnloaded) {
      this.unload();
    }
    
    // Remove all event listeners by clearing src and removing element
    if (this.videoElement) {
      // Pause and stop all playback
      this.videoElement.pause();
      this.videoElement.currentTime = 0;
      
      // Get parent BEFORE removing element - we need it for clone-and-replace
      const parent = this.videoElement.parentNode;
      
      // Clear all sources to stop network requests
      this.videoElement.src = '';
      this.videoElement.srcObject = null;
      
      // Remove all child nodes (source elements, etc.)
      while (this.videoElement.firstChild) {
        this.videoElement.removeChild(this.videoElement.firstChild);
      }
      
      // Clear all attributes that might hold references
      this.videoElement.removeAttribute('src');
      this.videoElement.removeAttribute('preload');
      
      // Force browser to release video buffers
      this.videoElement.load();
      
      // Clone and replace to break all event listener references
      // This ensures all listeners are removed and memory is freed
      // Do this BEFORE removing from DOM, so the element is still a child
      if (parent && parent.contains(this.videoElement)) {
        try {
          const newVideo = this.videoElement.cloneNode(false) as HTMLVideoElement;
          parent.replaceChild(newVideo, this.videoElement);
          parent.removeChild(newVideo);
        } catch (e) {
          // If replaceChild fails, the element may have been removed already
          // Try to remove it directly if it's still in the parent
          try {
            if (parent.contains(this.videoElement)) {
              parent.removeChild(this.videoElement);
            }
          } catch (e2) {
            // Element already removed or parent changed, ignore
          }
        }
      } else if (parent) {
        // Element not in parent anymore, but parent exists - try to remove it anyway
        try {
          if (parent.contains(this.videoElement)) {
            parent.removeChild(this.videoElement);
          }
        } catch (e) {
          // Element already removed, ignore
        }
      }
    }
    
    // Remove document-level event listeners
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
    
    // Don't clear container - let browser handle cleanup naturally
    // if (this.container) {
    //   this.container.innerHTML = '';
    // }
    
    // Clear all references to help garbage collection
    this.videoElement = undefined as any;
    this.controlsContainer = undefined as any;
    this.playButton = undefined as any;
    this.muteButton = undefined as any;
    this.progressBar = undefined as any;
    this.timeDisplay = undefined as any;
    this.fullscreenButton = undefined as any;
    this.onStateChange = undefined;
    this.externalStateListener = undefined;
    this.readyResolver = undefined;
    this.originalVideoUrl = undefined;
    this.originalStartTime = undefined;
    this.originalEndTime = undefined;
  }
}

