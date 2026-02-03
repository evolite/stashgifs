/**
 * Image Post Component
 * Individual image/GIF post card in the feed
 */

import { ImagePostData } from './types.js';
import { ImagePlayer } from './ImagePlayer.js';
import { FavoritesManager } from './FavoritesManager.js';
import { StashAPI } from './StashAPI.js';
import { VisibilityManager } from './VisibilityManager.js';
import { getAspectRatioClass, showToast, detectVideoFromVisualFiles, getImageUrlForDisplay, throttle, THEME } from './utils.js';
import { STAR_SVG, STAR_SVG_OUTLINE } from './icons.js';
import { BasePost } from './BasePost.js';
import type { AddTagDialogState } from './BasePost.js';

// Constants
const FAVORITE_TAG_NAME = 'StashGifs Favorite';
const RATING_MAX_STARS = 10;
const RATING_MIN_STARS = 0;
const RATING_DIALOG_MAX_WIDTH = 900;
const RATING_DIALOG_MIN_WIDTH = 160;
const RESIZE_THROTTLE_MS = 100;

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
  private buttonGroup?: HTMLElement;
  
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
            .filter(Boolean)
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

      // Image ID is already a string
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
      console.error('ImagePost: Failed to toggle favorite', error);
      showToast('Failed to update favorite');
      // Revert UI state on error
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
   * Adjust dialog position to keep it within card boundaries
   */
  private adjustDialogPosition(dialog: HTMLElement): void {
    if (!dialog || !this.container) return;

    // Get dialog dimensions
    const dialogRect = dialog.getBoundingClientRect();
    const dialogWidth = dialogRect.width;
    
    // Find the card container (the post container)
    const cardContainer = this.container.closest('.video-post, .image-post');
    if (!cardContainer) return;
    
    const cardRect = cardContainer.getBoundingClientRect();
    const buttonGroupRect = this.buttonGroup?.getBoundingClientRect();
    if (!buttonGroupRect) return;
    
    // Calculate button center position relative to card
    const buttonCenterX = buttonGroupRect.left + buttonGroupRect.width / 2 - cardRect.left;
    const dialogHalfWidth = dialogWidth / 2;
    
    // Calculate min and max left positions to keep dialog within card
    const minLeft = dialogHalfWidth + 16; // 16px padding from left edge
    const maxLeft = cardRect.width - dialogHalfWidth - 16; // 16px padding from right edge
    
    // Calculate desired left position (centered on button)
    let desiredLeft = buttonCenterX;
    
    // Calculate offset needed to keep dialog within boundaries
    // Keep left at 50% and use transform offset instead
    let offsetX = 0;
    if (desiredLeft < minLeft) {
      offsetX = minLeft - buttonCenterX;
    } else if (desiredLeft > maxLeft) {
      offsetX = maxLeft - buttonCenterX;
    }
    
    // Update dialog position using transform offset instead of changing left
    dialog.style.left = '50%';
    dialog.style.transform = `translateX(calc(-50% + ${offsetX}px)) translateY(0) scale(1)`;
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
    wrapper.appendChild(dialog);

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

    const margin = 8;
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
    
    this.ratingWrapper.style.setProperty('--rating-dialog-width', `${finalWidth}px`);

    const targetRightEdge = cardRect.right - margin;
    const relativeRight = wrapperRect.right - targetRightEdge;

    this.ratingWrapper.style.setProperty('--rating-dialog-left', 'auto');
    this.ratingWrapper.style.setProperty('--rating-dialog-right', `${relativeRight}px`);
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
    // Remove the entire container from the DOM so stale cards don't linger
    this.container?.remove();
  }
}
