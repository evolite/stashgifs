/**
 * Image Post Component
 * Individual image/GIF post card in the feed
 */

import { ImagePostData } from './types.js';
import { ImagePlayer } from './ImagePlayer.js';
import { FavoritesManager } from './FavoritesManager.js';
import { StashAPI } from './StashAPI.js';
import { VisibilityManager } from './VisibilityManager.js';
import { getAspectRatioClass, showToast, detectVideoFromVisualFiles, getImageUrlForDisplay } from './utils.js';
import { BasePost } from './BasePost.js';
import { toggleImageFavorite } from './utils/imagePostUtils.js';
import { RatingControl } from './RatingControl.js';

// Constants
const FAVORITE_TAG_NAME = 'StashGifs Favorite';
const OCOUNT_DIGIT_WIDTH_PX = 8; // Approximate pixels per digit for 14px font
const OCOUNT_MIN_WIDTH_PX = 14;
const OCOUNT_THREE_DIGIT_PADDING = 10;
const OCOUNT_DEFAULT_PADDING = 8;

export class ImagePost extends BasePost {
  protected readonly data: ImagePostData;
  private player?: ImagePlayer;
  private isLoaded: boolean = false;
  
  private playerContainer?: HTMLElement;
  private footer?: HTMLElement;

  private readonly ratingSystemConfig?: { type?: string; starPrecision?: string } | null;
  private ratingControl?: RatingControl;
  

