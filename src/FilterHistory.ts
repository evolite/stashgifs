import type { FilterState, FilterSnapshot } from './FilterState.js';

export class FilterHistory {
  private lastJson = '';
  private restoring = false;

  constructor(
    private readonly state: FilterState,
    private readonly onRestore: () => void,
  ) {}

  start(): void {
    window.addEventListener('popstate', this.onPopState);
    const snapshot = this.state.toSnapshot();
    this.lastJson = JSON.stringify(snapshot);
    history.replaceState({ filterSnapshot: snapshot }, '');
  }

  stop(): void {
    window.removeEventListener('popstate', this.onPopState);
  }

  push(): void {
    if (this.restoring) return;
    const snapshot = this.state.toSnapshot();
    const json = JSON.stringify(snapshot);
    if (json === this.lastJson) return;
    this.lastJson = json;
    history.pushState({ filterSnapshot: snapshot }, '');
  }

  private readonly onPopState = (event: PopStateEvent): void => {
    const snapshot = (event.state as { filterSnapshot?: FilterSnapshot } | null)?.filterSnapshot;
    if (!snapshot) return;
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
