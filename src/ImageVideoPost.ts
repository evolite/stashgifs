/**
 * Image Video Post Component
 * MP4/M4V images displayed as videos with preview/HD upgrade capability
 */

import { ImageVideoPostData } from './types.js';
import { NativeVideoPlayer } from './NativeVideoPlayer.js';
import { FavoritesManager } from './FavoritesManager.js';
import { StashAPI } from './StashAPI.js';
import { VisibilityManager } from './VisibilityManager.js';
import { calculateAspectRatio, getAspectRatioClass, isValidMediaUrl, showToast, toAbsoluteUrl, isMobileDevice, throttle, THEME } from './utils.js';
import { HQ_SVG_OUTLINE, HQ_SVG_FILLED, VOLUME_MUTED_SVG, VOLUME_UNMUTED_SVG, STAR_SVG, STAR_SVG_OUTLINE } from './icons.js';
import { BasePost } from './BasePost.js';
import type { AddTagDialogState } from './BasePost.js';
import { setupTouchHandlers, preventClickAfterTouch } from './utils/touchHandlers.js';

// Constants
const FAVORITE_TAG_NAME = 'StashGifs Favorite';
const RATING_MAX_STARS = 10;
const RATING_MIN_STARS = 0;
const RATING_DIALOG_MAX_WIDTH = 900;
const RATING_DIALOG_MIN_WIDTH = 160;
const RESIZE_THROTTLE_MS = 100;

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
  private loadErrorCheckIntervalId?: ReturnType<typeof setInterval>;
  
  private readonly onCancelRequests?: () => void;
  private readonly onMuteToggle?: (isMuted: boolean) => void;
  private readonly getGlobalMuteState?: () => boolean;
  
  private playerContainer?: HTMLElement;
  private footer?: HTMLElement;
  private buttonGroup?: HTMLElement;
  private muteOverlayButton?: HTMLElement;
  
  // Add tag dialog state
  private readonly addTagDialogState: AddTagDialogState = { isOpen: false };
  
  // Rating state
  private ratingValue: number = 0;
  private hasRating: boolean = false;
  private ratingWrapper?: HTMLElement;
  private ratingDisplayButton?: HTMLButtonElement;
  private ratingDisplayValue?: HTMLElement;
  private ratingDisplayIcon?: HTMLElement;
  private ratingDialog?: HTMLElement;
  private ratingStarButtons: HTMLButtonElement[] = [];
  private isRatingDialogOpen: boolean = false;
  private isSavingRating: boolean = false;
  private hoveredStarIndex?: number;
  private hoveredPreviewValue?: number;
  private lastPointerSelectionTs = 0;
  private lastPointerHoverTs = 0;
  private cachedStarButtonWidth?: number;
  private readonly ratingSystemConfig?: { type?: string; starPrecision?: string } | null;
  
  // Event handlers for cleanup
  private readonly ratingOutsideClickHandler = (event: Event) => this.onRatingOutsideClick(event);
  private readonly ratingKeydownHandler = (event: KeyboardEvent) => this.onRatingKeydown(event);
  private readonly ratingResizeHandler: () => void;

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
    
    // Initialize rating from image data
    if (this.data.image.rating100 !== undefined) {
      this.ratingValue = this.convertRating100ToStars(this.data.image.rating100);
      this.hasRating = this.ratingValue > 0;
    }
    
    // Rating resize handler
    this.ratingResizeHandler = throttle(() => {
      if (this.isRatingDialogOpen) {
        this.syncRatingDialogLayout();
      }
    }, RESIZE_THROTTLE_MS);
    
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

    // Loading indicator for video
    const loading = document.createElement('div');
    loading.className = 'video-post__loading';
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    loading.appendChild(spinner);
    loading.style.display = this.isLoaded ? 'none' : 'flex';
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
    const hdVideoUrl = imagePath.startsWith('http') 
      ? imagePath 
      : toAbsoluteUrl(imagePath);
    
    if (!hdVideoUrl || !isValidMediaUrl(hdVideoUrl)) {
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
    const videoElement = player.getVideoElement();
    if (!videoElement) return;

    const handleCanPlay = () => {
      if (this.videoLoadingIndicator) {
        this.videoLoadingIndicator.style.display = 'none';
      }
      videoElement.removeEventListener('canplay', handleCanPlay);
    };

    videoElement.addEventListener('canplay', handleCanPlay, { once: true });
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

      if (this.visibilityManager && this.data.image.id) {
        this.visibilityManager.registerPlayer(this.data.image.id, this.player);
      }

      // Set up periodic error checking
      if (this.loadErrorCheckIntervalId) {
        clearInterval(this.loadErrorCheckIntervalId);
      }
      this.loadErrorCheckIntervalId = setInterval(() => {
        if (!this.player || this.hasFailedPermanently) {
          if (this.loadErrorCheckIntervalId) {
            clearInterval(this.loadErrorCheckIntervalId);
            this.loadErrorCheckIntervalId = undefined;
          }
          return;
        }
        this.checkForLoadError();
      }, 3000);
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
      this.loadErrorCount++;
      if (this.loadErrorCount >= 3) {
        this.hasFailedPermanently = true;
        this.showErrorPlaceholder();
      }
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
    return this.isLoaded && !!this.player;
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
    return this.loadPlayer(videoUrl);
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
    const wrapper = document.createElement('div');
    wrapper.className = 'rating-control';
    wrapper.dataset.role = 'rating';
    this.ratingWrapper = wrapper;

    const { button, iconSpan, valueSpan } = this.buildRatingDisplayButton({
      title: 'Set rating on image',
      onClick: () => {
        if (this.isSavingRating) return;
        this.toggleRatingDialog();
      }
    });
    this.ratingDisplayButton = button;
    this.ratingDisplayIcon = iconSpan;
    this.ratingDisplayValue = valueSpan;
    wrapper.appendChild(button);

    const dialog = this.createRatingDialog();
    this.container.appendChild(dialog);

    this.updateRatingDisplay();
    this.updateRatingStarButtons();

    return wrapper;
  }

  /**
   * Create rating dialog with star buttons
   */
  private createRatingDialog(): HTMLElement {
    const dialog = document.createElement('div');
    dialog.className = 'rating-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-hidden', 'true');
    dialog.hidden = true;
    dialog.style.position = 'absolute';
    dialog.style.bottom = 'calc(100% + 10px)';
    dialog.style.left = 'auto';
    dialog.style.right = 'var(--rating-dialog-right, auto)';
    dialog.style.width = 'var(--rating-dialog-width, auto)';
    dialog.style.minWidth = '200px';
    this.ratingDialog = dialog;

    const dialogHeader = document.createElement('div');
    dialogHeader.className = 'rating-dialog__header';
    dialog.appendChild(dialogHeader);

    const starsContainer = document.createElement('div');
    starsContainer.className = 'rating-dialog__stars';
    starsContainer.setAttribute('role', 'radiogroup');
    const maxStars = this.getMaxStars();
    starsContainer.setAttribute('aria-label', `Rate this image from 0 to ${maxStars}${this.isHalfPrecision() ? ' (half stars allowed)' : ''}`);
    this.ratingStarButtons = [];

    const isHalfPrecision = this.isHalfPrecision();
    const numStars = maxStars;
    
    if (isHalfPrecision) {
      const handlePointerMove = (event: PointerEvent | MouseEvent) => {
        this.handleStarsPointerMove(event);
      };
      const handlePointerLeave = () => {
        this.onStarHoverLeave();
      };
      const handlePointerDown = (event: PointerEvent) => {
        if (event.pointerType !== 'mouse') {
          const previewValue = this.calculatePreviewValueFromPointer(event.clientX);
          if (previewValue !== undefined) {
            const maxStars = this.getMaxStars();
            const starIndex = Math.min(Math.max(Math.ceil(previewValue), 1), maxStars);
            this.onStarHover(starIndex, previewValue);
          }
        }
      };
      const handlePointerUp = (event: PointerEvent) => {
        if (event.pointerType === 'mouse' && (event.target as HTMLElement)?.closest('.rating-dialog__star')) {
          return;
        }
        const previewValue = this.hoveredPreviewValue ?? this.calculatePreviewValueFromPointer(event.clientX);
        if (previewValue !== undefined) {
          this.lastPointerSelectionTs = performance.now();
          void this.onRatingStarSelect(previewValue);
        }
      };
      starsContainer.addEventListener('pointermove', handlePointerMove);
      starsContainer.addEventListener('pointerleave', handlePointerLeave);
      starsContainer.addEventListener('pointerdown', handlePointerDown);
      starsContainer.addEventListener('pointerup', handlePointerUp);
    }

    for (let i = 1; i <= numStars; i++) {
      const starBtn = document.createElement('button');
      starBtn.type = 'button';
      starBtn.className = 'rating-dialog__star';
      starBtn.setAttribute('role', 'radio');
      starBtn.dataset.starIndex = i.toString();
      starBtn.setAttribute('aria-label', `${i} star${i === 1 ? '' : 's'}`);
      starBtn.style.display = 'flex';
      starBtn.style.alignItems = 'center';
      starBtn.style.justifyContent = 'center';
      starBtn.style.width = '44px';
      starBtn.style.height = '44px';
      starBtn.style.minWidth = '44px';
      starBtn.style.minHeight = '44px';
      starBtn.style.margin = '0 4px';
      starBtn.style.padding = '4px';
      starBtn.style.border = 'none';
      starBtn.style.background = 'transparent';
      starBtn.style.cursor = 'pointer';
      starBtn.style.transition = 'transform 120ms ease-in-out, background 120ms ease-in-out';
      starBtn.style.borderRadius = '6px';
      starBtn.style.flexShrink = '0';

      const iconWrapper = this.createRatingStarIcon();
      starBtn.appendChild(iconWrapper);
      
      if (!isHalfPrecision) {
        starBtn.addEventListener('mouseenter', () => {
          this.onStarHover(i);
        });
      }
      starBtn.addEventListener('mouseleave', () => {
        this.onStarHoverLeave();
      });
      
      starBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const timeSincePointerSelect = performance.now() - this.lastPointerSelectionTs;
        let targetValue: number;
        if (isHalfPrecision) {
          const calculatedValue = this.calculatePreviewValueFromPointer(event.clientX);
          targetValue = this.hoveredPreviewValue ?? calculatedValue ?? i;
          if (timeSincePointerSelect < 200) {
            return;
          }
        } else {
          targetValue = i;
        }
        void this.onRatingStarSelect(targetValue);
      });
      
      starBtn.addEventListener('keydown', (event) => {
        this.handleRatingKeydown(event, i);
      });
      
      starBtn.addEventListener('focus', () => {
        const sincePointerHover = performance.now() - this.lastPointerHoverTs;
        if (this.hoveredPreviewValue !== undefined) {
          return;
        }
        if (this.isRatingDialogOpen && !this.hasRating) {
          return;
        }
        if (!isHalfPrecision || sincePointerHover > 200) {
          this.onStarHover(i);
        }
      });
      
      starBtn.addEventListener('blur', () => {
        this.onStarHoverLeave();
      });
      
      this.ratingStarButtons.push(starBtn);
      starsContainer.appendChild(starBtn);
    }

    dialog.appendChild(starsContainer);
    return dialog;
  }


  /**
   * Calculate preview value from pointer X position
   */
  private calculatePreviewValueFromPointer(clientX: number): number | undefined {
    if (!this.ratingDialog) return undefined;
    const starsContainer = this.ratingDialog.querySelector('.rating-dialog__stars') as HTMLElement;
    if (!starsContainer) return undefined;
    
    const rect = starsContainer.getBoundingClientRect();
    if (!rect.width || !Number.isFinite(rect.width)) return undefined;
    
    const relativeX = clientX - rect.left;
    const buttonWidth = rect.width / this.ratingStarButtons.length;
    const starIndex = Math.ceil(relativeX / buttonWidth);
    const maxStars = this.getMaxStars();
    
    if (starIndex < 1 || starIndex > maxStars) return undefined;
    
    if (this.isHalfPrecision()) {
      const buttonRelativeX = (relativeX - (starIndex - 1) * buttonWidth) / buttonWidth;
      return buttonRelativeX <= 0.5 ? starIndex - 0.5 : starIndex;
    }
    
    return starIndex;
  }

  /**
   * Handle pointer move for stars container (half precision)
   */
  private handleStarsPointerMove(event: PointerEvent | MouseEvent): void {
    if (!this.isHalfPrecision()) return;
    const previewValue = this.calculatePreviewValueFromPointer(event.clientX);
    if (previewValue !== undefined) {
      const maxStars = this.getMaxStars();
      const starIndex = Math.min(Math.max(Math.ceil(previewValue), 1), maxStars);
      this.lastPointerHoverTs = performance.now();
      this.onStarHover(starIndex, previewValue);
    }
  }

  /**
   * Handle keyboard navigation for rating stars
   */
  private handleRatingKeydown(event: KeyboardEvent, currentIndex: number): void {
    if (!this.isRatingDialogOpen) return;
    
    let newIndex: number;
    const maxButtons = this.ratingStarButtons.length;
    const isHalfPrecision = this.isHalfPrecision();
    
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        newIndex = Math.min(maxButtons, currentIndex + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        newIndex = Math.max(1, currentIndex - 1);
        break;
      case 'Home':
        event.preventDefault();
        newIndex = 1;
        break;
      case 'End':
        event.preventDefault();
        newIndex = maxButtons;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (isHalfPrecision) {
          void this.onRatingStarToggle(currentIndex);
        } else {
          void this.onRatingStarSelect(currentIndex);
        }
        return;
      default:
        return;
    }
    
    if (newIndex !== currentIndex) {
      const newButton = this.ratingStarButtons[newIndex - 1];
      if (newButton) {
        newButton.focus();
      }
    }
  }

  /**
   * Toggle rating dialog open/closed state
   */
  private toggleRatingDialog(force?: boolean): void {
    const shouldOpen = typeof force === 'boolean' ? force : !this.isRatingDialogOpen;
    if (shouldOpen) {
      this.openRatingDialog();
    } else {
      this.closeRatingDialog();
    }
  }

  /**
   * Open rating dialog
   */
  private openRatingDialog(): void {
    if (!this.ratingDialog || this.isRatingDialogOpen) return;
    this.isRatingDialogOpen = true;
    this.ratingDialog.hidden = false;
    this.ratingDialog.setAttribute('aria-hidden', 'false');
    this.ratingDialog.classList.add('rating-dialog--open');
    this.ratingDisplayButton?.setAttribute('aria-expanded', 'true');
    this.ratingWrapper?.classList.add('rating-control--open');
    requestAnimationFrame(() => {
      this.syncRatingDialogLayout();
    });
    document.addEventListener('mousedown', this.ratingOutsideClickHandler);
    document.addEventListener('touchstart', this.ratingOutsideClickHandler);
    document.addEventListener('keydown', this.ratingKeydownHandler);
    window.addEventListener('resize', this.ratingResizeHandler);
    
    if (this.hasRating && this.ratingValue > 0) {
      const maxStars = this.getMaxStars();
      const starIndex = Math.min(Math.max(Math.ceil(this.ratingValue), 1), maxStars);
      this.hoveredStarIndex = starIndex;
      this.hoveredPreviewValue = this.ratingValue;
      this.updateRatingStarButtons(true);
      
      if (this.ratingStarButtons.length >= starIndex) {
        const targetButton = this.ratingStarButtons[starIndex - 1];
        if (targetButton) {
          targetButton.focus();
        }
      }
    } else {
      this.hoveredStarIndex = undefined;
      this.hoveredPreviewValue = undefined;
      this.updateRatingStarButtons();
      
      if (this.ratingStarButtons.length > 0) {
        const firstButton = this.ratingStarButtons[0];
        if (firstButton) {
          firstButton.focus();
        }
      }
    }
  }

  /**
   * Close rating dialog
   */
  private closeRatingDialog(): void {
    if (!this.ratingDialog || !this.isRatingDialogOpen) return;
    this.isRatingDialogOpen = false;
    this.ratingDialog.classList.remove('rating-dialog--open');
    this.ratingDialog.setAttribute('aria-hidden', 'true');
    this.ratingDialog.hidden = true;
    this.ratingDisplayButton?.setAttribute('aria-expanded', 'false');
    this.ratingWrapper?.classList.remove('rating-control--open');
    this.hoveredStarIndex = undefined;
    this.hoveredPreviewValue = undefined;
    this.detachRatingGlobalListeners();
  }

  /**
   * Detach global event listeners for rating dialog
   */
  private detachRatingGlobalListeners(): void {
    document.removeEventListener('mousedown', this.ratingOutsideClickHandler);
    document.removeEventListener('touchstart', this.ratingOutsideClickHandler);
    document.removeEventListener('keydown', this.ratingKeydownHandler);
    window.removeEventListener('resize', this.ratingResizeHandler);
  }

  /**
   * Handle clicks outside rating dialog
   */
  private onRatingOutsideClick(event: Event): void {
    if (!this.isRatingDialogOpen || !this.ratingWrapper) return;
    const target = event.target as Node | null;
    if (target && (this.ratingWrapper.contains(target) || this.ratingDialog?.contains(target))) {
      return;
    }
    this.closeRatingDialog();
  }

  /**
   * Handle keyboard events for rating dialog
   */
  private onRatingKeydown(event: KeyboardEvent): void {
    if (!this.isRatingDialogOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeRatingDialog();
      this.ratingDisplayButton?.focus();
    }
  }

  /**
   * Update rating display button and value
   */
  private updateRatingDisplay(): void {
    if (this.ratingDisplayButton) {
      const maxStars = this.getMaxStars();
      const ariaLabel = this.hasRating
        ? `Image rating ${this.formatRatingValue(this.ratingValue)} out of ${maxStars}`
        : 'Rate this image';
      this.ratingDisplayButton.setAttribute('aria-label', ariaLabel);
      this.ratingDisplayButton.classList.toggle('icon-btn--rating-active', this.hasRating);
    }
    if (this.ratingDisplayValue) {
      this.ratingDisplayValue.textContent = '';
    }
    if (this.ratingDisplayIcon) {
      if (this.hasRating) {
        this.ratingDisplayIcon.innerHTML = STAR_SVG;
        this.ratingDisplayIcon.style.color = '#FFD700';
      } else {
        this.ratingDisplayIcon.innerHTML = STAR_SVG_OUTLINE;
        this.ratingDisplayIcon.style.color = THEME.colors.iconInactive;
      }
    }
  }

  /**
   * Handle star hover for preview
   */
  private onStarHover(starIndex: number, hoverValue?: number): void {
    this.hoveredStarIndex = starIndex;
    this.hoveredPreviewValue = hoverValue ?? starIndex;
    this.updateRatingStarButtons(true);
  }

  /**
   * Handle star hover leave - restore actual rating
   */
  private onStarHoverLeave(): void {
    this.hoveredStarIndex = undefined;
    this.hoveredPreviewValue = undefined;
    this.updateRatingStarButtons(false);
  }

  /**
   * Update a single rating star button
   */
  private updateSingleStarButton(
    button: HTMLButtonElement,
    starIndex: number,
    displayValue: number,
    isPreview: boolean,
    buttonIndex: number
  ): void {
    const iconWrapper = button.querySelector<HTMLElement>('.rating-dialog__star-icon');
    const fillSpan = iconWrapper?.querySelector<HTMLElement>('.rating-dialog__star-fill');
    const outlineSpan = iconWrapper?.querySelector<HTMLElement>('.rating-dialog__star-outline');
    
    const starStartValue = starIndex - 1;
    const relativeFillValue = Math.min(Math.max(displayValue - starStartValue, 0), 1);
    const fillPercent = Math.round(relativeFillValue * 100);
    const isHalfState = fillPercent > 0 && fillPercent < 100;
    const isFilled = fillPercent > 0;
    
    const isChecked = !isPreview && this.hasRating && Math.abs(this.ratingValue - displayValue) < 0.01;
    button.classList.toggle('rating-dialog__star--active', isFilled);
    button.classList.toggle('rating-dialog__star--half', isHalfState);
    button.setAttribute('aria-checked', isChecked ? 'true' : 'false');
    button.tabIndex = isChecked || (!this.hasRating && buttonIndex === 0) ? 0 : -1;
    
    button.style.background = 'transparent';
    
    if (fillSpan && outlineSpan) {
      const clipPercent = 100 - fillPercent;
      fillSpan.style.opacity = isFilled ? '1' : '0';
      const clipInset = `inset(0 ${clipPercent}% 0 0)`;
      fillSpan.style.clipPath = clipInset;
      fillSpan.style.setProperty('-webkit-clip-path', clipInset);
      
      if (fillPercent === 100) {
        outlineSpan.style.opacity = '0.4';
      } else if (isFilled) {
        outlineSpan.style.opacity = '0.65';
      } else {
        outlineSpan.style.opacity = '1';
      }
    }
    
    button.disabled = this.isSavingRating;
  }

  /**
   * Update rating star buttons display
   */
  private updateRatingStarButtons(isPreview: boolean = false): void {
    if (!this.ratingStarButtons || this.ratingStarButtons.length === 0) return;
    
    const displayValue = isPreview && this.hoveredPreviewValue !== undefined
      ? this.hoveredPreviewValue
      : this.ratingValue;
    
    for (let i = 0; i < this.ratingStarButtons.length; i++) {
      const button = this.ratingStarButtons[i];
      const starIndex = i + 1;
      this.updateSingleStarButton(button, starIndex, displayValue, isPreview, i);
    }
  }

  /**
   * Handle star toggle for half precision
   */
  private async onRatingStarToggle(starIndex: number): Promise<void> {
    if (this.isSavingRating) return;

    const currentStarValue = starIndex;
    const halfStarValue = starIndex - 0.5;
    const previousValue = this.ratingValue;
    const previousRating100 = this.data.image.rating100;
    const previousHasRating = this.hasRating;

    let nextValue: number;
    if (Math.abs(this.ratingValue - currentStarValue) < 0.01) {
      nextValue = halfStarValue;
      this.hasRating = true;
    } else if (Math.abs(this.ratingValue - halfStarValue) < 0.01) {
      nextValue = 0;
      this.hasRating = false;
    } else {
      nextValue = currentStarValue;
      this.hasRating = true;
    }

    this.ratingValue = this.clampRatingValue(nextValue);
    this.updateRatingDisplay();
    this.updateRatingStarButtons();
    this.closeRatingDialog();

    if (!this.api) {
      const maxStars = this.getMaxStars();
      this.data.image.rating100 = Math.round((this.ratingValue / maxStars) * 100);
      return;
    }

    this.isSavingRating = true;
    this.setRatingSavingState(true);
    this.updateRatingStarButtons();

    try {
      const maxStars = this.getMaxStars();
      const rating10 = (this.ratingValue / maxStars) * RATING_MAX_STARS;
      const updatedRating100 = await this.api.updateImageRating(this.data.image.id, rating10);
      this.data.image.rating100 = updatedRating100;
      this.ratingValue = this.convertRating100ToStars(updatedRating100);
      this.hasRating = this.ratingValue > 0;
      this.updateRatingDisplay();
      this.updateRatingStarButtons();
    } catch (error) {
      console.error('Failed to update image rating', error);
      showToast('Failed to update rating. Please try again.');
      this.ratingValue = previousValue;
      this.hasRating = previousHasRating;
      this.data.image.rating100 = previousRating100;
      this.updateRatingDisplay();
      this.updateRatingStarButtons();
    } finally {
      this.isSavingRating = false;
      this.setRatingSavingState(false);
      this.updateRatingStarButtons();
    }
  }

  /**
   * Handle star selection
   */
  private async onRatingStarSelect(value: number): Promise<void> {
    if (this.isSavingRating) return;

    const nextValue = this.clampRatingValue(value);
    const previousValue = this.ratingValue;
    const previousRating100 = this.data.image.rating100;
    const previousHasRating = this.hasRating;

    this.ratingValue = nextValue;
    this.hasRating = nextValue > 0;
    this.updateRatingDisplay();
    this.updateRatingStarButtons();
    this.closeRatingDialog();

    if (!this.api) {
      const maxStars = this.getMaxStars();
      this.data.image.rating100 = Math.round((this.ratingValue / maxStars) * 100);
      return;
    }

    this.isSavingRating = true;
    this.setRatingSavingState(true);
    this.updateRatingStarButtons();

    try {
      const maxStars = this.getMaxStars();
      const rating10 = (this.ratingValue / maxStars) * RATING_MAX_STARS;
      const updatedRating100 = await this.api.updateImageRating(this.data.image.id, rating10);
      this.data.image.rating100 = updatedRating100;
      this.ratingValue = this.convertRating100ToStars(updatedRating100);
      this.hasRating = this.ratingValue > 0;
      this.updateRatingDisplay();
      this.updateRatingStarButtons();
    } catch (error) {
      console.error('Failed to update image rating', error);
      showToast('Failed to update rating. Please try again.');
      this.ratingValue = previousValue;
      this.hasRating = previousHasRating;
      this.data.image.rating100 = previousRating100;
      this.updateRatingDisplay();
      this.updateRatingStarButtons();
    } finally {
      this.isSavingRating = false;
      this.setRatingSavingState(false);
      this.updateRatingStarButtons();
    }
  }

  /**
   * Set rating saving state on UI elements
   */
  private setRatingSavingState(isSaving: boolean): void {
    if (!this.ratingDisplayButton) return;
    this.ratingDisplayButton.disabled = isSaving;
    if (isSaving) {
      this.ratingDisplayButton.style.opacity = '0.6';
      this.ratingDisplayButton.style.cursor = 'wait';
    } else {
      this.ratingDisplayButton.style.opacity = '1';
      this.ratingDisplayButton.style.cursor = 'pointer';
    }
  }

  /**
   * Sync rating dialog layout with container
   */
  private calculateStarsWidth(dialog: HTMLElement): number {
    if (this.ratingStarButtons.length > 0) {
      if (this.cachedStarButtonWidth === undefined) {
        let totalWidth = 0;
        for (const starBtn of this.ratingStarButtons) {
          const rect = starBtn.getBoundingClientRect();
          totalWidth += rect.width;
        }
        if (this.ratingStarButtons.length > 0) {
          this.cachedStarButtonWidth = totalWidth / this.ratingStarButtons.length;
        }
        return totalWidth;
      }
      return this.cachedStarButtonWidth * this.ratingStarButtons.length;
    }
    const starsContainer = dialog.querySelector<HTMLElement>('.rating-dialog__stars');
    if (starsContainer) {
      return starsContainer.scrollWidth;
    }
    return 10 * 24;
  }

  private syncRatingDialogLayout(): void {
    if (!this.ratingWrapper) return;
    const dialog = this.ratingDialog;
    if (!dialog) return;

    const cardRect = this.container.getBoundingClientRect();
    const wrapperRect = this.ratingWrapper.getBoundingClientRect();
    if (!cardRect.width || !wrapperRect.width) return;

    const margin = 8; // Small margin from card edges
    const maxWidth = cardRect.width - (margin * 2);
    const starsContainer = dialog.querySelector<HTMLElement>('.rating-dialog__stars');
    let requiredWidth = 0;

    if (this.ratingStarButtons.length > 0 && starsContainer) {
      const starCount = this.ratingStarButtons.length;
      let gap = 2;
      let marginX = 0;
      let paddingX = 8;
      let paddingY = 8;
      starsContainer.style.flexWrap = 'nowrap';

      const computeButtonSize = () => {
        const totalSpacing = (starCount - 1) * gap + starCount * (marginX * 2);
        const availableWidth = maxWidth - (paddingX * 2) - totalSpacing;
        const size = Math.floor(availableWidth / starCount);
        return { size, totalSpacing };
      };

      let { size: buttonSize, totalSpacing } = computeButtonSize();

      if (buttonSize < 18) {
        gap = 1;
        paddingX = 4;
        paddingY = 6;
        ({ size: buttonSize, totalSpacing } = computeButtonSize());
      }

      buttonSize = Math.min(44, Math.max(16, buttonSize));
      dialog.style.padding = `${paddingY}px ${paddingX}px`;
      starsContainer.style.gap = `${gap}px`;

      for (const starBtn of this.ratingStarButtons) {
        starBtn.style.margin = `0 ${marginX}px`;
        starBtn.style.width = `${buttonSize}px`;
        starBtn.style.minWidth = `${buttonSize}px`;
        starBtn.style.height = `${buttonSize}px`;
        starBtn.style.minHeight = `${buttonSize}px`;
      }

      requiredWidth = (paddingX * 2) + (buttonSize * starCount) + totalSpacing;
      this.cachedStarButtonWidth = undefined;
    }

    const starsWidth = this.calculateStarsWidth(dialog);
    const dialogWidth = requiredWidth > 0 ? requiredWidth : starsWidth;
    const finalWidth = Math.min(dialogWidth, maxWidth);

    dialog.style.boxSizing = 'border-box';
    dialog.style.width = `${finalWidth}px`;
    dialog.style.minWidth = `${finalWidth}px`;
    dialog.style.left = 'auto';
    dialog.style.right = `${margin}px`;
    const bottomOffset = cardRect.bottom - wrapperRect.top + 10;
    dialog.style.bottom = `${bottomOffset}px`;
  }

  /**
   * Clamp rating value to valid range
   */
  private clampRatingValue(value: number): number {
    if (!Number.isFinite(value)) return RATING_MIN_STARS;
    const maxStars = this.getMaxStars();
    if (this.isHalfPrecision()) {
      return Math.min(maxStars, Math.max(RATING_MIN_STARS, Math.round(value * 2) / 2));
    }
    return Math.min(maxStars, Math.max(RATING_MIN_STARS, Math.round(value)));
  }

  /**
   * Convert rating100 (0-100) to stars (0-10 or 0-5)
   */
  private convertRating100ToStars(rating100?: number): number {
    if (typeof rating100 !== 'number' || Number.isNaN(rating100)) {
      return RATING_MIN_STARS;
    }
    const maxStars = this.getMaxStars();
    const value = (rating100 / 100) * maxStars;
    return this.clampRatingValue(value);
  }

  /**
   * Get maximum stars based on rating system type
   */
  private getMaxStars(): number {
    const type = this.ratingSystemConfig?.type;
    return type === 'stars' ? 5 : RATING_MAX_STARS;
  }

  /**
   * Check if half precision is enabled
   */
  private isHalfPrecision(): boolean {
    return this.ratingSystemConfig?.starPrecision === 'half';
  }

  /**
   * Format rating value for display
   */
  private formatRatingValue(value: number): string {
    if (this.isHalfPrecision()) {
      return value.toFixed(1);
    }
    return Math.round(value).toString();
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
    if (this.isRatingDialogOpen) {
      this.closeRatingDialog();
    }

    // Clean up timers
    if (this.loadErrorCheckIntervalId) {
      clearInterval(this.loadErrorCheckIntervalId);
      this.loadErrorCheckIntervalId = undefined;
    }
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

    // Clean up hover handlers
    for (const [button] of this.hoverHandlers) {
      this.removeHoverEffect(button);
    }
    this.hoverHandlers.clear();

    if (this.player) {
      this.player.destroy();
      this.player = undefined;
    }
    this.isLoaded = false;
    
    // Remove the entire container from the DOM
    this.container?.remove();
  }
}
