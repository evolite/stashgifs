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
      mutate?: (options: { mutation: any; variables?: any }) => Promise<{ data: any }>;
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
   * Note: Stash's SceneMarkerFilterType only supports filtering by primary_tag, not by tags array.
   * For non-primary tags, we fetch markers and filter client-side.
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
        o_counter
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
        // Use random sorting for better randomization
        filter.sort = `random_${Math.floor(Math.random() * 1000000)}`;

        // Build scene_marker_filter - start with saved filter object_filter if available
        const sceneMarkerFilterRaw: any = savedFilterCriteria?.object_filter ? { ...savedFilterCriteria.object_filter } : {};
        const sceneMarkerFilter: any = this.normalizeMarkerFilter(sceneMarkerFilterRaw);
        
        // If a saved filter is active, ONLY use its criteria (don't combine with manual filters)
        // Otherwise, apply manual tag filters
        // NOTE: Stash's SceneMarkerFilterType only supports filtering by primary_tag, not tags array.
        // For non-primary tags, we'll filter client-side after fetching.
        const nonPrimaryTagIds: number[] = [];
        if (!filters?.savedFilterId) {
          if (filters?.primary_tags && filters.primary_tags.length > 0) {
            const tagIds = filters.primary_tags
              .map((v) => parseInt(String(v), 10))
              .filter((n) => !Number.isNaN(n));
            if (tagIds.length > 0) {
              // Primary tags can be filtered server-side
              sceneMarkerFilter.tags = { value: tagIds, modifier: 'INCLUDES' };
            }
          }
          if (filters?.tags && filters.tags.length > 0) {
            const tagIds = filters.tags
              .map((v) => parseInt(String(v), 10))
              .filter((n) => !Number.isNaN(n));
            if (tagIds.length > 0) {
              // Store non-primary tag IDs for client-side filtering
              nonPrimaryTagIds.push(...tagIds);
              console.log('[StashAPI] Will filter by non-primary marker tags client-side:', tagIds);
            } else {
              console.warn('Scene marker tags must be numeric IDs; ignoring provided values', filters.tags);
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
        const responseData = result.data?.findSceneMarkers;
        let markers = responseData?.scene_markers || [];
        console.log('[StashAPI] Query result:', {
          count: responseData?.count,
          markersReturned: markers.length,
          page: filter.page,
          limit: filter.per_page,
          filter: sceneMarkerFilter
        });
        if (responseData?.count > 0 && markers.length === 0) {
          console.warn('[StashAPI] Count > 0 but no markers returned - retrying with page 1');
          // If count > 0 but no markers, try page 1 instead
          if (filter.page !== 1) {
            filter.page = 1;
            const retryResult = await this.pluginApi.GQL.client.query({
              query: query as any,
              variables: {
                filter,
                scene_marker_filter: Object.keys(sceneMarkerFilter).length > 0 ? sceneMarkerFilter : {},
              },
            });
            const retryData = retryResult.data?.findSceneMarkers;
            markers = retryData?.scene_markers || [];
            console.log('[StashAPI] Retry returned', markers.length, 'markers');
          }
        }
        
        // Filter by non-primary tags client-side (Stash doesn't support this server-side)
        if (nonPrimaryTagIds.length > 0 && markers.length > 0) {
          const beforeCount = markers.length;
          markers = markers.filter((marker: SceneMarker) => {
            const markerTagIds = (marker.tags || []).map((t: { id: string }) => parseInt(t.id, 10));
            return nonPrimaryTagIds.some(tagId => markerTagIds.includes(tagId));
          });
          console.log('[StashAPI] Client-side filtered from', beforeCount, 'to', markers.length, 'markers by non-primary tags:', nonPrimaryTagIds);
        }
        
        return markers;
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
      // Use random sorting for better randomization
      filter.sort = `random_${Math.floor(Math.random() * 1000000)}`;

      // Build scene_marker_filter - start with saved filter object_filter if available
      const sceneMarkerFilterRaw: any = savedFilterCriteria?.object_filter ? { ...savedFilterCriteria.object_filter } : {};
      const sceneMarkerFilter: any = this.normalizeMarkerFilter(sceneMarkerFilterRaw);
      
      // If a saved filter is active, ONLY use its criteria (don't combine with manual filters)
      // Otherwise, apply manual tag filters
      // NOTE: Stash's SceneMarkerFilterType only supports filtering by primary_tag, not tags array.
      // For non-primary tags, we'll filter client-side after fetching.
      const nonPrimaryTagIds: number[] = [];
      if (!filters?.savedFilterId) {
        if (filters?.primary_tags && filters.primary_tags.length > 0) {
          const tagIds = filters.primary_tags
            .map((v) => parseInt(String(v), 10))
            .filter((n) => !Number.isNaN(n));
          if (tagIds.length > 0) {
            // Primary tags can be filtered server-side
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
            // Store non-primary tag IDs for client-side filtering
            nonPrimaryTagIds.push(...tagIds);
            console.log('[StashAPI] Will filter by non-primary marker tags client-side:', tagIds);
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
      
      const responseData = data.data?.findSceneMarkers;
      let markers = responseData?.scene_markers || [];
      console.log('[StashAPI] Fetch result:', {
        count: responseData?.count,
        markersReturned: markers.length,
        page: filter.page,
        limit: filter.per_page,
        filter: sceneMarkerFilter
      });
      if (responseData?.count > 0 && markers.length === 0) {
        console.warn('[StashAPI] Count > 0 but no markers returned - possible page calculation issue');
        // If count > 0 but no markers, try page 1 instead
        if (filter.page !== 1) {
          console.log('[StashAPI] Retrying with page 1');
          filter.page = 1;
          const retryResponse = await fetch(`${this.baseUrl}/graphql`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(this.apiKey && { 'ApiKey': this.apiKey }),
            },
            body: JSON.stringify({
              query: query.trim(),
              variables: {
                filter,
                scene_marker_filter: Object.keys(sceneMarkerFilter).length > 0 ? sceneMarkerFilter : {}
              },
            }),
          });
          if (retryResponse.ok) {
            const retryData = await retryResponse.json();
            if (!retryData.errors) {
              markers = retryData.data?.findSceneMarkers?.scene_markers || [];
              console.log('[StashAPI] Retry returned', markers.length, 'markers');
            }
          }
        }
      }
      
      // Filter by non-primary tags client-side (Stash doesn't support this server-side)
      if (nonPrimaryTagIds.length > 0 && markers.length > 0) {
        const beforeCount = markers.length;
        markers = markers.filter((marker: SceneMarker) => {
          const markerTagIds = (marker.tags || []).map((t: { id: string }) => parseInt(t.id, 10));
          return nonPrimaryTagIds.some(tagId => markerTagIds.includes(tagId));
        });
        console.log('[StashAPI] Client-side filtered from', beforeCount, 'to', markers.length, 'markers by non-primary tags:', nonPrimaryTagIds);
      }
      
      return markers;
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

  /**
   * Find a tag by name
   */
  async findTagByName(tagName: string): Promise<{ id: string; name: string } | null> {
    const query = `query FindTag($filter: FindFilterType, $tag_filter: TagFilterType) {
      findTags(filter: $filter, tag_filter: $tag_filter) {
        tags {
          id
          name
        }
      }
    }`;

    const variables = {
      filter: { per_page: 1, page: 1 },
      tag_filter: { name: { value: tagName, modifier: 'EQUALS' } }
    };

    try {
      if (this.pluginApi?.GQL?.client) {
        const result = await this.pluginApi.GQL.client.query({
          query: query as any,
          variables,
        });
        const tags = result.data?.findTags?.tags || [];
        return tags.length > 0 ? tags[0] : null;
      }

      const response = await fetch(`${this.baseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { 'ApiKey': this.apiKey }),
        },
        body: JSON.stringify({ query, variables }),
      });

      if (!response.ok) {
        throw new Error(`GraphQL request failed: ${response.status}`);
      }

      const data = await response.json();
      if (data.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
      }

      const tags = data.data?.findTags?.tags || [];
      return tags.length > 0 ? tags[0] : null;
    } catch (error) {
      console.error('StashAPI: Failed to find tag', error);
      return null;
    }
  }

  /**
   * Create a new tag
   */
  async createTag(tagName: string): Promise<{ id: string; name: string } | null> {
    const mutation = `mutation TagCreate($input: TagCreateInput!) {
      tagCreate(input: $input) {
        id
        name
      }
    }`;

    const variables = {
      input: { name: tagName }
    };

    try {
      if (this.pluginApi?.GQL?.client) {
        // Use mutate if available, otherwise fall back to query
        const client = this.pluginApi.GQL.client;
        let result;
        try {
          if (client.mutate) {
            result = await client.mutate({ mutation: mutation as any, variables });
          } else {
            // Some GraphQL clients accept mutations via query method
            result = await client.query({ query: mutation as any, variables });
          }
          console.log('StashAPI: Tag created successfully', result.data);
          return result.data?.tagCreate || null;
        } catch (err: any) {
          console.error('StashAPI: Mutation error details', {
            error: err,
            message: err?.message,
            graphQLErrors: err?.graphQLErrors,
            networkError: err?.networkError
          });
          throw err;
        }
      }

      const response = await fetch(`${this.baseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { 'ApiKey': this.apiKey }),
        },
        body: JSON.stringify({ query: mutation, variables }),
      });

      if (!response.ok) {
        throw new Error(`GraphQL request failed: ${response.status}`);
      }

      const data = await response.json();
      if (data.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
      }

      return data.data?.tagCreate || null;
    } catch (error) {
      console.error('StashAPI: Failed to create tag', error);
      return null;
    }
  }

  /**
   * Check if a scene marker has a specific tag
   * Uses the marker's existing tags array if available, otherwise queries
   */
  async markerHasTag(marker: { id: string; tags?: Array<{ id: string }> }, tagId: string): Promise<boolean> {
    // If we have tags in the marker data, use them directly
    if (marker.tags && marker.tags.length > 0) {
      return marker.tags.some(tag => tag.id === tagId);
    }

    // Otherwise, fall back to querying (though this shouldn't be necessary)
    // Since we always have marker data with tags, this is just a safety fallback
    return false;
  }

  /**
   * Check if a scene has a specific tag (kept for backwards compatibility)
   */
  async sceneHasTag(sceneId: string, tagId: string): Promise<boolean> {
    const query = `query FindScene($id: ID!) {
      findScene(id: $id) {
        id
        tags {
          id
        }
      }
    }`;

    const variables = { id: sceneId };

    try {
      if (this.pluginApi?.GQL?.client) {
        const result = await this.pluginApi.GQL.client.query({
          query: query as any,
          variables,
        });
        const tags = result.data?.findScene?.tags || [];
        return tags.some((tag: { id: string }) => tag.id === tagId);
      }

      const response = await fetch(`${this.baseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { 'ApiKey': this.apiKey }),
        },
        body: JSON.stringify({ query, variables }),
      });

      if (!response.ok) {
        throw new Error(`GraphQL request failed: ${response.status}`);
      }

      const data = await response.json();
      if (data.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
      }

      const tags = data.data?.findScene?.tags || [];
      return tags.some((tag: { id: string }) => tag.id === tagId);
    } catch (error) {
      console.error('StashAPI: Failed to check scene tag', error);
      return false;
    }
  }

  /**
   * Add a tag to a scene marker
   * Requires full marker data to include all required fields in the mutation
   */
  async addTagToMarker(
    marker: {
      id: string;
      title: string;
      seconds: number;
      end_seconds?: number | null;
      scene: { id: string };
      primary_tag?: { id: string } | null;
      tags?: Array<{ id: string }>;
    },
    tagId: string
  ): Promise<void> {
    const mutation = `mutation SceneMarkerUpdate($id: ID!, $title: String!, $seconds: Float!, $end_seconds: Float, $scene_id: ID!, $primary_tag_id: ID!, $tag_ids: [ID!]!) {
      sceneMarkerUpdate(
        input: {
          id: $id
          title: $title
          seconds: $seconds
          end_seconds: $end_seconds
          scene_id: $scene_id
          primary_tag_id: $primary_tag_id
          tag_ids: $tag_ids
        }
      ) {
        id
      }
    }`;

    try {
      // Get current tags from marker data
      const currentTags: string[] = (marker.tags || []).map(t => t.id);

      // Add the new tag if not already present
      if (!currentTags.includes(tagId)) {
        const tagIds = [...currentTags, tagId];

        // Ensure we have required fields
        if (!marker.primary_tag?.id) {
          throw new Error('Marker must have a primary_tag');
        }

        const variables = {
          id: marker.id,
          title: marker.title,
          seconds: marker.seconds,
          end_seconds: marker.end_seconds ?? null,
          scene_id: marker.scene.id,
          primary_tag_id: marker.primary_tag.id,
          tag_ids: tagIds
        };

        if (this.pluginApi?.GQL?.client) {
          // Use mutate if available, otherwise fall back to query
          const client = this.pluginApi.GQL.client;
          try {
            if (client.mutate) {
              const result = await client.mutate({ mutation: mutation as any, variables });
              console.log('StashAPI: Tag added to marker successfully', result.data);
            } else {
              const result = await client.query({ query: mutation as any, variables });
              console.log('StashAPI: Tag added to marker successfully (via query)', result.data);
            }
          } catch (err: any) {
            console.error('StashAPI: Failed to add tag to marker', {
              error: err,
              message: err?.message,
              graphQLErrors: err?.graphQLErrors,
              networkError: err?.networkError,
              markerId: marker.id,
              tagId
            });
            throw err;
          }
        } else {
          const response = await fetch(`${this.baseUrl}/graphql`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(this.apiKey && { 'ApiKey': this.apiKey }),
            },
            body: JSON.stringify({ query: mutation, variables }),
          });

          if (!response.ok) {
            throw new Error(`GraphQL request failed: ${response.status}`);
          }

          const data = await response.json();
          if (data.errors) {
            throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
          }
        }
      }
    } catch (error) {
      console.error('StashAPI: Failed to add tag to marker', error);
      throw error;
    }
  }

  /**
   * Add a tag to a scene (kept for backwards compatibility)
   */
  async addTagToScene(sceneId: string, tagId: string): Promise<void> {
    // First get current scene tags
    const query = `query FindScene($id: ID!) {
      findScene(id: $id) {
        id
        tags {
          id
        }
      }
    }`;

    const mutation = `mutation SceneUpdate($input: SceneUpdateInput!) {
      sceneUpdate(input: $input) {
        id
      }
    }`;

    try {
      // Get current tags
      let currentTags: string[] = [];
      if (this.pluginApi?.GQL?.client) {
        const result = await this.pluginApi.GQL.client.query({
          query: query as any,
          variables: { id: sceneId },
        });
        currentTags = (result.data?.findScene?.tags || []).map((t: { id: string }) => t.id);
      } else {
        const response = await fetch(`${this.baseUrl}/graphql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey && { 'ApiKey': this.apiKey }),
          },
          body: JSON.stringify({ query, variables: { id: sceneId } }),
        });

        if (!response.ok) {
          throw new Error(`GraphQL request failed: ${response.status}`);
        }

        const data = await response.json();
        if (data.errors) {
          throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
        }

        currentTags = (data.data?.findScene?.tags || []).map((t: { id: string }) => t.id);
      }

      // Add the new tag if not already present
      if (!currentTags.includes(tagId)) {
        const tagIds = [...currentTags, tagId];

        const variables = {
          input: {
            id: sceneId,
            tag_ids: tagIds
          }
        };

        if (this.pluginApi?.GQL?.client) {
          // Use mutate if available, otherwise fall back to query
          const client = this.pluginApi.GQL.client;
          try {
            if (client.mutate) {
              const result = await client.mutate({ mutation: mutation as any, variables });
              console.log('StashAPI: Tag added to scene successfully', result.data);
            } else {
              const result = await client.query({ query: mutation as any, variables });
              console.log('StashAPI: Tag added to scene successfully (via query)', result.data);
            }
          } catch (err: any) {
            console.error('StashAPI: Failed to add tag to scene', {
              error: err,
              message: err?.message,
              graphQLErrors: err?.graphQLErrors,
              networkError: err?.networkError,
              sceneId,
              tagId
            });
            throw err;
          }
        } else {
          const response = await fetch(`${this.baseUrl}/graphql`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(this.apiKey && { 'ApiKey': this.apiKey }),
            },
            body: JSON.stringify({ query: mutation, variables }),
          });

          if (!response.ok) {
            throw new Error(`GraphQL request failed: ${response.status}`);
          }

          const data = await response.json();
          if (data.errors) {
            throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
          }
        }
      }
    } catch (error) {
      console.error('StashAPI: Failed to add tag to scene', error);
      throw error;
    }
  }

  /**
   * Remove a tag from a scene marker
   * Requires full marker data to include all required fields in the mutation
   */
  async removeTagFromMarker(
    marker: {
      id: string;
      title: string;
      seconds: number;
      end_seconds?: number | null;
      scene: { id: string };
      primary_tag?: { id: string } | null;
      tags?: Array<{ id: string }>;
    },
    tagId: string
  ): Promise<void> {
    const mutation = `mutation SceneMarkerUpdate($id: ID!, $title: String!, $seconds: Float!, $end_seconds: Float, $scene_id: ID!, $primary_tag_id: ID!, $tag_ids: [ID!]!) {
      sceneMarkerUpdate(
        input: {
          id: $id
          title: $title
          seconds: $seconds
          end_seconds: $end_seconds
          scene_id: $scene_id
          primary_tag_id: $primary_tag_id
          tag_ids: $tag_ids
        }
      ) {
        id
      }
    }`;

    try {
      // Get current tags from marker data
      const currentTags: string[] = (marker.tags || []).map(t => t.id);

      // Remove the tag
      const tagIds = currentTags.filter(id => id !== tagId);

      // Ensure we have required fields
      if (!marker.primary_tag?.id) {
        throw new Error('Marker must have a primary_tag');
      }

      const variables = {
        id: marker.id,
        title: marker.title,
        seconds: marker.seconds,
        end_seconds: marker.end_seconds ?? null,
        scene_id: marker.scene.id,
        primary_tag_id: marker.primary_tag.id,
        tag_ids: tagIds
      };

      if (this.pluginApi?.GQL?.client) {
        // Use mutate if available, otherwise fall back to query
        const client = this.pluginApi.GQL.client;
        try {
          if (client.mutate) {
            const result = await client.mutate({ mutation: mutation as any, variables });
            console.log('StashAPI: Tag removed from marker successfully', result.data);
          } else {
            const result = await client.query({ query: mutation as any, variables });
            console.log('StashAPI: Tag removed from marker successfully (via query)', result.data);
          }
        } catch (err: any) {
          console.error('StashAPI: Failed to remove tag from marker', {
            error: err,
            message: err?.message,
            graphQLErrors: err?.graphQLErrors,
            networkError: err?.networkError,
            markerId: marker.id,
            tagId
          });
          throw err;
        }
      } else {
        const response = await fetch(`${this.baseUrl}/graphql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey && { 'ApiKey': this.apiKey }),
          },
          body: JSON.stringify({ query: mutation, variables }),
        });

        if (!response.ok) {
          throw new Error(`GraphQL request failed: ${response.status}`);
        }

        const data = await response.json();
        if (data.errors) {
          throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
        }
      }
    } catch (error) {
      console.error('StashAPI: Failed to remove tag from marker', error);
      throw error;
    }
  }

  /**
   * Remove a tag from a scene (kept for backwards compatibility)
   */
  async removeTagFromScene(sceneId: string, tagId: string): Promise<void> {
    // First get current scene tags
    const query = `query FindScene($id: ID!) {
      findScene(id: $id) {
        id
        tags {
          id
        }
      }
    }`;

    const mutation = `mutation SceneUpdate($input: SceneUpdateInput!) {
      sceneUpdate(input: $input) {
        id
      }
    }`;

    try {
      // Get current tags
      let currentTags: string[] = [];
      if (this.pluginApi?.GQL?.client) {
        const result = await this.pluginApi.GQL.client.query({
          query: query as any,
          variables: { id: sceneId },
        });
        currentTags = (result.data?.findScene?.tags || []).map((t: { id: string }) => t.id);
      } else {
        const response = await fetch(`${this.baseUrl}/graphql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey && { 'ApiKey': this.apiKey }),
          },
          body: JSON.stringify({ query, variables: { id: sceneId } }),
        });

        if (!response.ok) {
          throw new Error(`GraphQL request failed: ${response.status}`);
        }

        const data = await response.json();
        if (data.errors) {
          throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
        }

        currentTags = (data.data?.findScene?.tags || []).map((t: { id: string }) => t.id);
      }

      // Remove the tag
      const tagIds = currentTags.filter(id => id !== tagId);

      const variables = {
        input: {
          id: sceneId,
          tag_ids: tagIds
        }
      };

      if (this.pluginApi?.GQL?.client) {
        // Use mutate if available, otherwise fall back to query
        const client = this.pluginApi.GQL.client;
        try {
          if (client.mutate) {
            const result = await client.mutate({ mutation: mutation as any, variables });
            console.log('StashAPI: Tag removed from scene successfully', result.data);
          } else {
            const result = await client.query({ query: mutation as any, variables });
            console.log('StashAPI: Tag removed from scene successfully (via query)', result.data);
          }
        } catch (err: any) {
          console.error('StashAPI: Failed to remove tag from scene', {
            error: err,
            message: err?.message,
            graphQLErrors: err?.graphQLErrors,
            networkError: err?.networkError,
            sceneId,
            tagId
          });
          throw err;
        }
      } else {
        const response = await fetch(`${this.baseUrl}/graphql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey && { 'ApiKey': this.apiKey }),
          },
          body: JSON.stringify({ query: mutation, variables }),
        });

        if (!response.ok) {
          throw new Error(`GraphQL request failed: ${response.status}`);
        }

        const data = await response.json();
        if (data.errors) {
          throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
        }
      }
    } catch (error) {
      console.error('StashAPI: Failed to remove tag from scene', error);
      throw error;
    }
  }

  /**
   * Increment the o count for a scene
   * @param sceneId The scene ID
   * @param times Optional array of timestamps (if not provided, uses current time)
   * @returns The updated o count and history
   */
  async incrementOCount(sceneId: string, times?: string[]): Promise<{ count: number; history: string[] }> {
    const mutation = `mutation SceneAddO($id: ID!, $times: [Timestamp!]) {
      sceneAddO(id: $id, times: $times) {
        count
        history
      }
    }`;

    const variables = {
      id: sceneId,
      times: times || undefined
    };

    try {
      if (this.pluginApi?.GQL?.client) {
        const client = this.pluginApi.GQL.client;
        try {
          if (client.mutate) {
            const result = await client.mutate({ mutation: mutation as any, variables });
            console.log('StashAPI: O count incremented successfully', result.data);
            return result.data?.sceneAddO || { count: 0, history: [] };
          } else {
            const result = await client.query({ query: mutation as any, variables });
            console.log('StashAPI: O count incremented successfully (via query)', result.data);
            return result.data?.sceneAddO || { count: 0, history: [] };
          }
        } catch (err: any) {
          console.error('StashAPI: Failed to increment o count', {
            error: err,
            message: err?.message,
            graphQLErrors: err?.graphQLErrors,
            networkError: err?.networkError,
            sceneId
          });
          throw err;
        }
      } else {
        const response = await fetch(`${this.baseUrl}/graphql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey && { 'ApiKey': this.apiKey }),
          },
          body: JSON.stringify({ query: mutation, variables }),
        });

        if (!response.ok) {
          throw new Error(`GraphQL request failed: ${response.status}`);
        }

        const data = await response.json();
        if (data.errors) {
          throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
        }

        return data.data?.sceneAddO || { count: 0, history: [] };
      }
    } catch (error) {
      console.error('StashAPI: Failed to increment o count', error);
      throw error;
    }
  }
}

