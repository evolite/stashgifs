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

  private readonly _configuration = new TtlCache<ConfigurationResponse['configuration']>(5_000, 1);

  private getConfiguration(): Promise<ConfigurationResponse['configuration']> {
    return this._configuration.getOrLoad('configuration', async () => {
      const result = await this.io.gql.query<ConfigurationResponse>({ query: queries.GET_CONFIGURATION });
      return result.data?.configuration ?? {};
    });
  }

  async getUIConfiguration(signal?: AbortSignal): Promise<{ type?: string; starPrecision?: string } | null> {
    if (this.io.isAborted(signal)) return null;

    try {
      const { ui } = await this.getConfiguration();
      if (this.io.isAborted(signal)) return null;

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

  private readonly _savedFilters = new TtlCache<GetSavedFilterResponse['findSavedFilter']>(60_000, 50);

  async getSavedFilter(id: string, signal?: AbortSignal): Promise<GetSavedFilterResponse['findSavedFilter']> {
    if (this.io.isAborted(signal)) return null;

    try {
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
