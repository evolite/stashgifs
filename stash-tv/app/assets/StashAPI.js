/**
 * Stash API integration
 * This will interface with the Stash GraphQL API
 */
export class StashAPI {
    constructor(baseUrl, apiKey) {
        // Get from window if available (Stash plugin context)
        const windowAny = window;
        this.pluginApi = windowAny.PluginApi || windowAny.stash;
        // Try to get base URL from various sources
        if (baseUrl) {
            this.baseUrl = baseUrl;
        }
        else if (this.pluginApi?.baseURL) {
            this.baseUrl = this.pluginApi.baseURL;
        }
        else {
            // Fallback: use current origin (for plugin context)
            this.baseUrl = window.location.origin;
        }
        this.apiKey = apiKey || this.pluginApi?.apiKey;
    }
    /**
     * Normalize a scene_marker_filter coming from a saved filter
     * Ensures fields like tags/scene_tags have numeric ID arrays
     */
    normalizeMarkerFilter(input) {
        if (!input || typeof input !== 'object')
            return {};
        const out = { ...input };
        const normalizeIdArray = (val) => {
            if (!val)
                return undefined;
            const arr = Array.isArray(val) ? val : [val];
            const ids = arr
                .map((x) => (typeof x === 'object' && x !== null ? (x.id ?? x.value ?? x) : x))
                .map((x) => parseInt(String(x), 10))
                .filter((n) => !Number.isNaN(n));
            return ids.length ? ids : undefined;
        };
        // Handle tags shapes: either { value, modifier } OR an array of objects/ids
        if (out.tags) {
            if (Array.isArray(out.tags)) {
                const ids = normalizeIdArray(out.tags);
                if (ids)
                    out.tags = { value: ids, modifier: 'INCLUDES' };
                else
                    delete out.tags;
            }
            else if (typeof out.tags === 'object') {
                const ids = normalizeIdArray(out.tags.value);
                if (ids)
                    out.tags = { value: ids, modifier: out.tags.modifier ?? 'INCLUDES' };
                else
                    delete out.tags;
            }
        }
        // Handle scene_tags similarly
        if (out.scene_tags) {
            if (Array.isArray(out.scene_tags)) {
                const ids = normalizeIdArray(out.scene_tags);
                if (ids)
                    out.scene_tags = { value: ids, modifier: 'INCLUDES' };
                else
                    delete out.scene_tags;
            }
            else if (typeof out.scene_tags === 'object') {
                const ids = normalizeIdArray(out.scene_tags.value);
                if (ids)
                    out.scene_tags = { value: ids, modifier: out.scene_tags.modifier ?? 'INCLUDES' };
                else
                    delete out.scene_tags;
            }
        }
        return out;
    }
    /**
     * Search marker tags (by name) for autocomplete
     */
    async searchMarkerTags(term, limit = 10) {
        const query = `query FindTags($filter: FindFilterType) {
      findTags(filter: $filter) {
        tags { id name }
      }
    }`;
        const filter = { per_page: limit, page: 1 };
        // Only add query if term is provided and not empty
        if (term && term.trim() !== '') {
            filter.q = term.trim();
        }
        const variables = { filter };
        try {
            if (this.pluginApi?.GQL?.client) {
                const result = await this.pluginApi.GQL.client.query({ query: query, variables });
                return result.data?.findTags?.tags ?? [];
            }
            const response = await fetch(`${this.baseUrl}/graphql`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.apiKey && { 'ApiKey': this.apiKey }),
                },
                body: JSON.stringify({ query, variables }),
            });
            if (!response.ok)
                return [];
            const data = await response.json();
            return data.data?.findTags?.tags ?? [];
        }
        catch (e) {
            console.warn('searchMarkerTags failed', e);
            return [];
        }
    }
    /**
     * Fetch saved marker filters from Stash
     */
    async fetchSavedMarkerFilters() {
        const query = `query GetSavedMarkerFilters { findSavedFilters(mode: SCENE_MARKERS) { id name } }`;
        try {
            if (this.pluginApi?.GQL?.client) {
                const result = await this.pluginApi.GQL.client.query({ query: query });
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
        }
        catch (e) {
            console.error('Error fetching saved marker filters:', e);
            return [];
        }
    }
    /**
     * Get a saved filter's criteria
     */
    async getSavedFilter(id) {
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
                    query: query,
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
        }
        catch (e) {
            console.error('Error fetching saved filter:', e);
            return null;
        }
    }
    /**
     * Fetch scene markers from Stash
     */
    async fetchSceneMarkers(filters) {
        // If a saved filter is specified, fetch its criteria first
        let savedFilterCriteria = null;
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
                const countFilter = { per_page: 1, page: 1 };
                // Start with saved filter criteria if available
                if (savedFilterCriteria?.find_filter) {
                    Object.assign(countFilter, savedFilterCriteria.find_filter);
                }
                // Manual query only if no saved filter OR if explicitly provided
                if (filters?.query && filters.query.trim() !== '') {
                    countFilter.q = filters.query;
                }
                // Normalize saved filter object_filter before using in variables
                const countSceneFilterRaw = savedFilterCriteria?.object_filter || {};
                const countSceneFilter = this.normalizeMarkerFilter(countSceneFilterRaw);
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
                            }
                            else {
                                countSceneFilter.tags = { value: tagIds, modifier: 'INCLUDES' };
                            }
                        }
                    }
                }
                try {
                    if (this.pluginApi?.GQL?.client) {
                        const countResult = await this.pluginApi.GQL.client.query({
                            query: countQuery,
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
                    }
                    else {
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
                }
                catch (e) {
                    console.warn('Failed to get count for random page, using page 1', e);
                }
            }
            // Try using PluginApi GraphQL client if available
            if (this.pluginApi?.GQL?.client) {
                // Build filter - start with saved filter criteria if available, then allow manual overrides
                const filter = {
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
                const sceneMarkerFilterRaw = savedFilterCriteria?.object_filter ? { ...savedFilterCriteria.object_filter } : {};
                const sceneMarkerFilter = this.normalizeMarkerFilter(sceneMarkerFilterRaw);
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
                            }
                            else {
                                sceneMarkerFilter.tags = { value: tagIds, modifier: 'INCLUDES' };
                            }
                        }
                        else {
                            console.warn('Scene marker tags must be numeric IDs; ignoring provided values');
                        }
                    }
                }
                if (filters?.studios && filters.studios.length > 0) {
                    sceneMarkerFilter.scene_tags = { value: filters.studios, modifier: 'INCLUDES' };
                }
                const result = await this.pluginApi.GQL.client.query({
                    query: query,
                    variables: {
                        filter,
                        scene_marker_filter: Object.keys(sceneMarkerFilter).length > 0 ? sceneMarkerFilter : {},
                    },
                });
                return result.data?.findSceneMarkers?.scene_markers || [];
            }
            // Fallback to direct fetch
            // Build filter - start with saved filter criteria if available, then allow manual overrides
            const filter = {
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
            const sceneMarkerFilterRaw = savedFilterCriteria?.object_filter ? { ...savedFilterCriteria.object_filter } : {};
            const sceneMarkerFilter = this.normalizeMarkerFilter(sceneMarkerFilterRaw);
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
                    else {
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
                        }
                        else {
                            sceneMarkerFilter.tags = { value: tagIds, modifier: 'INCLUDES' };
                        }
                    }
                    else {
                        console.warn('Scene marker tags must be numeric IDs; ignoring provided values');
                    }
                }
            }
            const variables = {
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
        }
        catch (error) {
            console.error('Error fetching scene markers:', error);
            return [];
        }
    }
    /**
     * Get video URL for a scene marker
     */
    getMarkerVideoUrl(marker) {
        // Use marker stream URL if available
        if (marker.stream) {
            const url = marker.stream.startsWith('http')
                ? marker.stream
                : `${this.baseUrl}${marker.stream}`;
            return url && url !== this.baseUrl ? url : undefined;
        }
        // Fallback to scene stream
        return this.getVideoUrl(marker.scene);
    }
    /**
     * Get video URL for a scene
     */
    getVideoUrl(scene) {
        // Prefer sceneStreams if available (often provides mp4)
        if (scene.sceneStreams && scene.sceneStreams.length > 0) {
            const streamUrl = scene.sceneStreams[0].url;
            const url = streamUrl.startsWith('http') ? streamUrl : `${this.baseUrl}${streamUrl}`;
            return url && url !== this.baseUrl ? url : undefined;
        }
        // Use stream path if available, otherwise use file path
        if (scene.paths?.stream) {
            const url = scene.paths.stream.startsWith('http')
                ? scene.paths.stream
                : `${this.baseUrl}${scene.paths.stream}`;
            return url;
        }
        if (scene.files && scene.files.length > 0) {
            const filePath = scene.files[0].path;
            const url = filePath.startsWith('http')
                ? filePath
                : `${this.baseUrl}${filePath}`;
            return url;
        }
        return undefined;
    }
    /**
     * Get thumbnail URL for a scene marker (uses parent scene)
     */
    getMarkerThumbnailUrl(marker) {
        return this.getThumbnailUrl(marker.scene);
    }
    /**
     * Get thumbnail URL for a scene
     */
    getThumbnailUrl(scene) {
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
    getPreviewUrl(scene) {
        if (scene.paths?.preview) {
            const url = scene.paths.preview.startsWith('http')
                ? scene.paths.preview
                : `${this.baseUrl}${scene.paths.preview}`;
            return url;
        }
        return this.getThumbnailUrl(scene);
    }
}
//# sourceMappingURL=StashAPI.js.map