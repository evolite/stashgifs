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
}

export class VisibilityManager {
  private observer: IntersectionObserver;
  private entries: Map<string, VisibilityEntry>;
  private activeVideos: Set<string>;
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
  }) {
    // On mobile, use larger rootMargin to start loading videos earlier
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const defaultRootMargin = isMobile ? '200px' : '50px';
    
    this.options = {
      threshold: options?.threshold ?? 0.5,
      rootMargin: options?.rootMargin ?? defaultRootMargin,
      autoPlay: options?.autoPlay ?? false,
      maxConcurrent: options?.maxConcurrent ?? 3,
    };

    this.entries = new Map();
    this.activeVideos = new Set();

    this.observer = new IntersectionObserver(
      (intersectionEntries) => this.handleIntersection(intersectionEntries),
      {
        threshold: this.options.threshold,
        rootMargin: this.options.rootMargin,
      }
    );
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
    });

    this.observer.observe(element);
  }

  /**
   * Register a video player for a post
   */
  registerPlayer(postId: string, player: NativeVideoPlayer): void {
    const entry = this.entries.get(postId);
    if (entry) {
      entry.player = player;
    }
  }

  /**
   * Handle intersection changes
   */
  private handleIntersection(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const postId = this.findPostId(entry.target as HTMLElement);
      if (!postId) continue;

      const visibilityEntry = this.entries.get(postId);
      if (!visibilityEntry) continue;

      const isVisible = entry.isIntersecting && entry.intersectionRatio >= this.options.threshold;
      const wasVisible = visibilityEntry.isVisible;

      visibilityEntry.isVisible = isVisible;

      if (isVisible && !wasVisible) {
        this.handlePostEnteredViewport(postId, visibilityEntry);
      } else if (!isVisible && wasVisible) {
        this.handlePostExitedViewport(postId, visibilityEntry);
      }
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
    
    if (this.activeVideos.size >= this.options.maxConcurrent) {
      // Pause the oldest video
      const oldestId = Array.from(this.activeVideos)[0];
      this.pauseVideo(oldestId);
      this.activeVideos.delete(oldestId);
    }

    if (entry.player) {
      if (this.options.autoPlay) {
        // Robust play with multiple retries
        const tryPlay = async (attempt: number = 1, maxAttempts: number = 5): Promise<void> => {
          if (!entry.player) return;
          
          try {
            // On mobile, use shorter timeout and less strict readiness check
            const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
            const timeout = isMobile ? 1000 : 3000;
            
            // Wait for video to be ready (shorter timeout on mobile)
            await entry.player.waitUntilCanPlay(timeout);
            
            // Minimal delay on mobile, slightly longer on desktop
            const delay = isMobile ? 10 : 50;
            await new Promise(resolve => setTimeout(resolve, delay));
            
            // Attempt to play
            await entry.player.play();
          } catch (err: any) {
            console.warn(`VisibilityManager: Play attempt ${attempt} failed`, { postId, error: err });
            
            if (attempt < maxAttempts && entry.player) {
              // Faster retries on mobile
              const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
              const baseDelay = isMobile ? 50 : 100;
              const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), isMobile ? 800 : 1600);
              setTimeout(() => {
                if (entry.player) {
                  tryPlay(attempt + 1, maxAttempts).catch(() => {});
                }
              }, delay);
            } else {
              console.error('VisibilityManager: All play attempts failed', { postId, attempts: attempt });
            }
          }
        };
        
        // Start playing attempt immediately
        tryPlay().catch(() => {});
      }
      this.activeVideos.add(postId);
    } else {
      console.warn('VisibilityManager: No player registered for post', postId);
    }
  }

  private handlePostExitedViewport(postId: string, entry: VisibilityEntry): void {
    if (entry.player) {
      entry.player.pause();
      this.activeVideos.delete(postId);
    }
  }

  private pauseVideo(postId: string): void {
    const entry = this.entries.get(postId);
    if (entry?.player) {
      entry.player.pause();
    }
  }

  /**
   * Unobserve a post
   */
  unobservePost(postId: string): void {
    const entry = this.entries.get(postId);
    if (entry) {
      this.observer.unobserve(entry.element);
      if (entry.player) {
        entry.player.destroy();
      }
      this.entries.delete(postId);
      this.activeVideos.delete(postId);
    }
  }

  /**
   * Retry playing all currently visible videos
   * Useful for unlocking autoplay on mobile after user interaction
   */
  retryVisibleVideos(): void {
    for (const [postId, entry] of this.entries.entries()) {
      if (entry.isVisible && entry.player && !this.activeVideos.has(postId)) {
        // Try to play visible videos that aren't already playing
        entry.player.play().catch(() => {
          // Silently fail - video will play on tap if needed
        });
        this.activeVideos.add(postId);
      }
    }
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    this.observer.disconnect();
    for (const entry of this.entries.values()) {
      if (entry.player) {
        entry.player.destroy();
      }
    }
    this.entries.clear();
    this.activeVideos.clear();
  }
}

