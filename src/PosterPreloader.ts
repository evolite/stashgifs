/**
 * Poster preloader for batching screenshot requests up-front.
 * Uses the marker-specific screenshot endpoint:
 *   /scene/{sceneId}/scene_marker/{markerId}/screenshot
 * Caches resolved poster URLs for quick lookup when rendering posts.
 */
import { SceneMarker } from './types.js';
import { toAbsoluteUrl } from './utils.js';

class PosterPreloader {
  private cache: Map<string, string> = new Map();
  private inflight: Set<string> = new Set();

  /**
   * Build the marker screenshot URL using scene + marker IDs.
   * Adds cache-busting query parameter to prevent 304 responses with empty data.
   */
  private buildMarkerScreenshotUrl(marker: SceneMarker): string | undefined {
    const markerId = marker?.id;
    const sceneId = marker?.scene?.id;
    if (!markerId || !sceneId) return undefined;
    // Skip screenshot requests for synthetic markers (shuffle/random mode)
    if (typeof markerId === 'string' && markerId.startsWith('synthetic-')) return undefined;
    // Path-style endpoint; assume same-origin
    // Add cache-busting timestamp to prevent 304 responses with empty/corrupted cache
    const timestamp = Date.now();
    const path = `/scene/${sceneId}/scene_marker/${markerId}/screenshot?t=${timestamp}`;
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
      if (this.cache.has(id) || this.inflight.has(id)) continue;
      const url = this.buildMarkerScreenshotUrl(marker);
      if (!url) continue;
      this.inflight.add(id);
      // Use Image to warm cache; store on load
      const img = new Image();
      img.onload = () => {
        this.cache.set(id, url);
        this.inflight.delete(id);
      };
      img.onerror = () => {
        // Keep silent; just drop inflight and don't cache failures
        this.inflight.delete(id);
      };
      img.src = url;
    }
  }

  /**
   * Get a cached poster URL for a marker, if available.
   */
  getPosterForMarker(marker: SceneMarker): string | undefined {
    const id = marker?.id;
    if (!id) return undefined;
    return this.cache.get(id);
  }
}

export const posterPreloader = new PosterPreloader();



