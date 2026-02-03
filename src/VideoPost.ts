/**
 * Video Post Component
 * Individual video post card in the feed
 */

import { VideoPostData, Scene, SceneMarker } from './types.js';
import { NativeVideoPlayer } from './NativeVideoPlayer.js';
import { FavoritesManager } from './FavoritesManager.js';
import { StashAPI } from './StashAPI.js';
import { VisibilityManager } from './VisibilityManager.js';
import { calculateAspectRatio, getAspectRatioClass, isValidMediaUrl, showToast, throttle, toAbsoluteUrl, isMobileDevice, THEME } from './utils.js';
import { posterPreloader } from './PosterPreloader.js';
import { HQ_SVG_OUTLINE, HQ_SVG_FILLED, EXTERNAL_LINK_SVG, MARKER_SVG, STAR_SVG, STAR_SVG_OUTLINE, VOLUME_MUTED_SVG, VOLUME_UNMUTED_SVG } from './icons.js';
import { BasePost } from './BasePost.js';
import { setupTouchHandlers, preventClickAfterTouch } from './utils/touchHandlers.js';

// Constants for magic numbers and strings
const FAVORITE_TAG_NAME = 'StashGifs Favorite';
const MARKER_TAG_NAME = 'StashGifs Marker';
const RATING_MAX_STARS = 10;
const RATING_MIN_STARS = 0;
const RATING_DIALOG_MAX_WIDTH = 900;
const RATING_DIALOG_MIN_WIDTH = 160;
const OCOUNT_DIGIT_WIDTH_PX = 8; // Approximate pixels per digit for 14px font
const OCOUNT_MIN_WIDTH_PX = 14;
const RESIZE_THROTTLE_MS = 100;

interface VideoPostOptions {
  onMuteToggle?: (isMuted: boolean) => void; // Callback to set global mute state
  getGlobalMuteState?: () => boolean; // Callback to get global mute state
  favoritesManager?: FavoritesManager;
  api?: StashAPI;
  visibilityManager?: VisibilityManager;
  onPerformerChipClick?: (performerId: number, performerName: string) => void;
  onTagChipClick?: (tagId: number, tagName: string) => void;
  showVerifiedCheckmarks?: boolean;
  useShuffleMode?: boolean;
  onCancelRequests?: () => void;
  ratingSystemConfig?: { type?: string; starPrecision?: string } | null; // Rating system configuration
  reelMode?: boolean;
}

export class VideoPost extends BasePost {
  protected readonly data: VideoPostData;
  private player?: NativeVideoPlayer;
  private isLoaded: boolean = false;
  private markerButton?: HTMLElement;
  private hqButton?: HTMLElement;
  private playButton?: HTMLElement;
  private isHQMode: boolean = false;
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
  private hoveredStarIndex?: number; // Track which star is being hovered for preview
  private hoveredPreviewValue?: number; // Actual rating value preview (supports half stars)
  private lastPointerSelectionTs = 0;
  private lastPointerHoverTs = 0;
  private markerDialog?: HTMLElement;
  private markerDialogInput?: HTMLInputElement;
  private markerDialogSuggestions?: HTMLElement;
  private markerDialogRecentTags?: HTMLElement;
  private markerDialogCreateButton?: HTMLButtonElement;
  private isMarkerDialogOpen: boolean = false;
  private isAddTagMode: boolean = false;
  private selectedTagId?: string;
  private selectedTagName?: string;
  private autocompleteDebounceTimer?: ReturnType<typeof setTimeout>;
  private tagSearchLoadingTimer?: ReturnType<typeof setTimeout>;
  private isTagSearchLoading: boolean = false;
  private hasCreatedMarker: boolean = false; // Track if marker has been created for this scene
  private videoLoadingIndicator?: HTMLElement;
  private cachedStarButtonWidth?: number; // Cache star button width (doesn't change)
  private loadErrorCount: number = 0;
  private hasFailedPermanently: boolean = false;
  private errorPlaceholder?: HTMLElement;
  private retryTimeoutId?: number;
  private loadErrorCheckIntervalId?: ReturnType<typeof setInterval>;
  private readonly ratingSystemConfig?: { type?: string; starPrecision?: string } | null;
  
  // Event handlers for cleanup
  private readonly ratingOutsideClickHandler = (event: Event) => this.onRatingOutsideClick(event);
  private readonly ratingKeydownHandler = (event: KeyboardEvent) => this.onRatingKeydown(event);
  private readonly ratingResizeHandler: () => void;
  
  // Cached DOM elements
  private playerContainer?: HTMLElement;
  private footer?: HTMLElement;
  private buttonGroup?: HTMLElement;

  private readonly onCancelRequests?: () => void; // Callback to cancel pending requests
  private readonly onMuteToggle?: (isMuted: boolean) => void; // Callback for mute toggle
  private readonly getGlobalMuteState?: () => boolean; // Callback to get global mute state

  private readonly useShuffleMode: boolean = false;
  private muteOverlayButton?: HTMLElement; // Overlay mute button

  constructor(
    container: HTMLElement, 
    data: VideoPostData,
    options: VideoPostOptions = {}
  ) {
    super(
      container,
      options.favoritesManager,
      options.api,
      options.visibilityManager,
      options.onPerformerChipClick,
      options.onTagChipClick,
      options.showVerifiedCheckmarks
    );
    this.data = data;
    this.useShuffleMode = options.useShuffleMode || false;
    this.onCancelRequests = options.onCancelRequests;
    this.onMuteToggle = options.onMuteToggle;
    this.getGlobalMuteState = options.getGlobalMuteState;
    this.oCount = this.data.marker.scene.o_counter || 0;
    this.ratingSystemConfig = options.ratingSystemConfig;
    this.isReelMode = options.reelMode === true;
    this.ratingValue = this.convertRating100ToStars(this.data.marker.scene.rating100);
    this.hasRating = typeof this.data.marker.scene.rating100 === 'number' && !Number.isNaN(this.data.marker.scene.rating100);
    
    // Short form content is always HD by default
    if (this.isShortFormContent()) {
      this.isHQMode = true;
    }
    
    // Throttle resize handler for performance
    this.ratingResizeHandler = throttle(() => this.syncRatingDialogLayout(), RESIZE_THROTTLE_MS);

    this.render();
  }

  /**
   * Handle pointer movement across the star container for half precision previews
   */
  /**
   * Calculate preview value from pointer position using container-level coordinates
   */
  private calculatePreviewValueFromPointer(pointerX: number): number | undefined {
    if (!this.isRatingDialogOpen || !this.isHalfPrecision()) {
      return undefined;
    }
    if (!this.ratingStarButtons.length) {
      return undefined;
    }

    const starRects = this.ratingStarButtons.map((btn) => btn.getBoundingClientRect());
    const firstRect = starRects[0];
    const maxStars = this.getMaxStars();

    if (pointerX <= firstRect.left + firstRect.width / 2) {
      return 0.5;
    }

    for (let i = 0; i < starRects.length; i++) {
      const rect = starRects[i];
      const nextRect = starRects[i + 1];
      if (pointerX >= rect.left && pointerX <= rect.right) {
        return i + 1;
      }
      if (nextRect && pointerX > rect.right && pointerX < nextRect.left + nextRect.width / 2) {
        return Math.min(i + 1 + 0.5, maxStars);
      }
      if (!nextRect && pointerX >= rect.right) {
        return starRects.length;
      }
    }

    return undefined;
  }

  private handleStarsPointerMove(event: PointerEvent | MouseEvent): void {
    if (!this.isRatingDialogOpen || !this.isHalfPrecision()) {
      return;
    }
    if (!this.ratingStarButtons.length) {
      return;
    }

    const previewValue = this.calculatePreviewValueFromPointer(event.clientX);
    if (previewValue === undefined) {
      return;
    }

    this.lastPointerHoverTs = performance.now();
    const maxStars = this.getMaxStars();
    const starIndex = Math.min(Math.max(Math.ceil(previewValue), 1), maxStars);
    this.onStarHover(starIndex, previewValue);
  }

  /**
   * Initialize asynchronous operations after construction
   */
  public async initialize(): Promise<void> {
    await this.checkFavoriteStatus();
  }

  /**
   * Render the complete video post structure
   */
  private render(): void {
    const { header, playerContainer, footer } = this.renderBasePost({
      className: 'video-post',
      postId: this.data.marker.id,
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
   * Create the player container with loading indicator
   */
  private createPlayerContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'video-post__player';
    container.style.position = 'relative';
    container.style.width = '100%';

    // Calculate aspect ratio
    let aspectRatio: number | undefined;
    let aspectRatioClass = 'aspect-16-9';
    if (this.data.marker.scene.files && this.data.marker.scene.files.length > 0) {
      const file = this.data.marker.scene.files[0];
      if (file?.width && file?.height && file.height > 0) {
        aspectRatio = calculateAspectRatio(file.width, file.height);
        aspectRatioClass = getAspectRatioClass(aspectRatio);
      }
    }

    if (aspectRatio && Number.isFinite(aspectRatio)) {
      this.setAspectRatioMetadata(container, aspectRatio);
    }
    
    // Use inline aspectRatio style for better browser compatibility (Chrome/Safari)
    // Match ImagePost format - use number format like "1.777" for consistency
    if (aspectRatio && Number.isFinite(aspectRatio)) {
      container.style.aspectRatio = `${aspectRatio}`;
    }
    // Always add CSS class as fallback for older browsers
    container.classList.add(aspectRatioClass);


    // Loading indicator for video
    const loading = document.createElement('div');
    loading.className = 'video-post__loading';
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    loading.appendChild(spinner);
    loading.style.display = this.isLoaded ? 'none' : 'flex';
    container.appendChild(loading);
    this.videoLoadingIndicator = loading;

    return container;
  }

  /**
   * Create mute button for footer
   */
  private createMuteOverlayButton(): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'video-post__mute-overlay';
    button.setAttribute('aria-label', 'Toggle mute');
    
    // Style to match other footer buttons
    this.applyIconButtonStyles(button);
    button.style.color = THEME.colors.textPrimary;
    button.style.padding = '0';
    button.style.width = '44px';
    button.style.height = '44px';
    button.style.minWidth = '44px';
    button.style.minHeight = '44px';
    // Prevent double-tap zoom on mobile and improve touch responsiveness
    button.style.touchAction = 'manipulation';
    
    // Handle mute toggle
    const handleMuteToggle = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation(); // Prevent any other handlers from running
      if (this.onMuteToggle && this.getGlobalMuteState) {
        const currentState = this.getGlobalMuteState();
        this.onMuteToggle(!currentState);
      }
    };
    
    // Click handler (desktop)
    button.addEventListener('click', handleMuteToggle);
    
    // Touch handler (mobile) - use unified touch handler utility
    const isMobile = isMobileDevice();
    if (isMobile) {
      setupTouchHandlers(button, {
        onTap: (e) => {
          handleMuteToggle(e);
        },
        preventDefault: true,
        stopPropagation: true,
        stopImmediatePropagation: true,
      });
      
      // Prevent click event from firing after touch to avoid double-firing
      preventClickAfterTouch(button);
    }
    
    this.muteOverlayButton = button;
    
    // Update button appearance based on global mute state
    this.updateMuteOverlayButton();
    
    return button;
  }

  /**
   * Update mute overlay button appearance based on global mute state
   */
  updateMuteOverlayButton(): void {
    const btn = this.muteOverlayButton;
    if (!btn || !this.getGlobalMuteState) return;
    
    const isMuted = this.getGlobalMuteState();
    if (isMuted) {
      btn.innerHTML = VOLUME_MUTED_SVG;
      btn.setAttribute('aria-label', 'Unmute');
    } else {
      btn.innerHTML = VOLUME_UNMUTED_SVG;
      btn.setAttribute('aria-label', 'Mute');
    }
    
    // Always keep mute button active (marker previews can have audio)
    btn.style.opacity = '1';
    btn.style.pointerEvents = 'auto';
  }

