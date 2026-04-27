/**
 * Image Post Component
 * Individual image/GIF post card in the feed
 */

import { ImagePostData } from './types.js';
import { ImagePlayer } from './ImagePlayer.js';
import { FavoritesManager } from './FavoritesManager.js';
import { StashAPI } from './StashAPI.js';
import { VisibilityManager } from './VisibilityManager.js';
import { getAspectRatioClass, detectVideoFromVisualFiles, getImageUrlForDisplay } from './utils.js';
import { BasePost } from './BasePost.js';

// Constants
const OCOUNT_DIGIT_WIDTH_PX = 8; // Approximate pixels per digit for 14px font
const OCOUNT_MIN_WIDTH_PX = 14;
const OCOUNT_THREE_DIGIT_PADDING = 10;
const OCOUNT_DEFAULT_PADDING = 8;

export class ImagePost extends BasePost {
  protected readonly data: ImagePostData;
  private player?: ImagePlayer;
  private isLoaded: boolean = false;

  

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
      showProductionAge?: boolean;
      onLoadFullVideo?: () => void;
      ratingSystemConfig?: { type?: string; starPrecision?: string } | null;
      reelMode?: boolean;
    }
  ) {
    super(container, options);
    this.data = data;
    this.initImagePostOptions(this.data.image.o_counter, options?.ratingSystemConfig, options?.reelMode);
    this.render();
  }

  /**
   * Render the complete image post structure
   */
  private render(): void {
    this.renderImageBasedPost('image-post', this.data.image.id, () => this.createPlayerContainer(), () => this.createFooter());
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

    this.appendCommonImageFooterButtons(buttonGroup, this.data.image.id);

    // Image button (open in Stash)
    const imageBtn = this.createImageButton(this.data.image.id);
    buttonGroup.appendChild(imageBtn);

    return footer;
  }


  /**
   * Perform O-count increment action for ImagePost
   */
  protected getProductionDate(): string | undefined {
    return this.data.image.date;
  }

  protected async incrementOCountAction(): Promise<void> {
    const newOCount = await this.doIncrementImageOCount(this.data.image.id);
    this.data.image.o_counter = newOCount;
    if (this.oCountButton) {
      const digitCount = this.oCount > 0 ? this.oCount.toString().length : 0;
      this.oCountButton.style.paddingRight = `${digitCount >= 3 ? OCOUNT_THREE_DIGIT_PADDING : OCOUNT_DEFAULT_PADDING}px`;
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
   * Destroy the post
   */
  destroy(): void {
    this.cleanupAddTagDialogState();

    if (this.player) {
      this.player.destroy();
      this.player = undefined;
    }
    this.isLoaded = false;
    super.destroy();
    this.container?.remove();
  }
}
