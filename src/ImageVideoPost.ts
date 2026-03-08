/**
 * Image Video Post Component
 * MP4/M4V images displayed as videos with preview/HD upgrade capability
 */

import { ImageVideoPostData } from './types.js';
import { NativeVideoPlayer } from './NativeVideoPlayer.js';
import { FavoritesManager } from './FavoritesManager.js';
import { StashAPI } from './StashAPI.js';
import { VisibilityManager } from './VisibilityManager.js';
import { calculateAspectRatio, getAspectRatioClass, normalizeMediaUrl, toAbsoluteUrl, THEME } from './utils.js';
import { VideoPostBase } from './VideoPostBase.js';
interface ImageVideoPostOptions {
  onMuteToggle?: (isMuted: boolean) => void;
  getGlobalMuteState?: () => boolean;
  favoritesManager?: FavoritesManager;
  api?: StashAPI;
  visibilityManager?: VisibilityManager;
  onPerformerChipClick?: (performerId: number, performerName: string) => void;
  onTagChipClick?: (tagId: number, tagName: string) => void;
  showVerifiedCheckmarks?: boolean;
  onCancelRequests?: () => void;
  ratingSystemConfig?: { type?: string; starPrecision?: string } | null;
  reelMode?: boolean;
}

export class ImageVideoPost extends VideoPostBase {
  protected readonly data: ImageVideoPostData;
  private player?: NativeVideoPlayer;
  private readonly onCancelRequests?: () => void;

  private playerContainer?: HTMLElement;
  private footer?: HTMLElement;

  constructor(
    container: HTMLElement,
    data: ImageVideoPostData,
    options?: ImageVideoPostOptions
  ) {
    super(
      container,
      options?.favoritesManager,
      options?.api,
      options?.visibilityManager,
      options?.onPerformerChipClick,
      options?.onTagChipClick,
      options?.showVerifiedCheckmarks
    );
    this.data = data;
    this.oCount = this.data.image.o_counter || 0;
    this.onCancelRequests = options?.onCancelRequests;
    this.onMuteToggle = options?.onMuteToggle;
    this.getGlobalMuteState = options?.getGlobalMuteState;
    this.ratingSystemConfig = options?.ratingSystemConfig;
    this.isReelMode = options?.reelMode === true;

    this.render();
  }

  /**
   * Initialize asynchronous operations after construction
   */
  public async initialize(): Promise<void> {
    await this.checkFavoriteStatus();
  }

  /**
   * Render the complete image video post structure
   */
  private render(): void {
    const { header, playerContainer, footer } = this.renderBasePost({
      className: 'video-post',
      postId: this.data.image.id,
      createHeader: () => this.createHeader(),
      createPlayerContainer: () => this.createPlayerContainer(),
      createFooter: () => this.createFooter()
    });
    this.playerContainer = playerContainer;
    this.footer = footer;

    if (this.isReelMode) {
      this.applyReelModeLayout({ header, playerContainer, footer });
    }
  }

  /**
   * Create the player container with loading indicator
   */
  private createPlayerContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'video-post__player';
    container.style.position = 'relative';
    container.style.width = '100%';

    // Calculate aspect ratio from image dimensions
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

    if (aspectRatio && Number.isFinite(aspectRatio)) {
      this.setAspectRatioMetadata(container, aspectRatio);
    }
    
    // Use inline aspectRatio style for better browser compatibility
    if (aspectRatio && Number.isFinite(aspectRatio)) {
      container.style.aspectRatio = `${aspectRatio}`;
    }
    // Always add CSS class as fallback for older browsers
    container.classList.add(aspectRatioClass);

    // Poster layer (preview) to prevent black flashes
    this.appendPosterLayer(container, this.isReelMode ? this.getPosterUrl() : undefined);

    // Loading indicator for video
    const loading = document.createElement('div');
    loading.className = 'video-post__loading';
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    loading.appendChild(spinner);
    loading.style.display = this.isLoaded ? 'none' : 'flex';
    loading.style.zIndex = '3';
    container.appendChild(loading);
    this.videoLoadingIndicator = loading;

