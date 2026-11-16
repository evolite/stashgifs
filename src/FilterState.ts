import type { DateRangeFilter, FilterOptions, SavedFilterMode } from './types.js';

export type SavedFilter = { id: string; name: string; mode: SavedFilterMode };

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
