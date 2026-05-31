/**
 * Base Post Component
 * Shared functionality for VideoPost and ImagePost
 */

import { FavoritesManager } from './FavoritesManager.js';
import { StashAPI } from './StashAPI.js';
import { VisibilityManager } from './VisibilityManager.js';
import { normalizeMediaUrl, showToast, isMobileDevice, THEME, subscribeWindowScroll, applyMenuItemHover, extractValidPerformerIds, initPopoverDialog, formatViewCount } from './utils.js';
import { RatingControl } from './RatingControl.js';
import { ADD_TAG_SVG, HEART_SVG_OUTLINE, HEART_SVG_FILLED, OCOUNT_SVG, EXTERNAL_LINK_SVG, STAR_SVG, STAR_SVG_OUTLINE, VERIFIED_SVG, EYE_SVG, CLAPPERBOARD_SVG } from './icons.js';
import { DISCOVERY_ICON_SVG, type DiscoveryPanelControl } from './DiscoveryPanel.js';
import { setupTouchHandlers, preventClickAfterTouch } from './utils/touchHandlers.js';
import { adjustImageDialogPosition, toggleImageFavorite } from './utils/imagePostUtils.js';
import { OverlayManager } from './utils/OverlayManager.js';
import { PerformerExtended, StudioExtended } from './graphql/types.js';
import { Performer, Tag, VideoPostData, ImageBasedPostData, Image } from './types.js';

export interface BasePostOptions {
  favoritesManager?: FavoritesManager;
  api?: StashAPI;
  visibilityManager?: VisibilityManager;
  onPerformerChipClick?: (performerId: number, performerName: string) => void | Promise<void>;
  onTagChipClick?: (tagId: number, tagName: string) => void | Promise<void>;
  onStudioChipClick?: (studioId: number, studioName: string) => void | Promise<void>;
  showVerifiedCheckmarks?: boolean;
  showProductionAge?: boolean;
  showStudioChips?: boolean;
  showSceneTitle?: boolean;
  showOCountButton?: boolean;
  showViewCountBadge?: boolean;
  showAddTagButton?: boolean;
  discoveryPanel?: DiscoveryPanelControl;
  reelAutoScroll?: boolean;
}

interface HoverHandlers {
  mouseenter: () => void;
  mouseleave: () => void;
}

interface AddTagDialogState {
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
  private static readonly FAVORITE_TAG_NAME = 'StashGifs Favorite';

  /**
   * Post data. Concrete subclasses narrow this to their specific type.
   * BasePost's default implementations assume ImageBasedPostData; VideoPost overrides them all.
   */
  protected abstract data: VideoPostData | ImageBasedPostData;

  getPerformers(): Performer[] {
    return (this.data as ImageBasedPostData).image?.performers ?? [];
  }

  // Safe accessor for image-based posts. Only call from methods that VideoPost overrides.
  private getImageData(): ImageBasedPostData {
    return this.data as ImageBasedPostData;
  }

  /**
   * Default header for image-based posts. VideoPost overrides with scene-specific header.
   */
  protected createHeader(): HTMLElement {
    return this.buildImageHeader({
      performers: this.getImageData().image.performers,
      tags: this.getImageData().image.tags,
      studio: this.getImageData().image.studio,
      favoriteTagName: BasePost.FAVORITE_TAG_NAME,
      title: this.getImageData().image.title,
    });
  }

  protected refreshHeader(): void {
    const header = this.container.querySelector('.video-post__header');
    if (header) {
      const newHeader = this.createHeader();
      header.replaceWith(newHeader);
      this.applyReelModeLayoutIfNeeded(newHeader);
    }
  }

  protected readonly container: HTMLElement;
  protected readonly favoritesManager?: FavoritesManager;
  protected readonly api?: StashAPI;
  protected readonly visibilityManager?: VisibilityManager;
  protected readonly hoverHandlers: Map<HTMLElement, HoverHandlers> = new Map();
  protected readonly onPerformerChipClick?: (performerId: number, performerName: string) => void | Promise<void>;
  protected readonly onTagChipClick?: (tagId: number, tagName: string) => void | Promise<void>;
  protected readonly onStudioChipClick?: (studioId: number, studioName: string) => void | Promise<void>;
  protected addTagButton?: HTMLElement;
  protected heartButton?: HTMLElement;
  protected buttonGroup?: HTMLElement;
  protected addTagDialogState: AddTagDialogState = { isOpen: false };
  protected ratingSystemConfig?: { type?: string; starPrecision?: string } | null;
  protected ratingControl?: RatingControl;
  protected isFavorite: boolean = false;
  protected isTogglingFavorite: boolean = false;
  protected oCountButton?: HTMLElement;
  protected oCount: number = 0;
  protected isReelMode: boolean = false;
  protected playerContainer?: HTMLElement;
  protected footer?: HTMLElement;
  protected showVerifiedCheckmarks: boolean = true;
  protected showProductionAge: boolean = false;
  protected showStudioChips: boolean = true;
  protected showSceneTitle: boolean = false;
  protected showOCountButton: boolean = true;
  protected showViewCountBadge: boolean = true;
  protected showAddTagButton: boolean = true;
  protected discoveryPanel?: DiscoveryPanelControl;
  private discoveryCollapseUnsubscribe?: () => void;
  private discoveryJiggleTimerId?: ReturnType<typeof setTimeout>;
  private readonly touchCleanups: Array<() => void> = [];
  protected reelAutoScroll: boolean = false;
  private autoAdvanceAttached: boolean = false;
  private autoAdvanceFired: boolean = false;
  private reelAutoAdvanceElement?: HTMLVideoElement;
  private reelAutoAdvanceHandler?: () => void;
  private readonly performerOverlayMgr: OverlayManager<PerformerExtended>;
  private readonly tagOverlayMgr: OverlayManager<Tag>;
  private readonly studioOverlayMgr: OverlayManager<StudioExtended>;
  private overlayScrollCleanup?: () => void;
  // Add performer dialog
  private addPerformerDialog: HTMLElement | null = null;
  private addPerformerDialogInput: HTMLInputElement | null = null;
  private addPerformerDialogSuggestions: HTMLElement | null = null;
  private addPerformerDialogAddButton: HTMLButtonElement | null = null;
  private isAddPerformerDialogOpen = false;
  private selectedPerformerId: string | undefined;
  private selectedPerformerName: string | undefined;
  protected selectedPerformerImagePath: string | undefined;
  private addPerformerDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  private onAddPerformerDialogOutsideClick: (e: Event) => void = () => {};
  private onAddPerformerDialogKeydown: (e: KeyboardEvent) => void = () => {};

  private static readonly favoritePerformerCache: Map<string, boolean> = new Map();
  private static favoriteCacheLoaded: boolean = false;


