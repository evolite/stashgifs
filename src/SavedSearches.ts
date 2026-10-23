/**
 * User-saved searches (tags/performers/studios/marker name/date range), stored in plugin settings.
 */

import type { SavedSearch } from './types.js';
import type { FilterSnapshot } from './FilterState.js';
import type { PluginSettingsManager } from './PluginSettingsManager.js';

export class SavedSearches {
  constructor(private readonly settings: PluginSettingsManager) {}

  list(): SavedSearch[] {
    return this.settings.data.settings.savedSearches ?? [];
  }

  /** Save under `name`, replacing an existing search with the same name (case-insensitive). */
  save(name: string, snapshot: FilterSnapshot): void {
    const existing = this.list();
    const wanted = name.trim().toLowerCase();
    const matchIndex = existing.findIndex((s) => s.name.trim().toLowerCase() === wanted);
    // A saved filter is referenced by id elsewhere; a saved search stores only the selections.
    const { tags, performers, studios, markerName, dateRange } = snapshot;
    const entry: SavedSearch = {
      id: matchIndex >= 0 ? existing[matchIndex]!.id : crypto.randomUUID(),
      name,
      tags, performers, studios, markerName, dateRange,
    };
    const savedSearches = matchIndex >= 0
      ? existing.map((s, i) => (i === matchIndex ? entry : s))
      : [...existing, entry];
    this.settings.save({ settings: { savedSearches } });
  }

  delete(id: string): void {
    this.settings.save({ settings: { savedSearches: this.list().filter((s) => s.id !== id) } });
  }
}
