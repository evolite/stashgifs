/**
 * Audio Manager
 * Centralized audio management with single source of truth and priority system
 */

import { NativeVideoPlayer } from './NativeVideoPlayer.js';
import { isMobileDevice } from './utils.js';

interface VisibilityEntry {
  element: HTMLElement;
  player?: NativeVideoPlayer;
  postId: string;
  isVisible: boolean;
  pendingVisibilityPlay: boolean;
  isUnloaded: boolean;
}

export enum AudioPriority {
  HOVER = 3,        // Highest: User is hovering/touching
  MANUAL = 2,       // Medium: User manually started playback
  CENTER = 1,      // Low: Most centered visible video
  NONE = 0         // No audio
}

export class AudioManager {
  private currentAudioOwner?: string;
  private ownerPriority: AudioPriority = AudioPriority.NONE;
  private hoveredPostId?: string;
  private readonly manuallyStartedVideos: Set<string> = new Set();
  private readonly entries: Map<string, VisibilityEntry>;
  private globalMuteState: boolean = true; // Global mute state - all videos muted when true (default: muted)
  private readonly debugEnabled: boolean = false;
  private readonly logger?: (event: string, payload?: Record<string, unknown>) => void;
  private readonly getHoveredPostId?: () => string | undefined;

  constructor(
    entries: Map<string, VisibilityEntry>,
    options?: {
      debug?: boolean;
      logger?: (event: string, payload?: Record<string, unknown>) => void;
      getHoveredPostId?: () => string | undefined;
    }
  ) {
    this.entries = entries;
    this.debugEnabled = options?.debug ?? false;
    this.logger = options?.logger;
    this.getHoveredPostId = options?.getHoveredPostId;
  }

  /**
   * Request audio focus for a video with a specific priority
   */
  requestAudioFocus(postId: string, priority: AudioPriority): void {
    const entry = this.entries.get(postId);
    if (!entry?.player) {
      this.debugLog('audio-focus-requested', { postId, priority, granted: false, reason: 'no-player' });
      return;
    }

    const isMobile = isMobileDevice();
    const videoElement = entry.player.getVideoElement();
    
    // On mobile, be more lenient - accept videos that are unpaused even if not fully playing yet
    // This handles the timing issue where play() succeeds but isPlaying() hasn't returned true yet
    let isVideoReady = false;
    if (isMobile && videoElement) {
      // On mobile, check if video is unpaused (indicates play() was called) even if not fully playing
      isVideoReady = !videoElement.paused && !videoElement.ended && videoElement.readyState > 0;
    } else {
      // On desktop, require full playing state
      isVideoReady = entry.player.isPlaying();
    }

    if (!isVideoReady) {
      this.debugLog('audio-focus-requested', { postId, priority, granted: false, reason: 'video-not-ready', isMobile, paused: videoElement?.paused, readyState: videoElement?.readyState });
      return;
    }

    // Only grant if priority is higher than current
    if (priority > this.ownerPriority) {
      this.setAudioOwner(postId, priority);
      this.debugLog('audio-focus-requested', { postId, priority, granted: true });
    } else {
      this.debugLog('audio-focus-requested', { postId, priority, granted: false, currentOwner: this.currentAudioOwner, currentPriority: this.ownerPriority });
    }
  }

  /**
   * Release audio focus for a video
   */
  releaseAudioFocus(postId: string): void {
    if (this.currentAudioOwner === postId) {
      this.debugLog('audio-focus-released', { postId });
      this.currentAudioOwner = undefined;
      this.ownerPriority = AudioPriority.NONE;
      this.updateAudioFocus();
    }
  }

