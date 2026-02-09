/**
 * Image Video Post Component
 * MP4/M4V images displayed as videos with preview/HD upgrade capability
 */

import { ImageVideoPostData } from './types.js';
import { NativeVideoPlayer } from './NativeVideoPlayer.js';
import { FavoritesManager } from './FavoritesManager.js';
import { StashAPI } from './StashAPI.js';
import { VisibilityManager } from './VisibilityManager.js';
import { calculateAspectRatio, getAspectRatioClass, normalizeMediaUrl, showToast, toAbsoluteUrl, isMobileDevice, THEME } from './utils.js';
import { HQ_SVG_OUTLINE, HQ_SVG_FILLED, VOLUME_MUTED_SVG, VOLUME_UNMUTED_SVG } from './icons.js';
import { BasePost } from './BasePost.js';
import type { AddTagDialogState } from './BasePost.js';
import { setupTouchHandlers, preventClickAfterTouch } from './utils/touchHandlers.js';
import { RatingControl } from './RatingControl.js';

// Constants
const FAVORITE_TAG_NAME = 'StashGifs Favorite';
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

export class ImageVideoPost extends BasePost {
  protected readonly data: ImageVideoPostData;
  private player?: NativeVideoPlayer;
  private isLoaded: boolean = false;
  private hqButton?: HTMLElement;
  private isHQMode: boolean = false;
  private videoLoadingIndicator?: HTMLElement;
  private loadErrorCount: number = 0;
  private hasFailedPermanently: boolean = false;
  private errorPlaceholder?: HTMLElement;
  private retryTimeoutId?: number;
  private loadErrorCheckTimeoutId?: ReturnType<typeof setTimeout>;
  private loadErrorHandler?: () => void;
  private posterLayer?: HTMLElement;
  private hasRenderedVideo: boolean = false;
  
  private readonly onCancelRequests?: () => void;
  private readonly onMuteToggle?: (isMuted: boolean) => void;
  private readonly getGlobalMuteState?: () => boolean;
  
  private playerContainer?: HTMLElement;
  private footer?: HTMLElement;
  private buttonGroup?: HTMLElement;
  private muteOverlayButton?: HTMLElement;
  
  // Add tag dialog state
  private readonly addTagDialogState: AddTagDialogState = { isOpen: false };
  
