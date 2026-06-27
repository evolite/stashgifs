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
  private bookmarkTagId: string | null | undefined = undefined;
  private bookmarkTagPromise: Promise<string | null> | null = null;

  constructor(api: StashAPI) {
    this.api = api;
  }

  async getBookmarkTagId(): Promise<string | null> {
    if (this.bookmarkTagId !== undefined) {
      return this.bookmarkTagId;
    }
    if (this.bookmarkTagPromise) {
      return this.bookmarkTagPromise;
    }
    this.bookmarkTagPromise = this.findOrCreateBookmarkTag().finally(() => {
      this.bookmarkTagPromise = null;
    });
    const tagId = await this.bookmarkTagPromise;
    this.bookmarkTagId = tagId;
    return tagId;
  }

  private async findOrCreateBookmarkTag(): Promise<string | null> {
    try {
      const existingTag = await this.api.findTagByName(BOOKMARK_TAG_NAME);
      if (existingTag) {
        return existingTag.id;
      }
      const newTag = await this.api.createTag(BOOKMARK_TAG_NAME);
      return newTag?.id || null;
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
