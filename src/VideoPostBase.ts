/**
 * VideoPostBase
 * Abstract base class for video-capable post components (VideoPost and ImageVideoPost).
 * Extracts shared video-player management logic to reduce code duplication.
 */

import type { IVideoPlayer } from './types.js';
import { isMobileDevice, THEME, showToast } from './utils.js';
import { HQ_SVG_OUTLINE, HQ_SVG_FILLED, VOLUME_MUTED_SVG, VOLUME_UNMUTED_SVG } from './icons.js';
import { BasePost, BasePostOptions } from './BasePost.js';
import { setupTouchHandlers, preventClickAfterTouch } from './utils/touchHandlers.js';
export type { DiscoveryPanelControl } from './DiscoveryPanel.js';

export interface BaseVideoPostOptions extends BasePostOptions {
  onMuteToggle?: (isMuted: boolean) => void;
  getGlobalMuteState?: () => boolean;
  onCancelRequests?: () => void;
  ratingSystemConfig?: { type?: string; starPrecision?: string } | null;
  reelMode?: boolean;
  hdModeFromSettings?: boolean;
}

export abstract class VideoPostBase extends BasePost {
  protected isLoaded: boolean = false;
  protected isHQMode: boolean = false;
  protected loadErrorCount: number = 0;
  protected hqButton?: HTMLElement;
  protected muteOverlayButton?: HTMLElement;
  protected onMuteToggle?: (isMuted: boolean) => void;
  protected getGlobalMuteState?: () => boolean;
  protected hasFailedPermanently: boolean = false;
  protected errorPlaceholder?: HTMLElement;
  protected retryTimeoutId?: number;
  protected loadErrorCheckTimeoutId?: ReturnType<typeof setTimeout>;
  protected loadErrorHandler?: () => void;
  protected hdModeFromSettings: boolean = false;
  private progressBar?: { track: HTMLElement; fill: HTMLElement; cleanup: () => void };

  constructor(
    container: HTMLElement,
    options?: BasePostOptions
  ) {
    super(container, options);
  }

  protected abstract getPlayer(): IVideoPlayer | undefined;
  protected abstract checkForLoadError(): void;
  protected abstract getHQButtonOffLabel(): string;

  protected capturePlayerState(): { playerContainer: HTMLElement; wasPlaying: boolean } {
    const playerContainer = this.playerContainer || this.container.querySelector('.video-post__player') as HTMLElement;
    if (!playerContainer) {
      throw new Error('Player container not found');
    }
    const playerState = this.getPlayer()?.getState();
    const wasPlaying = playerState?.isPlaying ?? false;
    return { playerContainer, wasPlaying };
  }

  protected createVideoPlayerContainer(aspectRatio: number | undefined, aspectRatioClass: string): HTMLElement {
    const container = document.createElement('div');
    container.className = 'video-post__player';
    container.style.position = 'relative';
    container.style.width = '100%';

    if (aspectRatio && Number.isFinite(aspectRatio)) {
      this.setAspectRatioMetadata(container, aspectRatio);
      container.style.aspectRatio = `${aspectRatio}`;
    }
    container.classList.add(aspectRatioClass);

    return container;
  }

  protected attemptReloadIfUnloaded(): IVideoPlayer | undefined {
    const player = this.getPlayer();
    if (!player?.getIsUnloaded()) return undefined;

    player.reload();
    this.isLoaded = true;
    this.clearLoadErrorTimerOnPlayback(player);
    return player;
  }

  protected clearLoadErrorCheckTimeout(): void {
    if (this.loadErrorCheckTimeoutId) {
      clearTimeout(this.loadErrorCheckTimeoutId);
      this.loadErrorCheckTimeoutId = undefined;
    }
  }

  protected attachLoadErrorHandler(): void {
    const player = this.getPlayer();
    if (!player) {
      return;
    }
    const videoElement = player.getVideoElement();
    if (!videoElement) {
      return;
    }
    this.detachLoadErrorHandler();
    this.loadErrorHandler = () => this.checkForLoadError();
    videoElement.addEventListener('error', this.loadErrorHandler, { once: true });
  }

