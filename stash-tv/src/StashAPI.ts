/**
 * Stash API integration
 * This will interface with the Stash GraphQL API
 */

import { Scene, FilterOptions } from './types.js';

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
    
    console.log('StashAPI initialized', { 
      baseUrl: this.baseUrl, 
      hasPluginApi: !!this.pluginApi,
      hasGQLClient: !!this.pluginApi?.GQL?.client 
    });
  }

  /**
   * Fetch scenes from Stash
   */
  async fetchScenes(filters?: FilterOptions): Promise<Scene[]> {
    // Use a query that matches Stash's expected format
    // Based on the existing TvSceneData fragment structure
    const query = `query FindScenes($filter: FindFilterType, $scene_filter: SceneFilterType) {
  findScenes(filter: $filter, scene_filter: $scene_filter) {
    count
    scenes {
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
}`;

    try {
      // Try using PluginApi GraphQL client if available
      if (this.pluginApi?.GQL?.client) {
        // Build filter and scene_filter same as direct fetch
        const filter: any = {
          per_page: filters?.limit || 20,
          page: filters?.offset ? Math.floor(filters.offset / (filters.limit || 20)) + 1 : 1,
        };
        if (filters?.query) {
          filter.q = filters.query;
        }

        const sceneFilter: any = {};
        if (filters?.studios && filters.studios.length > 0) {
          sceneFilter.studios = { value: filters.studios, modifier: 'INCLUDES' };
        }
        if (filters?.performers && filters.performers.length > 0) {
          sceneFilter.performers = { value: filters.performers, modifier: 'INCLUDES' };
        }
        if (filters?.tags && filters.tags.length > 0) {
          sceneFilter.tags = { value: filters.tags, modifier: 'INCLUDES' };
        }
        if (filters?.rating100 !== undefined && filters.rating100 !== null) {
          sceneFilter.rating100 = { value: filters.rating100, modifier: 'GREATER_THAN' };
        } else if (filters?.rating !== undefined && filters.rating !== null) {
          const rating100 = filters.rating * 20;
          sceneFilter.rating100 = { value: rating100, modifier: 'GREATER_THAN' };
        }

        const result = await this.pluginApi.GQL.client.query({
          query: query as any,
          variables: {
            filter,
            scene_filter: Object.keys(sceneFilter).length > 0 ? sceneFilter : {},
          },
        });
        return result.data?.findScenes?.scenes || [];
      }

      // Fallback to direct fetch
      // Build filter object - only include non-empty values
      const filter: any = {
        per_page: filters?.limit || 20,
        page: filters?.offset ? Math.floor(filters.offset / (filters.limit || 20)) + 1 : 1,
      };
      if (filters?.query) {
        filter.q = filters.query;
      }

      // Build scene_filter object - only include non-empty values
      const sceneFilter: any = {};
      if (filters?.studios && filters.studios.length > 0) {
        sceneFilter.studios = { value: filters.studios, modifier: 'INCLUDES' };
      }
      if (filters?.performers && filters.performers.length > 0) {
        sceneFilter.performers = { value: filters.performers, modifier: 'INCLUDES' };
      }
      if (filters?.tags && filters.tags.length > 0) {
        sceneFilter.tags = { value: filters.tags, modifier: 'INCLUDES' };
      }
      // Handle rating - Stash uses rating100 (0-100 scale)
      if (filters?.rating100 !== undefined && filters.rating100 !== null) {
        sceneFilter.rating100 = { value: filters.rating100, modifier: 'GREATER_THAN' };
      } else if (filters?.rating !== undefined && filters.rating !== null) {
        // Convert 0-5 rating to 0-100 scale if needed
        const rating100 = filters.rating * 20;
        sceneFilter.rating100 = { value: rating100, modifier: 'GREATER_THAN' };
      }

      const variables: any = { 
        filter,
        scene_filter: Object.keys(sceneFilter).length > 0 ? sceneFilter : {}
      };

      console.log('StashAPI: Sending GraphQL request', { 
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
      
      return data.data?.findScenes?.scenes || [];
    } catch (error) {
      console.error('Error fetching scenes:', error);
      return [];
    }
  }

  /**
   * Get video URL for a scene
   */
  getVideoUrl(scene: Scene): string | undefined {
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

