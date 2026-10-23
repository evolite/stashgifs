/**
 * Entity details and writes: performer/studio details, ratings, O-counts, play counts, watch activity,
 * image and scene edits, galleries, and marker creation.
 */

import * as queries from '../graphql/queries.js';
import * as mutations from '../graphql/mutations.js';
import type {
  FindPerformerResponse,
  PerformerExtended,
  FindStudioResponse,
  StudioExtended,
  FindGalleriesResponse,
  Gallery,
  SceneUpdateResponse,
  SceneAddOResponse,
  SceneIncrementPlayCountResponse,
  SceneSaveActivityResponse,
  ImageUpdateResponse,
  ImageIncrementOResponse,
  SceneMarkerCreateResponse,
} from '../graphql/types.js';
import type { Scene } from '../types.js';
import { isAbortError } from '../graphql/errors.js';
import type { ApiIO } from './ApiIO.js';

export class EntityApi {
  constructor(private readonly io: ApiIO) {}

  /**
   * Get detailed performer information by ID
   * Used for hover overlay display
   */
  async getPerformerDetails(performerId: string, signal?: AbortSignal): Promise<PerformerExtended | null> {
    if (this.io.isAborted(signal)) return null;

    try {
      const result = await this.io.gql.query<FindPerformerResponse>({
        query: queries.FIND_PERFORMER,
        variables: { ids: [performerId] },
        signal,
      });

      if (this.io.isAborted(signal)) return null;

      const performers = result.data?.findPerformers?.performers ?? [];
      return performers[0] ?? null;
    } catch (error: unknown) {
      return this.io.handleError('getPerformerDetails', error, signal, null);
    }
  }

  async getStudioDetails(studioId: string, signal?: AbortSignal): Promise<StudioExtended | null> {
    if (this.io.isAborted(signal)) return null;
    try {
      const result = await this.io.gql.query<FindStudioResponse>({
        query: queries.FIND_STUDIO,
        variables: { id: studioId },
        signal,
      });
      if (this.io.isAborted(signal)) return null;
      return result.data?.findStudio ?? null;
    } catch (error: unknown) {
      return this.io.handleError('getStudioDetails', error, signal, null);
    }
  }

  private async updateImageField(
    imageId: string,
    field: 'tag_ids' | 'performer_ids',
    ids: string[],
    signal: AbortSignal | undefined,
    logContext: string
  ): Promise<void> {
    if (this.io.isAborted(signal)) return;

    try {
      await this.io.gql.mutate<ImageUpdateResponse>({
        mutation: mutations.IMAGE_UPDATE,
        variables: {
          input: {
            id: imageId,
            [field]: ids,
          },
        },
        signal,
      });

      if (this.io.isAborted(signal)) return;
    } catch (error) {
      if (isAbortError(error) || this.io.isAborted(signal)) {
        return;
      }
      this.io.logError(logContext, error);
      throw error;
    }
  }

  /**
   * Update tags for an image
   */
  async updateImageTags(imageId: string, tagIds: string[], signal?: AbortSignal): Promise<void> {
    return this.updateImageField(imageId, 'tag_ids', tagIds, signal, 'updateImageTags');
  }

  /**
   * Update performers for an image
   */
  async updateImagePerformers(imageId: string, performerIds: string[], signal?: AbortSignal): Promise<void> {
    return this.updateImageField(imageId, 'performer_ids', performerIds, signal, 'updateImagePerformers');
  }

  /**
   * Increment image o-counter
   */
  async incrementImageOCount(imageId: string, signal?: AbortSignal): Promise<number> {
    if (this.io.isAborted(signal)) return 0;
    
    try {
      const result = await this.io.gql.mutate<ImageIncrementOResponse>({
        mutation: mutations.IMAGE_INCREMENT_O,
        variables: {
          id: imageId,
        },
        signal,
      });
      
      if (this.io.isAborted(signal)) return 0;
      
      return result.data?.imageIncrementO ?? 0;
    } catch (error) {
      if (isAbortError(error) || this.io.isAborted(signal)) {
        return 0;
      }
      this.io.logError('incrementImageOCount', error);
      throw error;
    }
  }

  /**
   * Update performers on a scene
   */
  async updateScenePerformers(sceneId: string, performerIds: string[], signal?: AbortSignal): Promise<void> {
    if (this.io.isAborted(signal)) return;

    const variables = {
      input: {
        id: sceneId,
        performer_ids: performerIds
      }
    };

    await this.io.gql.mutate<SceneUpdateResponse>({
      mutation: mutations.SCENE_UPDATE,
      variables,
      signal,
    });

    if (this.io.isAborted(signal)) return;
  }

