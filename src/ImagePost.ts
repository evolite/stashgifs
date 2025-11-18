/**
 * Image Post Component
 * Individual image/GIF post card in the feed
 */

import { ImagePostData } from './types.js';
import { ImagePlayer } from './ImagePlayer.js';
import { FavoritesManager } from './FavoritesManager.js';
import { StashAPI } from './StashAPI.js';
import { VisibilityManager } from './VisibilityManager.js';
import { getAspectRatioClass, showToast, toAbsoluteUrl } from './utils.js';
import { HEART_SVG_OUTLINE, HEART_SVG_FILLED, ADD_TAG_SVG, OCOUNT_SVG, VERIFIED_CHECKMARK_SVG, IMAGE_BADGE_SVG } from './icons.js';

// Constants
const FAVORITE_TAG_NAME = 'StashGifs Favorite';

const OCOUNT_DIGIT_WIDTH_PX = 8; // Approximate pixels per digit for 14px font
const OCOUNT_MIN_WIDTH_PX = 14;
const OCOUNT_THREE_DIGIT_PADDING = 10;
const OCOUNT_DEFAULT_PADDING = 8;

export class ImagePost {
  private readonly container: HTMLElement;
  private readonly data: ImagePostData;
  private player?: ImagePlayer;
  private isLoaded: boolean = false;
  private readonly favoritesManager?: FavoritesManager;
  private readonly api?: StashAPI;
  private readonly visibilityManager?: VisibilityManager;
  private heartButton?: HTMLElement;
  private addTagButton?: HTMLElement;
  private oCountButton?: HTMLElement;
  private isFavorite: boolean = false;
  private oCount: number = 0;
  private isTogglingFavorite: boolean = false;
  
  private playerContainer?: HTMLElement;
  private footer?: HTMLElement;
  private buttonGroup?: HTMLElement;
  private readonly hoverHandlers: Map<HTMLElement, { mouseenter: () => void; mouseleave: () => void }> = new Map();
  
  // Add tag dialog state
  private addTagDialog?: HTMLElement;
  private addTagDialogInput?: HTMLInputElement;
  private addTagDialogSuggestions?: HTMLElement;
  private addTagDialogCreateButton?: HTMLButtonElement;
  private isAddTagDialogOpen: boolean = false;
  private selectedTagId?: string;
  private selectedTagName?: string;
  private autocompleteDebounceTimer?: ReturnType<typeof setTimeout>;
  private tagSearchLoadingTimer?: ReturnType<typeof setTimeout>;
  private readonly isTagSearchLoading: boolean = false;

  private readonly onPerformerChipClick?: (performerId: number, performerName: string) => void;
  private readonly onTagChipClick?: (tagId: number, tagName: string) => void;

  constructor(
    container: HTMLElement,
    data: ImagePostData,
    favoritesManager?: FavoritesManager,
    api?: StashAPI,
    visibilityManager?: VisibilityManager,
    onPerformerChipClick?: (performerId: number, performerName: string) => void,
    onTagChipClick?: (tagId: number, tagName: string) => void
  ) {
    this.container = container;
    this.data = data;
    this.favoritesManager = favoritesManager;
    this.api = api;
    this.visibilityManager = visibilityManager;
    this.onPerformerChipClick = onPerformerChipClick;
    this.onTagChipClick = onTagChipClick;
    this.oCount = this.data.image.o_counter || 0;
    
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
    this.container.className = 'image-post';
    this.container.dataset.postId = this.data.image.id;
    // Clear container
    while (this.container.firstChild) {
      this.container.firstChild.remove();
    }

    // Header with performers and tags
    const header = this.createHeader();
    this.container.appendChild(header);

    // Player container
    const playerContainer = this.createPlayerContainer();
    this.container.appendChild(playerContainer);
    this.playerContainer = playerContainer;

    // Footer with buttons
    const footer = this.createFooter();
    this.container.appendChild(footer);
    this.footer = footer;
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
   * Add performer chips to the chips container
   */
  private addPerformerChips(chips: HTMLElement): void {
    if (!this.data.image.performers || this.data.image.performers.length === 0) {
      return;
    }
    
    for (const performer of this.data.image.performers) {
      const chip = this.createPerformerChip(performer);
      chips.appendChild(chip);
    }
  }

  /**
   * Add tag chips to the chips container
   */
  private addTagChipsToHeader(chips: HTMLElement): void {
    if (!this.data.image.tags?.length) {
      return;
    }
    
    const hasPerformers = this.data.image.performers && this.data.image.performers.length > 0;
    let isFirstTag = true;
    
    for (const tag of this.data.image.tags) {
      if (!tag?.id || !tag?.name || tag.name === FAVORITE_TAG_NAME) {
        continue;
      }
      
      const chip = this.createTagChip(tag);
      if (hasPerformers && isFirstTag) {
        chip.style.marginLeft = '8px';
        isFirstTag = false;
      }
      chips.appendChild(chip);
    }
  }

  /**
   * Create header with performer and tag chips
   */
  private createHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'video-post__header';
    header.style.padding = '2px 16px';
    header.style.marginBottom = '0';
    header.style.borderBottom = 'none';

    const chips = document.createElement('div');
    chips.className = 'chips';
    chips.style.display = 'flex';
    chips.style.flexWrap = 'wrap';
    chips.style.alignItems = 'center';
    chips.style.gap = '4px';
    chips.style.margin = '0';
    chips.style.padding = '0';

    const badge = this.createImageBadgeIcon();
    chips.appendChild(badge);
    
    this.addPerformerChips(chips);
    this.addTagChipsToHeader(chips);

    header.appendChild(chips);
    return header;
  }

