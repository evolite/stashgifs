import { ImagePostData } from './types.js';
import { ImagePlayer } from './ImagePlayer.js';
import { FavoritesManager } from './FavoritesManager.js';
import { StashAPI } from './StashAPI.js';
import { getAspectRatioClass, detectVideoFromVisualFiles, getImageUrlForDisplay } from './utils.js';
import { BasePost } from './BasePost.js';

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
      onPerformerChipClick?: (performerId: number, performerName: string) => void;
      onTagChipClick?: (tagId: number, tagName: string) => void;
      showVerifiedCheckmarks?: boolean;
      showProductionAge?: boolean;
      showStudioChips?: boolean;
      onLoadFullVideo?: () => void;
      ratingSystemConfig?: { type?: string; starPrecision?: string } | null;
    }
  ) {
    super(container, options);
    this.data = data;
    this.initImagePostOptions(this.data.image.o_counter, options?.ratingSystemConfig);
    this.render();
    this.attachReelAutoAdvanceTimer();
  }

  protected override reattachAutoAdvance(): void {
    this.attachReelAutoAdvanceTimer();
  }

  private render(): void {
    this.renderImageBasedPost('image-post', this.data.image.id, () => this.createPlayerContainer(), () => this.createFooter());
  }

  private createPlayerContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'video-post__player';
    container.style.position = 'relative';

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

  loadPlayer(imageUrl: string): ImagePlayer | undefined {
    if (this.isLoaded) {
      return this.player;
    }

    if (!this.playerContainer) {
      console.error('ImagePost: Player container not found');
      return undefined;
    }

    try {
      const { isVideo } = detectVideoFromVisualFiles(this.data.image.visualFiles);
      
      const isGif = !isVideo && (imageUrl.toLowerCase().endsWith('.gif') || 
                   this.data.image.visualFiles?.some(vf => 
                     vf.path?.toLowerCase().endsWith('.gif') || 
                     vf.video_codec?.toLowerCase() === 'gif'
                   ));
      
      this.player = new ImagePlayer(this.playerContainer, imageUrl, {
        isGif,
        isVideo,
        objectFit: 'contain',
      });
      this.isLoaded = true;

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

  getImageUrl(): string | undefined {
    if (this.data.imageUrl) {
      return this.data.imageUrl;
    }

    return getImageUrlForDisplay(this.data.image, false);
  }

  private createFooter(): HTMLElement {
    const { footer, buttonGroup } = this.buildFooterContainer();
    this.buttonGroup = buttonGroup;

    this.appendCommonImageFooterButtons(buttonGroup, this.data.image.id);
    this.appendImageButtons(buttonGroup, this.data.image.id);

    return footer;
  }

  protected override async incrementOCountAction(): Promise<void> {
    await super.incrementOCountAction();
    if (this.oCountButton) {
      const digitCount = this.oCount > 0 ? this.oCount.toString().length : 0;
      this.oCountButton.style.paddingRight = `${digitCount >= 3 ? OCOUNT_THREE_DIGIT_PADDING : OCOUNT_DEFAULT_PADDING}px`;
    }
  }

  getPlayer(): ImagePlayer | undefined {
    return this.player;
  }

  isPlayerLoaded(): boolean {
    return this.isLoaded && !!this.player;
  }

  hasVideoSource(): boolean {
    return false;
  }

  preload(): ImagePlayer | undefined {
    const imageUrl = this.getImageUrl();
    if (!imageUrl) {
      return undefined;
    }
    return this.loadPlayer(imageUrl);
  }

  getPostId(): string {
    return this.data.image.id;
  }

  getContainer(): HTMLElement {
    return this.container;
  }

  destroy(): void {
    if (this.player) {
      this.player.destroy();
      this.player = undefined;
    }
    this.isLoaded = false;
    super.destroy();
  }
}