  private readonly ratingSystemConfig?: { type?: string; starPrecision?: string } | null;
  private ratingControl?: RatingControl;

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
   * Create header with performer and tag chips
   */
  private createHeader(): HTMLElement {
    return this.buildImageHeader({
      performers: this.data.image.performers,
      tags: this.data.image.tags,
      favoriteTagName: FAVORITE_TAG_NAME
    });
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
    const posterUrl = this.isReelMode ? this.getPosterUrl() : undefined;
    if (posterUrl) {
      const posterLayer = document.createElement('div');
      posterLayer.className = 'video-post__poster';
      posterLayer.style.position = 'absolute';
      posterLayer.style.inset = '0';
      posterLayer.style.backgroundImage = `url("${posterUrl}")`;
      posterLayer.style.backgroundColor = THEME.colors.backgroundSecondary;
      posterLayer.style.backgroundSize = 'cover';
      posterLayer.style.backgroundPosition = 'center';
      posterLayer.style.backgroundRepeat = 'no-repeat';
      posterLayer.style.opacity = '1';
      posterLayer.style.transition = 'opacity 220ms ease';
      posterLayer.style.zIndex = '2';
      posterLayer.style.pointerEvents = 'none';
      container.appendChild(posterLayer);
      this.posterLayer = posterLayer;
    }

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

  /**
   * Create HQ button
   */
  private createHQButton(): HTMLElement {
    const hqBtn = document.createElement('button');
    hqBtn.className = 'icon-btn icon-btn--hq';
    hqBtn.type = 'button';
    hqBtn.setAttribute('aria-label', 'Load high-quality video with audio');
    hqBtn.title = 'Load HD video';
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
        await this.upgradeToHDVideo();
        this.isHQMode = true;
        this.updateHQButton(hqBtn);
        this.updateMuteOverlayButton();
      } catch (error) {
        console.error('Failed to upgrade to HD video', error);
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

  /**
   * Update HQ button appearance based on mode
   */
  private updateHQButton(button: HTMLElement): void {
    if (this.isHQMode) {
      button.innerHTML = HQ_SVG_FILLED;
      button.style.color = THEME.colors.accentPrimary;
      button.title = 'HD video loaded';
    } else {
      button.innerHTML = HQ_SVG_OUTLINE;
      button.style.color = THEME.colors.textSecondary;
      button.title = 'Load HD video';
    }
  }

  /**
   * Programmatically set HQ mode (used when feed-level HD is enabled)
   */
  public setHQMode(isHQ: boolean): void {
    this.isHQMode = isHQ;
    if (this.hqButton) {
      this.updateHQButton(this.hqButton);
    }
    this.updateMuteOverlayButton();
    // Apply mute state to player if it exists
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
   * Hide media when ready (for autoplay)
   */
  private hideMediaWhenReady(player: NativeVideoPlayer, container: HTMLElement): void {
    const loading = container.querySelector<HTMLElement>('.video-post__loading');
    const videoElement = player.getVideoElement();
    if (!videoElement) return;

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
        console.warn('ImageVideoPost: Player ready wait timed out', {
          error,
          imageId: this.data.image.id,
        });
      })
      .finally(() => {
        if (videoElement.readyState >= 2) {
          reveal();
        }
      });
  }

  private attachLoadErrorHandler(): void {
    if (!this.player) {
      return;
    }
    const videoElement = this.player.getVideoElement();
    if (!videoElement) {
      return;
    }
    this.detachLoadErrorHandler();
    this.loadErrorHandler = () => this.checkForLoadError();
    videoElement.addEventListener('error', this.loadErrorHandler, { once: true });
  }

  private detachLoadErrorHandler(): void {
    if (!this.player || !this.loadErrorHandler) {
      this.loadErrorHandler = undefined;
      return;
    }
    const videoElement = this.player.getVideoElement();
    if (videoElement) {
      videoElement.removeEventListener('error', this.loadErrorHandler);
    }
    this.loadErrorHandler = undefined;
  }

  private clearLoadErrorCheckTimeout(): void {
    if (this.loadErrorCheckTimeoutId) {
      clearTimeout(this.loadErrorCheckTimeoutId);
      this.loadErrorCheckTimeoutId = undefined;
    }
  }

  private scheduleLoadErrorCheck(): void {
    if (!this.player || this.hasFailedPermanently) {
      return;
    }
    this.clearLoadErrorCheckTimeout();
    const isMobile = isMobileDevice();
    const delay = isMobile ? 20000 : 16000;
    this.loadErrorCheckTimeoutId = setTimeout(() => {
      if (!this.player || this.hasFailedPermanently) {
        this.clearLoadErrorCheckTimeout();
        return;
      }
      this.checkForLoadError();
    }, delay);
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
  private checkForLoadError(): void {
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
   * Perform favorite toggle action for ImageVideoPost
   */
  protected async toggleFavoriteAction(): Promise<boolean> {
    await this.toggleFavorite();
    return this.isFavorite;
  }

  /**
   * Toggle favorite status
   */
  private async toggleFavorite(): Promise<void> {
    if (!this.api) {
      console.error('ImageVideoPost: No API available for toggleFavorite');
      return;
    }
    
    try {
      const favoriteTagId = await this.resolveFavoriteTagId(true);
      if (!favoriteTagId) {
        throw new Error('Favorite tag unavailable');
      }

      const currentTags = this.data.image.tags ? [...this.data.image.tags] : [];
      this.data.image.tags ??= [];
      const hasFavoriteTag =
        currentTags.some((tag) => tag.id === favoriteTagId || tag.name === FAVORITE_TAG_NAME) || this.isFavorite;
      const shouldFavorite = !hasFavoriteTag;

      const existingTagIds = Array.from(
        new Set(
          currentTags
            .map((tag) => tag.id)
            .filter((id): id is string => typeof id === 'string' && id.length > 0)
        )
      );

      let nextTagIds: string[];
      if (shouldFavorite) {
        nextTagIds = existingTagIds.includes(favoriteTagId)
          ? existingTagIds
          : [...existingTagIds, favoriteTagId];
      } else {
        nextTagIds = existingTagIds.filter((id) => id !== favoriteTagId);
      }

      await this.api.updateImageTags(this.data.image.id, nextTagIds);

      if (shouldFavorite) {
        const alreadyPresent = currentTags.some((tag) => tag.id === favoriteTagId || tag.name === FAVORITE_TAG_NAME);
        if (!alreadyPresent) {
          this.data.image.tags = [...currentTags, { id: favoriteTagId, name: FAVORITE_TAG_NAME }];
        }
      } else {
        this.data.image.tags = currentTags.filter(
          (tag) => tag.id !== favoriteTagId && tag.name !== FAVORITE_TAG_NAME
        );
      }

      this.isFavorite = shouldFavorite;
      this.updateHeartButton();
    } catch (error) {
      console.error('ImageVideoPost: Failed to toggle favorite', error);
      showToast('Failed to update favorite');
      this.isFavorite = !this.isFavorite;
      this.updateHeartButton();
    }
  }

  /**
   * Get favorite tag source for ImageVideoPost
   */
  protected getFavoriteTagSource(): Array<{ name: string }> | undefined {
    return this.data.image.tags;
  }

  private async resolveFavoriteTagId(createIfMissing: boolean): Promise<string | null> {
    if (this.favoritesManager && createIfMissing) {
      return this.favoritesManager.getFavoriteTagId();
    }

    if (!this.api) {
      return null;
    }

    const existingTag = await this.api.findTagByName(FAVORITE_TAG_NAME);
    if (existingTag) {
      return existingTag.id;
    }

    if (!createIfMissing) {
      return null;
    }

    const newTag = await this.api.createTag(FAVORITE_TAG_NAME);
    return newTag?.id ?? null;
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
   * Open add tag dialog
   */
  protected openAddTagDialog(): void {
    this.openAddTagDialogBase({
      state: this.addTagDialogState,
      buttonGroup: this.buttonGroup,
      onSearch: (searchTerm) => {
        void this.searchTagsForSelect(this.addTagDialogState, searchTerm);
      },
      onSubmit: () => {
        void this.addTagToImage();
      },
      onAdjustPosition: (dialog) => this.adjustDialogPosition(dialog),
      focusAfterClose: this.addTagButton
    });
  }

  protected async removeTagAction(tagId: string, tagName: string): Promise<boolean> {
    return this.removeTagShared(tagId, tagName, {
      getCurrentTags: () => this.data.image.tags || [],
      apiCall: (nextTagIds) => this.api!.updateImageTags(this.data.image.id, nextTagIds),
      updateLocalTags: (remainingTags) => { this.data.image.tags = remainingTags as any[]; },
      entityType: 'image',
      logPrefix: 'ImageVideoPost'
    });
  }

  protected async removePerformerAction(performerId: string, performerName: string): Promise<boolean> {
    return this.removePerformerShared(performerId, performerName, {
      performers: this.data.image.performers,
      itemId: this.data.image.id,
      apiMethod: (id, performerIds) => this.api!.updateImagePerformers(id, performerIds),
      itemType: 'image',
      logPrefix: 'ImageVideoPost'
    });
  }

  /**
   * Add tag to image
   */
  private async addTagToImage(): Promise<void> {
    await this.addTagToImageShared(this.addTagDialogState, this.addTagButton);
  }

  /**
   * Refresh header to show updated tags
   */
  protected refreshHeader(): void {
    const header = this.container.querySelector('.video-post__header');
    if (header) {
      const newHeader = this.createHeader();
      header.replaceWith(newHeader);
      this.applyReelModeLayoutIfNeeded(newHeader);
    }
  }

  /**
   * Adjust dialog position to keep it within card boundaries
   */
  private adjustDialogPosition(dialog: HTMLElement): void {
    if (!dialog || !this.container) return;

    const dialogRect = dialog.getBoundingClientRect();
    const dialogWidth = dialogRect.width;
    
    const cardContainer = this.container.closest('.video-post, .image-post');
    if (!cardContainer) return;
    
    const cardRect = cardContainer.getBoundingClientRect();
    const buttonGroupRect = this.buttonGroup?.getBoundingClientRect();
    if (!buttonGroupRect) return;
    
    const buttonCenterX = buttonGroupRect.left + buttonGroupRect.width / 2 - cardRect.left;
    const dialogHalfWidth = dialogWidth / 2;
    
    const minLeft = dialogHalfWidth + 16;
    const maxLeft = cardRect.width - dialogHalfWidth - 16;
    
    let desiredLeft = buttonCenterX;
    let offsetX = 0;
    if (desiredLeft < minLeft) {
      offsetX = minLeft - buttonCenterX;
    } else if (desiredLeft > maxLeft) {
      offsetX = maxLeft - buttonCenterX;
    }
    
    dialog.style.left = '50%';
    dialog.style.transform = `translateX(calc(-50% + ${offsetX}px)) translateY(0) scale(1)`;
  }

  /**
   * Create mute button for footer
   */
  private createMuteOverlayButton(): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'video-post__mute-overlay';
    button.setAttribute('aria-label', 'Toggle mute');
    
    // Style to match other footer buttons
    this.applyIconButtonStyles(button);
    button.style.color = THEME.colors.textPrimary;
    button.style.padding = '0';
    button.style.width = '44px';
    button.style.height = '44px';
    button.style.minWidth = '44px';
    button.style.minHeight = '44px';
    // Prevent double-tap zoom on mobile and improve touch responsiveness
    button.style.touchAction = 'manipulation';
    
    // Handle mute toggle
    const handleMuteToggle = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation(); // Prevent any other handlers from running
      if (this.onMuteToggle && this.getGlobalMuteState) {
        const currentState = this.getGlobalMuteState();
        this.onMuteToggle(!currentState);
      }
    };
    
    // Click handler (desktop)
    button.addEventListener('click', handleMuteToggle);
    
    // Touch handler (mobile) - use unified touch handler utility
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
      
      // Prevent click event from firing after touch to avoid double-firing
      preventClickAfterTouch(button);
    }
    
    this.muteOverlayButton = button;
    
    // Update button appearance based on global mute state
    this.updateMuteOverlayButton();
    
    return button;
  }

  /**
   * Update mute overlay button appearance based on global mute state
   */
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
    
    // Gray out the button when not in HQ mode
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

  /**
   * Return true if player has been instantiated
   */
  isPlayerLoaded(): boolean {
    if (!this.isLoaded || !this.player) {
      return false;
    }
    if ('getIsUnloaded' in this.player && this.player.getIsUnloaded()) {
      return false;
    }
    return true;
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
    if (this.player && this.player.getIsUnloaded()) {
      this.player.reload();
      this.isLoaded = true;
      this.hasRenderedVideo = false;
      this.showPosterLayer();
      const container = this.playerContainer || this.container.querySelector('.video-post__player') as HTMLElement | null;
      if (container) {
        this.hideMediaWhenReady(this.player, container);
      }
      return this.player;
    }
    this.showPosterLayer();
    return this.loadPlayer(videoUrl);
  }

  private showPosterLayer(): void {
    if (!this.posterLayer) {
      return;
    }
    if (this.hasRenderedVideo) {
      return;
    }
    this.posterLayer.style.opacity = '1';
  }

  private hidePosterLayer(): void {
    if (!this.posterLayer) {
      return;
    }
    this.posterLayer.style.opacity = '0';
  }

  /**
   * Get the post ID
   */
  getPostId(): string {
    return this.data.image.id;
  }

  /**
   * Create rating section with dialog
   */
  private createRatingSection(): HTMLElement {
    if (!this.ratingControl) {
      const api = this.api;
      this.ratingControl = new RatingControl({
        container: this.container,
        subjectLabel: 'image',
        ratingSystemConfig: this.ratingSystemConfig,
        buildRatingDisplayButton: (options) => this.buildRatingDisplayButton(options),
        createRatingStarIcon: () => this.createRatingStarIcon(),
        getRating100: () => this.data.image.rating100,
        onUpdateRating100: (value) => {
          this.data.image.rating100 = value;
        },
        onSaveRating10: api
          ? (rating10) => api.updateImageRating(this.data.image.id, rating10)
          : undefined,
        onToast: (message) => showToast(message)
      });
    }

    return this.ratingControl.render();
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

    this.ratingControl?.destroy();
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
