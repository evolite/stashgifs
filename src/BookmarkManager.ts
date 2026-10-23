/**
 * Bookmark Manager
 * Manages bookmarked scenes using Stash GraphQL API with a special tag.
 * Always applies to the parent scene (never to the marker directly).
 */

import { StashAPI } from './StashAPI.js';
import { SceneMarker } from './types.js';

const BOOKMARK_TAG_NAME = 'Stashgifs bookmark';

export class BookmarkManager {
  private readonly api: StashAPI;

  constructor(api: StashAPI) {
    this.api = api;
  }

  /** Id of the bookmark tag, created on first use. Null if Stash couldn't provide it (retried next call). */
  async getBookmarkTagId(): Promise<string | null> {
    try {
      return (await this.api.ensureTag(BOOKMARK_TAG_NAME))?.id ?? null;
    } catch (error) {
      console.error('BookmarkManager: Failed to get bookmark tag', error);
      return null;
    }
  }

  async isBookmarked(marker: SceneMarker): Promise<boolean> {
    try {
      const tagId = await this.getBookmarkTagId();
      if (!tagId) return false;
      if (marker.scene?.tags && marker.scene.tags.length > 0) {
        return marker.scene.tags.some(tag => tag.id === tagId);
      }
      if (marker.scene?.id) {
        return await this.api.sceneHasTag(marker.scene.id, tagId);
      }
      return false;
    } catch (error) {
      console.error('BookmarkManager: Failed to check bookmark status', error);
      return false;
    }
  }

  async toggleBookmark(marker: SceneMarker): Promise<boolean> {
    const tagId = await this.getBookmarkTagId();
    if (!tagId) throw new Error('Bookmark tag not available');
    if (!marker.scene?.id) throw new Error('Scene ID not available');

    const isCurrentlyBookmarked = await this.isBookmarked(marker);
    const newState = !isCurrentlyBookmarked;
    if (newState) {
      await this.api.addTagToScene(marker.scene.id, tagId);
    } else {
      await this.api.removeTagFromScene(marker.scene.id, tagId);
    }
    return newState;
  }
}
