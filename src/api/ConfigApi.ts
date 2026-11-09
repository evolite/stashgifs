/**
 * Server configuration and the things stored in it: UI/plugin settings and saved filters.
 */

import * as queries from '../graphql/queries.js';
import * as mutations from '../graphql/mutations.js';
import type {
  ConfigurationResponse,
  ConfigurePluginResponse,
  GetSavedFiltersResponse,
  GetSavedFilterResponse,
} from '../graphql/types.js';
import type { SavedFilterMode } from '../types.js';
import type { ApiIO } from './ApiIO.js';
import { TtlCache } from './TtlCache.js';

export class ConfigApi {
  constructor(private readonly io: ApiIO) {}

  /** ui + plugin configuration share one request; callers within a few seconds reuse it. */
  private readonly _configuration = new TtlCache<ConfigurationResponse['configuration']>(5_000, 1);

  private getConfiguration(): Promise<ConfigurationResponse['configuration']> {
    return this._configuration.getOrLoad('configuration', async () => {
      const result = await this.io.gql.query<ConfigurationResponse>({ query: queries.GET_CONFIGURATION });
      return result.data?.configuration ?? {};
    });
  }

  /**
   * Get the rating system options from the UI configuration
   */
  async getUIConfiguration(signal?: AbortSignal): Promise<{ type?: string; starPrecision?: string } | null> {
    if (this.io.isAborted(signal)) return null;

    try {
      const { ui } = await this.getConfiguration();
      if (this.io.isAborted(signal)) return null;

      // UI is returned as a JSON string in some Stash versions
      if (typeof ui === 'string') {
        try {
          return (JSON.parse(ui) as { ratingSystemOptions?: { type?: string; starPrecision?: string } }).ratingSystemOptions || null;
        } catch {
          return null;
        }
      }
      return ui?.ratingSystemOptions || null;
    } catch (error) {
      return this.io.handleError('getUIConfiguration', error, signal, null);
    }
  }

  /**
   * Get plugin-specific settings from Stash server. Resolves null when the server has none;
   * a failed request throws so callers don't mistake it for "no settings".
   */
  async getPluginSettings(pluginId: string, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
    if (this.io.isAborted(signal)) return null;

    try {
      const { plugins } = await this.getConfiguration();
      if (this.io.isAborted(signal)) return null;
      const pluginConfig = plugins && typeof plugins === 'object' ? plugins[pluginId] : undefined;
      return pluginConfig && typeof pluginConfig === 'object' ? pluginConfig : null;
    } catch (error) {
      return this.io.rethrowUnlessAbort('getPluginSettings', error, signal, null);
    }
  }

  /**
   * Save plugin-specific settings to Stash server
   */
  async savePluginSettings(pluginId: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<boolean> {
    if (this.io.isAborted(signal)) return false;

    try {
      await this.io.gql.mutate<ConfigurePluginResponse>({
        mutation: mutations.CONFIGURE_PLUGIN,
        variables: { plugin_id: pluginId, input },
        signal,
      });
      this._configuration.clear();
      return true;
    } catch (error) {
      this.io.handleError('savePluginSettings', error, signal, false);
      return false;
    }
  }

  /**
   * Fetch saved filters the feed can apply (scene markers and images) from Stash
   */
  async fetchSavedFilters(signal?: AbortSignal): Promise<Array<{ id: string; name: string; mode: SavedFilterMode }>> {
    if (this.io.isAborted(signal)) return [];
    
    try {
      const result = await this.io.gql.query<GetSavedFiltersResponse>({
        query: queries.GET_SAVED_FILTERS,
        signal,
      });
      
      if (this.io.isAborted(signal)) return [];
      return (result.data?.findSavedFilters || []).filter(
        (f): f is { id: string; name: string; mode: SavedFilterMode } => f.mode === 'SCENE_MARKERS' || f.mode === 'IMAGES'
      );
    } catch (error: unknown) {
      return this.io.rethrowUnlessAbort('fetchSavedFilters', error, signal, []);
    }
  }

  /** Saved-filter criteria by id: re-read for every page of a saved-filter feed otherwise. */
  private readonly _savedFilters = new TtlCache<GetSavedFilterResponse['findSavedFilter']>(60_000, 50);

  /**
   * Get a saved filter's criteria. Resolves null when it doesn't exist; a failed request throws
   * so the feed can't silently fall back to unfiltered results.
   */
  async getSavedFilter(id: string, signal?: AbortSignal): Promise<GetSavedFilterResponse['findSavedFilter']> {
    if (this.io.isAborted(signal)) return null;

    try {
      // Shared, signal-free load (see TtlCache): one caller aborting must not fail the others.
      const filter = await this._savedFilters.getOrLoad(id, async () => {
        const result = await this.io.gql.query<GetSavedFilterResponse>({ query: queries.GET_SAVED_FILTER, variables: { id } });
        return result.data?.findSavedFilter || null;
      }, (f) => f !== null);
      return this.io.isAborted(signal) ? null : filter;
    } catch (error: unknown) {
      return this.io.rethrowUnlessAbort('getSavedFilter', error, signal, null);
    }
  }
}
