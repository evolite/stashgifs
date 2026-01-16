/**
 * Base Post Component
 * Shared functionality for VideoPost and ImagePost
 */

import { FavoritesManager } from './FavoritesManager.js';
import { StashAPI } from './StashAPI.js';
import { VisibilityManager } from './VisibilityManager.js';
import { toAbsoluteUrl, showToast, isMobileDevice, THEME } from './utils.js';
import { VERIFIED_CHECKMARK_SVG, ADD_TAG_SVG, HEART_SVG_OUTLINE, HEART_SVG_FILLED, OCOUNT_SVG, IMAGE_BADGE_SVG, EXTERNAL_LINK_SVG, STAR_SVG, STAR_SVG_OUTLINE } from './icons.js';
import { setupTouchHandlers, preventClickAfterTouch } from './utils/touchHandlers.js';
import { PerformerExtended } from './graphql/types.js';
import { Performer, Tag } from './types.js';

interface HoverHandlers {
  mouseenter: () => void;
  mouseleave: () => void;
}

export interface AddTagDialogState {
  dialog?: HTMLElement;
  input?: HTMLInputElement;
  suggestions?: HTMLElement;
  createButton?: HTMLButtonElement;
  isOpen: boolean;
  selectedTagId?: string;
  selectedTagName?: string;
  autocompleteDebounceTimer?: ReturnType<typeof setTimeout>;
  tagSearchLoadingTimer?: ReturnType<typeof setTimeout>;
  outsideClickHandler?: (event: Event) => void;
  keydownHandler?: (event: KeyboardEvent) => void;
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
  protected readonly onPerformerChipClick?: (performerId: number, performerName: string) => void | Promise<void>;
  protected readonly onTagChipClick?: (tagId: number, tagName: string) => void | Promise<void>;
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
  private performerOverlayClickTime?: number; // Track when chip was clicked to prevent immediate re-show
  // Tag overlay properties
  private tagOverlay?: HTMLElement;
  private tagOverlayTimeout?: number;
  private tagOverlayHideTimeout?: number;
  private currentHoveredTagId?: string;
  private tagOverlayAbortController?: AbortController;
  private hadTagOverlayBefore: boolean = false; // Track if tag overlay was showing before (for delay logic)
  private tagOverlayClickTime?: number; // Track when chip was clicked to prevent immediate re-show