  /**
   * Update audio focus based on current priority system
   */
  updateAudioFocus(): void {
    // Priority 1: Hovered video (highest priority)
    const hoveredId = this.getHoveredPostId ? this.getHoveredPostId() : this.hoveredPostId;
    if (hoveredId) {
      const entry = this.entries.get(hoveredId);
      if (entry?.player && entry.isVisible && entry.player.isPlaying()) {
        this.setAudioOwner(hoveredId, AudioPriority.HOVER);
        return;
      }
    }

    // Priority 2: Manually started videos
    for (const postId of this.manuallyStartedVideos) {
      const entry = this.entries.get(postId);
      if (entry?.player && entry.isVisible && entry.player.isPlaying()) {
        this.setAudioOwner(postId, AudioPriority.MANUAL);
        return;
      }
    }

    // No hover or manual videos - release audio
    this.setAudioOwner(undefined, AudioPriority.NONE);
  }

  /**
   * Set the audio owner and apply mute state
   */
  private setAudioOwner(postId: string | undefined, priority: AudioPriority): void {
    const oldOwner = this.currentAudioOwner;
    
    if (oldOwner === postId && this.ownerPriority === priority) {
      // No change needed
      return;
    }

    this.currentAudioOwner = postId;
    this.ownerPriority = priority;

    this.applyMuteState();
    
    this.debugLog('audio-owner-changed', {
      oldOwner,
      newOwner: postId,
      priority
    });
  }

  /**
   * Set global mute state
   */
  setGlobalMuteState(isMuted: boolean): void {
    this.globalMuteState = isMuted;
    this.applyMuteState();
  }

  /**
   * Apply mute state to all videos (public method for external use)
   */
  applyMuteStateToAll(): void {
    this.applyMuteState();
  }

  /**
   * Auto-grant audio focus to first playing video on mobile when no owner exists
   */
  private autoGrantAudioFocusOnMobile(): void {
    if (!isMobileDevice() || this.currentAudioOwner) {
      return;
    }

    // Find the first playing video and grant it audio focus
    for (const [postId, entry] of this.entries) {
      if (entry.player && entry.isVisible) {
        const videoElement = entry.player.getVideoElement();
        // Check if video is playing or about to play (unpaused with readyState > 0)
        if (videoElement && !videoElement.paused && !videoElement.ended && videoElement.readyState > 0) {
          // Determine priority: manual > center
          const priority = this.manuallyStartedVideos.has(postId) ? AudioPriority.MANUAL : AudioPriority.CENTER;
          this.setAudioOwner(postId, priority);
          this.debugLog('audio-focus-auto-granted', { postId, priority, reason: 'no-owner-playing-video' });
          break; // Only grant to the first playing video
        }
      }
    }
  }

  /**
   * Apply mute state to a single video entry
   */
  private applyMuteStateToEntry(postId: string, entry: VisibilityEntry, isMobile: boolean): void {
    if (!entry.player) return;

    const videoElement = entry.player.getVideoElement();
    if (!videoElement) return;

    const shouldBeMuted = postId !== this.currentAudioOwner;
    const isCurrentlyMuted = videoElement.muted;
    const isCurrentlyPlaying = entry.player.isPlaying();

    // CRITICAL: Only change mute state if video is already playing
    // If video is not playing, keep it muted (required for autoplay)
    if (!isCurrentlyPlaying) {
      if (!isCurrentlyMuted) {
        entry.player.setMuted(true);
      }
      return;
    }

    // Video is playing - can safely change mute state
    if (isMobile && !shouldBeMuted) {
      // On mobile, ensure video is unmuted only if it's the audio owner
      if (isCurrentlyMuted) {
        entry.player.setMuted(false);
      }
    } else if (isMobile) {
      // Mobile: mute if not owner
      if (shouldBeMuted && !isCurrentlyMuted) {
        entry.player.setMuted(true);
      }
    } else {
      // Desktop: normal behavior
      if (shouldBeMuted !== isCurrentlyMuted) {
        entry.player.setMuted(shouldBeMuted);
      }
    }
  }

  /**
   * Apply mute state to all videos based on current owner
   */
  private applyMuteState(): void {
    const isMobile = isMobileDevice();
    
    // If globally muted, mute all videos
    if (this.globalMuteState) {
      this.muteAllVideos();
      return;
    }

    // On mobile, if no audio owner exists but a video is playing, automatically grant it audio focus
    this.autoGrantAudioFocusOnMobile();

    // When global mute is off: unmute owner, mute others
    for (const [postId, entry] of this.entries) {
      this.applyMuteStateToEntry(postId, entry, isMobile);
    }
  }