  /**
   * Update performer favorite flag
   */
  async updatePerformerFavorite(performerId: string, favorite: boolean, signal?: AbortSignal): Promise<void> {
    if (this.io.isAborted(signal)) return;

    const variables = {
      input: {
        id: performerId,
        favorite,
      }
    };

    await this.io.gql.mutate({
      mutation: mutations.PERFORMER_UPDATE,
      variables,
      signal,
    });

    if (this.io.isAborted(signal)) return;
  }

  /**
   * Increment the o count for a scene
   * @param sceneId The scene ID
   * @param times Optional array of timestamps (if not provided, uses current time)
   * @param signal Optional abort signal
   * @returns The updated o count and history
   */
  async incrementOCount(sceneId: string, times?: string[], signal?: AbortSignal): Promise<{ count: number; history: string[] }> {
    if (this.io.isAborted(signal)) return { count: 0, history: [] };
    
    const variables = {
      id: sceneId,
      times: times || undefined
    };

    try {
      const result = await this.io.gql.mutate<SceneAddOResponse>({
        mutation: mutations.SCENE_ADD_O,
        variables,
        signal,
      });
      
      if (this.io.isAborted(signal)) return { count: 0, history: [] };
      
      const sceneAddO = result.data?.sceneAddO;
      if (sceneAddO && 'count' in sceneAddO) {
        return { count: sceneAddO.count ?? 0, history: times || [] };
      }
      // Return provided times in history even when count is missing
      return { count: 0, history: times || [] };
    } catch (error) {
      if (isAbortError(error) || this.io.isAborted(signal)) {
        return { count: 0, history: [] };
      }
      this.io.logError('incrementOCount', error);
      throw error;
    }
  }

  /**
   * Increment the play count for a scene. Fire-and-forget — never throws.
   */
  // fallow-ignore-next-line unused-class-member
  async incrementScenePlayCount(sceneId: string): Promise<void> {
    if (!sceneId) return;
    try {
      await this.io.gql.mutate<SceneIncrementPlayCountResponse>({
        mutation: mutations.SCENE_INCREMENT_PLAY_COUNT,
        variables: { id: sceneId },
      });
    } catch (error) {
      this.io.logError('incrementScenePlayCount', error);
    }
  }

  /**
   * Save scene watch activity. Fire-and-forget — never throws.
   * @param resumeTime Current playback position in the scene (seconds), or undefined
   * @param playDuration Seconds watched in this session
   */
  // fallow-ignore-next-line unused-class-member
  async saveSceneActivity(sceneId: string, resumeTime: number | undefined, playDuration: number): Promise<void> {
    if (!sceneId || playDuration <= 0) return;
    try {
      await this.io.gql.mutate<SceneSaveActivityResponse>({
        mutation: mutations.SCENE_SAVE_ACTIVITY,
        variables: { id: sceneId, resume_time: resumeTime, playDuration },
      });
    } catch (error) {
      this.io.logError('saveSceneActivity', error);
    }
  }

  /**
   * Validate and normalize a rating10 value to rating100
   */
  private validateAndNormalizeRating(methodName: string, entityId: string, rating10: number): number {
    if (!entityId || typeof entityId !== 'string' || entityId.trim() === '') {
      throw new Error(`${methodName}: entityId is required and must be a non-empty string`);
    }
    if (typeof rating10 !== 'number' || !Number.isFinite(rating10)) {
      throw new TypeError(`${methodName}: rating10 must be a finite number`);
    }
    const normalized = Number.isFinite(rating10) ? rating10 : 0;
    const clamped = Math.min(10, Math.max(0, normalized));
    return Math.round(clamped * 10);
  }

  /**
   * Perform a rating mutation (shared by scene and image rating updates)
   */
  private async performRatingMutation<T>(
    methodName: string,
    entityId: string,
    rating100: number,
    mutation: string,
    signal?: AbortSignal
  ): Promise<number> {
    if (this.io.isAborted(signal)) return 0;

    try {
      await this.io.gql.mutate<T>({
        mutation,
        variables: { input: { id: entityId, rating100 } },
        signal,
      });

      if (this.io.isAborted(signal)) return 0;
      return rating100;
    } catch (error) {
      if (isAbortError(error) || this.io.isAborted(signal)) {
        return 0;
      }
      this.io.logError(methodName, error);
      throw error;
    }
  }

  /**
   * Update the rating for a scene (0-10 scale → rating100)
   */
  async updateSceneRating(sceneId: string, rating10: number, signal?: AbortSignal): Promise<number> {
    const rating100 = this.validateAndNormalizeRating('updateSceneRating', sceneId, rating10);
    return this.performRatingMutation<SceneUpdateResponse>('updateSceneRating', sceneId, rating100, mutations.SCENE_UPDATE, signal);
  }

