import { THEME } from './utils.js';
import type { StashBoxScene } from './graphql/types.js';

const LS_KEY = 'stashgifs-discovery-collapsed';
const DEFAULT_PANEL_WIDTH = 260;

export class DiscoveryPanel {
  private readonly outer: HTMLElement;  // slides right; tab hangs off its left edge
  private readonly tab: HTMLButtonElement;
  private readonly title: HTMLElement;
  private readonly scenes: HTMLElement;
  private readonly status: HTMLElement;
  private collapsed: boolean;
  private hasScenes = false;
  private panelWidth: number;
  private onOpen?: () => void;

  constructor(mountTarget: HTMLElement, size: number = DEFAULT_PANEL_WIDTH) {
    this.collapsed = localStorage.getItem(LS_KEY) !== '0';
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

    // Tab hugs the left edge of the outer, vertically centred on it.
    this.tab = document.createElement('button');
    this.tab.setAttribute('aria-label', 'Toggle StashDB discovery panel');
    this.tab.setAttribute('title', 'StashDB Discovery');
    Object.assign(this.tab.style, {
      position: 'absolute',
      right: '100%',
      top: '50%',
      transform: 'translateY(-50%)',
      width: '44px',
      height: '48px',
      border: 'none',
      borderRadius: '6px 0 0 6px',
      background: THEME.colors.surface,
      color: THEME.colors.accentPrimary,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '-2px 0 8px rgba(0,0,0,0.35)',
    });
    this.tab.innerHTML = this.tabIcon(this.collapsed);
    this.tab.addEventListener('click', () => this.toggle());

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
    });

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

    body.appendChild(this.status);
    body.appendChild(this.scenes);
    inner.appendChild(header);
    inner.appendChild(body);
    this.outer.appendChild(this.tab);
    this.outer.appendChild(inner);
    mountTarget.appendChild(this.outer);

    this.showGhosts();
  }

  // fallow-ignore-next-line unused-class-member
  showSpinner(): void {}

  // fallow-ignore-next-line unused-class-member
  hideSpinner(): void {}

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
    const wasCollapsed = this.collapsed;
    this.collapsed = !this.collapsed;
    localStorage.setItem(LS_KEY, this.collapsed ? '1' : '0');
    this.outer.style.right = this.collapsed ? `-${this.panelWidth}px` : '0';
    this.tab.innerHTML = this.tabIcon(this.collapsed);
    if (wasCollapsed && !this.collapsed) this.onOpen?.();
  }

  // fallow-ignore-next-line unused-class-member
  showLoading(): void {
    if (this.hasScenes) return;
    this.showGhosts();
  }

  private showGhosts(): void {
    this.status.style.display = 'none';
    this.scenes.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      this.scenes.appendChild(this.buildGhostCard());
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
    const cards = [0, 1, 2].map(() => this.buildPlaceholderCard(symbol));
    this.swapCards(cards);
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
      this.scenes.innerHTML = '';
      this.hasScenes = false;
      this.status.textContent = 'No scenes found';
      this.status.style.display = 'block';
      return;
    }

    this.swapCards(scenes.map(({ scene, baseUrl, performerName, localStashId }) =>
      this.buildCard(scene, baseUrl, performerName, localStashId)
    ));
    this.hasScenes = true;
  }

  private swapCards(newCards: HTMLElement[]): void {
    this.scenes.innerHTML = '';
    for (const card of newCards) {
      card.style.opacity = '0';
      card.style.transform = 'translateX(40px)';
      card.style.transition = 'none';
      this.scenes.appendChild(card);
    }
    // Force reflow so initial opacity/transform are applied before the transition kicks in
    this.scenes.getBoundingClientRect();

    // Shuffle indices so cards fade+slide in one-by-one in a random order
    const order = newCards.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    order.forEach((cardIndex, step) => {
      const card = newCards[cardIndex];
      const delay = `${step * 400}ms`;
      card.style.transition = `opacity 1s ease ${delay}, transform 1s cubic-bezier(0.25, 0.46, 0.45, 0.94) ${delay}`;
      card.style.opacity = '1';
      card.style.transform = 'translateX(0)';
    });
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

    const thumb = document.createElement('div');
    thumb.style.cssText = `position: relative; width: 100%; aspect-ratio: 16/9; background: ${THEME.colors.backgroundPrimary}; overflow: hidden;`;

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

    const info = document.createElement('div');
    info.style.cssText = `padding: 4px 8px 6px; display: flex; flex-direction: column; gap: 1px; overflow: hidden;`;

    const nameEl = document.createElement('div');
    nameEl.style.cssText = `font-size: 10px; color: ${THEME.colors.accentPrimary}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
    nameEl.textContent = performerName;

    const titleEl = document.createElement('div');
    titleEl.style.cssText = `font-weight: ${THEME.typography.weightBodyStrong}; font-size: ${THEME.typography.sizeMeta}; color: ${THEME.colors.textPrimary}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
    titleEl.textContent = scene.title ?? 'Untitled';

    const meta = document.createElement('div');
    meta.style.cssText = `font-size: 10px; color: ${THEME.colors.textMuted}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
    const parts: string[] = [];
    if (scene.date) parts.push(scene.date);
    if (scene.studio?.name) parts.push(scene.studio.name);
    meta.textContent = parts.join(' · ');

    const link = document.createElement('a');
    if (localStashId) {
      link.href = `/scenes/${localStashId}`;
      link.target = '_self';
      link.rel = '';
      const icon = document.createElement('span');
      icon.textContent = '▶';
      icon.style.cssText = `color: ${THEME.colors.accentPrimary}; margin-right: 3px; font-size: 8px; vertical-align: middle;`;
      link.appendChild(icon);
      link.appendChild(document.createTextNode('Play in Stash'));
    } else {
      link.href = `${baseUrl}/scenes/${scene.id}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'View on StashDB →';
    }
    link.style.cssText = `font-size: 10px; color: ${THEME.colors.accentPrimary}; text-decoration: none; margin-top: 2px; display: inline-block; white-space: nowrap;`;

    info.appendChild(nameEl);
    info.appendChild(titleEl);
    info.appendChild(meta);
    info.appendChild(link);
    card.appendChild(thumb);
    card.appendChild(info);

    return card;
  }

  private tabIcon(collapsed: boolean): string {
    const d = collapsed ? 'M8 3 L2 9 L8 15' : 'M2 3 L8 9 L2 15';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="18" viewBox="0 0 10 18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  }

  destroy(): void {
    this.outer.remove();
  }
}