  /**
   * Build URL with cache-busting parameter
   */
  private buildUrlWithCacheBusting(path: string): string | undefined {
    const baseUrl = toAbsoluteUrl(path);
    if (!baseUrl) return undefined;
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}t=${Date.now()}`;
  }

  /**
   * Get poster URL for image-based markers
   */
  private getImageBasedMarkerPoster(marker: SceneMarker): string | undefined {
    const imagePaths = marker?.scene?.paths as { thumbnail?: string; preview?: string; image?: string } | undefined;
    const thumbnail = imagePaths?.thumbnail;
    if (thumbnail) {
      const url = this.buildUrlWithCacheBusting(thumbnail);
      if (url) return url;
    }
    const preview = imagePaths?.preview;
    if (preview) {
      return this.buildUrlWithCacheBusting(preview);
    }
    return undefined;
  }

  /**
   * Get poster URL for synthetic/short form markers
   */
  private getSyntheticMarkerPoster(marker: SceneMarker): string | undefined {
    const p = marker?.scene?.paths?.screenshot;
    if (!p) return undefined;
    return this.buildUrlWithCacheBusting(p);
  }

  /**
   * Get poster URL for the video
   * Only uses screenshots - never preview or webp
   * Returns undefined if screenshot is unavailable (will trigger first frame fallback)
   */
  private getPosterUrl(): string | undefined {
    const m = this.data.marker;
    const markerId = m?.id;
    
    // Handle image-based markers (marker.id starts with 'image-')
    if (markerId && typeof markerId === 'string' && markerId.startsWith('image-')) {
      return this.getImageBasedMarkerPoster(m);
    }
    
    // Skip synthetic markers and short form markers - they don't have screenshots in Stash
    if (markerId && typeof markerId === 'string' && (markerId.startsWith('synthetic-') || markerId.startsWith('shortform-'))) {
      return this.getSyntheticMarkerPoster(m);
    }
    
    // Prefer preloaded poster from batch prefetch (commit parity)
    const cached = posterPreloader.getPosterForMarker(m);
    if (cached) return cached;
    
    // Only use screenshot if not preloaded
    const p = m?.scene?.paths?.screenshot;
    if (!p) return undefined;
    return this.buildUrlWithCacheBusting(p);
  }

  /**
   * Refresh the header to show updated tag chips (e.g., after creating a marker)
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
   * Create header with performer and tag chips
   */
  private createHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'video-post__header';
    header.style.padding = '8px 16px';
    header.style.marginBottom = '0';
    header.style.borderBottom = 'none';

    // Performer section - name and image
    if (this.data.marker.scene.performers && this.data.marker.scene.performers.length > 0) {
      const performersSection = document.createElement('div');
      performersSection.className = 'video-post__performers';
      for (const performer of this.data.marker.scene.performers) {
        const chip = this.createPerformerChip(performer);
        performersSection.appendChild(chip);
      }
      header.appendChild(performersSection);
    }

    // Tag chips section - clean line without box
    // Skip in shuffle mode UNLESS a marker has been created (to show the assigned tag)
    if (!this.useShuffleMode || this.hasCreatedMarker) {
      const tagsSection = document.createElement('div');
      tagsSection.className = 'video-post__tags';
      this.addTagChips(tagsSection);
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

  /**
   * Check if a tag should be skipped (internal tags or duplicates)
   */
  private shouldSkipTag(tag: { id?: string; name?: string } | null | undefined, displayedTagIds: Set<string>): boolean {
    if (!tag?.id || !tag?.name || displayedTagIds.has(tag.id)) {
      return true;
    }
    
    // Skip if this tag is the same as the primary tag
    if (this.data.marker.primary_tag?.id === tag.id) {
      return true;
    }
    
    // Skip the StashGifs Favorite tag (already represented by heart button)
    if (tag.name === FAVORITE_TAG_NAME) {
      return true;
    }
    
    // Skip the StashGifs Marker tag (internal tag for plugin-created markers)
    if (tag.name === MARKER_TAG_NAME) {
      return true;
    }
    
    return false;
  }

  /**
   * Add primary tag chip if valid
   */
  private addPrimaryTagChip(chips: HTMLElement, displayedTagIds: Set<string>): HTMLElement | null {
    if (this.data.marker.primary_tag?.id && 
        this.data.marker.primary_tag.name &&
        this.data.marker.primary_tag.name !== FAVORITE_TAG_NAME &&
        this.data.marker.primary_tag.name !== MARKER_TAG_NAME) {
      const chip = this.createTagChip(this.data.marker.primary_tag);
      chips.appendChild(chip);
      displayedTagIds.add(this.data.marker.primary_tag.id);
      return chip;
    }
    return null;
  }

  /**
   * Add spacing to first tag chip if performers are present
   */
  private addSpacingToFirstTag(chip: HTMLElement, hasPerformers: boolean, isFirstTag: boolean): boolean {
    if (hasPerformers && isFirstTag) {
      chip.style.marginLeft = '8px';
      return false; // No longer first tag
    }
    return isFirstTag;
  }

  /**
   * Add tags from a list to the chips container
   */
  private addTagsFromList(
    tags: Array<{ id: string; name: string }> | undefined,
    chips: HTMLElement,
    displayedTagIds: Set<string>,
    hasPerformers: boolean,
    isFirstTag: boolean
  ): boolean {
    if (!tags || tags.length === 0) {
      return isFirstTag;
    }

    for (const tag of tags) {
      if (this.shouldSkipTag(tag, displayedTagIds)) {
        continue;
      }
      
      const chip = this.createTagChip(tag);
      isFirstTag = this.addSpacingToFirstTag(chip, hasPerformers, isFirstTag);
      chips.appendChild(chip);
      displayedTagIds.add(tag.id);
    }

    return isFirstTag;
  }

  /**
   * Add tag chips to the chips container
   */
  private addTagChips(chips: HTMLElement): void {
    const hasPerformers = !!(this.data.marker.scene.performers && this.data.marker.scene.performers.length > 0);
    const displayedTagIds = new Set<string>();
    let isFirstTag = true;
    
    // Add primary tag if it exists
    const primaryTagChip = this.addPrimaryTagChip(chips, displayedTagIds);
    if (primaryTagChip) {
      isFirstTag = this.addSpacingToFirstTag(primaryTagChip, hasPerformers, isFirstTag);
    }
    
    // Add other tags from marker tags array
    isFirstTag = this.addTagsFromList(this.data.marker.tags, chips, displayedTagIds, hasPerformers, isFirstTag);
    
    // For shortform content (scenes, not markers), show tags from the scene
    // For regular markers, only show marker tags (not scene tags)
    const isShortForm = this.isShortFormContent();
    if (isShortForm) {
      this.addTagsFromList(this.data.marker.scene.tags, chips, displayedTagIds, hasPerformers, isFirstTag);
    }
  }



  /**
   * Check if this is a short-form content marker
   */
  private isShortFormContent(): boolean {
    return typeof this.data.marker.id === 'string' && this.data.marker.id.startsWith('shortform-');
  }

  /**
   * Determine if marker ID represents a synthetic marker
   */
  private isSyntheticMarker(): boolean {
    const markerId = this.data.marker?.id;
    return typeof markerId === 'string' && markerId.startsWith('synthetic-');
  }

  /**
   * Add action buttons (heart/marker/add tag) to button group
   */
  private addActionButtons(buttonGroup: HTMLElement): void {
    const isShortForm = this.isShortFormContent();
    
    // Hide favorite button in shuffle mode, show marker button instead
    // But if marker was already created, show heart button instead
    if (this.useShuffleMode) {
      if (this.hasCreatedMarker && this.favoritesManager) {
        // Marker was created, show heart button and "+" button
        const heartBtn = this.createHeartButton();
        buttonGroup.appendChild(heartBtn);
        if (this.api && (this.isRealMarker() || isShortForm)) {
          const addTagBtn = this.createAddTagButton('Add tag to marker');
          buttonGroup.appendChild(addTagBtn);
        }
      } else if (this.api) {
        // Show marker button to create marker
        const markerBtn = this.createMarkerButton();
        buttonGroup.appendChild(markerBtn);
      }
    } else {
      // Non-shuffle mode: show heart and "+" buttons for real markers and shortform content
      if (this.favoritesManager) {
        const heartBtn = this.createHeartButton();
        buttonGroup.appendChild(heartBtn);
      }
      if (this.api && (this.isRealMarker() || isShortForm)) {
        const addTagBtn = this.createAddTagButton('Add tag to marker');
        buttonGroup.appendChild(addTagBtn);
      }
    }
  }

  /**
   * Create footer with action buttons
   */
  private createFooter(): HTMLElement {
    const { footer, info, row, buttonGroup } = this.buildFooterContainer();
    info.style.flexDirection = 'row';
    info.style.justifyContent = 'flex-end';
    row.style.justifyContent = 'flex-end';
    buttonGroup.style.flexWrap = 'nowrap';
    buttonGroup.style.flexShrink = '0';
    this.buttonGroup = buttonGroup; // Store reference for button swapping

    // Add buttons in order
    this.addActionButtons(buttonGroup);

    if (this.api) {
      const oCountBtn = this.createOCountButton();
      buttonGroup.appendChild(oCountBtn);
    }

    const ratingControl = this.createRatingSection();
    buttonGroup.appendChild(ratingControl);

    if (this.api) {
      const hqBtn = this.createHQButton();
      buttonGroup.appendChild(hqBtn);
    }

    const muteBtn = this.createMuteOverlayButton();
    buttonGroup.appendChild(muteBtn);

    const playBtn = this.createPlayButton();
    buttonGroup.appendChild(playBtn);

    return footer;
  }

  /**
   * Create play button to open scene in Stash
   */
  private createPlayButton(): HTMLElement {
    const sceneLink = this.getSceneLink();
    const iconBtn = document.createElement('a');
    iconBtn.className = 'icon-btn icon-btn--play';
    iconBtn.href = sceneLink;
    iconBtn.target = '_blank';
    iconBtn.rel = 'noopener noreferrer';
    iconBtn.setAttribute('aria-label', 'View full scene');
    iconBtn.title = 'Open scene in Stash';
    this.applyIconButtonStyles(iconBtn);
    iconBtn.style.color = THEME.colors.accentPrimary;
    iconBtn.style.padding = '0';
    iconBtn.innerHTML = EXTERNAL_LINK_SVG;
    
    this.addHoverEffect(iconBtn);
    this.playButton = iconBtn;
    return iconBtn;
  }


  /**
   * Perform favorite toggle action for VideoPost
   */
  protected async toggleFavoriteAction(): Promise<boolean> {
    if (!this.favoritesManager) {
      throw new Error('FavoritesManager not available');
    }
    return await this.favoritesManager.toggleFavorite(this.data.marker);
  }

  /**
   * Create marker button for creating new markers in shuffle mode
   */
  private createMarkerButton(): HTMLElement {
    const markerBtn = document.createElement('button');
    markerBtn.className = 'icon-btn icon-btn--marker';
    markerBtn.type = 'button';
    markerBtn.setAttribute('aria-label', 'Create marker');
    markerBtn.title = 'Create marker from post';
    this.applyIconButtonStyles(markerBtn);
    markerBtn.style.padding = '0';
    markerBtn.innerHTML = MARKER_SVG;

    const clickHandler = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      this.openMarkerDialog();
    };

    markerBtn.addEventListener('click', clickHandler);
    this.addHoverEffect(markerBtn);
    this.markerButton = markerBtn;
    return markerBtn;
  }


  /**
   * Check if marker has a real ID (not synthetic)
   */
  private isRealMarker(): boolean {
    const markerId = this.data.marker?.id;
    if (!markerId) return false;
    if (typeof markerId === 'string' && markerId.startsWith('synthetic-')) {
      return false;
    }
    return true;
  }

  /**
   * Replace marker button with heart button after marker creation
   */
  private replaceMarkerButtonWithHeart(): void {
    if (!this.buttonGroup || !this.markerButton || !this.favoritesManager) return;

    // Remove marker button
    this.markerButton?.remove();
    this.markerButton = undefined;

    // Create and add heart button in the same position (first button)
    const heartBtn = this.createHeartButton();
    this.buttonGroup.insertBefore(heartBtn, this.buttonGroup.firstChild);

    // Also add "+" button for adding tags
    if (this.api && this.isRealMarker()) {
      const addTagBtn = this.createAddTagButton();
      // Insert after heart button
      if (this.buttonGroup.firstChild) {
        this.buttonGroup.insertBefore(addTagBtn, this.buttonGroup.firstChild.nextSibling);
      } else {
        this.buttonGroup.appendChild(addTagBtn);
      }
    }

    // Check favorite status to ensure heart button shows correct state
    this.checkFavoriteStatus();
  }

  /**
   * Update local tags after favorite toggle
   */
  protected async updateLocalTagsAfterFavoriteToggle(newFavoriteState: boolean): Promise<void> {
    const isShortForm = this.isShortFormContent();
    const favoriteTagId = await this.favoritesManager?.getFavoriteTagId() ?? null;
    const tagId = favoriteTagId ?? undefined;
    
    if (isShortForm) {
      this.updateSceneTagsAfterFavoriteToggle(newFavoriteState, tagId);
    } else {
      this.updateMarkerTagsAfterFavoriteToggle(newFavoriteState, tagId);
    }
  }

  /**
   * Update scene tags after favorite toggle (for shortform content)
   */
  private updateSceneTagsAfterFavoriteToggle(newFavoriteState: boolean, favoriteTagId: string | undefined): void {
    this.data.marker.scene.tags ??= [];
    const tags = this.data.marker.scene.tags;
    if (!tags) return;
    
    if (newFavoriteState) {
      this.addFavoriteTagToScene(tags, favoriteTagId);
    } else {
      this.removeFavoriteTagFromScene(tags, favoriteTagId);
    }
  }

  /**
   * Update marker tags after favorite toggle (for regular markers)
   */
  private updateMarkerTagsAfterFavoriteToggle(newFavoriteState: boolean, favoriteTagId: string | undefined): void {
    this.data.marker.tags ??= [];
    const tags = this.data.marker.tags;
    if (!tags) return;
    
    if (newFavoriteState) {
      this.addFavoriteTagToMarker(tags, favoriteTagId);
    } else {
      this.removeFavoriteTagFromMarker(tags, favoriteTagId);
    }
  }

  /**
   * Add favorite tag to tags array
   */
  private addFavoriteTag(tags: Array<{ id: string; name: string }>, favoriteTagId: string | undefined): void {
    if (favoriteTagId && !tags.some(tag => tag.id === favoriteTagId || tag.name === FAVORITE_TAG_NAME)) {
      tags.push({ id: favoriteTagId, name: FAVORITE_TAG_NAME });
    }
  }

  /**
   * Remove favorite tag from tags array
   */
  private removeFavoriteTag(tags: Array<{ id: string; name: string }>, favoriteTagId: string | undefined): Array<{ id: string; name: string }> {
    return tags.filter(
      tag => tag.id !== favoriteTagId && tag.name !== FAVORITE_TAG_NAME
    );
  }

  /**
   * Add favorite tag to scene tags
   */
  private addFavoriteTagToScene(tags: Array<{ id: string; name: string }>, favoriteTagId: string | undefined): void {
    this.addFavoriteTag(tags, favoriteTagId);
  }

  /**
   * Remove favorite tag from scene tags
   */
  private removeFavoriteTagFromScene(tags: Array<{ id: string; name: string }>, favoriteTagId: string | undefined): void {
    this.data.marker.scene.tags = this.removeFavoriteTag(tags, favoriteTagId);
  }

  /**
   * Add favorite tag to marker tags
   */
  private addFavoriteTagToMarker(tags: Array<{ id: string; name: string }>, favoriteTagId: string | undefined): void {
    this.addFavoriteTag(tags, favoriteTagId);
  }

  /**
   * Remove favorite tag from marker tags
   */
  private removeFavoriteTagFromMarker(tags: Array<{ id: string; name: string }>, favoriteTagId: string | undefined): void {
    this.data.marker.tags = this.removeFavoriteTag(tags, favoriteTagId);
  }


  /**
   * Perform O-count increment action for VideoPost
   */
  protected async incrementOCountAction(): Promise<void> {
    if (!this.api) {
      throw new Error('API not available');
    }
    const result = await this.api.incrementOCount(this.data.marker.scene.id);
    this.oCount = result.count;
    this.data.marker.scene.o_counter = result.count;
  }

  /**
   * Create HQ button
   */
  private createHQButton(): HTMLElement {
    const hqBtn = document.createElement('button');
    hqBtn.className = 'icon-btn icon-btn--hq';
    hqBtn.type = 'button';
    hqBtn.setAttribute('aria-label', 'Load high-quality scene video with audio');
    hqBtn.title = 'Load HD marker';
    this.applyIconButtonStyles(hqBtn);
    hqBtn.style.padding = '0';

    this.updateHQButton(hqBtn);
    this.hqButton = hqBtn;

    const clickHandler = async (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (!this.api || this.isHQMode) return;

      hqBtn.disabled = true;
      hqBtn.style.opacity = '0.5';

      try {
        await this.upgradeToSceneVideo();
        this.isHQMode = true;
        this.updateHQButton(hqBtn);
        this.updateMuteOverlayButton();
      } catch (error) {
        console.error('Failed to upgrade to scene video', error);
        // Log more details about the error
        if (error instanceof Error) {
          console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name,
          });
        } else if (error instanceof DOMException) {
          console.error('DOMException details:', {
            name: error.name,
            message: error.message,
          });
        }
        showToast('Failed to load high-quality video. Please try again.');
      } finally {
        hqBtn.disabled = false;
        hqBtn.style.opacity = '1';
      }
    };

    hqBtn.addEventListener('click', clickHandler);
    this.addHoverEffect(hqBtn);
    return hqBtn;
  }

  /**
   * Update HQ button appearance based on mode
   */
  private updateHQButton(button: HTMLElement): void {
    if (this.isHQMode) {
      button.innerHTML = HQ_SVG_FILLED;
      button.style.color = THEME.colors.accentPrimary;
      button.title = 'HD video loaded';
    } else {
      button.innerHTML = HQ_SVG_OUTLINE;
      button.style.color = THEME.colors.textSecondary;
      button.title = 'Load HD video with audio';
    }
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
      title: 'Set rating on marker',
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
    this.container.appendChild(dialog);

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
    starsContainer.setAttribute('aria-label', `Rate this scene from 0 to ${maxStars}${this.isHalfPrecision() ? ' (half stars allowed)' : ''}`);
    this.ratingStarButtons = [];

    const isHalfPrecision = this.isHalfPrecision();
    const numStars = maxStars; // Always show maxStars number of stars
    
    if (isHalfPrecision) {
      const handlePointerMove = (event: PointerEvent | MouseEvent) => {
        this.handleStarsPointerMove(event);
      };
      const handlePointerLeave = () => {
        this.onStarHoverLeave();
      };
      const handlePointerDown = (event: PointerEvent) => {
        // Calculate preview value on pointerdown for mobile quick taps
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
          return; // Let button click handle mouse selections
        }
        // Calculate value if not already set (for quick taps)
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
      
      // Add hover handlers for preview
      if (!isHalfPrecision) {
        starBtn.addEventListener('mouseenter', () => {
          this.onStarHover(i);
        });
      }
      starBtn.addEventListener('mouseleave', () => {
        this.onStarHoverLeave();
      });
      
      // Click handler - commit the currently previewed value
      starBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const timeSincePointerSelect = performance.now() - this.lastPointerSelectionTs;
        let targetValue: number;
        if (isHalfPrecision) {
          // Use container-level calculation for consistency with hover preview
          const calculatedValue = this.calculatePreviewValueFromPointer(event.clientX);
          targetValue = this.hoveredPreviewValue ?? calculatedValue ?? i;
          if (timeSincePointerSelect < 200) {
            return; // Already handled via pointerup (touch/pen)
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
        // Don't trigger preview on focus if we already have a preview value set
        // (from opening with existing rating - let user hover to change it)
        if (this.hoveredPreviewValue !== undefined) {
          return;
        }
        // Don't trigger preview on focus if we just opened the dialog and have no rating
        if (this.isRatingDialogOpen && !this.hasRating) {
          return;
        }
        // Only show preview on focus for keyboard navigation (not initial open)
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
   * Create star icon element with separate fill/outline spans
   */
  private createStarIconElement(): HTMLElement {
    const wrapper = document.createElement('span');
    wrapper.className = 'rating-dialog__star-icon';
    wrapper.style.position = 'relative';
    wrapper.style.display = 'inline-block';
    wrapper.style.width = '28px';
    wrapper.style.height = '28px';
    wrapper.style.lineHeight = '1';
    wrapper.style.fontSize = '24px';
    wrapper.style.pointerEvents = 'none';
    wrapper.style.userSelect = 'none';
    wrapper.style.overflow = 'hidden';
    wrapper.setAttribute('aria-hidden', 'true');

    const outlineSpan = document.createElement('span');
    outlineSpan.className = 'rating-dialog__star-outline';
    outlineSpan.textContent = '☆';
    outlineSpan.style.position = 'absolute';
    outlineSpan.style.left = '0';
    outlineSpan.style.top = '0';
    outlineSpan.style.width = '100%';
    outlineSpan.style.height = '100%';
    outlineSpan.style.display = 'block';
    outlineSpan.style.color = `var(--rating-star-outline, ${THEME.colors.textPrimary})`;
    outlineSpan.style.textShadow = '0 0 4px rgba(0,0,0,0.8), 0 0 2px rgba(0,0,0,0.6)';

    const fillSpan = document.createElement('span');
    fillSpan.className = 'rating-dialog__star-fill';
    fillSpan.innerHTML = STAR_SVG;
    fillSpan.style.position = 'absolute';
    fillSpan.style.display = 'flex';
    fillSpan.style.alignItems = 'center';
    fillSpan.style.justifyContent = 'center';
    fillSpan.style.color = `var(--rating-star-fill, ${THEME.colors.ratingLow})`;
    fillSpan.style.textShadow = '0 0 8px rgba(0,0,0,0.8), 0 0 4px rgba(0,0,0,0.6)';
    fillSpan.style.zIndex = '1';
    fillSpan.style.transition = 'width 120ms ease-in-out, opacity 120ms ease-in-out';

    wrapper.append(outlineSpan, fillSpan);
    return wrapper;
  }

  /**
   * Determine hover value (half/full) based on pointer position within a star
   */
  private getHoverValueFromEvent(event: PointerEvent | MouseEvent, starIndex: number, explicitTarget?: HTMLElement | null): number {
    if (!this.isHalfPrecision()) {
      return starIndex;
    }

    const isPointerEvent = 'pointerType' in event;

    // Keyboard-triggered click (MouseEvent with detail === 0) - default to full star
    if (!isPointerEvent && 'detail' in event && event.detail === 0) {
      return starIndex;
    }

    const target = explicitTarget ?? ((event.currentTarget ?? event.target) as HTMLElement | null);
    if (!target) {
      return starIndex;
    }

    const rect = target.getBoundingClientRect();
    if (!rect.width || !Number.isFinite(rect.width)) {
      return starIndex;
    }

    const relativeX = (event.clientX - rect.left) / rect.width;
    const halfValue = Math.max(RATING_MIN_STARS, starIndex - 0.5);

    if (!Number.isFinite(relativeX)) {
      return starIndex;
    }

    const clampedRatio = Math.min(Math.max(relativeX, 0), 1);

    return clampedRatio <= 0.5 ? halfValue : starIndex;
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
        // Focus event will trigger hover preview
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
    // Use requestAnimationFrame to ensure DOM is ready before measuring
    requestAnimationFrame(() => {
      this.syncRatingDialogLayout();
    });
    document.addEventListener('mousedown', this.ratingOutsideClickHandler);
    document.addEventListener('touchstart', this.ratingOutsideClickHandler);
    document.addEventListener('keydown', this.ratingKeydownHandler);
    window.addEventListener('resize', this.ratingResizeHandler);
    
    // Preview current rating as starting point
    if (this.hasRating && this.ratingValue > 0) {
      const maxStars = this.getMaxStars();
      const starIndex = Math.min(Math.max(Math.ceil(this.ratingValue), 1), maxStars);
      this.hoveredStarIndex = starIndex;
      this.hoveredPreviewValue = this.ratingValue;
      this.updateRatingStarButtons(true);
      
      // Focus the button that matches the current rating
      if (this.ratingStarButtons.length >= starIndex) {
        const targetButton = this.ratingStarButtons[starIndex - 1];
        if (targetButton) {
          targetButton.focus();
        }
      }
    } else {
      // Clear any preview state when opening without a rating
      this.hoveredStarIndex = undefined;
      this.hoveredPreviewValue = undefined;
      this.updateRatingStarButtons();
      
      // Focus first star button for keyboard navigation (only when no rating)
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
    // Clear hover preview when closing
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
        ? `Scene rating ${this.formatRatingValue(this.ratingValue)} out of ${maxStars}`
        : 'Rate this scene';
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
   * Update star buttons appearance and state
   */
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
    
    // Keep background transparent for all stars
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
   * @param isPreview - If true, show hover preview state
   */
  private updateRatingStarButtons(isPreview: boolean = false): void {
    if (!this.ratingStarButtons || this.ratingStarButtons.length === 0) return;
    this.isHalfPrecision();
    this.getMaxStars();
    
    // Determine the preview or actual rating value
    const displayValue = isPreview && this.hoveredPreviewValue !== undefined
      ? this.hoveredPreviewValue
      : this.ratingValue;
    
    for (let i = 0; i < this.ratingStarButtons.length; i++) {
      const button = this.ratingStarButtons[i];
      const starIndex = i + 1; // 1-based index
      this.updateSingleStarButton(button, starIndex, displayValue, isPreview, i);
    }
  }

  /**
   * Handle star toggle for half precision (empty → half → full → empty)
   */
  private async onRatingStarToggle(starIndex: number): Promise<void> {
    if (this.isSavingRating) return;

    const currentStarValue = starIndex; // Full value of this star
    const halfStarValue = starIndex - 0.5; // Half value of this star
    const previousValue = this.ratingValue;
    const previousRating100 = this.data.marker.scene.rating100;
    const previousHasRating = this.hasRating;

    // Determine next state: empty → full → half → empty
    // This allows users to set full star ratings (e.g., 3) directly, not just half (e.g., 3.5)
    let nextValue: number;
    // Check if we're exactly at the full value for this star
    if (Math.abs(this.ratingValue - currentStarValue) < 0.01) {
      // Currently at full value for this star - set to half
      nextValue = halfStarValue;
      this.hasRating = true;
    } else if (Math.abs(this.ratingValue - halfStarValue) < 0.01) {
      // Currently at half value for this star - set to empty
      nextValue = 0;
      this.hasRating = false;
    } else {
      // Currently higher than this star, or empty/lower than half - set to full (this star)
      // This allows users to set full star ratings (e.g., 3) directly, not just half (e.g., 3.5)
      nextValue = currentStarValue;
      this.hasRating = true;
    }

    this.ratingValue = this.clampRatingValue(nextValue);
    
    this.updateRatingDisplay();
    this.updateRatingStarButtons();
    this.closeRatingDialog();

    if (!this.api) {
      const maxStars = this.getMaxStars();
      this.data.marker.scene.rating100 = Math.round((this.ratingValue / maxStars) * 100);
      return;
    }

    this.isSavingRating = true;
    this.setRatingSavingState(true);
    this.updateRatingStarButtons();

    try {
      // Convert star value to 0-10 scale for API (API expects 0-10 regardless of display)
      const maxStars = this.getMaxStars();
      const rating10 = (this.ratingValue / maxStars) * RATING_MAX_STARS;
      const updatedRating100 = await this.api.updateSceneRating(this.data.marker.scene.id, rating10);
      this.data.marker.scene.rating100 = updatedRating100;
      this.ratingValue = this.convertRating100ToStars(updatedRating100);
      this.hasRating = this.ratingValue > 0;
      this.updateRatingDisplay();
      this.updateRatingStarButtons();
    } catch (error) {
      console.error('Failed to update scene rating', error);
      showToast('Failed to update rating. Please try again.');
      this.ratingValue = previousValue;
      this.hasRating = previousHasRating;
      this.data.marker.scene.rating100 = previousRating100;
      this.updateRatingDisplay();
      this.updateRatingStarButtons();
    } finally {
      this.isSavingRating = false;
      this.setRatingSavingState(false);
      this.updateRatingStarButtons();
    }
  }

  /**
   * Handle star selection (for full precision or direct selection)
   */
  private async onRatingStarSelect(value: number): Promise<void> {
    if (this.isSavingRating) return;

    const nextValue = this.clampRatingValue(value);
    const previousValue = this.ratingValue;
    const previousRating100 = this.data.marker.scene.rating100;
    const previousHasRating = this.hasRating;

    this.ratingValue = nextValue;
    this.hasRating = nextValue > 0;
    this.updateRatingDisplay();
    this.updateRatingStarButtons();
    this.closeRatingDialog();

    if (!this.api) {
      const maxStars = this.getMaxStars();
      this.data.marker.scene.rating100 = Math.round((this.ratingValue / maxStars) * 100);
      return;
    }

    this.isSavingRating = true;
    this.setRatingSavingState(true);
    this.updateRatingStarButtons();

    try {
      // Convert star value to 0-10 scale for API (API expects 0-10 regardless of display)
      const maxStars = this.getMaxStars();
      const rating10 = (this.ratingValue / maxStars) * RATING_MAX_STARS;
      const updatedRating100 = await this.api.updateSceneRating(this.data.marker.scene.id, rating10);
      this.data.marker.scene.rating100 = updatedRating100;
      this.ratingValue = this.convertRating100ToStars(updatedRating100);
      this.hasRating = this.ratingValue > 0;
      this.updateRatingDisplay();
      this.updateRatingStarButtons();
    } catch (error) {
      console.error('Failed to update scene rating', error);
      showToast('Failed to update rating. Please try again.');
      this.ratingValue = previousValue;
      this.hasRating = previousHasRating;
      this.data.marker.scene.rating100 = previousRating100;
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
    if (isSaving) {
      this.ratingDisplayButton.classList.add('icon-btn--rating-saving');
      this.ratingDisplayButton.setAttribute('aria-busy', 'true');
      this.ratingDisplayButton.disabled = true;
      this.ratingDisplayButton.style.transform = 'scale(1)';
    } else {
      this.ratingDisplayButton.classList.remove('icon-btn--rating-saving');
      this.ratingDisplayButton.removeAttribute('aria-busy');
      this.ratingDisplayButton.disabled = false;
    }
    for (const button of this.ratingStarButtons) {
      button.disabled = isSaving;
    }
  }

  /**
   * Sync rating dialog layout with container
   */
  private calculateStarsWidth(dialog: HTMLElement): number {
    if (this.ratingStarButtons.length > 0) {
      // Use cached width if available (button widths don't change)
      if (this.cachedStarButtonWidth === undefined) {
        // Measure actual width of all star buttons combined (only once)
        let totalWidth = 0;
        for (const starBtn of this.ratingStarButtons) {
          const rect = starBtn.getBoundingClientRect();
          totalWidth += rect.width;
        }
        // Cache the average width per button
        if (this.ratingStarButtons.length > 0) {
          this.cachedStarButtonWidth = totalWidth / this.ratingStarButtons.length;
        }
        return totalWidth;
      }
      return this.cachedStarButtonWidth * this.ratingStarButtons.length;
    }
    // Fallback: use container scrollWidth if buttons aren't available yet
    const starsContainer = dialog.querySelector<HTMLElement>('.rating-dialog__stars');
    if (starsContainer) {
      return starsContainer.scrollWidth;
    }
    // Final fallback: estimate based on star count
    return 10 * 24; // 10 stars * ~24px each
  }

  private syncRatingDialogLayout(): void {
    if (!this.ratingWrapper) return;
    const dialog = this.ratingDialog;
    if (!dialog) return;

    const cardRect = this.container.getBoundingClientRect();
    const wrapperRect = this.ratingWrapper.getBoundingClientRect();
    if (!cardRect.width || !wrapperRect.width) return;

    // Calculate exact width needed for stars dynamically
    // Ensure dialog fits within card bounds (with small margin)
    const margin = 8; // Small margin from card edges
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

    dialog.style.boxSizing = 'border-box';
    dialog.style.width = `${finalWidth}px`;
    dialog.style.minWidth = `${finalWidth}px`;
    dialog.style.left = 'auto';
    dialog.style.right = `${margin}px`;
    const bottomOffset = cardRect.bottom - wrapperRect.top + 10;
    dialog.style.bottom = `${bottomOffset}px`;
  }

  /**
   * Clamp rating value to valid range
   */
  private clampRatingValue(value: number): number {
    if (!Number.isFinite(value)) return RATING_MIN_STARS;
    const maxStars = this.getMaxStars();
    if (this.isHalfPrecision()) {
      // Round to nearest 0.5 for half precision
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
    // Stars type (both full and half) uses 5 stars max
    // Decimal type uses 10 stars max
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
      // Show one decimal place for half precision
      return value.toFixed(1);
    }
    // Show integer for full precision
    return Math.round(value).toString();
  }

  /**
   * Destroy the current player instance
   */
  private async destroyCurrentPlayer(): Promise<void> {
    if (!this.player) {
      return;
    }
    
    // Clear the state change listener first to prevent it from firing after destroy
    // This is critical - the old player's listener might try to update visibility manager
    // with the destroyed player's state, causing conflicts
    this.player.setStateChangeListener();
    
    // Unload first to release video buffers immediately
    if (this.player.getIsUnloaded()) {
      return;
    }
    this.player.unload();
    // Small delay to ensure unload completes and memory is released
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Destroy the player FIRST - it will handle removing the video element from DOM
    // This prevents the "Child to be replaced is not a child" error
    this.player.destroy();
    this.player = undefined;
    this.isLoaded = false;
    
    // Small delay to ensure destroy completes
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  /**
   * Clean up leftover player elements from DOM
   */
  private cleanupPlayerElements(playerContainer: HTMLElement): void {
    try {
      const oldPlayerWrappers = playerContainer.querySelectorAll('.video-player');
      for (const wrapper of Array.from(oldPlayerWrappers)) {
        wrapper.remove();
      }
      
      const oldControls = playerContainer.querySelectorAll('.video-player__controls');
      for (const controls of Array.from(oldControls)) {
        controls.remove();
      }
    } catch (e) {
      console.warn('Failed to remove old player elements', e);
      // If removing elements fails, try clearing container as fallback
      try {
        playerContainer.innerHTML = '';
      } catch (error_) {
        console.error('Failed to clear player container', error_);
        throw new Error('Failed to clear player container for upgrade');
      }
    }
  }

  /**
   * Attempt to start playback with retry logic
   */
  private async attemptPlayback(waitTimeout: number, checkDelay: number): Promise<boolean> {
    if (!this.player) {
      return false;
    }
    
    try {
      // Wait for video to be actually loaded (fires on loadeddata/canplay events)
      await this.player.waitForReady(waitTimeout);
      
      // Attempt to play
      await this.player.play();
      
      // Wait for play() to take effect (longer on mobile)
      await new Promise(resolve => setTimeout(resolve, checkDelay));
      
      // Check if playback actually started
      if (this.player.isPlaying()) {
        return true;
      }
      
      // If not playing, check readyState as additional verification
      const videoElement = this.player.getVideoElement();
      if (videoElement && videoElement.readyState >= 2) {
        // Video is loaded, might just need more time
        // Wait a bit more and check again
        await new Promise(resolve => setTimeout(resolve, checkDelay));
        return this.player.isPlaying();
      }
      
      return false;
    } catch (error: unknown) {
      // Error occurred, check if video is actually playing despite the error
      // Sometimes waitForReady or play() throws even when playback succeeds
      // Error is intentionally handled - we check playback state as fallback
      if (error instanceof Error) {
        // Silently handle - playback may have succeeded despite error
      }
      await new Promise(resolve => setTimeout(resolve, checkDelay));
      return this.player.isPlaying() ?? false;
    }
  }

  /**
   * Resume playback after upgrading to scene video
   */
  private async resumePlaybackAfterUpgrade(): Promise<void> {
    if (!this.player) {
      return;
    }
    
    const isMobile = isMobileDevice();
    const waitTimeout = isMobile ? 6000 : 4000; // Longer timeout on mobile for HD videos
    const checkDelay = isMobile ? 300 : 100; // More time on mobile for play() to take effect
    
    // Retry logic with exponential backoff
    let retryCount = 0;
    const maxRetries = 2; // Try up to 3 times total (initial + 2 retries)
    const retryDelays = [0, 500, 1000]; // Initial attempt, then 500ms, then 1000ms
    
    while (retryCount <= maxRetries) {
      const success = await this.attemptPlayback(waitTimeout, checkDelay);
      if (success) {
        return;
      }
      
      // If we get here, playback didn't start
      // Retry if we haven't exhausted retries
      if (retryCount < maxRetries) {
        const delay = retryDelays[retryCount + 1];
        await new Promise(resolve => setTimeout(resolve, delay));
        retryCount++;
        continue;
      }
      
      // All retries exhausted, show error
      const videoElement = this.player.getVideoElement();
      console.warn('Failed to resume playback after upgrade - video not playing after retries', {
        retryCount,
        readyState: videoElement?.readyState,
      });
      showToast('Video upgraded but playback failed. Click play to start.');
      return;
    }
  }

  /**
   * Create new scene video player
   */
  private async createSceneVideoPlayer(playerContainer: HTMLElement, sceneVideoUrl: string): Promise<void> {
    try {
      const startTime = this.data.startTime ?? this.data.marker.seconds;
      
      this.player = new NativeVideoPlayer(playerContainer, sceneVideoUrl, {
        muted: true,
        autoplay: false,
        startTime: startTime,
        endTime: this.data.endTime ?? this.data.marker.end_seconds,
        aggressivePreload: false, // HD videos use metadata preload
        isHDMode: true, // HD mode
        posterUrl: this.getPosterUrl(),
        showLoadingIndicator: false,
        // onMuteToggle removed - using overlay button instead
      });

      this.isLoaded = true;
      // Also ensure seek happens after metadata loads (redundant but ensures it works on mobile)
      if (startTime !== undefined) {
        void this.seekPlayerToStart(this.player, startTime);
      }
      this.hideMediaWhenReady(this.player, playerContainer);
    } catch (error) {
      console.error('VideoPost: Failed to create scene video player', {
        error,
        sceneVideoUrl,
        markerId: this.data.marker.id,
        sceneId: this.data.marker.scene?.id,
      });
      throw error; // Re-throw since this is an async method that should fail if player creation fails
    }
  }

  /**
   * Register player with visibility manager after upgrade
   */
  private async registerUpgradedPlayerWithVisibilityManager(): Promise<void> {
    // Wait a brief moment to ensure player is fully initialized before registering
    await new Promise(resolve => setTimeout(resolve, 50));
    if (this.visibilityManager && this.data.marker.id && this.player) {
      this.visibilityManager.registerPlayer(this.data.marker.id, this.player);
    }
  }

  /**
   * Validate and prepare for video upgrade
   */
  private validateAndPrepareUpgrade(): { sceneVideoUrl: string; playerContainer: HTMLElement; wasPlaying: boolean } {
    if (!this.api) {
      throw new Error('API not available');
    }

    // Detect if this is an image-based marker (marker.id starts with 'image-')
    const markerId = this.data.marker.id;
    const isImageMarker = typeof markerId === 'string' && markerId.startsWith('image-');
    
    let sceneVideoUrl: string | undefined;
    
    if (isImageMarker) {
      // For image-based markers, use paths.image (full MP4/M4V file)
      // Note: scene.paths is actually Image.paths for synthetic markers, which has image property
      const imagePaths = this.data.marker.scene?.paths as { image?: string; preview?: string; thumbnail?: string } | undefined;
      const imagePath = imagePaths?.image;
      if (!imagePath) {
        throw new Error('Image video URL not available');
      }
      sceneVideoUrl = imagePath.startsWith('http') 
        ? imagePath 
        : toAbsoluteUrl(imagePath);
    } else {
      // For regular markers, use getVideoUrl (full scene video)
      sceneVideoUrl = this.api.getVideoUrl(this.data.marker.scene);
    }
    
    if (!sceneVideoUrl || !isValidMediaUrl(sceneVideoUrl)) {
      throw new Error('Scene video URL not available');
    }

    const playerContainer = this.playerContainer || this.container.querySelector('.video-post__player') as HTMLElement;
    if (!playerContainer) {
      throw new Error('Player container not found');
    }

    // Capture current playback state with proper null checks
    const playerState = this.player?.getState();
    const wasPlaying = playerState?.isPlaying ?? false;

    return { sceneVideoUrl, playerContainer, wasPlaying };
  }

  /**
   * Upgrade from marker video to full scene video with audio
   */
  private async upgradeToSceneVideo(): Promise<void> {
    const { sceneVideoUrl, playerContainer, wasPlaying } = this.validateAndPrepareUpgrade();

    // Unload and destroy current marker player to free memory before creating new one
    await this.destroyCurrentPlayer();

    // Clean up any leftover player elements from the old player
    this.cleanupPlayerElements(playerContainer);

    // Small delay to ensure DOM is cleared and old player is fully destroyed
    await new Promise(resolve => setTimeout(resolve, 50));

    // Create new player with full scene video
    await this.createSceneVideoPlayer(playerContainer, sceneVideoUrl);

    // Register with visibility manager if available
    await this.registerUpgradedPlayerWithVisibilityManager();

    // If video was playing, resume playback
    if (wasPlaying) {
      await this.resumePlaybackAfterUpgrade();
    }
  }

  /**
   * Check favorite status from marker tags or scene tags
   */
  /**
   * Get favorite tag source for VideoPost
   */
  protected getFavoriteTagSource(): Array<{ name: string }> | undefined {
    const isShortForm = this.isShortFormContent();
    
    if (isShortForm) {
      // For shortform content, check scene tags
      return this.data.marker.scene?.tags;
    } else {
      // For regular markers, check marker tags
      return this.data.marker.tags;
    }
  }

  /**
   * Get link to scene in Stash
   */
  private getSceneLink(): string {
    const s = this.data.marker.scene;
    const t = Math.max(0, Math.floor(this.data.marker.seconds || 0));
    return `${globalThis.location.origin}/scenes/${s.id}?t=${t}`;
  }


  /**
   * Load the video player
   */
  loadPlayer(videoUrl: string, startTime?: number, endTime?: number): NativeVideoPlayer | undefined {
    // Early return if already loaded
    if (this.isLoaded) {
      return this.player;
    }

    // Validate URL early before any other checks
    if (!videoUrl || !isValidMediaUrl(videoUrl)) {
      console.warn('VideoPost: Invalid media URL, skipping player creation', { 
        videoUrl,
        markerId: this.data.marker.id,
        sceneId: this.data.marker.scene?.id,
      });
      return undefined;
    }

    const playerContainer = this.playerContainer || this.container.querySelector('.video-post__player') as HTMLElement;
    if (!playerContainer) {
      console.warn('VideoPost: Player container not found', { markerId: this.data.marker.id });
      return undefined;
    }

    try {
      // For non-HD videos, don't pass startTime (intentionally ignored like old version)
      // This allows browser to show first frame naturally
      // Only pass startTime for HD videos (when in HQ mode or explicitly upgrading)
      // For regular marker videos, pass undefined to use simple loading path
      const finalStartTime = this.isHQMode 
        ? (startTime ?? this.data.startTime ?? this.data.marker.seconds)
        : undefined;
      
      // Respect global mute state when creating player
      // Marker previews can have audio, so respect global mute state
      const shouldBeMuted = this.getGlobalMuteState ? this.getGlobalMuteState() : true;
      
      this.player = new NativeVideoPlayer(playerContainer, videoUrl, {
        muted: shouldBeMuted,
        autoplay: false,
        startTime: finalStartTime,
        endTime: endTime ?? this.data.endTime ?? this.data.marker.end_seconds,
        posterUrl: this.getPosterUrl(),
        showLoadingIndicator: false,
      });

      this.isLoaded = true;
      this.hideMediaWhenReady(this.player, playerContainer);

      if (this.visibilityManager && this.data.marker.id) {
        this.visibilityManager.registerPlayer(this.data.marker.id, this.player);
      }

      // Set up periodic error checking (every 3 seconds) to catch blocked requests
      // Clear any existing interval first
      if (this.loadErrorCheckIntervalId) {
        clearInterval(this.loadErrorCheckIntervalId);
      }
      this.loadErrorCheckIntervalId = setInterval(() => {
        if (!this.player || this.hasFailedPermanently) {
          // Stop checking if player is gone or has failed permanently
          if (this.loadErrorCheckIntervalId) {
            clearInterval(this.loadErrorCheckIntervalId);
            this.loadErrorCheckIntervalId = undefined;
          }
          return;
        }
        this.checkForLoadError();
      }, 3000);
    } catch (error) {
      console.error('VideoPost: Failed to create video player', {
        error,
        videoUrl,
        markerId: this.data.marker.id,
      });
      // Don't set isLoaded to true if player creation failed
      return undefined;
    }

    return this.player;
  }

  /**
   * Programmatically set HQ mode (used when feed-level HD is enabled)
   */
  public setHQMode(isHQ: boolean): void {
    this.isHQMode = isHQ;
    if (this.hqButton) {
      this.updateHQButton(this.hqButton);
    }
    this.updateMuteOverlayButton();
  }

  /**
   * Return true if player has been instantiated
   */
  isPlayerLoaded(): boolean {
    return this.isLoaded && !!this.player;
  }

  /**
   * Return true if there is a valid source to preload
   */
  hasVideoSource(): boolean {
    return !!this.data.videoUrl && isValidMediaUrl(this.data.videoUrl);
  }

  /**
   * Preload player using default source/range
   * Handles reloading if player was previously unloaded
   */
  preload(): NativeVideoPlayer | undefined {
    if (!this.hasVideoSource()) {
      return undefined;
    }

    // Show loading indicator when video starts loading
    if (this.videoLoadingIndicator && !this.isLoaded) {
      this.videoLoadingIndicator.style.display = 'flex';
    }

    const player = this.loadPlayer(
      this.data.videoUrl!,
      this.data.startTime ?? this.data.marker.seconds,
      this.data.endTime ?? this.data.marker.end_seconds
    );
    
    return player;
  }


  /**
   * Check if currently in HQ mode (using scene video)
   */
  isInHQMode(): boolean {
    return this.isHQMode;
  }

  /**
   * Register player with visibility manager after upgrade
   * Called by FeedContainer when player is upgraded
   */
  registerPlayerWithVisibilityManager(visibilityManager: VisibilityManager): void {
    if (this.player && this.data.marker.id) {
      visibilityManager.registerPlayer(this.data.marker.id, this.player);
    }
  }

  /**
   * Get the post ID
   */
  getPostId(): string {
    return this.data.marker.id;
  }

  /**
   * Get the container element
   */
  getContainer(): HTMLElement {
    return this.container;
  }

  /**
   * Get the video player instance
   */
  getPlayer(): NativeVideoPlayer | undefined {
    return this.player;
  }

  /**
   * Hide the entire post (used when video fails to load permanently)
   */
  hidePost(): void {
    this.container.style.display = 'none';
    this.hasFailedPermanently = true;
  }

  /**
   * Keep loading visible until the native player reports it can render frames.
   */
  private hideMediaWhenReady(player: NativeVideoPlayer, container: HTMLElement): void {
    const loading = container.querySelector<HTMLElement>('.video-post__loading');

    const hideVisuals = () => {
      if (loading) {
        loading.style.display = 'none';
        // Mark video as ready
        if (this.videoLoadingIndicator) {
          this.videoLoadingIndicator = undefined;
        }
      }
    };

    const scheduleTimeout = globalThis.window?.setTimeout.bind(globalThis.window) ?? setTimeout;
    const clearScheduledTimeout = globalThis.window?.clearTimeout.bind(globalThis.window) ?? clearTimeout;
    const requestFrame = globalThis.window?.requestAnimationFrame?.bind(globalThis.window) ?? ((cb: FrameRequestCallback) => setTimeout(cb, 16));

    const videoElement = player.getVideoElement();
    let revealed = false;

    const cleanup = () => {
      videoElement.removeEventListener('loadeddata', onLoadedData);
      videoElement.removeEventListener('playing', onPlaying);
      videoElement.removeEventListener('timeupdate', onTimeUpdate);
      clearScheduledTimeout(fallbackHandle);
    };

    const reveal = () => {
      if (revealed) {
        return;
      }
      revealed = true;
      cleanup();
      const performHide = () => hideVisuals();
      requestFrame(() => requestFrame(() => performHide()));
    };

    const onLoadedData = () => reveal();
    const onPlaying = () => reveal();
    const onTimeUpdate = () => {
      if (videoElement.currentTime > 0 || videoElement.readyState >= 2) {
        reveal();
      }
    };

    videoElement.addEventListener('loadeddata', onLoadedData, { once: true });
    videoElement.addEventListener('playing', onPlaying, { once: true });
    videoElement.addEventListener('timeupdate', onTimeUpdate);

    const fallbackHandle = scheduleTimeout(() => reveal(), 6000);

    player.waitForReady(4000)
      .catch((error) => {
        console.warn('VideoPost: Player ready wait timed out', {
          error,
          markerId: this.data.marker.id,
        });
      })
      .finally(() => {
        if (videoElement.readyState >= 2) {
          reveal();
        }
      });
  }

  /**
   * Show error placeholder with "Failed to load" text
   */
  private showErrorPlaceholder(): void {
    if (this.errorPlaceholder) {
      // Already showing placeholder
      return;
    }

    const playerContainer = this.playerContainer || this.container.querySelector('.video-post__player') as HTMLElement;
    if (!playerContainer) {
      return;
    }

    // Hide the video player container
    playerContainer.style.display = 'none';

    // Create placeholder element
    const placeholder = document.createElement('div');
    placeholder.className = 'video-post__error-placeholder';
    placeholder.style.backgroundColor = THEME.colors.backgroundSecondary;

    const posterUrl = this.getPosterUrl();
    if (posterUrl) {
      placeholder.style.backgroundImage = `url("${posterUrl}")`;
      placeholder.style.backgroundSize = 'cover';
      placeholder.style.backgroundPosition = 'center';
      placeholder.style.backgroundRepeat = 'no-repeat';
    }

    // Create error text overlay
    const errorText = document.createElement('div');
    errorText.className = 'video-post__error-text';
    errorText.textContent = 'Failed to load';
    placeholder.appendChild(errorText);

    // Insert placeholder before player container
    if (playerContainer.parentNode) {
      playerContainer.parentNode.insertBefore(placeholder, playerContainer);
    }

    this.errorPlaceholder = placeholder;
  }

  /**
   * Hide error placeholder and show video player
   */
  private hideErrorPlaceholder(): void {
    if (this.errorPlaceholder) {
      this.errorPlaceholder.remove();
      this.errorPlaceholder = undefined;
    }

    const playerContainer = this.playerContainer || this.container.querySelector('.video-post__player') as HTMLElement;
    if (playerContainer) {
      playerContainer.style.display = '';
    }
  }

  /**
   * Check if player has a load error and handle it
   */
  public checkForLoadError(): void {
    if (!this.player) {
      return;
    }

    if (this.player.hasLoadError()) {
      const errorType = this.player.getLoadErrorType();
      const error = new Error(`Video load failed: ${errorType || 'unknown'}`);
      // Add errorType property for error handling
      if (errorType) {
        Object.defineProperty(error, 'errorType', {
          value: errorType,
          writable: false,
          enumerable: true,
        });
      }
      this.handleLoadError(error);
    }
  }

  /**
   * Handle video load error with retry logic
   */
  private handleLoadError(error: Error): void {
    this.loadErrorCount++;

    if (this.loadErrorCount >= 5) {
      // Exhausted retries, show placeholder
      this.hasFailedPermanently = true;
      this.showErrorPlaceholder();
      console.warn('VideoPost: Video failed to load after 5 attempts, showing placeholder', {
        markerId: this.data.marker.id,
        error,
        attempts: this.loadErrorCount,
      });
    } else {
      // Schedule retry with exponential backoff
      const delays = [1000, 2000, 4000, 8000, 16000]; // 1s, 2s, 4s, 8s, 16s
      const delay = delays[this.loadErrorCount - 1] || 16000;
      
      console.warn('VideoPost: Video load failed, retrying...', {
        markerId: this.data.marker.id,
        attempt: this.loadErrorCount,
        maxAttempts: 5,
        retryDelay: delay,
        error,
      });

      this.retryTimeoutId = globalThis.setTimeout(() => {
        this.retryLoad();
      }, delay) as unknown as number;
    }
  }

  /**
   * Retry loading the video player
   */
  private retryLoad(): void {
    if (this.hasFailedPermanently) {
      return;
    }

    // Clear current player (this will properly clean up the video element and clear src)
    if (this.player) {
      this.player.destroy();
      this.player = undefined;
    }
    this.isLoaded = false;

    // Hide placeholder if showing (cleanup before retry)
    this.hideErrorPlaceholder();

    // Small delay to ensure cleanup completes and browser releases resources
    // This helps with blocked requests by giving the browser time to clear the connection
    setTimeout(() => {
      // Get video URL and reload
      if (this.hasVideoSource() && this.data.videoUrl) {
        const player = this.loadPlayer(
          this.data.videoUrl,
          this.data.startTime ?? this.data.marker.seconds,
          this.data.endTime ?? this.data.marker.end_seconds
        );
        
        // If retry succeeds, ensure placeholder stays hidden
        if (player) {
          // Placeholder is already hidden, but ensure it stays that way
          this.hideErrorPlaceholder();
        }
      }
    }, 100); // Small delay to allow cleanup
  }

  private async seekPlayerToStart(player: NativeVideoPlayer, startTime: number): Promise<void> {
    const clamped = Number.isFinite(startTime) ? Math.max(0, startTime) : 0;
    const isMobile = isMobileDevice();
    const timeout = isMobile ? 4000 : 2000; // Longer timeout on mobile for HD videos
    
    try {
      await player.waitForReady(timeout);
    } catch (error) {
      console.warn('VideoPost: Player not ready before seeking', {
        error,
        markerId: this.data.marker.id,
      });
    }
    try {
      player.seekTo(clamped);
      
      // On mobile, also re-seek after a short delay and when video starts playing
      // because mobile browsers sometimes reset currentTime when play() is called
      if (isMobile) {
        const videoElement = player.getVideoElement();
        const reSeek = () => {
          if (Math.abs(videoElement.currentTime - clamped) > 0.5) {
            player.seekTo(clamped);
          }
        };
        
        // Re-seek after a short delay
        setTimeout(reSeek, 100);
        
        // Re-seek when video starts playing (mobile browsers may reset on play)
        const onPlaying = () => {
          reSeek();
          videoElement.removeEventListener('playing', onPlaying);
        };
        videoElement.addEventListener('playing', onPlaying, { once: true });
      }
    } catch (error) {
      console.warn('VideoPost: Failed to seek player to marker start', {
        error,
        markerId: this.data.marker.id,
        startTime: clamped,
      });
    }
  }

  /**
   * Create marker creation dialog
   */
  private createMarkerDialog(): HTMLElement {
    const dialog = document.createElement('div');
    dialog.className = 'marker-dialog';
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
    this.markerDialog = dialog;

    // Title
    const title = document.createElement('div');
    title.id = 'marker-dialog-title';
    title.textContent = 'Create Marker';
    title.style.fontSize = '16px';
    title.style.fontWeight = '600';
    title.style.color = THEME.colors.textPrimary;
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
    input.style.background = THEME.colors.surface;
    input.style.border = `1px solid ${THEME.colors.border}`;
    input.style.borderRadius = '8px';
    input.style.color = THEME.colors.textPrimary;
    input.style.fontSize = '14px';
    input.style.boxSizing = 'border-box';
    input.setAttribute('aria-label', 'Tag name');
    this.markerDialogInput = input;

    input.addEventListener('input', () => {
      this.handleMarkerTagInput();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.selectedTagId && this.markerDialogCreateButton && !this.markerDialogCreateButton.disabled) {
        e.preventDefault();
        if (this.isAddTagMode) {
          void this.addTagToMarker();
        } else {
          void this.createMarker();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.closeMarkerDialog();
      }
    });

    inputWrapper.appendChild(input);

    // Suggestions dropdown
    const suggestions = document.createElement('div');
    suggestions.className = 'marker-dialog__suggestions';
    suggestions.style.display = 'none';
    suggestions.style.position = 'absolute';
    suggestions.style.top = '100%';
    suggestions.style.left = '0';
    suggestions.style.right = '0';
    suggestions.style.background = THEME.colors.backgroundSecondary;
    suggestions.style.border = `1px solid ${THEME.colors.border}`;
    suggestions.style.borderTop = 'none';
    suggestions.style.borderRadius = '0 0 8px 8px';
    suggestions.style.maxHeight = '200px';
    suggestions.style.overflowY = 'auto';
    suggestions.style.zIndex = '201';
    suggestions.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.3)';
    this.markerDialogSuggestions = suggestions;
    inputWrapper.appendChild(suggestions);

    dialog.appendChild(inputWrapper);

    // Recent tags section
    const recentSection = document.createElement('div');
    recentSection.className = 'marker-dialog__recent';
    recentSection.style.marginBottom = '12px';
    const recentTitle = document.createElement('div');
    recentTitle.textContent = 'Recent tags';
    recentTitle.style.fontSize = '12px';
    recentTitle.style.fontWeight = '500';
    recentTitle.style.color = THEME.colors.textMuted;
    recentTitle.style.marginBottom = '8px';
    recentSection.appendChild(recentTitle);
    const recentTags = document.createElement('div');
    recentTags.style.display = 'none'; // Hidden by default, shown when tags are loaded
    recentTags.style.flexWrap = 'wrap';
    recentTags.style.gap = '6px';
    this.markerDialogRecentTags = recentTags;
    recentSection.appendChild(recentTags);
    dialog.appendChild(recentSection);

    // Buttons
    const buttons = document.createElement('div');
    buttons.style.display = 'flex';
    buttons.style.gap = '8px';
    buttons.style.justifyContent = 'flex-end';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.padding = '8px 16px';
    cancelBtn.style.background = THEME.colors.backgroundSecondary;
    cancelBtn.style.border = `1px solid ${THEME.colors.border}`;
    cancelBtn.style.color = THEME.colors.textSecondary;
    cancelBtn.style.fontSize = '14px';
    cancelBtn.style.cursor = 'pointer';
    cancelBtn.addEventListener('click', () => this.closeMarkerDialog());
    buttons.appendChild(cancelBtn);

    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.id = 'marker-dialog-action-button';
    createBtn.textContent = 'Create';
    createBtn.disabled = true;
    createBtn.style.padding = '8px 16px';
    createBtn.style.background = THEME.colors.accentPrimary;
    createBtn.style.border = `1px solid ${THEME.colors.accentPrimary}`;
    createBtn.style.color = THEME.colors.textPrimary;
    createBtn.style.fontSize = '14px';
    createBtn.style.cursor = 'not-allowed';
    createBtn.style.transition = 'all 0.2s ease';
    createBtn.addEventListener('click', () => {
      if (this.isAddTagMode) {
        void this.addTagToMarker();
      } else {
        void this.createMarker();
      }
    });
    this.markerDialogCreateButton = createBtn;
    buttons.appendChild(createBtn);

    dialog.appendChild(buttons);

    return dialog;
  }

  /**
   * Open marker dialog
   */
  private openMarkerDialog(mode: 'create' | 'add' = 'create'): void {
    if (!this.markerDialog) {
      // Find button group from either marker button or add tag button
      const buttonGroup = (this.markerButton || this.addTagButton)?.parentElement;
      if (!buttonGroup) return;
      const dialog = this.createMarkerDialog();
      buttonGroup.style.position = 'relative';
      buttonGroup.appendChild(dialog);
    }
    if (this.isMarkerDialogOpen) return;

    this.isAddTagMode = mode === 'add';
    this.isMarkerDialogOpen = true;
    this.selectedTagId = undefined;
    this.selectedTagName = undefined;
    if (this.markerDialogInput) {
      this.markerDialogInput.value = '';
    }
    
    // Update dialog title and button text based on mode
    const title = this.markerDialog?.querySelector('#marker-dialog-title');
    const actionButton = this.markerDialog?.querySelector('#marker-dialog-action-button') as HTMLButtonElement;
    if (title) {
      title.textContent = this.isAddTagMode ? 'Add Tag' : 'Create Marker';
    }
    if (actionButton) {
      actionButton.textContent = this.isAddTagMode ? 'Add' : 'Create';
    }
    
    this.updateMarkerDialogState();
    this.loadRecentTags();

    if (this.markerDialog) {
      this.markerDialog.hidden = false;
      this.markerDialog.setAttribute('aria-hidden', 'false');
      this.markerDialog.style.opacity = '1';
      this.markerDialog.style.transform = 'translateX(-50%) translateY(0) scale(1)';
      this.markerDialog.style.pointerEvents = 'auto';
      
      // Adjust position to keep dialog within card boundaries
      requestAnimationFrame(() => {
        this.adjustDialogPosition(this.markerDialog!);
      });
    }

    document.addEventListener('mousedown', this.onMarkerDialogOutsideClick);
    document.addEventListener('touchstart', this.onMarkerDialogOutsideClick);
    document.addEventListener('keydown', this.onMarkerDialogKeydown);

    // Focus input
    requestAnimationFrame(() => {
      this.markerDialogInput?.focus();
    });
  }

  /**
   * Close marker dialog
   */
  private closeMarkerDialog(): void {
    if (!this.isMarkerDialogOpen) return;
    this.isMarkerDialogOpen = false;

    // Clean up loading state and timers
    if (this.autocompleteDebounceTimer) {
      clearTimeout(this.autocompleteDebounceTimer);
      this.autocompleteDebounceTimer = undefined;
    }
    if (this.tagSearchLoadingTimer) {
      clearTimeout(this.tagSearchLoadingTimer);
      this.tagSearchLoadingTimer = undefined;
    }
    this.clearTagSuggestionsLoading();

    if (this.markerDialog) {
      this.markerDialog.style.opacity = '0';
      this.markerDialog.style.transform = 'translateX(-50%) translateY(4px) scale(0.96)';
      this.markerDialog.style.pointerEvents = 'none';
      setTimeout(() => {
        if (this.markerDialog && !this.isMarkerDialogOpen) {
          this.markerDialog.hidden = true;
          this.markerDialog.setAttribute('aria-hidden', 'true');
        }
      }, 200);
    }

    if (this.markerDialogSuggestions) {
      this.markerDialogSuggestions.style.display = 'none';
    }

    document.removeEventListener('mousedown', this.onMarkerDialogOutsideClick);
    document.removeEventListener('touchstart', this.onMarkerDialogOutsideClick);
    document.removeEventListener('keydown', this.onMarkerDialogKeydown);
  }

  /**
   * Handle clicks outside marker dialog
   */
  private readonly onMarkerDialogOutsideClick = (event: Event): void => {
    if (!this.isMarkerDialogOpen || !this.markerDialog) return;
    const target = event.target as Node | null;
    if (target && this.markerDialog.contains(target)) {
      return;
    }
    this.closeMarkerDialog();
  };

  /**
   * Handle keyboard events for marker dialog
   */
  private readonly onMarkerDialogKeydown = (event: KeyboardEvent): void => {
    if (!this.isMarkerDialogOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeMarkerDialog();
      this.markerButton?.focus();
    }
  };

  /**
   * Handle tag input for autocomplete
   */
  private handleMarkerTagInput(): void {
    if (!this.markerDialogInput) return;

    const searchTerm = this.markerDialogInput.value.trim();
    this.selectedTagId = undefined;
    this.selectedTagName = undefined;
    this.updateMarkerDialogState();

    // Clear any existing timers
    if (this.autocompleteDebounceTimer) {
      clearTimeout(this.autocompleteDebounceTimer);
    }
    if (this.tagSearchLoadingTimer) {
      clearTimeout(this.tagSearchLoadingTimer);
      this.tagSearchLoadingTimer = undefined;
    }

    if (searchTerm.length === 0) {
      // Clear loading state and hide suggestions
      this.clearTagSuggestionsLoading();
      if (this.markerDialogSuggestions) {
        this.markerDialogSuggestions.style.display = 'none';
      }
      return;
    }

    this.autocompleteDebounceTimer = setTimeout(() => {
      void this.searchTagsForMarker(searchTerm);
    }, 250);
  }

  /**
   * Show loading state in tag suggestions dropdown
   */
  private showTagSuggestionsLoading(): void {
    if (!this.markerDialogSuggestions || this.isTagSearchLoading) return;

    this.isTagSearchLoading = true;
    this.markerDialogSuggestions.innerHTML = '';
    this.markerDialogSuggestions.style.display = 'block';

    // Show simple loading text
    const loadingItem = document.createElement('div');
    loadingItem.style.width = '100%';
    loadingItem.style.padding = '10px 12px';
    loadingItem.style.display = 'flex';
    loadingItem.style.alignItems = 'center';
    loadingItem.style.color = THEME.colors.textSecondary;
    loadingItem.style.fontSize = '14px';
    loadingItem.textContent = 'Loading tags...';
    
    this.markerDialogSuggestions.appendChild(loadingItem);
  }

  /**
   * Clear loading from tag suggestions dropdown
   */
  private clearTagSuggestionsLoading(): void {
    if (!this.markerDialogSuggestions) return;

    this.markerDialogSuggestions.innerHTML = '';
    this.isTagSearchLoading = false;
  }

  /**
   * Search tags for marker creation (using faster searchMarkerTags API)
   */
  private async searchTagsForMarker(searchTerm: string): Promise<void> {
    if (!this.api || !this.markerDialogSuggestions) return;

    // Clear any existing loading state from previous search
    this.clearTagSuggestionsLoading();

    // Show loading state if search takes longer than 200ms
    this.tagSearchLoadingTimer = setTimeout(() => {
      if (!this.isTagSearchLoading) {
        this.showTagSuggestionsLoading();
      }
    }, 200);

    try {
      // Use searchMarkerTags which is much faster than findTagsForSelect
      const tags = await this.api.searchMarkerTags(searchTerm, 20);
      
      // Clear loading timer if it hasn't fired yet
      if (this.tagSearchLoadingTimer) {
        clearTimeout(this.tagSearchLoadingTimer);
        this.tagSearchLoadingTimer = undefined;
      }
      
      // Clear any loading state that was shown
      this.clearTagSuggestionsLoading();
      
      this.displayTagSuggestions(tags);
    } catch (error) {
      console.error('Failed to search tags', error);
      // Clear loading on error
      if (this.tagSearchLoadingTimer) {
        clearTimeout(this.tagSearchLoadingTimer);
        this.tagSearchLoadingTimer = undefined;
      }
      this.clearTagSuggestionsLoading();
    }
  }

  /**
   * Display tag suggestions in dropdown
   */
  private displayTagSuggestions(tags: Array<{ id: string; name: string }>): void {
    if (!this.markerDialogSuggestions) return;

    // Clear any loading state first
    this.clearTagSuggestionsLoading();

    this.markerDialogSuggestions.innerHTML = '';
    this.markerDialogSuggestions.style.display = tags.length > 0 ? 'block' : 'none';

    if (tags.length === 0) {
      const noResults = document.createElement('div');
      noResults.textContent = 'No tags found';
      noResults.style.padding = '12px';
      noResults.style.color = THEME.colors.textMuted;
      noResults.style.fontSize = '14px';
      this.markerDialogSuggestions.appendChild(noResults);
      return;
    }

    for (const tag of tags) {
      const item = document.createElement('button');
      item.type = 'button';
      item.textContent = tag.name;
      item.style.width = '100%';
      item.style.padding = '10px 12px';
      item.style.textAlign = 'left';
      item.style.background = 'transparent';
      item.style.border = 'none';
      item.style.color = THEME.colors.textPrimary;
      item.style.fontSize = '14px';
      item.style.cursor = 'pointer';
      item.style.transition = 'background 0.15s ease';

      item.addEventListener('mouseenter', () => {
        item.style.background = THEME.colors.backgroundSecondary;
      });
      item.addEventListener('mouseleave', () => {
        item.style.background = 'transparent';
      });

      item.addEventListener('click', () => {
        this.selectTagForMarker(tag.id, tag.name);
      });

      if (this.markerDialogSuggestions) {
        this.markerDialogSuggestions.appendChild(item);
      }
    }
  }

  /**
   * Select tag for marker creation
   */
  private selectTagForMarker(tagId: string, tagName: string): void {
    this.selectedTagId = tagId;
    this.selectedTagName = tagName;
    if (this.markerDialogInput) {
      this.markerDialogInput.value = tagName;
    }
    if (this.markerDialogSuggestions) {
      this.markerDialogSuggestions.style.display = 'none';
    }
    this.updateMarkerDialogState();
    this.addToRecentTags(tagId, tagName);

    if (this.isAddTagMode) {
      void this.addTagToMarker();
    }
  }

  /**
   * Update marker dialog state (enable/disable create button)
   */
  private updateMarkerDialogState(): void {
    if (!this.markerDialogCreateButton) return;

    const hasTag = !!this.selectedTagId;
    this.markerDialogCreateButton.disabled = !hasTag;

    if (hasTag) {
      this.markerDialogCreateButton.style.background = THEME.colors.accentPrimary;
      this.markerDialogCreateButton.style.borderColor = THEME.colors.accentPrimary;
      this.markerDialogCreateButton.style.color = THEME.colors.textPrimary;
      this.markerDialogCreateButton.style.cursor = 'pointer';
    } else {
      this.markerDialogCreateButton.style.background = THEME.colors.accentPrimary;
      this.markerDialogCreateButton.style.borderColor = THEME.colors.accentPrimary;
      this.markerDialogCreateButton.style.color = THEME.colors.textMuted;
      this.markerDialogCreateButton.style.cursor = 'not-allowed';
    }
  }

  /**
   * Load recent tags from localStorage
   */
  private loadRecentTags(): void {
    if (!this.markerDialogRecentTags) return;

    try {
      const stored = localStorage.getItem('stashgifs-recent-marker-tags');
      if (!stored) return;

      let recentTags: Array<{ id: string; name: string }> = [];
      try {
        recentTags = JSON.parse(stored) as Array<{ id: string; name: string }>;
      } catch (error) {
        console.warn('Failed to parse recent tags from localStorage', error);
        return;
      }
      this.markerDialogRecentTags.innerHTML = '';

      if (recentTags.length === 0) {
        if (this.markerDialogRecentTags) {
          this.markerDialogRecentTags.style.display = 'none';
        }
        // Hide the entire recent section if no tags
        const recentSection = this.markerDialogRecentTags?.parentElement;
        if (recentSection) {
          recentSection.style.display = 'none';
        }
        return;
      }

      // Show recent section and tags
      const recentSection = this.markerDialogRecentTags?.parentElement;
      if (recentSection) {
        recentSection.style.display = 'block';
      }
      this.markerDialogRecentTags.style.display = 'flex';
      for (const tag of recentTags) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.textContent = tag.name;
        chip.style.padding = '6px 12px';
        chip.style.background = THEME.colors.backgroundSecondary;
        chip.style.border = `1px solid ${THEME.colors.border}`;
        chip.style.borderRadius = THEME.radius.tag;
        chip.style.color = THEME.colors.textPrimary;
        chip.style.fontSize = THEME.typography.sizeMeta;
        chip.style.cursor = 'pointer';
        chip.style.transition = 'all 0.15s ease';

        chip.addEventListener('mouseenter', () => {
          chip.style.background = THEME.colors.surfaceHover;
          chip.style.borderColor = THEME.colors.border;
        });
        chip.addEventListener('mouseleave', () => {
          chip.style.background = THEME.colors.backgroundSecondary;
          chip.style.borderColor = THEME.colors.border;
        });
        chip.addEventListener('mouseleave', () => {
          chip.style.background = THEME.colors.backgroundSecondary;
          chip.style.borderColor = THEME.colors.border;
        });

        chip.addEventListener('click', () => {
          this.selectTagForMarker(tag.id, tag.name);
        });

        if (this.markerDialogRecentTags) {
          this.markerDialogRecentTags.appendChild(chip);
        }
      }
    } catch (error) {
      console.error('Failed to load recent tags', error);
    }
  }

  /**
   * Add tag to recent tags cache
   */
  private addToRecentTags(tagId: string, tagName: string): void {
    try {
      const stored = localStorage.getItem('stashgifs-recent-marker-tags');
      let recentTags: Array<{ id: string; name: string }> = [];
      if (stored) {
        try {
          recentTags = JSON.parse(stored) as Array<{ id: string; name: string }>;
        } catch (error) {
          console.warn('Failed to parse recent tags from localStorage', error);
          recentTags = [];
        }
      }

      // Remove if already exists
      recentTags = recentTags.filter(t => t.id !== tagId);

      // Add to beginning
      recentTags.unshift({ id: tagId, name: tagName });

      // Limit to 20
      recentTags = recentTags.slice(0, 20);

      localStorage.setItem('stashgifs-recent-marker-tags', JSON.stringify(recentTags));
    } catch (error) {
      console.error('Failed to save recent tags', error);
    }
  }

  /**
   * Create marker at current random start time
   */
  private async createMarker(): Promise<void> {
    if (!this.api || !this.selectedTagId || !this.selectedTagName) return;
    if (!this.markerDialogCreateButton) return;

    const startTime = this.data.startTime ?? 0;
    // Ensure sceneId is a valid string (GraphQL ID type requires string)
    const sceneIdRaw = this.data.marker.scene?.id;
    if (!sceneIdRaw) {
      console.error('Failed to create marker: scene ID is missing', this.data.marker);
      showToast('Failed to create marker: scene information is missing.');
      return;
    }
    const sceneId = String(sceneIdRaw);

    // Pause all videos and cancel pending requests before creating marker
    if (this.visibilityManager) {
      this.visibilityManager.pauseAllVideos();
    }
    if (this.onCancelRequests) {
      this.onCancelRequests();
    }

    this.markerDialogCreateButton.disabled = true;
    this.markerDialogCreateButton.textContent = 'Creating...';
    this.markerDialogCreateButton.style.opacity = '0.6';

    try {
      // Find or create the "StashGifs Marker" tag
      let markerTagId: string | null = null;
      try {
        const existingMarkerTag = await this.api.findTagByName(MARKER_TAG_NAME);
        if (existingMarkerTag) {
          markerTagId = existingMarkerTag.id;
        } else {
          const newMarkerTag = await this.api.createTag(MARKER_TAG_NAME);
          markerTagId = newMarkerTag?.id || null;
        }
      } catch (error) {
        console.warn('VideoPost: Failed to get marker tag, continuing without it', error);
      }

      // Include marker tag in tagIds if we got it
      const tagIds = markerTagId ? [String(markerTagId)] : [];

      // Ensure all IDs are strings for GraphQL
      const primaryTagId = String(this.selectedTagId);

      // Create the marker and capture the returned data
      const createdMarker = await this.api.createSceneMarker(
        sceneId,
        startTime,
        primaryTagId,
        '',
        null,
        tagIds
      );

      // Update this.data.marker with the real marker data from GraphQL
      // This ensures the favorite button works with the real marker ID
      if (createdMarker) {
        // Preserve the existing scene data structure and merge with any new data
        const existingScene = this.data.marker.scene;
        this.data.marker = {
          id: createdMarker.id, // Real marker ID (replaces synthetic ID)
          title: createdMarker.title,
          seconds: createdMarker.seconds,
          end_seconds: createdMarker.end_seconds,
          stream: createdMarker.stream,
          preview: createdMarker.preview,
          primary_tag: createdMarker.primary_tag,
          tags: createdMarker.tags || [],
          scene: {
            ...existingScene, // Preserve existing scene data
            ...createdMarker.scene, // Merge in any new scene data from the response
            // Ensure files array matches SceneFile type if present
            files: createdMarker.scene.files ? createdMarker.scene.files.map((f: { width?: number; height?: number; path?: string }) => ({
              id: '', // GraphQL response doesn't include file id
              path: f.path || '',
              width: f.width,
              height: f.height,
            })) : existingScene.files,
          } as Scene,
        };
      }

      showToast(`Marker created with tag "${this.selectedTagName}"`);
      this.hasCreatedMarker = true;
      // Refresh header to show the newly assigned tag as a chip
      this.refreshHeader();
      this.replaceMarkerButtonWithHeart();
      // Check favorite status after updating marker data to refresh UI
      await this.checkFavoriteStatus();
      this.closeMarkerDialog();
      // Videos will resume naturally via visibility manager when they become visible again
    } catch (error) {
      console.error('Failed to create marker', error);
      showToast('Failed to create marker. Please try again.');
      this.markerDialogCreateButton.disabled = false;
      this.markerDialogCreateButton.textContent = 'Create';
      this.markerDialogCreateButton.style.opacity = '1';
      // Videos will resume naturally via visibility manager when they become visible again
    }
  }

  /**
   * Open add tag dialog
   */
  protected openAddTagDialog(): void {
    this.openMarkerDialog('add');
  }

  protected async removeTagAction(tagId: string, tagName: string): Promise<boolean> {
    const api = this.api;
    if (!api) {
      showToast('API not available.');
      return false;
    }

    if (this.isShortFormContent()) {
      return this.removeTagFromScene(api, tagId, tagName);
    }

    if (!this.isRealMarker()) {
      showToast('Cannot remove tag from synthetic marker. Please create the marker first.');
      return false;
    }

    return this.removeTagFromMarker(api, tagId, tagName);
  }

  private async removeTagFromScene(api: StashAPI, tagId: string, tagName: string): Promise<boolean> {
    const sceneId = this.data.marker.scene?.id;
    if (!sceneId) {
      showToast('Scene ID not available.');
      return false;
    }

    const currentTagIds = (this.data.marker.scene.tags || [])
      .map((tag) => tag.id)
      .filter((id): id is string => id !== null && id !== undefined)
      .map(String);
    if (!currentTagIds.includes(String(tagId))) {
      showToast(`Tag "${tagName}" is not on this scene.`);
      return false;
    }

    try {
      await api.removeTagFromScene(sceneId, tagId);
      this.data.marker.scene.tags = (this.data.marker.scene.tags || []).filter((tag) => String(tag.id) !== String(tagId));
      showToast(`Tag "${tagName}" removed from scene`);
      this.refreshHeader();
      return true;
    } catch (error) {
      console.error('Failed to remove tag from scene', error);
      showToast('Failed to remove tag. Please try again.');
      return false;
    }
  }

  private async removeTagFromMarker(api: StashAPI, tagId: string, tagName: string): Promise<boolean> {
    const primaryTagId = this.data.marker.primary_tag?.id;
    if (primaryTagId && String(primaryTagId) === String(tagId)) {
      const availableTags = (this.data.marker.tags || []).filter((tag) => tag.id);
      if (availableTags.length === 0) {
        showToast('Add another tag before removing the primary tag.');
        return false;
      }

      const nextPrimary = availableTags[0];
      const remainingTags = availableTags.filter((tag) => String(tag.id) !== String(nextPrimary.id));
      const remainingTagIds = remainingTags.map((tag) => String(tag.id));

      try {
        await api.updateMarkerTagsWithPrimary(this.data.marker, String(nextPrimary.id), remainingTagIds);
        this.data.marker.primary_tag = { id: String(nextPrimary.id), name: nextPrimary.name };
        this.data.marker.tags = remainingTags;
        showToast(`Primary tag changed to "${nextPrimary.name}"`);
        this.refreshHeader();
        return true;
      } catch (error) {
        console.error('Failed to remove primary tag from marker', error);
        showToast('Failed to remove tag. Please try again.');
        return false;
      }
    }

    const currentTagIds = (this.data.marker.tags || [])
      .map((tag) => tag.id)
      .filter((id): id is string => id !== null && id !== undefined)
      .map(String);
    if (!currentTagIds.includes(String(tagId))) {
      showToast(`Tag "${tagName}" is not on this marker.`);
      return false;
    }

    try {
      await api.removeTagFromMarker(this.data.marker, tagId);
      this.data.marker.tags = (this.data.marker.tags || []).filter((tag) => String(tag.id) !== String(tagId));
      showToast(`Tag "${tagName}" removed from marker`);
      this.refreshHeader();
      return true;
    } catch (error) {
      console.error('Failed to remove tag from marker', error);
      showToast('Failed to remove tag. Please try again.');
      return false;
    }
  }

  protected async removePerformerAction(performerId: string, performerName: string): Promise<boolean> {
    if (!this.api) {
      showToast('API not available.');
      return false;
    }

    const sceneId = this.data.marker.scene?.id;
    if (!sceneId) {
      showToast('Scene ID not available.');
      return false;
    }

    const currentPerformerIds = (this.data.marker.scene.performers || [])
      .map((performer) => performer.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    if (!currentPerformerIds.includes(performerId)) {
      showToast(`Performer "${performerName}" is not on this scene.`);
      return false;
    }

    try {
      const nextPerformerIds = currentPerformerIds.filter((id) => id !== performerId);
      await this.api.updateScenePerformers(sceneId, nextPerformerIds);

      this.data.marker.scene.performers = (this.data.marker.scene.performers || []).filter(
        (performer) => performer.id !== performerId
      );
      showToast(`Performer "${performerName}" removed from scene`);
      this.refreshHeader();
      return true;
    } catch (error) {
      console.error('Failed to remove performer from scene', error);
      showToast('Failed to remove performer. Please try again.');
      return false;
    }
  }

  /**
   * Add tag to existing marker or scene (for shortform content)
   */
  private async addTagToMarker(): Promise<void> {
    if (!this.api || !this.selectedTagId || !this.selectedTagName) return;
    if (!this.markerDialogCreateButton) return;

    const isShortForm = this.isShortFormContent();

    // For shortform content, add tag to scene
    if (isShortForm) {
      if (!this.data.marker.scene?.id) {
        showToast('Scene ID not available.');
        return;
      }

      this.markerDialogCreateButton.disabled = true;
      this.markerDialogCreateButton.textContent = 'Adding...';
      this.markerDialogCreateButton.style.opacity = '0.6';

      try {
        // Check if tag is already added to scene
        const currentTagIds = (this.data.marker.scene.tags || []).map(t => t.id).filter(Boolean);
        if (currentTagIds.includes(this.selectedTagId)) {
          showToast(`Tag "${this.selectedTagName}" is already added to this scene.`);
          this.markerDialogCreateButton.disabled = false;
          this.markerDialogCreateButton.textContent = 'Add';
          this.markerDialogCreateButton.style.opacity = '1';
          return;
        }

        // Add tag to scene
        await this.api.addTagToScene(this.data.marker.scene.id, this.selectedTagId);

        // Update local scene tags
        this.data.marker.scene.tags ??= [];
        
        // Add tag to local data (we already have the name from selectedTagName)
        this.data.marker.scene.tags.push({ id: this.selectedTagId, name: this.selectedTagName });

        showToast(`Tag "${this.selectedTagName}" added to scene`);
        
        // Refresh header to show new tag chip
        this.refreshHeader();
        
        this.closeMarkerDialog();
      } catch (error) {
        console.error('Failed to add tag to scene', error);
        showToast('Failed to add tag. Please try again.');
        this.markerDialogCreateButton.disabled = false;
        this.markerDialogCreateButton.textContent = 'Add';
        this.markerDialogCreateButton.style.opacity = '1';
      }
      return;
    }

    // For regular markers, validate marker has real ID (not synthetic)
    if (!this.isRealMarker()) {
      showToast('Cannot add tag to synthetic marker. Please create the marker first.');
      return;
    }

    this.markerDialogCreateButton.disabled = true;
    this.markerDialogCreateButton.textContent = 'Adding...';
    this.markerDialogCreateButton.style.opacity = '0.6';

    try {
      // Check if tag is already added
      const currentTagIds = (this.data.marker.tags || []).map(t => t.id);
      if (currentTagIds.includes(this.selectedTagId)) {
        showToast(`Tag "${this.selectedTagName}" is already added to this marker.`);
        this.markerDialogCreateButton.disabled = false;
        this.markerDialogCreateButton.textContent = 'Add';
        this.markerDialogCreateButton.style.opacity = '1';
        return;
      }

      // Add tag to marker
      await this.api.addTagToMarker(this.data.marker, this.selectedTagId);

      // Update local marker tags
      this.data.marker.tags ??= [];
      
      // Add tag to local data (we already have the name from selectedTagName)
      this.data.marker.tags.push({ id: this.selectedTagId, name: this.selectedTagName });

      showToast(`Tag "${this.selectedTagName}" added to marker`);
      
      // Refresh header to show new tag chip
      this.refreshHeader();
      
      this.closeMarkerDialog();
    } catch (error) {
      console.error('Failed to add tag to marker', error);
      showToast('Failed to add tag. Please try again.');
      this.markerDialogCreateButton.disabled = false;
      this.markerDialogCreateButton.textContent = 'Add';
      this.markerDialogCreateButton.style.opacity = '1';
    }
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
    
    // Find button group from either marker button or add tag button
    const buttonGroup = (this.markerButton || this.addTagButton)?.parentElement;
    if (!buttonGroup) return;
    
    const buttonGroupRect = buttonGroup.getBoundingClientRect();
    
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
   * Destroy the post and clean up all resources
   */
  destroy(): void {
    // Clear any pending retry
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
      this.retryTimeoutId = undefined;
    }

    // Clear error check interval
    if (this.loadErrorCheckIntervalId) {
      clearInterval(this.loadErrorCheckIntervalId);
      this.loadErrorCheckIntervalId = undefined;
    }

    // Remove error placeholder if exists
    if (this.errorPlaceholder) {
      this.errorPlaceholder.remove();
      this.errorPlaceholder = undefined;
    }


    // Destroy player
    if (this.player) {
      this.player.destroy();
      this.player = undefined;
    }

    // Close rating dialog if open and clean up listeners
    if (this.isRatingDialogOpen) {
      this.closeRatingDialog();
    } else {
      // Ensure listeners are removed even if dialog wasn't open
      this.detachRatingGlobalListeners();
    }

    // Remove all hover effect listeners
    for (const [button] of this.hoverHandlers) {
      this.removeHoverEffect(button);
    }
    this.hoverHandlers.clear();

    // Remove container from DOM
    this.container.remove();
  }
}
