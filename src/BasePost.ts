/**
 * Base Post Component
 * Shared functionality for VideoPost and ImagePost
 */

import { FavoritesManager } from './FavoritesManager.js';
import { StashAPI } from './StashAPI.js';
import { VisibilityManager } from './VisibilityManager.js';
import { toAbsoluteUrl, showToast, isMobileDevice } from './utils.js';
import { VERIFIED_CHECKMARK_SVG, ADD_TAG_SVG, HEART_SVG_OUTLINE, HEART_SVG_FILLED, OCOUNT_SVG } from './icons.js';
import { setupTouchHandlers, preventClickAfterTouch } from './utils/touchHandlers.js';

interface HoverHandlers {
  mouseenter: () => void;
  mouseleave: () => void;
}

/**
 * Base class for post components (VideoPost and ImagePost)
 * Contains shared functionality to reduce code duplication
 */
export abstract class BasePost {
  protected readonly container: HTMLElement;
  protected readonly favoritesManager?: FavoritesManager;
  protected readonly api?: StashAPI;
  protected readonly visibilityManager?: VisibilityManager;
  protected readonly hoverHandlers: Map<HTMLElement, HoverHandlers> = new Map();
  protected readonly onPerformerChipClick?: (performerId: number, performerName: string) => void;
  protected readonly onTagChipClick?: (tagId: number, tagName: string) => void;
  protected addTagButton?: HTMLElement;
  protected heartButton?: HTMLElement;
  protected isFavorite: boolean = false;
  protected isTogglingFavorite: boolean = false;
  protected oCountButton?: HTMLElement;
  protected oCount: number = 0;

  constructor(
    container: HTMLElement,
    favoritesManager?: FavoritesManager,
    api?: StashAPI,
    visibilityManager?: VisibilityManager,
    onPerformerChipClick?: (performerId: number, performerName: string) => void,
    onTagChipClick?: (tagId: number, tagName: string) => void
  ) {
    this.container = container;
    this.favoritesManager = favoritesManager;
    this.api = api;
    this.visibilityManager = visibilityManager;
    this.onPerformerChipClick = onPerformerChipClick;
    this.onTagChipClick = onTagChipClick;
  }

  /**
   * Get link to performer page
   */
  protected getPerformerLink(performerId: string): string {
    return `${globalThis.location.origin}/performers/${performerId}`;
  }

  /**
   * Get link to tag page
   */
  protected getTagLink(tagId: string): string {
    return `${globalThis.location.origin}/tags/${tagId}`;
  }

  /**
   * Apply common icon button styles
   */
  protected applyIconButtonStyles(button: HTMLElement): void {
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
  }

  /**
   * Add hover effect to a button element - CRITICAL: Only affects icon, not container
   */
  protected addHoverEffect(button: HTMLElement): void {
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
  protected removeHoverEffect(button: HTMLElement): void {
    const handlers = this.hoverHandlers.get(button);
    if (handlers) {
      button.removeEventListener('mouseenter', handlers.mouseenter);
      button.removeEventListener('mouseleave', handlers.mouseleave);
      this.hoverHandlers.delete(button);
    }
  }

  /**
   * Create a performer chip element
   */
  protected createPerformerChip(performer: { id: string; name: string; image_path?: string }): HTMLElement {
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
    
    const isMobile = isMobileDevice();
    
    if (isMobile) {
      // Use unified touch handler utility
      setupTouchHandlers(chip, {
        onTap: (e) => {
          e.preventDefault();
          e.stopPropagation();
          handleClick();
        },
        preventDefault: true,
        stopPropagation: true,
      });
      
      // Prevent click event from firing after touch to avoid double-firing
      preventClickAfterTouch(chip);
    }
    
    // Desktop click handler
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleClick();
    });
    
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
  protected createTagChip(tag: { id: string; name: string }): HTMLElement {
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
    
    const isMobile = isMobileDevice();
    
    if (isMobile) {
      // Use unified touch handler utility
      setupTouchHandlers(hashtag, {
        onTap: (e) => {
          e.preventDefault();
          e.stopPropagation();
          handleClick();
        },
        preventDefault: true,
        stopPropagation: true,
      });
      
      // Prevent click event from firing after touch to avoid double-firing
      preventClickAfterTouch(hashtag);
    }
    
    // Desktop click handler
    hashtag.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleClick();
    });
    
    hashtag.appendChild(document.createTextNode(`#${tag.name}`));
    return hashtag;
  }

  /**
   * Abstract method to open add tag dialog - must be implemented by subclasses
   */
  protected abstract openAddTagDialog(): void;

  /**
   * Abstract method to perform favorite toggle action - must be implemented by subclasses
   */
  protected abstract toggleFavoriteAction(): Promise<boolean>;

  /**
   * Abstract method to increment O-count - must be implemented by subclasses
   */
  protected abstract incrementOCountAction(): Promise<void>;

  /**
   * Abstract method to get favorite tag source - must be implemented by subclasses
   * Returns the tags array to check for favorite tag
   */
  protected abstract getFavoriteTagSource(): Array<{ name: string }> | undefined;

  /**
   * Optional method to update local tags after favorite toggle - only VideoPost implements this
   */
  protected async updateLocalTagsAfterFavoriteToggle(newFavoriteState: boolean): Promise<void> {
    // Default implementation does nothing - VideoPost overrides this
  }

  /**
   * Create add tag button - shared implementation
   */
  protected createAddTagButton(title: string = 'Add tag'): HTMLElement {
    const addTagBtn = document.createElement('button');
    addTagBtn.className = 'icon-btn icon-btn--add-tag';
    addTagBtn.type = 'button';
    addTagBtn.setAttribute('aria-label', 'Add tag');
    addTagBtn.title = title;
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
   * Create heart button for favorites - shared implementation
   */
  protected createHeartButton(): HTMLElement {
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
        const newFavoriteState = await this.toggleFavoriteAction();
        this.isFavorite = newFavoriteState;
        await this.updateLocalTagsAfterFavoriteToggle(newFavoriteState);
        this.updateHeartButton(heartBtn);
      } catch (error) {
        console.error('Failed to toggle favorite', error);
        showToast('Failed to update favorite. Please try again.');
        // Revert UI state
        this.isFavorite = !this.isFavorite;
        this.updateHeartButton(heartBtn);
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
   * Update heart button appearance based on favorite state - shared implementation
   */
  protected updateHeartButton(button?: HTMLElement): void {
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
   * Create O-count button - shared implementation
   */
  protected createOCountButton(): HTMLElement {
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
        await this.incrementOCountAction();
        this.updateOCountButton();
      } catch (error) {
        console.error('Failed to increment o count', error);
        showToast('Failed to update o-count. Please try again.');
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
   * Update O-count button display - shared implementation
   */
  protected updateOCountButton(): void {
    if (!this.oCountButton) return;
    
    const OCOUNT_MIN_WIDTH_PX = 14;
    const OCOUNT_DIGIT_WIDTH_PX = 8;
    
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
  }

  /**
   * Check favorite status - shared implementation
   */
  protected async checkFavoriteStatus(): Promise<void> {
    const tags = this.getFavoriteTagSource();
    this.isFavorite = tags?.some((tag) => tag.name === 'StashGifs Favorite') ?? false;
    
    // Update heart button if it exists
    if (this.heartButton) {
      this.updateHeartButton(this.heartButton);
    }
  }
}