  /**
   * Mute all videos
   */
  private muteAllVideos(): void {
    for (const [, entry] of this.entries) {
      if (entry.player) {
        entry.player.setMuted(true);
      }
    }
  }


  /**
   * Event handler for video play
   */
  onVideoPlay(postId: string, isManual: boolean = false): void {
    if (isManual) {
      this.manuallyStartedVideos.add(postId);
      // Immediately request audio focus with MANUAL priority
      // This ensures manually started videos take priority over center-based videos
      this.requestAudioFocus(postId, AudioPriority.MANUAL);
      return;
    }
    // For autoplay videos, only re-evaluate if no video currently has audio
    // This prevents autoplay videos from stealing audio from manually started videos
    if (!this.currentAudioOwner) {
      this.updateAudioFocus();
    }
  }

  /**
   * Event handler for video pause
   */
  onVideoPause(postId: string): void {
    // If this was the audio owner, just mute it but don't transfer audio to another video
    // This prevents audio from jumping to another video when user pauses
    if (this.currentAudioOwner === postId) {
      // Mute the paused video but keep it as the audio owner
      // This way, if user resumes, audio will still be there
      const entry = this.entries.get(postId);
      if (entry?.player) {
        entry.player.setMuted(true);
      }
      // Don't release audio focus or re-evaluate - keep the paused video as owner
      // This prevents audio from jumping to another video
      return;
    }

    // If it wasn't the audio owner, just remove from manually started set
    this.manuallyStartedVideos.delete(postId);
    // Don't re-evaluate - no need to change audio focus
  }

  /**
   * Event handler for visibility change
   */
  onVisibilityChange(postId: string, isVisible: boolean): void {
    // If video became invisible and it was the audio owner, release
    if (!isVisible && this.currentAudioOwner === postId) {
      this.releaseAudioFocus(postId);
      return;
    }
    // Re-evaluate audio focus when video becomes visible
    if (isVisible) {
      this.updateAudioFocus();
    }
  }

  /**
   * Event handler for hover enter
   */
  onHoverEnter(postId: string): void {
    this.hoveredPostId = postId;
    
    // Update audio focus - if video is playing, it will get audio
    // If not playing yet, it will get audio once it starts playing
    this.updateAudioFocus();
  }

  /**
   * Event handler for hover leave
   * DISABLED FOR TESTING - only positional audio
   */
  onHoverLeave(postId: string): void {
    if (this.hoveredPostId === postId) {
      this.hoveredPostId = undefined;

      if (this.currentAudioOwner === postId) {
        this.releaseAudioFocus(postId);
      } else {
        this.updateAudioFocus();
      }
    }
  }


  /**
   * Get current audio owner
   */
  getCurrentAudioOwner(): string | undefined {
    return this.currentAudioOwner;
  }

  /**
   * Get current priority
   */
  getCurrentPriority(): AudioPriority {
    return this.ownerPriority;
  }

  /**
   * Check if a video is manually started
   */
  isManuallyStarted(postId: string): boolean {
    return this.manuallyStartedVideos.has(postId);
  }

  /**
   * Mark video as manually started
   */
  markManuallyStarted(postId: string): void {
    this.manuallyStartedVideos.add(postId);
    // Immediately request audio focus with MANUAL priority
    // This ensures manually started videos take priority over center-based videos
    this.requestAudioFocus(postId, AudioPriority.MANUAL);
  }

  /**
   * Unmark video as manually started
   */
  unmarkManuallyStarted(postId: string): void {
    this.manuallyStartedVideos.delete(postId);
    this.updateAudioFocus();
  }

  /**
   * Debug logging
   */
  private debugLog(event: string, payload?: Record<string, unknown>): void {
    if (this.debugEnabled && this.logger) {
      this.logger(event, payload);
    }
  }
}

