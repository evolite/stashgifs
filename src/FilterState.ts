/**
 * The interactive filter selection (tags, performers, studios, marker name, date range, saved filter).
 *
 * One object owns every field so "reset", "snapshot" and "build the query filters" cover the
 * same set everywhere — previously each caller listed the fields by hand and drifted.
 */

import type { DateRangeFilter, FilterOptions, SavedFilterMode } from './types.js';

export type SavedFilter = { id: string; name: string; mode: SavedFilterMode };

/** Serializable form, stored in history.state and (minus savedFilter) in saved searches. */
export interface FilterSnapshot {
  tags: [number, string][];
  performers: [number, string][];
  studios: [number, string][];
  markerName?: string;
  dateRange?: DateRangeFilter;
  savedFilter?: SavedFilter;
}

export class FilterState {
  readonly tags = new Map<number, string>();
  readonly performers = new Map<number, string>();
  readonly studios = new Map<number, string>();
  markerName?: string;
  dateRange?: DateRangeFilter;
  savedFilter?: SavedFilter;

  /** Replace the whole selection. Omitted fields end up empty, so nothing from the old state survives. */
  replace(next: Partial<FilterSnapshot> = {}): void {
    this.tags.clear();
    this.performers.clear();
    this.studios.clear();
    for (const [id, name] of next.tags ?? []) this.tags.set(id, name);
    for (const [id, name] of next.performers ?? []) this.performers.set(id, name);
    for (const [id, name] of next.studios ?? []) this.studios.set(id, name);
    this.markerName = next.markerName;
    this.dateRange = next.dateRange;
    this.savedFilter = next.savedFilter;
  }

  reset(): void {
    this.replace();
  }

  /** Number of pill-worthy selections (a saved filter is shown in the input instead). */
  get pillCount(): number {
    return this.tags.size + this.performers.size + this.studios.size
      + (this.markerName ? 1 : 0) + (this.dateRange ? 1 : 0);
  }

  toSnapshot(): FilterSnapshot {
    return {
      tags: [...this.tags.entries()],
      performers: [...this.performers.entries()],
      studios: [...this.studios.entries()],
      markerName: this.markerName,
      dateRange: this.dateRange,
      savedFilter: this.savedFilter,
    };
  }

  /** The feed query for this selection. `query` overrides the marker-name search (free-text resolution). */
  toFilterOptions(opts: { limit: number; includeSubtags: boolean; query?: string }): FilterOptions {
    const ids = (m: Map<number, string>) => (m.size ? [...m.keys()].map(String) : undefined);
    const depth = opts.includeSubtags ? -1 : 0;
    return {
      query: opts.query ?? this.markerName,
      tags: ids(this.tags),
      performers: ids(this.performers),
      studios: ids(this.studios),
      savedFilterId: this.savedFilter?.id || undefined,
      savedFilterMode: this.savedFilter?.mode,
      limit: opts.limit,
      offset: 0,
      tagDepth: depth,
      studioDepth: depth,
      dateRangeFilter: this.dateRange,
    };
  }
}
