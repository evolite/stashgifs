/**
 * VideoPostBase
 * Abstract base class for video-capable post components (VideoPost and ImageVideoPost).
 * Extracts shared NativeVideoPlayer management logic to reduce code duplication.
 */

import { NativeVideoPlayer } from './NativeVideoPlayer.js';
import { isMobileDevice, THEME } from './utils.js';
import { HQ_SVG_OUTLINE, HQ_SVG_FILLED, VOLUME_MUTED_SVG, VOLUME_UNMUTED_SVG } from './icons.js';
import { BasePost } from './BasePost.js';
import { FavoritesManager } from './FavoritesManager.js';
import { StashAPI } from './StashAPI.js';
import { VisibilityManager } from './VisibilityManager.js';
import { setupTouchHandlers, preventClickAfterTouch } from './utils/touchHandlers.js';

export abstract class VideoPostBase extends BasePost {
  protected isHQMode: boolean = false;
  protected loadErrorCount: number = 0;
  protected muteOverlayButton?: HTMLElement;
  protected onMuteToggle?: (isMuted: boolean) => void;
  protected getGlobalMuteState?: () => boolean;
  protected hasFailedPermanently: boolean = false;
  protected errorPlaceholder?: HTMLElement;
  protected retryTimeoutId?: number;
  protected loadErrorCheckTimeoutId?: ReturnType<typeof setTimeout>;
  protected loadErrorHandler?: () => void;
  protected posterLayer?: HTMLElement;
  protected hasRenderedVideo: boolean = false;
  protected videoLoadingIndicator?: HTMLElement;

  constructor(
    container: HTMLElement,
    favoritesManager?: FavoritesManager,
    api?: StashAPI,
    visibilityManager?: VisibilityManager,
    onPerformerChipClick?: (performerId: number, performerName: string) => void,
    onTagChipClick?: (tagId: number, tagName: string) => void,
    showVerifiedCheckmarks?: boolean
  ) {
    super(container, favoritesManager, api, visibilityManager, onPerformerChipClick, onTagChipClick, showVerifiedCheckmarks);
  }

  protected abstract getPlayer(): NativeVideoPlayer | undefined;
  protected abstract checkForLoadError(): void;
  protected abstract getEntityLogId(): string;
  protected abstract getHQButtonOffLabel(): string;

  protected clearLoadErrorCheckTimeout(): void {
    if (this.loadErrorCheckTimeoutId) {
      clearTimeout(this.loadErrorCheckTimeoutId);
      this.loadErrorCheckTimeoutId = undefined;
    }
  }

  protected showPosterLayer(): void {
    if (!this.posterLayer) {
      return;
    }
    if (this.hasRenderedVideo) {
      return;
    }
    this.posterLayer.style.opacity = '1';
  }

  protected hidePosterLayer(): void {
    if (!this.posterLayer) {
      return;
    }
    this.posterLayer.style.opacity = '0';
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
    const isMobile = isMobileDevice();
    const delay = isMobile ? 20000 : 16000;
    this.loadErrorCheckTimeoutId = setTimeout(() => {
      if (!this.getPlayer() || this.hasFailedPermanently) {
        this.clearLoadErrorCheckTimeout();
        return;
      }
      this.checkForLoadError();
    }, delay);
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

  protected hideMediaWhenReady(player: NativeVideoPlayer, container: HTMLElement): void {
    const loading = container.querySelector<HTMLElement>('.video-post__loading');

    const hideVisuals = () => {
      if (loading) {
        loading.style.display = 'none';
        if (this.videoLoadingIndicator) {
          this.videoLoadingIndicator = undefined;
        }
      }
      this.hidePosterLayer();
    };

    const scheduleTimeout = globalThis.window?.setTimeout.bind(globalThis.window) ?? setTimeout;
    const clearScheduledTimeout = globalThis.window?.clearTimeout.bind(globalThis.window) ?? clearTimeout;
    const requestFrame = globalThis.window?.requestAnimationFrame?.bind(globalThis.window) ?? ((cb: FrameRequestCallback) => setTimeout(cb, 16));

    const videoElement = player.getVideoElement();
    if (!videoElement) return;

    let revealed = false;

    const cleanup = () => {
      videoElement.removeEventListener('loadeddata', onLoadedData);
      videoElement.removeEventListener('playing', onPlaying);
      videoElement.removeEventListener('timeupdate', onTimeUpdate);
      clearScheduledTimeout(fallbackHandle);
    };

    const reveal = () => {
      if (revealed) {
        return;
      }
      revealed = true;
      cleanup();
      this.clearLoadErrorCheckTimeout();
      const performHide = () => hideVisuals();
      requestFrame(() => requestFrame(() => performHide()));
      this.hasRenderedVideo = true;
    };

    const onLoadedData = () => reveal();
    const onPlaying = () => reveal();
    const onTimeUpdate = () => {
      if (videoElement.currentTime > 0 || videoElement.readyState >= 2) {
        reveal();
      }
    };

    videoElement.addEventListener('loadeddata', onLoadedData, { once: true });
    videoElement.addEventListener('playing', onPlaying, { once: true });
    videoElement.addEventListener('timeupdate', onTimeUpdate);

    const fallbackHandle = scheduleTimeout(() => reveal(), 6000);

    player.waitForReady(4000)
      .catch((error) => {
        console.warn('VideoPostBase: Player ready wait timed out', {
          error,
          entityId: this.getEntityLogId(),
        });
      })
      .finally(() => {
        if (videoElement.readyState >= 2) {
          reveal();
        }
      });
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
}
