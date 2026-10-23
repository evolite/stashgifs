/**
 * Tags: lookups by name, the plugin's own tags (favorite/bookmark/marker), scene and marker tag
 * edits, tag details, and which content types a tag effectively belongs to.
 *
 * Scene tag reads are batched and cached; scene tag edits are single server-side mutations.
 */

import * as queries from '../graphql/queries.js';
import * as mutations from '../graphql/mutations.js';
import type {
  FindTagsResponse,
  FindTagsExtendedResponse,
  TagCreateResponse,
  TagCreateInput,
  SceneMarkerUpdateResponse,
  SceneMarkerUpdateInput,
} from '../graphql/types.js';
import type { Scene } from '../types.js';
import { isAbortError } from '../graphql/errors.js';
import type { ApiIO } from './ApiIO.js';
import { TtlCache } from './TtlCache.js';
import { Batcher } from './Batcher.js';
import { runAliased } from './aliased.js';
import type { TagSource } from './FeedFilters.js';

export interface MarkerTagUpdateData {
  id: string;
  title: string;
  seconds: number;
  end_seconds?: number | null;
  scene: { id: string };
  primary_tag?: { id: string } | null;
  tags?: Array<{ id: string }>;
}

export class TagsApi {
  /** Per tag: which content types it (and its descendants) effectively belongs to. Filled by getTagSources,
   *  read by FeedFilters to route a tag to the single filter field that can match it. Cached for the session. */
  readonly tagSources = new Map<string, TagSource>();

  constructor(private readonly io: ApiIO) {}

  /**
   * Get detailed tag information by ID
   */
  async getTagDetails(tagId: string, signal?: AbortSignal): Promise<{ id: string; name: string; image_path?: string; description?: string; favorite?: boolean } | null> {
    if (this.io.isAborted(signal)) return null;

    try {
      const result = await this.io.gql.query<FindTagsExtendedResponse>({
        query: queries.FIND_TAGS_FOR_SELECT,
        variables: { ids: [tagId], filter: null, tag_filter: null },
        signal,
      });

      if (this.io.isAborted(signal)) return null;

      const tags = result.data?.findTags?.tags ?? [];
      return tags[0] ?? null;
    } catch (error: unknown) {
      return this.io.handleError('getTagDetails', error, signal, null);
    }
  }

  /**
   * Find a tag by name
   */
  /** Resolved tags by lowercase name — callers re-resolve the same few tags (favorite, bookmark, excluded) on every load. Misses aren't cached (the tag may be created later). */
  private readonly _tagByName = new TtlCache<{ id: string; name: string } | null>(Number.POSITIVE_INFINITY, 200);

  async findTagByName(tagName: string, signal?: AbortSignal): Promise<{ id: string; name: string } | null> {
    if (this.io.isAborted(signal)) return null;
    try {
      // The shared lookup carries no caller signal (tiny query; one caller aborting must not fail the rest).
      const tag = await this._tagByName.getOrLoad(tagName.toLowerCase(), () => this.queryTagByName(tagName), (t) => t !== null);
      return this.io.isAborted(signal) ? null : tag;
    } catch (error: unknown) {
      return this.io.rethrowUnlessAbort('findTagByName', error, signal, null);
    }
  }

  private async queryTagByName(tagName: string): Promise<{ id: string; name: string } | null> {
    // Use findTags (plural) instead of findTag (singular) as it's more widely supported
    const result = await this.io.gql.query<FindTagsResponse>({
      query: queries.FIND_TAGS,
      variables: {
        filter: { per_page: 1, page: 1 },
        tag_filter: { name: { value: tagName, modifier: 'EQUALS' } },
      },
    });
    const tag = result.data?.findTags?.tags?.[0];
    if (!tag) return null;
    // Validate exact match (case-insensitive) - EQUALS modifier might not work as expected
    if (tag.name.toLowerCase() !== tagName.toLowerCase()) {
      this.io.logError('findTagByName', new Error(`Tag name mismatch: searched="${tagName}", found="${tag.name}"`));
      return null;
    }
    return tag;
  }

