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
        console.log('StashAPI initialized', {
            baseUrl: this.baseUrl,
            hasPluginApi: !!this.pluginApi,
            hasGQLClient: !!this.pluginApi?.GQL?.client
        });
    }
    /**
     * Fetch scene markers from Stash
     */
    async fetchSceneMarkers(filters) {
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
      }
    }
  }
}`;
        try {
            // Try using PluginApi GraphQL client if available
            if (this.pluginApi?.GQL?.client) {
                // Build filter and scene_marker_filter
                const filter = {
                    per_page: filters?.limit || 20,
                    page: filters?.offset ? Math.floor(filters.offset / (filters.limit || 20)) + 1 : 1,
                };
                if (filters?.query) {
                    filter.q = filters.query;
                }
                const sceneMarkerFilter = {};
                if (filters?.primary_tags && filters.primary_tags.length > 0) {
                    sceneMarkerFilter.tags = { value: filters.primary_tags, modifier: 'INCLUDES' };
                }
                if (filters?.tags && filters.tags.length > 0) {
                    sceneMarkerFilter.tags = { value: filters.tags, modifier: 'INCLUDES' };
                }
                // Scene marker filters can also filter by scene properties
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
            // Build filter object - only include non-empty values
            const filter = {
                per_page: filters?.limit || 20,
                page: filters?.offset ? Math.floor(filters.offset / (filters.limit || 20)) + 1 : 1,
            };
            if (filters?.query) {
                filter.q = filters.query;
            }
            // Build scene_marker_filter object - only include non-empty values
            const sceneMarkerFilter = {};
            if (filters?.primary_tags && filters.primary_tags.length > 0) {
                sceneMarkerFilter.tags = { value: filters.primary_tags, modifier: 'INCLUDES' };
            }
            if (filters?.tags && filters.tags.length > 0) {
                sceneMarkerFilter.tags = { value: filters.tags, modifier: 'INCLUDES' };
            }
            const variables = {
                filter,
                scene_marker_filter: Object.keys(sceneMarkerFilter).length > 0 ? sceneMarkerFilter : {}
            };
            console.log('StashAPI: Sending GraphQL request for scene markers', {
                baseUrl: this.baseUrl,
                variables,
                queryLength: query.length
            });
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
            return url;
        }
        // Fallback to scene stream
        return this.getVideoUrl(marker.scene);
    }
    /**
     * Get video URL for a scene
     */
    getVideoUrl(scene) {
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