/**
 * Visibility Manager
 * Handles video playback based on viewport visibility using Intersection Observer
 */

import { NativeVideoPlayer } from './NativeVideoPlayer';

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
    this.options = {
      threshold: options?.threshold ?? 0.5,
      rootMargin: options?.rootMargin ?? '50px',
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
        entry.player.play();
      }
      this.activeVideos.add(postId);
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

