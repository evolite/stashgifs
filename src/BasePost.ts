/**
 * Base Post Component
 * Shared functionality for VideoPost and ImagePost
 */

import { FavoritesManager } from './FavoritesManager.js';
import { StashAPI } from './StashAPI.js';
import { VisibilityManager } from './VisibilityManager.js';
import { toAbsoluteUrl } from './utils.js';
import { VERIFIED_CHECKMARK_SVG } from './icons.js';

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
}