  protected detachLoadErrorHandler(): void {
    const player = this.getPlayer();
    if (!player || !this.loadErrorHandler) {
      this.loadErrorHandler = undefined;
      return;
    }
    const videoElement = player.getVideoElement();
    if (videoElement) {
      videoElement.removeEventListener('error', this.loadErrorHandler);
    }
    this.loadErrorHandler = undefined;
  }

  protected scheduleLoadErrorCheck(): void {
    if (!this.getPlayer() || this.hasFailedPermanently) {
      return;
    }
    this.clearLoadErrorCheckTimeout();
    this.loadErrorCheckTimeoutId = setTimeout(() => {
      if (!this.getPlayer() || this.hasFailedPermanently) {
        this.clearLoadErrorCheckTimeout();
        return;
      }
      this.checkForLoadError();
    }, 16000);
  }

  protected updateHQButton(button: HTMLElement): void {
    if (this.isHQMode) {
      button.innerHTML = HQ_SVG_FILLED;
      button.style.color = THEME.colors.accentPrimary;
      button.title = 'HD video loaded';
    } else {
      button.innerHTML = HQ_SVG_OUTLINE;
      button.style.color = THEME.colors.textSecondary;
      button.title = this.getHQButtonOffLabel();
    }
  }

  /**
   * Clear the stuck-load error check once the video confirms it is playing.
   * The player reveals its own surface (opacity 0 -> 1 + hide placeholder) on the
   * 'playing' event, so no visual reveal orchestration is needed here.
   */
  protected clearLoadErrorTimerOnPlayback(player: IVideoPlayer): void {
    const videoElement = player.getVideoElement();
    if (!videoElement) return;

    const onReady = () => this.clearLoadErrorCheckTimeout();
    videoElement.addEventListener('playing', onReady, { once: true });
    videoElement.addEventListener('loadeddata', onReady, { once: true });
  }

  protected createMuteOverlayButton(): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'video-post__mute-overlay';
    button.setAttribute('aria-label', 'Toggle mute');

    this.applyIconButtonStyles(button);
    button.style.color = THEME.colors.textPrimary;
    button.style.padding = '0';
    button.style.width = '44px';
    button.style.height = '44px';
    button.style.minWidth = '44px';
    button.style.minHeight = '44px';
    button.style.touchAction = 'manipulation';