  constructor(
    container: HTMLElement,
    options?: BasePostOptions
  ) {
    this.container = container;
    this.favoritesManager = options?.favoritesManager;
    this.api = options?.api;
    this.visibilityManager = options?.visibilityManager;
    this.onPerformerChipClick = options?.onPerformerChipClick;
    this.onTagChipClick = options?.onTagChipClick;
    this.onStudioChipClick = options?.onStudioChipClick;
    this.showVerifiedCheckmarks = options?.showVerifiedCheckmarks !== false;
    this.showProductionAge = options?.showProductionAge === true;
    this.showStudioChips = options?.showStudioChips !== false;
    this.showSceneTitle = options?.showSceneTitle === true;
    this.showOCountButton = options?.showOCountButton !== false;
    this.showViewCountBadge = options?.showViewCountBadge !== false;
    this.showAddTagButton = options?.showAddTagButton !== false;
    this.discoveryPanel = options?.discoveryPanel;
    this.reelAutoScroll = options?.reelAutoScroll === true;

    this.performerOverlayMgr = new OverlayManager<PerformerExtended>(
      (id, signal) => this.api!.getPerformerDetails(id, signal),
      (data, onRemove) => this.createPerformerOverlay(data, onRemove),
      (overlay, chip) => this.positionOverlay(overlay, chip)
    );
    this.tagOverlayMgr = new OverlayManager<Tag>(
      (id, signal) => this.api!.getTagDetails(id, signal),
      (data, onRemove) => this.createTagOverlay(data, onRemove),
      (overlay, chip) => this.positionOverlay(overlay, chip)
    );
    this.studioOverlayMgr = new OverlayManager<StudioExtended>(
      (id, signal) => this.api!.getStudioDetails(id, signal),
      (data) => this.createStudioOverlay(data),
      (overlay, chip) => this.positionOverlay(overlay, chip)
    );

    this.overlayScrollCleanup = subscribeWindowScroll(() => {
      this.performerOverlayMgr.hide(true);
      this.tagOverlayMgr.hide(true);
      this.studioOverlayMgr.hide(true);
    });
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

  protected initImagePostOptions(
    oCounter: number | undefined | null,
    ratingSystemConfig?: { type?: string; starPrecision?: string } | null,
    reelMode?: boolean
  ): void {
    this.oCount = oCounter || 0;
    this.ratingSystemConfig = ratingSystemConfig;
    this.isReelMode = reelMode === true;
  }

  protected renderImageBasedPost(className: string, postId: string, createPlayerContainer: () => HTMLElement, createFooter: () => HTMLElement): void {
    const { header, playerContainer, footer } = this.renderBasePost({
      className,
      postId,
      createHeader: () => this.createHeader(),
      createPlayerContainer,
      createFooter,
    });
    this.playerContainer = playerContainer;
    this.footer = footer;

    if (this.isReelMode) {
      this.applyReelModeLayout({ header, playerContainer, footer });
    }
  }

  destroy(): void {
    this.closeAddPerformerDialog();
    if (this.addPerformerDebounceTimer) {
      clearTimeout(this.addPerformerDebounceTimer);
      this.addPerformerDebounceTimer = undefined;
    }
    this.cleanupAddTagDialogState();

    this.performerOverlayMgr.destroy();
    this.tagOverlayMgr.destroy();
    this.studioOverlayMgr.destroy();
    if (this.overlayScrollCleanup) {
      this.overlayScrollCleanup();
      this.overlayScrollCleanup = undefined;
    }

    for (const [button] of this.hoverHandlers) {
      this.removeHoverEffect(button);
    }
    this.hoverHandlers.clear();

    if (this.discoveryCollapseUnsubscribe) {
      this.discoveryCollapseUnsubscribe();
      this.discoveryCollapseUnsubscribe = undefined;
    }
    if (this.discoveryJiggleTimerId) {
      clearTimeout(this.discoveryJiggleTimerId);
      this.discoveryJiggleTimerId = undefined;
    }
    for (const cleanup of this.touchCleanups) cleanup();
    this.touchCleanups.length = 0;
    this.detachReelAutoAdvance();
    this.ratingControl?.destroy();
    this.ratingControl = undefined;
  }

  private static loadFavoritePerformerCache(): void {
    if (this.favoriteCacheLoaded) {
      return;
    }
    this.favoriteCacheLoaded = true;
    try {
      const stored = globalThis.localStorage?.getItem('stashgifs-performer-favorites');
      if (!stored) return;
      const parsed = JSON.parse(stored) as Record<string, boolean>;
      for (const [id, value] of Object.entries(parsed)) {
        this.favoritePerformerCache.set(id, Boolean(value));
      }
    } catch {
      // Ignore storage parsing errors
    }
  }

  private static persistFavoritePerformerCache(): void {
    try {
      const data: Record<string, boolean> = {};
      for (const [id, value] of this.favoritePerformerCache.entries()) {
        data[id] = value;
      }
      globalThis.localStorage?.setItem('stashgifs-performer-favorites', JSON.stringify(data));
    } catch {
      // Ignore storage errors
    }
  }

  protected static getCachedPerformerFavorite(performerId: string): boolean | undefined {
    this.loadFavoritePerformerCache();
    return this.favoritePerformerCache.get(performerId);
  }

  protected static setCachedPerformerFavorite(performerId: string, favorite: boolean): void {
    this.loadFavoritePerformerCache();
    this.favoritePerformerCache.set(performerId, favorite);
    // Evict oldest entries to cap memory and localStorage size
    while (this.favoritePerformerCache.size > 500) {
      const oldest = this.favoritePerformerCache.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.favoritePerformerCache.delete(oldest);
    }
    this.persistFavoritePerformerCache();
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

    const isNarrow = globalThis.innerWidth < 768;
    this.applyReelHeaderStyles(elements.header, isNarrow);
    this.applyReelFooterStyles(elements.footer, isNarrow);
  }

  protected applyReelModeLayoutIfNeeded(header?: HTMLElement): void {
    if (!this.isReelMode) {
      return;
    }
    const headerElement = header ?? this.container.querySelector<HTMLElement>('.video-post__header');
    const playerContainer = this.container.querySelector<HTMLElement>('.video-post__player');
    const footer = this.container.querySelector<HTMLElement>('.video-post__footer');
    if (!headerElement || !playerContainer || !footer) {
      return;
    }
    this.applyReelModeLayout({ header: headerElement, playerContainer, footer });
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

  private applyReelMediaStyles(_playerContainer: HTMLElement, _isPortrait: boolean): void {
    // object-fit is set at construction time by each player (NativeVideoPlayer/ImagePlayer)
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
      if (element.closest('.rating-dialog')) {
        continue;
      }
      element.style.color = '#ffffff';
      element.style.textShadow = '0 2px 8px rgba(0, 0, 0, 0.65)';
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

  public setShowProductionAge(show: boolean): void {
    this.showProductionAge = show;
    const ageLabels = this.container.querySelectorAll<HTMLElement>('.performer-chip__age');
    for (const label of ageLabels) {
      label.style.display = show ? 'inline' : 'none';
    }
  }

  public setShowStudioChips(show: boolean): void {
    this.showStudioChips = show;
    this.refreshHeader();
  }

  public setShowSceneTitle(show: boolean): void {
    this.showSceneTitle = show;
    this.refreshHeader();
  }

  protected buildTitleElement(title: string): HTMLElement {
    const color = this.isReelMode ? THEME.colors.textPrimary : THEME.colors.textSecondary;

    const el = document.createElement('div');
    el.className = 'video-post__scene-title';
    el.title = title;
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.gap = '5px';
    el.style.maxWidth = '100%';
    el.style.margin = '2px 0 4px';
    el.style.color = color;
    el.style.minWidth = '0';

    const icon = document.createElement('span');
    icon.innerHTML = CLAPPERBOARD_SVG;
    icon.style.flexShrink = '0';
    icon.style.display = 'flex';
    icon.style.alignItems = 'center';
    icon.style.opacity = '0.7';

    const text = document.createElement('span');
    text.textContent = title;
    text.style.fontSize = '14px';
    text.style.fontWeight = THEME.typography.weightBody;
    text.style.lineHeight = THEME.typography.lineHeight;
    text.style.overflow = 'hidden';
    text.style.textOverflow = 'ellipsis';
    text.style.whiteSpace = 'nowrap';
    text.style.minWidth = '0';

    el.appendChild(icon);
    el.appendChild(text);
    return el;
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

  protected appendCommonImageFooterButtons(buttonGroup: HTMLElement, imageId: string): void {
    if (this.favoritesManager) {
      this.heartButton = this.createHeartButton();
      buttonGroup.appendChild(this.heartButton);
    }
    if (this.api && this.showOCountButton) {
      this.oCountButton = this.createOCountButton();
      buttonGroup.appendChild(this.oCountButton);
    }
    if (this.showViewCountBadge) {
      const viewCount = this.getAndIncrementLocalViewCount(imageId);
      buttonGroup.appendChild(this.createViewCountBadge(viewCount));
    }
    const ratingControl = this.createRatingSection();
    buttonGroup.appendChild(ratingControl);
  }

  private static readonly VIEW_COUNT_LS_PREFIX = 'stashgifs_views_';

  private getAndIncrementLocalViewCount(imageId: string): number {
    const key = `${BasePost.VIEW_COUNT_LS_PREFIX}${imageId}`;
    const prev = Number.parseInt(localStorage.getItem(key) ?? '0', 10) || 0;
    const next = prev + 1;
    try { localStorage.setItem(key, String(next)); } catch { /* ignore quota errors */ }
    return next;
  }

  protected createViewCountBadge(count: number): HTMLElement {
    const badge = document.createElement('span');
    badge.className = 'icon-btn icon-btn--views';
    badge.setAttribute('aria-label', `${count} views`);
    badge.title = `${count} views`;
    this.applyIconButtonStyles(badge);
    badge.style.padding = '0';
    badge.style.flexShrink = '1';
    badge.style.flexDirection = 'column';
    badge.style.alignItems = 'center';
    badge.style.gap = '1px';
    badge.style.cursor = 'default';
    badge.style.pointerEvents = 'none';
    badge.style.color = THEME.colors.textMuted;
    badge.innerHTML = `${EYE_SVG}<span style="font-size:10px;line-height:1;font-family:${THEME.typography.fontFamily};font-weight:500;letter-spacing:0.03em;pointer-events:none">${formatViewCount(count)}</span>`;
    return badge;
  }

  protected cleanupAddTagDialogState(): void {
    if (this.addTagDialogState.isOpen) {
      this.closeAddTagDialogBase({ state: this.addTagDialogState });
    }
    if (this.addTagDialogState.autocompleteDebounceTimer) {
      clearTimeout(this.addTagDialogState.autocompleteDebounceTimer);
      this.addTagDialogState.autocompleteDebounceTimer = undefined;
    }
    if (this.addTagDialogState.tagSearchLoadingTimer) {
      clearTimeout(this.addTagDialogState.tagSearchLoadingTimer);
      this.addTagDialogState.tagSearchLoadingTimer = undefined;
    }
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
  protected createPerformerChip(performer: { id: string; name: string; image_path?: string; favorite?: boolean; birthdate?: string; stash_ids?: Array<{ stash_id: string }> }): HTMLElement {
    const chip = this.buildPerformerChipBase(performer);
    chip.dataset.performerId = performer.id;
    const handleClick = (event?: Event): void => {
      this.performerOverlayMgr.hide(true);
      this.performerOverlayMgr.recordClick();
      if (this.onPerformerChipClick) {
        const performerId = Number.parseInt(performer.id, 10);
        if (!Number.isNaN(performerId)) {
          this.onPerformerChipClick(performerId, performer.name);
        }
      }
    };

    this.bindPerformerChipInteractions(chip, performer, handleClick);
    chip.appendChild(this.buildPerformerImage(performer));
    chip.appendChild(document.createTextNode(performer.name));

    if (performer.birthdate) {
      const productionDate = this.getProductionDate();
      const birthDate = new Date(performer.birthdate);
      const referenceDate = productionDate ? new Date(productionDate) : new Date();
      const age = Math.floor((referenceDate.getTime() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
      const ageSpan = document.createElement('span');
      ageSpan.className = 'performer-chip__age';
      ageSpan.textContent = `(${age})`;
      ageSpan.style.fontSize = 'inherit';
      ageSpan.style.fontFamily = 'inherit';
      ageSpan.style.opacity = '0.6';
      ageSpan.style.marginLeft = '-4px';
      ageSpan.style.display = this.showProductionAge ? 'inline' : 'none';
      chip.appendChild(ageSpan);
    }

    if (this.hasPerformerStashId(performer)) {
      const verifiedBadge = this.buildVerifiedBadge();
      verifiedBadge.style.display = this.showVerifiedCheckmarks ? 'inline-flex' : 'none';
      chip.appendChild(verifiedBadge);
    }
    this.bindPerformerHover(chip, performer);

    return chip;
  }

  protected createStudioChip(studio: { id: string; name: string; image_path?: string }): HTMLElement {
    const chip = this.buildBaseChipElement('studio-chip', `${globalThis.location.origin}/studios/${studio.id}`);

    chip.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.studioOverlayMgr.recordClick();
      this.studioOverlayMgr.hide(true);
      if (this.onStudioChipClick) {
        const studioId = Number.parseInt(studio.id, 10);
        if (!Number.isNaN(studioId)) {
          this.onStudioChipClick(studioId, studio.name);
        }
      }
    });

    chip.appendChild(this.buildChipImageContainer({
      name: studio.name,
      imagePath: studio.image_path,
      borderRadius: '4px',
      background: 'transparent',
      objectFit: 'contain',
    }));
    this.bindStudioHover(chip, studio);

    return chip;
  }

  private hasPerformerStashId(performer: { stash_ids?: Array<{ stash_id: string }> }): boolean {
    const stashIds = performer.stash_ids ?? [];
    return stashIds.some((entry) => typeof entry.stash_id === 'string' && entry.stash_id.trim().length > 0);
  }

  private buildVerifiedBadge(): HTMLElement {
    const verifiedBadge = document.createElement('span');
    verifiedBadge.className = 'performer-chip__verified';
    verifiedBadge.innerHTML = VERIFIED_SVG;
    verifiedBadge.style.display = 'inline-flex';
    verifiedBadge.style.alignItems = 'center';
    verifiedBadge.style.justifyContent = 'center';
    verifiedBadge.style.width = '18px';
    verifiedBadge.style.height = '18px';
    verifiedBadge.style.flexShrink = '0';
    verifiedBadge.style.marginLeft = '-4px';
    verifiedBadge.style.color = THEME.colors.accentPrimary;
    return verifiedBadge;
  }

  private buildBaseChipElement(className: string, href: string): HTMLElement {
    const chip = document.createElement('a');
    chip.className = className;
    chip.href = href;
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

    if (this.isReelMode) {
      chip.style.background = 'transparent';
      chip.style.border = 'none';
      chip.style.boxShadow = 'none';
      chip.style.backdropFilter = 'none';
      chip.style.color = '#ffffff';
      chip.style.textShadow = '0 2px 8px rgba(0, 0, 0, 0.65)';
    }

    chip.addEventListener('mouseenter', () => {
      chip.style.color = this.isReelMode ? '#ffffff' : THEME.colors.textPrimary;
    });
    chip.addEventListener('mouseleave', () => {
      chip.style.color = this.isReelMode ? '#ffffff' : THEME.colors.textSecondary;
    });

    return chip;
  }

  private buildChipImageContainer(options: {
    name: string;
    imagePath?: string;
    borderRadius: string;
    background: string;
    objectFit: string;
    objectPosition?: string;
  }): HTMLElement {
    const imageContainer = document.createElement('div');
    imageContainer.style.width = '40px';
    imageContainer.style.height = '40px';
    imageContainer.style.borderRadius = options.borderRadius;
    imageContainer.style.background = options.background;
    imageContainer.style.display = 'flex';
    imageContainer.style.alignItems = 'center';
    imageContainer.style.justifyContent = 'center';
    imageContainer.style.fontSize = '24px';
    imageContainer.style.fontWeight = THEME.typography.weightTitle;
    imageContainer.style.color = THEME.colors.textSecondary;
    imageContainer.style.flexShrink = '0';
    imageContainer.style.overflow = 'hidden';

    if (options.imagePath) {
      const imageSrc = normalizeMediaUrl(options.imagePath);
      if (imageSrc) {
        const img = document.createElement('img');
        img.src = imageSrc;
        img.alt = options.name;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = options.objectFit as 'cover' | 'contain';
        if (options.objectPosition) {
          img.style.objectPosition = options.objectPosition;
        }
        imageContainer.appendChild(img);
        return imageContainer;
      }
    }
    imageContainer.textContent = options.name.charAt(0).toUpperCase();
    return imageContainer;
  }

  private canHoverDevice(): boolean {
    return typeof globalThis !== 'undefined'
      && 'matchMedia' in globalThis
      && globalThis.matchMedia('(hover: hover)').matches;
  }

  private buildPerformerChipBase(performer: { id: string; name: string }): HTMLElement {
    return this.buildBaseChipElement('performer-chip', this.getPerformerLink(performer.id));
  }

  private bindPerformerChipInteractions(
    chip: HTMLElement,
    performer: { id: string; name: string },
    handleClick: (event?: Event) => void
  ): void {
    const isMobile = isMobileDevice();
    if (isMobile) {
      setupTouchHandlers(chip, {
        onTap: (e) => {
          e.preventDefault();
          e.stopPropagation();
          handleClick(e);
        },
        preventDefault: true,
        stopPropagation: true,
      });
      this.touchCleanups.push(preventClickAfterTouch(chip));
    }

    chip.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleClick(e);
    });
  }

  private buildPerformerImage(performer: { name: string; image_path?: string }): HTMLElement {
    return this.buildChipImageContainer({
      name: performer.name,
      imagePath: performer.image_path,
      borderRadius: '50%',
      background: THEME.colors.backgroundSecondary,
      objectFit: 'cover',
      objectPosition: 'top center',
    });
  }

  private getPerformerFavoriteState(performer: { id: string; favorite?: boolean }): boolean {
    const cachedFavorite = BasePost.getCachedPerformerFavorite(performer.id);
    const isFavorite = performer.favorite ?? cachedFavorite ?? false;
    if (performer.favorite !== undefined) {
      BasePost.setCachedPerformerFavorite(performer.id, performer.favorite);
    }
    return isFavorite;
  }

  private buildFavoriteToggle(
    performer: { id: string; favorite?: boolean; name: string },
    isFavorite: boolean
  ): HTMLElement {
    const getFavoriteColor = (favorite: boolean): string => {
      if (favorite) {
        return THEME.colors.accentPrimary;
      }
      return this.isReelMode ? THEME.colors.textPrimary : THEME.colors.textSecondary;
    };

    const favoriteButton = document.createElement('button');
    favoriteButton.type = 'button';
    favoriteButton.className = 'performer-chip__favorite';
    favoriteButton.dataset.performerId = performer.id;
    this.applyIconButtonStyles(favoriteButton);
    favoriteButton.style.color = getFavoriteColor(isFavorite);
    favoriteButton.setAttribute('aria-label', isFavorite ? 'Unfavorite performer' : 'Favorite performer');
    favoriteButton.title = isFavorite ? 'Unfavorite performer' : 'Favorite performer';

    const favoriteIcon = document.createElement('span');
    favoriteIcon.className = 'performer-chip__favorite-icon';
    favoriteIcon.innerHTML = isFavorite ? HEART_SVG_FILLED : HEART_SVG_OUTLINE;
    favoriteIcon.style.display = 'inline-flex';
    favoriteIcon.style.alignItems = 'center';
    favoriteIcon.style.justifyContent = 'center';
    favoriteButton.appendChild(favoriteIcon);

    const updateFavoriteIcon = (nextFavorite: boolean): void => {
      favoriteIcon.innerHTML = nextFavorite ? HEART_SVG_FILLED : HEART_SVG_OUTLINE;
      favoriteButton.style.color = getFavoriteColor(nextFavorite);
      favoriteButton.setAttribute('aria-label', nextFavorite ? 'Unfavorite performer' : 'Favorite performer');
      favoriteButton.title = nextFavorite ? 'Unfavorite performer' : 'Favorite performer';
    };

    const updateFavoriteIconsInDocument = (nextFavorite: boolean): void => {
      updateFavoriteIcon(nextFavorite);
      const selector = `.performer-chip__favorite[data-performer-id="${performer.id}"]`;
      const buttons = document.querySelectorAll<HTMLButtonElement>(selector);
      for (const button of buttons) {
        const icon = button.querySelector<HTMLElement>('.performer-chip__favorite-icon');
        if (icon) {
          icon.innerHTML = nextFavorite ? HEART_SVG_FILLED : HEART_SVG_OUTLINE;
        }
        button.style.color = getFavoriteColor(nextFavorite);
        button.setAttribute('aria-label', nextFavorite ? 'Unfavorite performer' : 'Favorite performer');
        button.title = nextFavorite ? 'Unfavorite performer' : 'Favorite performer';
      }
    };

    let isTogglingFavorite = false;
    const toggleFavorite = async (): Promise<void> => {
      if (!this.api || isTogglingFavorite) {
        if (!this.api) {
          showToast('API not available.');
        }
        return;
      }
      isTogglingFavorite = true;
      const nextFavorite = !(performer.favorite ?? BasePost.getCachedPerformerFavorite(performer.id) ?? false);
      try {
        await this.api.updatePerformerFavorite(performer.id, nextFavorite);
        performer.favorite = nextFavorite;
        BasePost.setCachedPerformerFavorite(performer.id, nextFavorite);
        updateFavoriteIconsInDocument(nextFavorite);
      } catch (error) {
        console.error('BasePost: Failed to update performer favorite', error);
        showToast('Failed to update performer favorite. Please try again.');
      } finally {
        isTogglingFavorite = false;
      }
    };

    favoriteButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void toggleFavorite();
    });

    favoriteButton.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        void toggleFavorite();
      }
    });

    return favoriteButton;
  }

  private bindPerformerHover(
    chip: HTMLElement,
    performer: { id: string; name: string }
  ): void {
    if (!this.api || !this.canHoverDevice()) return;
    this.performerOverlayMgr.bindHover(
      chip,
      performer.id,
      '.performer-chip',
      () => this.removePerformerAction(performer.id, performer.name)
    );
  }

  /**
   * Create image section for performer overlay (compact headshot on left, 2:3 aspect ratio matching 1280x1920)
   */
  /**
   * Create a styled overlay container with common layout and event handling
   */
  private createOverlayContainer(
    className: string,
    maxWidth: string,
    callbacks: {
      onMouseEnter: () => void;
      onMouseLeave: () => void;
      onClickBackground: () => void;
    },
    extraStyles?: Partial<CSSStyleDeclaration>
  ): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = className;
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
    overlay.style.maxWidth = maxWidth;
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.2s ease';
    overlay.style.pointerEvents = 'auto';
    if (extraStyles) {
      Object.assign(overlay.style, extraStyles);
    }

    overlay.addEventListener('mouseenter', callbacks.onMouseEnter);
    overlay.addEventListener('mouseleave', callbacks.onMouseLeave);
    overlay.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target === overlay || (!target.closest('a') && !target.closest('button'))) {
        callbacks.onClickBackground();
      }
    });

    return overlay;
  }

  /**
   * Create a flex column content section for overlays
   */
  private createOverlayContentSection(): HTMLElement {
    const contentSection = document.createElement('div');
    contentSection.style.display = 'flex';
    contentSection.style.flexDirection = 'column';
    contentSection.style.flex = '1';
    contentSection.style.minWidth = '0';
    return contentSection;
  }

  /**
   * Create a name link with hover effects for overlays
   */
  private createOverlayNameLink(href: string, displayName: string): HTMLAnchorElement {
    const nameLink = document.createElement('a');
    nameLink.href = href;
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
    name.textContent = displayName;
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

    return nameLink;
  }

  /**
   * Create a styled image section container for overlays
   */
  private createOverlayImageSection(
    width: string, height: string, fallbackFontSize: string,
    imagePath: string | undefined, name: string, logContext: string,
    objectFit: string = 'cover'
  ): HTMLElement {
    const imageSection = document.createElement('div');
    imageSection.style.width = width;
    imageSection.style.height = height;
    imageSection.style.minWidth = width;
    imageSection.style.minHeight = height;
    imageSection.style.backgroundColor = objectFit === 'contain' ? 'transparent' : THEME.colors.backgroundSecondary;
    imageSection.style.display = 'flex';
    imageSection.style.alignItems = 'center';
    imageSection.style.justifyContent = 'center';
    imageSection.style.overflow = 'hidden';
    imageSection.style.borderRadius = '8px';
    imageSection.style.flexShrink = '0';

    if (imagePath) {
      const imageSrc = normalizeMediaUrl(imagePath);
      if (imageSrc) {
        const img = document.createElement('img');
        img.src = imageSrc;
        img.alt = name;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = objectFit as 'cover' | 'contain';
        img.style.objectPosition = 'center center';
        imageSection.appendChild(img);
        return imageSection;
      }
      console.warn(`BasePost: Invalid ${logContext} overlay image URL`, { url: imagePath, name });
    }
    imageSection.textContent = name.charAt(0).toUpperCase();
    imageSection.style.fontSize = fallbackFontSize;
    imageSection.style.color = THEME.colors.textMuted;
    return imageSection;
  }

  private createPerformerOverlayImageSection(performerData: PerformerExtended): HTMLElement {
    const imageSection = this.createOverlayImageSection(
      '160px', '240px', '64px',
      performerData.image_path, performerData.name, 'performer'
    );
    imageSection.style.position = 'relative';

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

    const nameLink = this.createOverlayNameLink(this.getPerformerLink(performerData.id), performerData.name);
    leftGroup.appendChild(nameLink);

    nameRow.appendChild(leftGroup);

    const rightGroup = document.createElement('div');
    rightGroup.style.display = 'flex';
    rightGroup.style.alignItems = 'center';
    rightGroup.style.gap = '6px';

    if (this.api) {
      const favoriteState = this.getPerformerFavoriteState(performerData);
      const favoriteButton = this.buildFavoriteToggle(performerData, favoriteState);
      rightGroup.appendChild(favoriteButton);
    }

    if (onRemove) {
      const removeButton = this.createOverlayRemoveButton(
        'Remove performer',
        onRemove,
        () => this.hidePerformerOverlay(true),
        'performer',
      );
      rightGroup.appendChild(removeButton);
    }

    if (rightGroup.childElementCount > 0) {
      nameRow.style.justifyContent = 'space-between';
      nameRow.style.width = '100%';
      nameRow.appendChild(rightGroup);
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
    performerData: PerformerExtended,
    productionDate?: string
  ): void {
    if (performerData.birthdate) {
      const birthDate = new Date(performerData.birthdate);
      const referenceDate = productionDate ? new Date(productionDate) : new Date();
      const age = Math.floor((referenceDate.getTime() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
      const label = productionDate ? 'Production Age' : 'Age';
      metadata.push(
        { label, value: `${age}` },
        { label: 'Birthdate', value: performerData.birthdate }
      );
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

    this.addBasicInfoMetadata(metadata, performerData, this.getProductionDate());
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
   * Create a styled remove button for overlay cards (performer or tag).
   */
  private createOverlayRemoveButton(
    ariaLabel: string,
    onRemove: () => Promise<boolean>,
    onHide: () => void,
    entityLabel: string,
  ): HTMLButtonElement {
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.textContent = '✕';
    removeButton.setAttribute('aria-label', ariaLabel);
    removeButton.title = ariaLabel;
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
          onHide();
          return;
        }
      } catch (error) {
        console.error(`Failed to remove ${entityLabel}`, error);
        showToast(`Failed to remove ${entityLabel}. Please try again.`);
      } finally {
        removeButton.disabled = false;
        removeButton.textContent = '✕';
        removeButton.style.opacity = '1';
      }
    });

    return removeButton;
  }

  /**
   * Create performer overlay card (compact horizontal layout)
   */
  private createPerformerOverlay(performerData: PerformerExtended, onRemove?: () => Promise<boolean>): HTMLElement {
    const overlay = this.createOverlayContainer('performer-overlay', '480px', {
      onMouseEnter: () => this.performerOverlayMgr.cancelHide(),
      onMouseLeave: () => this.performerOverlayMgr.scheduleHide(),
      onClickBackground: () => this.performerOverlayMgr.hide(true),
    }, { maxHeight: '80vh', overflowY: 'auto' });

    overlay.appendChild(this.createPerformerOverlayImageSection(performerData));

    const contentSection = this.createOverlayContentSection();
    contentSection.appendChild(this.createPerformerOverlayNameRow(performerData, onRemove));

    const metadata = this.buildPerformerMetadata(performerData);
    const metadataSection = this.createPerformerOverlayMetadata(metadata);
    if (metadataSection) {
      contentSection.appendChild(metadataSection);
    }

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
    this.performerOverlayMgr.show(performerId, chipElement, onRemove);
  }

  private hidePerformerOverlay(immediate = false): void {
    this.performerOverlayMgr.hide(immediate);
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
    return this.createOverlayImageSection(
      '64px', '64px', '32px',
      tagData.image_path, tagData.name, 'tag'
    );
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

    const nameLink = this.createOverlayNameLink(this.getTagLink(tagData.id), tagData.name);
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
    const overlay = this.createOverlayContainer('tag-overlay', '280px', {
      onMouseEnter: () => {
        this.tagOverlayMgr.cancelHide();
      },
      onMouseLeave: () => this.tagOverlayMgr.scheduleHide(),
      onClickBackground: () => this.tagOverlayMgr.hide(true),
    });

    overlay.appendChild(this.createTagOverlayImageSection(tagData));

    const contentSection = this.createOverlayContentSection();

    const nameRow = this.createTagOverlayNameRow(tagData);
    if (onRemove) {
      nameRow.style.justifyContent = 'space-between';
      const removeButton = this.createOverlayRemoveButton(
        'Remove tag',
        onRemove,
        () => this.hideTagOverlay(true),
        'tag',
      );
      nameRow.appendChild(removeButton);
    }
    contentSection.appendChild(nameRow);

    const descriptionSection = this.createTagOverlayDescription(tagData);
    if (descriptionSection) {
      contentSection.appendChild(descriptionSection);
    }

    overlay.appendChild(contentSection);
    return overlay;
  }

  private showTagOverlay(tagId: string, chipElement: HTMLElement, onRemove?: () => Promise<boolean>): void {
    this.tagOverlayMgr.show(tagId, chipElement, onRemove);
  }

  private hideTagOverlay(immediate = false): void {
    this.tagOverlayMgr.hide(immediate);
  }

  private createStudioOverlay(studioData: StudioExtended): HTMLElement {
    const overlay = this.createOverlayContainer('studio-overlay', '400px', {
      onMouseEnter: () => this.studioOverlayMgr.cancelHide(),
      onMouseLeave: () => this.studioOverlayMgr.scheduleHide(),
      onClickBackground: () => this.studioOverlayMgr.hide(true),
    });

    const imageSection = this.createOverlayImageSection(
      '80px', '80px', '36px',
      studioData.image_path, studioData.name, 'studio', 'contain'
    );
    imageSection.style.borderRadius = '4px';
    overlay.appendChild(imageSection);

    const contentSection = this.createOverlayContentSection();

    const nameLink = this.createOverlayNameLink(
      `${globalThis.location.origin}/studios/${studioData.id}`,
      studioData.name
    );
    nameLink.style.marginBottom = '8px';
    contentSection.appendChild(nameLink);

    if (studioData.parent_studio) {
      const parentRow = document.createElement('div');
      parentRow.style.fontSize = '13px';
      parentRow.style.color = THEME.colors.textSecondary;
      parentRow.style.marginBottom = '6px';
      const parentLink = document.createElement('a');
      parentLink.href = `${globalThis.location.origin}/studios/${studioData.parent_studio.id}`;
      parentLink.target = '_blank';
      parentLink.rel = 'noopener noreferrer';
      parentLink.textContent = studioData.parent_studio.name;
      parentLink.style.color = THEME.colors.textSecondary;
      parentLink.style.textDecoration = 'none';
      parentLink.addEventListener('mouseenter', () => { parentLink.style.color = THEME.colors.accentPrimary; });
      parentLink.addEventListener('mouseleave', () => { parentLink.style.color = THEME.colors.textSecondary; });
      parentRow.appendChild(document.createTextNode('Part of '));
      parentRow.appendChild(parentLink);
      contentSection.appendChild(parentRow);
    }

    if (studioData.details) {
      const details = document.createElement('p');
      details.textContent = studioData.details;
      details.style.margin = '0 0 6px';
      details.style.fontSize = '13px';
      details.style.color = THEME.colors.textSecondary;
      details.style.lineHeight = '1.4';
      details.style.overflow = 'hidden';
      details.style.display = '-webkit-box';
      details.style.webkitLineClamp = '3';
      (details.style as CSSStyleDeclaration & { WebkitBoxOrient: string }).WebkitBoxOrient = 'vertical';
      contentSection.appendChild(details);
    }

    if (studioData.url) {
      const urlLink = document.createElement('a');
      urlLink.href = studioData.url;
      urlLink.target = '_blank';
      urlLink.rel = 'noopener noreferrer';
      urlLink.textContent = studioData.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
      urlLink.style.fontSize = '12px';
      urlLink.style.color = THEME.colors.accentPrimary;
      urlLink.style.textDecoration = 'none';
      urlLink.style.overflow = 'hidden';
      urlLink.style.textOverflow = 'ellipsis';
      urlLink.style.whiteSpace = 'nowrap';
      urlLink.style.display = 'block';
      urlLink.addEventListener('mouseenter', () => { urlLink.style.textDecoration = 'underline'; });
      urlLink.addEventListener('mouseleave', () => { urlLink.style.textDecoration = 'none'; });
      contentSection.appendChild(urlLink);
    }

    overlay.appendChild(contentSection);
    return overlay;
  }

  private bindStudioHover(
    chip: HTMLElement,
    studio: { id: string; name: string }
  ): void {
    if (!this.api || !this.canHoverDevice()) return;
    this.studioOverlayMgr.bindHover(chip, studio.id, '.studio-chip');
  }

  private showStudioOverlay(studioId: string, chipElement: HTMLElement): void {
    this.studioOverlayMgr.show(studioId, chipElement);
  }

  private hideStudioOverlay(immediate = false): void {
    this.studioOverlayMgr.hide(immediate);
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
      this.tagOverlayMgr.hide(true);
      this.tagOverlayMgr.recordClick();

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
    // Add hover overlay handlers for tags (desktop only)
    if (this.api && this.canHoverDevice()) {
      this.tagOverlayMgr.bindHover(
        hashtag,
        tag.id,
        '.tag-chip',
        () => this.removeTagAction(tag.id, tag.name)
      );
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
      
      this.touchCleanups.push(preventClickAfterTouch(hashtag));
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

  protected createHeaderContainer(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'video-post__header';
    header.style.padding = '8px 16px';
    header.style.marginBottom = '0';
    header.style.borderBottom = 'none';
    return header;
  }

  protected createPerformersContainer(performerCount: number): HTMLElement {
    const section = document.createElement('div');
    section.className = 'video-post__performers';
    if (performerCount === 2) {
      section.style.gap = '12px';
    }
    return section;
  }

  protected applyReelModeTagStyles(tagsSection: HTMLElement): void {
    tagsSection.style.display = 'flex';
    tagsSection.style.flexWrap = 'wrap';
    tagsSection.style.alignItems = 'center';
    tagsSection.style.gap = '4px';
    tagsSection.style.marginTop = '4px';
    tagsSection.style.opacity = '0.85';
  }

  protected buildImageHeader(options: {
    performers?: Performer[];
    tags?: Tag[];
    studio?: { id: string; name: string; image_path?: string };
    favoriteTagName?: string;
    title?: string;
  }): HTMLElement {
    const header = this.createHeaderContainer();

    // Performer chips section — filter to valid entries (id + name required)
    const performers = (options.performers ?? []).filter((p) => p?.id && p?.name);
    const performersSection = this.createPerformersContainer(performers.length);
    if (performers.length > 0) {
      this.appendPerformerChips(performersSection, performers);
    } else {
      performersSection.appendChild(this.createAddPerformerPlaceholder());
    }
    header.appendChild(performersSection);

    if (this.showSceneTitle && options.title) {
      header.appendChild(this.buildTitleElement(options.title));
    }

    // Tag chips section (includes studio chip at the start)
    const hasStudio = !!options.studio && this.showStudioChips;
    const hasTags = !!options.tags?.length;
    const addTagChip = this.createAddTagChip('Add tag to image');
    if (hasStudio || hasTags || addTagChip) {
      const tagsSection = document.createElement('div');
      tagsSection.className = 'video-post__tags';
      if (hasStudio) {
        tagsSection.appendChild(this.createStudioChip(options.studio!));
      }
      if (hasTags) {
        this.appendTagChips(tagsSection, options.tags!, options.favoriteTagName, performers.length > 0);
      }
      if (addTagChip) tagsSection.appendChild(addTagChip);
      if (this.isReelMode) {
        this.applyReelModeTagStyles(tagsSection);
      }
      header.appendChild(tagsSection);
    }

    return header;
  }

  /**
   * Default rating section for image-based posts. VideoPost overrides with scene-specific version.
   */
  protected createRatingSection(): HTMLElement {
    return this.buildRatingSection(
      'image',
      () => this.getImageData().image.rating100,
      (value) => { this.getImageData().image.rating100 = value; },
      this.api ? (rating10) => this.api!.updateImageRating(this.getImageData().image.id, rating10) : undefined
    );
  }

  protected buildRatingSection(
    subjectLabel: 'image' | 'scene',
    getRating100: () => number | null | undefined,
    onUpdateRating100: (value: number | undefined) => void,
    onSaveRating10: ((rating10: number) => Promise<number>) | undefined
  ): HTMLElement {
    this.ratingControl ??= new RatingControl({
      container: this.container,
      subjectLabel,
      ratingSystemConfig: this.ratingSystemConfig,
      buildRatingDisplayButton: (options) => this.buildRatingDisplayButton(options),
      createRatingStarIcon: () => this.createRatingStarIcon(),
      getRating100,
      onUpdateRating100,
      onSaveRating10,
      onToast: (message) => showToast(message)
    });
    return this.ratingControl.render();
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

  /**
   * Optional inline "+ Add tag" chip that lives at the end of the tag list.
   * Styled to read as optional (muted color, dashed underline) and hints that
   * more tags can be added. No-op if no API is available.
   */
  protected createAddTagChip(title: string = 'Add another tag'): HTMLElement | undefined {
    if (!this.api || !this.showAddTagButton) return undefined;

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tag-chip tag-chip--add';
    chip.setAttribute('aria-label', 'Add tag');
    chip.title = title;
    chip.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true" style="display:block;transform:translateY(2px);"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    Object.assign(chip.style, {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0',
      margin: '0 0 0 6px',
      minHeight: '44px',
      height: '44px',
      minWidth: '20px',
      color: THEME.colors.textMuted,
      background: 'transparent',
      border: 'none',
      borderRadius: '0',
      cursor: 'pointer',
      transition: 'color 0.2s ease, opacity 0.2s ease',
      opacity: '0.4',
      verticalAlign: 'middle',
    });
    if (this.isReelMode) {
      chip.style.color = '#ffffff';
      chip.style.textShadow = '0 2px 8px rgba(0, 0, 0, 0.65)';
    }
    chip.addEventListener('mouseenter', () => {
      chip.style.opacity = '1';
      chip.style.color = this.isReelMode ? '#ffffff' : THEME.colors.textPrimary;
    });
    chip.addEventListener('mouseleave', () => {
      chip.style.opacity = '0.4';
      chip.style.color = this.isReelMode ? '#ffffff' : THEME.colors.textMuted;
    });
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openAddTagDialog();
    });
    this.addTagButton = chip;
    return chip;
  }

  protected getImageLink(imageId: string): string {
    return `${globalThis.location.origin}/images/${imageId}`;
  }

  protected createImageButton(imageId: string): HTMLElement {
    return this.buildExternalLinkButton(
      this.getImageLink(imageId),
      'icon-btn--image',
      'View full image',
      'Open image in Stash'
    );
  }

  protected buildExternalLinkButton(href: string, extraClass: string, ariaLabel: string, title: string): HTMLAnchorElement {
    const iconBtn = document.createElement('a');
    iconBtn.className = `icon-btn ${extraClass}`;
    iconBtn.href = href;
    iconBtn.target = '_blank';
    iconBtn.rel = 'noopener noreferrer';
    iconBtn.setAttribute('aria-label', ariaLabel);
    iconBtn.title = title;
    this.applyIconButtonStyles(iconBtn);
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
    iconSpan.innerHTML = STAR_SVG_OUTLINE;
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
    fillSpan.style.color = `var(--rating-star-fill, #FFD700)`;
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

    // Anchor below the add-tag chip (which now lives in the tag row).
    // Fall back to the legacy button-group position if no chip exists.
    const anchor = this.addTagButton ?? options.buttonGroup;
    const anchorParent = anchor.parentElement ?? options.buttonGroup;
    anchorParent.style.position = 'relative';
    if (state.dialog.parentElement !== anchorParent) {
      state.dialog.remove();
      anchorParent.appendChild(state.dialog);
    }

    // Switch dialog from "open above" to "open below" the anchor.
    state.dialog.style.bottom = '';
    state.dialog.style.top = `${anchor.offsetTop + anchor.offsetHeight + 6}px`;
    const anchorCenterX = anchor.offsetLeft + anchor.offsetWidth / 2;
    state.dialog.style.left = `${anchorCenterX}px`;

    state.dialog.hidden = false;
    state.dialog.setAttribute('aria-hidden', 'false');
    state.dialog.style.opacity = '1';
    state.dialog.style.transform = 'translateX(-50%) translateY(0) scale(1)';
    state.dialog.style.pointerEvents = 'auto';

    // Clamp dialog horizontally and vertically so it stays inside the viewport.
    requestAnimationFrame(() => {
      if (!state.dialog) return;
      const dialogRect = state.dialog.getBoundingClientRect();
      const cardRect = this.container.getBoundingClientRect();

      // Flip above anchor if dialog extends below the viewport.
      if (dialogRect.bottom > globalThis.innerHeight - 8) {
        const anchorEl = this.addTagButton ?? options.buttonGroup;
        if (anchorEl) {
          state.dialog.style.top = `${anchorEl.offsetTop - state.dialog.offsetHeight - 6}px`;
        }
      }

      let offsetX = 0;
      const desiredLeft = dialogRect.left;
      const desiredRight = dialogRect.right;
      if (desiredLeft < cardRect.left + 8) {
        offsetX = (cardRect.left + 8) - desiredLeft;
      } else if (desiredRight > cardRect.right - 8) {
        offsetX = (cardRect.right - 8) - desiredRight;
      }
      state.dialog.style.transform = `translateX(calc(-50% + ${offsetX}px)) translateY(0) scale(1)`;
    });

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
      state.input?.focus({ preventScroll: true });
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

    focusAfterClose?.focus({ preventScroll: true });
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
        applyMenuItemHover(item);
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

  protected createDialogContainer(className: string): HTMLElement {
    const dialog = document.createElement('div');
    dialog.className = className;
    initPopoverDialog(dialog, 'calc(100% + 6px)');
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
    return dialog;
  }

  protected createDialogTitle(text: string, id?: string): HTMLElement {
    const title = document.createElement('div');
    if (id) title.id = id;
    title.textContent = text;
    title.style.fontSize = '16px';
    title.style.fontWeight = '600';
    title.style.color = THEME.colors.textPrimary;
    title.style.marginBottom = '12px';
    return title;
  }

  protected createDialogInputSection(options: {
    placeholder: string;
    ariaLabel: string;
    suggestionsClassName: string;
  }): { inputWrapper: HTMLElement; input: HTMLInputElement; suggestions: HTMLElement } {
    const inputWrapper = document.createElement('div');
    inputWrapper.style.position = 'relative';
    inputWrapper.style.marginBottom = '12px';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = options.placeholder;
    input.style.width = '100%';
    input.style.padding = '10px 12px';
    input.style.background = THEME.colors.surface;
    input.style.border = `1px solid ${THEME.colors.border}`;
    input.style.borderRadius = THEME.radius.button;
    input.style.color = THEME.colors.textPrimary;
    input.style.fontSize = THEME.typography.sizeBody;
    input.style.boxSizing = 'border-box';
    input.setAttribute('aria-label', options.ariaLabel);

    const suggestions = document.createElement('div');
    suggestions.className = options.suggestionsClassName;
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

    inputWrapper.appendChild(input);
    inputWrapper.appendChild(suggestions);

    return { inputWrapper, input, suggestions };
  }

  protected createDialogCancelButton(onClick: () => void): HTMLButtonElement {
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.padding = '8px 16px';
    cancelBtn.style.background = THEME.colors.backgroundSecondary;
    cancelBtn.style.border = `1px solid ${THEME.colors.border}`;
    cancelBtn.style.color = THEME.colors.textSecondary;
    cancelBtn.style.fontSize = '14px';
    cancelBtn.style.cursor = 'pointer';
    cancelBtn.style.borderRadius = THEME.radius.button;
    cancelBtn.addEventListener('click', onClick);
    return cancelBtn;
  }

  protected createMenuSuggestionItem(label: string, onClick: () => void): HTMLButtonElement {
    const item = document.createElement('button');
    item.type = 'button';
    item.textContent = label;
    item.style.width = '100%';
    item.style.padding = '10px 12px';
    item.style.textAlign = 'left';
    item.style.background = 'transparent';
    item.style.border = 'none';
    item.style.color = THEME.colors.textPrimary;
    item.style.fontSize = '14px';
    item.style.cursor = 'pointer';
    item.style.transition = 'background 0.15s ease';
    applyMenuItemHover(item);
    item.addEventListener('click', onClick);
    return item;
  }

  private createAddTagDialogBase(options: {
    state: AddTagDialogState;
    onSearch: (searchTerm: string) => void;
    onSubmit: () => void;
    focusAfterClose?: HTMLElement | null;
  }): void {
    const { state, onSearch, onSubmit } = options;
    const dialog = this.createDialogContainer('add-tag-dialog');
    state.dialog = dialog;

    dialog.appendChild(this.createDialogTitle('Add Tag'));

    const { inputWrapper, input, suggestions } = this.createDialogInputSection({
      placeholder: 'Search for tag...',
      ariaLabel: 'Tag name',
      suggestionsClassName: 'add-tag-dialog__suggestions',
    });
    suggestions.style.marginTop = '4px';
    state.input = input;
    state.suggestions = suggestions;

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
   * Open add tag dialog for image-based posts (ImagePost and ImageVideoPost).
   * VideoPost overrides this with its own marker dialog.
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
      onAdjustPosition: (dialog) => adjustImageDialogPosition(dialog, this.container, this.buttonGroup),
      focusAfterClose: this.addTagButton
    });
  }

  private async addTagToImage(): Promise<void> {
    await this.addTagToImageShared(this.addTagDialogState, this.addTagButton);
  }

  /**
   * Default favorite toggle action - calls toggleFavorite and returns isFavorite.
   * VideoPost overrides this with its own implementation.
   */
  protected async toggleFavoriteAction(): Promise<boolean> {
    await this.toggleFavorite();
    return this.isFavorite;
  }

  public async initialize(): Promise<void> {
    await this.checkFavoriteStatus();
  }

  protected async incrementOCountAction(): Promise<void> {
    const newOCount = await this.doIncrementImageOCount(this.getImageData().image.id);
    this.getImageData().image.o_counter = newOCount;
  }

  protected async doIncrementImageOCount(imageId: string): Promise<number> {
    if (!this.api) {
      throw new Error('API not available');
    }
    const newOCount = await this.api.incrementImageOCount(imageId);
    this.oCount = newOCount;
    return newOCount;
  }

  protected getProductionDate(): string | undefined {
    return this.getImageData().image.date;
  }

  /**
   * Default tag removal action for image-based posts.
   * VideoPost overrides this with its own implementation.
   */
  protected async removeTagAction(tagId: string, tagName: string): Promise<boolean> {
    return this.removeTagShared(tagId, tagName, {
      getCurrentTags: () => this.getImageData().image.tags || [],
      apiCall: (nextTagIds) => this.api!.updateImageTags(this.getImageData().image.id, nextTagIds),
      updateLocalTags: (remainingTags) => { this.getImageData().image.tags = remainingTags as any[]; },
      entityType: 'image',
      logPrefix: this.constructor.name
    });
  }

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
      const imageData = this.getImageData();
      // Check for duplicate tag
      const currentTagIds = (imageData.image.tags || []).map((tag: any) => tag.id).filter(Boolean);
      if (currentTagIds.includes(state.selectedTagId)) {
        showToast(`Tag "${state.selectedTagName}" is already added to this image.`);
        state.createButton.disabled = false;
        state.createButton.textContent = 'Add';
        state.createButton.style.opacity = '1';
        return;
      }

      // Update via API
      const nextTagIds = [...currentTagIds, state.selectedTagId];
      await this.api.updateImageTags(imageData.image.id, nextTagIds);

      // Update local data
      imageData.image.tags ??= [];
      imageData.image.tags.push({ id: state.selectedTagId, name: state.selectedTagName });

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

  // ─── Add Performer dialog (shared by all post types) ──────────────────────

  protected createAddPerformerPlaceholder(): HTMLElement {
    const chip = document.createElement('div');
    chip.setAttribute('role', 'button');
    chip.setAttribute('tabindex', '0');
    chip.setAttribute('aria-label', 'Add performer');
    chip.title = 'Add performer';
    chip.textContent = '?';
    chip.style.width = '40px';
    chip.style.height = '40px';
    chip.style.borderRadius = '50%';
    chip.style.flexShrink = '0';
    chip.style.display = 'flex';
    chip.style.alignItems = 'center';
    chip.style.justifyContent = 'center';
    chip.style.fontSize = '20px';
    chip.style.fontWeight = THEME.typography.weightTitle;
    chip.style.cursor = 'pointer';
    chip.style.background = THEME.colors.backgroundSecondary;
    chip.style.border = `2px dashed ${THEME.colors.textMuted}`;
    chip.style.color = THEME.colors.textMuted;
    chip.style.transition = 'border-color 0.15s ease, color 0.15s ease';
    chip.style.position = 'relative';
    chip.addEventListener('mouseenter', () => {
      chip.style.borderColor = THEME.colors.accentPrimary;
      chip.style.color = THEME.colors.accentPrimary;
    });
    chip.addEventListener('mouseleave', () => {
      chip.style.borderColor = THEME.colors.textMuted;
      chip.style.color = THEME.colors.textMuted;
    });
    const open = () => this.openAddPerformerDialog(chip);
    chip.addEventListener('click', open);
    chip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
    return chip;
  }

  private createAddPerformerDialog(): HTMLElement {
    const dialog = this.createDialogContainer('add-performer-dialog');
    this.addPerformerDialog = dialog;
    dialog.appendChild(this.createDialogTitle('Add Performer', 'add-performer-dialog-title'));
    const { inputWrapper, input, suggestions } = this.createDialogInputSection({
      placeholder: 'Search performers...',
      ariaLabel: 'Performer name',
      suggestionsClassName: 'add-performer-dialog__suggestions',
    });
    suggestions.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.3)';
    this.addPerformerDialogInput = input;
    this.addPerformerDialogSuggestions = suggestions;
    input.addEventListener('input', () => this.handleAddPerformerInput());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.selectedPerformerId && this.addPerformerDialogAddButton && !this.addPerformerDialogAddButton.disabled) {
        e.preventDefault();
        void this.commitAddPerformer();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.closeAddPerformerDialog();
      }
    });
    dialog.appendChild(inputWrapper);
    const buttons = document.createElement('div');
    buttons.style.display = 'flex';
    buttons.style.gap = '8px';
    buttons.style.justifyContent = 'flex-end';
    buttons.style.marginTop = '12px';
    buttons.appendChild(this.createDialogCancelButton(() => this.closeAddPerformerDialog()));
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = 'Add';
    addBtn.disabled = true;
    addBtn.style.padding = '8px 16px';
    addBtn.style.background = THEME.colors.accentPrimary;
    addBtn.style.border = `1px solid ${THEME.colors.accentPrimary}`;
    addBtn.style.color = THEME.colors.textMuted;
    addBtn.style.fontSize = '14px';
    addBtn.style.cursor = 'not-allowed';
    addBtn.style.borderRadius = THEME.radius.button;
    addBtn.style.transition = 'all 0.2s ease';
    addBtn.addEventListener('click', () => { void this.commitAddPerformer(); });
    this.addPerformerDialogAddButton = addBtn;
    buttons.appendChild(addBtn);
    dialog.appendChild(buttons);
    return dialog;
  }

  private openAddPerformerDialog(anchor: HTMLElement): void {
    if (!this.addPerformerDialog) {
      const dialog = this.createAddPerformerDialog();
      this.container.appendChild(dialog);
    }
    if (this.isAddPerformerDialogOpen) return;
    this.isAddPerformerDialogOpen = true;
    this.selectedPerformerId = undefined;
    this.selectedPerformerName = undefined;
    this.selectedPerformerImagePath = undefined;
    if (this.addPerformerDialogInput) this.addPerformerDialogInput.value = '';
    if (this.addPerformerDialogSuggestions) this.addPerformerDialogSuggestions.style.display = 'none';
    this.updateAddPerformerDialogState();
    if (this.addPerformerDialog) {
      this.addPerformerDialog.hidden = false;
      this.addPerformerDialog.setAttribute('aria-hidden', 'false');
      this.addPerformerDialog.style.pointerEvents = 'auto';
      requestAnimationFrame(() => {
        if (!this.addPerformerDialog) return;
        const cardRect = this.container.getBoundingClientRect();
        const anchorRect = anchor.getBoundingClientRect();
        const topPx = anchorRect.bottom - cardRect.top + 6;
        this.addPerformerDialog.style.bottom = 'auto';
        this.addPerformerDialog.style.top = `${topPx}px`;
        this.addPerformerDialog.style.left = '14px';
        this.addPerformerDialog.style.transform = 'translateY(0) scale(1)';
        this.addPerformerDialog.style.opacity = '1';

        // Flip above anchor if dialog extends below the viewport.
        const dlgRect = this.addPerformerDialog.getBoundingClientRect();
        if (dlgRect.bottom > globalThis.innerHeight - 8) {
          const aboveTop = anchorRect.top - cardRect.top - this.addPerformerDialog.offsetHeight - 6;
          this.addPerformerDialog.style.top = `${aboveTop}px`;
        }
      });
    }
    this.onAddPerformerDialogOutsideClick = (event: Event) => {
      if (!this.isAddPerformerDialogOpen || !this.addPerformerDialog) return;
      const target = event.target as Node | null;
      if (target && this.addPerformerDialog.contains(target)) return;
      if (target && anchor.contains(target)) return;
      this.closeAddPerformerDialog();
    };
    this.onAddPerformerDialogKeydown = (event: KeyboardEvent) => {
      if (!this.isAddPerformerDialogOpen) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeAddPerformerDialog();
      }
    };
    document.addEventListener('mousedown', this.onAddPerformerDialogOutsideClick);
    document.addEventListener('touchstart', this.onAddPerformerDialogOutsideClick);
    document.addEventListener('keydown', this.onAddPerformerDialogKeydown);
    requestAnimationFrame(() => { this.addPerformerDialogInput?.focus({ preventScroll: true }); });
  }

  private closeAddPerformerDialog(): void {
    if (!this.isAddPerformerDialogOpen) return;
    this.isAddPerformerDialogOpen = false;
    if (this.addPerformerDebounceTimer) {
      clearTimeout(this.addPerformerDebounceTimer);
      this.addPerformerDebounceTimer = undefined;
    }
    if (this.addPerformerDialog) {
      this.addPerformerDialog.style.opacity = '0';
      this.addPerformerDialog.style.transform = 'translateY(4px) scale(0.96)';
      this.addPerformerDialog.style.pointerEvents = 'none';
      setTimeout(() => {
        if (this.addPerformerDialog && !this.isAddPerformerDialogOpen) {
          this.addPerformerDialog.hidden = true;
          this.addPerformerDialog.setAttribute('aria-hidden', 'true');
        }
      }, 200);
    }
    if (this.addPerformerDialogSuggestions) this.addPerformerDialogSuggestions.style.display = 'none';
    document.removeEventListener('mousedown', this.onAddPerformerDialogOutsideClick);
    document.removeEventListener('touchstart', this.onAddPerformerDialogOutsideClick);
    document.removeEventListener('keydown', this.onAddPerformerDialogKeydown);
  }

  private handleAddPerformerInput(): void {
    if (!this.addPerformerDialogInput) return;
    const searchTerm = this.addPerformerDialogInput.value.trim();
    this.selectedPerformerId = undefined;
    this.selectedPerformerName = undefined;
    this.selectedPerformerImagePath = undefined;
    this.updateAddPerformerDialogState();
    if (this.addPerformerDebounceTimer) clearTimeout(this.addPerformerDebounceTimer);
    if (searchTerm.length === 0) {
      if (this.addPerformerDialogSuggestions) this.addPerformerDialogSuggestions.style.display = 'none';
      return;
    }
    this.addPerformerDebounceTimer = setTimeout(() => {
      void this.searchPerformersForAdd(searchTerm);
    }, 250);
  }

  private async searchPerformersForAdd(searchTerm: string): Promise<void> {
    if (!this.api) return;
    if (!this.addPerformerDialogSuggestions) return;
    try {
      const performers = await this.api.searchPerformers(searchTerm, 20);
      this.displayPerformerSuggestions(performers);
    } catch {
      if (this.addPerformerDialogSuggestions) this.addPerformerDialogSuggestions.style.display = 'none';
    }
  }

  private displayPerformerSuggestions(performers: Array<{ id: string; name: string; image_path?: string }>): void {
    if (!this.addPerformerDialogSuggestions) return;
    this.addPerformerDialogSuggestions.innerHTML = '';
    if (performers.length === 0) {
      const noResults = document.createElement('div');
      noResults.textContent = 'No performers found';
      noResults.style.padding = '12px';
      noResults.style.color = THEME.colors.textMuted;
      noResults.style.fontSize = '14px';
      this.addPerformerDialogSuggestions.appendChild(noResults);
      this.addPerformerDialogSuggestions.style.display = 'block';
      return;
    }
    this.addPerformerDialogSuggestions.style.display = 'block';
    for (const performer of performers) {
      const item = this.createMenuSuggestionItem(performer.name, () => this.selectPerformerForAdd(performer.id, performer.name, performer.image_path));
      this.addPerformerDialogSuggestions.appendChild(item);
    }
  }

  private selectPerformerForAdd(id: string, name: string, imagePath?: string): void {
    this.selectedPerformerId = id;
    this.selectedPerformerName = name;
    this.selectedPerformerImagePath = imagePath;
    if (this.addPerformerDialogInput) this.addPerformerDialogInput.value = name;
    if (this.addPerformerDialogSuggestions) this.addPerformerDialogSuggestions.style.display = 'none';
    this.updateAddPerformerDialogState();
  }

  private updateAddPerformerDialogState(): void {
    if (!this.addPerformerDialogAddButton) return;
    const hasPerformer = !!this.selectedPerformerId;
    this.addPerformerDialogAddButton.disabled = !hasPerformer;
    this.addPerformerDialogAddButton.style.color = hasPerformer ? THEME.colors.textPrimary : THEME.colors.textMuted;
    this.addPerformerDialogAddButton.style.cursor = hasPerformer ? 'pointer' : 'not-allowed';
  }

  private async commitAddPerformer(): Promise<void> {
    const performerId = this.selectedPerformerId;
    const performerName = this.selectedPerformerName;
    if (!performerId || !performerName || !this.api) return;
    const addBtn = this.addPerformerDialogAddButton;
    if (addBtn) {
      addBtn.disabled = true;
      addBtn.textContent = 'Adding...';
      addBtn.style.cursor = 'not-allowed';
    }
    try {
      await this.doAddPerformerApiCall(performerId, performerName);
      showToast(`Added "${performerName}"`);
      this.closeAddPerformerDialog();
      this.refreshHeader();
    } catch {
      showToast('Failed to add performer. Please try again.');
      if (addBtn) {
        addBtn.textContent = 'Add';
        this.updateAddPerformerDialogState();
      }
    }
  }

  protected async doAddPerformerApiCall(performerId: string, performerName: string): Promise<void> {
    const imageData = this.getImageData();
    const currentIds = extractValidPerformerIds(imageData.image.performers ?? []);
    await this.api!.updateImagePerformers(imageData.image.id, [...currentIds, performerId]);
    imageData.image.performers = [...(imageData.image.performers ?? []), { id: performerId, name: performerName, image_path: this.selectedPerformerImagePath }];
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

    const currentPerformerIds = extractValidPerformerIds(options.performers || []);

    if (!currentPerformerIds.includes(performerId)) {
      showToast(`Performer "${performerName}" is not on this ${options.itemType}.`);
      return false;
    }

    try {
      const nextPerformerIds = currentPerformerIds.filter((id) => id !== performerId);
      await options.apiMethod(options.itemId, nextPerformerIds);

      // Update local data - image branch runs for ImagePost/ImageVideoPost, scene branch for VideoPost
      if (options.itemType === 'image') {
        (this.getImageData().image.performers as any[]) = (options.performers || []).filter((performer) => performer.id !== performerId);
      } else if (options.itemType === 'scene') {
        ((this.data as VideoPostData).marker.scene.performers as any[]) = (options.performers || []).filter((performer) => performer.id !== performerId);
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
   * Default performer removal action for image-based posts.
   * VideoPost overrides this with its own implementation.
   */
  protected async removePerformerAction(performerId: string, performerName: string): Promise<boolean> {
    return this.removePerformerShared(performerId, performerName, {
      performers: this.getImageData().image.performers,
      itemId: this.getImageData().image.id,
      apiMethod: (id, performerIds) => this.api!.updateImagePerformers(id, performerIds),
      itemType: 'image',
      logPrefix: this.constructor.name
    });
  }

  /**
   * Default favorite tag source - returns image tags.
   * VideoPost overrides this with its own implementation.
   */
  protected getFavoriteTagSource(): Array<{ name: string }> | undefined {
    return this.getImageData().image.tags;
  }

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
   * Auto-advance to the next post when the post's video loops back.
   * Only active in reel mode with the reelAutoScroll setting enabled.
   * Idempotent: subclasses can call this after their video player has mounted;
   * the first call with a discoverable <video> element wins.
   */
  protected attachReelAutoAdvance(): void {
    if (this.autoAdvanceAttached || !this.isReelMode || !this.reelAutoScroll) return;
    const video = this.container.querySelector<HTMLVideoElement>('video');
    if (!video) return;
    let lastTime = 0;
    this.reelAutoAdvanceHandler = () => {
      const t = video.currentTime;
      // Backwards jump > 0.4s indicates a loop completed.
      if (t + 0.4 < lastTime && !this.autoAdvanceFired) {
        this.autoAdvanceFired = true;
        this.scrollToNextPost();
      }
      lastTime = t;
    };
    video.addEventListener('timeupdate', this.reelAutoAdvanceHandler);
    this.reelAutoAdvanceElement = video;
    this.autoAdvanceAttached = true;
  }

  protected detachReelAutoAdvance(): void {
    if (this.reelAutoAdvanceElement && this.reelAutoAdvanceHandler) {
      this.reelAutoAdvanceElement.removeEventListener('timeupdate', this.reelAutoAdvanceHandler);
      this.reelAutoAdvanceElement = undefined;
      this.reelAutoAdvanceHandler = undefined;
    }
    this.autoAdvanceAttached = false;
    this.autoAdvanceFired = false;
  }

  /**
   * Image-post variant: advance after a fixed dwell time (default 5s) while
   * the post is intersecting the viewport. Cancels and resets if the user
   * scrolls away before the timer fires.
   */
  protected attachReelAutoAdvanceTimer(dwellMs: number = 5000): void {
    if (this.autoAdvanceAttached || !this.isReelMode || !this.reelAutoScroll) return;
    this.autoAdvanceAttached = true;
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
        if (timerId === undefined && !this.autoAdvanceFired) {
          timerId = setTimeout(() => {
            if (this.autoAdvanceFired) return;
            this.autoAdvanceFired = true;
            this.scrollToNextPost();
            observer.disconnect();
          }, dwellMs);
        }
      } else if (timerId !== undefined) {
        clearTimeout(timerId);
        timerId = undefined;
      }
    }, { threshold: [0, 0.6, 1] });
    observer.observe(this.container);
  }

  private scrollToNextPost(): void {
    let next = this.container.nextElementSibling as HTMLElement | null;
    // Skip over non-post siblings (e.g. lazy-load triggers/sentinels).
    while (next && !next.matches('.video-post, .image-post, [class*="post-wrapper"]')) {
      next = next.nextElementSibling as HTMLElement | null;
    }
    next?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /**
   * Create the StashDB Discovery panel toggle button. Returns undefined if no panel is wired.
   * Default neutral; turns accent while the panel is open. Plays a one-shot jiggle on
   * the first instance created per page load.
   */
  protected createDiscoveryButton(): HTMLElement | undefined {
    const panel = this.discoveryPanel;
    if (!panel || isMobileDevice()) return undefined;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-btn icon-btn--discovery';
    btn.setAttribute('aria-label', 'Toggle StashDB discovery panel');
    btn.title = 'StashDB Discovery';
    this.applyIconButtonStyles(btn);
    btn.innerHTML = DISCOVERY_ICON_SVG;
    this.addHoverEffect(btn);

    const applyState = (collapsed: boolean) => {
      btn.style.color = collapsed ? THEME.colors.iconInactive : THEME.colors.accentPrimary;
      btn.setAttribute('aria-pressed', collapsed ? 'false' : 'true');
    };
    applyState(panel.isCollapsed());

    btn.addEventListener('click', () => panel.toggle());
    this.discoveryCollapseUnsubscribe = panel.onCollapseChange(applyState);

    this.discoveryJiggleTimerId = setTimeout(() => {
      this.discoveryJiggleTimerId = undefined;
      btn.style.animation = 'stashgifs-jiggle 1.1s ease-in-out, stashgifs-discovery-pulse 1.1s ease-in-out';
      btn.addEventListener('animationend', () => { btn.style.animation = ''; }, { once: true });
    }, 3000);

    return btn;
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

    const inactiveColor = this.isReelMode ? THEME.colors.textPrimary : THEME.colors.textSecondary;
    
    if (this.isFavorite) {
      btn.innerHTML = HEART_SVG_FILLED;
      btn.style.color = THEME.colors.accentPrimary;
      btn.title = 'Remove from favorites';
    } else {
      btn.innerHTML = HEART_SVG_OUTLINE;
      btn.style.color = inactiveColor;
      btn.title = 'Add to favorites';
    }

  }

  protected async toggleFavorite(): Promise<void> {
    if (!this.api) {
      console.error('BasePost: No API available for toggleFavorite');
      return;
    }
    try {
      const result = await toggleImageFavorite(
        this.getImageData().image.id,
        this.getImageData().image.tags,
        this.api,
        this.favoritesManager,
        this.isFavorite,
        'StashGifs Favorite',
      );
      this.getImageData().image.tags = result.newTags as Image['tags'];
      this.isFavorite = result.newIsFavorite;
      this.updateHeartButton();
    } catch (error) {
      console.error('BasePost: Failed to toggle favorite', error);
      showToast('Failed to update favorite');
      this.isFavorite = !this.isFavorite;
      this.updateHeartButton();
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
    oCountBtn.style.flexDirection = 'column';
    oCountBtn.style.alignItems = 'center';
    oCountBtn.style.gap = '1px';

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

    const label = this.oCount > 0 ? formatViewCount(this.oCount) : '0';
    this.oCountButton.innerHTML = `${OCOUNT_SVG}<span style="font-size:10px;line-height:1;font-family:${THEME.typography.fontFamily};font-weight:500;letter-spacing:0.03em;color:${THEME.colors.textMuted};pointer-events:none">${label}</span>`;
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
