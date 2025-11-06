/**
 * Stash API integration
 * This will interface with the Stash GraphQL API
 */

import { Scene, SceneMarker, FilterOptions } from './types.js';

interface StashPluginApi {
  GQL: {
    useFindScenesQuery?: (variables: any) => { data?: any; loading: boolean };
    client?: {
      query: (options: { query: any; variables?: any }) => Promise<{ data: any }>;
    };
  };
  baseURL?: string;
  apiKey?: string;
}

export class StashAPI {
  private baseUrl: string;
  private apiKey?: string;
  private pluginApi?: StashPluginApi;

  constructor(baseUrl?: string, apiKey?: string) {
    // Get from window if available (Stash plugin context)
    const windowAny = window as any;
    this.pluginApi = windowAny.PluginApi || windowAny.stash;
    
    // Try to get base URL from various sources
    if (baseUrl) {
      this.baseUrl = baseUrl;
    } else if (this.pluginApi?.baseURL) {
      this.baseUrl = this.pluginApi.baseURL;
    } else {
      // Fallback: use current origin (for plugin context)
      this.baseUrl = window.location.origin;
    }
    
    this.apiKey = apiKey || this.pluginApi?.apiKey;
    
  }

  /**
   * Normalize a scene_marker_filter coming from a saved filter
   * Ensures fields like tags/scene_tags have numeric ID arrays
   */
  private normalizeMarkerFilter(input: any): any {
    if (!input || typeof input !== 'object') return {};
    const out = { ...input };

    const normalizeIdArray = (val: any): number[] | undefined => {
      if (!val) return undefined;
      const arr = Array.isArray(val) ? val : [val];
      const ids = arr
        .map((x) => (typeof x === 'object' && x !== null ? (x.id ?? x.value ?? x) : x))
        .map((x) => parseInt(String(x), 10))
        .filter((n) => !Number.isNaN(n));
      return ids.length ? ids : undefined;
    };

    // Handle tags shapes: either { value, modifier } OR an array of objects/ids
    if (out.tags) {
      // Case 1: array of ids/objects
      if (Array.isArray(out.tags)) {
        const ids = normalizeIdArray(out.tags);
        if (ids) out.tags = { value: ids, modifier: 'INCLUDES' };
        else delete out.tags;
      } else if (typeof out.tags === 'object') {
        // Case 2: { value: number[] | { items:[{id,label}], ... }, modifier? }
        let raw = out.tags.value;
        // Stash saved filter format: value: { items: [{id,label},...], excluded:[], depth:-1 }
        if (raw && typeof raw === 'object' && Array.isArray(raw.items)) {
          raw = raw.items;
        }
        const ids = normalizeIdArray(raw);
        if (ids) out.tags = { value: ids, modifier: out.tags.modifier ?? 'INCLUDES' };
        else delete out.tags;
      }
    }

    // Handle scene_tags similarly
    if (out.scene_tags) {
      if (Array.isArray(out.scene_tags)) {
        const ids = normalizeIdArray(out.scene_tags);
        if (ids) out.scene_tags = { value: ids, modifier: 'INCLUDES' };
        else delete out.scene_tags;
      } else if (typeof out.scene_tags === 'object') {
        let raw = out.scene_tags.value;
        if (raw && typeof raw === 'object' && Array.isArray(raw.items)) {
          raw = raw.items;
        }
        const ids = normalizeIdArray(raw);
        if (ids) out.scene_tags = { value: ids, modifier: out.scene_tags.modifier ?? 'INCLUDES' };
        else delete out.scene_tags;
      }
    }

    return out;
  }

