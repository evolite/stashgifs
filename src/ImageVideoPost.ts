/**
 * Image Video Post Component
 * MP4/M4V images displayed as videos with preview/HD upgrade capability
 */

import { ImageVideoPostData, IVideoPlayer } from './types.js';
import { calculateAspectRatio, getAspectRatioClass, normalizeMediaUrl, toAbsoluteUrl } from './utils.js';
import { VideoPostBase, BaseVideoPostOptions } from './VideoPostBase.js';
interface ImageVideoPostOptions extends BaseVideoPostOptions {}

export class ImageVideoPost extends VideoPostBase {
  protected readonly data: ImageVideoPostData;
  private player?: IVideoPlayer;
  private readonly onCancelRequests?: () => void;

  constructor(
    container: HTMLElement,
    data: ImageVideoPostData,
    options?: ImageVideoPostOptions
  ) {
    super(container, options);
    this.data = data;
    this.onCancelRequests = options?.onCancelRequests;
    this.onMuteToggle = options?.onMuteToggle;
    this.getGlobalMuteState = options?.getGlobalMuteState;
    this.hdModeFromSettings = options?.hdModeFromSettings === true;
    this.initImagePostOptions(this.data.image.o_counter, options?.ratingSystemConfig, options?.reelMode);
    this.render();
  }

  /**
   * Render the complete image video post structure
   */
  private render(): void {
    this.renderImageBasedPost('video-post', this.data.image.id, () => this.createPlayerContainer(), () => this.createFooter());
  }

  /**
   * Create the player container with loading indicator
   */
  private createPlayerContainer(): HTMLElement {
    let aspectRatio: number | undefined;
    let aspectRatioClass = 'aspect-16-9';
    if (this.data.image.width && this.data.image.height && this.data.image.height > 0) {
      aspectRatio = calculateAspectRatio(this.data.image.width, this.data.image.height);
      aspectRatioClass = getAspectRatioClass(aspectRatio);
    } else if (this.data.aspectRatio && Number.isFinite(this.data.aspectRatio)) {
      aspectRatio = this.data.aspectRatio;
      if (aspectRatio !== undefined) {
        aspectRatioClass = getAspectRatioClass(aspectRatio);
      }
    }

    return this.createVideoPlayerContainer(aspectRatio, aspectRatioClass);
  }

  /**
   * Create footer with action buttons
   */
  private createFooter(): HTMLElement {
    const { footer, buttonGroup } = this.buildFooterContainer();
    this.buttonGroup = buttonGroup;

    this.appendCommonImageFooterButtons(buttonGroup, this.data.image.id);

    // HQ button (upgrade to HD)
    if (this.api && !this.isHQMode && !this.hdModeFromSettings) {
      this.hqButton = this.createHQButton();
      buttonGroup.appendChild(this.hqButton);
    }

    // Mute button (always show, but grayed out in non-HD mode)
    const muteBtn = this.createMuteOverlayButton();
    buttonGroup.appendChild(muteBtn);

    const discoveryBtn = this.createDiscoveryButton();
    if (discoveryBtn) buttonGroup.appendChild(discoveryBtn);

    // Image button (open in Stash)
    const imageBtn = this.createImageButton(this.data.image.id);
    buttonGroup.appendChild(imageBtn);

    return footer;
  }

  protected getHQAriaLabel(): string {
    return 'Load high-quality video with audio';
  }

  protected getHQTitle(): string {
    return 'Load HD video';
  }

  protected async performHQUpgrade(): Promise<void> {
    await this.upgradeToHDVideo();
  }

  /**
   * Programmatically set HQ mode — also applies mute state to the player
   */
  public override setHQMode(isHQ: boolean): void {
    super.setHQMode(isHQ);
    if (this.player && this.getGlobalMuteState) {
      const shouldBeMuted = this.getGlobalMuteState();
      this.player.setMuted(shouldBeMuted);
    }
  }

  /**
   * Upgrade from preview video to full HD video with audio
   */
  private async upgradeToHDVideo(): Promise<void> {
    if (!this.api) {
      throw new Error('API not available');
    }

    // Get full video URL (paths.image)
    const imagePath = this.data.image.paths?.image;
    if (!imagePath) {
      throw new Error('Image video URL not available');
    }
    const resolvedVideoUrl = imagePath.startsWith('http') 
      ? imagePath 
      : toAbsoluteUrl(imagePath);
    const hdVideoUrl = normalizeMediaUrl(resolvedVideoUrl);
    
    if (!hdVideoUrl) {
      throw new Error('Image video URL not available');
    }

    const { playerContainer } = this.capturePlayerState();

    // Unload and destroy current player
    this.destroyCurrentPlayer();

    // Clean up any leftover player elements
    this.cleanupPlayerElements(playerContainer);

    // Create new player with full HD video
    await this.createHDVideoPlayer(playerContainer, hdVideoUrl);

    // The playback controller plays the active card via onPlayerReady.
    this.notifyPlayerReady();
  }