  constructor(
    container: HTMLElement,
    favoritesManager?: FavoritesManager,
    api?: StashAPI,
    visibilityManager?: VisibilityManager,
    onPerformerChipClick?: (performerId: number, performerName: string) => void | Promise<void>,
    onTagChipClick?: (tagId: number, tagName: string) => void | Promise<void>
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

  protected renderBasePost(config: {
    className: string;
    postId: string;
    createHeader: () => HTMLElement;
    createPlayerContainer: () => HTMLElement;
    createFooter: () => HTMLElement;
  }): { header: HTMLElement; playerContainer: HTMLElement; footer: HTMLElement } {
    this.container.className = config.className;
    this.container.dataset.postId = config.postId;
    this.container.style.position = 'relative';
    this.container.style.backgroundColor = THEME.colors.surface;
    this.container.style.border = `1px solid ${THEME.colors.border}`;
    this.container.style.borderRadius = THEME.radius.card;
    this.container.style.color = THEME.colors.textPrimary;
    this.container.style.fontFamily = THEME.typography.fontFamily;
    this.container.style.lineHeight = THEME.typography.lineHeight;
    while (this.container.firstChild) {
      this.container.firstChild.remove();
    }

    const header = config.createHeader();
    this.container.appendChild(header);

    const playerContainer = config.createPlayerContainer();
    this.container.appendChild(playerContainer);

    const footer = config.createFooter();
    this.container.appendChild(footer);

    return { header, playerContainer, footer };
  }

  protected buildFooterContainer(): {
    footer: HTMLElement;
    info: HTMLElement;
    row: HTMLElement;
    buttonGroup: HTMLElement;
  } {
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

    row.appendChild(buttonGroup);
    info.appendChild(row);
    footer.appendChild(info);

    footer.addEventListener('mouseenter', (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
    });
    footer.addEventListener('mouseleave', (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
    });

    return { footer, info, row, buttonGroup };
  }

  /**
   * Setup scroll listener to hide performer and tag overlays when user scrolls
   */
  private setupPerformerOverlayScrollListener(): void {
    this.performerOverlayScrollHandler = () => {
      if (this.performerOverlay) {
        this.hidePerformerOverlay(true);
      }
      if (this.tagOverlay) {
        this.hideTagOverlay(true);
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
    button.style.color = THEME.colors.iconInactive;
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
    chip.style.fontSize = THEME.typography.sizeBody;
    chip.style.lineHeight = THEME.typography.lineHeightTight;
    chip.style.color = THEME.colors.textSecondary;
    chip.style.textDecoration = 'none';
    chip.style.transition = 'color 0.2s ease, opacity 0.2s ease';
    chip.style.cursor = 'pointer';
    chip.style.minHeight = '44px';
    chip.style.height = '44px';
    
    const handleClick = () => {
      // Hide overlay when clicking to filter
      this.hidePerformerOverlay(true);
      // Record click time to prevent immediate re-show on hover
      this.performerOverlayClickTime = Date.now();
      
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
    imageContainer.style.background = THEME.colors.backgroundSecondary;
    imageContainer.style.display = 'flex';
    imageContainer.style.alignItems = 'center';
    imageContainer.style.justifyContent = 'center';
    imageContainer.style.fontSize = THEME.typography.sizeMeta;
    imageContainer.style.fontWeight = THEME.typography.weightTitle;
    imageContainer.style.color = THEME.colors.textSecondary;
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
    checkmarkIcon.style.marginLeft = '-4px';
    checkmarkIcon.style.color = THEME.colors.accentPrimary;
    const svg = checkmarkIcon.querySelector('svg');
    if (svg) {
      svg.setAttribute('width', '14');
      svg.setAttribute('height', '14');
    }
    chip.appendChild(checkmarkIcon);
    
    // Hover effect
    chip.addEventListener('mouseenter', () => {
      chip.style.color = THEME.colors.textPrimary;
    });
    chip.addEventListener('mouseleave', () => {
      chip.style.color = THEME.colors.textSecondary;
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
   * Create image section for performer overlay (compact headshot on left, 2:3 aspect ratio matching 1280x1920)
   */
  private createPerformerOverlayImageSection(performerData: PerformerExtended): HTMLElement {
    const imageSection = document.createElement('div');
    imageSection.style.width = '160px';
    imageSection.style.height = '240px';
    imageSection.style.minWidth = '160px';
    imageSection.style.minHeight = '240px';
    imageSection.style.backgroundColor = THEME.colors.backgroundSecondary;
    imageSection.style.display = 'flex';
    imageSection.style.alignItems = 'center';
    imageSection.style.justifyContent = 'center';
    imageSection.style.overflow = 'hidden';
    imageSection.style.borderRadius = '8px';
    imageSection.style.flexShrink = '0';
    imageSection.style.position = 'relative';

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
        img.style.objectPosition = 'center center';
        imageSection.appendChild(img);
      } else {
        imageSection.textContent = performerData.name.charAt(0).toUpperCase();
        imageSection.style.fontSize = '64px';
        imageSection.style.color = THEME.colors.textMuted;
      }
    } else {
      imageSection.textContent = performerData.name.charAt(0).toUpperCase();
      imageSection.style.fontSize = '64px';
      imageSection.style.color = THEME.colors.textMuted;
    }

    // Add country flag overlay in bottom right corner
    if (performerData.country) {
      const flag = this.getCountryFlag(performerData.country);
      if (flag) {
        const flagElement = document.createElement('div');
        flagElement.textContent = flag;
        flagElement.style.position = 'absolute';
        flagElement.style.bottom = '8px';
        flagElement.style.right = '8px';
        flagElement.style.fontSize = '24px';
        flagElement.style.lineHeight = '1';
        flagElement.style.width = '32px';
        flagElement.style.height = '32px';
        flagElement.style.display = 'flex';
        flagElement.style.alignItems = 'center';
        flagElement.style.justifyContent = 'center';
        flagElement.style.backgroundColor = THEME.colors.overlayMuted;
        flagElement.style.borderRadius = '4px';
        flagElement.style.backdropFilter = 'blur(4px)';
        flagElement.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.3)';
        imageSection.appendChild(flagElement);
      }
    }

    return imageSection;
  }

  /**
   * Create name row for performer overlay (compact)
   */
  private createPerformerOverlayNameRow(performerData: PerformerExtended): HTMLElement {
    const nameRow = document.createElement('div');
    nameRow.style.display = 'flex';
    nameRow.style.alignItems = 'center';
    nameRow.style.gap = '6px';
    nameRow.style.marginBottom = '8px';

    const nameLink = document.createElement('a');
    nameLink.href = this.getPerformerLink(performerData.id);
    nameLink.target = '_blank';
    nameLink.rel = 'noopener noreferrer';
    nameLink.style.display = 'flex';
    nameLink.style.alignItems = 'center';
    nameLink.style.gap = '4px';
    nameLink.style.textDecoration = 'none';
    nameLink.style.color = THEME.colors.textPrimary;
    nameLink.style.cursor = 'pointer';
    nameLink.addEventListener('mouseenter', () => {
      nameLink.style.color = THEME.colors.accentPrimary;
    });
    nameLink.addEventListener('mouseleave', () => {
      nameLink.style.color = THEME.colors.textPrimary;
    });

    const name = document.createElement('h3');
    name.textContent = performerData.name;
    name.style.margin = '0';
    name.style.fontSize = THEME.typography.sizeTitle;
    name.style.fontWeight = THEME.typography.weightTitle;
    name.style.lineHeight = THEME.typography.lineHeightTight;
    nameLink.appendChild(name);

    const externalIcon = document.createElement('span');
    externalIcon.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>';
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
      favoriteIcon.style.width = '18px';
      favoriteIcon.style.height = '18px';
      favoriteIcon.style.color = THEME.colors.ratingHigh;
      const svg = favoriteIcon.querySelector('svg');
      if (svg) {
        svg.setAttribute('width', '18');
        svg.setAttribute('height', '18');
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
   * Convert ISO 3166-1 alpha-2 country code to flag emoji
   */
  private getCountryFlag(countryCode: string): string {
    if (!countryCode?.length || countryCode.length !== 2) {
      return '';
    }
    
    const code = countryCode.toUpperCase();
    // Convert each letter to regional indicator symbol (U+1F1E6 to U+1F1FF)
    // 'A' (0x41) maps to U+1F1E6, so we add 0x1F1E6 - 0x41 = 0x1F1A5
    const base = 0x1F1E6;
    const offset = 0x41; // 'A'
    
    const firstChar = code.codePointAt(0);
    const secondChar = code.codePointAt(1);
    
    // Validate that both characters are letters
    if (firstChar === undefined || secondChar === undefined || firstChar < 0x41 || firstChar > 0x5A || secondChar < 0x41 || secondChar > 0x5A) {
      return '';
    }
    
    const firstFlag = String.fromCodePoint(base + (firstChar - offset));
    const secondFlag = String.fromCodePoint(base + (secondChar - offset));
    
    return firstFlag + secondFlag;
  }

  /**
   * Add basic info metadata (age, gender)
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
    metadataSection.style.display = 'flex';
    metadataSection.style.flexDirection = 'column';
    metadataSection.style.gap = '4px';
    metadataSection.style.marginBottom = '8px';

    for (const item of metadata) {
      if (item.value) {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '6px';
        row.style.fontSize = '13px';

        const label = document.createElement('span');
        label.textContent = item.label + ':';
        label.style.color = THEME.colors.textMuted;
        row.appendChild(label);

        const value = document.createElement('span');
        if (item.isIcon) {
          value.textContent = item.value;
          value.style.fontSize = '16px';
          value.style.lineHeight = '1';
        } else {
          value.textContent = item.value;
        }
        value.style.color = THEME.colors.textPrimary;
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
    tagsSection.style.marginBottom = '8px';
    tagsSection.style.fontSize = THEME.typography.sizeControl;

    const tagsLabel = document.createElement('div');
    tagsLabel.textContent = 'Tags:';
    tagsLabel.style.color = THEME.colors.textMuted;
    tagsLabel.style.marginBottom = '4px';
    tagsSection.appendChild(tagsLabel);

    const tagsList = document.createElement('div');
    tagsList.style.display = 'flex';
    tagsList.style.flexWrap = 'wrap';
    tagsList.style.gap = '4px';

    for (const tag of performerData.tags.slice(0, 10)) {
      const tagChip = document.createElement('span');
      tagChip.textContent = tag.name;
      tagChip.style.backgroundColor = THEME.colors.backgroundSecondary;
      tagChip.style.padding = '2px 8px';
      tagChip.style.borderRadius = THEME.radius.tag;
      tagChip.style.fontSize = THEME.typography.sizeMeta;
      tagChip.style.color = THEME.colors.textPrimary;
      tagsList.appendChild(tagChip);
    }

    if (performerData.tags.length > 10) {
      const moreChip = document.createElement('span');
      moreChip.textContent = `+${performerData.tags.length - 10} more`;
      moreChip.style.color = THEME.colors.textMuted;
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
    detailsSection.style.color = THEME.colors.textSecondary;
    detailsSection.style.lineHeight = '1.5';
    detailsSection.style.marginTop = '12px';
    detailsSection.style.paddingTop = '12px';
    detailsSection.style.borderTop = `1px solid ${THEME.colors.border}`;
    detailsSection.textContent = performerData.details;
    return detailsSection;
  }

  /**
   * Create performer overlay card (compact horizontal layout)
   */
  private createPerformerOverlay(performerData: PerformerExtended): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'performer-overlay';
    overlay.style.position = 'fixed';
    overlay.style.zIndex = '10000';
    overlay.style.backgroundColor = THEME.colors.overlay;
    overlay.style.border = `1px solid ${THEME.colors.border}`;
    overlay.style.borderRadius = THEME.radius.card;
    overlay.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.5)';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'row';
    overlay.style.gap = '12px';
    overlay.style.padding = THEME.spacing.cardPadding;
    overlay.style.width = 'auto';
    overlay.style.maxWidth = '480px';
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

    // Close overlay when clicking on overlay background (not on interactive elements)
    overlay.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      // Only close if clicking on the overlay itself or non-interactive areas
      // Don't close if clicking on links, buttons, or other interactive elements
      if (target === overlay || (!target.closest('a') && !target.closest('button'))) {
        this.hidePerformerOverlay(true);
      }
    });

    // Image section (left side)
    const imageSection = this.createPerformerOverlayImageSection(performerData);
    overlay.appendChild(imageSection);

    // Content section (right side)
    const contentSection = document.createElement('div');
    contentSection.style.display = 'flex';
    contentSection.style.flexDirection = 'column';
    contentSection.style.flex = '1';
    contentSection.style.minWidth = '0';

    // Name and favorite
    const nameRow = this.createPerformerOverlayNameRow(performerData);
    contentSection.appendChild(nameRow);

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

    overlay.appendChild(contentSection);
    return overlay;
  }

  /**
   * Show performer overlay on hover
   */
  private showPerformerOverlay(performerId: string, chipElement: HTMLElement): void {
    // Prevent showing overlay immediately after a click (within 300ms)
    if (this.performerOverlayClickTime && Date.now() - this.performerOverlayClickTime < 300) {
      return;
    }

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

    // Always clear hover state to prevent re-showing overlay after click
    this.currentHoveredPerformerId = undefined;
    this.hadOverlayBefore = false; // Reset when fully hiding

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

    let top = chipRect.bottom;
    let left = chipRect.left;

    // Adjust if would go off bottom of screen
    if (top + overlayRect.height > viewportHeight - padding) {
      top = chipRect.top - overlayRect.height;
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
   * Create image section for tag overlay (compact square image on left)
   */
  private createTagOverlayImageSection(tagData: { id: string; name: string; image_path?: string }): HTMLElement {
    const imageSection = document.createElement('div');
    imageSection.style.width = '64px';
    imageSection.style.height = '64px';
    imageSection.style.minWidth = '64px';
    imageSection.style.minHeight = '64px';
    imageSection.style.backgroundColor = THEME.colors.backgroundSecondary;
    imageSection.style.display = 'flex';
    imageSection.style.alignItems = 'center';
    imageSection.style.justifyContent = 'center';
    imageSection.style.overflow = 'hidden';
    imageSection.style.borderRadius = '8px';
    imageSection.style.flexShrink = '0';

    if (tagData.image_path) {
      const imageSrc = tagData.image_path.startsWith('http')
        ? tagData.image_path
        : toAbsoluteUrl(tagData.image_path);
      if (imageSrc) {
        const img = document.createElement('img');
        img.src = imageSrc;
        img.alt = tagData.name;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.objectPosition = 'center center';
        imageSection.appendChild(img);
        return imageSection;
      }
    }
    imageSection.textContent = tagData.name.charAt(0).toUpperCase();
    imageSection.style.fontSize = '32px';
    imageSection.style.color = THEME.colors.textMuted;
    return imageSection;
  }

  /**
   * Create name row for tag overlay
   */
  private createTagOverlayNameRow(tagData: { id: string; name: string }): HTMLElement {
    const nameRow = document.createElement('div');
    nameRow.style.display = 'flex';
    nameRow.style.alignItems = 'center';
    nameRow.style.gap = '6px';
    nameRow.style.marginBottom = '6px';

    const nameLink = document.createElement('a');
    nameLink.href = this.getTagLink(tagData.id);
    nameLink.target = '_blank';
    nameLink.rel = 'noopener noreferrer';
    nameLink.style.display = 'flex';
    nameLink.style.alignItems = 'center';
    nameLink.style.gap = '4px';
    nameLink.style.textDecoration = 'none';
    nameLink.style.color = THEME.colors.textPrimary;
    nameLink.style.cursor = 'pointer';
    nameLink.addEventListener('mouseenter', () => {
      nameLink.style.color = THEME.colors.accentPrimary;
    });
    nameLink.addEventListener('mouseleave', () => {
      nameLink.style.color = THEME.colors.textPrimary;
    });

    const name = document.createElement('h3');
    name.textContent = tagData.name;
    name.style.margin = '0';
    name.style.fontSize = '16px';
    name.style.fontWeight = '600';
    name.style.lineHeight = '1.2';
    nameLink.appendChild(name);

    const externalIcon = document.createElement('span');
    externalIcon.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>';
    externalIcon.style.display = 'inline-flex';
    externalIcon.style.alignItems = 'center';
    externalIcon.style.opacity = '0.7';
    externalIcon.style.flexShrink = '0';
    nameLink.appendChild(externalIcon);

    nameRow.appendChild(nameLink);
    return nameRow;
  }

  /**
   * Create description section for tag overlay (optional)
   */
  private createTagOverlayDescription(tagData: { description?: string }): HTMLElement | null {
    if (!tagData.description) {
      return null;
    }

    const descriptionSection = document.createElement('div');
    descriptionSection.style.fontSize = '12px';
    descriptionSection.style.color = THEME.colors.textSecondary;
    descriptionSection.style.lineHeight = '1.4';
    descriptionSection.style.marginTop = '4px';
    descriptionSection.textContent = tagData.description;
    return descriptionSection;
  }

  /**
   * Create tag overlay card (compact horizontal layout)
   */
  private createTagOverlay(tagData: { id: string; name: string; image_path?: string; description?: string }): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'tag-overlay';
    overlay.style.position = 'fixed';
    overlay.style.zIndex = '10000';
    overlay.style.backgroundColor = THEME.colors.overlay;
    overlay.style.border = `1px solid ${THEME.colors.border}`;
    overlay.style.borderRadius = THEME.radius.card;
    overlay.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.5)';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'row';
    overlay.style.gap = '12px';
    overlay.style.padding = THEME.spacing.cardPadding;
    overlay.style.width = 'auto';
    overlay.style.maxWidth = '280px';
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.2s ease';
    overlay.style.pointerEvents = 'auto';

    // Keep overlay visible when hovering over it
    overlay.addEventListener('mouseenter', () => {
      // Cancel any pending hide timeout when hovering over overlay
      if (this.tagOverlayHideTimeout) {
        clearTimeout(this.tagOverlayHideTimeout);
        this.tagOverlayHideTimeout = undefined;
      }
    });
    overlay.addEventListener('mouseleave', () => {
      this.hideTagOverlay();
    });

    // Close overlay when clicking on overlay background (not on interactive elements)
    overlay.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      // Only close if clicking on the overlay itself or non-interactive areas
      // Don't close if clicking on links, buttons, or other interactive elements
      if (target === overlay || (!target.closest('a') && !target.closest('button'))) {
        this.hideTagOverlay(true);
      }
    });

    // Image section (left side)
    const imageSection = this.createTagOverlayImageSection(tagData);
    overlay.appendChild(imageSection);

    // Content section (right side)
    const contentSection = document.createElement('div');
    contentSection.style.display = 'flex';
    contentSection.style.flexDirection = 'column';
    contentSection.style.flex = '1';
    contentSection.style.minWidth = '0';

    // Name with link
    const nameRow = this.createTagOverlayNameRow(tagData);
    contentSection.appendChild(nameRow);

    // Description (optional)
    const descriptionSection = this.createTagOverlayDescription(tagData);
    if (descriptionSection) {
      contentSection.appendChild(descriptionSection);
    }

    overlay.appendChild(contentSection);
    return overlay;
  }