  /**
   * Search marker tags (by name) for autocomplete
   */
  async searchMarkerTags(term: string, limit: number = 10): Promise<Array<{ id: string; name: string }>> {
    const query = `query FindTags($filter: FindFilterType) {
      findTags(filter: $filter) {
        tags { id name }
      }
    }`;
    const filter: any = { per_page: limit, page: 1 };
    // Only add query if term is provided and not empty
    if (term && term.trim() !== '') {
      filter.q = term.trim();
    }
    const variables = { filter };

    // Helper: check if a tag has at least one scene marker
    const hasMarkersForTag = async (tagId: number): Promise<boolean> => {
      const countQuery = `query GetMarkerCount($scene_marker_filter: SceneMarkerFilterType) {
        findSceneMarkers(scene_marker_filter: $scene_marker_filter) { count }
      }`;
      const sceneMarkerFilter: any = { tags: { value: [tagId], modifier: 'INCLUDES' } };
      const variables: any = { scene_marker_filter: sceneMarkerFilter };
      try {
        if (this.pluginApi?.GQL?.client) {
          const res = await this.pluginApi.GQL.client.query({ query: countQuery as any, variables });
          return (res.data?.findSceneMarkers?.count || 0) > 0;
        }
        const response = await fetch(`${this.baseUrl}/graphql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey && { 'ApiKey': this.apiKey }),
          },
          body: JSON.stringify({ query: countQuery, variables }),
        });
        if (!response.ok) return false;
        const data = await response.json();
        return (data.data?.findSceneMarkers?.count || 0) > 0;
      } catch {
        return false;
      }
    };

    // Simple concurrency limiter
    const filterByHasMarkers = async (tags: Array<{ id: string; name: string }>): Promise<Array<{ id: string; name: string }>> => {
      const concurrency = 5;
      const result: Array<{ id: string; name: string }> = [];
      let index = 0;
      const workers = Array.from({ length: Math.min(concurrency, tags.length) }, async () => {
        while (index < tags.length) {
          const i = index++;
          const t = tags[i];
          const ok = await hasMarkersForTag(parseInt(t.id, 10));
          if (ok) result.push(t);
        }
      });
      await Promise.all(workers);
      return result;
    };

    try {
      if (this.pluginApi?.GQL?.client) {
        const result = await this.pluginApi.GQL.client.query({ query: query as any, variables });
        const tags = result.data?.findTags?.tags ?? [];
        const filtered = await filterByHasMarkers(tags.slice(0, limit * 2));
        return filtered.slice(0, limit);
      }
      const response = await fetch(`${this.baseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { 'ApiKey': this.apiKey }),
        },
        body: JSON.stringify({ query, variables }),
      });
      if (!response.ok) return [];
      const data = await response.json();
      const tags = data.data?.findTags?.tags ?? [];
      const filtered = await filterByHasMarkers(tags.slice(0, limit * 2));
      return filtered.slice(0, limit);
    } catch (e) {
      console.warn('searchMarkerTags failed', e);
      return [];
    }
  }

  /**
   * Fetch saved marker filters from Stash
   */
  async fetchSavedMarkerFilters(): Promise<Array<{ id: string; name: string }>> {
    const query = `query GetSavedMarkerFilters { findSavedFilters(mode: SCENE_MARKERS) { id name } }`;
    try {
      if (this.pluginApi?.GQL?.client) {
        const result = await this.pluginApi.GQL.client.query({ query: query as any });
        return result.data?.findSavedFilters || [];
      }
      const response = await fetch(`${this.baseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { 'ApiKey': this.apiKey }),
        },
        body: JSON.stringify({ query }),
      });
      const data = await response.json();
      return data.data?.findSavedFilters || [];
    } catch (e) {
      console.error('Error fetching saved marker filters:', e);
      return [];
    }
  }

  /**
   * Get a saved filter's criteria
   */
  async getSavedFilter(id: string): Promise<any> {
    const query = `query GetSavedFilter($id: ID!) {
      findSavedFilter(id: $id) {
        id
        name
        mode
        find_filter {
          q
          per_page
          page
        }
        object_filter
      }
    }`;
    try {
      if (this.pluginApi?.GQL?.client) {
        const result = await this.pluginApi.GQL.client.query({ 
          query: query as any,
          variables: { id }
        });
        return result.data?.findSavedFilter;
      }
      const response = await fetch(`${this.baseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { 'ApiKey': this.apiKey }),
        },
        body: JSON.stringify({ query, variables: { id } }),
      });
      const data = await response.json();
      return data.data?.findSavedFilter;
    } catch (e) {
      console.error('Error fetching saved filter:', e);
      return null;
    }
  }

  /**
   * Fetch scene markers from Stash
   */
  async fetchSceneMarkers(filters?: FilterOptions): Promise<SceneMarker[]> {
    // If a saved filter is specified, fetch its criteria first
    let savedFilterCriteria: any = null;
    if (filters?.savedFilterId) {
      console.log('[StashAPI] Fetching saved filter:', filters.savedFilterId);
      savedFilterCriteria = await this.getSavedFilter(filters.savedFilterId);
      console.log('[StashAPI] Saved filter criteria:', savedFilterCriteria);
    }

    // Query for scene markers based on FindSceneMarkersForTv
    const query = `query FindSceneMarkers($filter: FindFilterType, $scene_marker_filter: SceneMarkerFilterType) {
  findSceneMarkers(filter: $filter, scene_marker_filter: $scene_marker_filter) {
    count
    scene_markers {
      id
      title
      seconds
      end_seconds
      stream
      primary_tag {
        id
        name
      }
      tags {
        id
        name
      }
      scene {
        id
        title
        date
        details
        url
        rating100
        studio {
          id
          name
        }
        performers {
          id
          name
          image_path
        }
        tags {
          id
          name
        }
        files {
          id
          path
          size
          duration
          video_codec
          audio_codec
          width
          height
          bit_rate
        }
        paths {
          screenshot
          preview
          stream
          webp
          vtt
        }
        sceneStreams {
          url
          mime_type
          label
        }
      }
    }
  }
}`;

    try {
      // Calculate random page if no offset specified
      let page = filters?.offset ? Math.floor(filters.offset / (filters.limit || 20)) + 1 : 1;
      const limit = filters?.limit || 20;
      
      // If we want random and no offset, get count first to calculate random page
      if (!filters?.offset) {
        const countQuery = `query GetMarkerCount($filter: FindFilterType, $scene_marker_filter: SceneMarkerFilterType) {
          findSceneMarkers(filter: $filter, scene_marker_filter: $scene_marker_filter) {
            count
          }
        }`;
        
        const countFilter: any = { per_page: 1, page: 1 };
        // Start with saved filter criteria if available
        if (savedFilterCriteria?.find_filter) {
          Object.assign(countFilter, savedFilterCriteria.find_filter);
        }
        // Manual query only if no saved filter OR if explicitly provided
        if (filters?.query && filters.query.trim() !== '') {
          countFilter.q = filters.query;
        }
        
        // Normalize saved filter object_filter before using in variables
        const countSceneFilterRaw: any = savedFilterCriteria?.object_filter || {};
        const countSceneFilter: any = this.normalizeMarkerFilter(countSceneFilterRaw);
        
        // If a saved filter is active, ONLY use its criteria (don't combine with manual filters)
        // Otherwise, apply manual tag filters
        if (!filters?.savedFilterId) {
          if (filters?.primary_tags && filters.primary_tags.length > 0) {
            const tagIds = filters.primary_tags
              .map((v) => parseInt(String(v), 10))
              .filter((n) => !Number.isNaN(n));
            if (tagIds.length > 0) {
              countSceneFilter.tags = { value: tagIds, modifier: 'INCLUDES' };
            }
          }
          if (filters?.tags && filters.tags.length > 0) {
            const tagIds = filters.tags
              .map((v) => parseInt(String(v), 10))
              .filter((n) => !Number.isNaN(n));
            if (tagIds.length > 0) {
              // If we already have tags from primary_tags, combine them
              if (countSceneFilter.tags?.value) {
                const existingIds = Array.isArray(countSceneFilter.tags.value) ? countSceneFilter.tags.value : [countSceneFilter.tags.value];
                countSceneFilter.tags = { 
                  value: [...new Set([...existingIds, ...tagIds])], 
                  modifier: countSceneFilter.tags.modifier || 'INCLUDES' 
                };
              } else {
                countSceneFilter.tags = { value: tagIds, modifier: 'INCLUDES' };
              }
            }
          }
        }
        
        try {
          if (this.pluginApi?.GQL?.client) {
            const countResult = await this.pluginApi.GQL.client.query({
              query: countQuery as any,
              variables: {
                filter: countFilter,
                scene_marker_filter: Object.keys(countSceneFilter).length > 0 ? countSceneFilter : {},
              },
            });
            const totalCount = countResult.data?.findSceneMarkers?.count || 0;
            if (totalCount > 0) {
              const totalPages = Math.ceil(totalCount / limit);
              page = Math.floor(Math.random() * totalPages) + 1;
            }
          } else {
            const countResponse = await fetch(`${this.baseUrl}/graphql`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(this.apiKey && { 'ApiKey': this.apiKey }),
              },
              body: JSON.stringify({
                query: countQuery,
                variables: {
                  filter: countFilter,
                  scene_marker_filter: Object.keys(countSceneFilter).length > 0 ? countSceneFilter : {},
                },
              }),
            });
            const countData = await countResponse.json();
            const totalCount = countData.data?.findSceneMarkers?.count || 0;
            if (totalCount > 0) {
              const totalPages = Math.ceil(totalCount / limit);
              page = Math.floor(Math.random() * totalPages) + 1;
            }
          }
        } catch (e) {
          console.warn('Failed to get count for random page, using page 1', e);
        }
      }

      // Try using PluginApi GraphQL client if available
      if (this.pluginApi?.GQL?.client) {
        // Build filter - start with saved filter criteria if available, then allow manual overrides
        const filter: any = {
          per_page: limit,
          page: page,
        };
        // If saved filter exists, start with its find_filter criteria
        if (savedFilterCriteria?.find_filter) {
          Object.assign(filter, savedFilterCriteria.find_filter);
        }
        // Manual query overrides saved filter query (if user typed something)
        if (filters?.query && filters.query.trim() !== '') {
          filter.q = filters.query;
        }
        // Override page with our calculated random page
        filter.page = page;
        filter.per_page = limit;

        // Build scene_marker_filter - start with saved filter object_filter if available
        const sceneMarkerFilterRaw: any = savedFilterCriteria?.object_filter ? { ...savedFilterCriteria.object_filter } : {};
        const sceneMarkerFilter: any = this.normalizeMarkerFilter(sceneMarkerFilterRaw);
        
        // If a saved filter is active, ONLY use its criteria (don't combine with manual filters)
        // Otherwise, apply manual tag filters
        if (!filters?.savedFilterId) {
          if (filters?.primary_tags && filters.primary_tags.length > 0) {
            const tagIds = filters.primary_tags
              .map((v) => parseInt(String(v), 10))
              .filter((n) => !Number.isNaN(n));
            if (tagIds.length > 0) {
              sceneMarkerFilter.tags = { value: tagIds, modifier: 'INCLUDES' };
            }
          }
          if (filters?.tags && filters.tags.length > 0) {
            const tagIds = filters.tags
              .map((v) => parseInt(String(v), 10))
              .filter((n) => !Number.isNaN(n));
            if (tagIds.length > 0) {
              // If we already have tags from primary_tags, combine them
              if (sceneMarkerFilter.tags?.value) {
                const existingIds = Array.isArray(sceneMarkerFilter.tags.value) ? sceneMarkerFilter.tags.value : [sceneMarkerFilter.tags.value];
                sceneMarkerFilter.tags = { 
                  value: [...new Set([...existingIds, ...tagIds])], 
                  modifier: sceneMarkerFilter.tags.modifier || 'INCLUDES' 
                };
              } else {
                sceneMarkerFilter.tags = { value: tagIds, modifier: 'INCLUDES' };
              }
            } else {
              console.warn('Scene marker tags must be numeric IDs; ignoring provided values');
            }
          }
        }
        if (filters?.studios && filters.studios.length > 0) {
          sceneMarkerFilter.scene_tags = { value: filters.studios, modifier: 'INCLUDES' };
        }

        const result = await this.pluginApi.GQL.client.query({
          query: query as any,
          variables: {
            filter,
            scene_marker_filter: Object.keys(sceneMarkerFilter).length > 0 ? sceneMarkerFilter : {},
          },
        });
        return result.data?.findSceneMarkers?.scene_markers || [];
      }

      // Fallback to direct fetch
      // Build filter - start with saved filter criteria if available, then allow manual overrides
      const filter: any = {
        per_page: limit,
        page: page,
      };
      // If saved filter exists, start with its find_filter criteria
      if (savedFilterCriteria?.find_filter) {
        Object.assign(filter, savedFilterCriteria.find_filter);
      }
      // Manual query overrides saved filter query (if user typed something)
      if (filters?.query && filters.query.trim() !== '') {
        filter.q = filters.query;
      }
      // Override page with our calculated random page
      filter.page = page;
      filter.per_page = limit;

      // Build scene_marker_filter - start with saved filter object_filter if available
      const sceneMarkerFilterRaw: any = savedFilterCriteria?.object_filter ? { ...savedFilterCriteria.object_filter } : {};
      const sceneMarkerFilter: any = this.normalizeMarkerFilter(sceneMarkerFilterRaw);
      
      // If a saved filter is active, ONLY use its criteria (don't combine with manual filters)
      // Otherwise, apply manual tag filters
      if (!filters?.savedFilterId) {
        if (filters?.primary_tags && filters.primary_tags.length > 0) {
          const tagIds = filters.primary_tags
            .map((v) => parseInt(String(v), 10))
            .filter((n) => !Number.isNaN(n));
          if (tagIds.length > 0) {
            sceneMarkerFilter.tags = { value: tagIds, modifier: 'INCLUDES' };
          } else {
            console.warn('Scene marker primary_tags must be numeric IDs; ignoring provided values');
          }
        }
        if (filters?.tags && filters.tags.length > 0) {
          const tagIds = filters.tags
            .map((v) => parseInt(String(v), 10))
            .filter((n) => !Number.isNaN(n));
          if (tagIds.length > 0) {
            // If we already have tags from primary_tags, combine them
            if (sceneMarkerFilter.tags?.value) {
              const existingIds = Array.isArray(sceneMarkerFilter.tags.value) ? sceneMarkerFilter.tags.value : [sceneMarkerFilter.tags.value];
              sceneMarkerFilter.tags = { 
                value: [...new Set([...existingIds, ...tagIds])], 
                modifier: sceneMarkerFilter.tags.modifier || 'INCLUDES' 
              };
            } else {
              sceneMarkerFilter.tags = { value: tagIds, modifier: 'INCLUDES' };
            }
          } else {
            console.warn('Scene marker tags must be numeric IDs; ignoring provided values');
          }
        }
      }

      const variables: any = { 
        filter,
        scene_marker_filter: Object.keys(sceneMarkerFilter).length > 0 ? sceneMarkerFilter : {}
      };


      const response = await fetch(`${this.baseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { 'ApiKey': this.apiKey }),
        },
        body: JSON.stringify({
          query: query.trim(),
          variables,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('GraphQL request failed', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.errors) {
        console.error('GraphQL errors:', data.errors);
        throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
      }
      
      return data.data?.findSceneMarkers?.scene_markers || [];
    } catch (error) {
      console.error('Error fetching scene markers:', error);
      return [];
    }
  }

  /**
   * Get video URL for a scene marker
   */
  getMarkerVideoUrl(marker: SceneMarker): string | undefined {
    // Use marker stream URL if available
    if (marker.stream) {
      const url = marker.stream.startsWith('http') 
        ? marker.stream 
        : `${this.baseUrl}${marker.stream}`;
      // Sanity check against app root or empty
      try {
        const absolute = url.startsWith('http') ? url : `${window.location.origin}${url}`;
        const appRoot = `${window.location.origin}/plugin/stashgifs/assets/app/`;
        if (!absolute || absolute === this.baseUrl || absolute === window.location.origin || absolute === appRoot) return undefined;
      } catch {}
      return url;
    }
    // Fallback to scene stream
    return this.getVideoUrl(marker.scene);
  }

  /**
   * Get video URL for a scene
   */
  getVideoUrl(scene: Scene): string | undefined {
    // Prefer sceneStreams if available (often provides mp4)
    if (scene.sceneStreams && scene.sceneStreams.length > 0) {
      const streamUrl = scene.sceneStreams[0].url;
      const url = streamUrl.startsWith('http') ? streamUrl : `${this.baseUrl}${streamUrl}`;
      try {
        const absolute = url.startsWith('http') ? url : `${window.location.origin}${url}`;
        const appRoot = `${window.location.origin}/plugin/stashgifs/assets/app/`;
        if (!absolute || absolute === this.baseUrl || absolute === window.location.origin || absolute === appRoot) return undefined;
      } catch {}
      return url;
    }
    // Use stream path if available, otherwise use file path
    if (scene.paths?.stream) {
      const url = scene.paths.stream.startsWith('http') 
        ? scene.paths.stream 
        : `${this.baseUrl}${scene.paths.stream}`;
      try {
        const absolute = url.startsWith('http') ? url : `${window.location.origin}${url}`;
        const appRoot = `${window.location.origin}/plugin/stashgifs/assets/app/`;
        if (!absolute || absolute === this.baseUrl || absolute === window.location.origin || absolute === appRoot) return undefined;
      } catch {}
      return url;
    }
    if (scene.files && scene.files.length > 0) {
      const filePath = scene.files[0].path;
      const url = filePath.startsWith('http')
        ? filePath
        : `${this.baseUrl}${filePath}`;
      try {
        const absolute = url.startsWith('http') ? url : `${window.location.origin}${url}`;
        const appRoot = `${window.location.origin}/plugin/stashgifs/assets/app/`;
        if (!absolute || absolute === this.baseUrl || absolute === window.location.origin || absolute === appRoot) return undefined;
      } catch {}
      return url;
    }
    return undefined;
  }

  /**
   * Get thumbnail URL for a scene marker (uses parent scene)
   */
  getMarkerThumbnailUrl(marker: SceneMarker): string | undefined {
    return this.getThumbnailUrl(marker.scene);
  }

  /**
   * Get thumbnail URL for a scene
   */
  getThumbnailUrl(scene: Scene): string | undefined {
    if (scene.paths?.screenshot) {
      const url = scene.paths.screenshot.startsWith('http')
        ? scene.paths.screenshot
        : `${this.baseUrl}${scene.paths.screenshot}`;
      return url;
    }
    if (scene.paths?.preview) {
      const url = scene.paths.preview.startsWith('http')
        ? scene.paths.preview
        : `${this.baseUrl}${scene.paths.preview}`;
      return url;
    }
    if (scene.paths?.webp) {
      const url = scene.paths.webp.startsWith('http')
        ? scene.paths.webp
        : `${this.baseUrl}${scene.paths.webp}`;
      return url;
    }
    return undefined;
  }

  /**
   * Get preview URL for a scene
   */
  getPreviewUrl(scene: Scene): string | undefined {
    if (scene.paths?.preview) {
      const url = scene.paths.preview.startsWith('http')
        ? scene.paths.preview
        : `${this.baseUrl}${scene.paths.preview}`;
      return url;
    }
    return this.getThumbnailUrl(scene);
  }
}