  constructor(
    container: HTMLElement,
    data: ImagePostData,
    options?: {
      favoritesManager?: FavoritesManager;
      api?: StashAPI;
      visibilityManager?: VisibilityManager;
      onPerformerChipClick?: (performerId: number, performerName: string) => void;
      onTagChipClick?: (tagId: number, tagName: string) => void;
      showVerifiedCheckmarks?: boolean;
      onLoadFullVideo?: () => void;
      ratingSystemConfig?: { type?: string; starPrecision?: string } | null;
      reelMode?: boolean;
    }
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
   * Render the complete image post structure
   */
  private render(): void {
    const { header, playerContainer, footer } = this.renderBasePost({
      className: 'image-post',
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
   * Create the player container
   */
  private createPlayerContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'video-post__player';
    container.style.position = 'relative';

    // Calculate aspect ratio
    const aspectRatio = this.getTargetAspectRatio();
    if (aspectRatio) {
      container.style.aspectRatio = `${aspectRatio}`;
      this.setAspectRatioMetadata(container, aspectRatio);
    } else {
      let aspectRatioClass = 'aspect-16-9';
      if (this.data.aspectRatio) {
        aspectRatioClass = getAspectRatioClass(this.data.aspectRatio);
      }
      container.classList.add(aspectRatioClass);
    }

    return container;
  }
  private getTargetAspectRatio(): number | undefined {
    if (this.data.aspectRatio && Number.isFinite(this.data.aspectRatio)) {
      return this.data.aspectRatio;
    }
    const imageAspectRatio =
      this.data.image.aspectRatio ??
      (this.data.image.width && this.data.image.height && this.data.image.height !== 0
        ? this.data.image.width / this.data.image.height
        : undefined);
    return imageAspectRatio;
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
   * Load the image player
   */
  loadPlayer(imageUrl: string): ImagePlayer | undefined {
    if (this.isLoaded) {
      return this.player;
    }

    if (!this.playerContainer) {
      console.error('ImagePost: Player container not found');
      return undefined;
    }

    try {
      // Use centralized utility to detect if this is a video
      const { isVideo } = detectVideoFromVisualFiles(this.data.image.visualFiles);
      
      const isGif = !isVideo && (imageUrl.toLowerCase().endsWith('.gif') || 
                   this.data.image.visualFiles?.some(vf => 
                     vf.path?.toLowerCase().endsWith('.gif') || 
                     vf.video_codec?.toLowerCase() === 'gif'
                   ));
      
      this.player = new ImagePlayer(this.playerContainer, imageUrl, { 
        isGif, 
        isVideo
      });
      this.isLoaded = true;

      if (this.visibilityManager && this.data.image.id) {
        // Register with visibility manager if needed
      }

      return this.player;
    } catch (error) {
      console.error('ImagePost: Failed to create image player', {
        error,
        imageUrl,
        imageId: this.data.image.id,
      });
      return undefined;
    }
  }

  /**
   * Get image URL from image data
   * Primarily returns the URL already set in ImagePostData
   * Falls back to centralized URL selection utility if not set
   */
  getImageUrl(): string | undefined {
    // If URL is already set in data, use it (set by FeedContainer with proper settings)
    if (this.data.imageUrl) {
      return this.data.imageUrl;
    }

    // Fallback: use centralized utility (defaults to treatMp4AsVideo=false for fallback)
    // In practice, this should rarely be needed since FeedContainer sets imageUrl
    return getImageUrlForDisplay(this.data.image, false);
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

    // Image button (open in Stash)
    const imageBtn = this.createImageButton(this.data.image.id);
    buttonGroup.appendChild(imageBtn);

    return footer;
  }


  /**
   * Perform favorite toggle action for ImagePost
   */
  protected async toggleFavoriteAction(): Promise<boolean> {
    await this.toggleFavorite();
    return this.isFavorite;
  }


  /**
   * Perform O-count increment action for ImagePost
   */
  protected async incrementOCountAction(): Promise<void> {
    if (!this.api) {
      throw new Error('API not available');
    }
    const newOCount = await this.api.incrementImageOCount(this.data.image.id);
    this.oCount = newOCount;
    this.data.image.o_counter = newOCount;
    // ImagePost-specific: adjust padding for 3-digit numbers
    if (this.oCountButton) {
      const digitCount = this.oCount > 0 ? this.oCount.toString().length : 0;
      if (digitCount >= 3) {
        this.oCountButton.style.paddingRight = `${OCOUNT_THREE_DIGIT_PADDING}px`;
      } else {
        this.oCountButton.style.paddingRight = `${OCOUNT_DEFAULT_PADDING}px`;
      }
    }
  }

  /**
   * Toggle favorite status
   * Note: Images use tags for favorites, similar to markers
   */
  private async toggleFavorite(): Promise<void> {
    if (!this.api) {
      console.error('ImagePost: No API available for toggleFavorite');
      return;
    }
    try {
      const result = await toggleImageFavorite(
        this.data.image.id,
        this.data.image.tags,
        this.api,
        this.favoritesManager,
        this.isFavorite,
        FAVORITE_TAG_NAME,
      );
      this.data.image.tags = result.newTags as typeof this.data.image.tags;
      this.isFavorite = result.newIsFavorite;
      this.updateHeartButton();
    } catch (error) {
      console.error('ImagePost: Failed to toggle favorite', error);
      showToast('Failed to update favorite');
      this.isFavorite = !this.isFavorite;
      this.updateHeartButton();
    }
  }

  /**
   * Get favorite tag source for ImagePost
   */
  protected getFavoriteTagSource(): Array<{ name: string }> | undefined {
    return this.data.image.tags;
  }

  protected async removeTagAction(tagId: string, tagName: string): Promise<boolean> {
    return this.removeTagShared(tagId, tagName, {
      getCurrentTags: () => this.data.image.tags || [],
      apiCall: (nextTagIds) => this.api!.updateImageTags(this.data.image.id, nextTagIds),
      updateLocalTags: (remainingTags) => { this.data.image.tags = remainingTags as any[]; },
      entityType: 'image',
      logPrefix: 'ImagePost'
    });
  }

  protected async removePerformerAction(performerId: string, performerName: string): Promise<boolean> {
    return this.removePerformerShared(performerId, performerName, {
      performers: this.data.image.performers,
      itemId: this.data.image.id,
      apiMethod: (id, performerIds) => this.api!.updateImagePerformers(id, performerIds),
      itemType: 'image',
      logPrefix: 'ImagePost'
    });
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
   * Get the player instance
   */
  getPlayer(): ImagePlayer | undefined {
    return this.player;
  }

  /**
   * Return true if player has been instantiated
   */
  isPlayerLoaded(): boolean {
    return this.isLoaded && !!this.player;
  }

  /**
   * Return false (images don't have video source)
   */
  hasVideoSource(): boolean {
    return false;
  }

  /**
   * Preload player using image URL
   */
  preload(): ImagePlayer | undefined {
    const imageUrl = this.getImageUrl();
    if (!imageUrl) {
      return undefined;
    }
    return this.loadPlayer(imageUrl);
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
   * Destroy the post
   */
  destroy(): void {
    // Close dialogs if open
    if (this.addTagDialogState.isOpen) {
      this.closeAddTagDialogBase({ state: this.addTagDialogState });
    }

    // Clean up timers
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
    this.ratingControl?.destroy();
    this.isLoaded = false;
    super.destroy();
    // Remove the entire container from the DOM so stale cards don't linger
    this.container?.remove();
  }
}
