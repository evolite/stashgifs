/**
 * VideoPostBase
 * Abstract base class for video-capable post components (VideoPost and ImageVideoPost).
 * Extracts shared video-player management logic to reduce code duplication.
 */

import type { IVideoPlayer, VideoSource } from './types.js';
import { VideoJsPlayer } from './VideoJsPlayer.js';
import { isMobileDevice, THEME, showToast, createCoverDiv } from './utils.js';
import { HQ_SVG_OUTLINE, HQ_SVG_FILLED, VOLUME_MUTED_SVG, VOLUME_UNMUTED_SVG } from './icons.js';
import { BasePost, BasePostOptions } from './BasePost.js';
import { setupTouchHandlers, preventClickAfterTouch } from './utils/touchHandlers.js';

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
  protected hqButton?: HTMLElement;
  protected muteOverlayButton?: HTMLElement;
  protected onMuteToggle?: (isMuted: boolean) => void;
  protected getGlobalMuteState?: () => boolean;
  protected hasFailedPermanently: boolean = false;
  protected errorPlaceholder?: HTMLElement;
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
  protected abstract getHQButtonOffLabel(): string;

  protected getAutoAdvancePlayer(): IVideoPlayer | undefined {
    return this.getPlayer();
  }

  /**
   * Single construction point for every video player across both post types and
   * both quality tiers. The call sites only resolve what varies (url, muted,
   * clip window, candidate sources); the shared config lives here.
   *
   * Players are always created paused: ReelPlaybackController is the sole driver
   * of playback (it plays the active card and warms — but does not play — the
   * preloaded next card). Autoplaying a neighbour offscreen would buffer-compete
   * and trigger false view counts.
   */
  protected createVideoPlayer(
    container: HTMLElement,
    videoUrl: string,
    opts: { muted: boolean; startTime?: number; endTime?: number; sources?: VideoSource[] }
  ): VideoJsPlayer {
    return new VideoJsPlayer(container, videoUrl, {
      muted: opts.muted,
      autoplay: false,
      startTime: opts.startTime,
      endTime: opts.endTime,
      showLoadingIndicator: false,
      objectFit: 'contain',
      sources: opts.sources && opts.sources.length > 0 ? opts.sources : undefined,
    });
  }

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

    // Toggle deliberate play/pause. Ignore events that land on a child control
    // (buttons, the progress bar, etc.) — those own their own handling.
    const togglePlayback = (target: EventTarget | null): void => {
      if (target !== container && (target as HTMLElement | null)?.closest('button, [role="slider"]')) return;
      const player = this.getPlayer();
      if (!player) return;
      if (player.isPlaying()) {
        player.pauseManually();
      } else {
        player.clearManualPause();
        player.play()?.catch(() => {});
      }
    };

    if (isMobileDevice()) {
      // On touch, route through the tap arbiter: setupTouchHandlers only fires
      // onTap when movement <15px and duration <250ms and the touch wasn't a
      // scroll — so the tail of a reel swipe can never register as a tap-to-pause.
      // A raw `click` here would be hit by the browser's synthetic ghost-click
      // ~300ms after a swipe's touchend and pause the freshly-autoplayed card.
      this.touchCleanups.push(
        setupTouchHandlers(container, {
          onTap: (e) => togglePlayback(e.target),
        })
      );
      // Belt-and-suspenders: swallow the ghost click after any touch on the player.
      this.touchCleanups.push(preventClickAfterTouch(container));
    } else {
      container.addEventListener('click', (e: MouseEvent) => togglePlayback(e.target));
    }

    return container;
  }

  protected attemptReloadIfUnloaded(): IVideoPlayer | undefined {
    const player = this.getPlayer();
    if (!player?.getIsUnloaded()) return undefined;

    player.reload();
    this.isLoaded = true;
    return player;
  }

  /**
   * Listen for media errors on the current player. VideoJsPlayer retries through
   * its candidate sources (codec/transcode/HLS) on its own; this only surfaces a
   * failure once every source is spent — see handlePlayerError().
   */
  protected attachLoadErrorHandler(): void {
    const videoElement = this.getPlayer()?.getVideoElement();
    if (!videoElement) return;
    this.detachLoadErrorHandler();
    this.loadErrorHandler = () => this.handlePlayerError();
    videoElement.addEventListener('error', this.loadErrorHandler);
  }

  protected detachLoadErrorHandler(): void {
    if (this.loadErrorHandler) {
      this.getPlayer()?.getVideoElement()?.removeEventListener('error', this.loadErrorHandler);
      this.loadErrorHandler = undefined;
    }
  }

  /**
   * Show the failure placeholder once the player has exhausted all sources.
   * Deferred so VideoJsPlayer's own 'error' handler can advance to the next
   * candidate source first; intermediate source switches must not surface.
   */
  protected handlePlayerError(): void {
    setTimeout(() => {
      const player = this.getPlayer();
      if (!player || !player.hasLoadError()) return;
      this.hasFailedPermanently = true;
      this.showErrorPlaceholder();
    }, 50);
  }

  /** Cover the player with a "Failed to load" placeholder. Shared by subclasses. */
  protected showErrorPlaceholder(): void {
    if (this.errorPlaceholder) return;
    const playerContainer = this.playerContainer
      ?? this.container.querySelector('.video-post__player') as HTMLElement | null;
    if (!playerContainer) return;

    const placeholder = createCoverDiv('video-post__error-placeholder');
    placeholder.style.display = 'flex';
    placeholder.style.alignItems = 'center';
    placeholder.style.justifyContent = 'center';
    placeholder.style.backgroundColor = THEME.colors.backgroundSecondary;
    placeholder.style.color = THEME.colors.textPrimary;
    placeholder.textContent = 'Failed to load';
    playerContainer.appendChild(placeholder);
    this.errorPlaceholder = placeholder;
  }

  protected hideErrorPlaceholder(): void {
    this.errorPlaceholder?.remove();
    this.errorPlaceholder = undefined;
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

    // Bind to the player abstraction, not the raw <video> element: video.js
    // recreates the element on unload/reload, which would freeze an element-bound
    // listener after scrolling away and back. The player instance persists.
    player.onTimeUpdate(update);
    update(); // paint current progress immediately, don't wait for the first event

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
        player.offTimeUpdate();
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
    this.detachLoadErrorHandler();
    this.hideErrorPlaceholder();
    super.destroy();
  }
}
