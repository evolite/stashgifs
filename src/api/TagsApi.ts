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
  readonly tagSources = new Map<string, TagSource>();

  constructor(private readonly io: ApiIO) {}

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

  private readonly _tagByName = new TtlCache<{ id: string; name: string } | null>(Number.POSITIVE_INFINITY, 200);

  async findTagByName(tagName: string, signal?: AbortSignal): Promise<{ id: string; name: string } | null> {
    if (this.io.isAborted(signal)) return null;
    try {
      const tag = await this._tagByName.getOrLoad(tagName.toLowerCase(), () => this.queryTagByName(tagName), (t) => t !== null);
      return this.io.isAborted(signal) ? null : tag;
    } catch (error: unknown) {
      return this.io.rethrowUnlessAbort('findTagByName', error, signal, null);
    }
  }

  private async queryTagByName(tagName: string): Promise<{ id: string; name: string } | null> {
    const result = await this.io.gql.query<FindTagsResponse>({
      query: queries.FIND_TAGS,
      variables: {
        filter: { per_page: 1, page: 1 },
        tag_filter: { name: { value: tagName, modifier: 'EQUALS' } },
      },
    });
    const tag = result.data?.findTags?.tags?.[0];
    if (!tag) return null;
    if (tag.name.toLowerCase() !== tagName.toLowerCase()) {
      this.io.logError('findTagByName', new Error(`Tag name mismatch: searched="${tagName}", found="${tag.name}"`));
      return null;
    }
    return tag;
  }

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
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('already exists') || errorMessage.includes('duplicate')) {
        this.io.logError('createTag', new Error(`Tag "${tagName}" already exists, attempting to find it`));
        const existingTag = await this.findTagByName(tagName, signal);
        if (existingTag) {
          return existingTag;
        }
      }
      this.io.logError('createTag', error);
      return null;
    }
  }

  private readonly _ensuredTags = new TtlCache<{ id: string; name: string } | null>(Number.POSITIVE_INFINITY, 20);

  ensureTag(tagName: string): Promise<{ id: string; name: string } | null> {
    return this._ensuredTags.getOrLoad(
      tagName.toLowerCase(),
      async () => (await this.findTagByName(tagName)) ?? (await this.createTag(tagName)),
      (tag) => tag !== null,
    );
  }

  markerHasTag(marker: { id: string; tags?: Array<{ id: string }> }, tagId: string): boolean {
    return marker.tags?.some(tag => tag.id === tagId) ?? false;
  }

  async sceneHasTag(sceneId: string, tagId: string, tags?: Array<{ id: string }>, signal?: AbortSignal): Promise<boolean> {
    if (this.io.isAborted(signal)) return false;
    
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

  private readonly _sceneTagIds = new TtlCache<Set<string>>(60_000, 1000);

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

  private async updateMarkerTags(
    marker: MarkerTagUpdateData,
    newTagIds: string[],
    signal?: AbortSignal
  ): Promise<void> {
    if (this.io.isAborted(signal)) return;
    
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

  async addTagToScene(sceneId: string, tagId: string, signal?: AbortSignal): Promise<void> {
    await this.bulkModifySceneTag('addTagToScene', sceneId, tagId, 'ADD', signal);
  }

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

  async removeTagFromScene(sceneId: string, tagId: string, signal?: AbortSignal): Promise<void> {
    await this.bulkModifySceneTag('removeTagFromScene', sceneId, tagId, 'REMOVE', signal);
  }

  async getTagSources(ids: string[]): Promise<void> {
    const missing = [...new Set(ids)].filter((id) => id && !this.tagSources.has(id));
    if (missing.length === 0) return;
    type Counts = { scene_count?: number; scene_marker_count?: number; performer_count?: number; image_count?: number };
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
