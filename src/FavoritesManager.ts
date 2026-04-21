/**
 * Favorites Manager
 * Manages favorite scenes using Stash GraphQL API with a special tag
 */

import { StashAPI } from './StashAPI.js';
import { SceneMarker } from './types.js';

const FAVORITE_TAG_NAME = 'StashGifs Favorite';

export class FavoritesManager {
  private readonly api: StashAPI;
  private favoriteTagId: string | null = null;
  private favoriteTagPromise: Promise<string | null> | null = null;

  constructor(api: StashAPI) {
    this.api = api;
  }

  /**
   * Get or create the favorite tag
   */
  async getFavoriteTagId(): Promise<string | null> {
    // If we already have it cached, return it
    if (this.favoriteTagId) {
      return this.favoriteTagId;
    }

    // If there's already a request in progress, wait for it
    if (this.favoriteTagPromise) {
      return this.favoriteTagPromise;
    }

    // Start a new request
    this.favoriteTagPromise = this.findOrCreateFavoriteTag();
    const tagId = await this.favoriteTagPromise;
    this.favoriteTagId = tagId;
    return tagId;
  }

  /**
   * Find existing favorite tag or create it
   */
  private async findOrCreateFavoriteTag(): Promise<string | null> {
    try {
      // First, try to find the tag
      const existingTag = await this.api.findTagByName(FAVORITE_TAG_NAME);
      if (existingTag) {
        return existingTag.id;
      }

      // If not found, create it
      const newTag = await this.api.createTag(FAVORITE_TAG_NAME);
      return newTag?.id || null;
    } catch (error) {
      console.error('FavoritesManager: Failed to get favorite tag', error);
      return null;
    }
  }

  /**
   * Check if a marker represents shortform content (scene, not a real marker)
   */
  private isShortFormMarker(marker: SceneMarker): boolean {
    return typeof marker.id === 'string' && marker.id.startsWith('shortform-');
  }

  /**
   * Check if a marker is favorited
   */
  async isFavorite(marker: SceneMarker): Promise<boolean> {
    try {
      const tagId = await this.getFavoriteTagId();
      if (!tagId) return false;

      // For shortform content, check scene tags instead of marker tags
      if (this.isShortFormMarker(marker)) {
        // Check scene tags directly from marker data if available
        if (marker.scene?.tags && marker.scene.tags.length > 0) {
          return marker.scene.tags.some(tag => tag.id === tagId);
        }
        // Fall back to API query if scene tags not available
        if (marker.scene?.id) {
          return await this.api.sceneHasTag(marker.scene.id, tagId);
        }
        return false;
      }

      return await this.api.markerHasTag(marker, tagId);
    } catch (error) {
      console.error('FavoritesManager: Failed to check favorite status', error);
      return false;
    }
  }

  /**
   * Resolve favorite tag ID and current status for a marker
   */
  private async resolveFavoriteContext(marker: SceneMarker): Promise<{ tagId: string; isCurrentlyFavorite: boolean }> {
    const tagId = await this.getFavoriteTagId();
    if (!tagId) {
      throw new Error('Favorite tag not available');
    }
    const isCurrentlyFavorite = await this.isFavorite(marker);
    return { tagId, isCurrentlyFavorite };
  }

  /**
   * Apply a favorite state change (add or remove tag)
   */
  private async applyFavoriteChange(marker: SceneMarker, tagId: string, shouldBeFavorite: boolean): Promise<void> {
    if (this.isShortFormMarker(marker)) {
      if (!marker.scene?.id) {
        throw new Error('Scene ID not available for shortform marker');
      }
      if (shouldBeFavorite) {
        await this.api.addTagToScene(marker.scene.id, tagId);
      } else {
        await this.api.removeTagFromScene(marker.scene.id, tagId);
      }
    } else if (shouldBeFavorite) {
      await this.api.addTagToMarker(marker, tagId);
    } else {
      await this.api.removeTagFromMarker(marker, tagId);
    }
  }

  /**
   * Toggle favorite status for a marker
   */
  async toggleFavorite(marker: SceneMarker): Promise<boolean> {
    try {
      const { tagId, isCurrentlyFavorite } = await this.resolveFavoriteContext(marker);
      const newState = !isCurrentlyFavorite;
      await this.applyFavoriteChange(marker, tagId, newState);
      return newState;
    } catch (error) {
      console.error('FavoritesManager: Failed to toggle favorite', error);
      throw error;
    }
  }

  /**
   * Set favorite status (without toggling)
   */
  async setFavorite(marker: SceneMarker, favorite: boolean): Promise<void> {
    try {
      const { tagId, isCurrentlyFavorite } = await this.resolveFavoriteContext(marker);
      if (favorite !== isCurrentlyFavorite) {
        await this.applyFavoriteChange(marker, tagId, favorite);
      }
    } catch (error) {
      console.error('FavoritesManager: Failed to set favorite', error);
      throw error;
    }
  }
}

