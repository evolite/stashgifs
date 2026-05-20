export class OverlayManager<T> {
  private overlay?: HTMLElement;
  private showTimeout?: number;
  private hideTimeout?: number;
  private abortController?: AbortController;
  private currentHoveredId?: string;
  private clickTime?: number;

  constructor(
    private readonly fetchDetails: (id: string, signal: AbortSignal) => Promise<T | null>,
    private readonly createOverlayEl: (data: T, onRemove?: () => Promise<boolean>) => HTMLElement,
    private readonly positionOverlay: (overlay: HTMLElement, chip: HTMLElement) => void
  ) {}

  show(id: string, chipEl: HTMLElement, onRemove?: () => Promise<boolean>): void {
    if (this.clickTime !== undefined && Date.now() - this.clickTime < 300) return;

    if (this.showTimeout !== undefined) {
      clearTimeout(this.showTimeout);
      this.showTimeout = undefined;
    }

    if (this.currentHoveredId === id && this.overlay) return;

    if (this.hideTimeout !== undefined) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = undefined;
    }

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = undefined;
    }

    const hadOverlay = !!this.overlay;
    this.hide(true);

    this.currentHoveredId = id;
    const delay = hadOverlay ? 50 : 600;

    this.showTimeout = setTimeout(async () => {
      if (this.currentHoveredId !== id) return;

      this.abortController = new AbortController();
      try {
        const data = await this.fetchDetails(id, this.abortController.signal);
        if (!data || this.currentHoveredId !== id) return;

        const overlay = this.createOverlayEl(data, onRemove);
        this.overlay = overlay;
        document.body.appendChild(overlay);
        this.positionOverlay(overlay, chipEl);

        requestAnimationFrame(() => {
          if (overlay.parentElement) overlay.style.opacity = '1';
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        console.warn('Failed to fetch overlay details:', error);
      }
    }, delay) as unknown as number;
  }

  hide(immediate = false): void {
    if (this.showTimeout !== undefined) {
      clearTimeout(this.showTimeout);
      this.showTimeout = undefined;
    }

    if (this.hideTimeout !== undefined) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = undefined;
    }

    if (this.overlay) {
      if (immediate) {
        try { this.overlay.remove(); } catch { /* already removed */ }
        this.overlay = undefined;
      } else {
        this.overlay.style.opacity = '0';
        const el = this.overlay;
        setTimeout(() => {
          try { if (el.parentElement) el.remove(); } catch { /* already removed */ }
        }, 200);
        this.overlay = undefined;
      }
    }

    this.currentHoveredId = undefined;

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = undefined;
    }
  }

  cancelHide(): void {
    if (this.hideTimeout !== undefined) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = undefined;
    }
  }

  recordClick(): void {
    this.clickTime = Date.now();
  }

  isHovered(): boolean {
    return !!this.overlay?.matches(':hover');
  }

  bindHover(
    chip: HTMLElement,
    id: string,
    chipSelector: string,
    onRemove?: () => Promise<boolean>
  ): void {
    chip.addEventListener('mouseenter', () => {
      this.cancelHide();
      this.show(id, chip, onRemove);
    });

    chip.addEventListener('mouseleave', (e) => {
      const relatedTarget = e.relatedTarget as HTMLElement | null;
      if (relatedTarget?.closest(chipSelector)) return;
      this.hideTimeout = setTimeout(() => {
        if (!this.isHovered()) this.hide();
        this.hideTimeout = undefined;
      }, 100) as unknown as number;
    });
  }

  destroy(): void {
    this.hide(true);
    this.clickTime = undefined;
  }
}