    return container;
  }

  /**
   * Create footer with action buttons
   */
  private createFooter(): HTMLElement {
    const { footer, buttonGroup } = this.buildFooterContainer();
    this.buttonGroup = buttonGroup;

    // Heart button (favorite)
    if (this.favoritesManager) {
      this.heartButton = this.createHeartButton();
      buttonGroup.appendChild(this.heartButton);
    }

    // Add tag button
    if (this.api) {
      this.addTagButton = this.createAddTagButton('Add tag to image');
      buttonGroup.appendChild(this.addTagButton);
    }

    // O-count button
    if (this.api) {
      this.oCountButton = this.createOCountButton();
      buttonGroup.appendChild(this.oCountButton);
    }

    // Rating control
    const ratingControl = this.createRatingSection();
    buttonGroup.appendChild(ratingControl);

    // HQ button (upgrade to HD)
    if (this.api && !this.isHQMode) {
      this.hqButton = this.createHQButton();
      buttonGroup.appendChild(this.hqButton);
    }

    // Mute button (always show, but grayed out in non-HD mode)
    const muteBtn = this.createMuteOverlayButton();
    buttonGroup.appendChild(muteBtn);

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

    const playerContainer = this.playerContainer || this.container.querySelector('.video-post__player') as HTMLElement;
    if (!playerContainer) {
      throw new Error('Player container not found');
    }

    // Capture current playback state
    const playerState = this.player?.getState();
    const wasPlaying = playerState?.isPlaying ?? false;

    // Unload and destroy current player
    await this.destroyCurrentPlayer();

    // Clean up any leftover player elements
    this.cleanupPlayerElements(playerContainer);

    // Small delay to ensure DOM is cleared
    await new Promise(resolve => setTimeout(resolve, 50));

    // Create new player with full HD video
    await this.createHDVideoPlayer(playerContainer, hdVideoUrl);

    // Register with visibility manager if available
    await this.registerUpgradedPlayerWithVisibilityManager();

    // If video was playing, resume playback
    if (wasPlaying) {
      await this.resumePlaybackAfterUpgrade();
    }
  }

  /**
   * Create HD video player
   */
  private async createHDVideoPlayer(playerContainer: HTMLElement, hdVideoUrl: string): Promise<void> {
    try {
      this.hasRenderedVideo = false;
      // Respect global mute state when creating HD player
      const shouldBeMuted = this.getGlobalMuteState ? this.getGlobalMuteState() : true;
      this.player = new NativeVideoPlayer(playerContainer, hdVideoUrl, {
        muted: shouldBeMuted,
        autoplay: false,
        startTime: undefined, // Start from beginning for images
        endTime: undefined,
        aggressivePreload: false,
        isHDMode: true,
        posterUrl: this.getPosterUrl(),
        showLoadingIndicator: false,
      });

      this.isLoaded = true;
      this.hideMediaWhenReady(this.player, playerContainer);
      this.scheduleLoadErrorCheck();
      this.attachLoadErrorHandler();
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
   * Register player with visibility manager after upgrade
   */
  private async registerUpgradedPlayerWithVisibilityManager(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 50));
    if (this.visibilityManager && this.data.image.id && this.player) {
      this.visibilityManager.registerPlayer(this.data.image.id, this.player);
    }
  }

  /**
   * Resume playback after upgrade
   */
  private async resumePlaybackAfterUpgrade(): Promise<void> {
    if (!this.player) return;
    try {
      await this.player.play();
    } catch (error) {
      console.warn('ImageVideoPost: Failed to resume playback after upgrade', error);
    }
  }

  /**
   * Destroy current player
   */
  private async destroyCurrentPlayer(): Promise<void> {
    if (this.player) {
      this.clearLoadErrorCheckTimeout();
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
   * Get poster URL for the video
   */
  private getPosterUrl(): string | undefined {
    // Use image thumbnail or preview as fallback
    const thumbnail = this.data.image.paths?.thumbnail;
    if (thumbnail) {
      const baseUrl = toAbsoluteUrl(thumbnail);
      if (baseUrl) {
        const separator = baseUrl.includes('?') ? '&' : '?';
        return `${baseUrl}${separator}t=${Date.now()}`;
      }
    }
    // Fallback to preview if thumbnail unavailable
    const preview = this.data.image.paths?.preview;
    if (preview) {
      const baseUrl = toAbsoluteUrl(preview);
      if (baseUrl) {
        const separator = baseUrl.includes('?') ? '&' : '?';
        return `${baseUrl}${separator}t=${Date.now()}`;
      }
    }
    return undefined;
  }

  /**
   * Load the video player
   */
  loadPlayer(videoUrl: string): NativeVideoPlayer | undefined {
    if (this.isLoaded) {
      return this.player;
    }

    if (!this.playerContainer) {
      console.error('ImageVideoPost: Player container not found');
      return undefined;
    }

    try {
      this.hasRenderedVideo = false;
      // For non-HD videos, don't pass startTime (allows browser to show first frame naturally)
      const finalStartTime = undefined;
      
      // Respect global mute state when creating player
      // For non-HD videos, always muted (preview videos don't have audio)
      // For HD videos, respect global mute state
      const shouldBeMuted = this.isHQMode && this.getGlobalMuteState 
        ? this.getGlobalMuteState() 
        : true;
      this.player = new NativeVideoPlayer(this.playerContainer, videoUrl, {
        muted: shouldBeMuted,
        autoplay: false,
        startTime: finalStartTime,
        endTime: undefined,
        posterUrl: this.getPosterUrl(),
        showLoadingIndicator: false,
      });

      this.isLoaded = true;
      this.hideMediaWhenReady(this.player, this.playerContainer);

      this.scheduleLoadErrorCheck();
      this.attachLoadErrorHandler();

      if (this.visibilityManager && this.data.image.id) {
        this.visibilityManager.registerPlayer(this.data.image.id, this.player);
      }

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
   * Check for load errors
   */
  protected checkForLoadError(): void {
    if (!this.player) return;
    
    const videoElement = this.player.getVideoElement();
    if (!videoElement) return;

    if (videoElement.error) {
      this.loadErrorCount += 1;
      this.hasFailedPermanently = true;
      this.showErrorPlaceholder();
      console.warn('ImageVideoPost: Video failed to load, showing placeholder', {
        imageId: this.data.image.id,
        error: videoElement.error?.message,
      });
    }
  }

  /**
   * Show error placeholder
   */
  private showErrorPlaceholder(): void {
    if (this.errorPlaceholder || !this.playerContainer) return;

    const placeholder = document.createElement('div');
    placeholder.className = 'video-post__error-placeholder';
    placeholder.style.position = 'absolute';
    placeholder.style.top = '0';
    placeholder.style.left = '0';
    placeholder.style.width = '100%';
    placeholder.style.height = '100%';
    placeholder.style.display = 'flex';
    placeholder.style.alignItems = 'center';
    placeholder.style.justifyContent = 'center';
    placeholder.style.backgroundColor = THEME.colors.backgroundSecondary;
    placeholder.style.color = THEME.colors.textPrimary;
    placeholder.textContent = 'Failed to load video';
    this.playerContainer.appendChild(placeholder);
    this.errorPlaceholder = placeholder;
  }

  /**
   * Perform O-count increment action for ImageVideoPost
   */
  protected async incrementOCountAction(): Promise<void> {
    if (!this.api) {
      throw new Error('API not available');
    }
    const newOCount = await this.api.incrementImageOCount(this.data.image.id);
    this.oCount = newOCount;
    this.data.image.o_counter = newOCount;
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
  getPlayer(): NativeVideoPlayer | undefined {
    return this.player;
  }

  protected getEntityLogId(): string {
    return this.data.image.id;
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
  preload(): NativeVideoPlayer | undefined {
    const videoUrl = this.data.videoUrl;
    if (!videoUrl) {
      return undefined;
    }
    if (this.player?.getIsUnloaded()) {
      this.player.reload();
      this.isLoaded = true;
      this.hasRenderedVideo = false;
      this.showPosterLayer();
      const container = this.playerContainer || this.container.querySelector<HTMLElement>('.video-post__player');
      if (container) {
        this.hideMediaWhenReady(this.player, container);
      }
      return this.player;
    }
    this.showPosterLayer();
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
    // Close dialogs if open
    if (this.addTagDialogState.isOpen) {
      this.closeAddTagDialogBase({ state: this.addTagDialogState });
    }

    // Clean up timers
    this.clearLoadErrorCheckTimeout();
    this.detachLoadErrorHandler();
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
      this.retryTimeoutId = undefined;
    }

    if (this.addTagDialogState.autocompleteDebounceTimer) {
      clearTimeout(this.addTagDialogState.autocompleteDebounceTimer);
      this.addTagDialogState.autocompleteDebounceTimer = undefined;
    }
    if (this.addTagDialogState.tagSearchLoadingTimer) {
      clearTimeout(this.addTagDialogState.tagSearchLoadingTimer);
      this.addTagDialogState.tagSearchLoadingTimer = undefined;
    }

    if (this.player) {
      this.player.destroy();
      this.player = undefined;
    }
    this.isLoaded = false;
    
    super.destroy();
    // Remove the entire container from the DOM
    this.container?.remove();
  }
}