  /**
   * Show tag overlay on hover
   */
  private showTagOverlay(tagId: string, chipElement: HTMLElement): void {
    // Prevent showing overlay immediately after a click (within 300ms)
    if (this.tagOverlayClickTime && Date.now() - this.tagOverlayClickTime < 300) {
      return;
    }

    // Clear any existing timeout
    if (this.tagOverlayTimeout) {
      clearTimeout(this.tagOverlayTimeout);
      this.tagOverlayTimeout = undefined;
    }

    // If already showing this tag, don't do anything
    if (this.currentHoveredTagId === tagId && this.tagOverlay) {
      return;
    }

    // Cancel any pending hide timeout (when moving from another chip)
    if (this.tagOverlayHideTimeout) {
      clearTimeout(this.tagOverlayHideTimeout);
      this.tagOverlayHideTimeout = undefined;
    }

    // Cancel any pending fetch
    if (this.tagOverlayAbortController) {
      this.tagOverlayAbortController.abort();
      this.tagOverlayAbortController = undefined;
    }

    // Track if we had an overlay before hiding (for delay logic)
    const hadOverlay = !!this.tagOverlay;
    
    // Hide existing overlay immediately (for rapid hover changes)
    this.hideTagOverlay(true);

    // Set timeout to show overlay (debounce - longer delay on first hover to avoid popping while scrolling)
    this.currentHoveredTagId = tagId;
    const isFirstHover = !hadOverlay; // Check if this is truly the first hover (no overlay was showing before)
    const delay = isFirstHover ? 600 : 50; // 600ms for first hover, 50ms for subsequent hovers
    const timeoutId = setTimeout(async () => {
      if (this.currentHoveredTagId !== tagId) {
        return; // User moved to different tag
      }

      if (!this.api) {
        return;
      }

      // Create abort controller for this request
      this.tagOverlayAbortController = new AbortController();

      try {
        // Fetch tag details
        const tagData = await this.api.getTagDetails(
          tagId,
          this.tagOverlayAbortController.signal
        );

        if (!tagData || this.currentHoveredTagId !== tagId) {
          return; // User moved to different tag or fetch failed
        }

        // Create overlay
        const overlay = this.createTagOverlay(tagData);
        this.tagOverlay = overlay;
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
        this.hadTagOverlayBefore = true;
      } catch (error) {
        // Ignore abort errors
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        console.warn('Failed to fetch tag details:', error);
      }
    }, delay) as unknown as number;
    this.tagOverlayTimeout = timeoutId;
  }