  /**
   * Create an image badge to show content type
   */
  private createImageBadgeIcon(): HTMLElement {
    const badge = document.createElement('span');
    badge.className = 'content-badge';
    badge.style.display = 'inline-flex';
    badge.style.alignItems = 'center';
    badge.style.justifyContent = 'center';
    badge.style.width = '30px';
    badge.style.height = '30px';
    badge.style.flexShrink = '0';
    badge.style.color = 'rgba(255, 255, 255, 0.85)';
    badge.style.pointerEvents = 'none';
    badge.innerHTML = IMAGE_BADGE_SVG;
    badge.title = 'Image';
    badge.setAttribute('role', 'img');
    badge.setAttribute('aria-label', 'Image');
    return badge;
  }

  /**
   * Create a performer chip element
   */
  private createPerformerChip(performer: { id: string; name: string; image_path?: string }): HTMLElement {
    const chip = document.createElement('a');
    chip.className = 'performer-chip';
    chip.href = this.getPerformerLink(performer.id);
    chip.target = '_blank';
    chip.rel = 'noopener noreferrer';
    chip.style.display = 'inline-flex';
    chip.style.alignItems = 'center';
    chip.style.gap = '4px';
    chip.style.fontSize = '14px';
    chip.style.lineHeight = '1.4';
    chip.style.color = 'rgba(255, 255, 255, 0.85)';
    chip.style.textDecoration = 'none';
    chip.style.transition = 'color 0.2s ease, opacity 0.2s ease';
    chip.style.cursor = 'pointer';
    chip.style.minHeight = '44px';
    chip.style.height = '44px';
    
    const handleClick = () => {
      if (this.onPerformerChipClick) {
        const performerId = Number.parseInt(performer.id, 10);
        if (!Number.isNaN(performerId)) {
          this.onPerformerChipClick(performerId, performer.name);
        }
      }
    };
    
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    
    if (isMobile) {
      let touchStartX: number = 0;
      let touchStartY: number = 0;
      let touchStartTime: number = 0;
      let isScrolling: boolean = false;
      const touchMoveThreshold: number = 10;
      const touchDurationThreshold: number = 300;
      
      chip.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        if (touch) {
          touchStartX = touch.clientX;
          touchStartY = touch.clientY;
          touchStartTime = Date.now();
          isScrolling = false;
        }
      }, { passive: true });
      
      chip.addEventListener('touchmove', (e) => {
        if (e.touches.length > 0) {
          const touch = e.touches[0];
          if (touch) {
            const deltaX = Math.abs(touch.clientX - touchStartX);
            const deltaY = Math.abs(touch.clientY - touchStartY);
            if (deltaX > touchMoveThreshold || deltaY > touchMoveThreshold) {
              isScrolling = true;
            }
          }
        }
      }, { passive: true });
      
