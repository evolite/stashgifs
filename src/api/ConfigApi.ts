/**
 * Server configuration and the things stored in it: UI/plugin settings, stash-box endpoints,
 * saved filters, and resolving stash-box scenes to local ones.
 */

import * as queries from '../graphql/queries.js';
import * as mutations from '../graphql/mutations.js';
import type {
  ConfigurationResponse,
  ConfigurePluginResponse,
  StashBox,
  GetStashBoxConfigResponse,
  GetSavedFiltersResponse,
  GetSavedFilterResponse,
} from '../graphql/types.js';
import type { SavedFilterMode } from '../types.js';
import type { ApiIO } from './ApiIO.js';
import { TtlCache } from './TtlCache.js';
import { runAliased } from './aliased.js';

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

  async getStashBoxes(signal?: AbortSignal): Promise<StashBox[]> {
    if (this.io.isAborted(signal)) return [];

    try {
      const result = await this.io.gql.query<GetStashBoxConfigResponse>({
        query: queries.GET_STASH_BOX_CONFIG,
        signal,
      });

      if (this.io.isAborted(signal)) return [];

      return result.data?.configuration?.general?.stashBoxes ?? [];
    } catch (error: unknown) {
      return this.io.rethrowUnlessAbort('getStashBoxes', error, signal, []);
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

  /** stash-box scene id -> local scene id (null = not in library). Misses are cached too: they're the common case. */
  private readonly _localSceneIds = new TtlCache<string | null>(5 * 60_000, 1000);

  /**
   * Resolve many stash-box scenes to local scene ids in at most two requests (stash_id lookups,
   * then URL lookups for the misses), instead of one or two requests per scene.
   */
  async findLocalSceneIdsByStashDbIds(
    items: Array<{ stashId: string; sceneUrl?: string }>,
    signal?: AbortSignal
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (this.io.isAborted(signal)) return out;

    const todo = new Map<string, string | undefined>();
    for (const { stashId, sceneUrl } of items) {
      if (!this._localSceneIds.has(stashId)) todo.set(stashId, sceneUrl);
    }

    if (todo.size > 0) {
      // One shared lookup for everything missing; each id's cache entry resolves from it.
      // No caller signal: the entries are shared with other callers.
      const lookup = this.lookupLocalSceneIds(todo);
      for (const stashId of todo.keys()) {
        this._localSceneIds.set(stashId, lookup.then((found) => found.get(stashId) ?? null));
      }
    }

    try {
      await Promise.all(items.map(async ({ stashId }) => {
        const localId = await this._localSceneIds.peek(stashId);
        if (localId) out.set(stashId, localId);
      }));
    } catch (error: unknown) {
      this.io.handleError('findLocalSceneIdsByStashDbIds', error, signal, null);
    }
    return out;
  }

  private async lookupLocalSceneIds(todo: Map<string, string | undefined>): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    const stashIds = [...todo.keys()];
    // Stash matches stash_id regardless of endpoint; URL lookup covers scenes added without a stash_id link.
    const byStashId = await this.lookupSceneIds(
      stashIds.map((stashId) => ({ stash_id_endpoint: { stash_id: stashId, modifier: 'EQUALS' } }))
    );
    const misses: string[] = [];
    stashIds.forEach((stashId, i) => {
      const localId = byStashId[i];
      if (localId) found.set(stashId, localId);
      else if (todo.get(stashId)) misses.push(stashId);
    });
    if (misses.length > 0) {
      const byUrl = await this.lookupSceneIds(
        misses.map((stashId) => ({ url: { modifier: 'EQUALS', value: todo.get(stashId) } }))
      );
      misses.forEach((stashId, i) => {
        const localId = byUrl[i];
        if (localId) found.set(stashId, localId);
      });
    }
    return found;
  }

  /** First matching scene id (or null) per scene filter, in order, in one request. */
  private async lookupSceneIds(filters: Array<Record<string, unknown>>): Promise<Array<string | null>> {
    const rows = await runAliased(this.io.aliasedExec, 'FindLocalScenes', 'SceneFilterType', filters, {
      s: 'findScenes(scene_filter: $v, filter: { per_page: 1 }) { scenes { id } }',
    });
    return rows.map((row) => (row.s as { scenes: Array<{ id: string }> } | undefined)?.scenes[0]?.id ?? null);
  }
}