  /**
   * Hide tag overlay
   */
  private hideTagOverlay(immediate: boolean = false): void {
    if (this.tagOverlayTimeout) {
      clearTimeout(this.tagOverlayTimeout);
      this.tagOverlayTimeout = undefined;
    }

    if (this.tagOverlayHideTimeout) {
      clearTimeout(this.tagOverlayHideTimeout);
      this.tagOverlayHideTimeout = undefined;
    }

    if (this.tagOverlay) {
      if (immediate) {
        // Immediately remove from DOM (for rapid hover changes)
        if (this.tagOverlay.parentElement) {
          try {
            this.tagOverlay.remove();
          } catch {
            // Element may have already been removed
          }
        }
        this.tagOverlay = undefined;
      } else {
        // Fade out then remove (for normal mouse leave)
        this.tagOverlay.style.opacity = '0';
        setTimeout(() => {
          if (this.tagOverlay?.parentElement) {
            try {
              this.tagOverlay.remove();
            } catch {
              // Element may have already been removed
            }
          }
          this.tagOverlay = undefined;
        }, 200) as unknown as number;
      }
    }

    // Always clear hover state to prevent re-showing overlay after click
    this.currentHoveredTagId = undefined;
    this.hadTagOverlayBefore = false; // Reset when fully hiding

    // Cancel any pending fetch
    if (this.tagOverlayAbortController) {
      this.tagOverlayAbortController.abort();
      this.tagOverlayAbortController = undefined;
    }
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
    hashtag.style.color = THEME.colors.textSecondary;
    hashtag.style.textDecoration = 'none';
    hashtag.style.transition = 'color 0.2s ease';
    hashtag.style.cursor = 'pointer';
    hashtag.style.minHeight = '44px';
    hashtag.style.height = '44px';
    
    const handleClick = () => {
      // Hide overlay when clicking to filter
      this.hideTagOverlay(true);
      // Record click time to prevent immediate re-show on hover
      this.tagOverlayClickTime = Date.now();
      
      if (this.onTagChipClick) {
        const tagId = Number.parseInt(tag.id, 10);
        if (!Number.isNaN(tagId)) {
          this.onTagChipClick(tagId, tag.name);
        }
      }
    };
    
    hashtag.addEventListener('mouseenter', () => {
      hashtag.style.color = THEME.colors.textPrimary;
    });
    hashtag.addEventListener('mouseleave', () => {
      hashtag.style.color = THEME.colors.textSecondary;
    });
    
    const isMobile = isMobileDevice();
    
    // Add hover overlay handlers for tags (desktop only)
    if (this.api && !isMobile) {
      hashtag.addEventListener('mouseenter', () => {
        // Cancel any pending hide timeout (when moving from another chip)
        if (this.tagOverlayHideTimeout) {
          clearTimeout(this.tagOverlayHideTimeout);
          this.tagOverlayHideTimeout = undefined;
        }
        this.showTagOverlay(tag.id, hashtag);
      });
      hashtag.addEventListener('mouseleave', (e) => {
        // Check if we're moving to another tag chip
        const relatedTarget = e.relatedTarget as HTMLElement | null;
        const isMovingToAnotherChip = relatedTarget?.closest('.tag-chip') !== null;
        
        if (!isMovingToAnotherChip) {
          // Small delay to allow mouse to move to overlay
          this.tagOverlayHideTimeout = setTimeout(() => {
            if (!this.tagOverlay?.matches(':hover')) {
              this.hideTagOverlay();
            }
            this.tagOverlayHideTimeout = undefined;
          }, 100) as unknown as number;
        }
      });
    }
    
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

  protected createImageBadgeIcon(): HTMLElement {
    const badge = document.createElement('span');
    badge.className = 'content-badge';
    badge.style.display = 'inline-flex';
    badge.style.alignItems = 'center';
    badge.style.justifyContent = 'center';
    badge.style.width = '30px';
    badge.style.height = '30px';
    badge.style.flexShrink = '0';
    badge.style.color = THEME.colors.textSecondary;
    badge.style.pointerEvents = 'none';
    badge.innerHTML = IMAGE_BADGE_SVG;
    badge.title = 'Image';
    badge.setAttribute('role', 'img');
    badge.setAttribute('aria-label', 'Image');
    return badge;
  }

  protected buildImageHeader(options: {
    performers?: Performer[];
    tags?: Tag[];
    favoriteTagName?: string;
  }): HTMLElement {
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

    chips.appendChild(this.createImageBadgeIcon());

    if (options.performers && options.performers.length > 0) {
      for (const performer of options.performers) {
        const chip = this.createPerformerChip(performer);
        chips.appendChild(chip);
      }
    }

    if (options.tags && options.tags.length > 0) {
      const hasPerformers = !!options.performers && options.performers.length > 0;
      let isFirstTag = true;
      for (const tag of options.tags) {
        if (!tag?.id || !tag?.name || tag.name === options.favoriteTagName) {
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

    header.appendChild(chips);
    return header;
  }

  protected getImageLink(imageId: string): string {
    return `${globalThis.location.origin}/images/${imageId}`;
  }

  protected createImageButton(imageId: string): HTMLElement {
    const imageLink = this.getImageLink(imageId);
    const iconBtn = document.createElement('a');
    iconBtn.className = 'icon-btn icon-btn--image';
    iconBtn.href = imageLink;
    iconBtn.target = '_blank';
    iconBtn.rel = 'noopener noreferrer';
    iconBtn.setAttribute('aria-label', 'View full image');
    iconBtn.title = 'Open image in Stash';
    this.applyIconButtonStyles(iconBtn);
    iconBtn.style.color = THEME.colors.accentPrimary;
    iconBtn.style.padding = '0';
    iconBtn.style.width = '44px';
    iconBtn.style.height = '44px';
    iconBtn.style.minWidth = '44px';
    iconBtn.style.minHeight = '44px';
    iconBtn.innerHTML = EXTERNAL_LINK_SVG;

    this.addHoverEffect(iconBtn);
    return iconBtn;
  }

  protected buildRatingDisplayButton(options: {
    title: string;
    onClick: (event: MouseEvent) => void;
  }): { button: HTMLButtonElement; iconSpan: HTMLSpanElement; valueSpan: HTMLSpanElement } {
    const displayButton = document.createElement('button');
    displayButton.type = 'button';
    displayButton.className = 'icon-btn icon-btn--rating';
    displayButton.setAttribute('aria-haspopup', 'dialog');
    displayButton.setAttribute('aria-expanded', 'false');
    displayButton.title = options.title;
    this.applyIconButtonStyles(displayButton);
    displayButton.style.padding = '8px 12px';
    displayButton.style.gap = '3px';
    displayButton.style.width = 'auto';
    displayButton.style.minWidth = '44px';
    displayButton.style.height = 'auto';
    displayButton.style.minHeight = '44px';

    displayButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      options.onClick(event);
    });

    this.addHoverEffect(displayButton);

    const iconSpan = document.createElement('span');
    iconSpan.className = 'rating-display__icon';
    iconSpan.innerHTML = STAR_SVG;
    iconSpan.style.display = 'flex';
    iconSpan.style.alignItems = 'center';
    iconSpan.style.justifyContent = 'center';
    iconSpan.style.color = THEME.colors.iconInactive;

    const valueSpan = document.createElement('span');
    valueSpan.className = 'rating-display__value';
    valueSpan.style.fontSize = THEME.typography.sizeBody;
    valueSpan.style.fontWeight = THEME.typography.weightBodyStrong;
    valueSpan.style.minWidth = '14px';
    valueSpan.style.textAlign = 'left';

    displayButton.appendChild(iconSpan);
    displayButton.appendChild(valueSpan);

    return { button: displayButton, iconSpan, valueSpan };
  }

  protected createRatingStarIcon(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'rating-dialog__star-icon';
    wrapper.style.position = 'relative';
    wrapper.style.width = '24px';
    wrapper.style.height = '24px';
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.justifyContent = 'center';

    const outlineSpan = document.createElement('span');
    outlineSpan.className = 'rating-dialog__star-outline';
    outlineSpan.innerHTML = STAR_SVG_OUTLINE;
    outlineSpan.style.position = 'absolute';
    outlineSpan.style.display = 'flex';
    outlineSpan.style.alignItems = 'center';
    outlineSpan.style.justifyContent = 'center';
    outlineSpan.style.color = `var(--rating-star-outline, ${THEME.colors.textPrimary})`;

    const fillSpan = document.createElement('span');
    fillSpan.className = 'rating-dialog__star-fill';
    fillSpan.innerHTML = STAR_SVG;
    fillSpan.style.position = 'absolute';
    fillSpan.style.display = 'flex';
    fillSpan.style.alignItems = 'center';
    fillSpan.style.justifyContent = 'center';
    fillSpan.style.color = `var(--rating-star-fill, ${THEME.colors.ratingLow})`;
    fillSpan.style.clipPath = 'inset(0 100% 0 0)';

    wrapper.appendChild(outlineSpan);
    wrapper.appendChild(fillSpan);
    return wrapper;
  }

  protected openAddTagDialogBase(options: {
    state: AddTagDialogState;
    buttonGroup?: HTMLElement;
    onSearch: (searchTerm: string) => void;
    onSubmit: () => void;
    onAdjustPosition?: (dialog: HTMLElement) => void;
    focusAfterClose?: HTMLElement | null;
  }): void {
    const { state } = options;
    if (state.isOpen) return;

    if (!state.dialog) {
      this.createAddTagDialogBase(options);
    }

    if (!state.dialog || !options.buttonGroup) return;

    state.isOpen = true;
    state.selectedTagId = undefined;
    state.selectedTagName = undefined;
    if (state.input) {
      state.input.value = '';
    }

    this.updateAddTagDialogState(state);

    options.buttonGroup.style.position = 'relative';
    if (!state.dialog.parentElement) {
      options.buttonGroup.appendChild(state.dialog);
    }

    state.dialog.hidden = false;
    state.dialog.setAttribute('aria-hidden', 'false');
    state.dialog.style.opacity = '1';
    state.dialog.style.transform = 'translateX(-50%) translateY(0) scale(1)';
    state.dialog.style.pointerEvents = 'auto';

    const adjustPosition = options.onAdjustPosition;
    if (adjustPosition) {
      requestAnimationFrame(() => {
        if (state.dialog) {
          adjustPosition(state.dialog);
        }
      });
    }

    if (!state.outsideClickHandler) {
      state.outsideClickHandler = (event: Event) => {
        if (!state.isOpen || !state.dialog) return;
        const target = event.target as Node | null;
        if (target && state.dialog.contains(target)) {
          return;
        }
        this.closeAddTagDialogBase({
          state,
          focusAfterClose: options.focusAfterClose
        });
      };
    }

    if (!state.keydownHandler) {
      state.keydownHandler = (event: KeyboardEvent) => {
        if (!state.isOpen) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          this.closeAddTagDialogBase({
            state,
            focusAfterClose: options.focusAfterClose
          });
        }
      };
    }

    document.addEventListener('mousedown', state.outsideClickHandler);
    document.addEventListener('touchstart', state.outsideClickHandler);
    document.addEventListener('keydown', state.keydownHandler);

    requestAnimationFrame(() => {
      state.input?.focus();
    });
  }

  protected closeAddTagDialogBase(options: { state: AddTagDialogState; focusAfterClose?: HTMLElement | null }): void {
    const { state, focusAfterClose } = options;
    if (!state.isOpen) return;
    state.isOpen = false;

    if (state.autocompleteDebounceTimer) {
      clearTimeout(state.autocompleteDebounceTimer);
      state.autocompleteDebounceTimer = undefined;
    }
    if (state.tagSearchLoadingTimer) {
      clearTimeout(state.tagSearchLoadingTimer);
      state.tagSearchLoadingTimer = undefined;
    }

    if (state.dialog) {
      state.dialog.style.opacity = '0';
      state.dialog.style.transform = 'translateX(-50%) translateY(4px) scale(0.96)';
      state.dialog.style.pointerEvents = 'none';
      setTimeout(() => {
        if (state.dialog && !state.isOpen) {
          state.dialog.hidden = true;
          state.dialog.setAttribute('aria-hidden', 'true');
        }
      }, 200);
    }

    if (state.suggestions) {
      state.suggestions.style.display = 'none';
    }

    if (state.outsideClickHandler) {
      document.removeEventListener('mousedown', state.outsideClickHandler);
      document.removeEventListener('touchstart', state.outsideClickHandler);
    }
    if (state.keydownHandler) {
      document.removeEventListener('keydown', state.keydownHandler);
    }

    focusAfterClose?.focus();
  }

  protected handleAddTagInputBase(options: { state: AddTagDialogState; onSearch: (searchTerm: string) => void }): void {
    const { state, onSearch } = options;
    if (!state.input) return;

    const searchTerm = state.input.value.trim();
    state.selectedTagId = undefined;
    state.selectedTagName = undefined;
    this.updateAddTagDialogState(state);

    if (state.autocompleteDebounceTimer) {
      clearTimeout(state.autocompleteDebounceTimer);
    }
    if (state.tagSearchLoadingTimer) {
      clearTimeout(state.tagSearchLoadingTimer);
      state.tagSearchLoadingTimer = undefined;
    }

    if (searchTerm.length === 0) {
      if (state.suggestions) {
        state.suggestions.style.display = 'none';
      }
      return;
    }

    state.autocompleteDebounceTimer = setTimeout(() => {
      onSearch(searchTerm);
    }, 250);
  }

  protected updateAddTagDialogState(state: AddTagDialogState): void {
    if (!state.createButton) return;
    const hasSelection = !!state.selectedTagId && !!state.selectedTagName;
    state.createButton.disabled = !hasSelection;
    state.createButton.style.opacity = hasSelection ? '1' : '0.5';
  }

  protected async searchTagsForSelect(state: AddTagDialogState, searchTerm: string): Promise<void> {
    if (!this.api || !state.suggestions) return;

    try {
      const tags = await this.api.findTagsForSelect(searchTerm, 10);
      state.suggestions.innerHTML = '';
      state.suggestions.style.display = tags.length > 0 ? 'block' : 'none';

      for (const tag of tags) {
        const item = document.createElement('div');
        item.style.padding = '10px 12px';
        item.style.cursor = 'pointer';
        item.style.color = THEME.colors.textPrimary;
        item.style.fontSize = THEME.typography.sizeBody;
        item.style.borderBottom = `1px solid ${THEME.colors.border}`;
        item.textContent = tag.name;
        item.addEventListener('mouseenter', () => {
          item.style.background = THEME.colors.backgroundSecondary;
        });
        item.addEventListener('mouseleave', () => {
          item.style.background = 'transparent';
        });
        item.addEventListener('click', () => {
          state.selectedTagId = tag.id;
          state.selectedTagName = tag.name;
          if (state.input) {
            state.input.value = tag.name;
          }
          this.updateAddTagDialogState(state);
          if (state.suggestions) {
            state.suggestions.style.display = 'none';
          }
        });
        state.suggestions.appendChild(item);
      }
    } catch (error) {
      console.error('Failed to search tags', error);
    }
  }

  private createAddTagDialogBase(options: {
    state: AddTagDialogState;
    onSearch: (searchTerm: string) => void;
    onSubmit: () => void;
    focusAfterClose?: HTMLElement | null;
  }): void {
    const { state, onSearch, onSubmit } = options;
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
    dialog.style.background = THEME.colors.backgroundSecondary;
    dialog.style.backdropFilter = 'blur(18px) saturate(160%)';
    dialog.style.border = `1px solid ${THEME.colors.border}`;
    dialog.style.borderRadius = THEME.radius.card;
    dialog.style.padding = THEME.spacing.cardPadding;
    dialog.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.4)';
    dialog.style.zIndex = '200';
    dialog.style.opacity = '0';
    dialog.style.transform = 'translateX(-50%) translateY(4px) scale(0.96)';
    dialog.style.pointerEvents = 'none';
    dialog.style.transition = 'opacity 0.2s cubic-bezier(0.2, 0, 0, 1), transform 0.2s cubic-bezier(0.2, 0, 0, 1)';
    dialog.style.boxSizing = 'border-box';
    state.dialog = dialog;

    const title = document.createElement('div');
    title.textContent = 'Add Tag';
    title.style.fontSize = '16px';
    title.style.fontWeight = '600';
    title.style.color = THEME.colors.textPrimary;
    title.style.marginBottom = '12px';
    dialog.appendChild(title);

    const inputWrapper = document.createElement('div');
    inputWrapper.style.position = 'relative';
    inputWrapper.style.marginBottom = '12px';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Search for tag...';
    input.style.width = '100%';
    input.style.padding = '10px 12px';
    input.style.background = THEME.colors.surface;
    input.style.border = `1px solid ${THEME.colors.border}`;
    input.style.borderRadius = THEME.radius.button;
    input.style.color = THEME.colors.textPrimary;
    input.style.fontSize = THEME.typography.sizeBody;
    input.style.boxSizing = 'border-box';
    input.setAttribute('aria-label', 'Tag name');
    state.input = input;

    input.addEventListener('input', () => {
      this.handleAddTagInputBase({ state, onSearch });
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && state.selectedTagId && state.createButton && !state.createButton.disabled) {
        event.preventDefault();
        onSubmit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.closeAddTagDialogBase({ state, focusAfterClose: options.focusAfterClose });
      }
    });

