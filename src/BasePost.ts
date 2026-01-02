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
import { PerformerExtended } from './graphql/types.js';

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
  // Performer overlay properties
  private performerOverlay?: HTMLElement;
  private performerOverlayTimeout?: number;
  private performerOverlayHideTimeout?: number;
  private currentHoveredPerformerId?: string;
  private performerOverlayAbortController?: AbortController;
  private hadOverlayBefore: boolean = false; // Track if overlay was showing before (for delay logic)
  private performerOverlayScrollHandler?: () => void;

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
    
    // Setup scroll listener to hide overlay when scrolling
    this.setupPerformerOverlayScrollListener();
  }

  /**
   * Setup scroll listener to hide performer overlay when user scrolls
   */
  private setupPerformerOverlayScrollListener(): void {
    this.performerOverlayScrollHandler = () => {
      if (this.performerOverlay) {
        this.hidePerformerOverlay(true);
      }
    };
    
    globalThis.addEventListener('scroll', this.performerOverlayScrollHandler, { passive: true });
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
      // Hide overlay when clicking to filter
      this.hidePerformerOverlay(true);
      
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
        img.style.objectPosition = 'top center';
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

    // Add hover overlay handlers
    if (this.api && !isMobile) {
      chip.addEventListener('mouseenter', () => {
        // Cancel any pending hide timeout (when moving from another chip)
        if (this.performerOverlayHideTimeout) {
          clearTimeout(this.performerOverlayHideTimeout);
          this.performerOverlayHideTimeout = undefined;
        }
        this.showPerformerOverlay(performer.id, chip);
      });
      chip.addEventListener('mouseleave', (e) => {
        // Check if we're moving to another performer chip
        const relatedTarget = e.relatedTarget as HTMLElement | null;
        const isMovingToAnotherChip = relatedTarget?.closest('.performer-chip') !== null;
        
        if (!isMovingToAnotherChip) {
          // Small delay to allow mouse to move to overlay
          this.performerOverlayHideTimeout = setTimeout(() => {
            if (!this.performerOverlay?.matches(':hover')) {
              this.hidePerformerOverlay();
            }
            this.performerOverlayHideTimeout = undefined;
          }, 100) as unknown as number;
        }
      });
    }
    
    return chip;
  }

  /**
   * Create image section for performer overlay
   */
  private createPerformerOverlayImageSection(performerData: PerformerExtended): HTMLElement {
    const imageSection = document.createElement('div');
    imageSection.style.width = '100%';
    imageSection.style.height = '200px';
    imageSection.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
    imageSection.style.display = 'flex';
    imageSection.style.alignItems = 'center';
    imageSection.style.justifyContent = 'center';
    imageSection.style.overflow = 'hidden';
    imageSection.style.borderRadius = '8px 8px 0 0';

    if (performerData.image_path) {
      const imageSrc = performerData.image_path.startsWith('http')
        ? performerData.image_path
        : toAbsoluteUrl(performerData.image_path);
      if (imageSrc) {
        const img = document.createElement('img');
        img.src = imageSrc;
        img.alt = performerData.name;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.objectPosition = 'top center';
        imageSection.appendChild(img);
        return imageSection;
      }
    }
    imageSection.textContent = performerData.name.charAt(0).toUpperCase();
    imageSection.style.fontSize = '64px';
    imageSection.style.color = 'rgba(255, 255, 255, 0.5)';
    return imageSection;
  }

  /**
   * Create name row for performer overlay
   */
  private createPerformerOverlayNameRow(performerData: PerformerExtended): HTMLElement {
    const nameRow = document.createElement('div');
    nameRow.style.display = 'flex';
    nameRow.style.alignItems = 'center';
    nameRow.style.gap = '8px';
    nameRow.style.marginBottom = '12px';

    const nameLink = document.createElement('a');
    nameLink.href = this.getPerformerLink(performerData.id);
    nameLink.target = '_blank';
    nameLink.rel = 'noopener noreferrer';
    nameLink.style.display = 'flex';
    nameLink.style.alignItems = 'center';
    nameLink.style.gap = '6px';
    nameLink.style.textDecoration = 'none';
    nameLink.style.color = '#FFFFFF';
    nameLink.style.cursor = 'pointer';
    nameLink.addEventListener('mouseenter', () => {
      nameLink.style.color = '#4A9EFF';
    });
    nameLink.addEventListener('mouseleave', () => {
      nameLink.style.color = '#FFFFFF';
    });

    const name = document.createElement('h3');
    name.textContent = performerData.name;
    name.style.margin = '0';
    name.style.fontSize = '20px';
    name.style.fontWeight = '600';
    nameLink.appendChild(name);

    const externalIcon = document.createElement('span');
    externalIcon.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>';
    externalIcon.style.display = 'inline-flex';
    externalIcon.style.alignItems = 'center';
    externalIcon.style.opacity = '0.7';
    externalIcon.style.flexShrink = '0';
    nameLink.appendChild(externalIcon);

    nameRow.appendChild(nameLink);

    if (performerData.favorite) {
      const favoriteIcon = document.createElement('span');
      favoriteIcon.innerHTML = HEART_SVG_FILLED;
      favoriteIcon.style.display = 'inline-flex';
      favoriteIcon.style.alignItems = 'center';
      favoriteIcon.style.width = '20px';
      favoriteIcon.style.height = '20px';
      favoriteIcon.style.color = '#FF6B6B';
      const svg = favoriteIcon.querySelector('svg');
      if (svg) {
        svg.setAttribute('width', '20');
        svg.setAttribute('height', '20');
      }
      nameRow.appendChild(favoriteIcon);
    }

    return nameRow;
  }

  /**
   * Get gender icon for performer
   */
  private getGenderIcon(gender: string): string {
    const genderMap: Record<string, string> = {
      'FEMALE': '♀',
      'MALE': '♂',
      'TRANSGENDER_FEMALE': '⚧♀',
      'TRANSGENDER_MALE': '⚧♂',
      'NON_BINARY': '⚧',
      'INTERSEX': '⚥'
    };
    const genderUpper = gender.toUpperCase();
    return genderMap[genderUpper] ?? gender;
  }

  /**
   * Add basic info metadata (age, gender, country)
   */
  private addBasicInfoMetadata(
    metadata: Array<{ label: string; value: string | undefined; isIcon?: boolean }>,
    performerData: PerformerExtended
  ): void {
    if (performerData.birthdate) {
      const birthDate = new Date(performerData.birthdate);
      const age = Math.floor((Date.now() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
      metadata.push({ label: 'Age', value: `${age} years` });
    }
    if (performerData.gender) {
      const genderIcon = this.getGenderIcon(performerData.gender);
      metadata.push({ label: 'Gender', value: genderIcon, isIcon: true });
    }
    if (performerData.country) {
      metadata.push({ label: 'Country', value: performerData.country });
    }
  }

  /**
   * Add physical attributes metadata
   */
  private addPhysicalAttributesMetadata(
    metadata: Array<{ label: string; value: string | undefined; isIcon?: boolean }>,
    performerData: PerformerExtended
  ): void {
    if (performerData.height_cm) {
      const heightInches = Math.round(performerData.height_cm / 2.54);
      const feet = Math.floor(heightInches / 12);
      const inches = heightInches % 12;
      metadata.push({ label: 'Height', value: `${feet}'${inches}" (${performerData.height_cm} cm)` });
    }
    if (performerData.weight) {
      metadata.push({ label: 'Weight', value: `${performerData.weight} kg` });
    }
    if (performerData.measurements) {
      metadata.push({ label: 'Measurements', value: performerData.measurements });
    }
    if (performerData.hair_color) {
      metadata.push({ label: 'Hair', value: performerData.hair_color });
    }
    if (performerData.eye_color) {
      metadata.push({ label: 'Eyes', value: performerData.eye_color });
    }
    if (performerData.ethnicity) {
      metadata.push({ label: 'Ethnicity', value: performerData.ethnicity });
    }
  }

  /**
   * Add rating metadata
   */
  private addRatingMetadata(
    metadata: Array<{ label: string; value: string | undefined; isIcon?: boolean }>,
    performerData: PerformerExtended
  ): void {
    if (performerData.rating100 !== undefined && performerData.rating100 !== null) {
      const rating = (performerData.rating100 / 20).toFixed(1);
      metadata.push({ label: 'Rating', value: `${rating}/5` });
    }
  }

  /**
   * Build metadata array for performer overlay
   */
  private buildPerformerMetadata(performerData: PerformerExtended): Array<{ label: string; value: string | undefined; isIcon?: boolean }> {
    const metadata: Array<{ label: string; value: string | undefined; isIcon?: boolean }> = [];

    this.addBasicInfoMetadata(metadata, performerData);
    this.addPhysicalAttributesMetadata(metadata, performerData);
    this.addRatingMetadata(metadata, performerData);

    return metadata;
  }

  /**
   * Create metadata section for performer overlay
   */
  private createPerformerOverlayMetadata(metadata: Array<{ label: string; value: string | undefined; isIcon?: boolean }>): HTMLElement | null {
    if (metadata.length === 0) {
      return null;
    }

    const metadataSection = document.createElement('div');
    metadataSection.style.marginBottom = '12px';

    for (const item of metadata) {
      if (item.value) {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'center';
        row.style.marginBottom = '6px';
        row.style.fontSize = '14px';

        const label = document.createElement('span');
        label.textContent = item.label + ':';
        label.style.color = 'rgba(255, 255, 255, 0.6)';
        row.appendChild(label);

        const value = document.createElement('span');
        if (item.isIcon) {
          value.textContent = item.value;
          value.style.fontSize = '18px';
          value.style.lineHeight = '1';
        } else {
          value.textContent = item.value;
        }
        value.style.color = '#FFFFFF';
        value.style.fontWeight = '500';
        row.appendChild(value);

        metadataSection.appendChild(row);
      }
    }

    return metadataSection;
  }

  /**
   * Create tags section for performer overlay
   */
  private createPerformerOverlayTags(performerData: PerformerExtended): HTMLElement | null {
    if (!performerData.tags || performerData.tags.length === 0) {
      return null;
    }

    const tagsSection = document.createElement('div');
    tagsSection.style.marginBottom = '12px';
    tagsSection.style.fontSize = '14px';

    const tagsLabel = document.createElement('div');
    tagsLabel.textContent = 'Tags:';
    tagsLabel.style.color = 'rgba(255, 255, 255, 0.6)';
    tagsLabel.style.marginBottom = '4px';
    tagsSection.appendChild(tagsLabel);

    const tagsList = document.createElement('div');
    tagsList.style.display = 'flex';
    tagsList.style.flexWrap = 'wrap';
    tagsList.style.gap = '4px';

    for (const tag of performerData.tags.slice(0, 10)) {
      const tagChip = document.createElement('span');
      tagChip.textContent = tag.name;
      tagChip.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
      tagChip.style.padding = '2px 8px';
      tagChip.style.borderRadius = '4px';
      tagChip.style.fontSize = '12px';
      tagChip.style.color = '#FFFFFF';
      tagsList.appendChild(tagChip);
    }

    if (performerData.tags.length > 10) {
      const moreChip = document.createElement('span');
      moreChip.textContent = `+${performerData.tags.length - 10} more`;
      moreChip.style.color = 'rgba(255, 255, 255, 0.6)';
      moreChip.style.fontSize = '12px';
      tagsList.appendChild(moreChip);
    }

    tagsSection.appendChild(tagsList);
    return tagsSection;
  }

  /**
   * Create details section for performer overlay
   */
  private createPerformerOverlayDetails(performerData: PerformerExtended): HTMLElement | null {
    if (!performerData.details) {
      return null;
    }

    const detailsSection = document.createElement('div');
    detailsSection.style.fontSize = '14px';
    detailsSection.style.color = 'rgba(255, 255, 255, 0.8)';
    detailsSection.style.lineHeight = '1.5';
    detailsSection.style.marginTop = '12px';
    detailsSection.style.paddingTop = '12px';
    detailsSection.style.borderTop = '1px solid rgba(255, 255, 255, 0.1)';
    detailsSection.textContent = performerData.details;
    return detailsSection;
  }

  /**
   * Create performer overlay card
   */
  private createPerformerOverlay(performerData: PerformerExtended): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'performer-overlay';
    overlay.style.position = 'fixed';
    overlay.style.zIndex = '10000';
    overlay.style.backgroundColor = 'rgba(20, 20, 20, 0.98)';
    overlay.style.border = '1px solid rgba(255, 255, 255, 0.1)';
    overlay.style.borderRadius = '8px';
    overlay.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.5)';
    overlay.style.width = '320px';
    overlay.style.maxHeight = '80vh';
    overlay.style.overflowY = 'auto';
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.2s ease';
    overlay.style.pointerEvents = 'auto';

    // Keep overlay visible when hovering over it
    // Note: Don't clear timeout here - the timeout is for showing the overlay, not hiding it
    overlay.addEventListener('mouseenter', () => {
      // Cancel any pending hide timeout when hovering over overlay
      if (this.performerOverlayHideTimeout) {
        clearTimeout(this.performerOverlayHideTimeout);
        this.performerOverlayHideTimeout = undefined;
      }
    });
    overlay.addEventListener('mouseleave', () => {
      this.hidePerformerOverlay();
    });

    // Image section
    const imageSection = this.createPerformerOverlayImageSection(performerData);
    overlay.appendChild(imageSection);

    // Content section
    const contentSection = document.createElement('div');
    contentSection.style.padding = '16px';

    // Name and favorite
    const nameRow = this.createPerformerOverlayNameRow(performerData);
    contentSection.appendChild(nameRow);

    // Performer URL (if available)
    if (performerData.url) {
      const urlLink = document.createElement('a');
      urlLink.href = performerData.url;
      urlLink.target = '_blank';
      urlLink.rel = 'noopener noreferrer';
      urlLink.textContent = performerData.url;
      urlLink.style.display = 'block';
      urlLink.style.marginTop = '4px';
      urlLink.style.marginBottom = '12px';
      urlLink.style.fontSize = '13px';
      urlLink.style.color = '#4A9EFF';
      urlLink.style.textDecoration = 'none';
      urlLink.style.wordBreak = 'break-all';
      urlLink.style.opacity = '0.8';
      urlLink.addEventListener('mouseenter', () => {
        urlLink.style.textDecoration = 'underline';
        urlLink.style.opacity = '1';
      });
      urlLink.addEventListener('mouseleave', () => {
        urlLink.style.textDecoration = 'none';
        urlLink.style.opacity = '0.8';
      });
      contentSection.appendChild(urlLink);
    }

    // Metadata
    const metadata = this.buildPerformerMetadata(performerData);
    const metadataSection = this.createPerformerOverlayMetadata(metadata);
    if (metadataSection) {
      contentSection.appendChild(metadataSection);
    }

    // Tags
    const tagsSection = this.createPerformerOverlayTags(performerData);
    if (tagsSection) {
      contentSection.appendChild(tagsSection);
    }

    // Details
    const detailsSection = this.createPerformerOverlayDetails(performerData);
    if (detailsSection) {
      contentSection.appendChild(detailsSection);
    }


    overlay.appendChild(contentSection);
    return overlay;
  }

  /**
   * Show performer overlay on hover
   */
  private showPerformerOverlay(performerId: string, chipElement: HTMLElement): void {
    // Clear any existing timeout
    if (this.performerOverlayTimeout) {
      clearTimeout(this.performerOverlayTimeout);
      this.performerOverlayTimeout = undefined;
    }

    // If already showing this performer, don't do anything
    if (this.currentHoveredPerformerId === performerId && this.performerOverlay) {
      return;
    }

    // Cancel any pending hide timeout (when moving from another chip)
    if (this.performerOverlayHideTimeout) {
      clearTimeout(this.performerOverlayHideTimeout);
      this.performerOverlayHideTimeout = undefined;
    }

    // Cancel any pending fetch
    if (this.performerOverlayAbortController) {
      this.performerOverlayAbortController.abort();
      this.performerOverlayAbortController = undefined;
    }

    // Track if we had an overlay before hiding (for delay logic)
    const hadOverlay = !!this.performerOverlay;
    
    // Hide existing overlay immediately (for rapid hover changes)
    this.hidePerformerOverlay(true);

    // Set timeout to show overlay (debounce - longer delay on first hover to avoid popping while scrolling)
    this.currentHoveredPerformerId = performerId;
    const isFirstHover = !hadOverlay; // Check if this is truly the first hover (no overlay was showing before)
    const delay = isFirstHover ? 600 : 50; // 600ms for first hover, 50ms for subsequent hovers
    const timeoutId = setTimeout(async () => {
      if (this.currentHoveredPerformerId !== performerId) {
        return; // User moved to different performer
      }

      if (!this.api) {
        return;
      }

      // Create abort controller for this request
      this.performerOverlayAbortController = new AbortController();

      try {
        // Fetch performer details
        const performerData = await this.api.getPerformerDetails(
          performerId,
          this.performerOverlayAbortController.signal
        );

        if (!performerData || this.currentHoveredPerformerId !== performerId) {
          return; // User moved to different performer or fetch failed
        }

        // Create overlay
        const overlay = this.createPerformerOverlay(performerData);
        this.performerOverlay = overlay;
        document.body.appendChild(overlay);

        // Position overlay
        this.positionOverlay(overlay, chipElement);

        // Show with fade-in
        requestAnimationFrame(() => {
          if (overlay.parentElement) {
            overlay.style.opacity = '1';
          }
        });
        
        // Mark that we now have an overlay
        this.hadOverlayBefore = true;
      } catch (error) {
        // Ignore abort errors
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        console.warn('Failed to fetch performer details:', error);
      }
    }, delay) as unknown as number;
    this.performerOverlayTimeout = timeoutId;
  }

  /**
   * Hide performer overlay
   */
  private hidePerformerOverlay(immediate: boolean = false): void {
    if (this.performerOverlayTimeout) {
      clearTimeout(this.performerOverlayTimeout);
      this.performerOverlayTimeout = undefined;
    }

    if (this.performerOverlayHideTimeout) {
      clearTimeout(this.performerOverlayHideTimeout);
      this.performerOverlayHideTimeout = undefined;
    }

    if (this.performerOverlay) {
      if (immediate) {
        // Immediately remove from DOM (for rapid hover changes)
        if (this.performerOverlay.parentElement) {
          try {
            this.performerOverlay.remove();
          } catch {
            // Element may have already been removed
          }
        }
        this.performerOverlay = undefined;
      } else {
        // Fade out then remove (for normal mouse leave)
        this.performerOverlay.style.opacity = '0';
        setTimeout(() => {
          if (this.performerOverlay?.parentElement) {
            try {
              this.performerOverlay.remove();
            } catch {
              // Element may have already been removed
            }
          }
          this.performerOverlay = undefined;
        }, 200) as unknown as number;
      }
    }

    // Only clear currentHoveredPerformerId if not immediately hiding (for rapid changes)
    if (!immediate) {
      this.currentHoveredPerformerId = undefined;
      this.hadOverlayBefore = false; // Reset when fully hiding
    }

    // Cancel any pending fetch
    if (this.performerOverlayAbortController) {
      this.performerOverlayAbortController.abort();
      this.performerOverlayAbortController = undefined;
    }
  }

  /**
   * Position overlay relative to chip element
   */
  private positionOverlay(overlay: HTMLElement, chipElement: HTMLElement): void {
    const chipRect = chipElement.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    const viewportWidth = globalThis.innerWidth;
    const viewportHeight = globalThis.innerHeight;
    const padding = 16;

    let top = chipRect.bottom + padding;
    let left = chipRect.left;

    // Adjust if would go off bottom of screen
    if (top + overlayRect.height > viewportHeight - padding) {
      top = chipRect.top - overlayRect.height - padding;
      // If still off screen, position at top
      if (top < padding) {
        top = padding;
      }
    }

    // Adjust if would go off right of screen
    if (left + overlayRect.width > viewportWidth - padding) {
      left = viewportWidth - overlayRect.width - padding;
    }

    // Adjust if would go off left of screen
    if (left < padding) {
      left = padding;
    }

    overlay.style.top = `${top}px`;
    overlay.style.left = `${left}px`;
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

