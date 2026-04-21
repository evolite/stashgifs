/**
 * Plugin Settings Manager
 * Write-through cache: localStorage for fast sync reads, Stash server for persistence.
 * Reads always come from localStorage (fast, FOUC-safe).
 * Writes go to localStorage immediately + server (debounced).
 */

import { StashAPI } from './StashAPI.js';
import { FeedSettings } from './types.js';

const PLUGIN_ID = 'stashgifs';
const LOCAL_SETTINGS_KEY = 'stashgifs-settings';
const LOCAL_HD_KEY = 'stashgifs-useHDMode';
const LOCAL_SHUFFLE_KEY = 'stashgifs-shuffleMode';
const LOCAL_MUTE_KEY = 'stashgifs-globalMuteState';
const SETTINGS_VERSION = 1;
const SAVE_DEBOUNCE_MS = 1000;

export interface PluginSettingsData {
  settings: Partial<FeedSettings>;
  hdMode: boolean;
  shuffleMode: number;
  globalMuteState: boolean;
  _version: number;
}

export class PluginSettingsManager {
  private api: StashAPI;
  private current: PluginSettingsData;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSave: PluginSettingsData | null = null;
  private onSettingsUpdated: ((data: PluginSettingsData) => void) | null = null;

  constructor(api: StashAPI) {
    this.api = api;
    this.current = PluginSettingsManager.getLocalSettings();

    // Flush pending saves before page unload
    globalThis.addEventListener('beforeunload', () => {
      this.flushSync();
    });
  }

  /**
   * Register a callback for when server settings differ from local cache.
   * Called during loadFromServer() if reconciliation updates the local state.
   */
  setOnSettingsUpdated(callback: (data: PluginSettingsData) => void): void {
    this.onSettingsUpdated = callback;
  }

  /**
   * Synchronous read from localStorage. Safe for constructors and early theme loading.
   */
  static getLocalSettings(): PluginSettingsData {
    const settings = PluginSettingsManager.readLocalJSON<Partial<FeedSettings>>(LOCAL_SETTINGS_KEY, {});
    const hdMode = PluginSettingsManager.readLocalString(LOCAL_HD_KEY, 'true') === 'true';
    const shuffleMode = PluginSettingsManager.readLocalInt(LOCAL_SHUFFLE_KEY, 0, 0, 2);
    const globalMuteState = PluginSettingsManager.readLocalString(LOCAL_MUTE_KEY, 'true') === 'true';

    return { settings, hdMode, shuffleMode, globalMuteState, _version: SETTINGS_VERSION };
  }

  /** Current in-memory settings (always up-to-date). */
  get data(): PluginSettingsData {
    return this.current;
  }

  /**
   * Fetch settings from Stash server and reconcile with local cache.
   * If server has settings, they win (enables cross-device sync).
   * If server is empty but local has settings, push local to server (migration).
   */
  async loadFromServer(): Promise<PluginSettingsData> {
    try {
      const serverConfig = await this.api.getPluginSettings(PLUGIN_ID);

      if (serverConfig && this.hasServerSettings(serverConfig)) {
        // Server has settings — use them as authoritative source
        const serverData = this.parseServerConfig(serverConfig);
        this.current = serverData;
        this.writeToLocalStorage(serverData);

        if (this.onSettingsUpdated) {
          this.onSettingsUpdated(serverData);
        }

        return serverData;
      }

      // Server is empty — migrate local settings to server
      const localData = PluginSettingsManager.getLocalSettings();
      if (Object.keys(localData.settings).length > 0) {
        this.current = localData;
        await this.saveToServer(localData);
      }

      return this.current;
    } catch (error) {
      console.warn('PluginSettingsManager: Failed to load from server, using local cache', error);
      return this.current;
    }
  }

  /**
   * Write-through save: localStorage immediately, server debounced.
   */
  save(partial: Partial<PluginSettingsData>): void {
    // Merge into current state
    if (partial.settings !== undefined) {
      this.current.settings = { ...this.current.settings, ...partial.settings };
    }
    if (partial.hdMode !== undefined) {
      this.current.hdMode = partial.hdMode;
    }
    if (partial.shuffleMode !== undefined) {
      this.current.shuffleMode = partial.shuffleMode;
    }
    if (partial.globalMuteState !== undefined) {
      this.current.globalMuteState = partial.globalMuteState;
    }

    // Immediate localStorage write
    this.writeToLocalStorage(this.current);

    // Debounced server write
    this.pendingSave = { ...this.current };
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.pendingSave) {
        const toSave = this.pendingSave;
        this.pendingSave = null;
        this.saveToServer(toSave).catch((error) => {
          console.warn('PluginSettingsManager: Failed to save to server', error);
        });
      }
    }, SAVE_DEBOUNCE_MS);
  }

  /**
   * Force immediate server save. Used on page unload.
   */
  async flush(): Promise<void> {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.pendingSave) {
      const toSave = this.pendingSave;
      this.pendingSave = null;
      await this.saveToServer(toSave);
    }
  }

  // --- Private helpers ---

  /**
   * Synchronous flush for beforeunload (sendBeacon-style best effort).
   * Uses navigator.sendBeacon if available, otherwise fire-and-forget fetch.
   */
  private flushSync(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (!this.pendingSave) return;

    const toSave = this.pendingSave;
    this.pendingSave = null;

    // Best-effort: fire-and-forget the server save
    this.saveToServer(toSave).catch(() => {
      // Ignore errors during unload — localStorage already has the latest
    });
  }

  private async saveToServer(data: PluginSettingsData): Promise<void> {
    const input: Record<string, unknown> = {
      settings: data.settings,
      hdMode: data.hdMode,
      globalMuteState: data.globalMuteState,
      _version: SETTINGS_VERSION,
    };
    await this.api.savePluginSettings(PLUGIN_ID, input);
  }

  private writeToLocalStorage(data: PluginSettingsData): void {
    try {
      localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(data.settings));
      localStorage.setItem(LOCAL_HD_KEY, data.hdMode ? 'true' : 'false');
      localStorage.setItem(LOCAL_MUTE_KEY, data.globalMuteState ? 'true' : 'false');
    } catch (error) {
      console.warn('PluginSettingsManager: Failed to write to localStorage', error);
    }
  }

  private hasServerSettings(config: Record<string, unknown>): boolean {
    return config._version !== undefined || config.settings !== undefined;
  }

  private parseServerConfig(config: Record<string, unknown>): PluginSettingsData {
    const settings = (config.settings && typeof config.settings === 'object')
      ? config.settings as Partial<FeedSettings>
      : {};
    const hdMode = typeof config.hdMode === 'boolean' ? config.hdMode : true;
    const shuffleMode = typeof config.shuffleMode === 'number' && config.shuffleMode >= 0 && config.shuffleMode <= 2
      ? config.shuffleMode
      : 0;
    const globalMuteState = typeof config.globalMuteState === 'boolean' ? config.globalMuteState : true;

    return { settings, hdMode, shuffleMode, globalMuteState, _version: SETTINGS_VERSION };
  }

  // --- Static localStorage readers ---

  private static readLocalJSON<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw) as T;
    } catch { /* ignore */ }
    return fallback;
  }

  private static readLocalString(key: string, fallback: string): string {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return raw;
    } catch { /* ignore */ }
    return fallback;
  }

  private static readLocalInt(key: string, fallback: number, min: number, max: number): number {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        const parsed = Number.parseInt(raw, 10);
        if (!Number.isNaN(parsed) && parsed >= min && parsed <= max) return parsed;
      }
    } catch { /* ignore */ }
    return fallback;
  }
}
