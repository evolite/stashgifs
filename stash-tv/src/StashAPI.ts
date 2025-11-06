/**
 * Stash API integration
 * This will interface with the Stash GraphQL API
 */

import { Scene, FilterOptions } from './types';

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
    this.baseUrl = baseUrl || this.pluginApi?.baseURL || '';
    this.apiKey = apiKey || this.pluginApi?.apiKey;
  }

  /**
   * Fetch scenes from Stash
   */
  async fetchScenes(filters?: FilterOptions): Promise<Scene[]> {
    const query = `
      query FindScenes($filter: FindFilterType, $scene_filter: SceneFilterType) {
        findScenes(filter: $filter, scene_filter: $scene_filter) {
          count
          scenes {
            id
            title
            date
            details
            url
            rating
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
    `;

    try {
      // Try using PluginApi GraphQL client if available
      if (this.pluginApi?.GQL?.client) {
        const result = await this.pluginApi.GQL.client.query({
          query: query as any,
          variables: {
            filter: {
              q: filters?.query,
              per_page: filters?.limit || 20,
              page: filters?.offset ? Math.floor(filters.offset / (filters.limit || 20)) + 1 : 1,
            },
            scene_filter: {
              ...(filters?.studios && { studios: { value: filters.studios, modifier: 'INCLUDES' } }),
              ...(filters?.performers && { performers: { value: filters.performers, modifier: 'INCLUDES' } }),
              ...(filters?.tags && { tags: { value: filters.tags, modifier: 'INCLUDES' } }),
              ...(filters?.rating && { rating: { value: filters.rating, modifier: 'GREATER_THAN' } }),
            },
          },
        });
        return result.data?.findScenes?.scenes || [];
      }

      // Fallback to direct fetch
      const response = await fetch(`${this.baseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { 'ApiKey': this.apiKey }),
        },
        body: JSON.stringify({
          query,
          variables: {
            filter: {
              q: filters?.query,
              per_page: filters?.limit || 20,
              page: filters?.offset ? Math.floor(filters.offset / (filters.limit || 20)) + 1 : 1,
            },
            scene_filter: {
              ...(filters?.studios && { studios: { value: filters.studios, modifier: 'INCLUDES' } }),
              ...(filters?.performers && { performers: { value: filters.performers, modifier: 'INCLUDES' } }),
              ...(filters?.tags && { tags: { value: filters.tags, modifier: 'INCLUDES' } }),
              ...(filters?.rating && { rating: { value: filters.rating, modifier: 'GREATER_THAN' } }),
            },
          },
        }),
      });

      const data = await response.json();
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
      return `${this.baseUrl}${scene.paths.stream}`;
    }
    if (scene.files && scene.files.length > 0) {
      return `${this.baseUrl}${scene.files[0].path}`;
    }
    return undefined;
  }

  /**
   * Get thumbnail URL for a scene
   */
  getThumbnailUrl(scene: Scene): string | undefined {
    if (scene.paths?.screenshot) {
      return `${this.baseUrl}${scene.paths.screenshot}`;
    }
    if (scene.paths?.preview) {
      return `${this.baseUrl}${scene.paths.preview}`;
    }
    if (scene.paths?.webp) {
      return `${this.baseUrl}${scene.paths.webp}`;
    }
    return undefined;
  }

  /**
   * Get preview URL for a scene
   */
  getPreviewUrl(scene: Scene): string | undefined {
    if (scene.paths?.preview) {
      return `${this.baseUrl}${scene.paths.preview}`;
    }
    return this.getThumbnailUrl(scene);
  }
}