    const handleMuteToggle = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (this.onMuteToggle && this.getGlobalMuteState) {
        const currentState = this.getGlobalMuteState();
        this.onMuteToggle(!currentState);
      }
    };

    button.addEventListener('click', handleMuteToggle);

    const isMobile = isMobileDevice();
    if (isMobile) {
      setupTouchHandlers(button, {
        onTap: (e) => {
          handleMuteToggle(e);
        },
        preventDefault: true,
        stopPropagation: true,
        stopImmediatePropagation: true,
      });
      preventClickAfterTouch(button);
    }

    this.muteOverlayButton = button;
    this.updateMuteOverlayButton();

    return button;
  }

  updateMuteOverlayButton(): void {
    const btn = this.muteOverlayButton;
    if (!btn || !this.getGlobalMuteState) return;

    const isMuted = this.getGlobalMuteState();
    if (isMuted) {
      btn.innerHTML = VOLUME_MUTED_SVG;
      btn.setAttribute('aria-label', 'Unmute');
    } else {
      btn.innerHTML = VOLUME_UNMUTED_SVG;
      btn.setAttribute('aria-label', 'Mute');
    }

    // Always active by default; subclasses may override via applyMuteButtonHQState
    btn.style.opacity = '1';
    btn.style.pointerEvents = 'auto';
    this.applyMuteButtonHQState(btn);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected applyMuteButtonHQState(_btn: HTMLElement): void {
    // No-op by default (VideoPost always keeps mute button active)
  }

  protected abstract getHQAriaLabel(): string;
  protected abstract getHQTitle(): string;
  protected abstract performHQUpgrade(): Promise<void>;

  protected createHQButton(): HTMLElement {
    const hqBtn = document.createElement('button');
    hqBtn.className = 'icon-btn icon-btn--hq';
    hqBtn.type = 'button';
    hqBtn.setAttribute('aria-label', this.getHQAriaLabel());
    hqBtn.title = this.getHQTitle();
    this.applyIconButtonStyles(hqBtn);
    hqBtn.style.padding = '0';

    this.updateHQButton(hqBtn);
    this.hqButton = hqBtn;

    const clickHandler = async (e: Event) => {
      e.preventDefault();
      e.stopPropagation();

      if (!this.api || this.isHQMode) return;

      hqBtn.disabled = true;
      hqBtn.style.opacity = '0.5';

      try {
        await this.performHQUpgrade();
        this.isHQMode = true;
        this.updateHQButton(hqBtn);
        this.updateMuteOverlayButton();
      } catch (error) {
        console.error('Failed to load high-quality video', error);
        showToast('Failed to load high-quality video. Please try again.');
      } finally {
        hqBtn.disabled = false;
        hqBtn.style.opacity = '1';
      }
    };

    hqBtn.addEventListener('click', clickHandler);
    this.addHoverEffect(hqBtn);
    return hqBtn;
  }

  public setHQMode(isHQ: boolean): void {
    this.isHQMode = isHQ;
    if (this.hqButton) {
      this.updateHQButton(this.hqButton);
    }
    this.updateMuteOverlayButton();
  }

  isPlayerLoaded(): boolean {
    const player = this.getPlayer();
    if (!this.isLoaded || !player) {
      return false;
    }
    if ('getIsUnloaded' in player && player.getIsUnloaded()) {
      return false;
    }
    return true;
  }

  /**
   * Mount a thin accent-coloured progress bar at the bottom of the player
   * container and wire it to the current player for updates and drag-to-seek.
   * Call after the player is created; call again after an HD upgrade replaces
   * the player so the listeners rebind to the new video element.
   */
  protected setupProgressBar(): void {
    this.destroyProgressBar();

    const playerContainer = this.playerContainer
      ?? this.container.querySelector('.video-post__player') as HTMLElement | null;
    if (!playerContainer) return;

    const player = this.getPlayer();
    if (!player) return;

    // Build DOM.
    const track = document.createElement('div');
    track.className = 'vp-progress__track';
    track.setAttribute('role', 'slider');
    track.setAttribute('aria-label', 'Video progress');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', '0');
    track.setAttribute('tabindex', '0');

    const fill = document.createElement('div');
    fill.className = 'vp-progress__fill';
    track.appendChild(fill);
    playerContainer.appendChild(track);

    // Update fill from player.
    const update = () => {
      const p = this.getPlayer();
      if (!p) return;
      const pct = Math.round(p.getProgress() * 1000) / 10; // 1dp
      fill.style.width = `${pct}%`;
      track.setAttribute('aria-valuenow', String(Math.round(pct)));
    };

    const video = player.getVideoElement();
    video.addEventListener('timeupdate', update);

    // Drag-to-seek via pointer events (works for mouse and touch).
    let dragging = false;

    const ratioFromEvent = (e: PointerEvent): number => {
      const rect = track.getBoundingClientRect();
      return rect.width > 0 ? Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) : 0;
    };

    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      dragging = true;
      track.setPointerCapture(e.pointerId);
      const p = this.getPlayer();
      if (p) {
        const ratio = ratioFromEvent(e);
        p.seekToProgress(ratio);
        fill.style.width = `${ratio * 100}%`;
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      e.preventDefault();
      const p = this.getPlayer();
      if (p) {
        const ratio = ratioFromEvent(e);
        p.seekToProgress(ratio);
        fill.style.width = `${ratio * 100}%`;
      }
    };

    const onUp = () => { dragging = false; };

    track.addEventListener('pointerdown', onDown);
    track.addEventListener('pointermove', onMove);
    track.addEventListener('pointerup', onUp);
    track.addEventListener('pointercancel', onUp);

    // Keyboard seek: left/right arrow ±5 %.
    track.addEventListener('keydown', (e: KeyboardEvent) => {
      const p = this.getPlayer();
      if (!p) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const delta = e.key === 'ArrowRight' ? 0.05 : -0.05;
        p.seekToProgress(Math.max(0, Math.min(1, p.getProgress() + delta)));
      }
    });

    this.progressBar = {
      track,
      fill,
      cleanup: () => {
        video.removeEventListener('timeupdate', update);
        track.remove();
      },
    };
  }

  private destroyProgressBar(): void {
    this.progressBar?.cleanup();
    this.progressBar = undefined;
  }

  override destroy(): void {
    this.destroyProgressBar();
    super.destroy();
  }
}