  /**
   * Create a new tag
   * If the tag already exists, attempts to find and return it
   */
  async createTag(tagName: string, signal?: AbortSignal): Promise<{ id: string; name: string } | null> {
    if (this.io.isAborted(signal)) return null;
    
    const variables: { input: TagCreateInput } = {
      input: { name: tagName }
    };

    try {
      const result = await this.io.gql.mutate<TagCreateResponse>({
        mutation: mutations.TAG_CREATE,
        variables,
        signal,
      });
      
      if (this.io.isAborted(signal)) return null;
      
      return result.data?.tagCreate || null;
    } catch (error: unknown) {
      if (isAbortError(error) || this.io.isAborted(signal)) {
        return null;
      }
      
      // If tag already exists, try to find it
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('already exists') || errorMessage.includes('duplicate')) {
        this.io.logError('createTag', new Error(`Tag "${tagName}" already exists, attempting to find it`));
        // Try to find the existing tag
        const existingTag = await this.findTagByName(tagName, signal);
        if (existingTag) {
          return existingTag;
        }
      }
      this.io.logError('createTag', error);
      return null;
    }
  }

  /** Tags this plugin owns (favorite, bookmark, marker), resolved once per session. */
  private readonly _ensuredTags = new TtlCache<{ id: string; name: string } | null>(Number.POSITIVE_INFINITY, 20);

  /** Find the tag by name, creating it if missing. Concurrent callers share one lookup; failures throw and aren't remembered. */
  ensureTag(tagName: string): Promise<{ id: string; name: string } | null> {
    return this._ensuredTags.getOrLoad(
      tagName.toLowerCase(),
      async () => (await this.findTagByName(tagName)) ?? (await this.createTag(tagName)),
      (tag) => tag !== null,
    );
  }

  /**
   * Check if a scene marker has a specific tag
   * Uses the marker's existing tags array
   */
  async markerHasTag(marker: { id: string; tags?: Array<{ id: string }> }, tagId: string): Promise<boolean> {
    return marker.tags?.some(tag => tag.id === tagId) ?? false;
  }

  /**
   * Check if a scene has a specific tag
   * @param sceneId Scene ID
   * @param tagId Tag ID to check
   * @param tags Optional array of tags to check against (avoids query if provided)
   * @param signal Optional abort signal
   * @returns True if scene has the tag
   */
  async sceneHasTag(sceneId: string, tagId: string, tags?: Array<{ id: string }>, signal?: AbortSignal): Promise<boolean> {
    if (this.io.isAborted(signal)) return false;
    
    // If tags array is provided, use it directly (more efficient)
    if (tags) {
      return tags.some((tag) => tag.id === tagId);
    }
    
    try {
      const sceneTagIds = await this.getSceneTagIdSet(sceneId);
      if (this.io.isAborted(signal)) return false;
      return sceneTagIds.has(tagId);
    } catch (error: unknown) {
      return this.io.rethrowUnlessAbort('sceneHasTag', error, signal, false);
    }
  }

  /** Scene tag ids fetched so far, so repeat checks and toggles don't re-query. */
  private readonly _sceneTagIds = new TtlCache<Set<string>>(60_000, 1000);

  /** Per-post checks made while a page renders coalesce into one findScenes(ids: [...]) instead of one findScene each. */
  private readonly _sceneTagBatcher = new Batcher<string, Set<string>>(
    10,
    async (ids) => {
      const result = await this.io.gql.query<{ findScenes?: { scenes?: Array<{ id: string; tags?: Array<{ id: string }> }> } }>({
        query: queries.FIND_SCENES_TAG_IDS,
        variables: { ids, filter: { per_page: -1 } },
      });
      return new Map((result.data?.findScenes?.scenes ?? []).map((scene) => [scene.id, new Set((scene.tags ?? []).map((t) => t.id))]));
    },
    () => new Set<string>(),
  );

  private getSceneTagIdSet(sceneId: string): Promise<Set<string>> {
    return this._sceneTagIds.getOrLoad(sceneId, () => this._sceneTagBatcher.load(sceneId));
  }

  /**
   * Update tags on a scene marker
   */
  private async updateMarkerTags(
    marker: MarkerTagUpdateData,
    newTagIds: string[],
    signal?: AbortSignal
  ): Promise<void> {
    if (this.io.isAborted(signal)) return;
    
    // Ensure we have required fields
    if (!marker.primary_tag?.id) {
      throw new Error('Marker must have a primary_tag');
    }

    await this.updateMarkerTagsWithPrimary(marker, marker.primary_tag.id, newTagIds, signal);
  }

  async updateMarkerTagsWithPrimary(
    marker: Pick<MarkerTagUpdateData, 'id' | 'title' | 'seconds' | 'end_seconds' | 'scene'>,
    primaryTagId: string,
    tagIds: string[],
    signal?: AbortSignal
  ): Promise<void> {
    if (this.io.isAborted(signal)) return;

    const variables: SceneMarkerUpdateInput = {
      id: marker.id,
      title: marker.title,
      seconds: marker.seconds,
      end_seconds: marker.end_seconds ?? null,
      scene_id: marker.scene.id,
      primary_tag_id: primaryTagId,
      tag_ids: tagIds
    };

    await this.io.gql.mutate<SceneMarkerUpdateResponse>({
      mutation: mutations.SCENE_MARKER_UPDATE,
      variables: variables as unknown as Record<string, unknown>,
      signal,
    });
    
    if (this.io.isAborted(signal)) return;
  }

  /**
   * Add a tag to a scene marker
   * Requires full marker data to include all required fields in the mutation
   */
  private extractMarkerTagIds(marker: MarkerTagUpdateData): string[] {
    return (marker.tags || []).map(t => t.id);
  }

  async addTagToMarker(
    marker: MarkerTagUpdateData,
    tagId: string,
    signal?: AbortSignal
  ): Promise<void> {
    if (this.io.isAborted(signal)) return;

    try {
      const currentTags = this.extractMarkerTagIds(marker);

      // Add the new tag if not already present
      if (!currentTags.includes(tagId)) {
        await this.updateMarkerTags(marker, [...currentTags, tagId], signal);
      }
    } catch (error) {
      if (isAbortError(error) || this.io.isAborted(signal)) {
        return;
      }
      this.io.logError('addTagToMarker', error);
      throw error;
    }
  }

  /**
   * Add or remove one tag on a scene in a single server-side mutation (no read-modify-write,
   * so concurrent toggles can't clobber each other's tag list). The response carries the
   * scene's resulting tags, which refresh the local cache.
   */
  private async bulkModifySceneTag(
    methodName: string,
    sceneId: string,
    tagId: string,
    mode: 'ADD' | 'REMOVE',
    signal?: AbortSignal
  ): Promise<void> {
    if (this.io.isAborted(signal)) return;
    try {
      const result = await this.io.gql.mutate<{ bulkSceneUpdate?: Array<{ id: string; tags?: Array<{ id: string }> }> }>({
        mutation: mutations.BULK_SCENE_UPDATE,
        variables: { input: { ids: [sceneId], tag_ids: { ids: [tagId], mode } } },
        signal,
      });
      const updated = result.data?.bulkSceneUpdate?.find((sc) => sc.id === sceneId);
      if (updated?.tags) {
        this._sceneTagIds.set(sceneId, new Set(updated.tags.map((t) => t.id)));
      } else {
        this._sceneTagIds.delete(sceneId);
      }
    } catch (error) {
      if (isAbortError(error) || this.io.isAborted(signal)) return;
      this.io.logError(methodName, error);
      throw error;
    }
  }

  /**
   * Add a tag to a scene
   */
  async addTagToScene(sceneId: string, tagId: string, signal?: AbortSignal): Promise<void> {
    await this.bulkModifySceneTag('addTagToScene', sceneId, tagId, 'ADD', signal);
  }

  /**
   * Remove a tag from a scene marker
   * Requires full marker data to include all required fields in the mutation
   */
  async removeTagFromMarker(
    marker: MarkerTagUpdateData,
    tagId: string,
    signal?: AbortSignal
  ): Promise<void> {
    if (this.io.isAborted(signal)) return;

    try {
      const currentTags = this.extractMarkerTagIds(marker);
      const tagIds = currentTags.filter(id => id !== tagId);
      await this.updateMarkerTags(marker, tagIds, signal);
    } catch (error) {
      if (isAbortError(error) || this.io.isAborted(signal)) return;
      this.io.logError('removeTagFromMarker', error);
      throw error;
    }
  }

  /**
   * Remove a tag from a scene
   */
  async removeTagFromScene(sceneId: string, tagId: string, signal?: AbortSignal): Promise<void> {
    await this.bulkModifySceneTag('removeTagFromScene', sceneId, tagId, 'REMOVE', signal);
  }

  /**
   * Prime the tag→effective-source cache (session-cached). A tag's "effective" sources are the
   * union of its own counts AND all its descendants' counts, so a parent-only organizational tag
   * resolves to the sources its subtree actually lives in (the routing then matches by depth).
   * One query per uncached tag: the tag itself + every descendant (via parents/depth).
   */
  async getTagSources(ids: string[]): Promise<void> {
    const missing = [...new Set(ids)].filter((id) => id && !this.tagSources.has(id));
    if (missing.length === 0) return;
    type Counts = { scene_count?: number; scene_marker_count?: number; performer_count?: number; image_count?: number };
    // One request for every uncached tag. Descendants are asked as four count-only queries
    // (> 0 per source) instead of downloading the whole subtree with per_page:-1.
    const desc = (field: string) =>
      `findTags(tag_filter:{parents:{value:[$v],modifier:INCLUDES,depth:-1},${field}:{value:0,modifier:GREATER_THAN}},filter:{per_page:1}){count}`;
    try {
      const rows = await runAliased(this.io.aliasedExec, 'TagSources', 'ID!', missing, {
        self: 'findTags(ids:[$v]){tags{scene_count scene_marker_count performer_count image_count}}',
        dm: desc('marker_count'),
        ds: desc('scene_count'),
        dp: desc('performer_count'),
        di: desc('image_count'),
      });
      const count = (row: Record<string, unknown>, alias: string) => (row[alias] as { count?: number } | undefined)?.count ?? 0;
      missing.forEach((id, i) => {
        const row = rows[i];
        const own = (row.self as { tags?: Counts[] } | undefined)?.tags?.[0];
        this.tagSources.set(id, {
          marker: (own?.scene_marker_count ?? 0) > 0 || count(row, 'dm') > 0,
          scene: (own?.scene_count ?? 0) > 0 || count(row, 'ds') > 0,
          performer: (own?.performer_count ?? 0) > 0 || count(row, 'dp') > 0,
          image: (own?.image_count ?? 0) > 0 || count(row, 'di') > 0,
        });
      });
    } catch { /* leave uncached — routing falls back to the primary enabled source */ }
  }
}
