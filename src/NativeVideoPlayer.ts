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
  
  // Touch state tracking for scroll detection
  private touchStartX: number = 0;
  private touchStartY: number = 0;
  private touchStartTime: number = 0;
  private isScrolling: boolean = false;
  private readonly touchMoveThreshold: number = 10; // pixels
  private readonly touchDurationThreshold: number = 300; // milliseconds

  constructor(container: HTMLElement, videoUrl: string, options?: {
    autoplay?: boolean;
    muted?: boolean;
    startTime?: number;
    endTime?: number;
    onStateChange?: (state: VideoPlayerState) => void;
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

    this.state = {
      isPlaying: false,
      isMuted: options?.muted ?? false,
      currentTime: 0,
      duration: 0,
      volume: 1,
      isFullscreen: false,
    };

    this.readyPromise = new Promise<void>((resolve) => { this.readyResolver = resolve; });

    this.createVideoElement(videoUrl, {
      autoplay: options?.autoplay,
      muted: options?.muted,
      startTime: options?.startTime,
      endTime: options?.endTime,
    });
    this.createControls();
    this.attachEventListeners();
  }

  private createVideoElement(videoUrl: string, options?: { autoplay?: boolean; muted?: boolean; startTime?: number; endTime?: number }): void {
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

    this.videoElement.src = videoUrl;
    this.videoElement.preload = 'auto'; // Changed from 'metadata' to 'auto' for better loading
    this.videoElement.playsInline = true; // Required for iOS inline playback
    this.videoElement.muted = options?.muted ?? false; // Default to unmuted (markers don't have sound anyway)
    this.videoElement.loop = true; // Enable looping
    this.videoElement.className = 'video-player__element';
    
    // Mobile-specific attributes
    this.videoElement.setAttribute('playsinline', 'true'); // iOS Safari requires lowercase
    this.videoElement.setAttribute('webkit-playsinline', 'true'); // Legacy iOS support
    this.videoElement.setAttribute('x5-playsinline', 'true'); // Android X5 browser
    this.videoElement.setAttribute('x-webkit-airplay', 'allow'); // AirPlay support
    
    
    // Set start time if provided
    if (options?.startTime !== undefined) {
      const setStartTime = () => {
        this.videoElement.currentTime = options.startTime!;
      };
      this.videoElement.addEventListener('loadedmetadata', setStartTime, { once: true });
      // Also try when canplay is ready
      this.videoElement.addEventListener('canplay', setStartTime, { once: true });
    }
    
    // Handle end time if provided (only if endTime > startTime + small tolerance)
    // Loop back to startTime when reaching endTime
    if (options?.endTime !== undefined && (options.startTime === undefined || options.endTime > options.startTime + 0.25)) {
      this.videoElement.addEventListener('timeupdate', () => {
        if (this.videoElement.currentTime >= options.endTime!) {
          this.videoElement.currentTime = options.startTime || 0;
          // Continue playing if it was playing
          if (!this.videoElement.paused) {
            this.videoElement.play().catch(() => {});
          }
        }
      });
    }
    
    // Add error handler (with guard to prevent loops)
    this.videoElement.addEventListener('error', (e) => {
      // Prevent error handler from running multiple times
      if (this.errorHandled) {
        return;
      }
      
      const errorCode = this.videoElement.error?.code;
      const errorMessage = this.videoElement.error?.message;
      
      // Check if this is a known invalid URL error (MediaLoadInvalidURI)
      // Error code 4 = MEDIA_ERR_SRC_NOT_SUPPORTED / MediaLoadInvalidURI
      const isInvalidUriError = errorCode === 4 || 
        (errorMessage && errorMessage.includes('MediaLoadInvalidURI'));
      
      if (isInvalidUriError) {
        // Mark as handled and silently suppress - validation should have caught this
        this.errorHandled = true;
        // Don't clear src or do anything that could trigger more events
        return;
      }
      
      // Mark as handled and log other errors normally (only once)
      this.errorHandled = true;
      console.error('NativeVideoPlayer: Video error', {
        error: e,
        errorCode,
        errorMessage,
        src: this.videoElement.src,
      });
    }, { once: true }); // Use once: true to ensure handler only runs once
    
    // Resolve ready promise when video can play
    this.videoElement.addEventListener('canplay', () => {
      if (this.readyResolver) this.readyResolver();
    });

    const playerWrapper = document.createElement('div');
    playerWrapper.className = 'video-player';
    playerWrapper.appendChild(this.videoElement);
    this.container.appendChild(playerWrapper);
  }

  private createControls(): void {
    this.controlsContainer = document.createElement('div');
    this.controlsContainer.className = 'video-player__controls';

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

    // Mute button
    this.muteButton = document.createElement('button');
    this.muteButton.className = 'video-player__mute-button';
    this.muteButton.setAttribute('aria-label', 'Mute');
    this.updateMuteButton();
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
      this.state.duration = this.videoElement.duration;
      this.progressBar.max = this.videoElement.duration.toString();
      this.updateTimeDisplay();
      this.notifyStateChange();
    });

    // Fullscreen change events (desktop and Android)
    document.addEventListener('fullscreenchange', () => this.handleFullscreenChange());
    document.addEventListener('webkitfullscreenchange', () => this.handleFullscreenChange());
    document.addEventListener('mozfullscreenchange', () => this.handleFullscreenChange());
    document.addEventListener('MSFullscreenChange', () => this.handleFullscreenChange());

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

    // Click/touch video to play/pause (important for mobile when autoplay fails)
    // On mobile, use touch events with scroll detection to prevent accidental pauses
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    
    if (isMobile) {
      // Touch event handlers with scroll detection
      this.videoElement.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        if (touch) {
          this.touchStartX = touch.clientX;
          this.touchStartY = touch.clientY;
          this.touchStartTime = Date.now();
          this.isScrolling = false;
        }
      }, { passive: true });
      
      this.videoElement.addEventListener('touchmove', (e) => {
        if (e.touches.length > 0) {
          const touch = e.touches[0];
          const deltaX = Math.abs(touch.clientX - this.touchStartX);
          const deltaY = Math.abs(touch.clientY - this.touchStartY);
          
          // If touch moved more than threshold, consider it scrolling
          if (deltaX > this.touchMoveThreshold || deltaY > this.touchMoveThreshold) {
            this.isScrolling = true;
          }
        }
      }, { passive: true });
      
      this.videoElement.addEventListener('touchend', (e) => {
        const touch = e.changedTouches[0];
        if (!touch) return;
        
        const deltaX = Math.abs(touch.clientX - this.touchStartX);
        const deltaY = Math.abs(touch.clientY - this.touchStartY);
        const touchDuration = Date.now() - this.touchStartTime;
        const totalDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        
        // Only toggle play/pause if:
        // 1. Not scrolling (movement < threshold)
        // 2. Touch duration is reasonable (not a long press)
        // 3. Total distance moved is within threshold
        if (!this.isScrolling && 
            totalDistance < this.touchMoveThreshold && 
            touchDuration < this.touchDurationThreshold) {
          e.preventDefault(); // Prevent double-firing with click
          this.togglePlay();
        }
        
        // Reset state
        this.isScrolling = false;
        this.touchStartX = 0;
        this.touchStartY = 0;
        this.touchStartTime = 0;
      });
      
      // Disable click handler on mobile since touchend handles it
      // This prevents double-toggling
    } else {
      // Desktop: use simple click handler
      this.videoElement.addEventListener('click', () => this.togglePlay());
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
    
    try {
      const playPromise = this.videoElement.play();
      if (playPromise !== undefined) {
        await playPromise;
        // Update state after successful play
        this.state.isPlaying = !this.videoElement.paused;
        this.updatePlayButton();
        this.notifyStateChange();
      }
    } catch (err: any) {
      console.error('NativeVideoPlayer: play() failed', {
        error: err,
        readyState: this.videoElement.readyState,
        paused: this.videoElement.paused,
        muted: this.videoElement.muted,
        src: this.videoElement.src,
        networkState: this.videoElement.networkState
      });
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

  seekTo(time: number): void {
    this.videoElement.currentTime = time;
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
          reject(new Error('Video not ready within timeout'));
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

  destroy(): void {
    this.videoElement.pause();
    this.videoElement.src = '';
    this.videoElement.load();
    this.container.innerHTML = '';
  }
}

