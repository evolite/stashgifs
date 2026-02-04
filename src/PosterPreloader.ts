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

  /**
   * Build the marker screenshot URL using scene + marker IDs.
   * Adds cache-busting query parameter to prevent 304 responses with empty data.
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
    // Add cache-busting timestamp to prevent 304 responses with empty/corrupted cache
    const timestamp = Date.now();
    const path = `/scene/${sceneId}/scene_marker/${markerIdStr}/screenshot?t=${timestamp}`;
    return toAbsoluteUrl(path);
  }

  /**
   * Prefetch poster images for a list of markers.
   * Limits to maxCount to avoid overloading the network.
   */
  prefetchForMarkers(markers: SceneMarker[], maxCount: number = 24): void {
    const slice = markers.slice(0, Math.max(0, maxCount));
    for (const marker of slice) {
      const id = marker?.id;
      if (!id) continue;
      // Convert to string to handle both string and number IDs
      const idStr = String(id);
      if (this.cache.has(idStr) || this.inflight.has(idStr)) continue;
      const url = this.buildMarkerScreenshotUrl(marker);
      if (!url) continue;
      // Use Image to warm cache; store on load
      const img = new Image();
      this.inflight.set(idStr, img);
      img.onload = () => {
        this.cache.set(idStr, url);
        this.inflight.delete(idStr);
      };
      img.onerror = () => {
        // Keep silent; just drop inflight and don't cache failures
        this.inflight.delete(idStr);
      };
      const normalizedUrl = normalizeMediaUrl(url);
      if (!normalizedUrl) {
        console.warn('PosterPreloader: Invalid poster URL', { url });
        this.inflight.delete(idStr);
        continue;
      }
      img.src = normalizedUrl;
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

