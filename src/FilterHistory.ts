/**
 * Browser back/forward for filter changes: each distinct filter selection becomes a history entry
 * (same URL, so reload-safe) and popstate restores it.
 */

import type { FilterState, FilterSnapshot } from './FilterState.js';

export class FilterHistory {
  private lastJson = '';
  private restoring = false;

  /** @param onRestore Called after the state was replaced from history; should refresh pills/input and reload the feed. */
  constructor(
    private readonly state: FilterState,
    private readonly onRestore: () => void,
  ) {}

  /** Record the current selection as the starting entry and start listening for back/forward. */
  start(): void {
    window.addEventListener('popstate', this.onPopState);
    const snapshot = this.state.toSnapshot();
    this.lastJson = JSON.stringify(snapshot);
    history.replaceState({ filterSnapshot: snapshot }, '');
  }

  stop(): void {
    window.removeEventListener('popstate', this.onPopState);
  }

  /** Push the current selection unless it equals the last recorded one. */
  push(): void {
    if (this.restoring) return;
    const snapshot = this.state.toSnapshot();
    const json = JSON.stringify(snapshot);
    if (json === this.lastJson) return; // dedupe consecutive identical states
    this.lastJson = json;
    history.pushState({ filterSnapshot: snapshot }, '');
  }

  private readonly onPopState = (event: PopStateEvent): void => {
    const snapshot = (event.state as { filterSnapshot?: FilterSnapshot } | null)?.filterSnapshot;
    if (!snapshot) return; // not one of our entries
    this.restoring = true;
    this.lastJson = JSON.stringify(snapshot);
    try {
      this.state.replace(snapshot);
      this.onRestore();
    } finally {
      this.restoring = false;
    }
  };
}
