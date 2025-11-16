/**
 * Video Post Component
 * Individual video post card in the feed
 */

import { VideoPostData, Scene } from './types.js';
import { NativeVideoPlayer } from './NativeVideoPlayer.js';
import { FavoritesManager } from './FavoritesManager.js';
import { StashAPI } from './StashAPI.js';
import { VisibilityManager } from './VisibilityManager.js';
import { calculateAspectRatio, getAspectRatioClass, isValidMediaUrl, showToast, throttle, toAbsoluteUrl } from './utils.js';
import { posterPreloader } from './PosterPreloader.js';

// Constants for magic numbers and strings
const FAVORITE_TAG_NAME = 'StashGifs Favorite';
const MARKER_TAG_NAME = 'StashGifs Marker';
const RATING_MAX_STARS = 10;
const RATING_MIN_STARS = 0;
const RATING_DIALOG_MAX_WIDTH = 900;
const RATING_DIALOG_MIN_WIDTH = 160;
const OCOUNT_DIGIT_WIDTH_PX = 8; // Approximate pixels per digit for 14px font
const OCOUNT_MIN_WIDTH_PX = 14;
const OCOUNT_THREE_DIGIT_PADDING = 10;
const OCOUNT_DEFAULT_PADDING = 8;
const RESIZE_THROTTLE_MS = 100;

// SVG Constants
const HEART_SVG_OUTLINE = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
</svg>`;

const HEART_SVG_FILLED = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
</svg>`;

const HQ_SVG_OUTLINE = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="4" y="6" width="16" height="12" rx="2"/>
  <path d="M8 10h8M8 14h8" stroke-width="1.5"/>
  <text x="12" y="15" font-size="7" font-weight="bold" fill="currentColor" text-anchor="middle" font-family="Arial, sans-serif">HD</text>
</svg>`;

const HQ_SVG_FILLED = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
  <rect x="4" y="6" width="16" height="12" rx="2"/>
  <text x="12" y="15" font-size="7" font-weight="bold" fill="white" text-anchor="middle" font-family="Arial, sans-serif">HD</text>
</svg>`;

const PLAY_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

const MARKER_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
const ADD_TAG_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

const STAR_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" focusable="false">
  <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.62L12 2 9.19 8.62 2 9.24l5.46 4.73L5.82 21z"/>
