import { StashAPI } from './StashAPI.js';
import { SceneMarker } from './types.js';

export const FAVORITE_TAG_NAME = 'StashGifs Favorite';

export class FavoritesManager {
  private readonly api: StashAPI;

  constructor(api: StashAPI) {
    this.api = api;
  }

  async getFavoriteTagId(): Promise<string | null> {
    try {
      return (await this.api.ensureTag(FAVORITE_TAG_NAME))?.id ?? null;
    } catch (error) {
      console.error('FavoritesManager: Failed to get favorite tag', error);
      return null;
    }
  }

  private isShortFormMarker(marker: SceneMarker): boolean {
    return typeof marker.id === 'string' && marker.id.startsWith('shortform-');
  }

  async isFavorite(marker: SceneMarker): Promise<boolean> {
    try {
      const tagId = await this.getFavoriteTagId();
      if (!tagId) return false;

      if (this.isShortFormMarker(marker)) {
        if (marker.scene?.tags && marker.scene.tags.length > 0) {
          return marker.scene.tags.some(tag => tag.id === tagId);
        }
        if (marker.scene?.id) {
          return await this.api.sceneHasTag(marker.scene.id, tagId);
        }
        return false;
      }

      return this.api.markerHasTag(marker, tagId);
    } catch (error) {
      console.error('FavoritesManager: Failed to check favorite status', error);
      return false;
    }
  }

  private async resolveFavoriteContext(marker: SceneMarker): Promise<{ tagId: string; isCurrentlyFavorite: boolean }> {
    const tagId = await this.getFavoriteTagId();
    if (!tagId) {
      throw new Error('Favorite tag not available');
    }
    const isCurrentlyFavorite = await this.isFavorite(marker);
    return { tagId, isCurrentlyFavorite };
  }

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

