import { THEME, showToast } from './utils.js';
import type { StashBoxScene } from './graphql/types.js';
import type { WhisparrClient, WhisparrScene, WhisparrQueueItem } from './WhisparrClient.js';

const LS_KEY = 'stashgifs-discovery-collapsed';
const DEFAULT_PANEL_WIDTH = 260;

export interface DiscoveryPanelControl {
  toggle(): void;
  isCollapsed(): boolean;
  setCollapsed(collapsed: boolean): void;
  onCollapseChange(cb: (collapsed: boolean) => void): () => void;
}

export const DISCOVERY_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.65" y2="16.65"/></svg>';

type WhisparrButtonState =
  | { kind: 'loading' }
  | { kind: 'add' }
  | { kind: 'downloading'; movieId: number; percent?: number }
  | { kind: 'monitored'; movieId: number }
  | { kind: 'downloaded'; movieId: number }
  | { kind: 'error'; message: string };

export class DiscoveryPanel {
  private readonly outer: HTMLElement;
  private readonly title: HTMLElement;
  private readonly scenes: HTMLElement;
  private readonly slots: HTMLElement[] = [];
  private readonly slotHasContent: boolean[] = [false, false, false];
  private readonly status: HTMLElement;
  private collapsed: boolean;
  private hasScenes = false;
  private panelWidth: number;
  private onOpen?: () => void;
  private readonly collapseListeners: Array<(collapsed: boolean) => void> = [];
  private whisparr?: WhisparrClient;