    inputWrapper.appendChild(input);

    const suggestions = document.createElement('div');
    suggestions.className = 'add-tag-dialog__suggestions';
    suggestions.style.display = 'none';
    suggestions.style.position = 'absolute';
    suggestions.style.top = '100%';
    suggestions.style.left = '0';
    suggestions.style.right = '0';
    suggestions.style.background = THEME.colors.backgroundSecondary;
    suggestions.style.border = `1px solid ${THEME.colors.border}`;
    suggestions.style.borderTop = 'none';
    suggestions.style.borderRadius = `0 0 ${THEME.radius.card} ${THEME.radius.card}`;
    suggestions.style.maxHeight = '200px';
    suggestions.style.overflowY = 'auto';
    suggestions.style.zIndex = '201';
    suggestions.style.marginTop = '4px';
    state.suggestions = suggestions;
    inputWrapper.appendChild(suggestions);

    dialog.appendChild(inputWrapper);

    const buttonContainer = document.createElement('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.gap = '8px';
    buttonContainer.style.justifyContent = 'flex-end';

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.style.padding = '8px 16px';
    cancelButton.style.borderRadius = THEME.radius.button;
    cancelButton.style.border = `1px solid ${THEME.colors.border}`;
    cancelButton.style.background = 'transparent';
    cancelButton.style.color = THEME.colors.textSecondary;
    cancelButton.style.cursor = 'pointer';
    cancelButton.style.fontSize = THEME.typography.sizeBody;
    cancelButton.addEventListener('click', () => this.closeAddTagDialogBase({ state, focusAfterClose: options.focusAfterClose }));
    buttonContainer.appendChild(cancelButton);

    const addButton = document.createElement('button');
    addButton.id = 'add-tag-dialog-action-button';
    addButton.textContent = 'Add';
    addButton.style.padding = '8px 16px';
    addButton.style.borderRadius = THEME.radius.button;
    addButton.style.border = 'none';
    addButton.style.background = THEME.colors.accentPrimary;
    addButton.style.color = THEME.colors.textPrimary;
    addButton.style.cursor = 'pointer';
    addButton.style.fontSize = THEME.typography.sizeBody;
    addButton.style.fontWeight = THEME.typography.weightTitle;
    addButton.disabled = true;
    addButton.style.opacity = '0.5';
    state.createButton = addButton;
    addButton.addEventListener('click', () => {
      onSubmit();
    });
    buttonContainer.appendChild(addButton);

    dialog.appendChild(buttonContainer);
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
      btn.style.color = THEME.colors.ratingHigh;
      btn.title = 'Remove from favorites';
    } else {
      btn.innerHTML = HEART_SVG_OUTLINE;
      btn.style.color = THEME.colors.iconInactive;
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
    oCountBtn.style.fontSize = THEME.typography.sizeBody;
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