</svg>`;

interface HoverHandlers {
  mouseenter: () => void;
  mouseleave: () => void;
}

export class VideoPost {
  private container: HTMLElement;
  private data: VideoPostData;
  private player?: NativeVideoPlayer;
  private isLoaded: boolean = false;
  private favoritesManager?: FavoritesManager;
  private api?: StashAPI;
  private visibilityManager?: VisibilityManager;
  private heartButton?: HTMLElement;
  private markerButton?: HTMLElement;
  private addTagButton?: HTMLElement;
  private oCountButton?: HTMLElement;
  private hqButton?: HTMLElement;
  private playButton?: HTMLElement;
  private isFavorite: boolean = false;
  private oCount: number = 0;
  private isHQMode: boolean = false;
  private ratingValue: number = 0;
  private hasRating: boolean = false;
  private ratingWrapper?: HTMLElement;
  private ratingDisplayButton?: HTMLButtonElement;
  private ratingDisplayValue?: HTMLElement;
  private ratingDialog?: HTMLElement;
  private ratingStarButtons: HTMLButtonElement[] = [];
  private isRatingDialogOpen: boolean = false;
  private isSavingRating: boolean = false;
  private isTogglingFavorite: boolean = false;
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
  
  // Event handlers for cleanup
  private ratingOutsideClickHandler = (event: Event) => this.onRatingOutsideClick(event);
  private ratingKeydownHandler = (event: KeyboardEvent) => this.onRatingKeydown(event);
  private ratingResizeHandler: () => void;
  private hoverHandlers: Map<HTMLElement, HoverHandlers> = new Map();
  
  // Cached DOM elements
  private playerContainer?: HTMLElement;
  private footer?: HTMLElement;
  private buttonGroup?: HTMLElement;

  private onPerformerChipClick?: (performerId: number, performerName: string) => void;
  private onTagChipClick?: (tagId: number, tagName: string) => void;
  private onCancelRequests?: () => void; // Callback to cancel pending requests

  private useShuffleMode: boolean = false;

  constructor(
    container: HTMLElement, 
    data: VideoPostData, 
    favoritesManager?: FavoritesManager, 
    api?: StashAPI, 
    visibilityManager?: VisibilityManager,
    onPerformerChipClick?: (performerId: number, performerName: string) => void,
    onTagChipClick?: (tagId: number, tagName: string) => void,
    useShuffleMode?: boolean,
    onCancelRequests?: () => void
  ) {
    this.container = container;
    this.data = data;
    this.favoritesManager = favoritesManager;
    this.api = api;
    this.visibilityManager = visibilityManager;
    this.onPerformerChipClick = onPerformerChipClick;
    this.onTagChipClick = onTagChipClick;
    this.useShuffleMode = useShuffleMode || false;
    this.onCancelRequests = onCancelRequests;
    this.oCount = this.data.marker.scene.o_counter || 0;
    this.ratingValue = this.convertRating100ToStars(this.data.marker.scene.rating100);
    this.hasRating = typeof this.data.marker.scene.rating100 === 'number' && !Number.isNaN(this.data.marker.scene.rating100);
    
    // Throttle resize handler for performance
    this.ratingResizeHandler = throttle(() => this.syncRatingDialogLayout(), RESIZE_THROTTLE_MS);

    this.render();
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
    this.container.className = 'video-post';
    this.container.dataset.postId = this.data.marker.id;
    // Clear container efficiently
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }

    // Header with performers and tags
    const header = this.createHeader();
    this.container.appendChild(header);

    // Player container
    const playerContainer = this.createPlayerContainer();
    this.container.appendChild(playerContainer);
    this.playerContainer = playerContainer;

    // Footer with buttons and rating
    const footer = this.createFooter();
    this.container.appendChild(footer);
    this.footer = footer;
  }


  /**
   * Create the player container with loading indicator
   */
  private createPlayerContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'video-post__player';
    container.style.position = 'relative';

    // Calculate aspect ratio
    let aspectRatioClass = 'aspect-16-9';
    if (this.data.marker.scene.files && this.data.marker.scene.files.length > 0) {
      const file = this.data.marker.scene.files[0];
      if (file && file.width && file.height) {
        const ratio = calculateAspectRatio(file.width, file.height);
        aspectRatioClass = getAspectRatioClass(ratio);
      }
    }
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
   * Get poster URL for the video
   * Prefers marker preview, then scene preview/webp, then scene screenshot
   */
  private getPosterUrl(): string | undefined {
    const m = this.data.marker;
    // Skip synthetic markers - they don't have screenshots in Stash
    const markerId = m?.id;
    if (markerId && typeof markerId === 'string' && markerId.startsWith('synthetic-')) {
      // For synthetic markers, use scene preview/webp/screenshot as fallback
      const p = m?.scene?.paths?.preview || m?.scene?.paths?.webp || m?.scene?.paths?.screenshot;
      if (!p) return undefined;
      const baseUrl = toAbsoluteUrl(p);
      if (!baseUrl) return undefined;
      const separator = baseUrl.includes('?') ? '&' : '?';
      return `${baseUrl}${separator}t=${Date.now()}`;
    }
    // Prefer preloaded poster from batch prefetch (commit parity)
    const cached = posterPreloader.getPosterForMarker(m);
    if (cached) return cached;
    // Fallbacks if not preloaded
    const p = m?.preview || m?.scene?.paths?.preview || m?.scene?.paths?.webp || m?.scene?.paths?.screenshot;
    if (!p) return undefined;
    // Add cache-busting to prevent 304 responses with empty/corrupted cache
    const baseUrl = toAbsoluteUrl(p);
    if (!baseUrl) return undefined;
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}t=${Date.now()}`;
  }

  /**
   * Refresh the header to show updated tag chips (e.g., after creating a marker)
   */
  private refreshHeader(): void {
    const header = this.container.querySelector('.video-post__header');
    if (header) {
      const newHeader = this.createHeader();
      header.replaceWith(newHeader);
    }
  }

  /**
   * Create header with performer and tag chips
   */
  private createHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'video-post__header';
    header.style.padding = '0';
    header.style.marginBottom = '0';
    header.style.borderBottom = 'none';

    const chips = document.createElement('div');
    chips.className = 'chips';
    chips.style.display = 'flex';
    chips.style.flexWrap = 'wrap';
    chips.style.gap = '4px';
    chips.style.margin = '0';
    chips.style.padding = '8px 16px';
    
    // Add performer chips
    if (this.data.marker.scene.performers && this.data.marker.scene.performers.length > 0) {
      for (const performer of this.data.marker.scene.performers) {
        const chip = this.createPerformerChip(performer);
        chips.appendChild(chip);
      }
    }

    // Add tag chips: show all tags from the tags array
    // Skip in shuffle mode UNLESS a marker has been created (to show the assigned tag)
    if (!this.useShuffleMode || this.hasCreatedMarker) {
      if (this.data.marker.tags && this.data.marker.tags.length > 0) {
        // Create a set to track displayed tags and ensure no duplicates
        const displayedTagIds = new Set<string>();
        
        // First, add primary tag if it exists and is valid (but skip if it's the Favorite or Marker tag)
        if (this.data.marker.primary_tag && 
            this.data.marker.primary_tag.id && 
            this.data.marker.primary_tag.name &&
            this.data.marker.primary_tag.name !== FAVORITE_TAG_NAME &&
            this.data.marker.primary_tag.name !== MARKER_TAG_NAME) {
          const chip = this.createTagChip(this.data.marker.primary_tag);
          chips.appendChild(chip);
          displayedTagIds.add(this.data.marker.primary_tag.id);
        }
        
        // Then, add all other tags from the tags array
        for (const tag of this.data.marker.tags) {
          // Skip if tag is invalid or already displayed
          if (!tag || !tag.id || !tag.name || displayedTagIds.has(tag.id)) {
            continue;
          }
          
          // Skip if this tag is the same as the primary tag
          if (this.data.marker.primary_tag && 
              this.data.marker.primary_tag.id === tag.id) {
            continue;
          }
          
          // Skip the StashGifs Favorite tag (already represented by heart button)
          if (tag.name === FAVORITE_TAG_NAME) {
            continue;
          }
          
          // Skip the StashGifs Marker tag (internal tag for plugin-created markers)
          if (tag.name === MARKER_TAG_NAME) {
            continue;
          }
          
          const chip = this.createTagChip(tag);
          chips.appendChild(chip);
          displayedTagIds.add(tag.id);
        }
      } else if (this.data.marker.primary_tag && 
                 this.data.marker.primary_tag.id && 
                 this.data.marker.primary_tag.name &&
                 this.data.marker.primary_tag.name !== FAVORITE_TAG_NAME &&
                 this.data.marker.primary_tag.name !== MARKER_TAG_NAME) {
        // Fallback: if tags array is empty but primary tag exists, show it (unless it's Favorite tag)
        const chip = this.createTagChip(this.data.marker.primary_tag);
        chips.appendChild(chip);
      }
    }

    header.appendChild(chips);
    return header;
  }

  /**
   * Create a performer chip element
   */
  private createPerformerChip(performer: { id: string; name: string; image_path?: string }): HTMLElement {
    const chip = document.createElement('a');
    chip.className = 'chip';
    chip.href = this.getPerformerLink(performer.id);
    chip.target = '_blank';
    chip.rel = 'noopener noreferrer';
    chip.style.padding = '2px 8px';
    chip.style.fontSize = '12px';
    chip.style.lineHeight = '1.4';
    chip.style.gap = '4px';
    chip.style.transition = 'opacity 0.2s ease';
    chip.style.cursor = 'pointer';
    
    // Handler function to filter by performer
    const handleClick = () => {
      if (this.onPerformerChipClick) {
        const performerId = parseInt(performer.id, 10);
        if (!Number.isNaN(performerId)) {
          this.onPerformerChipClick(performerId, performer.name);
        }
      }
    };
    
    // Detect mobile device
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    
    if (isMobile) {
      // Touch state tracking for scroll detection (same as player)
      let touchStartX: number = 0;
      let touchStartY: number = 0;
      let touchStartTime: number = 0;
      let isScrolling: boolean = false;
      const touchMoveThreshold: number = 10; // pixels
      const touchDurationThreshold: number = 300; // milliseconds
      
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
            
            // If touch moved more than threshold, consider it scrolling
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
        const totalDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        
        // Only trigger click if:
        // 1. Not scrolling (movement < threshold)
        // 2. Touch duration is reasonable (not a long press)
        // 3. Total distance moved is within threshold
        if (!isScrolling && 
            totalDistance < touchMoveThreshold && 
            touchDuration < touchDurationThreshold) {
          e.preventDefault();
          e.stopPropagation();
          handleClick();
        }
        
        // Reset state
        isScrolling = false;
        touchStartX = 0;
        touchStartY = 0;
        touchStartTime = 0;
      }, { passive: false });
      
      // Click handler as fallback (shouldn't fire if touchend worked, but keep for compatibility)
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Only handle click if it wasn't already handled by touchend
        // (touchend will have prevented default if it handled it)
        handleClick();
      });
    } else {
      // Desktop: use simple click handler
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleClick();
      });
    }
    
    // Performer avatar images removed to reduce initial network requests
    // Only show performer names in chips
    chip.appendChild(document.createTextNode(performer.name));
    return chip;
  }

  /**
   * Create a tag chip element
   */
  private createTagChip(tag: { id: string; name: string }): HTMLElement {
    const chip = document.createElement('a');
    chip.className = 'chip chip--tag';
    chip.href = this.getTagLink(tag.id);
    chip.target = '_blank';
    chip.rel = 'noopener noreferrer';
    chip.style.padding = '2px 8px';
    chip.style.fontSize = '12px';
    chip.style.lineHeight = '1.4';
    chip.style.transition = 'opacity 0.2s ease';
    chip.style.cursor = 'pointer';
    
    // Handler function to filter by tag
    const handleClick = () => {
      if (this.onTagChipClick) {
        const tagId = parseInt(tag.id, 10);
        if (!Number.isNaN(tagId)) {
          this.onTagChipClick(tagId, tag.name);
        }
      }
    };
    
    // Detect mobile device
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    
    if (isMobile) {
      // Touch state tracking for scroll detection (same as player)
      let touchStartX: number = 0;
      let touchStartY: number = 0;
      let touchStartTime: number = 0;
      let isScrolling: boolean = false;
      const touchMoveThreshold: number = 10; // pixels
      const touchDurationThreshold: number = 300; // milliseconds
      
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
            
            // If touch moved more than threshold, consider it scrolling
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
        const totalDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        
        // Only trigger click if:
        // 1. Not scrolling (movement < threshold)
        // 2. Touch duration is reasonable (not a long press)
        // 3. Total distance moved is within threshold
        if (!isScrolling && 
            totalDistance < touchMoveThreshold && 
            touchDuration < touchDurationThreshold) {
          e.preventDefault();
          e.stopPropagation();
          handleClick();
        }
        
        // Reset state
        isScrolling = false;
        touchStartX = 0;
        touchStartY = 0;
        touchStartTime = 0;
      }, { passive: false });
      
      // Click handler as fallback (shouldn't fire if touchend worked, but keep for compatibility)
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Only handle click if it wasn't already handled by touchend
        // (touchend will have prevented default if it handled it)
        handleClick();
      });
    } else {
      // Desktop: use simple click handler
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleClick();
      });
    }
    
    chip.appendChild(document.createTextNode(tag.name));
    return chip;
  }

  /**
   * Create footer with action buttons
   */
  private createFooter(): HTMLElement {
    const footer = document.createElement('div');
    footer.className = 'video-post__footer';
    footer.style.padding = '8px 16px';

    const info = document.createElement('div');
    info.className = 'video-post__info';
    info.style.gap = '0';
    info.style.display = 'flex';
    info.style.flexDirection = 'row'; // Change from column to row for right alignment
    info.style.justifyContent = 'flex-end'; // Right-align the content

    const row = document.createElement('div');
    row.className = 'video-post__row';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'flex-end';
    row.style.gap = '4px';

    const buttonGroup = document.createElement('div');
    buttonGroup.style.display = 'flex';
    buttonGroup.style.alignItems = 'center';
    buttonGroup.style.gap = '4px';
    this.buttonGroup = buttonGroup; // Store reference for button swapping

    // Add buttons in order
    // Hide favorite button in shuffle mode, show marker button instead
    // But if marker was already created, show heart button instead
    if (this.useShuffleMode) {
      if (this.hasCreatedMarker && this.favoritesManager) {
        // Marker was created, show heart button and "+" button
        const heartBtn = this.createHeartButton();
        buttonGroup.appendChild(heartBtn);
        if (this.api && this.isRealMarker()) {
          const addTagBtn = this.createAddTagButton();
          buttonGroup.appendChild(addTagBtn);
        }
      } else if (this.api) {
        // Show marker button to create marker
        const markerBtn = this.createMarkerButton();
        buttonGroup.appendChild(markerBtn);
      }
    } else {
      // Non-shuffle mode: show heart and "+" buttons for real markers
      if (this.favoritesManager) {
        const heartBtn = this.createHeartButton();
        buttonGroup.appendChild(heartBtn);
      }
      if (this.api && this.isRealMarker()) {
        const addTagBtn = this.createAddTagButton();
        buttonGroup.appendChild(addTagBtn);
      }
    }

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

    const playBtn = this.createPlayButton();
    buttonGroup.appendChild(playBtn);

    row.appendChild(buttonGroup);
    info.appendChild(row);
    footer.appendChild(info);
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
    iconBtn.style.padding = '0';
    // Keep 44x44px for touch target
    iconBtn.style.width = '44px';
    iconBtn.style.height = '44px';
    iconBtn.style.minWidth = '44px';
    iconBtn.style.minHeight = '44px';
    iconBtn.innerHTML = PLAY_SVG;
    
    this.addHoverEffect(iconBtn);
    this.playButton = iconBtn;
    return iconBtn;
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
    // No transition on button container - only icons will have transitions
    button.style.transition = 'none';
    // Ensure button is 44x44px for touch targets
    button.style.width = '44px';
    button.style.height = '44px';
    button.style.minWidth = '44px';
    button.style.minHeight = '44px';
  }

  /**
   * Add hover effect to a button element - CRITICAL: Only affects icon, not container
   */
  private addHoverEffect(button: HTMLElement): void {
    // Find the icon element (SVG or first child)
    const getIconElement = (): HTMLElement | SVGElement | null => {
      const svg = button.querySelector('svg');
      if (svg) return svg as SVGElement;
      // If no SVG, use first child element
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

    this.updateHeartButton(heartBtn);

    const clickHandler = async (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (!this.favoritesManager || this.isTogglingFavorite) return;

      this.isTogglingFavorite = true;
      heartBtn.disabled = true;
      heartBtn.style.opacity = '0.5';

      try {
        const newFavoriteState = await this.favoritesManager.toggleFavorite(this.data.marker);
        this.isFavorite = newFavoriteState;
        
        // Update local marker tags to reflect the change
        if (!this.data.marker.tags) {
          this.data.marker.tags = [];
        }
        
        if (newFavoriteState) {
          if (!this.data.marker.tags.some(tag => tag.name === FAVORITE_TAG_NAME)) {
            this.data.marker.tags.push({ id: '', name: FAVORITE_TAG_NAME });
          }
        } else {
          this.data.marker.tags = this.data.marker.tags.filter(
            tag => tag.name !== FAVORITE_TAG_NAME
          );
        }
        
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
   * Create add tag button for adding tags to existing markers
   */
  private createAddTagButton(): HTMLElement {
    const addTagBtn = document.createElement('button');
    addTagBtn.className = 'icon-btn icon-btn--add-tag';
    addTagBtn.type = 'button';
    addTagBtn.setAttribute('aria-label', 'Add tag');
    addTagBtn.title = 'Add tag to marker';
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
    this.buttonGroup.removeChild(this.markerButton);
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
   * Update heart button appearance based on favorite state
   */
  private updateHeartButton(button: HTMLElement): void {
    if (this.isFavorite) {
      button.innerHTML = HEART_SVG_FILLED;
      button.style.color = '#ff6b9d';
      button.title = 'Remove from favorites';
    } else {
      button.innerHTML = HEART_SVG_OUTLINE;
      button.style.color = 'rgba(255, 255, 255, 0.7)';
      button.title = 'Add to favorites';
    }
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
    oCountBtn.style.padding = '0 8px';
    oCountBtn.style.gap = '6px';
    oCountBtn.style.fontSize = '16px';
    // Keep 44px height but allow width to be auto for text content
    oCountBtn.style.width = 'auto';
    oCountBtn.style.minWidth = '44px';
    
    oCountBtn.innerHTML = '💦';
    
    this.oCountButton = oCountBtn;
    this.updateOCountButton();

    const clickHandler = async (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (!this.api) return;

      oCountBtn.disabled = true;
      oCountBtn.style.opacity = '0.5';

      try {
        const result = await this.api.incrementOCount(this.data.marker.scene.id);
        this.oCount = result.count;
        this.data.marker.scene.o_counter = result.count;
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
   * Update O-count button display
   */
  private updateOCountButton(): void {
    if (!this.oCountButton) return;
    
    const emoji = '💦';
    this.oCountButton.innerHTML = emoji;
    
    const digitCount = this.oCount > 0 ? this.oCount.toString().length : 0;
    const minWidth = digitCount > 0 ? `${Math.max(OCOUNT_MIN_WIDTH_PX, digitCount * OCOUNT_DIGIT_WIDTH_PX)}px` : `${OCOUNT_MIN_WIDTH_PX}px`;
    
    const countSpan = document.createElement('span');
    countSpan.style.fontSize = '14px';
    countSpan.style.fontWeight = '500';
    countSpan.style.minWidth = minWidth;
    countSpan.style.textAlign = 'left';
    countSpan.style.display = 'inline-block';
    countSpan.textContent = this.oCount > 0 ? this.oCount.toString() : '';
    this.oCountButton.appendChild(countSpan);
    
    if (digitCount >= 3) {
      this.oCountButton.style.paddingRight = `${OCOUNT_THREE_DIGIT_PADDING}px`;
    } else {
      this.oCountButton.style.paddingRight = `${OCOUNT_DEFAULT_PADDING}px`;
    }
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
            code: error.code,
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
      button.style.color = '#4CAF50';
      button.title = 'HD video loaded';
    } else {
      button.innerHTML = HQ_SVG_OUTLINE;
      button.style.color = 'rgba(255, 255, 255, 0.7)';
      button.title = 'Load HD video with audio';
    }
  }

  /**
   * Create rating section with dialog
   */
  private createRatingSection(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'rating-control';
    wrapper.setAttribute('data-role', 'rating');
    this.ratingWrapper = wrapper;

    const displayButton = this.createRatingDisplayButton();
    wrapper.appendChild(displayButton);

    const dialog = this.createRatingDialog();
    wrapper.appendChild(dialog);

    this.updateRatingDisplay();
    this.updateRatingStarButtons();

    return wrapper;
  }

  /**
   * Create rating display button
   */
  private createRatingDisplayButton(): HTMLElement {
    const displayButton = document.createElement('button');
    displayButton.type = 'button';
    displayButton.className = 'icon-btn icon-btn--rating';
    displayButton.setAttribute('aria-haspopup', 'dialog');
    displayButton.setAttribute('aria-expanded', 'false');
    displayButton.title = 'Set rating on scene';
    this.applyIconButtonStyles(displayButton);
    displayButton.style.padding = '0 8px';
    displayButton.style.gap = '6px';
    // Keep 44px height but allow width to be auto for text content
    displayButton.style.width = 'auto';
    displayButton.style.minWidth = '44px';
    
    displayButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.isSavingRating) return;
      this.toggleRatingDialog();
    });
    
    this.addHoverEffect(displayButton);
    this.ratingDisplayButton = displayButton;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'rating-display__icon';
    iconSpan.innerHTML = STAR_SVG;

    const valueSpan = document.createElement('span');
    valueSpan.className = 'rating-display__value';
    valueSpan.style.fontSize = '14px';
    valueSpan.style.fontWeight = '500';
    valueSpan.style.minWidth = '14px';
    valueSpan.style.textAlign = 'left';
    this.ratingDisplayValue = valueSpan;

    displayButton.appendChild(iconSpan);
    displayButton.appendChild(valueSpan);
    return displayButton;
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
    this.ratingDialog = dialog;

    const dialogHeader = document.createElement('div');
    dialogHeader.className = 'rating-dialog__header';
    dialog.appendChild(dialogHeader);

    const starsContainer = document.createElement('div');
    starsContainer.className = 'rating-dialog__stars';
    starsContainer.setAttribute('role', 'radiogroup');
    starsContainer.setAttribute('aria-label', 'Rate this scene from 0 to 10 stars');
    this.ratingStarButtons = [];

    for (let i = 1; i <= RATING_MAX_STARS; i++) {
      const starBtn = document.createElement('button');
      starBtn.type = 'button';
      starBtn.className = 'rating-dialog__star';
      starBtn.setAttribute('role', 'radio');
      starBtn.setAttribute('aria-label', `${i} star${i === 1 ? '' : 's'}`);
      starBtn.dataset.value = i.toString();
      starBtn.textContent = '☆';
      starBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.onRatingStarSelect(i);
      });
      starBtn.addEventListener('keydown', (event) => {
        this.handleRatingKeydown(event, i);
      });
      this.ratingStarButtons.push(starBtn);
      starsContainer.appendChild(starBtn);
    }

    dialog.appendChild(starsContainer);
    return dialog;
  }

  /**
   * Handle keyboard navigation for rating stars
   */
  private handleRatingKeydown(event: KeyboardEvent, currentIndex: number): void {
    if (!this.isRatingDialogOpen) return;
    
    let newIndex = currentIndex;
    
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        newIndex = Math.min(RATING_MAX_STARS, currentIndex + 1);
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
        newIndex = RATING_MAX_STARS;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        void this.onRatingStarSelect(currentIndex);
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
    // Use requestAnimationFrame to ensure DOM is ready before measuring
    requestAnimationFrame(() => {
      this.syncRatingDialogLayout();
    });
    document.addEventListener('mousedown', this.ratingOutsideClickHandler);
    document.addEventListener('touchstart', this.ratingOutsideClickHandler);
    document.addEventListener('keydown', this.ratingKeydownHandler);
    window.addEventListener('resize', this.ratingResizeHandler);
    this.updateRatingStarButtons();
    
    // Focus first star button for keyboard navigation
    if (this.ratingStarButtons.length > 0) {
      const firstButton = this.ratingStarButtons[this.hasRating ? this.ratingValue - 1 : 0];
      if (firstButton) {
        firstButton.focus();
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
    if (target && this.ratingWrapper.contains(target)) {
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
      const ariaLabel = this.hasRating
        ? `Scene rating ${this.ratingValue} out of ${RATING_MAX_STARS}`
        : 'Rate this scene';
      this.ratingDisplayButton.setAttribute('aria-label', ariaLabel);
      this.ratingDisplayButton.classList.toggle('icon-btn--rating-active', this.hasRating);
    }
    if (this.ratingDisplayValue) {
      this.ratingDisplayValue.textContent = this.hasRating ? this.ratingValue.toString() : '0';
    }
  }

  /**
   * Update star buttons appearance and state
   */
  private updateRatingStarButtons(): void {
    if (!this.ratingStarButtons || this.ratingStarButtons.length === 0) return;
    this.ratingStarButtons.forEach((button, index) => {
      const value = Number(button.dataset.value || '0');
      const isActive = this.hasRating && value <= this.ratingValue;
      const isChecked = this.hasRating && value === this.ratingValue;
      button.classList.toggle('rating-dialog__star--active', isActive);
      button.setAttribute('aria-checked', isChecked ? 'true' : 'false');
      button.tabIndex = isChecked || (!this.hasRating && index === 0) ? 0 : -1;
      button.textContent = isActive ? '★' : '☆';
      button.disabled = this.isSavingRating;
    });
  }

  /**
   * Handle star selection
   */
  private async onRatingStarSelect(value: number): Promise<void> {
    if (this.isSavingRating) return;

    const nextValue = this.clampRatingValue(value);
    const previousValue = this.ratingValue;
    const previousRating100 = this.data.marker.scene.rating100;
    const previousHasRating = this.hasRating;

    this.ratingValue = nextValue;
    this.hasRating = true;
    this.updateRatingDisplay();
    this.updateRatingStarButtons();
    this.closeRatingDialog();

    if (!this.api) {
      this.data.marker.scene.rating100 = this.ratingValue * 10;
      return;
    }

    this.isSavingRating = true;
    this.setRatingSavingState(true);
    this.updateRatingStarButtons();

    try {
      const updatedRating100 = await this.api.updateSceneRating(this.data.marker.scene.id, this.ratingValue);
      this.data.marker.scene.rating100 = updatedRating100;
      this.ratingValue = this.convertRating100ToStars(updatedRating100);
      this.hasRating = true;
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
    this.ratingStarButtons.forEach((button) => {
      button.disabled = isSaving;
    });
  }

  /**
   * Sync rating dialog layout with container
   */
  private syncRatingDialogLayout(): void {
    if (!this.ratingWrapper) return;
    const dialog = this.ratingDialog;
    if (!dialog) return;

    const cardRect = this.container.getBoundingClientRect();
    const wrapperRect = this.ratingWrapper.getBoundingClientRect();
    if (!cardRect.width || !wrapperRect.width) return;

    // Calculate exact width needed for stars dynamically
    let starsWidth = 0;
    if (this.ratingStarButtons.length > 0) {
      // Use cached width if available (button widths don't change)
      if (this.cachedStarButtonWidth !== undefined) {
        starsWidth = this.cachedStarButtonWidth * this.ratingStarButtons.length;
      } else {
        // Measure actual width of all star buttons combined (only once)
        this.ratingStarButtons.forEach((starBtn) => {
          const rect = starBtn.getBoundingClientRect();
          starsWidth += rect.width;
        });
        // Cache the average width per button
        if (this.ratingStarButtons.length > 0) {
          this.cachedStarButtonWidth = starsWidth / this.ratingStarButtons.length;
        }
      }
    } else {
      // Fallback: use container scrollWidth if buttons aren't available yet
      const starsContainer = dialog.querySelector('.rating-dialog__stars') as HTMLElement;
      if (starsContainer) {
        starsWidth = starsContainer.scrollWidth;
      } else {
        // Final fallback: estimate based on star count
        starsWidth = 10 * 24; // 10 stars * ~24px each
      }
    }
    
    // No padding or border - just stars
    const dialogWidth = starsWidth;
    
    // Ensure dialog fits within card bounds (with small margin)
    const margin = 8; // Small margin from card edges
    const maxWidth = cardRect.width - (margin * 2);
    const finalWidth = Math.min(dialogWidth, maxWidth);
    
    this.ratingWrapper.style.setProperty('--rating-dialog-width', `${finalWidth}px`);

    // Center the dialog above the button, but keep it within card bounds
    const wrapperCenter = wrapperRect.left + (wrapperRect.width / 2);
    const dialogCenter = finalWidth / 2;
    let leftPosition = wrapperCenter - dialogCenter;
    
    // Ensure dialog stays within card bounds
    const minLeft = cardRect.left + margin;
    const maxLeft = cardRect.right - finalWidth - margin;
    
    leftPosition = Math.max(minLeft, Math.min(maxLeft, leftPosition));
    
    // Convert to relative position from rating wrapper
    const relativeLeft = leftPosition - wrapperRect.left;
    
    this.ratingWrapper.style.setProperty('--rating-dialog-left', `${relativeLeft}px`);
    this.ratingWrapper.style.setProperty('--rating-dialog-right', 'auto');
  }

  /**
   * Clamp rating value to valid range
   */
  private clampRatingValue(value: number): number {
    if (!Number.isFinite(value)) return RATING_MIN_STARS;
    return Math.min(RATING_MAX_STARS, Math.max(RATING_MIN_STARS, Math.round(value)));
  }

  /**
   * Convert rating100 (0-100) to stars (0-10)
   */
  private convertRating100ToStars(rating100?: number): number {
    if (typeof rating100 !== 'number' || Number.isNaN(rating100)) {
      return RATING_MIN_STARS;
    }
    return this.clampRatingValue(rating100 / 10);
  }

  /**
   * Upgrade from marker video to full scene video with audio
   */
  private async upgradeToSceneVideo(): Promise<void> {
    if (!this.api) {
      throw new Error('API not available');
    }

    // Get full scene video URL
    const sceneVideoUrl = this.api.getVideoUrl(this.data.marker.scene);
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

    // Unload and destroy current marker player to free memory before creating new one
    if (this.player) {
      // Clear the state change listener first to prevent it from firing after destroy
      // This is critical - the old player's listener might try to update visibility manager
      // with the destroyed player's state, causing conflicts
      this.player.setStateChangeListener(undefined);
      
      // Unload first to release video buffers immediately
      if (!this.player.getIsUnloaded()) {
        this.player.unload();
      }
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

    // Clean up any leftover player elements from the old player
    // Remove all .video-player wrappers and .video-player__controls
    try {
      const oldPlayerWrappers = playerContainer.querySelectorAll('.video-player');
      for (const wrapper of Array.from(oldPlayerWrappers)) {
        if (wrapper.parentNode) {
          wrapper.parentNode.removeChild(wrapper);
        }
      }
      
      const oldControls = playerContainer.querySelectorAll('.video-player__controls');
      for (const controls of Array.from(oldControls)) {
        if (controls.parentNode) {
          controls.parentNode.removeChild(controls);
        }
      }
    } catch (e) {
      console.warn('Failed to remove old player elements', e);
      // If removing elements fails, try clearing container as fallback
      try {
        playerContainer.innerHTML = '';
      } catch (e2) {
        console.error('Failed to clear player container', e2);
        throw new Error('Failed to clear player container for upgrade');
      }
    }

    // Small delay to ensure DOM is cleared and old player is fully destroyed
    await new Promise(resolve => setTimeout(resolve, 50));

    // Create new player with full scene video (with error handling)
    try {
      const startTime = this.data.startTime ?? this.data.marker.seconds;
      
      this.player = new NativeVideoPlayer(playerContainer, sceneVideoUrl, {
        muted: true,
        autoplay: false,
        startTime: startTime,
        endTime: this.data.endTime ?? this.data.marker.end_seconds,
        aggressivePreload: false, // HD videos use metadata preload
        isHDMode: true, // HD mode - show mute button
        posterUrl: this.getPosterUrl(),
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

    // Register with visibility manager if available
    // Wait a brief moment to ensure player is fully initialized before registering
    await new Promise(resolve => setTimeout(resolve, 50));
    if (this.visibilityManager && this.data.marker.id) {
      this.visibilityManager.registerPlayer(this.data.marker.id, this.player);
    }

    // If video was playing, resume playback
    if (wasPlaying) {
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      const waitTimeout = isMobile ? 6000 : 4000; // Longer timeout on mobile for HD videos
      const checkDelay = isMobile ? 300 : 100; // More time on mobile for play() to take effect
      
      // Retry logic with exponential backoff
      let retryCount = 0;
      const maxRetries = 2; // Try up to 3 times total (initial + 2 retries)
      const retryDelays = [0, 500, 1000]; // Initial attempt, then 500ms, then 1000ms
      
      while (retryCount <= maxRetries) {
        try {
          // Wait for video to be actually loaded (fires on loadeddata/canplay events)
          await this.player.waitForReady(waitTimeout);
          
          // Attempt to play
          await this.player.play();
          
          // Wait for play() to take effect (longer on mobile)
          await new Promise(resolve => setTimeout(resolve, checkDelay));
          
          // Check if playback actually started
          if (this.player.isPlaying()) {
            // Success! Playback started
            return;
          }
          
          // If not playing, check readyState as additional verification
          const videoElement = this.player.getVideoElement();
          if (videoElement && videoElement.readyState >= 2) {
            // Video is loaded, might just need more time
            // Wait a bit more and check again
            await new Promise(resolve => setTimeout(resolve, checkDelay));
            if (this.player.isPlaying()) {
              return; // Success after additional wait
            }
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
          console.warn('Failed to resume playback after upgrade - video not playing after retries', {
            retryCount,
            readyState: videoElement?.readyState,
          });
          showToast('Video upgraded but playback failed. Click play to start.');
          return;
          
        } catch (error) {
          // Error occurred, check if video is actually playing despite the error
          // Sometimes waitForReady or play() throws even when playback succeeds
          await new Promise(resolve => setTimeout(resolve, checkDelay));
          
          if (this.player.isPlaying()) {
            // Actually playing despite error, success!
            return;
          }
          
          // Not playing, retry if we haven't exhausted retries
          if (retryCount < maxRetries) {
            const delay = retryDelays[retryCount + 1];
            await new Promise(resolve => setTimeout(resolve, delay));
            retryCount++;
            continue;
          }
          
          // All retries exhausted, show error
          console.warn('Failed to resume playback after upgrade', {
            error,
            retryCount,
            readyState: this.player.getVideoElement()?.readyState,
          });
          showToast('Video upgraded but playback failed. Click play to start.');
          return;
        }
      }
    }
  }

  /**
   * Check favorite status from marker tags
   */
  private async checkFavoriteStatus(): Promise<void> {
    if (!this.favoritesManager) return;

    try {
      const hasFavoriteTag = this.data.marker.tags?.some(
        tag => tag.name === FAVORITE_TAG_NAME
      ) || false;

      this.isFavorite = hasFavoriteTag;

      // Update heart button if it exists
      if (this.heartButton) {
        this.updateHeartButton(this.heartButton);
      }
    } catch (error) {
      console.error('Failed to check favorite status', error);
      // Don't show toast for background check failures
    }
  }

  /**
   * Get link to scene in Stash
   */
  private getSceneLink(): string {
    const s = this.data.marker.scene;
    const t = Math.max(0, Math.floor(this.data.marker.seconds || 0));
    return `${window.location.origin}/scenes/${s.id}?t=${t}`;
  }

  /**
   * Get link to performer page
   */
  private getPerformerLink(performerId: string): string {
    return `${window.location.origin}/performers/${performerId}`;
  }

  /**
   * Get link to tag page
   */
  private getTagLink(tagId: string): string {
    return `${window.location.origin}/tags/${tagId}`;
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
      
      this.player = new NativeVideoPlayer(playerContainer, videoUrl, {
        muted: true,
        autoplay: false,
        startTime: finalStartTime,
        endTime: endTime ?? this.data.endTime ?? this.data.marker.end_seconds,
        posterUrl: this.getPosterUrl(),
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
        if (this.player && !this.hasFailedPermanently) {
          this.checkForLoadError();
        } else {
          // Stop checking if player is gone or has failed permanently
          if (this.loadErrorCheckIntervalId) {
            clearInterval(this.loadErrorCheckIntervalId);
            this.loadErrorCheckIntervalId = undefined;
          }
        }
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
  }

  /**
   * Get the video player instance
   */
  getPlayer(): NativeVideoPlayer | undefined {
    return this.player;
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
   * Keep loading visible until the native player reports it can render frames.
   */
  private hideMediaWhenReady(player: NativeVideoPlayer, container: HTMLElement): void {
    const loading = container.querySelector('.video-post__loading') as HTMLElement | null;

    const hideVisuals = () => {
      if (loading) {
        loading.style.display = 'none';
        // Mark video as ready
        if (this.videoLoadingIndicator) {
          this.videoLoadingIndicator = undefined;
        }
      }
    };

    const scheduleTimeout = typeof window !== 'undefined'
      ? window.setTimeout.bind(window)
      : setTimeout;
    const clearScheduledTimeout = typeof window !== 'undefined'
      ? window.clearTimeout.bind(window)
      : clearTimeout;
    const requestFrame = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (cb: FrameRequestCallback) => setTimeout(cb, 16);

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
    placeholder.style.backgroundColor = '#1a1a1a';

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

      this.retryTimeoutId = window.setTimeout(() => {
        this.retryLoad();
      }, delay);
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
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
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
    dialog.style.background = 'rgba(28, 28, 30, 0.98)';
    dialog.style.backdropFilter = 'blur(20px) saturate(180%)';
    // WebKit-specific backdrop filter for Safari compatibility
    const webkitStyle = dialog.style as CSSStyleDeclaration & { webkitBackdropFilter?: string };
    if ('webkitBackdropFilter' in dialog.style) {
      webkitStyle.webkitBackdropFilter = 'blur(20px) saturate(180%)';
    }
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
    this.markerDialog = dialog;

    // Title
    const title = document.createElement('div');
    title.id = 'marker-dialog-title';
    title.textContent = 'Create Marker';
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
    suggestions.style.background = 'rgba(28, 28, 30, 0.98)';
    suggestions.style.border = '1px solid rgba(255, 255, 255, 0.12)';
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
    recentTitle.style.color = 'rgba(255, 255, 255, 0.6)';
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
    cancelBtn.style.background = 'rgba(255, 255, 255, 0.08)';
    cancelBtn.style.border = '1px solid rgba(255, 255, 255, 0.12)';
    cancelBtn.style.borderRadius = '8px';
    cancelBtn.style.color = 'rgba(255, 255, 255, 0.9)';
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
    createBtn.style.background = 'rgba(99, 102, 241, 0.3)';
    createBtn.style.border = '1px solid rgba(99, 102, 241, 0.5)';
    createBtn.style.borderRadius = '8px';
    createBtn.style.color = 'rgba(255, 255, 255, 0.5)';
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
  private onMarkerDialogOutsideClick = (event: Event): void => {
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
  private onMarkerDialogKeydown = (event: KeyboardEvent): void => {
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
   * Show loading skeleton in tag suggestions dropdown
   */
  private showTagSuggestionsLoading(): void {
    if (!this.markerDialogSuggestions || this.isTagSearchLoading) return;

    this.isTagSearchLoading = true;
    this.markerDialogSuggestions.innerHTML = '';
    this.markerDialogSuggestions.style.display = 'block';

    // Create 4 skeleton suggestion items
    for (let i = 0; i < 4; i++) {
      const skeletonItem = document.createElement('div');
      skeletonItem.setAttribute('data-tag-suggestion-skeleton', 'true');
      skeletonItem.style.width = '100%';
      skeletonItem.style.padding = '10px 12px';
      skeletonItem.style.display = 'flex';
      skeletonItem.style.alignItems = 'center';
      
      const skeletonText = document.createElement('div');
      skeletonText.className = 'chip-skeleton';
      skeletonText.setAttribute('data-tag-suggestion-skeleton', 'true');
      skeletonText.style.height = '16px';
      skeletonText.style.borderRadius = '4px';
      skeletonText.style.flex = '1';
      
      // Vary width for more natural look
      const widths = [120, 140, 100, 130];
      skeletonText.style.width = `${widths[i % widths.length]}px`;
      
      skeletonItem.appendChild(skeletonText);
      this.markerDialogSuggestions.appendChild(skeletonItem);
    }
  }

  /**
   * Clear loading skeleton from tag suggestions dropdown
   */
  private clearTagSuggestionsLoading(): void {
    if (!this.markerDialogSuggestions) return;

    // Remove all skeleton items
    const skeletonItems = Array.from(this.markerDialogSuggestions.querySelectorAll('[data-tag-suggestion-skeleton="true"]'));
    skeletonItems.forEach((item) => {
      if (item.parentNode) {
        item.parentNode.removeChild(item);
      }
    });

    this.isTagSearchLoading = false;
  }

  /**
   * Search tags for marker creation (using faster searchMarkerTags API)
   */
  private async searchTagsForMarker(searchTerm: string): Promise<void> {
    if (!this.api || !this.markerDialogSuggestions) return;

    // Clear any existing loading state from previous search
    this.clearTagSuggestionsLoading();

    // Show loading skeleton if search takes longer than 200ms
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
      
      // Clear any loading skeletons that were shown
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

    // Clear any loading skeletons first
    this.clearTagSuggestionsLoading();

    this.markerDialogSuggestions.innerHTML = '';
    this.markerDialogSuggestions.style.display = tags.length > 0 ? 'block' : 'none';

    if (tags.length === 0) {
      const noResults = document.createElement('div');
      noResults.textContent = 'No tags found';
      noResults.style.padding = '12px';
      noResults.style.color = 'rgba(255, 255, 255, 0.5)';
      noResults.style.fontSize = '14px';
      this.markerDialogSuggestions.appendChild(noResults);
      return;
    }

    tags.forEach(tag => {
      const item = document.createElement('button');
      item.type = 'button';
      item.textContent = tag.name;
      item.style.width = '100%';
      item.style.padding = '10px 12px';
      item.style.textAlign = 'left';
      item.style.background = 'transparent';
      item.style.border = 'none';
      item.style.color = 'rgba(255, 255, 255, 0.9)';
      item.style.fontSize = '14px';
      item.style.cursor = 'pointer';
      item.style.transition = 'background 0.15s ease';

      item.addEventListener('mouseenter', () => {
        item.style.background = 'rgba(255, 255, 255, 0.08)';
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
    });
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
  }

  /**
   * Update marker dialog state (enable/disable create button)
   */
  private updateMarkerDialogState(): void {
    if (!this.markerDialogCreateButton) return;

    const hasTag = !!this.selectedTagId;
    this.markerDialogCreateButton.disabled = !hasTag;

    if (hasTag) {
      this.markerDialogCreateButton.style.background = 'rgba(99, 102, 241, 0.6)';
      this.markerDialogCreateButton.style.borderColor = 'rgba(99, 102, 241, 0.8)';
      this.markerDialogCreateButton.style.color = 'rgba(255, 255, 255, 0.9)';
      this.markerDialogCreateButton.style.cursor = 'pointer';
    } else {
      this.markerDialogCreateButton.style.background = 'rgba(99, 102, 241, 0.3)';
      this.markerDialogCreateButton.style.borderColor = 'rgba(99, 102, 241, 0.5)';
      this.markerDialogCreateButton.style.color = 'rgba(255, 255, 255, 0.5)';
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
      recentTags.forEach(tag => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.textContent = tag.name;
        chip.style.padding = '6px 12px';
        chip.style.background = 'rgba(255, 255, 255, 0.08)';
        chip.style.border = '1px solid rgba(255, 255, 255, 0.12)';
        chip.style.borderRadius = '16px';
        chip.style.color = 'rgba(255, 255, 255, 0.9)';
        chip.style.fontSize = '12px';
        chip.style.cursor = 'pointer';
        chip.style.transition = 'all 0.15s ease';

        chip.addEventListener('mouseenter', () => {
          chip.style.background = 'rgba(255, 255, 255, 0.12)';
          chip.style.borderColor = 'rgba(255, 255, 255, 0.18)';
        });
        chip.addEventListener('mouseleave', () => {
          chip.style.background = 'rgba(255, 255, 255, 0.08)';
          chip.style.borderColor = 'rgba(255, 255, 255, 0.12)';
        });

        chip.addEventListener('click', () => {
          this.selectTagForMarker(tag.id, tag.name);
        });

        if (this.markerDialogRecentTags) {
          this.markerDialogRecentTags.appendChild(chip);
        }
      });
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
  private openAddTagDialog(): void {
    this.openMarkerDialog('add');
  }

  /**
   * Add tag to existing marker
   */
  private async addTagToMarker(): Promise<void> {
    if (!this.api || !this.selectedTagId || !this.selectedTagName) return;
    if (!this.markerDialogCreateButton) return;

    // Validate marker has real ID (not synthetic)
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
      if (!this.data.marker.tags) {
        this.data.marker.tags = [];
      }
      
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