  constructor(mountTarget: HTMLElement, size: number = DEFAULT_PANEL_WIDTH, whisparr?: WhisparrClient) {
    this.whisparr = whisparr;
    // Always start collapsed on page load; the user opens it via the per-post button.
    this.collapsed = true;
    this.panelWidth = size;

    // Outer slides. overflow:visible so the tab sticks out to the left without clipping.
    this.outer = document.createElement('div');
    Object.assign(this.outer.style, {
      position: 'fixed',
      right: this.collapsed ? `-${this.panelWidth}px` : '0',
      top: '50%',
      transform: 'translateY(-50%)',
      width: `${this.panelWidth}px`,
      maxWidth: '100vw',
      maxHeight: '80vh',
      zIndex: '9000',
      overflow: 'visible',
      display: 'flex',
      flexDirection: 'column',
      transition: 'right 0.2s ease',
      fontFamily: THEME.typography.fontFamily,
      fontSize: THEME.typography.sizeBody,
      color: THEME.colors.textPrimary,
    });

    // Inner panel — clipping container for the scrollable content.
    const inner = document.createElement('div');
    Object.assign(inner.style, {
      width: '100%',
      flex: '1',
      minHeight: '0',
      background: THEME.colors.backgroundSecondary,
      border: `1px solid ${THEME.colors.border}`,
      borderRight: 'none',
      borderRadius: '8px 0 0 8px',
      boxShadow: '-4px 0 16px rgba(0,0,0,0.4)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      padding: '10px 12px',
      flexShrink: '0',
      background: THEME.colors.surface,
      borderBottom: `1px solid ${THEME.colors.border}`,
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close StashDB discovery panel');
    closeBtn.title = 'Close';
    Object.assign(closeBtn.style, {
      width: '24px',
      height: '24px',
      flexShrink: '0',
      border: 'none',
      background: 'transparent',
      color: THEME.colors.textSecondary,
      cursor: 'pointer',
      borderRadius: '4px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0',
    });
    closeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = THEME.colors.textPrimary; closeBtn.style.background = THEME.colors.backgroundPrimary; });
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = THEME.colors.textSecondary; closeBtn.style.background = 'transparent'; });
    closeBtn.addEventListener('click', () => this.setCollapsed(true));
    header.appendChild(closeBtn);

    this.title = document.createElement('span');
    Object.assign(this.title.style, {
      fontWeight: THEME.typography.weightBodyStrong,
      fontSize: THEME.typography.sizeMeta,
      color: THEME.colors.textSecondary,
    });
    this.title.textContent = 'StashDB Discovery';
    header.appendChild(this.title);

    if (!document.getElementById('stashgifs-spin-style')) {
      const style = document.createElement('style');
      style.id = 'stashgifs-spin-style';
      style.textContent = [
        '@keyframes stashgifs-spin { to { transform: rotate(360deg); } }',
        '@keyframes stashgifs-pulse { 0%,100% { opacity: 0.35; } 50% { opacity: 0.7; } }',
        '@keyframes stashgifs-jiggle { 0%,100% { transform: rotate(0) scale(1); } 10% { transform: rotate(-22deg) scale(1.25); } 20% { transform: rotate(20deg) scale(1.25); } 30% { transform: rotate(-18deg) scale(1.2); } 45% { transform: rotate(14deg) scale(1.15); } 60% { transform: rotate(-10deg) scale(1.1); } 75% { transform: rotate(6deg) scale(1.05); } 90% { transform: rotate(-3deg) scale(1.02); } }',
        `@keyframes stashgifs-discovery-pulse { 0%,100% { color: ${THEME.colors.iconInactive}; } 15%,85% { color: ${THEME.colors.accentPrimary}; } 50% { color: ${THEME.colors.accentPrimary}; } }`,
      ].join(' ');
      document.head.appendChild(style);
    }

    const body = document.createElement('div');
    Object.assign(body.style, {
      overflowY: 'auto',
      flex: '1',
      minHeight: '0',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      padding: '8px',
    });

    this.scenes = document.createElement('div');
    Object.assign(this.scenes.style, {
      minWidth: '0',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
    });

    this.status = document.createElement('div');
    Object.assign(this.status.style, {
      color: THEME.colors.textMuted,
      fontSize: THEME.typography.sizeMeta,
      textAlign: 'center',
      padding: '12px 4px',
      lineHeight: '1.5',
      display: 'none',
    });

    for (let i = 0; i < 3; i++) {
      const slot = document.createElement('div');
      slot.style.cssText = 'width: 100%; min-width: 0;';
      slot.appendChild(this.buildGhostCard());
      this.slots.push(slot);
      this.scenes.appendChild(slot);
    }

    body.appendChild(this.status);
    body.appendChild(this.scenes);
    inner.appendChild(header);
    inner.appendChild(body);
    this.outer.appendChild(inner);
    mountTarget.appendChild(this.outer);
  }

  // fallow-ignore-next-line unused-class-member
  isCollapsed(): boolean { return this.collapsed; }

  // fallow-ignore-next-line unused-class-member
  setOnOpen(cb: () => void): void { this.onOpen = cb; }

  setSize(size: number): void {
    this.panelWidth = size;
    this.outer.style.width = `${this.panelWidth}px`;
    this.outer.style.right = this.collapsed ? `-${this.panelWidth}px` : '0';
  }

  toggle(): void {
    this.setCollapsed(!this.collapsed);
  }

  setCollapsed(collapsed: boolean): void {
    if (this.collapsed === collapsed) return;
    const wasCollapsed = this.collapsed;
    this.collapsed = collapsed;
    localStorage.setItem(LS_KEY, this.collapsed ? '1' : '0');
    this.outer.style.right = this.collapsed ? `-${this.panelWidth}px` : '0';
    if (wasCollapsed && !this.collapsed) this.onOpen?.();
    for (const cb of this.collapseListeners) cb(this.collapsed);
  }

  onCollapseChange(cb: (collapsed: boolean) => void): () => void {
    this.collapseListeners.push(cb);
    return () => {
      const idx = this.collapseListeners.indexOf(cb);
      if (idx >= 0) this.collapseListeners.splice(idx, 1);
    };
  }

  // fallow-ignore-next-line unused-class-member
  showLoading(): void {
    if (this.hasScenes) return;
    this.showGhosts();
  }

  private showGhosts(): void {
    this.status.style.display = 'none';
    this.slotHasContent.fill(false);
    for (const slot of this.slots) {
      slot.innerHTML = '';
      slot.appendChild(this.buildGhostCard());
    }
  }

  private buildGhostCard(): HTMLElement {
    const card = document.createElement('div');
    Object.assign(card.style, {
      background: THEME.colors.surface,
      borderRadius: THEME.radius.card,
      overflow: 'hidden',
      border: `1px solid ${THEME.colors.border}`,
      minWidth: '0',
      width: '100%',
      boxSizing: 'border-box',
    });

    const thumb = document.createElement('div');
    thumb.style.cssText = `width: 100%; aspect-ratio: 16/9; background: ${THEME.colors.backgroundPrimary}; display: flex; align-items: center; justify-content: center;`;
    const spinner = document.createElement('span');
    spinner.style.cssText = `width: 18px; height: 18px; border-radius: 50%; border: 2px solid ${THEME.colors.border}; border-top-color: ${THEME.colors.accentPrimary}; animation: stashgifs-spin 0.7s linear infinite; display: inline-block;`;
    thumb.appendChild(spinner);

    const info = document.createElement('div');
    info.style.cssText = `padding: 6px 8px 7px; display: flex; flex-direction: column; gap: 5px;`;
    for (const width of ['55%', '80%', '40%']) {
      const bar = document.createElement('div');
      bar.style.cssText = `height: 8px; border-radius: 4px; background: ${THEME.colors.border}; width: ${width}; animation: stashgifs-pulse 1.5s ease-in-out infinite;`;
      info.appendChild(bar);
    }

    card.appendChild(thumb);
    card.appendChild(info);
    return card;
  }

  // fallow-ignore-next-line unused-class-member
  showEmpty(reason: string): void {
    this.hasScenes = false;
    this.status.textContent = reason;
    this.status.style.display = 'block';
    this.showPlaceholders('?');
  }

  // fallow-ignore-next-line unused-class-member
  showError(message: string): void {
    this.hasScenes = false;
    this.status.textContent = message;
    this.status.style.display = 'block';
    this.showPlaceholders('✕');
  }

  private showPlaceholders(symbol: string): void {
    this.slotHasContent.fill(false);
    for (const slot of this.slots) {
      slot.innerHTML = '';
      slot.appendChild(this.buildPlaceholderCard(symbol));
    }
  }

  private buildPlaceholderCard(symbol: string): HTMLElement {
    const card = document.createElement('div');
    Object.assign(card.style, {
      background: THEME.colors.surface,
      borderRadius: THEME.radius.card,
      overflow: 'hidden',
      border: `1px solid ${THEME.colors.border}`,
      flexShrink: '0',
      opacity: '0.4',
    });

    const thumb = document.createElement('div');
    thumb.style.cssText = `width: 100%; aspect-ratio: 16/9; background: ${THEME.colors.backgroundPrimary}; display: flex; align-items: center; justify-content: center;`;
    const sym = document.createElement('span');
    sym.style.cssText = `font-size: 24px; color: ${THEME.colors.textMuted};`;
    sym.textContent = symbol;
    thumb.appendChild(sym);

    const info = document.createElement('div');
    info.style.cssText = `height: 44px; box-sizing: border-box;`;

    card.appendChild(thumb);
    card.appendChild(info);
    return card;
  }

  // fallow-ignore-next-line unused-class-member
  showScenes(scenes: Array<{ scene: StashBoxScene; baseUrl: string; performerName: string; localStashId?: string }>): void {
    this.status.style.display = 'none';
    this.title.textContent = 'StashDB Discovery';

    if (!scenes.length) {
      this.hasScenes = false;
      this.status.textContent = 'No scenes found';
      this.status.style.display = 'block';
      return;
    }

    const newCards = scenes.map(({ scene, baseUrl, performerName, localStashId }) =>
      this.buildCard(scene, baseUrl, performerName, localStashId)
    );

    for (const card of newCards) {
      card.style.opacity = '0';
      card.style.transform = 'translateX(40px)';
      card.style.transition = 'none';
    }

    // Prefer replacing slots without real content; shuffle within each group
    const emptySlots = this.slotHasContent.map((has, i) => ({ has, i })).filter(s => !s.has).map(s => s.i);
    const filledSlots = this.slotHasContent.map((has, i) => ({ has, i })).filter(s => s.has).map(s => s.i);
    this.shuffleInPlace(emptySlots);
    this.shuffleInPlace(filledSlots);
    const targetSlots = [...emptySlots, ...filledSlots].slice(0, newCards.length);

    for (let i = 0; i < newCards.length; i++) {
      const si = targetSlots[i];
      this.slots[si].innerHTML = '';
      this.slots[si].appendChild(newCards[i]);
      this.slotHasContent[si] = true;
    }

    // Force reflow so initial opacity/transform are applied before the transition kicks in
    this.scenes.getBoundingClientRect();

    // Shuffle indices so cards fade+slide in one-by-one in a random order
    const order = newCards.map((_, i) => i);
    this.shuffleInPlace(order);
    order.forEach((cardIndex, step) => {
      const delay = `${step * 400}ms`;
      newCards[cardIndex].style.transition = `opacity 1s ease ${delay}, transform 1s cubic-bezier(0.25, 0.46, 0.45, 0.94) ${delay}`;
      newCards[cardIndex].style.opacity = '1';
      newCards[cardIndex].style.transform = 'translateX(0)';
    });

    this.hasScenes = true;
  }

  private shuffleInPlace<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  private buildCard(scene: StashBoxScene, baseUrl: string, performerName: string, localStashId?: string): HTMLElement {
    const card = document.createElement('div');
    Object.assign(card.style, {
      background: THEME.colors.surface,
      borderRadius: THEME.radius.card,
      overflow: 'hidden',
      border: `1px solid ${THEME.colors.border}`,
      minWidth: '0',
      width: '100%',
      boxSizing: 'border-box',
    });

    const thumb = document.createElement('a');
    thumb.style.cssText = `position: relative; width: 100%; aspect-ratio: 16/9; background: ${THEME.colors.backgroundPrimary}; overflow: hidden; display: block; text-decoration: none; color: inherit;`;
    thumb.target = '_blank';
    thumb.rel = 'noopener noreferrer';
    if (localStashId) {
      thumb.href = `/scenes/${localStashId}`;
      thumb.title = 'Play in Stash';
    } else {
      thumb.href = `${baseUrl}/scenes/${scene.id}`;
      thumb.title = 'View on StashDB';
    }

    const imgUrl = scene.images?.[0]?.url;
    if (imgUrl) {
      const img = document.createElement('img');
      img.src = imgUrl;
      img.alt = scene.title ?? '';
      img.style.cssText = 'width: 100%; height: 100%; object-fit: cover; display: block;';
      img.loading = 'lazy';
      thumb.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.style.cssText = `width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: ${THEME.colors.textMuted}; font-size: ${THEME.typography.sizeMeta};`;
      placeholder.textContent = scene.studio?.name ?? '—';
      thumb.appendChild(placeholder);
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = `position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 40px; height: 40px; border-radius: 50%; background: rgba(0, 0, 0, 0.55); color: #fff; display: flex; align-items: center; justify-content: center; pointer-events: none; transition: background 0.15s ease;`;
    if (localStashId) {
      overlay.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
      overlay.setAttribute('aria-label', 'Play in Stash');
    } else {
      overlay.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
      overlay.setAttribute('aria-label', 'View on StashDB');
    }
    thumb.appendChild(overlay);
    thumb.addEventListener('mouseenter', () => { overlay.style.background = THEME.colors.accentPrimary; });
    thumb.addEventListener('mouseleave', () => { overlay.style.background = 'rgba(0, 0, 0, 0.55)'; });

    const info = document.createElement('div');
    info.style.cssText = `padding: 4px 8px 6px; display: flex; flex-direction: column; gap: 1px; overflow: hidden;`;

    const nameEl = document.createElement('div');
    nameEl.style.cssText = `font-size: 10px; color: ${THEME.colors.accentPrimary}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
    nameEl.textContent = performerName;

    const titleEl = document.createElement('a');
    titleEl.style.cssText = `font-weight: ${THEME.typography.weightBodyStrong}; font-size: ${THEME.typography.sizeMeta}; color: ${THEME.colors.textPrimary}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-decoration: none; display: block;`;
    titleEl.textContent = scene.title ?? 'Untitled';
    titleEl.target = '_blank';
    titleEl.rel = 'noopener noreferrer';
    if (localStashId) {
      titleEl.href = `/scenes/${localStashId}`;
      titleEl.title = 'Play in Stash';
    } else {
      titleEl.href = `${baseUrl}/scenes/${scene.id}`;
      titleEl.title = 'View on StashDB';
    }

    const meta = document.createElement('div');
    meta.style.cssText = `font-size: 10px; color: ${THEME.colors.textMuted}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
    const parts: string[] = [];
    if (scene.date) parts.push(scene.date);
    if (scene.studio?.name) parts.push(scene.studio.name);
    meta.textContent = parts.join(' · ');

    info.appendChild(nameEl);
    info.appendChild(titleEl);
    info.appendChild(meta);
    card.appendChild(thumb);
    card.appendChild(info);

    this.renderWhisparrButton(card, info, scene, localStashId);

    return card;
  }

  setWhisparrClient(client: WhisparrClient | undefined): void {
    this.whisparr = client;
  }

  private renderWhisparrButton(card: HTMLElement, info: HTMLElement, scene: StashBoxScene, localStashId?: string): void {
    if (!this.whisparr?.isFullyConfigured()) return;
    const whisparr = this.whisparr;

    const button = document.createElement('button');
    button.type = 'button';
    Object.assign(button.style, {
      marginTop: '4px',
      padding: '4px 8px',
      borderRadius: THEME.radius.button,
      border: `1px solid ${THEME.colors.border}`,
      background: THEME.colors.backgroundPrimary,
      color: THEME.colors.accentPrimary,
      cursor: 'pointer',
      fontSize: '10px',
      fontFamily: THEME.typography.fontFamily,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '4px',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    });
    info.appendChild(button);

    let state: WhisparrButtonState = { kind: 'loading' };
    let pollTimer: number | undefined;
    let destroyed = false;

    const applyState = (next: WhisparrButtonState) => {
      state = next;
      switch (next.kind) {
        case 'loading':
          button.textContent = '… Whisparr';
          button.disabled = true;
          button.title = 'Checking Whisparr…';
          button.style.color = THEME.colors.textMuted;
          button.style.cursor = 'wait';
          break;
        case 'add':
          button.textContent = '+ Add to Whisparr';
          button.disabled = false;
          button.title = 'Add this scene to Whisparr (monitored, auto-search)';
          button.style.color = THEME.colors.accentPrimary;
          button.style.cursor = 'pointer';
          break;
        case 'downloading': {
          const pct = typeof next.percent === 'number' ? ` ${next.percent.toFixed(0)}%` : '';
          button.textContent = `↓ Downloading${pct}`;
          button.disabled = false;
          button.title = 'In Whisparr download queue — click to refresh';
          button.style.color = THEME.colors.accentPrimary;
          button.style.cursor = 'pointer';
          break;
        }
        case 'monitored':
          button.textContent = '👁 Monitored';
          button.disabled = true;
          button.title = 'Monitored in Whisparr, awaiting release';
          button.style.color = THEME.colors.textMuted;
          button.style.cursor = 'default';
          break;
        case 'downloaded':
          button.textContent = '✓ Downloaded';
          button.disabled = true;
          button.title = 'Whisparr has a file for this scene';
          button.style.color = THEME.colors.accentPrimary;
          button.style.cursor = 'default';
          break;
        case 'error':
          button.textContent = '! Whisparr error';
          button.disabled = false;
          button.title = next.message;
          button.style.color = '#e57373';
          button.style.cursor = 'pointer';
          break;
      }
    };

    const classify = async (movie: WhisparrScene): Promise<WhisparrButtonState> => {
      if (movie.hasFile) return { kind: 'downloaded', movieId: movie.id };
      try {
        const queueItem = await whisparr.getQueueForMovie(movie.id);
        if (queueItem) {
          const percent = computePercent(queueItem);
          return { kind: 'downloading', movieId: movie.id, percent };
        }
      } catch {
        // queue lookup failure: still show as monitored
      }
      return { kind: 'monitored', movieId: movie.id };
    };

    const refresh = async () => {
      if (destroyed) return;
      try {
        const movie = await whisparr.getSceneByStashId(scene.id);
        if (destroyed) return;
        if (!movie) {
          applyState({ kind: 'add' });
          stopPolling();
          return;
        }
        const next = await classify(movie);
        if (destroyed) return;
        applyState(next);
        if (next.kind === 'downloading') startPolling();
        else stopPolling();
      } catch (err) {
        if (destroyed) return;
        const message = err instanceof Error ? err.message : String(err);
        applyState({ kind: 'error', message });
        stopPolling();
      }
    };

    const startPolling = () => {
      if (pollTimer !== undefined) return;
      pollTimer = globalThis.setInterval(() => {
        whisparr.invalidateCaches();
        void refresh();
      }, 5000);
    };
    const stopPolling = () => {
      if (pollTimer !== undefined) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
    };

    button.addEventListener('click', async () => {
      if (button.disabled) return;
      if (state.kind === 'add' || state.kind === 'error') {
        applyState({ kind: 'loading' });
        try {
          await whisparr.addScene(scene.id);
          showToast(`Added "${scene.title ?? 'scene'}" to Whisparr`);
          await refresh();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          showToast(`Whisparr add failed: ${message}`, 4000);
          applyState({ kind: 'error', message });
        }
        return;
      }
      if (state.kind === 'downloading') {
        whisparr.invalidateCaches();
        await refresh();
      }
    });

    const observer = new MutationObserver(() => {
      if (!document.body.contains(card)) {
        destroyed = true;
        stopPolling();
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    applyState({ kind: 'loading' });
    void refresh();
  }

  destroy(): void {
    this.outer.remove();
  }
}

function computePercent(item: WhisparrQueueItem): number | undefined {
  if (typeof item.size !== 'number' || typeof item.sizeleft !== 'number' || item.size <= 0) {
    return undefined;
  }
  return Math.max(0, Math.min(100, ((item.size - item.sizeleft) / item.size) * 100));
}
