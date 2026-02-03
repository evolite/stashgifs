/**
 * Base Post Component
 * Shared functionality for VideoPost and ImagePost
 */

import { FavoritesManager } from './FavoritesManager.js';
import { StashAPI } from './StashAPI.js';
import { VisibilityManager } from './VisibilityManager.js';
import { normalizeMediaUrl, showToast, isMobileDevice, THEME } from './utils.js';
import { VERIFIED_CHECKMARK_SVG, ADD_TAG_SVG, HEART_SVG_OUTLINE, HEART_SVG_FILLED, OCOUNT_SVG, EXTERNAL_LINK_SVG, STAR_SVG, STAR_SVG_OUTLINE } from './icons.js';
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
  lastTagResults?: Array<{ id: string; name: string }>;
  onSubmit?: () => void;
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
  /**
   * Abstract property for post data (must be implemented by subclasses)
   */
  protected abstract data: any;

  /**
   * Abstract method to refresh header (must be implemented by subclasses)
   */
  protected abstract refreshHeader(): void;

  // @ts-nocheck
  // eslint-disable @typescript-eslint/no-explicit-any
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
  protected isReelMode: boolean = false;
  protected showVerifiedCheckmarks: boolean = true;
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
    onTagChipClick?: (tagId: number, tagName: string) => void | Promise<void>,
    showVerifiedCheckmarks?: boolean
  ) {
    this.container = container;
    this.favoritesManager = favoritesManager;
    this.api = api;
    this.visibilityManager = visibilityManager;
    this.onPerformerChipClick = onPerformerChipClick;
    this.onTagChipClick = onTagChipClick;
    this.showVerifiedCheckmarks = showVerifiedCheckmarks !== false;
    
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

  private getOrientationFromAspectRatio(aspectRatio: number): 'portrait' | 'landscape' | 'square' {
    if (aspectRatio < 0.95) {
      return 'portrait';
    }
    if (aspectRatio > 1.05) {
      return 'landscape';
    }
    return 'square';
  }

  protected setAspectRatioMetadata(container: HTMLElement, aspectRatio: number): void {
    container.dataset.aspectRatio = aspectRatio.toString();
    container.dataset.orientation = this.getOrientationFromAspectRatio(aspectRatio);
  }

  protected applyReelModeLayout(elements: {
    header: HTMLElement;
    playerContainer: HTMLElement;
    footer: HTMLElement;
  }): void {
    this.applyReelContainerStyles();
    const isPortrait = this.applyReelPlayerStyles(elements.playerContainer);
    this.applyReelMediaStyles(elements.playerContainer, isPortrait);

    const isMobile = isMobileDevice();
    this.applyReelHeaderStyles(elements.header, isMobile);
    this.applyReelFooterStyles(elements.footer, isMobile);
  }

  private applyReelContainerStyles(): void {
    this.container.style.border = 'none';
    this.container.style.borderRadius = '0';
    this.container.style.backgroundColor = 'transparent';
    this.container.style.width = '100%';
    const reelHeight = CSS.supports('height', '100svh') ? '100svh' : '100vh';
    this.container.style.height = reelHeight;
    this.container.style.minHeight = reelHeight;
    this.container.style.display = 'flex';
    this.container.style.flexDirection = 'column';
    this.container.style.justifyContent = 'center';
    this.container.style.overflow = 'hidden';
    this.container.style.scrollSnapAlign = 'start';
    this.container.style.scrollSnapStop = 'always';
    this.container.dataset.reelMode = 'true';
    
    // Add gradient overlay
    this.addReelGradientOverlay();
  }

  private addReelGradientOverlay(): void {
    // Remove existing gradient overlay if any
    const existingOverlay = this.container.querySelector('.reel-gradient-overlay');
    if (existingOverlay) {
      existingOverlay.remove();
    }
    
    // Only add gradient if in reel mode
    if (!this.isReelMode) {
      return;
    }
    
    // Create gradient overlay
    const gradient = document.createElement('div');
    gradient.className = 'reel-gradient-overlay';
    gradient.style.position = 'absolute';
    gradient.style.bottom = '0';
    gradient.style.left = '0';
    gradient.style.right = '0';
    gradient.style.height = '20%';
    gradient.style.background = 'linear-gradient(to top, rgba(0, 0, 0, 0.4) 0%, transparent 100%)';
    gradient.style.pointerEvents = 'none';
    gradient.style.zIndex = '1';
    
    this.container.appendChild(gradient);
  }

  private removeReelGradientOverlay(): void {
    const existingOverlay = this.container.querySelector('.reel-gradient-overlay');
    if (existingOverlay) {
      existingOverlay.remove();
    }
  }

  private applyReelPlayerStyles(playerContainer: HTMLElement): boolean {
    playerContainer.style.flex = '1 1 auto';
    playerContainer.style.width = '100%';
    playerContainer.style.height = '100%';
    playerContainer.style.maxHeight = '100%';
    playerContainer.style.maxWidth = '100%';
    playerContainer.style.aspectRatio = 'auto';
    playerContainer.style.margin = '0';

    const aspectRatioValue = Number.parseFloat(playerContainer.dataset.aspectRatio ?? '');
    const orientationValue = playerContainer.dataset.orientation;
    const resolvedOrientation = orientationValue ?? (Number.isFinite(aspectRatioValue)
      ? this.getOrientationFromAspectRatio(aspectRatioValue)
      : 'landscape');
    const isPortrait = resolvedOrientation === 'portrait';

    if (isPortrait && Number.isFinite(aspectRatioValue) && aspectRatioValue > 0) {
      playerContainer.style.width = `min(100%, ${aspectRatioValue * 100}vh)`;
      playerContainer.style.margin = '0 auto';
      playerContainer.style.backgroundColor = THEME.colors.backgroundPrimary;
      playerContainer.style.backgroundImage = 'linear-gradient(90deg, var(--color-accent-weak) 0%, transparent 22%, transparent 78%, var(--color-accent-weak) 100%)';
    } else {
      playerContainer.style.backgroundColor = '';
      playerContainer.style.backgroundImage = '';
    }

    this.removeAspectClasses(playerContainer);
    return isPortrait;
  }

  private removeAspectClasses(container: HTMLElement): void {
    for (const className of Array.from(container.classList)) {
      if (className.startsWith('aspect-')) {
        container.classList.remove(className);
      }
    }
  }

  private applyReelMediaStyles(playerContainer: HTMLElement, isPortrait: boolean): void {
    const mediaElements = playerContainer.querySelectorAll<HTMLElement>('video, img');
    for (const mediaElement of mediaElements) {
      mediaElement.style.objectFit = isPortrait ? 'contain' : 'cover';
    }
  }

  private applyReelHeaderStyles(header: HTMLElement, isMobile: boolean): void {
    const bottomOffset = 70;
    const headerRightOffset = isMobile ? 96 : 120;
    const headerPadding = isMobile ? '8px 12px' : '10px 14px';
    const textShadow = '0 2px 8px rgba(0, 0, 0, 0.65)';

    header.style.position = 'absolute';
    header.style.left = '16px';
    header.style.right = `${headerRightOffset}px`;
    header.style.bottom = `${bottomOffset}px`;
    header.style.top = 'auto';
    header.style.zIndex = '6';
    header.style.padding = headerPadding;
    header.style.borderRadius = '0';
    header.style.background = 'transparent';
    header.style.backdropFilter = 'none';
    header.style.boxShadow = 'none';
    header.style.pointerEvents = 'auto';
    header.style.fontSize = isMobile ? '' : '15px';
    header.style.width = 'fit-content';
    header.style.maxWidth = isMobile ? 'calc(100% - 120px)' : '55%';
    header.style.color = '#ffffff';
    header.style.textShadow = textShadow;

    const headerElements = header.querySelectorAll<HTMLElement>('a, span, button, div, p, h1, h2, h3, h4');
    for (const element of headerElements) {
      element.style.color = '#ffffff';
      element.style.textShadow = textShadow;
    }

    const headerIcons = header.querySelectorAll<SVGElement>('svg');
    for (const icon of headerIcons) {
      icon.style.filter = 'drop-shadow(0 2px 6px rgba(0, 0, 0, 0.6))';
    }

    const verifiedIcons = header.querySelectorAll<HTMLElement>('.performer-chip__verified');
    for (const icon of verifiedIcons) {
      icon.style.color = THEME.colors.accentPrimary;
      icon.style.textShadow = textShadow;
    }
  }

  private applyReelFooterStyles(footer: HTMLElement, isMobile: boolean): void {
    const bottomOffset = 70;

    footer.style.position = 'absolute';
    footer.style.right = '16px';
    footer.style.bottom = `${bottomOffset}px`;
    footer.style.top = 'auto';
    footer.style.transform = 'none';
    footer.style.padding = '0';
    footer.style.background = 'transparent';
    footer.style.pointerEvents = 'auto';
    footer.style.color = '#ffffff';
    footer.style.textShadow = '0 2px 8px rgba(0, 0, 0, 0.65)';

    const footerElements = footer.querySelectorAll<HTMLElement>('a, span, button, div, p, h1, h2, h3, h4');
    for (const element of footerElements) {
      element.style.color = '#ffffff';
      element.style.textShadow = '0 2px 8px rgba(0, 0, 0, 0.65)';
    }

    const footerIcons = footer.querySelectorAll<SVGElement>('svg');
    for (const icon of footerIcons) {
      icon.style.filter = 'drop-shadow(0 2px 6px rgba(0, 0, 0, 0.6))';
    }

    this.applyReelFooterStack(footer, isMobile);

    const activeRatingIcons = footer.querySelectorAll<HTMLElement>(
      '.icon-btn--rating-active .rating-display__icon'
    );
    for (const icon of activeRatingIcons) {
      icon.style.color = '#FFD700';
      icon.style.textShadow = '0 2px 8px rgba(0, 0, 0, 0.65)';
    }
  }

  private applyReelFooterStack(footer: HTMLElement, isMobile: boolean): void {
    const info = footer.querySelector<HTMLElement>('.video-post__info');
    const row = footer.querySelector<HTMLElement>('.video-post__row');
    const buttonGroup = footer.querySelector<HTMLElement>('.video-post__button-group');

    const stackGap = '8px';

    if (info) {
      info.style.flexDirection = 'column';
      info.style.alignItems = 'center';
      info.style.justifyContent = 'center';
      info.style.gap = stackGap;
    }

    if (row) {
      row.style.flexDirection = 'column';
      row.style.alignItems = 'center';
      row.style.justifyContent = 'center';
      row.style.gap = stackGap;
    }

    if (buttonGroup) {
      buttonGroup.style.flexDirection = 'column';
      buttonGroup.style.alignItems = 'center';
      buttonGroup.style.gap = '8px';

      const buttons = Array.from(buttonGroup.querySelectorAll<HTMLElement>('button, a'));
      for (const button of buttons) {
        button.style.color = '#ffffff';
        button.style.textShadow = '0 2px 8px rgba(0, 0, 0, 0.65)';
        button.style.filter = 'drop-shadow(0 2px 6px rgba(0, 0, 0, 0.6))';
        if (!isMobile) {
          button.style.fontSize = '15px';
        }
      }

      const accentButtons = buttonGroup.querySelectorAll<HTMLElement>(
        '.icon-btn--play, .icon-btn--image, .icon-btn--add-tag'
      );
      for (const button of accentButtons) {
        button.style.color = THEME.colors.accentPrimary;
        button.style.textShadow = '0 2px 8px rgba(0, 0, 0, 0.65)';
      }
    }
  }

  public setReelMode(isReelMode: boolean): void {
    this.isReelMode = isReelMode;
    if (!isReelMode) {
      return;
    }
    const header = this.container.querySelector<HTMLElement>('.video-post__header');
    const playerContainer = this.container.querySelector<HTMLElement>('.video-post__player');
    const footer = this.container.querySelector<HTMLElement>('.video-post__footer');
    if (header && playerContainer && footer) {
      this.applyReelModeLayout({ header, playerContainer, footer });
    }
  }

  public setShowVerifiedCheckmarks(showVerified: boolean): void {
    this.showVerifiedCheckmarks = showVerified;
    const verifiedIcons = this.container.querySelectorAll<HTMLElement>('.performer-chip__verified');
    for (const icon of verifiedIcons) {
      icon.style.display = showVerified ? 'inline-flex' : 'none';
    }
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
    row.style.gap = '8px';
    row.style.position = 'relative';
    row.style.zIndex = '10';

    const buttonGroup = document.createElement('div');
    buttonGroup.className = 'video-post__button-group';
    buttonGroup.style.display = 'flex';
    buttonGroup.style.alignItems = 'center';
    buttonGroup.style.gap = '8px';
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
    chip.style.gap = '8px';
    chip.style.fontSize = '16px';
    chip.style.lineHeight = '1.2';
    chip.style.color = THEME.colors.textSecondary;
    chip.style.textDecoration = 'none';
    chip.style.transition = 'color 0.2s ease, opacity 0.2s ease';
    chip.style.cursor = 'pointer';
    chip.style.minHeight = '44px';
    chip.style.height = '44px';
    
    // Apply reel mode specific styling
    if (this.isReelMode) {
      chip.style.background = 'transparent';
      chip.style.border = 'none';
      chip.style.boxShadow = 'none';
      chip.style.backdropFilter = 'none';
      chip.style.color = '#ffffff';
      chip.style.textShadow = '0 2px 8px rgba(0, 0, 0, 0.65)';
    }
    
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
    const canHover = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;
    
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
    imageContainer.style.width = '40px';
    imageContainer.style.height = '40px';
    imageContainer.style.borderRadius = '50%';
    imageContainer.style.background = THEME.colors.backgroundSecondary;
    imageContainer.style.display = 'flex';
    imageContainer.style.alignItems = 'center';
    imageContainer.style.justifyContent = 'center';
    imageContainer.style.fontSize = '24px';
    imageContainer.style.fontWeight = THEME.typography.weightTitle;
    imageContainer.style.color = THEME.colors.textSecondary;
    imageContainer.style.flexShrink = '0';
    imageContainer.style.overflow = 'hidden';
    
    if (performer.image_path) {
      const imageSrc = normalizeMediaUrl(performer.image_path);
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
        console.warn('BasePost: Invalid performer image URL', { url: performer.image_path, performer: performer.name });
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
    checkmarkIcon.className = 'performer-chip__verified';
    checkmarkIcon.innerHTML = VERIFIED_CHECKMARK_SVG;
    checkmarkIcon.style.display = this.showVerifiedCheckmarks ? 'inline-flex' : 'none';
    checkmarkIcon.style.alignItems = 'center';
    checkmarkIcon.style.width = '18px';
    checkmarkIcon.style.height = '18px';
    checkmarkIcon.style.flexShrink = '0';
    checkmarkIcon.style.marginLeft = '-4px';
    checkmarkIcon.style.color = THEME.colors.accentPrimary;
    chip.appendChild(checkmarkIcon);
    
    // Hover effect
    chip.addEventListener('mouseenter', () => {
      chip.style.color = this.isReelMode ? '#ffffff' : THEME.colors.textPrimary;
    });
    chip.addEventListener('mouseleave', () => {
      chip.style.color = this.isReelMode ? '#ffffff' : THEME.colors.textSecondary;
    });

    // Add hover overlay handlers
    if (this.api && canHover) {
      chip.addEventListener('mouseenter', () => {
        // Cancel any pending hide timeout (when moving from another chip)
        if (this.performerOverlayHideTimeout) {
          clearTimeout(this.performerOverlayHideTimeout);
          this.performerOverlayHideTimeout = undefined;
        }
        this.showPerformerOverlay(performer.id, chip, () => this.removePerformerAction(performer.id, performer.name));
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
      const imageSrc = normalizeMediaUrl(performerData.image_path);
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
        console.warn('BasePost: Invalid performer overlay image URL', { url: performerData.image_path, performer: performerData.name });
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
  private createPerformerOverlayNameRow(performerData: PerformerExtended, onRemove?: () => Promise<boolean>): HTMLElement {
    const nameRow = document.createElement('div');
    nameRow.style.display = 'flex';
    nameRow.style.alignItems = 'center';
    nameRow.style.gap = '6px';
    nameRow.style.marginBottom = '8px';

    const leftGroup = document.createElement('div');
    leftGroup.style.display = 'flex';
    leftGroup.style.alignItems = 'center';
    leftGroup.style.gap = '6px';

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
    externalIcon.innerHTML = EXTERNAL_LINK_SVG;
    externalIcon.style.display = 'inline-flex';
    externalIcon.style.alignItems = 'center';
    externalIcon.style.opacity = '0.7';
    externalIcon.style.flexShrink = '0';
    externalIcon.style.color = THEME.colors.accentPrimary;
    nameLink.appendChild(externalIcon);

    leftGroup.appendChild(nameLink);

    if (performerData.favorite) {
      const favoriteIcon = document.createElement('span');
      favoriteIcon.innerHTML = HEART_SVG_FILLED;
      favoriteIcon.style.display = 'inline-flex';
      favoriteIcon.style.alignItems = 'center';
      favoriteIcon.style.color = THEME.colors.ratingHigh;
      leftGroup.appendChild(favoriteIcon);
    }

    nameRow.appendChild(leftGroup);

    if (onRemove) {
      nameRow.style.justifyContent = 'space-between';
      nameRow.style.width = '100%';

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.textContent = '✕';
      removeButton.setAttribute('aria-label', 'Remove performer');
      removeButton.title = 'Remove performer';
      removeButton.style.width = '24px';
      removeButton.style.height = '24px';
      removeButton.style.borderRadius = '50%';
      removeButton.style.border = 'none';
      removeButton.style.background = 'rgba(232, 92, 92, 0.12)';
      removeButton.style.color = '#E85C5C';
      removeButton.style.fontSize = '12px';
      removeButton.style.fontWeight = THEME.typography.weightBodyStrong;
      removeButton.style.cursor = 'pointer';
      removeButton.style.display = 'inline-flex';
      removeButton.style.alignItems = 'center';
      removeButton.style.justifyContent = 'center';
      removeButton.style.lineHeight = '1';
      removeButton.style.flexShrink = '0';
      removeButton.style.transition = 'background 0.2s ease, opacity 0.2s ease';

      removeButton.addEventListener('mouseenter', () => {
        removeButton.style.background = 'rgba(232, 92, 92, 0.2)';
      });
      removeButton.addEventListener('mouseleave', () => {
        removeButton.style.background = 'rgba(232, 92, 92, 0.12)';
      });

      removeButton.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (removeButton.disabled) return;
        removeButton.disabled = true;
        removeButton.textContent = '…';
        removeButton.style.opacity = '0.7';

        try {
          const removed = await onRemove();
          if (removed) {
            this.hidePerformerOverlay(true);
            return;
          }
        } catch (error) {
          console.error('Failed to remove performer', error);
          showToast('Failed to remove performer. Please try again.');
        } finally {
          removeButton.disabled = false;
          removeButton.textContent = '✕';
          removeButton.style.opacity = '1';
        }
      });

      nameRow.appendChild(removeButton);
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
  private createPerformerOverlay(performerData: PerformerExtended, onRemove?: () => Promise<boolean>): HTMLElement {
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
    const nameRow = this.createPerformerOverlayNameRow(performerData, onRemove);
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
  private showPerformerOverlay(performerId: string, chipElement: HTMLElement, onRemove?: () => Promise<boolean>): void {
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
        const overlay = this.createPerformerOverlay(performerData, onRemove);
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
      const imageSrc = normalizeMediaUrl(tagData.image_path);
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
      console.warn('BasePost: Invalid tag image URL', { url: tagData.image_path, tag: tagData.name });
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
  private createTagOverlay(
    tagData: { id: string; name: string; image_path?: string; description?: string },
    onRemove?: () => Promise<boolean>
  ): HTMLElement {
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

    if (onRemove) {
      nameRow.style.justifyContent = 'space-between';

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.textContent = '✕';
      removeButton.setAttribute('aria-label', 'Remove tag');
      removeButton.title = 'Remove tag';
      removeButton.style.width = '24px';
      removeButton.style.height = '24px';
      removeButton.style.borderRadius = '50%';
      removeButton.style.border = 'none';
      removeButton.style.background = 'rgba(232, 92, 92, 0.12)';
      removeButton.style.color = '#E85C5C';
      removeButton.style.fontSize = '12px';
      removeButton.style.fontWeight = THEME.typography.weightBodyStrong;
      removeButton.style.cursor = 'pointer';
      removeButton.style.display = 'inline-flex';
      removeButton.style.alignItems = 'center';
      removeButton.style.justifyContent = 'center';
      removeButton.style.lineHeight = '1';
      removeButton.style.flexShrink = '0';
      removeButton.style.transition = 'background 0.2s ease, opacity 0.2s ease';

      removeButton.addEventListener('mouseenter', () => {
        removeButton.style.background = 'rgba(232, 92, 92, 0.2)';
      });
      removeButton.addEventListener('mouseleave', () => {
        removeButton.style.background = 'rgba(232, 92, 92, 0.12)';
      });

      removeButton.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (removeButton.disabled) return;
        removeButton.disabled = true;
        removeButton.textContent = '…';
        removeButton.style.opacity = '0.7';

        try {
          const removed = await onRemove();
          if (removed) {
            this.hideTagOverlay(true);
            return;
          }
        } catch (error) {
          console.error('Failed to remove tag', error);
          showToast('Failed to remove tag. Please try again.');
        } finally {
          removeButton.disabled = false;
          removeButton.textContent = '✕';
          removeButton.style.opacity = '1';
        }
      });

      nameRow.appendChild(removeButton);
    }

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
  private showTagOverlay(tagId: string, chipElement: HTMLElement, onRemove?: () => Promise<boolean>): void {
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
        const overlay = this.createTagOverlay(tagData, onRemove);
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
    
    // Apply reel mode specific styling
    if (this.isReelMode) {
      hashtag.style.background = 'transparent';
      hashtag.style.border = 'none';
      hashtag.style.boxShadow = 'none';
      hashtag.style.backdropFilter = 'none';
      hashtag.style.color = '#ffffff';
      hashtag.style.textShadow = '0 2px 8px rgba(0, 0, 0, 0.65)';
    }
    
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
      hashtag.style.color = this.isReelMode ? '#ffffff' : THEME.colors.textPrimary;
    });
    hashtag.addEventListener('mouseleave', () => {
      hashtag.style.color = this.isReelMode ? '#ffffff' : THEME.colors.textSecondary;
    });
    
    const isMobile = isMobileDevice();
    const canHover = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;
    
    // Add hover overlay handlers for tags (desktop only)
    if (this.api && canHover) {
      hashtag.addEventListener('mouseenter', () => {
        // Cancel any pending hide timeout (when moving from another chip)
        if (this.tagOverlayHideTimeout) {
          clearTimeout(this.tagOverlayHideTimeout);
          this.tagOverlayHideTimeout = undefined;
        }
        this.showTagOverlay(tag.id, hashtag, () => this.removeTagAction(tag.id, tag.name));
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

  protected buildImageHeader(options: {
    performers?: Performer[];
    tags?: Tag[];
    favoriteTagName?: string;
  }): HTMLElement {
    const header = document.createElement('div');
    header.className = 'video-post__header';
    header.style.padding = '8px 16px';
    header.style.marginBottom = '0';
    header.style.borderBottom = 'none';

    // Performer section - name and image
    if (options.performers?.length) {
      const performersSection = document.createElement('div');
      performersSection.className = 'video-post__performers';
      this.appendPerformerChips(performersSection, options.performers);
      header.appendChild(performersSection);
    }

    // Tag chips section - clean line without box
    if (options.tags?.length) {
      const tagsSection = document.createElement('div');
      tagsSection.className = 'video-post__tags';
      const hasPerformers = !!options.performers?.length;
      this.appendTagChips(tagsSection, options.tags, options.favoriteTagName, hasPerformers);
      if (this.isReelMode) {
        tagsSection.style.display = 'flex';
        tagsSection.style.flexWrap = 'wrap';
        tagsSection.style.alignItems = 'center';
        tagsSection.style.gap = '4px';
        tagsSection.style.marginTop = '4px';
        tagsSection.style.opacity = '0.85';
      }
      header.appendChild(tagsSection);
    }

    return header;
  }

  private appendPerformerChips(chips: HTMLElement, performers: Performer[]): void {
    for (const performer of performers) {
      const chip = this.createPerformerChip(performer);
      chips.appendChild(chip);
    }
  }

  private appendTagChips(
    chips: HTMLElement,
    tags: Tag[],
    favoriteTagName?: string,
    hasPerformers: boolean = false
  ): void {
    let isFirstTag = true;
    for (const tag of tags) {
      if (!tag?.id || !tag?.name || tag.name === favoriteTagName) {
        continue;
      }
      const chip = this.createTagChip(tag);
      if (hasPerformers && isFirstTag) {
        chip.style.marginLeft = this.isReelMode ? '0' : '8px';
        isFirstTag = false;
      }
      chips.appendChild(chip);
    }
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
    displayButton.style.padding = '0';
    displayButton.style.gap = '0';

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
    valueSpan.textContent = '';
    valueSpan.style.display = 'none';

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
    state.onSubmit = options.onSubmit;
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

    state.outsideClickHandler ??= (event: Event) => {
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

    state.keydownHandler ??= (event: KeyboardEvent) => {
      if (!state.isOpen) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeAddTagDialogBase({
          state,
          focusAfterClose: options.focusAfterClose
        });
      }
    };

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

    state.onSubmit = undefined;

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
      state.lastTagResults = [];
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
      state.lastTagResults = tags;
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
          state.onSubmit?.();
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
      if (event.key === 'Enter') {
        if (!state.selectedTagId && state.lastTagResults && state.lastTagResults.length > 0) {
          const topResult = state.lastTagResults[0];
          state.selectedTagId = topResult.id;
          state.selectedTagName = topResult.name;
          input.value = topResult.name;
          this.updateAddTagDialogState(state);
          if (state.suggestions) {
            state.suggestions.style.display = 'none';
          }
        }

        if (state.selectedTagId && state.createButton && !state.createButton.disabled) {
          event.preventDefault();
          onSubmit();
        }
        return;
      }
      if (event.key === 'Escape') {
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
   * Abstract method to remove a tag from the current post
   */
  protected abstract removeTagAction(tagId: string, tagName: string): Promise<boolean>;

  /**
   * Shared helper for removing a tag from an image
   */
  protected async removeTagShared(
    tagId: string,
    tagName: string,
    options: {
      getCurrentTags: () => Array<{ id: string | number; name: string }> | undefined;
      apiCall: (nextTagIds: string[]) => Promise<void>;
      updateLocalTags: (remainingTags: Array<{ id: string | number; name: string }>) => void;
      entityType: 'image' | 'scene' | 'marker';
      logPrefix: string;
    }
  ): Promise<boolean> {
    const currentTagIds = (options.getCurrentTags() || [])
      .map((t) => String((t as any).id))
      .filter((id) => id.length > 0);

    if (!currentTagIds.includes(String(tagId))) {
      showToast(`Tag "${tagName}" is not on this ${options.entityType}.`);
      return false;
    }

    try {
      const nextTagIds = currentTagIds.filter((id) => id !== String(tagId));
      await options.apiCall(nextTagIds);
      options.updateLocalTags((options.getCurrentTags() || []).filter((t: any) => String(t.id) !== String(tagId)));
      showToast(`Tag "${tagName}" removed from ${options.entityType}`);
      this.refreshHeader();
      return true;
    } catch (error) {
      console.error(`${options.logPrefix}: Failed to remove tag from ${options.entityType}`, error);
      showToast('Failed to remove tag. Please try again.');
      return false;
    }
  }

  /**
   * Shared implementation for adding a tag to an image
   */
  protected async addTagToImageShared(
    state: AddTagDialogState,
    focusAfterClose?: HTMLElement | null
  ): Promise<void> {
    if (!this.api || !state.selectedTagId || !state.selectedTagName || !state.createButton) return;

    // Disable button during operation
    state.createButton.disabled = true;
    state.createButton.textContent = 'Adding...';
    state.createButton.style.opacity = '0.6';

    try {
      // Check for duplicate tag
      const currentTagIds = (this.data.image.tags || []).map((tag: any) => tag.id).filter(Boolean);
      if (currentTagIds.includes(state.selectedTagId)) {
        showToast(`Tag "${state.selectedTagName}" is already added to this image.`);
        state.createButton.disabled = false;
        state.createButton.textContent = 'Add';
        state.createButton.style.opacity = '1';
        return;
      }

      // Update via API
      const nextTagIds = [...currentTagIds, state.selectedTagId];
      await this.api.updateImageTags(this.data.image.id, nextTagIds);

      // Update local data
      this.data.image.tags ??= [];
      this.data.image.tags.push({ id: state.selectedTagId, name: state.selectedTagName });

      // Success feedback and cleanup
      showToast(`Tag "${state.selectedTagName}" added to image`);
      this.refreshHeader();
      this.closeAddTagDialogBase({ state, focusAfterClose: focusAfterClose || this.addTagButton });
    } catch (error) {
      console.error('BasePost: Failed to add tag to image', error);
      showToast('Failed to add tag. Please try again.');
      state.createButton.disabled = false;
      state.createButton.textContent = 'Add';
      state.createButton.style.opacity = '1';
    }
  }

  /**
   * Shared helper for removing a performer from an item
   */
  protected async removePerformerShared(
    performerId: string,
    performerName: string,
    options: {
      performers: Array<{ id: string }> | undefined;
      itemId: string;
      apiMethod: (id: string, performerIds: string[]) => Promise<void>;
      itemType: 'scene' | 'image';
      logPrefix: string;
    }
  ): Promise<boolean> {
    if (!this.api) {
      showToast('API not available.');
      return false;
    }

    const currentPerformerIds = (options.performers || [])
      .map((performer) => performer.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    if (!currentPerformerIds.includes(performerId)) {
      showToast(`Performer "${performerName}" is not on this ${options.itemType}.`);
      return false;
    }

    try {
      const nextPerformerIds = currentPerformerIds.filter((id) => id !== performerId);
      await options.apiMethod(options.itemId, nextPerformerIds);

      // Update local data - subclasses handle their specific data structures
      if (options.itemType === 'image') {
        (this.data.image.performers as any[]) = (options.performers || []).filter((performer) => performer.id !== performerId);
      } else if (options.itemType === 'scene') {
        (this.data.marker.scene.performers as any[]) = (options.performers || []).filter((performer) => performer.id !== performerId);
      }

      showToast(`Performer "${performerName}" removed from ${options.itemType}`);
      this.refreshHeader();
      return true;
    } catch (error) {
      console.error(`${options.logPrefix}: Failed to remove performer from ${options.itemType}`, error);
      showToast('Failed to remove performer. Please try again.');
      return false;
    }
  }

  /**
   * Abstract method to remove a performer from the current post
   */
  protected abstract removePerformerAction(performerId: string, performerName: string): Promise<boolean>;

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
    addTagBtn.style.color = THEME.colors.accentPrimary;
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
      btn.style.color = '#ffffff';
      btn.title = 'Add to favorites';
    }

    if (this.isReelMode) {
      btn.style.filter = 'drop-shadow(0 2px 6px rgba(0, 0, 0, 0.6))';
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
    oCountBtn.style.padding = '0';
    oCountBtn.style.flexShrink = '1';
    oCountBtn.style.fontSize = THEME.typography.sizeBody;
    
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
        showToast('O-count logged');
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

    this.oCountButton.innerHTML = OCOUNT_SVG;
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