      chip.addEventListener('touchend', (e) => {
        const touch = e.changedTouches[0];
        if (!touch) return;
        
        const deltaX = Math.abs(touch.clientX - touchStartX);
        const deltaY = Math.abs(touch.clientY - touchStartY);
        const touchDuration = Date.now() - touchStartTime;
        const totalDistance = Math.hypot(deltaX, deltaY);
        
        if (!isScrolling && 
            totalDistance < touchMoveThreshold && 
            touchDuration < touchDurationThreshold) {
          e.preventDefault();
          e.stopPropagation();
          handleClick();
        }
        
        isScrolling = false;
        touchStartX = 0;
        touchStartY = 0;
        touchStartTime = 0;
      }, { passive: false });
      
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleClick();
      });
    } else {
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleClick();
      });
    }
    
    // Add performer image (circular, 20px) before the name
    const imageContainer = document.createElement('div');
    imageContainer.style.width = '20px';
    imageContainer.style.height = '20px';
    imageContainer.style.borderRadius = '50%';
    imageContainer.style.background = 'rgba(255,255,255,0.1)';
    imageContainer.style.display = 'flex';
    imageContainer.style.alignItems = 'center';
    imageContainer.style.justifyContent = 'center';
    imageContainer.style.fontSize = '12px';
    imageContainer.style.fontWeight = '600';
    imageContainer.style.color = 'rgba(255,255,255,0.85)';
    imageContainer.style.flexShrink = '0';
    imageContainer.style.overflow = 'hidden';
    
    if (performer.image_path) {
      const imageSrc = performer.image_path.startsWith('http')
        ? performer.image_path
        : toAbsoluteUrl(performer.image_path);
      if (imageSrc) {
        const img = document.createElement('img');
        img.src = imageSrc;
        img.alt = performer.name;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        imageContainer.appendChild(img);
      } else {
        imageContainer.textContent = performer.name.charAt(0).toUpperCase();
      }
    } else {
      imageContainer.textContent = performer.name.charAt(0).toUpperCase();
    }
    
    chip.appendChild(imageContainer);
    
    // Add performer name
    chip.appendChild(document.createTextNode(performer.name));
    
    // Add verified checkmark icon after the name
    const checkmarkIcon = document.createElement('span');
    checkmarkIcon.innerHTML = VERIFIED_CHECKMARK_SVG;
    checkmarkIcon.style.display = 'inline-flex';
    checkmarkIcon.style.alignItems = 'center';
    checkmarkIcon.style.width = '14px';
    checkmarkIcon.style.height = '14px';
    checkmarkIcon.style.flexShrink = '0';
    const svg = checkmarkIcon.querySelector('svg');
    if (svg) {
      svg.setAttribute('width', '14');
      svg.setAttribute('height', '14');
    }
    chip.appendChild(checkmarkIcon);
    
    // Hover effect
    chip.addEventListener('mouseenter', () => {
      chip.style.color = 'rgba(255, 255, 255, 1)';
    });
    chip.addEventListener('mouseleave', () => {
      chip.style.color = 'rgba(255, 255, 255, 0.85)';
    });
    
    return chip;
  }

  /**
   * Create a tag chip element (displayed as hashtag with unique styling)
   */
  private createTagChip(tag: { id: string; name: string }): HTMLElement {
    const hashtag = document.createElement('a');
    hashtag.className = 'tag-chip';
    hashtag.href = this.getTagLink(tag.id);
    hashtag.target = '_blank';
    hashtag.rel = 'noopener noreferrer';
    hashtag.style.display = 'inline-flex';
    hashtag.style.alignItems = 'center';
    hashtag.style.padding = '0';
    hashtag.style.margin = '0';
    hashtag.style.fontSize = '14px';
    hashtag.style.lineHeight = '1.4';
    hashtag.style.color = 'rgba(255, 255, 255, 0.75)';
    hashtag.style.textDecoration = 'none';
    hashtag.style.transition = 'color 0.2s ease';
    hashtag.style.cursor = 'pointer';
    hashtag.style.minHeight = '44px';
    hashtag.style.height = '44px';
    
    const handleClick = () => {
      if (this.onTagChipClick) {
        const tagId = Number.parseInt(tag.id, 10);
        if (!Number.isNaN(tagId)) {
          this.onTagChipClick(tagId, tag.name);
        }
      }
    };
    
    hashtag.addEventListener('mouseenter', () => {
      hashtag.style.color = 'rgba(255, 255, 255, 0.95)';
    });
    hashtag.addEventListener('mouseleave', () => {
      hashtag.style.color = 'rgba(255, 255, 255, 0.75)';
    });
    
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    
    if (isMobile) {
      let touchStartX: number = 0;
      let touchStartY: number = 0;
      let touchStartTime: number = 0;
      let isScrolling: boolean = false;
      const touchMoveThreshold: number = 10;
      const touchDurationThreshold: number = 300;
      
      hashtag.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        if (touch) {
          touchStartX = touch.clientX;
          touchStartY = touch.clientY;
          touchStartTime = Date.now();
          isScrolling = false;
        }
      }, { passive: true });
      
      hashtag.addEventListener('touchmove', (e) => {
        if (e.touches.length > 0) {
          const touch = e.touches[0];
          if (touch) {
            const deltaX = Math.abs(touch.clientX - touchStartX);
            const deltaY = Math.abs(touch.clientY - touchStartY);
            if (deltaX > touchMoveThreshold || deltaY > touchMoveThreshold) {
              isScrolling = true;
            }
          }
        }
      }, { passive: true });
      
      hashtag.addEventListener('touchend', (e) => {
        const touch = e.changedTouches[0];
        if (!touch) return;
        
        const deltaX = Math.abs(touch.clientX - touchStartX);
        const deltaY = Math.abs(touch.clientY - touchStartY);
        const touchDuration = Date.now() - touchStartTime;
        const totalDistance = Math.hypot(deltaX, deltaY);
        
        if (!isScrolling && 
            totalDistance < touchMoveThreshold && 
            touchDuration < touchDurationThreshold) {
          e.preventDefault();
          e.stopPropagation();
          handleClick();
        }
        
        isScrolling = false;
        touchStartX = 0;
        touchStartY = 0;
        touchStartTime = 0;
      }, { passive: false });
      
      hashtag.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleClick();
      });
    } else {
      hashtag.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleClick();
      });
    }
    
    hashtag.appendChild(document.createTextNode(`#${tag.name}`));
    return hashtag;
  }

  /**
   * Get performer link URL
   */
  private getPerformerLink(performerId: string): string {
    const baseUrl = globalThis.location.origin;
    return `${baseUrl}/performers/${performerId}`;
  }

  /**
   * Get tag link URL
   */
  private getTagLink(tagId: string): string {
    const baseUrl = globalThis.location.origin;
    return `${baseUrl}/tags/${tagId}`;
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
      const isGif = imageUrl.toLowerCase().endsWith('.gif');
      this.player = new ImagePlayer(this.playerContainer, imageUrl, { isGif });
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
   */
  getImageUrl(): string | undefined {
    if (this.data.imageUrl) {
      return this.data.imageUrl;
    }

    // Try paths.image first, then paths.preview, then paths.thumbnail
    if (this.data.image.paths?.image) {
      return toAbsoluteUrl(this.data.image.paths.image);
    }
    if (this.data.image.paths?.preview) {
      return toAbsoluteUrl(this.data.image.paths.preview);
    }
    if (this.data.image.paths?.thumbnail) {
      return toAbsoluteUrl(this.data.image.paths.thumbnail);
    }

    return undefined;
  }

  /**
   * Create footer with action buttons
   */
  private createFooter(): HTMLElement {
    const footer = document.createElement('div');
    footer.className = 'video-post__footer';
    footer.style.padding = '2px 16px';
    footer.style.position = 'relative';
    footer.style.zIndex = '10';

    const info = document.createElement('div');
    info.className = 'video-post__info';
    info.style.gap = '0';
    info.style.display = 'flex';
    info.style.flexDirection = 'row';
    info.style.justifyContent = 'flex-end';
    info.style.position = 'relative';
    info.style.zIndex = '10';

    const row = document.createElement('div');
    row.className = 'video-post__row';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'flex-end';
    row.style.gap = '4px';
    row.style.position = 'relative';
    row.style.zIndex = '10';

    const buttonGroup = document.createElement('div');
    buttonGroup.style.display = 'flex';
    buttonGroup.style.alignItems = 'center';
    buttonGroup.style.gap = '4px';
    buttonGroup.style.position = 'relative';
    buttonGroup.style.zIndex = '10';
    this.buttonGroup = buttonGroup;

    // Heart button (favorite)
    if (this.favoritesManager) {
      this.heartButton = this.createHeartButton();
      buttonGroup.appendChild(this.heartButton);
    }

    // Add tag button
    if (this.api) {
      this.addTagButton = this.createAddTagButton();
      buttonGroup.appendChild(this.addTagButton);
    }

    // O-count button
    if (this.api) {
      this.oCountButton = this.createOCountButton();
      buttonGroup.appendChild(this.oCountButton);
    }

    row.appendChild(buttonGroup);
    info.appendChild(row);
    footer.appendChild(info);
    return footer;
  }

  /**
   * Apply common icon button styles
   */
  private applyIconButtonStyles(button: HTMLElement): void {
    button.style.background = 'transparent';
    button.style.border = 'none';
    button.style.cursor = 'pointer';
    button.style.display = 'flex';
    button.style.alignItems = 'center';
    button.style.justifyContent = 'center';
    button.style.color = 'rgba(255, 255, 255, 0.7)';
    button.style.transition = 'none';
    button.style.width = '44px';
    button.style.height = '44px';
    button.style.minWidth = '44px';
    button.style.minHeight = '44px';
    button.style.position = 'relative';
    button.style.zIndex = '11';
    button.style.pointerEvents = 'auto';
  }

  /**
   * Add hover effect to a button element - CRITICAL: Only affects icon, not container
   */
  private addHoverEffect(button: HTMLElement): void {
    const getIconElement = (): HTMLElement | SVGElement | null => {
      const svg = button.querySelector('svg');
      if (svg) return svg as SVGElement;
      const firstChild = button.firstElementChild as HTMLElement;
      if (firstChild) return firstChild;
      return null;
    };

    const mouseenter = () => {
      if (!(button instanceof HTMLButtonElement) || !button.disabled) {
        const icon = getIconElement();
        if (icon) {
          icon.style.transform = 'scale(1.1)';
          icon.style.transition = 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)';
        }
      }
    };
    const mouseleave = () => {
      const icon = getIconElement();
      if (icon) {
        icon.style.transform = 'scale(1)';
      }
    };
    
    button.addEventListener('mouseenter', mouseenter);
    button.addEventListener('mouseleave', mouseleave);
    
    this.hoverHandlers.set(button, { mouseenter, mouseleave });
  }

  /**
   * Remove hover effect from a button element
   */
  private removeHoverEffect(button: HTMLElement): void {
    const handlers = this.hoverHandlers.get(button);
    if (handlers) {
      button.removeEventListener('mouseenter', handlers.mouseenter);
      button.removeEventListener('mouseleave', handlers.mouseleave);
      this.hoverHandlers.delete(button);
    }
  }

  /**
   * Create heart button for favorites
   */
  private createHeartButton(): HTMLElement {
    const heartBtn = document.createElement('button');
    heartBtn.className = 'icon-btn icon-btn--heart';
    heartBtn.type = 'button';
    heartBtn.setAttribute('aria-label', 'Toggle favorite');
    heartBtn.title = 'Add to favorites';
    this.applyIconButtonStyles(heartBtn);
    heartBtn.style.padding = '0';
    heartBtn.style.width = '56px';
    heartBtn.style.height = '56px';
    heartBtn.style.minWidth = '56px';
    heartBtn.style.minHeight = '56px';
    heartBtn.style.flexShrink = '0';

    this.updateHeartButton(heartBtn);

    const clickHandler = async (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (this.isTogglingFavorite) {
        return;
      }

      this.isTogglingFavorite = true;
      heartBtn.disabled = true;
      heartBtn.style.opacity = '0.5';

      try {
        await this.toggleFavorite();
      } catch (error) {
        console.error('ImagePost: Error in click handler', error);
      } finally {
        this.isTogglingFavorite = false;
        heartBtn.disabled = false;
        heartBtn.style.opacity = '1';
      }
    };

    heartBtn.addEventListener('click', clickHandler);
    this.addHoverEffect(heartBtn);
    this.heartButton = heartBtn;
    return heartBtn;
  }

  /**
   * Create add tag button
   */
  private createAddTagButton(): HTMLElement {
    const addTagBtn = document.createElement('button');
    addTagBtn.className = 'icon-btn icon-btn--add-tag';
    addTagBtn.type = 'button';
    addTagBtn.setAttribute('aria-label', 'Add tag');
    addTagBtn.title = 'Add tag to image';
    this.applyIconButtonStyles(addTagBtn);
    addTagBtn.style.padding = '0';
    addTagBtn.innerHTML = ADD_TAG_SVG;

    const clickHandler = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      this.openAddTagDialog();
    };

    addTagBtn.addEventListener('click', clickHandler);
    this.addHoverEffect(addTagBtn);
    this.addTagButton = addTagBtn;
    return addTagBtn;
  }

  /**
   * Create O-count button
   */
  private createOCountButton(): HTMLElement {
    const oCountBtn = document.createElement('button');
    oCountBtn.className = 'icon-btn icon-btn--ocount';
    oCountBtn.type = 'button';
    oCountBtn.setAttribute('aria-label', 'Increment o count');
    oCountBtn.title = 'Increment o-count';
    this.applyIconButtonStyles(oCountBtn);
    oCountBtn.style.padding = '5px 7px';
    oCountBtn.style.gap = '3px';
    oCountBtn.style.flexShrink = '1';
    oCountBtn.style.minHeight = '44px';
    oCountBtn.style.height = 'auto';
    oCountBtn.style.fontSize = '16px';
    oCountBtn.style.width = 'auto';
    oCountBtn.style.minWidth = '44px';
    
    this.oCountButton = oCountBtn;
    this.updateOCountButton();

    const clickHandler = async (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (!this.api) return;

      oCountBtn.disabled = true;
      oCountBtn.style.opacity = '0.5';

      try {
        await this.incrementOCount();
      } finally {
        oCountBtn.disabled = false;
        oCountBtn.style.opacity = '1';
      }
    };

    oCountBtn.addEventListener('click', clickHandler);
    this.addHoverEffect(oCountBtn);
    return oCountBtn;
  }

  /**
   * Update O-count button display
   */
  private updateOCountButton(): void {
    if (!this.oCountButton) return;
    
    const digitCount = this.oCount > 0 ? this.oCount.toString().length : 0;
    const minWidth = digitCount > 0 ? `${Math.max(OCOUNT_MIN_WIDTH_PX, digitCount * OCOUNT_DIGIT_WIDTH_PX)}px` : `${OCOUNT_MIN_WIDTH_PX}px`;
    
    // Find existing countSpan or create new one
    let countSpan = this.oCountButton.querySelector('span') as HTMLSpanElement;
    if (!countSpan) {
      countSpan = document.createElement('span');
      countSpan.style.fontSize = '14px';
      countSpan.style.fontWeight = '500';
      countSpan.style.textAlign = 'left';
      countSpan.style.display = 'inline-block';
      this.oCountButton.innerHTML = OCOUNT_SVG;
      this.oCountButton.appendChild(countSpan);
    }
    
    countSpan.style.minWidth = minWidth;
    countSpan.textContent = this.oCount > 0 ? this.oCount.toString() : '-';
    
    if (digitCount >= 3) {
      this.oCountButton.style.paddingRight = `${OCOUNT_THREE_DIGIT_PADDING}px`;
    } else {
      this.oCountButton.style.paddingRight = `${OCOUNT_DEFAULT_PADDING}px`;
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
   * Update heart button appearance based on favorite state
   */
  private updateHeartButton(button?: HTMLElement): void {
    const btn = button || this.heartButton;
    if (!btn) return;
    
    if (this.isFavorite) {
      btn.innerHTML = HEART_SVG_FILLED;
      btn.style.color = '#ff6b9d';
      btn.title = 'Remove from favorites';
    } else {
      btn.innerHTML = HEART_SVG_OUTLINE;
      btn.style.color = 'rgba(255, 255, 255, 0.7)';
      btn.title = 'Add to favorites';
    }
  }

  /**
   * Increment O-count
   */
  private async incrementOCount(): Promise<void> {
    if (!this.api) return;
    
    try {
      // Image ID is already a string
      const newOCount = await this.api.incrementImageOCount(this.data.image.id);
      this.oCount = newOCount;
      this.data.image.o_counter = newOCount;
      this.updateOCountButton();
    } catch (error) {
      console.error('ImagePost: Failed to increment O-count', error);
      showToast('Failed to update o-count. Please try again.');
    }
  }

  /**
   * Check favorite status
   */
  private async checkFavoriteStatus(): Promise<void> {
    this.isFavorite = this.data.image.tags?.some((tag) => tag.name === FAVORITE_TAG_NAME) ?? false;
    this.updateHeartButton();
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
  private openAddTagDialog(): void {
    if (this.isAddTagDialogOpen) return;

    if (!this.addTagDialog) {
      this.createAddTagDialog();
    }

    if (!this.addTagDialog || !this.buttonGroup) return;

    this.isAddTagDialogOpen = true;
    this.selectedTagId = undefined;
    this.selectedTagName = undefined;
    if (this.addTagDialogInput) {
      this.addTagDialogInput.value = '';
    }

    this.updateAddTagDialogState();

    // Position dialog relative to button group
    this.buttonGroup.style.position = 'relative';
    if (!this.addTagDialog.parentElement) {
      this.buttonGroup.appendChild(this.addTagDialog);
    }

    if (this.addTagDialog) {
      this.addTagDialog.hidden = false;
      this.addTagDialog.setAttribute('aria-hidden', 'false');
      this.addTagDialog.style.opacity = '1';
      this.addTagDialog.style.transform = 'translateX(-50%) translateY(0) scale(1)';
      this.addTagDialog.style.pointerEvents = 'auto';
      
      // Adjust position to keep dialog within card boundaries
      requestAnimationFrame(() => {
        this.adjustDialogPosition(this.addTagDialog!);
      });
    }

    document.addEventListener('mousedown', this.onAddTagDialogOutsideClick);
    document.addEventListener('touchstart', this.onAddTagDialogOutsideClick);
    document.addEventListener('keydown', this.onAddTagDialogKeydown);

    // Focus input
    requestAnimationFrame(() => {
      this.addTagDialogInput?.focus();
    });
  }

  /**
   * Create add tag dialog
   */
  private createAddTagDialog(): void {
    const dialog = document.createElement('div');
    dialog.className = 'add-tag-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-hidden', 'true');
    dialog.hidden = true;
    dialog.style.position = 'absolute';
    dialog.style.bottom = 'calc(100% + 6px)';
    dialog.style.left = '50%';
    dialog.style.transform = 'translateX(-50%)';
    dialog.style.width = '320px';
    dialog.style.maxWidth = 'calc(100vw - 32px)';
    dialog.style.background = 'rgba(28, 28, 30, 0.98)';
    dialog.style.backdropFilter = 'blur(20px) saturate(180%)';
    dialog.style.border = '1px solid rgba(255, 255, 255, 0.12)';
    dialog.style.borderRadius = '12px';
    dialog.style.padding = '16px';
    dialog.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.4)';
    dialog.style.zIndex = '200';
    dialog.style.opacity = '0';
    dialog.style.transform = 'translateX(-50%) translateY(4px) scale(0.96)';
    dialog.style.pointerEvents = 'none';
    dialog.style.transition = 'opacity 0.2s cubic-bezier(0.2, 0, 0, 1), transform 0.2s cubic-bezier(0.2, 0, 0, 1)';
    dialog.style.boxSizing = 'border-box';
    this.addTagDialog = dialog;

    // Title
    const title = document.createElement('div');
    title.textContent = 'Add Tag';
    title.style.fontSize = '16px';
    title.style.fontWeight = '600';
    title.style.color = 'rgba(255, 255, 255, 0.9)';
    title.style.marginBottom = '12px';
    dialog.appendChild(title);

    // Input wrapper
    const inputWrapper = document.createElement('div');
    inputWrapper.style.position = 'relative';
    inputWrapper.style.marginBottom = '12px';

    // Tag input
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Search for tag...';
    input.style.width = '100%';
    input.style.padding = '10px 12px';
    input.style.background = 'rgba(255, 255, 255, 0.08)';
    input.style.border = '1px solid rgba(255, 255, 255, 0.12)';
    input.style.borderRadius = '8px';
    input.style.color = 'rgba(255, 255, 255, 0.9)';
    input.style.fontSize = '14px';
    input.style.boxSizing = 'border-box';
    input.setAttribute('aria-label', 'Tag name');
    this.addTagDialogInput = input;

    input.addEventListener('input', () => {
      this.handleAddTagInput();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.selectedTagId && this.addTagDialogCreateButton && !this.addTagDialogCreateButton.disabled) {
        e.preventDefault();
        void this.addTagToImage();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.closeAddTagDialog();
      }
    });

    inputWrapper.appendChild(input);

    // Suggestions dropdown
    const suggestions = document.createElement('div');
    suggestions.className = 'add-tag-dialog__suggestions';
    suggestions.style.display = 'none';
    suggestions.style.position = 'absolute';
    suggestions.style.top = '100%';
    suggestions.style.left = '0';
    suggestions.style.right = '0';
    suggestions.style.background = 'rgba(28, 28, 30, 0.98)';
    suggestions.style.border = '1px solid rgba(255, 255, 255, 0.12)';
    suggestions.style.borderTop = 'none';
    suggestions.style.borderRadius = '0 0 8px 8px';
    suggestions.style.maxHeight = '200px';
    suggestions.style.overflowY = 'auto';
    suggestions.style.zIndex = '201';
    suggestions.style.marginTop = '4px';
    this.addTagDialogSuggestions = suggestions;
    inputWrapper.appendChild(suggestions);

    dialog.appendChild(inputWrapper);

    // Button container
    const buttonContainer = document.createElement('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.gap = '8px';
    buttonContainer.style.justifyContent = 'flex-end';

    // Cancel button
    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.style.padding = '8px 16px';
    cancelButton.style.borderRadius = '8px';
    cancelButton.style.border = '1px solid rgba(255, 255, 255, 0.2)';
    cancelButton.style.background = 'transparent';
    cancelButton.style.color = 'rgba(255, 255, 255, 0.9)';
    cancelButton.style.cursor = 'pointer';
    cancelButton.style.fontSize = '14px';
    cancelButton.addEventListener('click', () => this.closeAddTagDialog());
    buttonContainer.appendChild(cancelButton);

    // Add button
    const addButton = document.createElement('button');
    addButton.id = 'add-tag-dialog-action-button';
    addButton.textContent = 'Add';
    addButton.style.padding = '8px 16px';
    addButton.style.borderRadius = '8px';
    addButton.style.border = 'none';
    addButton.style.background = '#F5C518';
    addButton.style.color = '#000000';
    addButton.style.cursor = 'pointer';
    addButton.style.fontSize = '14px';
    addButton.style.fontWeight = '600';
    addButton.disabled = true;
    addButton.style.opacity = '0.5';
    this.addTagDialogCreateButton = addButton;
    addButton.addEventListener('click', () => {
      void this.addTagToImage();
    });
    buttonContainer.appendChild(addButton);

    dialog.appendChild(buttonContainer);
  }

  /**
   * Close add tag dialog
   */
  private closeAddTagDialog(): void {
    if (!this.isAddTagDialogOpen) return;
    this.isAddTagDialogOpen = false;

    if (this.autocompleteDebounceTimer) {
      clearTimeout(this.autocompleteDebounceTimer);
      this.autocompleteDebounceTimer = undefined;
    }
    if (this.tagSearchLoadingTimer) {
      clearTimeout(this.tagSearchLoadingTimer);
      this.tagSearchLoadingTimer = undefined;
    }

    if (this.addTagDialog) {
      this.addTagDialog.style.opacity = '0';
      this.addTagDialog.style.transform = 'translateX(-50%) translateY(4px) scale(0.96)';
      this.addTagDialog.style.pointerEvents = 'none';
      setTimeout(() => {
        if (this.addTagDialog && !this.isAddTagDialogOpen) {
          this.addTagDialog.hidden = true;
          this.addTagDialog.setAttribute('aria-hidden', 'true');
        }
      }, 200);
    }

    if (this.addTagDialogSuggestions) {
      this.addTagDialogSuggestions.style.display = 'none';
    }

    document.removeEventListener('mousedown', this.onAddTagDialogOutsideClick);
    document.removeEventListener('touchstart', this.onAddTagDialogOutsideClick);
    document.removeEventListener('keydown', this.onAddTagDialogKeydown);
  }

  /**
   * Handle clicks outside add tag dialog
   */
  private readonly onAddTagDialogOutsideClick = (event: Event): void => {
    if (!this.isAddTagDialogOpen || !this.addTagDialog) return;
    const target = event.target as Node | null;
    if (target && this.addTagDialog.contains(target)) {
      return;
    }
    this.closeAddTagDialog();
  };

  /**
   * Handle keyboard events for add tag dialog
   */
  private readonly onAddTagDialogKeydown = (event: KeyboardEvent): void => {
    if (!this.isAddTagDialogOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeAddTagDialog();
      this.addTagButton?.focus();
    }
  };

  /**
   * Handle tag input for autocomplete
   */
  private handleAddTagInput(): void {
    if (!this.addTagDialogInput) return;

    const searchTerm = this.addTagDialogInput.value.trim();
    this.selectedTagId = undefined;
    this.selectedTagName = undefined;
    this.updateAddTagDialogState();

    if (this.autocompleteDebounceTimer) {
      clearTimeout(this.autocompleteDebounceTimer);
    }
    if (this.tagSearchLoadingTimer) {
      clearTimeout(this.tagSearchLoadingTimer);
      this.tagSearchLoadingTimer = undefined;
    }

    if (searchTerm.length === 0) {
      if (this.addTagDialogSuggestions) {
        this.addTagDialogSuggestions.style.display = 'none';
      }
      return;
    }

    this.autocompleteDebounceTimer = setTimeout(() => {
      void this.searchTagsForImage(searchTerm);
    }, 250);
  }

  /**
   * Search tags for image
   */
  private async searchTagsForImage(searchTerm: string): Promise<void> {
    if (!this.api || !this.addTagDialogSuggestions) return;

    if (!this.addTagDialogSuggestions) {
      this.addTagDialogSuggestions = document.createElement('div');
    }

    try {
      const tags = await this.api.findTagsForSelect(searchTerm, 10);
      this.addTagDialogSuggestions.innerHTML = '';
      this.addTagDialogSuggestions.style.display = tags.length > 0 ? 'block' : 'none';

      for (const tag of tags) {
        const item = document.createElement('div');
        item.style.padding = '10px 12px';
        item.style.cursor = 'pointer';
        item.style.color = 'rgba(255, 255, 255, 0.9)';
        item.style.fontSize = '14px';
        item.style.borderBottom = '1px solid rgba(255, 255, 255, 0.1)';
        item.textContent = tag.name;
        item.addEventListener('mouseenter', () => {
          item.style.background = 'rgba(255, 255, 255, 0.1)';
        });
        item.addEventListener('mouseleave', () => {
          item.style.background = 'transparent';
        });
        item.addEventListener('click', () => {
          this.selectedTagId = tag.id;
          this.selectedTagName = tag.name;
          if (this.addTagDialogInput) {
            this.addTagDialogInput.value = tag.name;
          }
          this.updateAddTagDialogState();
          this.addTagDialogSuggestions!.style.display = 'none';
        });
        this.addTagDialogSuggestions.appendChild(item);
      }
    } catch (error) {
      console.error('ImagePost: Failed to search tags', error);
    }
  }

  /**
   * Update add tag dialog state
   */
  private updateAddTagDialogState(): void {
    if (!this.addTagDialogCreateButton) return;
    const hasSelection = !!this.selectedTagId && !!this.selectedTagName;
    this.addTagDialogCreateButton.disabled = !hasSelection;
    this.addTagDialogCreateButton.style.opacity = hasSelection ? '1' : '0.5';
  }

  /**
   * Add tag to image
   */
  private async addTagToImage(): Promise<void> {
    if (!this.api || !this.selectedTagId || !this.selectedTagName) return;
    if (!this.addTagDialogCreateButton) return;

    this.addTagDialogCreateButton.disabled = true;
    this.addTagDialogCreateButton.textContent = 'Adding...';
    this.addTagDialogCreateButton.style.opacity = '0.6';

    try {
      // Check if tag is already added
      const currentTagIds = (this.data.image.tags || []).map(t => t.id).filter(Boolean);
      if (currentTagIds.includes(this.selectedTagId)) {
        showToast(`Tag "${this.selectedTagName}" is already added to this image.`);
        this.addTagDialogCreateButton.disabled = false;
        this.addTagDialogCreateButton.textContent = 'Add';
        this.addTagDialogCreateButton.style.opacity = '1';
        return;
      }

      // Add tag to image
      const nextTagIds = [...currentTagIds, this.selectedTagId];
      await this.api.updateImageTags(this.data.image.id, nextTagIds);

      // Update local image tags
      this.data.image.tags ??= [];
      this.data.image.tags.push({ id: this.selectedTagId, name: this.selectedTagName });

      showToast(`Tag "${this.selectedTagName}" added to image`);
      
      // Refresh header to show new tag chip
      this.refreshHeader();
      
      this.closeAddTagDialog();
    } catch (error) {
      console.error('ImagePost: Failed to add tag to image', error);
      showToast('Failed to add tag. Please try again.');
      this.addTagDialogCreateButton.disabled = false;
      this.addTagDialogCreateButton.textContent = 'Add';
      this.addTagDialogCreateButton.style.opacity = '1';
    }
  }

  /**
   * Refresh header to show updated tags
   */
  private refreshHeader(): void {
    const header = this.container.querySelector('.video-post__header');
    if (header) {
      const newHeader = this.createHeader();
      header.replaceWith(newHeader);
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
   * Destroy the post
   */
  destroy(): void {
    // Close dialog if open
    if (this.isAddTagDialogOpen) {
      this.closeAddTagDialog();
    }

    // Clean up timers
    if (this.autocompleteDebounceTimer) {
      clearTimeout(this.autocompleteDebounceTimer);
      this.autocompleteDebounceTimer = undefined;
    }
    if (this.tagSearchLoadingTimer) {
      clearTimeout(this.tagSearchLoadingTimer);
      this.tagSearchLoadingTimer = undefined;
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

