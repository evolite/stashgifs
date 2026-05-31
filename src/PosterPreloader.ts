/**
 * Poster preloader for batching screenshot requests up-front.
 * Uses the marker-specific screenshot endpoint:
 *   /scene/{sceneId}/scene_marker/{markerId}/screenshot
 * Caches resolved poster URLs for quick lookup when rendering posts.
 */
import { SceneMarker } from './types.js';
import { normalizeMediaUrl, toAbsoluteUrl } from './utils.js';

class PosterPreloader {
  private readonly cache: Map<string, string> = new Map();
  private readonly inflight: Map<string, HTMLImageElement> = new Map();
  private pendingQueue: Array<{ idStr: string; url: string }> = [];
  private activeCount = 0;
  private currentMaxConcurrent = Infinity;

  /**
   * Build the marker screenshot URL using scene + marker IDs.
   * Uses a stable per-marker cache key so the warmed poster matches the URL the
   * post later requests (enabling a cache hit) and so re-scrolling reuses it
   * instead of re-downloading.
   */
  private buildMarkerScreenshotUrl(marker: SceneMarker): string | undefined {
    const markerId = marker?.id;
    const sceneId = marker?.scene?.id;
    if (!markerId || !sceneId) return undefined;
    // Skip screenshot requests for synthetic markers (shuffle/random mode) and short form markers
    // Convert to string to handle both string and number IDs, then check for synthetic/shortform prefix
    const markerIdStr = String(markerId);
    if (markerIdStr.startsWith('synthetic-') || markerIdStr.startsWith('shortform-')) return undefined;
    // Path-style endpoint; assume same-origin
    const path = `/scene/${sceneId}/scene_marker/${markerIdStr}/screenshot?t=${markerIdStr}`;
    return toAbsoluteUrl(path);
  }

  prefetchForMarkers(markers: SceneMarker[], maxCount: number = 24, maxConcurrent: number = Infinity): void {
    this.currentMaxConcurrent = maxConcurrent;
    const slice = markers.slice(0, Math.max(0, maxCount));
    for (const marker of slice) {
      const id = marker?.id;
      if (!id) continue;
      const idStr = String(id);
      if (this.cache.has(idStr) || this.inflight.has(idStr)) continue;
      const url = this.buildMarkerScreenshotUrl(marker);
      if (!url) continue;
      if (this.activeCount < this.currentMaxConcurrent) {
        this.startFetch(idStr, url);
      } else {
        this.pendingQueue.push({ idStr, url });
      }
    }
  }

  private startFetch(idStr: string, url: string): void {
    const normalizedUrl = normalizeMediaUrl(url);
    if (!normalizedUrl) {
      console.warn('PosterPreloader: Invalid poster URL', { url });
      return;
    }
    const img = new Image();
    this.inflight.set(idStr, img);
    this.activeCount++;
    img.onload = () => {
      this.cache.set(idStr, url);
      this.inflight.delete(idStr);
      this.activeCount--;
      this.drainQueue();
    };
    img.onerror = () => {
      this.inflight.delete(idStr);
      this.activeCount--;
      this.drainQueue();
    };
    img.src = normalizedUrl;
  }

  private drainQueue(): void {
    while (this.pendingQueue.length > 0 && this.activeCount < this.currentMaxConcurrent) {
      const next = this.pendingQueue.shift()!;
      if (!this.cache.has(next.idStr) && !this.inflight.has(next.idStr)) {
        this.startFetch(next.idStr, next.url);
      }
    }
  }

  /**
   * Cancel all inflight prefetches
   */
  cancelInflight(): void {
    for (const img of this.inflight.values()) {
      img.src = '';
    }
    this.inflight.clear();
    this.pendingQueue = [];
    this.activeCount = 0;
  }

  /**
   * Get a cached poster URL for a marker, if available.
   */
  getPosterForMarker(marker: SceneMarker): string | undefined {
    const id = marker?.id;
    if (!id) return undefined;
    // Never return cached URLs for synthetic markers and short form markers (they don't exist in Stash)
    // Convert to string to handle both string and number IDs
    const idStr = String(id);
    if (idStr.startsWith('synthetic-') || idStr.startsWith('shortform-')) return undefined;
    return this.cache.get(idStr);
  }
}

export const posterPreloader = new PosterPreloader();