  /**
   * Update image rating (0-10 scale → rating100)
   */
  async updateImageRating(imageId: string, rating10: number, signal?: AbortSignal): Promise<number> {
    const rating100 = this.validateAndNormalizeRating('updateImageRating', imageId, rating10);
    return this.performRatingMutation<{ imageUpdate: { id: string } }>('updateImageRating', imageId, rating100, mutations.IMAGE_UPDATE, signal);
  }

  /**
   * Find all galleries (for gallery selector in settings)
   * @param signal Optional abort signal
   * @returns Array of galleries with id, title, and folder path
   */
  async findGalleries(signal?: AbortSignal): Promise<Gallery[]> {
    if (this.io.isAborted(signal)) return [];
    try {
      const result = await this.io.gql.query<FindGalleriesResponse>({
        query: queries.FIND_GALLERIES,
        variables: { filter: { per_page: -1, sort: 'title', direction: 'ASC' } },
        signal,
      });
      if (this.io.isAborted(signal)) return [];
      return result.data?.findGalleries?.galleries ?? [];
    } catch (error: unknown) {
      if (isAbortError(error) || this.io.isAborted(signal)) return [];
      this.io.logError('findGalleries', error);
      return [];
    }
  }

  /**
   * Create a new scene marker
   * @param sceneId Scene ID
   * @param seconds Start time in seconds
   * @param primaryTagId Primary tag ID (required)
   * @param title Optional title (defaults to empty string)
   * @param endSeconds Optional end time in seconds
   * @param tagIds Optional array of additional tag IDs
   * @param signal Optional abort signal
   * @returns Created marker data
   */
  /**
   * Validate createSceneMarker input parameters
   */
  private validateCreateSceneMarkerInput(
    sceneId: string,
    seconds: number,
    primaryTagId: string,
    endSeconds: number | null | undefined,
    tagIds: string[]
  ): void {
    if (!sceneId || typeof sceneId !== 'string' || sceneId.trim() === '') {
      throw new Error('createSceneMarker: sceneId is required and must be a non-empty string');
    }
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
      throw new TypeError('createSceneMarker: seconds must be a non-negative number');
    }
    if (!primaryTagId || typeof primaryTagId !== 'string' || primaryTagId.trim() === '') {
      throw new Error('createSceneMarker: primaryTagId is required and must be a non-empty string');
    }
    if (endSeconds !== null && endSeconds !== undefined) {
      if (typeof endSeconds !== 'number' || !Number.isFinite(endSeconds) || endSeconds < 0) {
        throw new TypeError('createSceneMarker: endSeconds must be a non-negative number or null');
      }
      if (endSeconds < seconds) {
        throw new Error('createSceneMarker: endSeconds must be greater than or equal to seconds');
      }
    }
    if (!Array.isArray(tagIds)) {
      throw new TypeError('createSceneMarker: tagIds must be an array');
    }
  }

  async createSceneMarker(
    sceneId: string,
    seconds: number,
    primaryTagId: string,
    title: string = '',
    endSeconds?: number | null,
    tagIds: string[] = [],
    signal?: AbortSignal
  ): Promise<{ id: string; title: string; seconds: number; end_seconds?: number; stream?: string; preview?: string; scene: { id: string; title?: string; files?: Array<{ width?: number; height?: number; path?: string }>; performers?: Array<{ id: string; name: string; image_path?: string }> } | Scene; primary_tag: { id: string; name: string }; tags: Array<{ id: string; name: string }> }> {
    if (this.io.isAborted(signal)) {
      throw new Error('Operation aborted');
    }
    
    // Input validation
    this.validateCreateSceneMarkerInput(sceneId, seconds, primaryTagId, endSeconds, tagIds);
    
    const variables = {
      title,
      seconds,
      end_seconds: endSeconds ?? null,
      scene_id: sceneId,
      primary_tag_id: primaryTagId,
      tag_ids: tagIds,
    };

    try {
      const result = await this.io.gql.mutate<SceneMarkerCreateResponse>({
        mutation: mutations.SCENE_MARKER_CREATE,
        variables,
        signal,
      });
      
      if (this.io.isAborted(signal)) {
        throw new Error('Operation aborted');
      }
      
      const marker = result.data?.sceneMarkerCreate;
      if (!marker) {
        throw new Error('Failed to create scene marker: response was null');
      }
      // Convert null end_seconds to undefined to match return type
      return {
        ...marker,
        end_seconds: marker.end_seconds ?? undefined,
      };
    } catch (error) {
      if (isAbortError(error) || this.io.isAborted(signal)) {
        throw new Error('Operation aborted');
      }
      this.io.logError('createSceneMarker', error);
      throw error;
    }
  }
}