  /**
   * Create HD video player
   */
  private async createHDVideoPlayer(playerContainer: HTMLElement, hdVideoUrl: string): Promise<void> {
    try {
      // Respect global mute state when creating HD player
      const shouldBeMuted = this.getGlobalMuteState ? this.getGlobalMuteState() : true;
      this.player = this.createVideoPlayer(playerContainer, hdVideoUrl, {
        muted: shouldBeMuted,
        startTime: undefined, // Start from beginning for images
        endTime: undefined,
      });

      this.isLoaded = true;
      this.attachLoadErrorHandler();
      this.attachReelAutoAdvance();
      this.setupProgressBar();
    } catch (error) {
      console.error('ImageVideoPost: Failed to create HD video player', {
        error,
        hdVideoUrl,
        imageId: this.data.image.id,
      });
      throw error;
    }
  }

  /**
   * Notify the playback controller that the player was (re)created after an upgrade.
   */
  private notifyPlayerReady(): void {
    if (this.data.image.id && this.player) {
      this.onPlayerReady?.(this.data.image.id);
    }
  }

  /**
   * Destroy current player
   */
  private destroyCurrentPlayer(): void {
    if (this.player) {
      this.detachLoadErrorHandler();
      this.player.destroy();
      this.player = undefined;
    }
    this.isLoaded = false;
  }

  /**
   * Clean up player elements from container
   */
  private cleanupPlayerElements(container: HTMLElement): void {
    const videoElements = container.querySelectorAll('video');
    for (const video of videoElements) {
      video.remove();
    }
  }

  /**
   * Load the video player
   */
  loadPlayer(videoUrl: string): IVideoPlayer | undefined {
    if (this.isLoaded) {
      return this.player;
    }

    if (!this.playerContainer) {
      console.error('ImageVideoPost: Player container not found');
      return undefined;
    }

    try {
      // For non-HD videos, don't pass startTime (allows browser to show first frame naturally)
      const finalStartTime = undefined;

      // Respect global mute state when creating player
      // For non-HD videos, always muted (preview videos don't have audio)
      // For HD videos, respect global mute state
      const shouldBeMuted = this.isHQMode && this.getGlobalMuteState
        ? this.getGlobalMuteState()
        : true;
      this.player = this.createVideoPlayer(this.playerContainer, videoUrl, {
        muted: shouldBeMuted,
        startTime: finalStartTime,
        endTime: undefined,
      });

      this.isLoaded = true;
      this.attachLoadErrorHandler();
      this.attachReelAutoAdvance();
      this.setupProgressBar();

    } catch (error) {
      console.error('ImageVideoPost: Failed to create video player', {
        error,
        videoUrl,
        imageId: this.data.image.id,
      });
      return undefined;
    }

    return this.player;
  }

  /**
   * Gray out mute button when not in HQ mode (image videos don't have audio in preview)
   */
  protected applyMuteButtonHQState(btn: HTMLElement): void {
    if (this.isHQMode) {
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
    } else {
      btn.style.opacity = '0.4';
      btn.style.pointerEvents = 'none';
    }
  }

  /**
   * Get the player instance
   */
  getPlayer(): IVideoPlayer | undefined {
    return this.player;
  }

  protected getHQButtonOffLabel(): string {
    return 'Load HD video';
  }

  /**
   * Return true if video source is available
   */
  hasVideoSource(): boolean {
    return !!this.data.videoUrl;
  }

  /**
   * Preload player using video URL
   */
  preload(): IVideoPlayer | undefined {
    const videoUrl = this.data.videoUrl;
    if (!videoUrl) {
      return undefined;
    }
    const reloaded = this.attemptReloadIfUnloaded();
    if (reloaded) {
      this.attachReelAutoAdvance();
      return reloaded;
    }

    return this.loadPlayer(videoUrl);
  }

  /**
   * Get the post ID
   */
  getPostId(): string {
    return this.data.image.id;
  }

  /**
   * Get the container element
   */
  getContainer(): HTMLElement {
    return this.container;
  }

  /**
   * Hide the post (used when player creation fails)
   */
  hidePost(): void {
    if (this.container) {
      this.container.style.display = 'none';
    }
  }

  /**
   * Destroy the post
   */
  destroy(): void {
    this.cleanupAddTagDialogState();

    if (this.player) {
      this.player.destroy();
      this.player = undefined;
    }
    this.isLoaded = false;

    // Base destroy() detaches the load-error handler and removes the placeholder.
    super.destroy();
    this.container?.remove();
  }
}
