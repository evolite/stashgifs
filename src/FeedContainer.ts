/**
 * Feed Container
 * Main application container managing the feed
 */

import { SceneMarker, FilterOptions, FeedSettings, VideoPostData, ImagePostData, Image } from './types.js';
import { StashAPI } from './StashAPI.js';
import { VideoPost } from './VideoPost.js';
import { ImagePost } from './ImagePost.js';
import { NativeVideoPlayer } from './NativeVideoPlayer.js';
import { ImagePlayer } from './ImagePlayer.js';
import { VisibilityManager } from './VisibilityManager.js';
import { FavoritesManager } from './FavoritesManager.js';
import { SettingsPage } from './SettingsPage.js';
import { debounce, isValidMediaUrl, detectDeviceCapabilities, DeviceCapabilities, isStandaloneNavigator } from './utils.js';
import { posterPreloader } from './PosterPreloader.js';
import { Image as GraphQLImage } from './graphql/types.js';
import { HQ_SVG_OUTLINE, RANDOM_SVG, SETTINGS_SVG, VOLUME_MUTED_SVG, VOLUME_UNMUTED_SVG, SHUFFLE_CHECK_SVG, CLEAR_SVG } from './icons.js';

const DEFAULT_SETTINGS: FeedSettings = {
  autoPlay: true, // Enable autoplay for markers
  autoPlayThreshold: 0.2, // Lower threshold - start playing when 20% visible instead of 50%
  maxConcurrentVideos: 2, // Limit to 2 concurrent videos to prevent 8GB+ RAM usage
  unloadDistance: 1000,
  cardMaxWidth: 800,
  aspectRatio: 'preserve',
  showControls: 'hover',
  enableFullscreen: true,
  backgroundPreloadEnabled: true,
  backgroundPreloadDelay: 150, // ms, delay between videos
  backgroundPreloadFastScrollDelay: 400, // ms, delay during fast scrolling
  backgroundPreloadScrollVelocityThreshold: 2, // pixels/ms, threshold for fast scroll detection
  enabledFileTypes: ['.gif'], // Default file types to include
  includeImagesInFeed: true, // Whether to include images in feed
  imagesOnly: false,
  includeShortFormContent: false, // Enable/disable short-form content
  shortFormInHDMode: true, // Include short-form in HD mode
  shortFormInNonHDMode: true, // Include short-form in non-HD mode
  shortFormMaxDuration: 120, // Maximum duration in seconds for short-form content
  shortFormOnly: false, // When true, only load short-form content and skip regular markers
};

/**
 * Debug interface for FeedContainer (for extension/debugging purposes)
 */
interface FeedContainerDebug {
  __isHeaderHidden?: () => boolean;
  __setHeaderHidden?: (val: boolean) => void;
  __showHeader?: () => void;
  _mobileLoadTimeout?: ReturnType<typeof setTimeout> | null;
}

/**
 * Type guard to check if a player is a NativeVideoPlayer
 */
function isNativeVideoPlayer(player: NativeVideoPlayer | ImagePlayer | undefined): player is NativeVideoPlayer {
  return player !== undefined && 'getVideoElement' in player;
}

/**
 * Content type for unified mixing
 */
type ContentType = 'marker' | 'shortform' | 'image';

export class FeedContainer {
  private readonly container: HTMLElement;
  private scrollContainer: HTMLElement;
  private readonly api: StashAPI;
  private visibilityManager: VisibilityManager;
  private favoritesManager: FavoritesManager;
  private posts: Map<string, VideoPost | ImagePost>;
  private postOrder: string[];
  private images: Image[] = [];
  private settings: FeedSettings;
  private settingsPage?: SettingsPage;
  private settingsContainer?: HTMLElement;
  private markers: SceneMarker[] = [];
  private readonly imagesLoadedCount: number = 0; // Track how many images we've loaded
  private readonly markersLoadedCount: number = 0; // Track how many markers we've loaded
  // Batch poster prefetching aligns with previous commit behavior
  private isLoading: boolean = false;
  private currentFilters?: FilterOptions;
  private selectedTagId?: number;
  private selectedTagName?: string;
  private selectedPerformerId?: number;
  private selectedPerformerName?: string;
  private hasMore: boolean = true;
  private currentPage: number = 1;
  private scrollObserver?: IntersectionObserver;
  private loadMoreTrigger?: HTMLElement;
  private postsContainer!: HTMLElement;
  private headerBar?: HTMLElement;
  private selectedSavedFilter?: { id: string; name: string };
  private eagerPreloadedPosts: Set<string>;
  private eagerPreloadScheduled: boolean = false;
  private eagerPreloadHandle?: number;
  private eagerPreloadCount: number;
  private maxSimultaneousPreloads: number;
  private isMobileDevice: boolean;
  private preloadedTags: Array<{ id: string; name: string }> = [];
  private preloadedPerformers: Array<{ id: string; name: string; image_path?: string }> = [];
  private isPreloading: boolean = false;
  private backgroundPreloadActive: boolean = false;
  private backgroundPreloadHandle?: number;
  private backgroundPreloadPriorityQueue: string[] = [];
  private readonly activePreloadPosts: Set<string> = new Set();
  private lastScrollTop: number = 0;
  private lastScrollTime: number = 0;
  private scrollVelocity: number = 0;
  private currentlyPreloadingCount: number = 0;
  private mobilePreloadQueue: string[] = [];
  private mobilePreloadActive: boolean = false;
  private initialLoadLimit: number; // Set in constructor based on device
  private readonly subsequentLoadLimit: number = 12; // Load 12 items on subsequent loads (reduced from 20)
  private placeholderAnimationInterval?: ReturnType<typeof setInterval>; // For scrolling placeholder animation
  private savedFiltersCache: Array<{ id: string; name: string }> = [];
  private savedFiltersLoaded: boolean = false;
  private activeSearchAbortController?: AbortController;
  private activeLoadVideosAbortController?: AbortController;
  private skeletonLoaders: HTMLElement[] = [];
  private useHDMode: boolean = false;
  private useVolumeMode: boolean = false;
  private shuffleMode: number = 0; // 0 = off, 1 = shuffle with markers only, 2 = shuffle all (including no markers)
  private readonly loadObservers: Map<string, IntersectionObserver> = new Map(); // Track load observers for cleanup
  private deviceCapabilities: DeviceCapabilities; // Device capabilities for adaptive quality
  private shuffleToggle?: HTMLElement; // Reference to shuffle toggle button
  private contentRatio?: { markerRatio: number; shortFormRatio: number; imageRatio: number }; // Store initial ratio based on total counts
  private contentTotals?: { markerTotal: number; shortFormTotal: number; imageTotal: number }; // Store initial totals from API
  private contentConsumed?: { markers: number; shortForm: number; images: number }; // Track consumed items to maintain ratio

  constructor(container: HTMLElement, api?: StashAPI, settings?: Partial<FeedSettings>) {
    this.container = container;
    this.api = api || new StashAPI();
    // Merge settings: defaults first, then passed settings (which may include loaded settings from index.ts)
    // If no settings passed, load from localStorage
    const loadedSettings = settings && Object.keys(settings).length > 0 ? settings : this.loadSettingsFromStorage();
    this.settings = { ...DEFAULT_SETTINGS, ...loadedSettings };
    // Initialize properties that will be set in methods
    this.scrollContainer = null!; // Will be set in initializeContainers
    this.visibilityManager = null!; // Will be set in initializeManagers
    this.favoritesManager = null!; // Will be set in initializeManagers
    this.posts = new Map();
    this.postOrder = [];
    this.eagerPreloadedPosts = new Set();
    this.eagerPreloadCount = 0;
    this.maxSimultaneousPreloads = 0;
    this.isMobileDevice = false;
    this.initialLoadLimit = 0;
    this.deviceCapabilities = null!; // Will be set in initializeDeviceConfiguration

    this.initializeDeviceConfiguration();
    this.initializeContainers();
    this.loadUserPreferences();
    
    // Create header bar with unified search
    this.createHeaderBar();
    
    this.initializePostsContainer();
    this.initializeManagers();

    // Setup scroll handler
    this.setupScrollHandler();
    
    // Setup infinite scroll
    this.setupInfiniteScroll();
    // Render filter bottom sheet UI
    this.renderFilterSheet();
    
    // Unlock autoplay on mobile after first user interaction
    this.unlockMobileAutoplay();

    // Defer suggestion preload until after initial videos load to avoid competing for bandwidth
    // Will be triggered lazily when user opens filter dropdown or after initial load completes
  }

  /**
   * Initialize device detection and configuration
   */
  private initializeDeviceConfiguration(): void {
    const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
    this.isMobileDevice = /iPhone|iPad|iPod|Android/i.test(userAgent);
    
    // Mobile: reduce initial load for faster perceived performance
    this.initialLoadLimit = this.isMobileDevice ? 6 : 8; // Load 6 on mobile, 8 on desktop (reduced to prevent overload)
    
    // Disabled eager preload - videos now load on-demand when close to viewport (50px) or on click
    this.eagerPreloadCount = 0; // No eager preloading - let Intersection Observer handle it
    // Extremely reduced to prevent 8GB+ RAM usage: max 1 on mobile, 2 on desktop
    this.maxSimultaneousPreloads = this.isMobileDevice ? 1 : 2;

    if (this.isMobileDevice) {
      this.settings.backgroundPreloadDelay = 80;
      this.settings.backgroundPreloadFastScrollDelay = 200;
    }
    
    this.posts = new Map();
    this.postOrder = [];
    this.eagerPreloadedPosts = new Set();
    
    // Detect device capabilities for adaptive media quality
    this.deviceCapabilities = detectDeviceCapabilities();
  }

  /**
   * Initialize scroll and posts containers
   */
  private initializeContainers(): void {
    // Check if container structure already exists (from initial HTML skeleton)
    const existingScrollContainer = this.container.querySelector('.feed-scroll-container') as HTMLElement;
    if (existingScrollContainer) {
      this.scrollContainer = existingScrollContainer;
    } else {
      // Create scroll container
      this.scrollContainer = document.createElement('div');
      this.scrollContainer.className = 'feed-scroll-container';
      this.container.appendChild(this.scrollContainer);
    }
  }

  /**
   * Initialize posts container
   */
  private initializePostsContainer(): void {
    // Check if posts container already exists
    const existingPostsContainer = this.scrollContainer.querySelector('.feed-posts') as HTMLElement;
    if (existingPostsContainer) {
      this.postsContainer = existingPostsContainer;
    } else {
      // Create posts container (separate from filter bar so we don't wipe it)
      this.postsContainer = document.createElement('div');
      this.postsContainer.className = 'feed-posts';
      this.scrollContainer.appendChild(this.postsContainer);
    }
  }

  /**
   * Load settings from localStorage
   */
  private loadSettingsFromStorage(): Partial<FeedSettings> {
    try {
      const savedSettings = localStorage.getItem('stashgifs-settings');
      if (savedSettings) {
        return JSON.parse(savedSettings);
      }
    } catch (error) {
      console.error('Failed to load settings from localStorage', error);
    }
    return {};
  }

  /**
   * Save settings to localStorage
   */
  private saveSettingsToStorage(settings: FeedSettings): void {
    try {
      // Ensure we have a complete settings object by merging with defaults
      const completeSettings: FeedSettings = { ...DEFAULT_SETTINGS, ...settings };
      localStorage.setItem('stashgifs-settings', JSON.stringify(completeSettings));
    } catch (error) {
      console.error('Failed to save settings to localStorage', error);
    }
  }

  /**
   * Load user preferences from localStorage
   */
  private loadUserPreferences(): void {
    this.useHDMode = this.loadHDModePreference();
    this.shuffleMode = this.loadShuffleModePreference();
    this.useVolumeMode = this.loadVolumeModePreference();
  }

  /**
   * Load HD mode preference from localStorage
   */
  private loadHDModePreference(): boolean {
    try {
      const savedHD = localStorage.getItem('stashgifs-useHDMode');
      return savedHD === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Load shuffle mode preference from localStorage
   */
  private loadShuffleModePreference(): number {
    try {
      const savedShuffle = localStorage.getItem('stashgifs-shuffleMode');
      if (savedShuffle === null) {
        return 0;
      }
      const parsed = Number.parseInt(savedShuffle, 10);
      if (this.isValidShuffleMode(parsed)) {
        return parsed;
      }
      return 0;
    } catch {
      return 0;
    }
  }

  /**
   * Check if shuffle mode value is valid
   */
  private isValidShuffleMode(value: number): boolean {
    return !Number.isNaN(value) && value >= 0 && value <= 2;
  }

  /**
   * Load volume mode preference from localStorage
   */
  private loadVolumeModePreference(): boolean {
    try {
      const savedVolumeMode = localStorage.getItem('stashgifs-useVolumeMode');
      return savedVolumeMode === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Initialize visibility and favorites managers
   */
  private initializeManagers(): void {
    // Initialize visibility manager
    // Enable autoplay for non-HD mode (viewport-based), disable for HD mode (hover-based only)
    this.visibilityManager = new VisibilityManager({
      threshold: this.settings.autoPlayThreshold,
      autoPlay: !this.useHDMode, // Enable autoplay in non-HD mode, disable in HD mode
      maxConcurrent: this.settings.maxConcurrentVideos,
      debug: this.shouldEnableVisibilityDebug(),
      onHoverLoadRequest: (postId: string) => this.triggerVideoLoadOnHover(postId),
    });

    // Apply saved volume mode state to visibility manager
    this.visibilityManager.setExclusiveAudio(this.useVolumeMode);
    
    // Set HD mode state for more aggressive unloading
    this.visibilityManager.setHDMode(this.useHDMode);

    // Initialize favorites manager
    this.favoritesManager = new FavoritesManager(this.api);
  }
  
  /**
   * Unlock autoplay on mobile by playing a dummy video on first user interaction
   * This allows subsequent videos to autoplay
   */
  private unlockMobileAutoplay(): void {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (!isMobile) return;
    
    let unlocked = false;
    const unlock = async () => {
      if (unlocked) return;
      unlocked = true;
      
      // Create a dummy video element to unlock autoplay
      const dummyVideo = document.createElement('video');
      dummyVideo.muted = true;
      dummyVideo.playsInline = true;
      dummyVideo.setAttribute('playsinline', 'true');
      dummyVideo.setAttribute('webkit-playsinline', 'true');
      dummyVideo.style.display = 'none';
      dummyVideo.style.width = '1px';
      dummyVideo.style.height = '1px';
      dummyVideo.style.position = 'absolute';
      dummyVideo.style.opacity = '0';
      dummyVideo.style.pointerEvents = 'none';
      
      // Use a data URL for a minimal video (1x1 transparent pixel)
      // This is just to unlock autoplay capability
      dummyVideo.src = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAbxtZGF0AAACrgYF//+q3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE1MiByMjg1NCBlOWE1OTAzIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAxNyAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTI1IHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTA6';
      
      document.body.appendChild(dummyVideo);
      
      try {
        // Try to play the dummy video to unlock autoplay
        await dummyVideo.play();
        
        // Try to play all currently visible videos
        setTimeout(() => {
          this.visibilityManager.retryVisibleVideos();
        }, 100);
      } catch (e) {
        // Autoplay unlock failed, user will need to interact
        console.debug('Autoplay unlock failed, user will need to interact', e);
      } finally {
        // Clean up after a short delay
        setTimeout(() => {
          dummyVideo.remove();
        }, 1000);
      }
    };
    
    // Unlock on any user interaction
    const events = ['touchstart', 'touchend', 'click', 'scroll', 'touchmove'];
    for (const event of events) {
      document.addEventListener(event, unlock, { once: true, passive: true });
    }
  }

  /**
   * Close suggestions overlay and unlock body scroll
   */
  private closeSuggestions(): void {
    // Find all suggestion overlays (there might be multiple instances)
    const suggestions = document.querySelectorAll('.feed-filters__suggestions');
    for (const suggestion of suggestions) {
      const el = suggestion as HTMLElement;
      // Hide panel first to prevent any flash of old content
      el.style.display = 'none';
      // Clear all content while hidden to ensure panel is empty when it opens next time
      // Use removeChild for better performance than innerHTML
      while (el.firstChild) {
        el.firstChild.remove();
      }
    }
    
    this.unlockBodyScroll();
    
    // Refresh cache in the background for next time the overlay opens
    // Don't await - let it run asynchronously
    if (!this.isPreloading) {
      this.preloadSuggestions().catch((e) => console.warn('Failed to refresh suggestions cache', e));
    }
  }

  /**
   * Show random mode notice in suggestions panel
   */
  private showRandomModeNotice(suggestions: HTMLElement): void {
    suggestions.style.display = 'flex';
    this.lockBodyScroll();
    while (suggestions.firstChild) {
      suggestions.firstChild.remove();
    }
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.justifyContent = 'center';
    container.style.alignItems = 'center';
    container.style.padding = '16px';
    container.style.width = '100%';
    const notice = document.createElement('div');
    notice.textContent = 'Random mode active — search disabled';
    notice.style.padding = '8px 12px';
    notice.style.borderRadius = '999px';
    notice.style.background = 'rgba(255,255,255,0.08)';
    notice.style.border = '1px solid rgba(255,255,255,0.12)';
    notice.style.color = 'rgba(255,255,255,0.85)';
    notice.style.fontSize = '13px';
    container.appendChild(notice);
    suggestions.appendChild(container);
  }

  /**
   * Create section label element
   */
  private createSectionLabel(label: string, uppercase: boolean = false): HTMLElement {
    const el = document.createElement('div');
    el.textContent = uppercase ? label.toUpperCase() : label;
    el.style.width = '100%';
    el.style.fontSize = uppercase ? '11px' : '15px';
    el.style.fontWeight = uppercase ? '600' : '500';
    el.style.letterSpacing = uppercase ? '0.5px' : 'normal';
    el.style.textTransform = uppercase ? 'uppercase' : 'none';
    el.style.color = uppercase ? 'rgba(255,255,255,0.6)' : '#FFFFFF';
    return el;
  }

  /**
   * Create pill button element
   */
  private createPillButton(label: string, onSelect: () => void | Promise<void>): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.style.display = 'inline-flex';
    button.style.alignItems = 'center';
    button.style.justifyContent = 'center';
    button.style.padding = '8px 14px';
    button.style.borderRadius = '999px';
    button.style.border = '1px solid rgba(255,255,255,0.12)';
    button.style.background = 'rgba(255,255,255,0.08)';
    button.style.color = '#FFFFFF';
    button.style.cursor = 'pointer';
    button.style.fontSize = '14px';
    button.style.fontWeight = '500';
    button.style.transition = 'background 0.2s ease';
    button.addEventListener('mouseenter', () => {
      button.style.background = 'rgba(255,255,255,0.12)';
    });
    button.addEventListener('mouseleave', () => {
      button.style.background = 'rgba(255,255,255,0.08)';
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      Promise.resolve(onSelect()).catch((error) => console.error('Suggestion selection failed', error));
    });
    return button;
  }

  /**
   * Create list button element
   */
  private createListButton(
    label: string,
    onSelect: () => void | Promise<void>,
    options: { subtitle?: string; leadingText?: string; leadingImage?: string } = {}
  ): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.style.width = '100%';
    button.style.display = 'flex';
    button.style.alignItems = 'center';
    button.style.gap = '12px';
    button.style.padding = '12px';
    button.style.borderRadius = '12px';
    button.style.border = 'none';
    button.style.background = 'transparent';
    button.style.cursor = 'pointer';
    button.style.textAlign = 'left';
    button.style.transition = 'background 0.2s ease';
    button.addEventListener('mouseenter', () => {
      button.style.background = 'rgba(255,255,255,0.08)';
    });
    button.addEventListener('mouseleave', () => {
      button.style.background = 'transparent';
    });

    if (options.leadingText || options.leadingImage) {
      const leading = document.createElement('div');
      leading.style.width = '36px';
      leading.style.height = '36px';
      leading.style.borderRadius = '50%';
      leading.style.background = 'rgba(255,255,255,0.1)';
      leading.style.display = 'flex';
      leading.style.alignItems = 'center';
      leading.style.justifyContent = 'center';
      leading.style.fontSize = '16px';
      leading.style.fontWeight = '600';
      leading.style.color = 'rgba(255,255,255,0.85)';
      leading.style.flexShrink = '0';
      leading.style.overflow = 'hidden';

      if (options.leadingImage) {
        const img = document.createElement('img');
        img.src = options.leadingImage;
        img.alt = label;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        leading.appendChild(img);
      } else if (options.leadingText) {
        leading.textContent = options.leadingText;
      }

      button.appendChild(leading);
    }

    const textContainer = document.createElement('div');
    textContainer.style.display = 'flex';
    textContainer.style.flexDirection = 'column';
    textContainer.style.gap = options.subtitle ? '2px' : '0';
    textContainer.style.flex = '1';

    const title = document.createElement('div');
    title.textContent = label;
    title.style.fontSize = '15px';
    title.style.fontWeight = '500';
    title.style.color = '#FFFFFF';
    textContainer.appendChild(title);

    if (options.subtitle) {
      const subtitle = document.createElement('div');
      subtitle.textContent = options.subtitle;
      subtitle.style.fontSize = '12px';
      subtitle.style.color = 'rgba(255,255,255,0.6)';
      textContainer.appendChild(subtitle);
    }

    button.appendChild(textContainer);

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      Promise.resolve(onSelect()).catch((error) => console.error('Suggestion selection failed', error));
    });

    return button;
  }

  /**
   * Append empty state message
   */
  private appendEmptyState(target: HTMLElement, message: string): void {
    const emptyState = document.createElement('div');
    emptyState.style.padding = '12px';
    emptyState.style.borderRadius = '10px';
    emptyState.style.background = 'rgba(255,255,255,0.04)';
    emptyState.style.color = 'rgba(255,255,255,0.7)';
    emptyState.style.fontSize = '14px';
    emptyState.style.textAlign = 'center';
    emptyState.textContent = message;
    target.appendChild(emptyState);
  }

  /**
   * Calculate alignment offset for suggestions
   */
  private calculateAlignmentOffset(container: HTMLElement, horizontalPadding: number): number {
    const searchInput = this.container.querySelector('.feed-filters__input') as HTMLElement;
    if (searchInput) {
      const searchRect = searchInput.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      return searchRect.left - containerRect.left - horizontalPadding;
    }
    // Fallback: approximate alignment (header padding + logo + gap - filter padding)
    const headerPadding = 12;
    const logoWidth = 120; // Approximate logo width
    const headerGap = 12;
    return headerPadding + logoWidth + headerGap - horizontalPadding;
  }

  /**
   * Create loading skeleton section
   */
  private createLoadingSkeletons(): HTMLElement {
    const loadingSection = document.createElement('div');
    loadingSection.style.display = 'flex';
    loadingSection.style.flexDirection = 'column';
    loadingSection.style.gap = '8px';
    loadingSection.appendChild(this.createSectionLabel('Suggested Tags'));
    
    // Create 6 skeleton placeholders that match the list button style
    for (let i = 0; i < 6; i++) {
      const skeletonButton = document.createElement('div');
      skeletonButton.style.width = '100%';
      skeletonButton.style.display = 'flex';
      skeletonButton.style.alignItems = 'center';
      skeletonButton.style.gap = '12px';
      skeletonButton.style.padding = '12px';
      skeletonButton.style.borderRadius = '12px';
      skeletonButton.style.background = 'transparent';
      
      // Leading circle skeleton
      const leadingSkeleton = document.createElement('div');
      leadingSkeleton.className = 'chip-skeleton';
      leadingSkeleton.dataset.suggestionSkeleton = 'true';
      leadingSkeleton.style.width = '36px';
      leadingSkeleton.style.height = '36px';
      leadingSkeleton.style.borderRadius = '50%';
      leadingSkeleton.style.flexShrink = '0';
      
      // Text skeleton
      const textSkeleton = document.createElement('div');
      textSkeleton.className = 'chip-skeleton';
      textSkeleton.dataset.suggestionSkeleton = 'true';
      textSkeleton.style.height = '16px';
      textSkeleton.style.borderRadius = '4px';
      textSkeleton.style.flex = '1';
      // Vary width for more natural look
      const widths = [120, 140, 100, 130, 110, 150];
      textSkeleton.style.width = `${widths[i % widths.length]}px`;
      
      skeletonButton.appendChild(leadingSkeleton);
      skeletonButton.appendChild(textSkeleton);
      loadingSection.appendChild(skeletonButton);
    }
    
    return loadingSection;
  }

  /**
   * Create playback controls section (HD toggle and Random positions)
   */
  private createPlaybackControlsSection(
    container: HTMLElement,
    alignmentOffset: number,
    onHDToggleClick: () => void,
    updateSearchBarDisplay: () => void
  ): void {
    const playbackSection = document.createElement('div');
    playbackSection.style.display = 'flex';
    playbackSection.style.flexDirection = 'row';
    playbackSection.style.alignItems = 'center';
    playbackSection.style.gap = '8px';
    playbackSection.style.flexWrap = 'wrap';
    playbackSection.style.marginLeft = `${alignmentOffset}px`;

    // HD toggle button
    const hdBtn = document.createElement('button');
    hdBtn.type = 'button';
    hdBtn.innerHTML = HQ_SVG_OUTLINE;
    hdBtn.title = this.useHDMode ? 'HD Video: On' : 'HD Video: Off';
    hdBtn.style.padding = '10px';
    hdBtn.style.width = '44px';
    hdBtn.style.height = '44px';
    hdBtn.style.borderRadius = '10px';
    hdBtn.style.border = this.useHDMode ? '1px solid rgba(76, 175, 80, 0.55)' : '1px solid rgba(255,255,255,0.06)';
    hdBtn.style.background = this.useHDMode ? 'rgba(76, 175, 80, 0.25)' : 'rgba(28, 28, 30, 0.6)';
    hdBtn.style.color = this.useHDMode ? '#C8E6C9' : 'rgba(255,255,255,0.4)';
    hdBtn.style.cursor = 'pointer';
    hdBtn.style.display = 'inline-flex';
    hdBtn.style.alignItems = 'center';
    hdBtn.style.justifyContent = 'center';

    // Random positions toggle
    const randomBtn = document.createElement('button');
    randomBtn.type = 'button';
    randomBtn.innerHTML = RANDOM_SVG;
    const setRandomBtnState = () => {
      const isOn = this.shuffleMode > 0;
      randomBtn.title = isOn ? 'Random Positions: On' : 'Random Positions: Off';
      randomBtn.style.background = isOn ? 'rgba(33, 150, 243, 0.25)' : 'rgba(28, 28, 30, 0.6)';
      randomBtn.style.border = isOn ? '1px solid rgba(33, 150, 243, 0.65)' : '1px solid rgba(255,255,255,0.06)';
      randomBtn.style.color = isOn ? '#64B5F6' : 'rgba(255,255,255,0.4)';
    };
    randomBtn.style.padding = '10px';
    randomBtn.style.width = '44px';
    randomBtn.style.height = '44px';
    randomBtn.style.borderRadius = '10px';
    randomBtn.style.cursor = 'pointer';
    randomBtn.style.display = 'inline-flex';
    randomBtn.style.alignItems = 'center';
    randomBtn.style.justifyContent = 'center';
    setRandomBtnState();

    const updateButtonStates = () => {
      hdBtn.style.background = this.useHDMode ? 'rgba(76, 175, 80, 0.25)' : 'rgba(28, 28, 30, 0.6)';
      hdBtn.style.border = this.useHDMode ? '1px solid rgba(76, 175, 80, 0.55)' : '1px solid rgba(255,255,255,0.06)';
      hdBtn.style.color = this.useHDMode ? '#C8E6C9' : 'rgba(255,255,255,0.4)';
      hdBtn.title = this.useHDMode ? 'HD Video: On' : 'HD Video: Off';
      setRandomBtnState();
    };

    hdBtn.addEventListener('click', () => {
      onHDToggleClick();
      updateButtonStates();
    });

    randomBtn.addEventListener('click', async () => {
      const willBeOn = this.shuffleMode === 0;
      if (willBeOn && !this.useHDMode) {
        onHDToggleClick();
      }
      this.shuffleMode = this.shuffleMode > 0 ? 0 : 1;
      try { localStorage.setItem('stashgifs-shuffleMode', String(this.shuffleMode)); } catch {}
      updateButtonStates();
      updateSearchBarDisplay();
      this.clearPosts();
      if (this.postsContainer) this.postsContainer.innerHTML = '';
      this.currentPage = 1;
      this.hasMore = true;
      this.isLoading = false;
      await this.loadVideos(this.currentFilters, false, undefined, true);
    });

    const settingsButton = this.createSettingsButton();
    
    playbackSection.appendChild(settingsButton);
    playbackSection.appendChild(hdBtn);
    playbackSection.appendChild(randomBtn);
    container.appendChild(playbackSection);
  }

  /**
   * Create saved filters section
   */
  private createSavedFiltersSection(
    container: HTMLElement,
    alignmentOffset: number,
    updateSearchBarDisplay: () => void,
    apply: () => Promise<void>
  ): void {
    const filtersSection = document.createElement('div');
    filtersSection.style.display = 'flex';
    filtersSection.style.flexDirection = 'column';
    filtersSection.style.gap = '12px';
    filtersSection.style.marginLeft = `${alignmentOffset}px`;
    filtersSection.appendChild(this.createSectionLabel('Saved Filters', true));

    const pillRow = document.createElement('div');
    pillRow.style.display = 'flex';
    pillRow.style.flexWrap = 'wrap';
    pillRow.style.gap = '8px';

    pillRow.appendChild(this.createPillButton('Favorites', async () => {
      if (this.shuffleMode > 0) return;
      this.selectedSavedFilter = undefined;
      this.selectedPerformerId = undefined;
      this.selectedPerformerName = undefined;
      try {
        const favoriteTag = await this.api.findTagByName('StashGifs Favorite');
        if (favoriteTag) {
          this.selectedTagId = Number.parseInt(favoriteTag.id, 10);
          this.selectedTagName = 'Favorites';
        } else {
          this.selectedTagId = undefined;
          this.selectedTagName = undefined;
        }
      } catch (error) {
        console.error('Failed to load favorite tag', error);
        this.selectedTagId = undefined;
        this.selectedTagName = undefined;
      }
      this.closeSuggestions();
      updateSearchBarDisplay();
      apply();
    }));

    for (const filter of this.savedFiltersCache) {
      pillRow.appendChild(this.createPillButton(filter.name, () => {
        if (this.shuffleMode > 0) return;
        this.selectedSavedFilter = { id: filter.id, name: filter.name };
        this.selectedTagId = undefined;
        this.selectedTagName = undefined;
        this.selectedPerformerId = undefined;
        this.selectedPerformerName = undefined;
        this.closeSuggestions();
        updateSearchBarDisplay();
        this.currentFilters = { savedFilterId: filter.id, limit: this.initialLoadLimit, offset: 0 };
        this.clearContentRatio(); // Clear ratio so it's recalculated with new filter
        this.loadVideos(this.currentFilters, false).catch((e) => console.error('Apply saved filter failed', e));
      }));
    }

    filtersSection.appendChild(pillRow);
    container.appendChild(filtersSection);
  }

  /**
   * Create tags section
   */
  private createTagsSection(
    container: HTMLElement,
    tags: Array<{ id: string; name: string }>,
    alignmentOffset: number,
    updateSearchBarDisplay: () => void,
    apply: () => Promise<void>,
    label: string = 'Tags'
  ): void {
    if (tags.length === 0) return;

    const tagsSection = document.createElement('div');
    tagsSection.style.display = 'flex';
    tagsSection.style.flexDirection = 'column';
    tagsSection.style.gap = '8px';
    tagsSection.style.marginLeft = `${alignmentOffset}px`;
    tagsSection.appendChild(this.createSectionLabel(label));

    for (const tag of tags) {
      tagsSection.appendChild(
        this.createListButton(tag.name, () => {
          if (this.shuffleMode > 0) return;
          this.selectedSavedFilter = undefined;
          this.selectedPerformerId = undefined;
          this.selectedPerformerName = undefined;
          this.selectedTagId = Number.parseInt(tag.id, 10);
          this.selectedTagName = tag.name;
          this.closeSuggestions();
          updateSearchBarDisplay();
          apply();
        }, { leadingText: '#' })
      );
    }
    container.appendChild(tagsSection);
  }

  /**
   * Create performers section
   */
  private createPerformersSection(
    container: HTMLElement,
    performers: Array<{ id: string; name: string; image_path?: string }>,
    alignmentOffset: number,
    updateSearchBarDisplay: () => void,
    apply: () => Promise<void>,
    label: string = 'Performers'
  ): void {
    if (performers.length === 0) return;

    const performersSection = document.createElement('div');
    performersSection.style.display = 'flex';
    performersSection.style.flexDirection = 'column';
    performersSection.style.gap = '8px';
    performersSection.style.marginLeft = `${alignmentOffset}px`;
    performersSection.appendChild(this.createSectionLabel(label));

    for (const performer of performers) {
      const performerId = Number.parseInt(performer.id, 10);
      let imageSrc: string | undefined;
      if (performer.image_path) {
        imageSrc = performer.image_path.startsWith('http')
          ? performer.image_path
          : `${globalThis.location.origin}${performer.image_path}`;
      }
      performersSection.appendChild(
        this.createListButton(
          performer.name,
          () => {
            if (this.shuffleMode > 0) return;
            this.selectedSavedFilter = undefined;
            this.selectedTagId = undefined;
            this.selectedTagName = undefined;
            this.selectedPerformerId = performerId;
            this.selectedPerformerName = performer.name;
            this.closeSuggestions();
            updateSearchBarDisplay();
            apply();
          },
          { leadingImage: imageSrc, leadingText: imageSrc ? undefined : performer.name.charAt(0).toUpperCase() }
        )
      );
    }
    container.appendChild(performersSection);
  }

  /**
   * Render default suggestions view
   */
  private async renderDefaultSuggestionsView(
    container: HTMLElement,
    suggestions: HTMLElement,
    horizontalPadding: number,
    ensureLatest: () => boolean,
    onHDToggleClick: () => void,
    updateSearchBarDisplay: () => void,
    apply: () => Promise<void>
  ): Promise<void> {
    while (container.firstChild) {
      container.firstChild.remove();
    }

    const alignmentOffset = this.calculateAlignmentOffset(container, horizontalPadding);

    this.createPlaybackControlsSection(container, alignmentOffset, onHDToggleClick, updateSearchBarDisplay);

    await this.loadSavedFiltersIfNeeded();
    if (!ensureLatest()) return;

    this.createSavedFiltersSection(container, alignmentOffset, updateSearchBarDisplay, apply);

    let loadingSection: HTMLElement | null = null;
    let loadingTimeout: ReturnType<typeof setTimeout> | null = null;
    let loadingSectionCreated = false;

    const showLoadingSkeletons = () => {
      if (loadingSectionCreated) return;
      loadingSectionCreated = true;
      loadingSection = this.createLoadingSkeletons();
      container.appendChild(loadingSection);
    };

    suggestions.style.display = 'flex';
    this.lockBodyScroll();

    loadingTimeout = setTimeout(() => {
      if (!ensureLatest()) return;
      showLoadingSkeletons();
    }, 200);

    let freshTags: Array<{ id: string; name: string }> = [];
    let freshPerformers: Array<{ id: string; name: string; image_path?: string }> = [];

    try {
      [freshTags, freshPerformers] = await Promise.all([
        this.api.searchMarkerTags('', 3),
        this.api.searchPerformers('', 3)
      ]);
      if (!ensureLatest()) return;
      this.preloadedTags = freshTags;
      this.preloadedPerformers = freshPerformers;
    } catch (error) {
      console.warn('Failed to fetch suggestions', error);
      if (!ensureLatest()) return;
    }

    if (loadingTimeout) {
      clearTimeout(loadingTimeout);
      loadingTimeout = null;
    }

    if (loadingSectionCreated && loadingSection) {
      const section: HTMLElement = loadingSection;
      section.remove();
    }

    const availableTags = freshTags
      .filter((tag) => {
        const tagId = Number.parseInt(tag.id, 10);
        return !Number.isNaN(tagId) && this.selectedTagId !== tagId;
      })
      .slice(0, 3);

    this.createTagsSection(container, availableTags, alignmentOffset, updateSearchBarDisplay, apply, 'Suggested Tags');

    const availablePerformers = freshPerformers
      .filter((performer) => {
        const performerId = Number.parseInt(performer.id, 10);
        return !Number.isNaN(performerId) && this.selectedPerformerId !== performerId;
      })
      .slice(0, 3);

    this.createPerformersSection(container, availablePerformers, alignmentOffset, updateSearchBarDisplay, apply, 'Suggested Performers');

    if (container.children.length === 0) {
      this.appendEmptyState(container, 'No suggestions available yet.');
    }

    suggestions.scrollTop = 0;
  }

  /**
   * Render search results view
   */
  private async renderSearchResultsView(
    container: HTMLElement,
    suggestions: HTMLElement,
    trimmedText: string,
    horizontalPadding: number,
    ensureLatest: () => boolean,
    updateSearchBarDisplay: () => void,
    apply: () => Promise<void>
  ): Promise<void> {
    container.innerHTML = '';

    if (this.shuffleMode > 0) {
      container.innerHTML = '';
      const banner = document.createElement('div');
      banner.style.display = 'flex';
      banner.style.justifyContent = 'center';
      banner.style.alignItems = 'center';
      banner.style.padding = '16px';
      const notice = document.createElement('div');
      notice.textContent = 'Random mode active — search disabled';
      notice.style.padding = '8px 12px';
      notice.style.borderRadius = '999px';
      notice.style.background = 'rgba(255,255,255,0.08)';
      notice.style.border = '1px solid rgba(255,255,255,0.12)';
      notice.style.color = 'rgba(255,255,255,0.85)';
      notice.style.fontSize = '13px';
      banner.appendChild(notice);
      container.appendChild(banner);
      suggestions.scrollTop = 0;
      return;
    }

    await this.loadSavedFiltersIfNeeded();

    const alignmentOffsetForResults = this.calculateAlignmentOffset(container, horizontalPadding);

    const matchingSavedFilters = this.savedFiltersCache
      .filter((filter) => filter.name.toLowerCase().includes(trimmedText.toLowerCase()))
      .slice(0, 6);

    if (matchingSavedFilters.length > 0 && this.shuffleMode === 0) {
      const savedSection = document.createElement('div');
      savedSection.style.display = 'flex';
      savedSection.style.flexDirection = 'column';
      savedSection.style.gap = '8px';
      savedSection.style.marginLeft = `${alignmentOffsetForResults}px`;
      savedSection.appendChild(this.createSectionLabel('Matching Saved Filters'));
      for (const filter of matchingSavedFilters) {
        savedSection.appendChild(
          this.createListButton(filter.name, () => {
            this.selectedSavedFilter = { id: filter.id, name: filter.name };
            this.selectedTagId = undefined;
            this.selectedTagName = undefined;
            this.selectedPerformerId = undefined;
            this.selectedPerformerName = undefined;
            this.closeSuggestions();
            updateSearchBarDisplay();
            this.currentFilters = { savedFilterId: filter.id, limit: this.initialLoadLimit, offset: 0 };
            this.clearContentRatio(); // Clear ratio so it's recalculated with new filter
            this.loadVideos(this.currentFilters, false).catch((e) => console.error('Apply saved filter failed', e));
          })
        );
      }
      container.appendChild(savedSection);
    }

    let tagItems: Array<{ id: string; name: string }> = [];
    let performerItems: Array<{ id: string; name: string; image_path?: string }> = [];

    try {
      [tagItems, performerItems] = await Promise.all([
        this.api.searchMarkerTags(trimmedText, 20),
        this.api.searchPerformers(trimmedText, 20)
      ]);
    } catch (error) {
      console.warn('Failed to fetch search suggestions', error);
    }

    if (!ensureLatest()) return;

    const filteredTags = tagItems
      .filter((tag) => {
        const tagId = Number.parseInt(tag.id, 10);
        return !Number.isNaN(tagId) && this.selectedTagId !== tagId;
      })
      .slice(0, 20);

    this.createTagsSection(container, filteredTags, alignmentOffsetForResults, updateSearchBarDisplay, apply);

    const filteredPerformers = performerItems
      .filter((performer) => {
        const performerId = Number.parseInt(performer.id, 10);
        return !Number.isNaN(performerId) && this.selectedPerformerId !== performerId;
      })
      .slice(0, 20);

    this.createPerformersSection(container, filteredPerformers, alignmentOffsetForResults, updateSearchBarDisplay, apply);

    if (container.children.length === 0) {
      this.appendEmptyState(container, `No matches found for "${trimmedText}".`);
    }

    suggestions.scrollTop = 0;
  }

  /**
   * Create a suggestion chip button
   */
  private createSuggestionChip(
    text: string,
    onClick: () => void,
    isSelected: boolean = false
  ): HTMLElement {
    const chip = document.createElement('button');
    chip.textContent = text;
    chip.className = 'suggest-chip';
    chip.style.padding = '6px 10px';
    chip.style.borderRadius = '999px';
    chip.style.border = '1px solid rgba(255,255,255,0.12)';
    chip.style.background = isSelected ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)';
    chip.style.color = 'inherit';
    chip.style.fontSize = '13px';
    chip.style.cursor = 'pointer';
    chip.addEventListener('mouseenter', () => { chip.style.background = 'rgba(255,255,255,0.1)'; });
    chip.addEventListener('mouseleave', () => { chip.style.background = isSelected ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)'; });
    chip.addEventListener('click', onClick);
    return chip;
  }

  /**
   * Create a section label for suggestions
   */
  private createSuggestionLabel(text: string): HTMLElement {
    const label = document.createElement('div');
    label.textContent = text;
    label.style.opacity = '0.75';
    label.style.fontSize = '12px';
    label.style.width = '100%';
    label.style.marginBottom = '6px';
    return label;
  }

  /**
   * Create a divider for suggestions
   */
  private createSuggestionDivider(): HTMLElement {
    const divider = document.createElement('div');
    divider.style.width = '100%';
    divider.style.height = '1px';
    divider.style.background = 'rgba(255,255,255,0.08)';
    divider.style.margin = '6px 0';
    return divider;
  }

  /**
   * Render saved filters as suggestion chips
   */
  private renderSavedFiltersSuggestions(
    container: HTMLElement,
    savedSelect: HTMLSelectElement,
    updateSearchBarDisplay: () => void,
    apply: () => Promise<void>,
    queryInput: HTMLInputElement
  ): void {
    if (this.savedFiltersCache.length === 0) return;

    container.appendChild(this.createSuggestionLabel('Saved Filters'));

    for (const f of this.savedFiltersCache) {
      const chip = this.createSuggestionChip(f.name, () => {
        savedSelect.value = f.id;
        this.selectedSavedFilter = { id: f.id, name: f.name };
        this.selectedTagId = undefined;
        this.selectedTagName = undefined;
        queryInput.value = '';
        this.closeSuggestions();
        updateSearchBarDisplay();
        apply();
      });
      container.appendChild(chip);
    }
  }

  /**
   * Render tags as suggestion chips
   */
  private renderTagsSuggestions(
    container: HTMLElement,
    tags: Array<{ id: string; name: string }>,
    savedSelect: HTMLSelectElement,
    updateSearchBarDisplay: () => void,
    apply: () => Promise<void>,
    refreshSuggestions: (text: string) => void,
    trimmedText: string
  ): void {
    for (const tag of tags) {
      if (this.selectedTagId === Number.parseInt(tag.id, 10)) continue;
      if (tag.name === 'StashGifs Favorite' || tag.name === 'StashGifs Marker') continue;

      const chip = this.createSuggestionChip(tag.name, () => {
        this.selectedSavedFilter = undefined;
        savedSelect.value = '';
        const tagId = Number.parseInt(tag.id, 10);
        this.selectedTagId = tagId;
        this.selectedTagName = tag.name;
        updateSearchBarDisplay();
        apply();
        refreshSuggestions(trimmedText);
      });
      container.appendChild(chip);
    }
  }

  /**
   * Render performers as suggestion chips
   */
  private renderPerformersSuggestions(
    container: HTMLElement,
    performers: Array<{ id: string; name: string; image_path?: string }>,
    savedSelect: HTMLSelectElement,
    updateSearchBarDisplay: () => void,
    apply: () => Promise<void>,
    refreshSuggestions: (text: string) => void
  ): void {
    if (performers.length === 0) return;

    if (container.children.length > 0) {
      container.appendChild(this.createSuggestionDivider());
    }

    for (const performer of performers) {
      if (this.selectedPerformerId === Number.parseInt(performer.id, 10)) continue;

      const chip = this.createSuggestionChip(performer.name, () => {
        this.selectedSavedFilter = undefined;
        savedSelect.value = '';
        const performerId = Number.parseInt(performer.id, 10);
        this.selectedPerformerId = performerId;
        this.selectedPerformerName = performer.name;
        updateSearchBarDisplay();
        apply();
        refreshSuggestions('');
      });
      container.appendChild(chip);
    }
  }

  /**
   * Create loading skeleton chips
   */
  private createLoadingSkeletonChips(container: HTMLElement): void {
    for (let i = 0; i < 6; i++) {
      const skeletonChip = document.createElement('div');
      skeletonChip.className = 'chip-skeleton';
      skeletonChip.dataset.suggestionSkeleton = 'true';
      skeletonChip.style.display = 'inline-block';
      skeletonChip.style.padding = '6px 10px';
      skeletonChip.style.borderRadius = '999px';
      skeletonChip.style.height = '28px';
      skeletonChip.style.marginRight = '8px';
      skeletonChip.style.marginBottom = '8px';
      const widths = [70, 85, 65, 90, 75, 80];
      skeletonChip.style.width = `${widths[i % widths.length]}px`;
      container.appendChild(skeletonChip);
    }
  }

  /**
   * Remove loading skeleton chips
   */
  private removeLoadingSkeletonChips(container: HTMLElement): void {
    const skeletonChips = Array.from(container.querySelectorAll('[data-suggestion-skeleton="true"]'));
    for (const chip of skeletonChips) {
      chip.remove();
    }
  }

  /**
   * Render default suggestions (empty text with forceShow)
   */
  private async renderDefaultSuggestionsChips(
    suggestions: HTMLElement,
    signal: AbortSignal,
    savedSelect: HTMLSelectElement,
    updateSearchBarDisplay: () => void,
    apply: () => Promise<void>,
    queryInput: HTMLInputElement,
    refreshSuggestions: (text: string, page: number, forceShow: boolean) => void
  ): Promise<void> {
    await this.loadSavedFiltersIfNeeded();
    if (signal.aborted) return;

    if (this.savedFiltersCache.length > 0) {
      this.renderSavedFiltersSuggestions(suggestions, savedSelect, updateSearchBarDisplay, apply, queryInput);
      suggestions.appendChild(this.createSuggestionDivider());
    }

    let loadingTimeout: ReturnType<typeof setTimeout> | null = null;
    let loadingContainerCreated = false;

    const showLoadingSkeletons = () => {
      if (loadingContainerCreated) return;
      loadingContainerCreated = true;
      this.createLoadingSkeletonChips(suggestions);
    };

    suggestions.style.display = 'flex';

    loadingTimeout = setTimeout(() => {
      if (signal.aborted) return;
      showLoadingSkeletons();
    }, 200);

    const [tags, performers] = await Promise.all([
      this.api.searchMarkerTags('', 3, signal),
      this.api.searchPerformers('', 3, signal)
    ]);
    if (signal.aborted) return;

    if (loadingTimeout) {
      clearTimeout(loadingTimeout);
      loadingTimeout = null;
    }

    if (loadingContainerCreated) {
      this.removeLoadingSkeletonChips(suggestions);
    }

    this.renderTagsSuggestions(suggestions, tags, savedSelect, updateSearchBarDisplay, apply, (text) => refreshSuggestions(text, 1, false), '');
    this.renderPerformersSuggestions(suggestions, performers, savedSelect, updateSearchBarDisplay, apply, (text) => refreshSuggestions(text, 1, true));

    suggestions.style.display = suggestions.children.length > 0 ? 'flex' : 'none';
  }

  /**
   * Create "More results" button
   */
  private createMoreResultsButton(params: {
    container: HTMLElement;
    trimmedText: string;
    pageSize: number;
    signal: AbortSignal;
    savedSelect: HTMLSelectElement;
    updateSearchBarDisplay: () => void;
    apply: () => Promise<void>;
    refreshSuggestions: (text: string, page: number, forceShow: boolean) => Promise<void>;
    onPageIncrement: () => void;
  }): HTMLElement {
    const more = document.createElement('button');
    more.dataset.more = '1';
    more.textContent = 'More results…';
    more.style.padding = '8px 10px';
    more.style.borderRadius = '10px';
    more.style.border = '1px solid rgba(255,255,255,0.12)';
    more.style.background = 'rgba(255,255,255,0.06)';
    more.style.cursor = 'pointer';
    more.style.width = '100%';
    more.style.marginTop = '4px';
    more.addEventListener('click', async () => {
      params.onPageIncrement();
      const next = await this.api.searchMarkerTags(params.trimmedText, params.pageSize, params.signal);
      if (params.signal.aborted) return;
      this.renderTagsSuggestions(
        params.container,
        next,
        params.savedSelect,
        params.updateSearchBarDisplay,
        params.apply,
        (text) => { params.refreshSuggestions(text, 1, false).catch(() => {}); },
        params.trimmedText
      );
      if (next.length < params.pageSize) {
        more.remove();
      }
    });
    return more;
  }

  /**
   * Create header element with proper styling
   */
  private createHeaderElement(): HTMLElement {
    const header = document.createElement('div');
    this.headerBar = header;
    header.className = 'feed-header-bar';
    header.style.position = 'sticky';
    
    const nav = globalThis.navigator;
    const isStandalone = (isStandaloneNavigator(nav) && nav.standalone) || 
                         globalThis.matchMedia('(display-mode: standalone)').matches;
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    
    if (isStandalone && isIOS) {
      header.style.top = 'calc(env(safe-area-inset-top, 0px) * 0.7)';
      header.style.paddingTop = '8px';
      header.style.paddingBottom = '8px';
      header.style.paddingLeft = '12px';
      header.style.paddingRight = '12px';
    } else {
      header.style.top = '0';
      header.style.padding = '8px 12px';
    }
    
    header.style.width = '100%';
    header.style.maxWidth = `${this.settings.cardMaxWidth + 24}px`;
    header.style.marginLeft = 'auto';
    header.style.marginRight = 'auto';
    
    if (isStandalone && isIOS) {
      header.style.minHeight = '72px';
      header.style.height = 'auto';
    } else {
      header.style.height = '72px';
    }
    
    header.style.zIndex = '1001';
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'flex-start';
    header.style.transition = 'transform 0.24s var(--ease-spring, ease), opacity 0.24s var(--ease-spring, ease)';
    header.style.boxSizing = 'border-box';
    header.style.transform = 'translateY(0)';
    header.style.willChange = 'transform, opacity';
    
    return header;
  }

  /**
   * Create header inner container with grid layout
   */
  private createHeaderInnerContainer(): HTMLElement {
    const headerInner = document.createElement('div');
    headerInner.style.display = 'grid';
    headerInner.style.gridTemplateColumns = 'auto 1fr auto';
    headerInner.style.alignItems = 'center';
    headerInner.style.gap = '12px';
    headerInner.style.width = '100%';
    headerInner.style.height = '100%';
    headerInner.style.maxWidth = `${this.settings.cardMaxWidth}px`;
    headerInner.style.marginLeft = '0';
    headerInner.style.marginRight = '0';
    headerInner.style.boxSizing = 'border-box';
    headerInner.style.flex = '1 1 auto';
    return headerInner;
  }

  /**
   * Create search area container
   */
  private createSearchArea(): HTMLElement {
    const searchArea = document.createElement('div');
    searchArea.style.position = 'relative';
    searchArea.style.width = '100%';
    searchArea.style.minWidth = '0';
    searchArea.style.maxWidth = '100%';
    searchArea.style.overflow = 'hidden';
    searchArea.style.boxSizing = 'border-box';
    searchArea.style.marginRight = '0';
    return searchArea;
  }

  /**
   * Create tag header element
   */
  private createTagHeader(): HTMLElement {
    const tagHeader = document.createElement('div');
    tagHeader.className = 'feed-filters__tag-header';
    tagHeader.style.display = 'none';
    tagHeader.style.padding = '12px 14px';
    tagHeader.style.marginTop = '8px';
    tagHeader.style.width = '100%';
    tagHeader.style.boxSizing = 'border-box';
    tagHeader.style.fontSize = '17px';
    tagHeader.style.fontWeight = '600';
    tagHeader.style.color = '#FFFFFF';
    return tagHeader;
  }

  /**
   * Create brand container with logo and refresh functionality
   */
  private createBrandContainer(headerInner: HTMLElement): HTMLElement {
    const brandContainer = document.createElement('div');
    brandContainer.style.display = 'inline-flex';
    brandContainer.style.alignItems = 'center';
    brandContainer.style.height = '44px';
    brandContainer.style.padding = '0 14px';
    brandContainer.style.borderRadius = '10px';
    brandContainer.style.border = '1px solid rgba(255,255,255,0.12)';
    brandContainer.style.background = 'rgba(28, 28, 30, 0.9)';
    brandContainer.style.cursor = 'pointer';
    brandContainer.style.transition = 'background 0.2s ease, border-color 0.2s ease, opacity 0.2s ease';
    brandContainer.title = 'Click to refresh feed';
    
    const brand = document.createElement('div');
    brand.textContent = 'stashgifs';
    brand.style.fontWeight = '700';
    brand.style.letterSpacing = '0.5px';
    brand.style.color = '#F5C518';
    brand.style.fontSize = '17px';
    brand.style.lineHeight = '1.2';
    brand.style.userSelect = 'none';
    brand.style.transition = 'opacity 0.2s ease';
    
    brandContainer.addEventListener('mouseenter', () => {
      brandContainer.style.background = 'rgba(28, 28, 30, 0.95)';
      brandContainer.style.borderColor = 'rgba(255,255,255,0.16)';
      brand.style.opacity = '0.9';
    });
    brandContainer.addEventListener('mouseleave', () => {
      brandContainer.style.background = 'rgba(28, 28, 30, 0.9)';
      brandContainer.style.borderColor = 'rgba(255,255,255,0.12)';
      brand.style.opacity = '1';
    });
    
    brandContainer.addEventListener('click', () => {
      this.refreshFeed().catch((e) => console.error('Failed to refresh feed', e));
    });
    
    brandContainer.appendChild(brand);
    headerInner.appendChild(brandContainer);
    return brandContainer;
  }

  /**
   * Setup search input with placeholder animation and all related elements
   */
  private setupSearchInput(): {
    inputWrapper: HTMLElement;
    queryInput: HTMLInputElement;
    placeholderWrapper: HTMLElement;
    loadingSpinner: HTMLElement;
    shuffleIndicator: HTMLElement;
    randomLeftIcon: HTMLElement;
    updatePlaceholderVisibility: () => void;
  } {
    const inputWrapper = document.createElement('div');
    inputWrapper.style.position = 'relative';
    inputWrapper.style.width = '100%';
    inputWrapper.style.minWidth = '0';
    inputWrapper.style.boxSizing = 'border-box';
    inputWrapper.style.marginRight = '0';

    const queryInput = this.createQueryInput();
    const placeholderSetup = this.setupPlaceholderAnimation(queryInput);
    const placeholderWrapper = placeholderSetup.placeholderWrapper;
    const randomLeftIcon = this.createRandomLeftIcon();
    const loadingSpinner = this.createLoadingSpinner();
    const shuffleIndicator = this.createShuffleIndicator();

    inputWrapper.appendChild(placeholderWrapper);
    inputWrapper.appendChild(randomLeftIcon);
    inputWrapper.appendChild(loadingSpinner);
    inputWrapper.appendChild(shuffleIndicator);

    this.setupInputEventHandlers(queryInput, placeholderWrapper, placeholderSetup);

    return {
      inputWrapper,
      queryInput,
      placeholderWrapper,
      loadingSpinner,
      shuffleIndicator,
      randomLeftIcon,
      updatePlaceholderVisibility: placeholderSetup.updatePlaceholderVisibility,
    };
  }

  /**
   * Create query input element
   */
  private createQueryInput(): HTMLInputElement {
    const queryInput = document.createElement('input');
    queryInput.type = 'text';
    queryInput.placeholder = '';
    queryInput.className = 'feed-filters__input';
    queryInput.style.transition = 'background 0.2s ease, border-color 0.2s ease';
    queryInput.style.width = '100%';
    queryInput.style.minWidth = '0';
    queryInput.style.height = '44px';
    queryInput.style.padding = '0 14px';
    queryInput.style.borderRadius = '10px';
    queryInput.style.border = '1px solid rgba(255,255,255,0.12)';
    queryInput.style.background = 'rgba(28, 28, 30, 0.9)';
    queryInput.style.color = 'inherit';
    queryInput.style.fontSize = '15px';
    queryInput.style.lineHeight = '1.4';
    queryInput.style.boxSizing = 'border-box';
    queryInput.style.color = 'rgba(255, 255, 255, 0.9)';
    queryInput.style.caretColor = '#FFFFFF';
    return queryInput;
  }

  /**
   * Setup placeholder animation
   */
  private setupPlaceholderAnimation(queryInput: HTMLInputElement): {
    placeholderWrapper: HTMLElement;
    updatePlaceholderVisibility: () => void;
    startPlaceholderAnimation: () => void;
    stopPlaceholderAnimation: () => void;
  } {
    const dynamicPlaceholders = ['performers', 'tags', 'filters', 'favorites'];
    
    const placeholderWrapper = document.createElement('div');
    placeholderWrapper.id = 'feed-search-placeholder';
    placeholderWrapper.style.position = 'absolute';
    placeholderWrapper.style.left = '14px';
    placeholderWrapper.style.top = '50%';
    placeholderWrapper.style.transform = 'translateY(-50%)';
    placeholderWrapper.style.pointerEvents = 'none';
    placeholderWrapper.style.overflow = 'visible';
    placeholderWrapper.style.width = 'calc(100% - 28px)';
    placeholderWrapper.style.height = '20px';
    placeholderWrapper.style.color = 'rgba(255, 255, 255, 0.5)';
    placeholderWrapper.style.fontSize = '15px';
    placeholderWrapper.style.lineHeight = '20px';
    placeholderWrapper.style.whiteSpace = 'nowrap';
    
    const staticText = document.createElement('span');
    staticText.textContent = 'Search ';
    staticText.style.display = 'inline-block';
    staticText.style.marginRight = '4px';
    
    const dynamicContainer = document.createElement('span');
    dynamicContainer.style.display = 'inline-block';
    dynamicContainer.style.position = 'relative';
    dynamicContainer.style.overflow = 'hidden';
    dynamicContainer.style.verticalAlign = 'top';
    dynamicContainer.style.minWidth = '80px';
    
    let currentPlaceholderIndex = 0;
    let placeholderText: HTMLElement | null = null;
    
    const createPlaceholderText = (text: string, isEntering: boolean = false) => {
      const textEl = document.createElement('span');
      textEl.textContent = text;
      textEl.style.display = 'inline-block';
      textEl.style.transition = 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.5s ease';
      textEl.style.transform = isEntering ? 'translateX(100%)' : 'translateX(0)';
      textEl.style.opacity = isEntering ? '0' : '1';
      textEl.style.whiteSpace = 'nowrap';
      textEl.style.fontWeight = 'bold';
      textEl.style.color = '#F5C518';
      return textEl;
    };
    
    if (dynamicPlaceholders[0]) {
      placeholderText = createPlaceholderText(dynamicPlaceholders[0]);
      dynamicContainer.appendChild(placeholderText);
    }
    
    placeholderWrapper.appendChild(staticText);
    placeholderWrapper.appendChild(dynamicContainer);
    
    const updatePlaceholderVisibility = () => {
      if (queryInput.value || document.activeElement === queryInput) {
        placeholderWrapper.style.display = 'none';
      } else {
        placeholderWrapper.style.display = 'block';
      }
    };
    
    const updatePlaceholder = () => {
      if (!placeholderText || !dynamicContainer) return;
      
      placeholderText.style.transform = 'translateX(-100%)';
      placeholderText.style.opacity = '0';
      
      setTimeout(() => {
        placeholderText?.remove();
        currentPlaceholderIndex = (currentPlaceholderIndex + 1) % dynamicPlaceholders.length;
        const nextPlaceholder = dynamicPlaceholders[currentPlaceholderIndex];
        if (nextPlaceholder) {
          placeholderText = createPlaceholderText(nextPlaceholder, true);
          dynamicContainer.appendChild(placeholderText);
        }
        
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        dynamicContainer.offsetHeight;
        
        setTimeout(() => {
          if (placeholderText) {
            placeholderText.style.transform = 'translateX(0)';
            placeholderText.style.opacity = '1';
          }
        }, 10);
      }, 250);
    };
    
    const startPlaceholderAnimation = () => {
      if (this.placeholderAnimationInterval) return;
      this.placeholderAnimationInterval = setInterval(() => {
        if (document.activeElement !== queryInput && !queryInput.value) {
          updatePlaceholder();
        }
      }, 3000);
    };
    
    const stopPlaceholderAnimation = () => {
      if (this.placeholderAnimationInterval) {
        clearInterval(this.placeholderAnimationInterval);
        this.placeholderAnimationInterval = undefined;
      }
    };
    
    setTimeout(() => {
      if (document.activeElement !== queryInput && !queryInput.value) {
        startPlaceholderAnimation();
      }
    }, 1000);
    
    return {
      placeholderWrapper,
      updatePlaceholderVisibility,
      startPlaceholderAnimation,
      stopPlaceholderAnimation,
    };
  }

  /**
   * Setup input event handlers for placeholder animation
   */
  private setupInputEventHandlers(
    queryInput: HTMLInputElement,
    placeholderWrapper: HTMLElement,
    placeholderSetup: ReturnType<typeof this.setupPlaceholderAnimation>
  ): void {
    queryInput.addEventListener('focus', () => {
      placeholderSetup.stopPlaceholderAnimation();
      placeholderSetup.updatePlaceholderVisibility();
    });
    
    queryInput.addEventListener('blur', () => {
      placeholderSetup.updatePlaceholderVisibility();
      if (!queryInput.value) {
        setTimeout(() => placeholderSetup.startPlaceholderAnimation(), 500);
      }
    });
    
    queryInput.addEventListener('input', () => {
      placeholderSetup.updatePlaceholderVisibility();
      if (queryInput.value) {
        placeholderSetup.stopPlaceholderAnimation();
      } else {
        setTimeout(() => placeholderSetup.startPlaceholderAnimation(), 500);
      }
    });
  }

  /**
   * Create random left icon for shuffle mode
   */
  private createRandomLeftIcon(): HTMLElement {
    const randomLeftIcon = document.createElement('div');
    randomLeftIcon.style.position = 'absolute';
    randomLeftIcon.style.left = '14px';
    randomLeftIcon.style.top = '50%';
    randomLeftIcon.style.transform = 'translateY(-50%)';
    randomLeftIcon.style.display = this.shuffleMode > 0 ? 'inline-flex' : 'none';
    randomLeftIcon.style.alignItems = 'center';
    randomLeftIcon.style.gap = '8px';
    randomLeftIcon.style.color = 'rgba(255,255,255,0.5)';
    randomLeftIcon.style.fontSize = '15px';
    randomLeftIcon.style.lineHeight = '20px';
    randomLeftIcon.style.pointerEvents = 'none';
    
    const randomLeftIconSpan = document.createElement('span');
    randomLeftIconSpan.innerHTML = RANDOM_SVG;
    randomLeftIconSpan.querySelector('svg')?.setAttribute('width', '16');
    randomLeftIconSpan.querySelector('svg')?.setAttribute('height', '16');
    const randomLeftText = document.createElement('span');
    randomLeftText.textContent = 'Discovering randomly';
    randomLeftIcon.appendChild(randomLeftIconSpan);
    randomLeftIcon.appendChild(randomLeftText);
    
    return randomLeftIcon;
  }

  /**
   * Create loading spinner for search input
   */
  private createLoadingSpinner(): HTMLElement {
    const loadingSpinner = document.createElement('div');
    loadingSpinner.className = 'feed-search-loading';
    loadingSpinner.style.display = 'none';
    loadingSpinner.style.position = 'absolute';
    loadingSpinner.style.right = '14px';
    loadingSpinner.style.top = '50%';
    loadingSpinner.style.transform = 'translateY(-50%)';
    loadingSpinner.style.width = '16px';
    loadingSpinner.style.height = '16px';
    loadingSpinner.style.border = '2px solid rgba(255,255,255,0.3)';
    loadingSpinner.style.borderTopColor = 'rgba(255,255,255,0.8)';
    loadingSpinner.style.borderRadius = '50%';
    loadingSpinner.style.animation = 'spin 0.8s linear infinite';
    loadingSpinner.style.willChange = 'transform';
    return loadingSpinner;
  }

  /**
   * Create shuffle indicator element
   */
  private createShuffleIndicator(): HTMLElement {
    const shuffleIndicator = document.createElement('div');
    shuffleIndicator.className = 'feed-random-indicator';
    shuffleIndicator.style.position = 'absolute';
    shuffleIndicator.style.right = '40px';
    shuffleIndicator.style.top = '50%';
    shuffleIndicator.style.transform = 'translateY(-50%)';
    shuffleIndicator.style.display = 'none';
    shuffleIndicator.style.alignItems = 'center';
    shuffleIndicator.style.gap = '6px';
    shuffleIndicator.style.padding = '4px 8px';
    shuffleIndicator.style.borderRadius = '999px';
    shuffleIndicator.style.border = '1px solid rgba(255,255,255,0.12)';
    shuffleIndicator.style.background = 'rgba(33, 150, 243, 0.18)';
    shuffleIndicator.style.color = 'rgba(255,255,255,0.85)';
    shuffleIndicator.style.fontSize = '12px';
    shuffleIndicator.style.pointerEvents = 'none';
    
    const randomIconSvg = document.createElement('span');
    randomIconSvg.innerHTML = SHUFFLE_CHECK_SVG;
    randomIconSvg.querySelector('svg')?.setAttribute('width', '14');
    randomIconSvg.querySelector('svg')?.setAttribute('height', '14');
    const shuffleText = document.createElement('span');
    shuffleText.textContent = 'Random';
    shuffleIndicator.appendChild(randomIconSvg);
    shuffleIndicator.appendChild(shuffleText);
    
    return shuffleIndicator;
  }

  /**
   * Setup header buttons (HD toggle, volume toggle, shuffle toggle)
   */
  private setupHeaderButtons(): {
    buttonsContainer: HTMLElement;
    volToggle: HTMLButtonElement;
    hdToggle: HTMLButtonElement;
    shuffleToggle: HTMLButtonElement;
    onHDToggleClick: () => void;
  } {
    const buttonsContainer = document.createElement('div');
    buttonsContainer.style.display = 'inline-flex';
    buttonsContainer.style.alignItems = 'center';
    buttonsContainer.style.gap = '8px';
    buttonsContainer.style.height = '36px';

    const hdToggleResult = this.createHDToggleButton();
    const hdToggle = hdToggleResult.button;
    const onHDToggleClick = hdToggleResult.onClick;
    const volToggle = this.createVolumeToggleButton();
    const shuffleToggle = this.createShuffleToggleButton(hdToggle);

    buttonsContainer.appendChild(volToggle);

    return {
      buttonsContainer,
      volToggle,
      hdToggle,
      shuffleToggle,
      onHDToggleClick,
    };
  }

  /**
   * Create settings button
   */
  private createSettingsButton(): HTMLButtonElement {
    const settingsButton = document.createElement('button');
    settingsButton.type = 'button';
    settingsButton.title = 'Settings';
    settingsButton.setAttribute('aria-label', 'Open settings');
    settingsButton.style.padding = '10px 12px';
    settingsButton.style.borderRadius = '10px';
    settingsButton.style.border = '1px solid rgba(255,255,255,0.12)';
    settingsButton.style.background = 'rgba(28, 28, 30, 0.9)';
    settingsButton.style.color = '#F5C518';
    settingsButton.style.cursor = 'pointer';
    settingsButton.style.display = 'inline-flex';
    settingsButton.style.alignItems = 'center';
    settingsButton.style.justifyContent = 'center';
    settingsButton.style.transition = 'background 0.2s ease, border-color 0.2s ease, color 0.2s ease';
    // Standard settings/gear icon
    settingsButton.innerHTML = SETTINGS_SVG;

    settingsButton.addEventListener('mouseenter', () => {
      settingsButton.style.color = '#FFD54F';
      settingsButton.style.background = 'rgba(28, 28, 30, 0.95)';
      settingsButton.style.borderColor = 'rgba(255,255,255,0.18)';
    });

    settingsButton.addEventListener('mouseleave', () => {
      settingsButton.style.color = '#F5C518';
      settingsButton.style.background = 'rgba(28, 28, 30, 0.9)';
      settingsButton.style.borderColor = 'rgba(255,255,255,0.12)';
    });

    settingsButton.addEventListener('click', () => {
      this.openSettings();
    });

    return settingsButton;
  }

  /**
   * Open settings page
   */
  private openSettings(): void {
    if (!this.settingsContainer) {
      this.settingsContainer = document.createElement('div');
      document.body.appendChild(this.settingsContainer);
    }

    this.settingsPage = new SettingsPage(
      this.settingsContainer,
      this.settings,
      (newSettings) => {
        // Update settings by merging with current settings
        const updatedSettings = { ...this.settings, ...newSettings };
        this.settings = updatedSettings;
        // Save updated settings to localStorage
        this.saveSettingsToStorage(updatedSettings);
        // Reload feed if images or short-form settings changed
        if (
          newSettings.includeImagesInFeed !== undefined ||
          newSettings.enabledFileTypes ||
          newSettings.imagesOnly !== undefined ||
          newSettings.shortFormInHDMode !== undefined ||
          newSettings.shortFormInNonHDMode !== undefined ||
          newSettings.shortFormMaxDuration !== undefined ||
          newSettings.shortFormOnly !== undefined
        ) {
          this.loadVideos(this.currentFilters, false, undefined, true).catch(e => {
            console.error('Failed to reload feed after settings change', e);
          });
        }
      },
      () => {
        // On close, remove settings container and clear reference
        this.settingsContainer?.remove();
        this.settingsContainer = undefined;
        // Refresh feed to apply any settings changes
        this.refreshFeed().catch((e) => console.error('Failed to refresh feed after settings close', e));
      }
    );
  }

  /**
   * Create HD toggle button
   */
  private createHDToggleButton(): {
    button: HTMLButtonElement;
    onClick: () => void;
  } {
    const hdToggle = document.createElement('button');
    hdToggle.type = 'button';
    hdToggle.title = 'Load HD scene videos';
    hdToggle.setAttribute('aria-label', 'Toggle HD videos');
    hdToggle.style.height = '44px';
    hdToggle.style.minWidth = '44px';
    hdToggle.style.padding = '0 14px';
    hdToggle.style.borderRadius = '10px';
    hdToggle.style.border = '1px solid rgba(255,255,255,0.12)';
    hdToggle.style.background = 'rgba(28, 28, 30, 0.9)';
    hdToggle.style.color = 'rgba(255,255,255,0.85)';
    hdToggle.style.fontSize = '12px';
    hdToggle.style.fontWeight = '700';
    hdToggle.style.cursor = 'pointer';
    hdToggle.style.lineHeight = '1.2';
    hdToggle.style.userSelect = 'none';
    hdToggle.style.display = 'inline-flex';
    hdToggle.style.alignItems = 'center';
    hdToggle.style.justifyContent = 'center';
    hdToggle.style.transition = 'background 0.2s ease, border-color 0.2s ease, color 0.2s ease, transform 0.2s cubic-bezier(0.2, 0, 0, 1)';

    const setHDToggleVisualState = (shuffleToggle: HTMLButtonElement | HTMLElement | null | undefined) => {
      if (this.useHDMode) {
        hdToggle.textContent = 'HD Video';
        hdToggle.style.background = 'rgba(76, 175, 80, 0.25)';
        hdToggle.style.borderColor = 'rgba(76, 175, 80, 0.55)';
        hdToggle.style.color = '#C8E6C9';
        if (shuffleToggle) {
          shuffleToggle.style.display = 'inline-flex';
        }
      } else {
        hdToggle.textContent = 'HD Video';
        hdToggle.style.background = 'rgba(28, 28, 30, 0.6)';
        hdToggle.style.borderColor = 'rgba(255,255,255,0.06)';
        hdToggle.style.color = 'rgba(255,255,255,0.4)';
        if (shuffleToggle) {
          shuffleToggle.style.display = 'none';
        }
      }
    };

    hdToggle.addEventListener('mouseenter', () => {
      hdToggle.style.background = 'rgba(28, 28, 30, 0.95)';
      hdToggle.style.borderColor = 'rgba(255,255,255,0.16)';
      hdToggle.style.opacity = '0.9';
    });

    hdToggle.addEventListener('mouseleave', () => {
      setHDToggleVisualState(this.shuffleToggle ?? null);
      hdToggle.style.opacity = '1';
    });

    const onHDToggleClick = () => {
      const newHDMode = !this.useHDMode;
      
      if (!newHDMode && this.shuffleMode > 0) {
        this.shuffleMode = 0;
        try {
          localStorage.setItem('stashgifs-shuffleMode', '0');
        } catch (e) {
          console.error('Failed to save shuffle mode preference:', e);
        }
      }
      
      try {
        localStorage.setItem('stashgifs-useHDMode', newHDMode ? 'true' : 'false');
      } catch (e) {
        console.error('Failed to save HD mode preference:', e);
      }
      
      // Update HD mode state
      this.useHDMode = newHDMode;
      
      // Refresh feed to apply HD mode changes
      this.refreshFeed().catch((e) => console.error('Failed to refresh feed after HD mode change', e));
    };

    hdToggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onHDToggleClick();
    });

    // Set initial state
    setHDToggleVisualState(null);

    return {
      button: hdToggle,
      onClick: onHDToggleClick,
    };
  }

  /**
   * Create volume toggle button
   */
  private createVolumeToggleButton(): HTMLButtonElement {
    const volToggle = document.createElement('button');
    volToggle.type = 'button';
    volToggle.title = 'Play audio for focused video only';
    volToggle.setAttribute('aria-label', 'Toggle volume mode');
    volToggle.style.height = '44px';
    volToggle.style.minWidth = '44px';
    volToggle.style.padding = '0 14px';
    volToggle.style.borderRadius = '10px';
    volToggle.style.border = '1px solid rgba(255,255,255,0.12)';
    volToggle.style.background = 'rgba(28, 28, 30, 0.9)';
    volToggle.style.color = 'rgba(255,255,255,0.85)';
    volToggle.style.fontSize = '12px';
    volToggle.style.fontWeight = '700';
    volToggle.style.cursor = 'pointer';
    volToggle.style.lineHeight = '1.2';
    volToggle.style.userSelect = 'none';
    volToggle.style.display = 'inline-flex';
    volToggle.style.alignItems = 'center';
    volToggle.style.justifyContent = 'center';
    volToggle.style.transition = 'background 0.2s ease, border-color 0.2s ease, color 0.2s ease, transform 0.2s cubic-bezier(0.2, 0, 0, 1)';
    
    const getMutedIcon = () => {
      return VOLUME_MUTED_SVG.replace('width="24"', 'width="16"').replace('height="24"', 'height="16"').replace('preserveAspectRatio="xMidYMid meet"', 'preserveAspectRatio="xMidYMid meet" style="display: block;"');
    };
    
    const getUnmutedIcon = () => {
      return VOLUME_UNMUTED_SVG.replace('width="24"', 'width="16"').replace('height="24"', 'height="16"').replace('preserveAspectRatio="xMidYMid meet"', 'preserveAspectRatio="xMidYMid meet" style="display: block;"');
    };

    const setVolToggleVisualState = () => {
      if (this.useVolumeMode) {
        volToggle.style.background = 'rgba(33, 150, 243, 0.25)';
        volToggle.style.borderColor = 'rgba(33, 150, 243, 0.55)';
        volToggle.style.color = '#BBDEFB';
        volToggle.innerHTML = getUnmutedIcon();
      } else {
        volToggle.style.background = 'rgba(28, 28, 30, 0.9)';
        volToggle.style.borderColor = 'rgba(255,255,255,0.16)';
        volToggle.style.color = 'rgba(255,255,255,0.85)';
        volToggle.innerHTML = getMutedIcon();
      }
    };

    setVolToggleVisualState();

    volToggle.addEventListener('mouseenter', () => {
      volToggle.style.background = 'rgba(28, 28, 30, 0.95)';
      volToggle.style.borderColor = 'rgba(255,255,255,0.16)';
      volToggle.style.opacity = '0.9';
    });

    volToggle.addEventListener('mouseleave', () => {
      setVolToggleVisualState();
      volToggle.style.opacity = '1';
    });

    const onVolToggleClick = async () => {
      this.useVolumeMode = !this.useVolumeMode;
      setVolToggleVisualState();
      
      try {
        localStorage.setItem('stashgifs-useVolumeMode', this.useVolumeMode ? 'true' : 'false');
      } catch (e) {
        console.error('Failed to save volume mode preference:', e);
      }
      
      this.visibilityManager.setExclusiveAudio(this.useVolumeMode);
      this.visibilityManager.reevaluateAudioFocus();
    };

    volToggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      void onVolToggleClick();
    });

    return volToggle;
  }

  /**
   * Create shuffle toggle button
   */
  private createShuffleToggleButton(hdToggle: HTMLButtonElement): HTMLButtonElement {
    const shuffleToggle = document.createElement('button');
    shuffleToggle.type = 'button';
    shuffleToggle.title = 'Toggle shuffle mode';
    shuffleToggle.setAttribute('aria-label', 'Toggle shuffle mode');
    shuffleToggle.style.height = '44px';
    shuffleToggle.style.minWidth = '44px';
    shuffleToggle.style.padding = '0 14px';
    shuffleToggle.style.borderRadius = '10px';
    shuffleToggle.style.border = '1px solid rgba(255,255,255,0.12)';
    shuffleToggle.style.background = 'rgba(28, 28, 30, 0.9)';
    shuffleToggle.style.color = 'rgba(255,255,255,0.85)';
    shuffleToggle.style.cursor = 'pointer';
    shuffleToggle.style.display = this.useHDMode ? 'inline-flex' : 'none';
    shuffleToggle.style.alignItems = 'center';
    shuffleToggle.style.justifyContent = 'center';
    shuffleToggle.style.transition = 'background 0.2s ease, border-color 0.2s ease, color 0.2s ease, transform 0.2s cubic-bezier(0.2, 0, 0, 1)';
    shuffleToggle.style.fontSize = '12px';
    shuffleToggle.style.fontWeight = '700';
    shuffleToggle.style.lineHeight = '1.2';
    shuffleToggle.style.userSelect = 'none';

    const setShuffleToggleVisualState = () => {
      if (this.shuffleMode === 0) {
        shuffleToggle.textContent = 'Random Positions';
        shuffleToggle.style.background = 'rgba(28, 28, 30, 0.6)';
        shuffleToggle.style.borderColor = 'rgba(255,255,255,0.06)';
        shuffleToggle.style.color = 'rgba(255,255,255,0.4)';
        shuffleToggle.title = 'Random Positions';
      } else if (this.shuffleMode === 1) {
        shuffleToggle.textContent = 'Random Positions';
        shuffleToggle.style.background = 'rgba(33, 150, 243, 0.25)';
        shuffleToggle.style.borderColor = 'rgba(33, 150, 243, 0.65)';
        shuffleToggle.style.color = '#64B5F6';
        shuffleToggle.title = 'Random Positions';
      } else {
        shuffleToggle.textContent = 'Random Positions';
        shuffleToggle.style.background = 'rgba(156, 39, 176, 0.25)';
        shuffleToggle.style.borderColor = 'rgba(156, 39, 176, 0.65)';
        shuffleToggle.style.color = '#BA68C8';
        shuffleToggle.title = 'Random Positions (No Markers)';
      }
    };

    setShuffleToggleVisualState();

    shuffleToggle.addEventListener('mouseenter', () => {
      if (this.shuffleMode === 0) {
        shuffleToggle.style.background = 'rgba(28, 28, 30, 0.95)';
        shuffleToggle.style.borderColor = 'rgba(255,255,255,0.16)';
      } else if (this.shuffleMode === 1) {
        shuffleToggle.style.background = 'rgba(33, 150, 243, 0.35)';
        shuffleToggle.style.borderColor = 'rgba(33, 150, 243, 0.75)';
      } else {
        shuffleToggle.style.background = 'rgba(156, 39, 176, 0.35)';
        shuffleToggle.style.borderColor = 'rgba(156, 39, 176, 0.75)';
      }
      shuffleToggle.style.opacity = '0.9';
    });

    shuffleToggle.addEventListener('mouseleave', () => {
      setShuffleToggleVisualState();
      shuffleToggle.style.opacity = '1';
    });

    const onShuffleClick = async () => {
      this.shuffleMode = (this.shuffleMode + 1) % 3;
      
      try {
        localStorage.setItem('stashgifs-shuffleMode', String(this.shuffleMode));
      } catch (e) {
        console.error('Failed to save shuffle mode preference:', e);
      }
      
      setShuffleToggleVisualState();
      
      if (this.shuffleMode > 0 && this.headerBar) {
        this.headerBar.style.transform = 'translateY(0)';
        this.headerBar.style.opacity = '1';
      }
      
      this.clearPosts();
      
      if (this.postsContainer) {
        this.postsContainer.innerHTML = '';
      }
      
      this.currentPage = 1;
      this.hasMore = true;
      this.isLoading = false;
      
      await this.loadVideos(this.currentFilters, false, undefined, true);
    };
    
    shuffleToggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      void onShuffleClick();
    });

    this.shuffleToggle = shuffleToggle;

    return shuffleToggle;
  }

  /**
   * Create top header bar with unified search
   */
  private createHeaderBar(): void {
    // Saved filters will be loaded lazily when filter dropdown opens
    let savedFiltersCache: Array<{ id: string; name: string }> = [];

    const header = this.createHeaderElement();
    const headerInner = this.createHeaderInnerContainer();

    this.createBrandContainer(headerInner);

    const searchArea = this.createSearchArea();
    headerInner.appendChild(searchArea);
    header.appendChild(headerInner);

    const tagHeader = this.createTagHeader();

    const inputSetup = this.setupSearchInput();
    const inputWrapper = inputSetup.inputWrapper;
    const queryInput = inputSetup.queryInput;
    const placeholderWrapper = inputSetup.placeholderWrapper;
    const loadingSpinner = inputSetup.loadingSpinner;
    const shuffleIndicator = inputSetup.shuffleIndicator;
    const randomLeftIcon = inputSetup.randomLeftIcon;
    const updatePlaceholderVisibility = inputSetup.updatePlaceholderVisibility;

    // Append input to wrapper
    inputWrapper.appendChild(queryInput);

    const buttonsSetup = this.setupHeaderButtons();
    const buttonsContainer = buttonsSetup.buttonsContainer;
    const onHDToggleClick = buttonsSetup.onHDToggleClick;
    
    // Add buttons container to header inner (third grid column)
    headerInner.appendChild(buttonsContainer);

    const suggestions = document.createElement('div');
    suggestions.className = 'feed-filters__suggestions hide-scrollbar';
    suggestions.style.position = 'fixed';
    // Use CSS custom properties for inset (supported in modern browsers)
    suggestions.style.setProperty('inset', '0');
    suggestions.style.top = '0';
    suggestions.style.left = '0';
    suggestions.style.right = '0';
    suggestions.style.bottom = '0';
    suggestions.style.zIndex = '1000';
    suggestions.style.display = 'none';
    suggestions.style.flexDirection = 'column';
    suggestions.style.background = 'rgba(0, 0, 0, 0.95)';
    suggestions.style.backdropFilter = 'blur(20px) saturate(180%)';
    // webkitBackdropFilter for Safari compatibility
    suggestions.style.setProperty('-webkit-backdrop-filter', 'blur(20px) saturate(180%)');
    suggestions.style.overflowY = 'auto';
    suggestions.style.padding = '0';
    suggestions.style.boxSizing = 'border-box';

    // Input wrapper (contains input and reset button), then tag header below
    searchArea.appendChild(inputWrapper);
    searchArea.appendChild(tagHeader);
    document.body.appendChild(suggestions);

    // Append header to scroll container at the top (before posts)
    // Check if header skeleton already exists (from initial HTML)
    const existingHeader = this.scrollContainer.querySelector('.feed-header-bar');
    if (existingHeader) {
      // Replace existing header skeleton with real header
      this.scrollContainer.replaceChild(header, existingHeader);
    } else {
      // Insert header before first child (posts container)
      this.scrollContainer.insertBefore(header, this.scrollContainer.firstChild);
    }

    // No need for paddingTop since header is sticky and inside scroll container

    const updateSearchBarDisplay = () => {
      // Show the active search term in the search bar
      if (this.selectedTagName) {
        queryInput.value = this.selectedTagName;
      } else if (this.selectedPerformerName) {
        queryInput.value = this.selectedPerformerName;
      } else if (this.selectedSavedFilter) {
        queryInput.value = this.selectedSavedFilter.name;
      } else {
        queryInput.value = '';
      }
      // Hide tag header since we're showing it in the search bar
      tagHeader.style.display = 'none';
      // Ensure animated placeholder hides when we have any value or focus
      if (this.shuffleMode > 0) {
        placeholderWrapper.style.display = 'none';
      } else {
        updatePlaceholderVisibility();
      }
      // Disable search input in random mode
      const disabled = this.shuffleMode > 0;
      // Use readOnly so clicks can disable random mode
      if (queryInput instanceof HTMLInputElement) {
        queryInput.readOnly = disabled;
      }
      // Keep opacity at 1 in both modes for consistent appearance
      queryInput.style.opacity = '1';
      // Adjust left padding to accommodate left helper when random is active
      queryInput.style.paddingLeft = this.shuffleMode > 0 ? '180px' : '14px';
      // Hide deprecated right pill (no longer used)
      shuffleIndicator.style.display = 'none';
      // Show left icon when random is active
      randomLeftIcon.style.display = this.shuffleMode > 0 ? 'inline-flex' : 'none';
    };

    const apply = async () => {
      // Show loading state
      queryInput.disabled = true;
      queryInput.style.opacity = '0.6';
      loadingSpinner.style.display = 'block';
      try {
        updateSearchBarDisplay();
        await this.applyCurrentSearch();
      } catch (e: unknown) {
        if (!(e instanceof Error && e.name === 'AbortError')) {
          console.error('Apply filters failed', e);
        }
      } finally {
        // Hide loading state
        queryInput.disabled = false;
        queryInput.style.opacity = '1';
        loadingSpinner.style.display = 'none';
      }
    };

    // Suggestions with proper debouncing
    let suggestionsRequestId = 0;
    let suggestTerm = '';
    
    // Debounced suggestion fetcher (150ms delay)
    const debouncedFetchSuggestions = debounce((text: string, forceShow: boolean) => {
      fetchAndShowSuggestions(text, forceShow);
    }, 150);
    
    const prepareSuggestionsPanel = (panel: HTMLElement, ensureLatest: () => boolean): boolean => {
      if (!ensureLatest()) {
        return false;
      }

      panel.style.display = 'none';
      while (panel.firstChild) {
        panel.firstChild.remove();
      }
      
      if (!ensureLatest()) {
        return false;
      }
      
      panel.style.display = 'flex';
      this.lockBodyScroll();
      
      return ensureLatest();
    };

    const getViewportConfig = () => {
      const isMobileViewport = globalThis.innerWidth <= 768;
      return {
        isMobileViewport,
        maxContentWidth: isMobileViewport ? '100%' : '640px',
        horizontalPadding: isMobileViewport ? 16 : 24,
        topPadding: 0,
      };
    };

    const createSuggestionsContainer = (config: ReturnType<typeof getViewportConfig>): HTMLElement => {
      const container = document.createElement('div');
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.gap = '24px';
      container.style.width = '100%';
      container.style.maxWidth = config.maxContentWidth;
      container.style.margin = '0 auto';
      container.style.boxSizing = 'border-box';
      container.style.paddingTop = `${config.topPadding}px`;
      container.style.paddingLeft = `${config.horizontalPadding}px`;
      container.style.paddingRight = `${config.horizontalPadding}px`;
      container.style.paddingBottom = config.isMobileViewport ? '32px' : '48px';
      container.style.minHeight = '100%';
      return container;
    };

    const renderDefaultSuggestions = async (
      container: HTMLElement,
      panel: HTMLElement,
      horizontalPadding: number,
      ensureLatest: () => boolean,
      onHDToggleClick: () => void,
      updateSearchBarDisplay: () => void,
      apply: () => Promise<void>
    ) => {
      await this.renderDefaultSuggestionsView(
        container,
        panel,
        horizontalPadding,
        ensureLatest,
        onHDToggleClick,
        updateSearchBarDisplay,
        apply
      );
    };

    const renderSearchSuggestions = async (
      container: HTMLElement,
      panel: HTMLElement,
      trimmedText: string,
      horizontalPadding: number,
      ensureLatest: () => boolean,
      updateSearchBarDisplay: () => void,
      apply: () => Promise<void>
    ) => {
      await this.renderSearchResultsView(
        container,
        panel,
        trimmedText,
        horizontalPadding,
        ensureLatest,
        updateSearchBarDisplay,
        apply
      );
    };

    const fetchAndShowSuggestions = async (text: string, forceShow: boolean = false) => {
      if (this.shuffleMode > 0) {
        this.showRandomModeNotice(suggestions);
        return;
      }
      
      const trimmedText = text.trim();
      const requestId = ++suggestionsRequestId;
      const ensureLatest = () => requestId === suggestionsRequestId;

      if (!prepareSuggestionsPanel(suggestions, ensureLatest)) {
        return;
      }

      const viewportConfig = getViewportConfig();
      const container = createSuggestionsContainer(viewportConfig);
      suggestions.appendChild(container);
      suggestions.scrollTop = 0;

      const showDefault = forceShow || trimmedText.length === 0 || trimmedText.length < 2;
      if (showDefault) {
        await renderDefaultSuggestions(
          container,
          suggestions,
          viewportConfig.horizontalPadding,
          ensureLatest,
          onHDToggleClick,
          updateSearchBarDisplay,
          apply
        );
      } else {
        await renderSearchSuggestions(
          container,
          suggestions,
          trimmedText,
          viewportConfig.horizontalPadding,
          ensureLatest,
          updateSearchBarDisplay,
          apply
        );
      }
    };
    
    queryInput.addEventListener('keydown', (e) => { 
      if (e instanceof KeyboardEvent && e.key === 'Enter') {
        apply();
      }
    });
    
    // Handle focus and show suggestions
    let focusHandled = false;
    let clickHandled = false;
    const disableRandomIfActive = async () => {
      if (this.shuffleMode > 0) {
        this.shuffleMode = 0;
        try { localStorage.setItem('stashgifs-shuffleMode', '0'); } catch {}
        // Re-enable input visuals
        updateSearchBarDisplay();
        // Reload non-random feed
        this.clearPosts();
        if (this.postsContainer) this.postsContainer.innerHTML = '';
        this.currentPage = 1;
        this.hasMore = true;
        this.isLoading = false;
        await this.loadVideos(this.currentFilters, false, undefined, true);
      }
    };

    const focusInputSafely = (input: HTMLInputElement) => {
      try {
        input.focus({ preventScroll: true } as FocusOptions);
      } catch {
        input.focus();
      }
    };

    const clearSearchSelection = () => {
      this.selectedTagId = undefined;
      this.selectedTagName = undefined;
      this.selectedPerformerId = undefined;
      this.selectedPerformerName = undefined;
      this.selectedSavedFilter = undefined;
    };

    const prepareSearchForInput = () => {
      void disableRandomIfActive();
      this.preloadSuggestions().catch((e) => console.warn('Suggestion preload refresh failed', e));
      queryInput.style.background = 'rgba(28, 28, 30, 0.95)';
      queryInput.style.borderColor = 'rgba(255,255,255,0.16)';
      clearSearchSelection();
      queryInput.value = '';
      fetchAndShowSuggestions('', true);
    };

    const handleFocus = () => {
      if (clickHandled) {
        clickHandled = false;
        return;
      }
      if (focusHandled) return;
      focusHandled = true;
      
      prepareSearchForInput();
      setTimeout(() => { focusHandled = false; }, 100);
    };

    const handleMobileClick = (e: MouseEvent) => {
      e.stopPropagation();
      if (document.activeElement !== queryInput) {
        focusInputSafely(queryInput);
      }
      if (!focusHandled) {
        clickHandled = true;
        prepareSearchForInput();
      }
    };

    const handleDesktopClick = (e: MouseEvent) => {
      e.stopPropagation();
      clickHandled = true;
      focusInputSafely(queryInput);
      prepareSearchForInput();
      setTimeout(() => { clickHandled = false; }, 100);
    };

    const handleMobileTouchEnd = (e: TouchEvent) => {
      e.stopPropagation();
      focusInputSafely(queryInput);
      void disableRandomIfActive();
      handleFocus();
    };
    
    // Detect mobile device
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    
    if (isMobile) {
      queryInput.addEventListener('touchend', handleMobileTouchEnd, { passive: false });
      queryInput.addEventListener('click', handleMobileClick);
    } else {
      queryInput.addEventListener('click', handleDesktopClick);
    }
    
    queryInput.addEventListener('focus', handleFocus);
    
    queryInput.addEventListener('blur', () => {
      queryInput.style.background = 'rgba(28, 28, 30, 0.9)';
      queryInput.style.borderColor = 'rgba(255,255,255,0.12)';
    });
    
    queryInput.addEventListener('input', () => {
      const text = queryInput.value;
      // Clear selected tag/filter when user types (they're searching for something new)
      if (text !== this.selectedTagName && text !== this.selectedPerformerName && text !== this.selectedSavedFilter?.name) {
        this.selectedTagId = undefined;
        this.selectedTagName = undefined;
        this.selectedPerformerId = undefined;
        this.selectedPerformerName = undefined;
        this.selectedSavedFilter = undefined;
      }
      // Use debounced function for better performance - only fetch suggestions, don't apply
      debouncedFetchSuggestions(text, false);
      // Don't auto-apply while typing - only apply when user presses Enter or selects a suggestion
    });

    suggestions.addEventListener('click', (e) => {
      if (e.target === suggestions) {
        this.closeSuggestions();
      }
    });
    
    // Use a single, debounced document click handler
    let clickHandlerTimeout: number | null = null;
    document.addEventListener('click', (e) => {
      // Clear any pending handler
      if (clickHandlerTimeout !== null) {
        clearTimeout(clickHandlerTimeout);
      }
      
      // Defer the check to next tick to ensure overlay state is updated
      clickHandlerTimeout = globalThis.setTimeout(() => {
        // Check if suggestions are visible
        const isSuggestionsVisible = suggestions.style.display !== 'none';
        
        // Don't close if clicking inside searchArea or suggestions overlay
        const clickedInsideSearch = searchArea.contains(e.target as Node);
        const clickedInsideSuggestions = suggestions.contains(e.target as Node);
        
        // Don't close if clicking on header control buttons (HD toggle, shuffle, volume, etc.)
        const target = e.target as HTMLElement;
        const clickedOnHeaderButton = target.closest('button') && 
          (target.closest('.feed-header-bar') || target.closest('header'));
        
        if (isSuggestionsVisible && !clickedInsideSearch && !clickedInsideSuggestions && !clickedOnHeaderButton) {
          this.closeSuggestions();
        }
      }, 0);
    });

    // Initial render of search bar display (in case defaults are provided)
    updateSearchBarDisplay();
  }

  /**
   * Handle performer chip click - clear filters and set performer filter
   */
  private handlePerformerChipClick(performerId: number, performerName: string): void {
    // Disable chip interactions in random mode
    if (this.shuffleMode > 0) return;
    // Clear all filters
    this.selectedTagId = undefined;
    this.selectedTagName = undefined;
    this.selectedSavedFilter = undefined;
    // Set performer filter
    this.selectedPerformerId = performerId;
    this.selectedPerformerName = performerName;
    // Apply filters
    this.applyFilters();
    // Scroll to top
    globalThis.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * Handle tag chip click - clear filters and set tag filter
   */
  private handleTagChipClick(tagId: number, tagName: string): void {
    // Disable chip interactions in random mode
    if (this.shuffleMode > 0) return;
    // Clear all filters
    this.selectedPerformerId = undefined;
    this.selectedPerformerName = undefined;
    this.selectedSavedFilter = undefined;
    // Set tag filter
    this.selectedTagId = tagId;
    this.selectedTagName = tagName;
    // Apply filters
    this.applyFilters();
    // Scroll to top
    globalThis.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * Get current query text from active input element
   */
  private getCurrentQueryFromInput(): string | undefined {
    const activeEl = document.activeElement as HTMLElement | null;
    if (activeEl?.classList?.contains('feed-filters__input')) {
      const input = activeEl as HTMLInputElement;
      return input.value?.trim() || undefined;
    }
    return undefined;
  }

  /**
   * Handle random mode filter application
   */
  private async applyRandomModeFilters(loadSignal?: AbortSignal): Promise<void> {
    const newFilters: FilterOptions = {
      limit: this.initialLoadLimit,
      offset: 0,
      shuffleMode: true,
      includeScenesWithoutMarkers: this.shuffleMode === 2,
    };
    this.currentFilters = newFilters;
    this.clearContentRatio(); // Clear ratio so it's recalculated with new filters
    await this.loadVideos(newFilters, false, loadSignal, true);
  }

  /**
   * Build filter values from selected performer
   */
  private buildPerformerFilters(): { performers: string[] } {
    return {
      performers: [String(this.selectedPerformerId)],
    };
  }

  /**
   * Build filter values from selected tag
   */
  private async buildTagFilters(loadSignal?: AbortSignal): Promise<{ tags?: string[] }> {
    if (this.selectedTagId) {
      return {
        tags: [String(this.selectedTagId)],
      };
    }
    
    if (this.selectedTagName) {
      try {
        const exactTag = await this.api.findTagByName(this.selectedTagName);
        if (loadSignal?.aborted) {
          return {};
        }
        if (exactTag) {
          return {
            tags: [String(exactTag.id)],
          };
        }
      } catch {
        // If tag lookup fails, don't set tags filter
      }
    }
    
    return {};
  }

  /**
   * Resolve query text to tag or performer, or use as plain query
   */
  private async resolveQueryToFilters(
    q: string,
    loadSignal?: AbortSignal
  ): Promise<{ tags?: string[]; performers?: string[]; queryValue?: string }> {
    try {
      const exactTag = await this.api.findTagByName(q);
      if (loadSignal?.aborted) {
        return {};
      }
      
      if (exactTag) {
        this.selectedTagName = exactTag.name;
        this.selectedTagId = Number.parseInt(exactTag.id, 10);
        return {
          tags: [String(exactTag.id)],
        };
      }
      
      const matchingPerformers = await this.api.searchPerformers(q, 10, loadSignal);
      if (loadSignal?.aborted) {
        return {};
      }
      
      if (matchingPerformers && matchingPerformers.length > 0 && matchingPerformers[0]) {
        this.selectedPerformerName = matchingPerformers[0].name;
        this.selectedPerformerId = Number.parseInt(String(matchingPerformers[0].id), 10);
        return {
          performers: [String(matchingPerformers[0].id)],
        };
      }
      
      return {
        queryValue: q,
      };
    } catch {
      return {
        queryValue: q,
      };
    }
  }

  /**
   * Apply current search across UIs using unified logic
   * Resolves selectedTagName to tag IDs, tries performer by name, or falls back to plain text.
   */
  private async applyCurrentSearch(loadSignal?: AbortSignal): Promise<void> {
    const q = this.getCurrentQueryFromInput();

    if (this.shuffleMode > 0) {
      await this.applyRandomModeFilters(loadSignal);
      return;
    }

    let queryValue: string | undefined = undefined;
    let tags: string[] | undefined = undefined;
    let performers: string[] | undefined = undefined;

    if (this.selectedPerformerId) {
      const filters = this.buildPerformerFilters();
      performers = filters.performers;
    } else if (this.selectedTagId || this.selectedTagName) {
      const filters = await this.buildTagFilters(loadSignal);
      tags = filters.tags;
    } else if (q && !this.selectedSavedFilter) {
      const resolvedFilters = await this.resolveQueryToFilters(q, loadSignal);
      tags = resolvedFilters.tags;
      performers = resolvedFilters.performers;
      queryValue = resolvedFilters.queryValue;
    }

    const newFilters: FilterOptions = {
      query: queryValue,
      tags: tags,
      performers: performers,
      savedFilterId: this.selectedSavedFilter?.id || undefined,
      limit: this.initialLoadLimit,
      offset: 0,
    };
    this.currentFilters = newFilters;
    await this.loadVideos(newFilters, false, loadSignal);
  }

  /**
   * Update query input display with current selection
   */
  private updateQueryInputDisplay(): void {
    const queryInput = this.container.querySelector('.feed-filters__input') as HTMLInputElement;
    if (!queryInput) {
      return;
    }

    if (this.selectedTagName) {
      queryInput.value = this.selectedTagName;
    } else if (this.selectedPerformerName) {
      queryInput.value = this.selectedPerformerName;
    } else if (this.selectedSavedFilter) {
      queryInput.value = this.selectedSavedFilter.name;
    } else {
      queryInput.value = '';
    }

    const ph = document.getElementById('feed-search-placeholder');
    if (ph) {
      ph.style.display = 'none';
    }
  }

  /**
   * Build filter values for applyFilters (with fallback tag ID logic)
   */
  private async buildFiltersForApply(): Promise<{ tags?: string[]; performers?: string[] }> {
    if (this.selectedPerformerId) {
      return {
        performers: [String(this.selectedPerformerId)],
      };
    }

    if (this.selectedTagId || this.selectedTagName) {
      if (this.selectedTagId) {
        return {
          tags: [String(this.selectedTagId)],
        };
      }

      if (this.selectedTagName) {
        try {
          const exactTag = await this.api.findTagByName(this.selectedTagName);
          if (exactTag) {
            return {
              tags: [String(exactTag.id)],
            };
          }
        } catch (error) {
          console.error('Failed to find exact tag', error);
        }

        if (this.selectedTagId) {
          return {
            tags: [String(this.selectedTagId)],
          };
        }
      }
    }

    return {};
  }

  /**
   * Apply current filters and update UI
   */
  private async applyFilters(): Promise<void> {
    this.updateQueryInputDisplay();

    const filterValues = await this.buildFiltersForApply();
    
    const newFilters: FilterOptions = {
      query: undefined,
      tags: filterValues.tags,
      performers: filterValues.performers,
      savedFilterId: this.selectedSavedFilter?.id || undefined,
      limit: this.initialLoadLimit,
      offset: 0,
    };
    this.currentFilters = newFilters;
    this.clearContentRatio(); // Clear ratio so it's recalculated with new filters
    this.loadVideos(newFilters, false).catch((e) => console.error('Apply filters failed', e));
  }

  private renderFilterSheet(): void {
    // Inject a one-time utility style to hide scrollbars while preserving scroll
    const injectHideScrollbarCSS = () => {
      if (!document.getElementById('feed-hide-scrollbar')) {
        const style = document.createElement('style');
        style.id = 'feed-hide-scrollbar';
        style.textContent = `.hide-scrollbar{scrollbar-width:none; -ms-overflow-style:none;} .hide-scrollbar::-webkit-scrollbar{display:none;}`;
        document.head.appendChild(style);
      }
    };
    injectHideScrollbarCSS();

    // Utility: current scrollbar width (accounts for OS/overlay differences)
    const getScrollbarWidth = (): number => Math.max(0, globalThis.innerWidth - document.documentElement.clientWidth);

    const bar = document.createElement('div');
    bar.className = 'feed-filters';
    // Hide scrollbars on the panel itself (mobile full-screen, desktop floating)
    bar.classList.add('hide-scrollbar');
    // Base styles; layout (desktop vs mobile) applied below
    bar.style.position = 'fixed';
    bar.style.zIndex = '200';
    bar.style.display = 'grid';
    bar.style.gridTemplateColumns = '1fr';
    bar.style.gap = '10px';
    bar.style.padding = '12px';
    bar.style.background = 'rgba(18,18,18,0.6)';
    bar.style.backdropFilter = 'blur(10px)';
    bar.style.border = '1px solid rgba(255,255,255,0.06)';
    bar.style.borderRadius = '14px';
    bar.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)';
    bar.style.opacity = '0';
    bar.style.pointerEvents = 'none';
    bar.style.transition = 'opacity .18s ease, transform .24s cubic-bezier(.2,.7,0,1)';

    // Backdrop for mobile bottom sheet
    const backdrop = document.createElement('div');
    backdrop.style.position = 'fixed';
    backdrop.style.left = '0';
    backdrop.style.top = '0';
    backdrop.style.right = '0';
    backdrop.style.bottom = '0';
    backdrop.style.background = 'rgba(0,0,0,0.5)';
    backdrop.style.zIndex = '190';
    backdrop.style.opacity = '0';
    backdrop.style.pointerEvents = 'none';
    backdrop.style.transition = 'opacity .18s ease';

    // Saved filters dropdown
    const savedSelect = document.createElement('select');
    savedSelect.className = 'feed-filters__select';
    savedSelect.style.width = '100%';
    savedSelect.style.padding = '12px 14px';
    savedSelect.style.borderRadius = '12px';
    savedSelect.style.border = '1px solid rgba(255,255,255,0.08)';
    savedSelect.style.background = 'rgba(22,22,22,0.9)';
    savedSelect.style.color = 'inherit';
    savedSelect.style.fontSize = '14px';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Saved marker filters…';
    savedSelect.appendChild(defaultOpt);

    // Add Favorites preset option at the beginning
    const favoritesOpt = document.createElement('option');
    favoritesOpt.value = '__favorites__';
    favoritesOpt.textContent = 'Favorites';
    savedSelect.appendChild(favoritesOpt);

    // Load saved filters lazily when filter sheet opens
    const loadSavedFilters = async () => {
      await this.loadSavedFiltersIfNeeded();
      // Populate dropdown with cached filters
      for (const f of this.savedFiltersCache) {
        // Check if option already exists
        const exists = Array.from(savedSelect.options).some(opt => opt.value === f.id);
        if (!exists) {
          const opt = document.createElement('option');
          opt.value = f.id;
          opt.textContent = f.name;
          savedSelect.appendChild(opt);
        }
      }
    };

    // Search input with autocomplete for marker tags
    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'feed-filters__search-wrapper';
    const queryInput = document.createElement('input');
    queryInput.type = 'text';
    queryInput.className = 'feed-filters__input';
    queryInput.placeholder = 'Search markers or choose tags…';
    queryInput.style.width = '100%';
    queryInput.style.padding = '12px 42px 12px 14px';
    queryInput.style.borderRadius = '12px';
    queryInput.style.border = '1px solid rgba(255,255,255,0.08)';
    queryInput.style.background = 'rgba(22,22,22,0.95)';
    queryInput.style.color = 'inherit';
    queryInput.style.fontSize = '14px';
    const suggestions = document.createElement('div');
    suggestions.className = 'feed-filters__suggestions';
    suggestions.style.position = 'fixed';
    suggestions.style.setProperty('inset', '0');
    suggestions.style.top = '0';
    suggestions.style.left = '0';
    suggestions.style.right = '0';
    suggestions.style.bottom = '0';
    suggestions.style.zIndex = '1000';
    suggestions.style.display = 'none';
    suggestions.style.background = 'rgba(0, 0, 0, 0.95)';
    suggestions.style.backdropFilter = 'blur(20px) saturate(180%)';
    suggestions.style.setProperty('-webkit-backdrop-filter', 'blur(20px) saturate(180%)');
    suggestions.style.overflowY = 'auto';
    suggestions.style.padding = '0';
    suggestions.style.boxSizing = 'border-box';

    // Tag header to show selected tag
    const tagHeader = document.createElement('div');
    tagHeader.className = 'feed-filters__tag-header';
    tagHeader.style.display = 'none';
    tagHeader.style.padding = '12px 14px';
    tagHeader.style.marginTop = '8px';
    tagHeader.style.width = '100%';
    tagHeader.style.boxSizing = 'border-box';
    tagHeader.style.fontSize = '17px';
    tagHeader.style.fontWeight = '600';
    tagHeader.style.color = '#FFFFFF';
    searchWrapper.style.position = 'relative';
    searchWrapper.appendChild(queryInput);
    searchWrapper.appendChild(tagHeader);
    searchWrapper.appendChild(suggestions);

    // Apply button (icon)
    // Removed the purple apply button; we auto-apply on interactions

    // Clear button (icon)
    const clearBtn = document.createElement('button');
    clearBtn.className = 'feed-filters__btn feed-filters__btn--ghost';
    clearBtn.setAttribute('aria-label', 'Clear filters');
    clearBtn.style.position = 'absolute';
    clearBtn.style.right = '8px';
    clearBtn.style.top = '50%';
    clearBtn.style.transform = 'translateY(-50%)';
    clearBtn.style.padding = '6px';
    clearBtn.style.width = '30px';
    clearBtn.style.height = '30px';
    clearBtn.style.display = 'inline-flex';
    clearBtn.style.alignItems = 'center';
    clearBtn.style.justifyContent = 'center';
    clearBtn.style.borderRadius = '999px';
    clearBtn.style.border = '1px solid rgba(255,255,255,0.12)';
    clearBtn.style.background = 'rgba(34,34,34,0.9)';
    clearBtn.style.cursor = 'pointer';
    clearBtn.style.opacity = '0.8';
    clearBtn.onmouseenter = () => { clearBtn.style.opacity = '1'; };
    clearBtn.onmouseleave = () => { clearBtn.style.opacity = '0.8'; };
    const clearIcon = CLEAR_SVG.replace('width="24"', 'width="16"').replace('height="24"', 'height="16"');
    clearBtn.innerHTML = clearIcon;

    const apply = async () => {
      // Clear suggestions when applying a search
      while (suggestions.firstChild) {
        suggestions.firstChild.remove();
      }
      suggestions.style.display = 'none';
      await this.applyCurrentSearch().catch((e: unknown) => {
        if (!(e instanceof Error && e.name === 'AbortError')) {
          console.error('Apply filters failed', e);
        }
      });
    };

    // Apply immediately when selecting a saved filter
    savedSelect.addEventListener('change', async () => {
      if (savedSelect.value) {
        // Handle Favorites preset
        if (savedSelect.value === '__favorites__') {
          // Clear saved filter and other selections
          this.selectedSavedFilter = undefined;
          this.selectedPerformerId = undefined;
          this.selectedPerformerName = undefined;
          
          // Find the favorite tag and set it as the selected tag
          try {
            const favoriteTag = await this.api.findTagByName('StashGifs Favorite');
            if (favoriteTag) {
              this.selectedTagId = Number.parseInt(favoriteTag.id, 10);
              this.selectedTagName = 'Favorites';
            } else {
              console.error('Favorite tag not found');
              this.selectedTagId = undefined;
              this.selectedTagName = undefined;
            }
          } catch (error) {
            console.error('Failed to load favorite tag', error);
            this.selectedTagId = undefined;
            this.selectedTagName = undefined;
          }
        } else {
          // Handle regular saved filter
          const match = this.savedFiltersCache.find((f) => f.id === savedSelect.value);
          if (match) {
            this.selectedSavedFilter = { id: match.id, name: match.name };
          }
          // Clear tag and performer selections when a saved filter is chosen
          this.selectedTagId = undefined;
          this.selectedTagName = undefined;
          this.selectedPerformerId = undefined;
          this.selectedPerformerName = undefined;
        }
      } else {
        this.selectedSavedFilter = undefined;
      }
      updateSearchBarDisplay();
      apply();
    });
    queryInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });

    // Debounced suggestions with proper debouncing
    let suggestPage = 1;
    let suggestTerm = '';
    let suggestHasMore = false;
    
    // Debounced suggestion fetcher (150ms delay)
    const debouncedFetchSuggestions2 = debounce((text: string, page: number, forceShow: boolean) => {
      fetchSuggestions(text, page, forceShow);
    }, 150);
    const updateSearchBarDisplay = () => {
      // Show the active search term in the search bar
      if (this.selectedTagName) {
        queryInput.value = this.selectedTagName;
        // If it's Favorites, select the Favorites option in the dropdown
        if (this.selectedTagName === 'Favorites') {
          savedSelect.value = '__favorites__';
        } else {
          savedSelect.value = '';
        }
      } else if (this.selectedPerformerName) {
        queryInput.value = this.selectedPerformerName;
        savedSelect.value = '';
      } else if (this.selectedSavedFilter) {
        queryInput.value = this.selectedSavedFilter.name;
        savedSelect.value = this.selectedSavedFilter.id;
      } else {
        queryInput.value = '';
        savedSelect.value = '';
      }
      // Hide tag header since we're showing it in the search bar
      tagHeader.style.display = 'none';
    };

    // Don't auto-apply while typing - only apply when user presses Enter or selects a suggestion
    queryInput.addEventListener('input', () => {
      const val = queryInput.value.trim();
      // Only fetch suggestions, don't apply search
      if (val.length >= 2) {
        fetchSuggestions(val, 1, false);
      }
    });

    const fetchSuggestions = async (text: string, page: number = 1, forceShow: boolean = false) => {
      // Cancel previous search queries
      if (this.activeSearchAbortController) {
        this.activeSearchAbortController.abort();
      }
      // Create new AbortController for this search
      this.activeSearchAbortController = new AbortController();
      const signal = this.activeSearchAbortController.signal;
      
      const trimmedText = text.trim();
      
      // Clear suggestions immediately to prevent showing old content
      while (suggestions.firstChild) {
        suggestions.firstChild.remove();
      }
      
      // Show suggestions if we have text (2+ chars) OR if forced (on focus)
      if (!trimmedText || trimmedText.length < 2) {
        if (forceShow) {
          await this.renderDefaultSuggestionsChips(
            suggestions,
            signal,
            savedSelect,
            updateSearchBarDisplay,
            apply,
            queryInput,
            fetchSuggestions
          );
        } else {
          this.closeSuggestions();
        }
        return;
      }
      // Reset grid when term changes
      if (trimmedText !== suggestTerm) {
        suggestPage = 1;
      }
      suggestTerm = trimmedText;
      const pageSize = 24;
      const items = await this.api.searchMarkerTags(trimmedText, pageSize, signal);
      if (signal.aborted) return;

      // Render tags as chips
      this.renderTagsSuggestions(suggestions, items, savedSelect, updateSearchBarDisplay, apply, (text) => fetchSuggestions(text, 1, false), trimmedText);

      // Simple heuristic for more results (if we filled the page)
      suggestHasMore = items.length >= pageSize;

      // Also surface matching saved filters as chips (unified UX)
      const term = trimmedText.toLowerCase();
      await this.loadSavedFiltersIfNeeded();
      if (signal.aborted) return;
      const matchingSaved = this.savedFiltersCache.filter((f) => f.name.toLowerCase().includes(term));
      if (matchingSaved.length) {
        suggestions.appendChild(this.createSuggestionLabel('Saved Filters'));
        for (const f of matchingSaved) {
          const chip = this.createSuggestionChip(f.name, () => {
            savedSelect.value = f.id;
            this.selectedSavedFilter = { id: f.id, name: f.name };
            this.selectedTagId = undefined;
            this.selectedTagName = undefined;
            queryInput.value = '';
            this.closeSuggestions();
            updateSearchBarDisplay();
            apply();
          });
          suggestions.appendChild(chip);
        }
      }

      // Add/load more button
      const existingMore = suggestions.querySelector('[data-more="1"]');
      if (existingMore) existingMore.remove();
      if (suggestHasMore) {
        const more = this.createMoreResultsButton({
          container: suggestions,
          trimmedText,
          pageSize,
          signal,
          savedSelect,
          updateSearchBarDisplay,
          apply,
          refreshSuggestions: fetchSuggestions,
          onPageIncrement: () => { suggestPage += 1; }
        });
        suggestions.appendChild(more);
      }

      suggestions.style.display = (items.length || matchingSaved?.length) ? 'flex' : 'none';
    };

    // Prevent clicks on input from bubbling to document click handler
    // Also fetch fresh suggestions on every click, even if already focused
    queryInput.addEventListener('click', (e) => {
      e.stopPropagation();
      // Always fetch fresh suggestions when clicking the search input
      fetchSuggestions(queryInput.value, 1, true);
    });
    
    queryInput.addEventListener('focus', () => {
      fetchSuggestions(queryInput.value, 1, true);
    });
    queryInput.addEventListener('input', () => {
      const text = queryInput.value;
      // Clear selected tag/filter when user types (they're searching for something new)
      if (text !== this.selectedTagName && text !== this.selectedPerformerName && text !== this.selectedSavedFilter?.name) {
        this.selectedTagId = undefined;
        this.selectedTagName = undefined;
        this.selectedPerformerId = undefined;
        this.selectedPerformerName = undefined;
        this.selectedSavedFilter = undefined;
      }
      // Use debounced function for better performance
      debouncedFetchSuggestions2(text, 1, false);
    });
    document.addEventListener('click', (e) => {
      // Only close if suggestions are currently visible
      const isSuggestionsVisible = suggestions.style.display !== 'none' && suggestions.style.display !== '';
      
      // Don't close if clicking inside searchWrapper or suggestions overlay
      if (isSuggestionsVisible && !searchWrapper.contains(e.target as Node) && !suggestions.contains(e.target as Node)) {
        this.closeSuggestions();
      }
    });

    clearBtn.addEventListener('click', () => {
      queryInput.value = '';
      this.selectedTagId = undefined;
      this.selectedTagName = undefined;
      this.selectedPerformerId = undefined;
      this.selectedPerformerName = undefined;
      this.selectedSavedFilter = undefined;
      savedSelect.value = '';
      updateSearchBarDisplay();
      this.currentFilters = {};
      this.clearContentRatio(); // Clear ratio so it's recalculated with cleared filters
      this.loadVideos({}, false).catch((e) => console.error('Clear filters failed', e));
    });

    bar.appendChild(savedSelect);
    bar.appendChild(searchWrapper);
    searchWrapper.appendChild(clearBtn);

    // Insert backdrop and panel into root container (not scrollable)
    this.container.appendChild(backdrop);
    this.container.appendChild(bar);

    // Responsive layout helpers
    const isMobile = () => globalThis.matchMedia('(max-width: 700px)').matches;
    const setDesktopLayout = () => {
      // half-screen top sheet on desktop, avoid covering scrollbar
      const sbw = getScrollbarWidth();
      bar.style.left = '0';
      bar.style.right = `${sbw}px`;
      bar.style.top = '0';
      bar.style.bottom = '';
      bar.style.width = `calc(100vw - ${sbw}px)`;
      bar.style.maxHeight = '50vh';
      bar.style.height = '50vh';
      bar.style.overflow = 'auto';
      bar.style.borderRadius = '0 0 14px 14px';
      bar.style.transform = 'translateY(-100%)';
      suggestions.style.maxHeight = '40vh';
      suggestions.style.position = 'absolute';
      // backdrop should not cover scrollbar either
      backdrop.style.left = '0';
      backdrop.style.top = '0';
      backdrop.style.bottom = '0';
      backdrop.style.right = `${sbw}px`;
    };
    const setMobileLayout = () => {
      // half-screen top sheet on mobile as well
      const sbw = getScrollbarWidth();
      bar.style.left = '0';
      bar.style.right = sbw ? `${sbw}px` : '0';
      bar.style.top = '0';
      bar.style.bottom = '';
      bar.style.width = sbw ? `calc(100vw - ${sbw}px)` : '100vw';
      bar.style.maxHeight = '50vh';
      bar.style.height = '50vh';
      bar.style.overflow = 'auto';
      bar.style.borderRadius = '0 0 14px 14px';
      bar.style.transform = 'translateY(-100%)';
      bar.style.paddingTop = 'calc(12px + env(safe-area-inset-top, 0px))';
      bar.style.paddingBottom = '';
      suggestions.style.maxHeight = '40vh';
      suggestions.style.position = 'absolute';
      // backdrop should not cover scrollbar either
      backdrop.style.left = '0';
      backdrop.style.top = '0';
      backdrop.style.bottom = '0';
      backdrop.style.right = sbw ? `${sbw}px` : '0';
    };
    const applyLayout = () => {
      if (isMobile()) setMobileLayout(); else setDesktopLayout();
      // hide clear button and saved dropdown on mobile for a unified UI
      clearBtn.style.display = isMobile() ? 'none' : 'inline-flex';
      savedSelect.style.display = isMobile() ? 'none' : 'block';
    };
    applyLayout();

    // Open/close helpers with scroll lock and backdrop
    let sheetOpen = false;
    const lockScroll = () => {
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      document.body.style.touchAction = 'none';
    };
    const unlockScroll = () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
    };
    const openPanel = () => {
      sheetOpen = true;
      bar.style.transform = 'translateY(0)';
      bar.style.opacity = '1';
      bar.style.pointerEvents = 'auto';
      backdrop.style.opacity = '1';
      backdrop.style.pointerEvents = 'auto';
      lockScroll();
      // Load saved filters lazily when panel opens
      loadSavedFilters().catch((e) => console.warn('Failed to load saved filters on open', e));
      // Focus input for quick typing on mobile
      queryInput.focus();
    };
    const closePanel = () => {
      sheetOpen = false;
      bar.style.transform = 'translateY(-100%)';
      bar.style.opacity = '1';
      bar.style.pointerEvents = 'none';
      backdrop.style.opacity = '0';
      backdrop.style.pointerEvents = 'none';
      unlockScroll();
    };
    // Backdrop/keyboard close and responsive resize
    backdrop.addEventListener('click', closePanel);
    globalThis.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePanel();
    });
    globalThis.addEventListener('resize', () => {
      const wasOpen = sheetOpen;
      applyLayout();
      if (wasOpen) {
        // Re-apply the correct open transform for current layout
        openPanel();
      } else {
        closePanel();
      }
    });
  }

  /**
   * Initialize the feed
   */
  async init(filters?: FilterOptions): Promise<void> {
    this.currentFilters = filters;
    await this.loadVideos(filters);
    
    // Defer suggestion preloading significantly to avoid competing with initial load
    // Wait 10 seconds on mobile, 5 seconds on desktop to ensure initial content is loaded first
    if (globalThis.window !== undefined) {
      const suggestionDelay = this.isMobileDevice ? 10000 : 5000;
      globalThis.setTimeout(() => {
        this.preloadSuggestions().catch((e) => console.warn('Preload suggestions failed', e));
      }, suggestionDelay);
    }
  }

  /**
   * Preload suggestions in the background for instant search overlay opening
   */
  private async preloadSuggestions(): Promise<void> {
    // Prevent multiple simultaneous preloads
    if (this.isPreloading) {
      return;
    }

    this.isPreloading = true;
    try {
      // Fetch tags and performers in parallel (reduced from 40 to 20 for faster loading)
      const [tags, performers] = await Promise.all([
        this.api.searchMarkerTags('', 20),
        this.api.searchPerformers('', 20)
      ]);

      // Store in cache
      this.preloadedTags = tags;
      this.preloadedPerformers = performers;
    } catch (error) {
      console.warn('Failed to preload suggestions:', error);
      // Don't throw - preload failure shouldn't break the app
    } finally {
      this.isPreloading = false;
    }
  }

  /**
   * Prepare for loading videos (setup abort controller, check loading state)
   */
  private prepareLoadVideos(signal?: AbortSignal): AbortSignal {
    if (this.activeLoadVideosAbortController) {
      this.activeLoadVideosAbortController.abort();
      this.cleanupLoadObservers();
      this.stopLoadingVideos();
    }
    if (!signal) {
      this.activeLoadVideosAbortController = new AbortController();
      signal = this.activeLoadVideosAbortController.signal;
    }
    return signal;
  }

  /**
   * Calculate pagination parameters
   */
  private calculatePaginationParams(
    filters: FilterOptions,
    append: boolean
  ): { limit: number; offset: number; page: number } {
    const page = append ? this.currentPage + 1 : 1;
    const limit = append ? this.subsequentLoadLimit : (filters.limit || this.initialLoadLimit);
    let offset = 0;
    if (append && page > 1) {
      offset = this.initialLoadLimit + (page - 2) * this.subsequentLoadLimit;
    }
    return { limit, offset, page };
  }

  /**
   * Append markers to existing markers array
   */
  private appendMarkers(markers: SceneMarker[]): void {
    this.markers.push(...markers);
  }

  /**
   * Replace existing markers with new markers and clear posts
   */
  private replaceMarkers(markers: SceneMarker[]): void {
    this.markers = markers;
    this.clearPosts();
  }

  /**
   * Check if signal is aborted and handle cleanup
   */
  private checkAbortAndCleanupRender(signal?: AbortSignal): boolean {
    return this.checkAbortAndCleanup(signal);
  }

  /**
   * Process a single marker and add to fragment
   */
  private async processMarkerForRender(
    marker: SceneMarker | undefined,
    fragment: DocumentFragment | null,
    signal?: AbortSignal
  ): Promise<{ fragment: DocumentFragment; postContainer: HTMLElement | null }> {
    if (!marker) {
      return { fragment: fragment ?? document.createDocumentFragment(), postContainer: null };
    }

    const postContainer = await this.createPost(marker, signal);
    const currentFragment = fragment ?? document.createDocumentFragment();
    
    if (postContainer) {
      currentFragment.appendChild(postContainer);
    }

    return { fragment: currentFragment, postContainer };
  }

  /**
   * Remove skeleton loader if needed
   */
  private removeSkeletonIfNeeded(append: boolean, index: number): void {
    if (!append && index < this.getSkeletonCount()) {
      this.removeSkeletonLoader();
    }
  }

  /**
   * Check if fragment should be inserted into DOM
   */
  private shouldInsertFragment(index: number, renderChunkSize: number, markersLength: number): boolean {
    return (index + 1) % renderChunkSize === 0 || index === markersLength - 1;
  }

  /**
   * Insert fragment into DOM at appropriate position
   */
  private insertFragment(fragment: DocumentFragment, fragmentPostCount: number): void {
    if (fragmentPostCount === 0) {
      return;
    }

    if (this.loadMoreTrigger && this.loadMoreTrigger.parentNode === this.postsContainer) {
      this.postsContainer.insertBefore(fragment, this.loadMoreTrigger);
    } else {
      this.postsContainer.appendChild(fragment);
    }
  }

  /**
   * Wait for render delay if not last item
   */
  private async waitForRenderDelay(index: number, markersLength: number, renderDelay: number): Promise<void> {
    if (index < markersLength - 1) {
      await new Promise(resolve => setTimeout(resolve, renderDelay));
    }
  }

  /**
   * Render posts progressively in chunks
   */
  private async renderPostsProgressively(
    content: Array<{ type: 'marker' | 'image'; data: SceneMarker | Image; date?: string }> | SceneMarker[],
    append: boolean,
    signal: AbortSignal | undefined,
    renderChunkSize: number,
    renderDelay: number
  ): Promise<void> {
    let fragment: DocumentFragment | null = null;
    let fragmentPostCount = 0;

    // Handle both merged content and legacy markers array
    const isMergedContent = content.length > 0 && 'type' in content[0];
    const items = isMergedContent 
      ? content as Array<{ type: 'marker' | 'image'; data: SceneMarker | Image; date?: string }>
      : (content as SceneMarker[]).map(m => ({ type: 'marker' as const, data: m, date: m.scene.date }));

    for (let i = 0; i < items.length; i++) {
      if (this.checkAbortAndCleanupRender(signal)) {
        return;
      }

      const item = items[i];
      const result: { fragment: DocumentFragment; postContainer: HTMLElement | null } = item.type === 'marker'
        ? await this.processMarkerForRender(item.data as SceneMarker, fragment, signal)
        : await this.processImageForRender(item.data as Image, fragment, signal);
      fragment = result.fragment;
      
      if (result.postContainer) {
        fragmentPostCount++;
      }

      this.removeSkeletonIfNeeded(append, i);

      if (this.shouldInsertFragment(i, renderChunkSize, items.length) && fragment && fragmentPostCount > 0) {
        this.insertFragment(fragment, fragmentPostCount);
        fragment = null;
        fragmentPostCount = 0;

        await this.waitForRenderDelay(i, items.length, renderDelay);
      }
    }
  }

  /**
   * Process image for rendering
   */
  private async processImageForRender(
    image: Image | undefined,
    fragment: DocumentFragment | null,
    signal?: AbortSignal
  ): Promise<{ fragment: DocumentFragment; postContainer: HTMLElement | null }> {
    if (!image) {
      return { fragment: fragment ?? document.createDocumentFragment(), postContainer: null };
    }

    const postContainer = await this.createImagePost(image, signal);
    const currentFragment = fragment ?? document.createDocumentFragment();
    
    if (postContainer) {
      currentFragment.appendChild(postContainer);
    }

    return { fragment: currentFragment, postContainer };
  }

  /**
   * Create an image post
   */
  private async createImagePost(image: Image, signal?: AbortSignal): Promise<HTMLElement | null> {
    const imageUrl = this.getImageUrlForPost(image);
    if (!imageUrl) {
      return null;
    }

    const postContainer = this.createPostContainer();
    const post = this.createImagePostInstance(postContainer, image, imageUrl);
    
    this.posts.set(image.id, post);
    this.postOrder.push(image.id);
    // Don't observe images with VisibilityManager - they don't need video playback management
    // Images use their own simple IntersectionObserver in setupLazyLoadingForImage

    if (signal?.aborted) {
      return null;
    }

    this.setupLazyLoadingForImage(postContainer, post, image, imageUrl, signal);
    return postContainer;
  }

  /**
   * Get image URL for post
   */
  private getImageUrlForPost(image: Image): string | undefined {
    // Try paths.image first, then paths.preview, then paths.thumbnail
    const baseUrl = globalThis.location.origin;
    
    if (image.paths?.image) {
      const url = image.paths.image.startsWith('http') 
        ? image.paths.image 
        : `${baseUrl}${image.paths.image}`;
      return isValidMediaUrl(url) ? url : undefined;
    }
    if (image.paths?.preview) {
      const url = image.paths.preview.startsWith('http') 
        ? image.paths.preview 
        : `${baseUrl}${image.paths.preview}`;
      return isValidMediaUrl(url) ? url : undefined;
    }
    if (image.paths?.thumbnail) {
      const url = image.paths.thumbnail.startsWith('http') 
        ? image.paths.thumbnail 
        : `${baseUrl}${image.paths.thumbnail}`;
      return isValidMediaUrl(url) ? url : undefined;
    }
    return undefined;
  }

  /**
   * Create image post instance
   */
  private createImagePostInstance(
    postContainer: HTMLElement,
    image: Image,
    imageUrl: string
  ): ImagePost {
    const postData: ImagePostData = {
      image,
      imageUrl,
      aspectRatio: image.aspectRatio ?? (image.width && image.height ? image.width / image.height : undefined),
    };

    const post = new ImagePost(
      postContainer,
      postData,
      this.favoritesManager,
      this.api,
      this.visibilityManager,
      (performerId, performerName) => this.handlePerformerChipClick(performerId, performerName),
      (tagId, tagName) => this.handleTagChipClick(tagId, tagName)
    );
    
    post.initialize();
    return post;
  }

  /**
   * Setup lazy loading for image post
   */
  private setupLazyLoadingForImage(
    postContainer: HTMLElement,
    post: ImagePost,
    image: Image,
    imageUrl: string,
    signal?: AbortSignal
  ): void {
    // Use IntersectionObserver for lazy loading
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            observer.disconnect();
            if (!signal?.aborted) {
              post.loadPlayer(imageUrl);
            }
            break;
          }
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(postContainer);
    this.loadObservers.set(image.id, observer);
  }

  /**
   * Initialize load state for video loading
   */
  private initializeLoadState(append: boolean): void {
    this.isLoading = true;
    if (!append) {
      this.showSkeletonLoaders();
      this.currentPage = 1;
      this.hasMore = true;
    }
  }

  /**
   * Check if load should be aborted and handle cleanup
   */
  private checkAbortAndCleanup(signal?: AbortSignal): boolean {
    if (signal?.aborted) {
      this.isLoading = false;
      this.hideSkeletonLoaders();
      return true;
    }
    return false;
  }

  /**
   * Fetch scene markers from API
   */
  private async fetchMarkersForLoad(
    currentFilters: FilterOptions,
    limit: number,
    offset: number,
    signal?: AbortSignal
  ): Promise<{ markers: SceneMarker[]; totalCount: number }> {
    return await this.api.fetchSceneMarkers({
      ...currentFilters,
      limit,
      offset,
      shuffleMode: this.shuffleMode > 0,
      includeScenesWithoutMarkers: this.shuffleMode === 2,
    }, signal);
  }

  /**
   * Prefetch poster images for markers
   */
  private prefetchPosters(markers: SceneMarker[], append: boolean, currentFilters: FilterOptions): void {
    try {
      const prefetchCount = append ? this.subsequentLoadLimit : (currentFilters.limit || this.initialLoadLimit);
      posterPreloader.prefetchForMarkers(markers, prefetchCount);
    } catch (e) {
      console.warn('Poster prefetch failed', e);
    }
  }

  /**
   * Handle empty markers result
   */
  private handleEmptyMarkers(append: boolean): void {
    if (!append) {
      this.showError("It's empty");
    }
    this.hideSkeletonLoaders();
  }

  /**
   * Finalize load state after rendering
   */
  private finalizeLoadState(append: boolean, page: number): void {
    if (append) {
      this.currentPage = page;
    }

    if (!append) {
      this.hideSkeletonLoaders();
    }

    this.updateInfiniteScrollTrigger();
  }

  /**
   * Handle load error
   */
  private handleLoadError(error: unknown, append: boolean): void {
    console.error('Error loading scene markers:', error);
    if (!append) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.showError(`Failed to load scene markers: ${errorMessage}`);
    }
    this.hideSkeletonLoaders();
  }

  /**
   * Defer setting isLoading to false to prevent rapid successive loads
   */
  private deferLoadingComplete(): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.isLoading = false;
      });
    });
  }

  /**
   * Clear stored content ratio (called when filters change or feed is refreshed)
   */
  private clearContentRatio(): void {
    this.contentRatio = undefined;
    this.contentTotals = undefined;
    this.contentConsumed = undefined;
  }

  /**
   * Refresh the entire feed by clearing all posts and reloading from the beginning
   */
  async refreshFeed(): Promise<void> {
    // Clear all existing posts
    this.clearPosts();
    
    // Clear posts container
    if (this.postsContainer) {
      this.postsContainer.innerHTML = '';
    }
    
    // Recreate load more trigger
    if (this.loadMoreTrigger && this.postsContainer) {
      this.postsContainer.appendChild(this.loadMoreTrigger);
    }
    
    // Scroll to top
    globalThis.scrollTo(0, 0);
    if (this.scrollContainer) {
      this.scrollContainer.scrollTop = 0;
    }
    
    // Reset pagination state
    this.currentPage = 1;
    this.hasMore = true;
    this.markers = [];
    this.images = [];
    
    // Clear content ratio so it's recalculated on next load
    this.clearContentRatio();
    
    // Reload feed with current filters
    await this.loadVideos(this.currentFilters, false, undefined, true);
  }

  /**
   * Determine what content types should be loaded
   */
  private determineContentLoadingFlags(): {
    shouldLoadMarkers: boolean;
    shouldLoadImages: boolean;
    shouldLoadShortForm: boolean;
  } {
    const shortFormEnabledForCurrentMode = this.shouldLoadShortFormContent();
    const shortFormOnlyActive = this.settings.shortFormOnly === true && shortFormEnabledForCurrentMode;
    
    // In shuffle mode, don't force load short form content separately
    // It's already included naturally as scenes, so loading it separately would cause duplication
    const shouldLoadShortForm = this.shuffleMode === 0 && (shortFormEnabledForCurrentMode || shortFormOnlyActive);
    
    return {
      shouldLoadMarkers: !(this.settings.imagesOnly ?? false) && !shortFormOnlyActive,
      shouldLoadImages: this.shouldLoadImages() || (this.settings.imagesOnly ?? false),
      shouldLoadShortForm
    };
  }

  /**
   * Calculate content limits for markers and shortform
   * Uses stored ratio if available to maintain proportional fetching
   */
  private calculateContentLimits(
    limit: number,
    shouldLoadMarkers: boolean,
    shouldLoadShortForm: boolean
  ): { markerLimit: number; shortFormLimit: number } {
    let markerLimit = limit;
    let shortFormLimit = limit;
    
    if (shouldLoadMarkers && shouldLoadShortForm) {
      // If we have a stored ratio, use it to calculate proportional limits
      if (this.contentRatio) {
        markerLimit = Math.max(1, Math.round(limit * this.contentRatio.markerRatio));
        shortFormLimit = Math.max(1, Math.round(limit * this.contentRatio.shortFormRatio));
        // Ensure we don't exceed the total limit
        const total = markerLimit + shortFormLimit;
        if (total > limit) {
          // Adjust proportionally if we exceed
          const scale = limit / total;
          markerLimit = Math.max(1, Math.round(markerLimit * scale));
          shortFormLimit = Math.max(1, Math.round(shortFormLimit * scale));
        } else if (total < limit) {
          // Distribute remaining to maintain ratio
          const remaining = limit - total;
          if (this.contentRatio.markerRatio > this.contentRatio.shortFormRatio) {
            markerLimit += remaining;
          } else {
            shortFormLimit += remaining;
          }
        }
      } else {
        // Fallback: Split limit in half when both are enabled and no ratio available
        markerLimit = Math.ceil(limit / 2);
        shortFormLimit = Math.floor(limit / 2);
      }
    }
    
    return { markerLimit, shortFormLimit };
  }

  /**
   * Fetch all content types in parallel
   */
  private async fetchAllContent(options: {
    currentFilters: FilterOptions;
    limits: {
      limit: number;
      markerLimit: number;
      shortFormLimit: number;
    };
    offset: number;
    signal: AbortSignal | undefined;
    loadingFlags: {
      shouldLoadMarkers: boolean;
      shouldLoadImages: boolean;
      shouldLoadShortForm: boolean;
    };
  }): Promise<{
    markers: SceneMarker[];
    images: Image[];
    shortFormMarkers: SceneMarker[];
    markerCount: number;
    imageCount: number;
    shortFormCount: number;
  }> {
    const { currentFilters, limits, offset, signal, loadingFlags } = options;
    const { limit, markerLimit, shortFormLimit } = limits;
    const { shouldLoadMarkers, shouldLoadImages, shouldLoadShortForm } = loadingFlags;
    const [markersResult, imagesResult, shortFormResult] = await Promise.all([
      shouldLoadMarkers ? this.fetchMarkersForLoad(currentFilters, markerLimit, offset, signal) : Promise.resolve<{ markers: SceneMarker[]; totalCount: number }>({ markers: [], totalCount: 0 }),
      shouldLoadImages ? this.loadImages(currentFilters, limit, offset, signal) : Promise.resolve<{ images: Image[]; totalCount: number }>({ images: [], totalCount: 0 }),
      shouldLoadShortForm ? this.fetchShortFormVideosForLoad(currentFilters, shortFormLimit, offset, signal) : Promise.resolve<{ markers: SceneMarker[]; totalCount: number }>({ markers: [], totalCount: 0 }),
    ]);
    
    // Debug logging for fetched results
    if (shouldLoadMarkers) {
      console.log(`[Load] Fetched ${markersResult.markers.length} markers (limit: ${markerLimit}, total: ${markersResult.totalCount})`);
    }
    if (shouldLoadShortForm) {
      console.log(`[Load] Fetched ${shortFormResult.markers.length} short-form markers (limit: ${shortFormLimit}, total: ${shortFormResult.totalCount})`);
    }
    if (shouldLoadImages) {
      console.log(`[Load] Fetched ${imagesResult.images.length} images (limit: ${limit}, total: ${imagesResult.totalCount})`);
    }
    
    return {
      markers: markersResult.markers,
      images: imagesResult.images,
      shortFormMarkers: shortFormResult.markers,
      markerCount: markersResult.totalCount,
      imageCount: imagesResult.totalCount,
      shortFormCount: shortFormResult.totalCount
    };
  }

  /**
   * Process and merge fetched content
   */
  private async processFetchedContent(options: {
    content: {
      markers: SceneMarker[];
      shortFormMarkers: SceneMarker[];
      images: Image[];
    };
    counts: {
      markerCount: number;
      shortFormCount: number;
      imageCount: number;
    };
    currentFilters: FilterOptions;
    offset: number;
    append: boolean;
    shouldLoadMarkers: boolean;
  }): Promise<Array<{ type: 'marker' | 'image'; data: SceneMarker | Image; date?: string }>> {
    const { content, counts, currentFilters, offset, append, shouldLoadMarkers } = options;
    const { markers, shortFormMarkers, images } = content;
    const { markerCount, shortFormCount, imageCount } = counts;
    
    // Calculate and store ratio on initial load (when append is false)
    if (!append) {
      const total = markerCount + shortFormCount + imageCount;
      if (total > 0) {
        this.contentTotals = {
          markerTotal: markerCount,
          shortFormTotal: shortFormCount,
          imageTotal: imageCount
        };
        this.contentRatio = {
          markerRatio: markerCount / total,
          shortFormRatio: shortFormCount / total,
          imageRatio: imageCount / total
        };
        this.contentConsumed = {
          markers: 0,
          shortForm: 0,
          images: 0
        };
      }
    }
    
    // Merge regular markers, short-form markers, and images chronologically
    const mergedContent = this.mergeMarkersShortFormAndImages(markers, shortFormMarkers, images);

    const expectedLimit = append ? this.subsequentLoadLimit : (currentFilters.limit || this.initialLoadLimit);
    
    const allMarkers = [...markers, ...shortFormMarkers];
    this.processLoadedContent({
      content: {
        markers: allMarkers,
        images
      },
      counts: {
        markerCount,
        shortFormCount,
        imageCount
      },
      pagination: {
        offset,
        expectedLimit,
        totalContentLength: mergedContent.length
      },
      shouldLoadMarkers,
      append
    });

    return mergedContent;
  }

  /**
   * Render and finalize loaded content
   */
  private async renderAndFinalizeContent(
    mergedContent: Array<{ type: 'marker' | 'image'; data: SceneMarker | Image; date?: string }>,
    allMarkers: SceneMarker[],
    shouldLoadMarkers: boolean,
    currentFilters: FilterOptions,
    append: boolean,
    signal: AbortSignal | undefined,
    page: number
  ): Promise<void> {
    if (mergedContent.length === 0) {
      this.handleEmptyMarkers(append);
      return;
    }

    if (shouldLoadMarkers && allMarkers.length > 0) {
      this.prefetchPosters(allMarkers, append, currentFilters);
    }

    const renderChunkSize = 6;
    const renderDelay = 8;
    await this.renderPostsProgressively(mergedContent, append, signal, renderChunkSize, renderDelay);

    if (this.checkAbortAndCleanup(signal)) {
      return;
    }

    this.finalizeLoadState(append, page);
  }

  async loadVideos(filters?: FilterOptions, append: boolean = false, signal?: AbortSignal, force: boolean = false): Promise<void> {
    signal = this.prepareLoadVideos(signal);

    if (!force && this.isLoading) {
      return;
    }

    this.initializeLoadState(append);

    try {
      const currentFilters = filters || this.currentFilters || {};
      const { limit, offset, page } = this.calculatePaginationParams(currentFilters, append);

      if (this.checkAbortAndCleanup(signal)) {
        return;
      }

      const { shouldLoadMarkers, shouldLoadImages, shouldLoadShortForm } = this.determineContentLoadingFlags();
      
      // On initial load, fetch counts first to calculate ratio, then fetch with proportional limits
      let markerLimit: number;
      let shortFormLimit: number;
      
      if (!append && !this.contentRatio && shouldLoadMarkers && shouldLoadShortForm) {
        // Fetch with minimal limits (1 each) just to get totalCounts
        const countResults = await this.fetchAllContent({
          currentFilters,
          limits: {
            limit: 1,
            markerLimit: 1,
            shortFormLimit: 1
          },
          offset: 0,
          signal,
          loadingFlags: {
            shouldLoadMarkers,
            shouldLoadImages,
            shouldLoadShortForm
          }
        });
        
        // Calculate ratio from counts
        const total = countResults.markerCount + countResults.shortFormCount + countResults.imageCount;
        if (total > 0) {
          this.contentTotals = {
            markerTotal: countResults.markerCount,
            shortFormTotal: countResults.shortFormCount,
            imageTotal: countResults.imageCount
          };
          this.contentRatio = {
            markerRatio: countResults.markerCount / total,
            shortFormRatio: countResults.shortFormCount / total,
            imageRatio: countResults.imageCount / total
          };
          this.contentConsumed = {
            markers: 0,
            shortForm: 0,
            images: 0
          };
        }
      }
      
      // Calculate limits (will use stored ratio if available)
      const limits = this.calculateContentLimits(limit, shouldLoadMarkers, shouldLoadShortForm);
      markerLimit = limits.markerLimit;
      shortFormLimit = limits.shortFormLimit;
      
      // Debug logging for short-form content
      this.logShortFormSettings(shouldLoadShortForm);
      
      const {
        markers,
        images,
        shortFormMarkers,
        markerCount,
        imageCount,
        shortFormCount
      } = await this.fetchAllContent({
        currentFilters,
        limits: {
          limit,
          markerLimit,
          shortFormLimit
        },
        offset,
        signal,
        loadingFlags: {
          shouldLoadMarkers,
          shouldLoadImages,
          shouldLoadShortForm
        }
      });

      if (this.checkAbortAndCleanup(signal)) {
        return;
      }

      const mergedContent = await this.processFetchedContent({
        content: {
          markers,
          shortFormMarkers,
          images
        },
        counts: {
          markerCount,
          shortFormCount,
          imageCount
        },
        currentFilters,
        offset,
        append,
        shouldLoadMarkers
      });

      const allMarkers = [...markers, ...shortFormMarkers];
      await this.renderAndFinalizeContent(
        mergedContent,
        allMarkers,
        shouldLoadMarkers,
        currentFilters,
        append,
        signal,
        page
      );
    } catch (error: unknown) {
      this.handleLoadError(error, append);
    } finally {
      this.deferLoadingComplete();
    }
  }

  /**
   * Process markers and images into state when appending
   */
  private processMarkersAndImagesAppend(
    markers: SceneMarker[],
    images: Image[],
    shouldLoadMarkers: boolean
  ): void {
    // Process markers separately for backward compatibility
    if (shouldLoadMarkers) {
      this.appendMarkers(markers);
    }
    
    // Process images
    if (images.length > 0) {
      this.images.push(...images);
    }
  }

  /**
   * Process markers and images into state when replacing
   */
  private processMarkersAndImagesReplace(
    markers: SceneMarker[],
    images: Image[],
    shouldLoadMarkers: boolean
  ): void {
    // Process markers separately for backward compatibility
    if (shouldLoadMarkers) {
      this.replaceMarkers(markers);
    } else {
      this.clearPosts();
      this.markers = [];
    }
    
    // Process images
    if (images.length > 0) {
      this.images = images;
    }
  }

  /**
   * Calculate hasMore for images-only mode
   */
  private calculateHasMoreForImagesOnly(
    images: Image[],
    append: boolean,
    offset: number,
    imageCount: number,
    expectedLimit: number
  ): void {
    const totalLoaded = offset + images.length;
    this.hasMore = totalLoaded < imageCount && imageCount > 0;
    
    // Fallback: if count is unavailable (0), use length-based check
    if (imageCount === 0) {
      this.hasMore = images.length >= expectedLimit;
    }
    
    // Special case: if we got 0 results and it's not the first load, we've definitely reached the end
    if (append && images.length === 0) {
      this.hasMore = false;
    }
  }

  /**
   * Calculate hasMore for mixed content mode
   */
  private calculateHasMoreForMixedContent(
    append: boolean,
    offset: number,
    totalContentLength: number,
    expectedLimit: number,
    markerCount: number,
    shortFormCount: number,
    imageCount: number
  ): void {
    // Calculate total available content count
    const totalAvailable = markerCount + shortFormCount + imageCount;
    
    // Calculate total loaded so far
    const totalLoaded = offset + totalContentLength;
    
    // Use count-based calculation if counts are available
    if (totalAvailable > 0) {
      this.hasMore = totalLoaded < totalAvailable;
      console.log(`[hasMore] Total loaded: ${totalLoaded}, Total available: ${totalAvailable}, hasMore: ${this.hasMore}`);
    } else {
      // Fallback: if counts are unavailable (e.g., shuffle mode), use length-based check
      this.hasMore = totalContentLength >= expectedLimit;
      console.log(`[hasMore] Count unavailable, using length-based check: ${totalContentLength} >= ${expectedLimit}`);
    }
    
    // Special case: if we got 0 results and it's not the first load, we've definitely reached the end
    if (append && totalContentLength === 0) {
      this.hasMore = false;
      console.log(`[hasMore] Got 0 results on append, setting hasMore to false`);
    }
  }

  /**
   * Process loaded markers and images
   */
  private processLoadedContent(options: {
    content: {
      markers: SceneMarker[];
      images: Image[];
    };
    counts: {
      markerCount: number;
      shortFormCount: number;
      imageCount: number;
    };
    pagination: {
      offset: number;
      expectedLimit: number;
      totalContentLength: number;
    };
    shouldLoadMarkers: boolean;
    append: boolean;
  }): void {
    const {
      content: { markers, images },
      counts: { markerCount, shortFormCount, imageCount },
      pagination: { offset, expectedLimit, totalContentLength },
      shouldLoadMarkers,
      append
    } = options;
    
    if (append) {
      this.processMarkersAndImagesAppend(markers, images, shouldLoadMarkers);
    } else {
      this.processMarkersAndImagesReplace(markers, images, shouldLoadMarkers);
    }

    // Calculate hasMore using API counts to determine if there's more content available
    // This ensures infinite scroll works correctly when filters are applied
    this.calculateHasMore({
      pagination: {
        append,
        offset,
        totalContentLength,
        expectedLimit
      },
      counts: {
        markerCount,
        shortFormCount,
        imageCount
      },
      images
    });
  }

  /**
   * Calculate hasMore flag based on content type and pagination
   */
  private calculateHasMore(options: {
    pagination: {
      append: boolean;
      offset: number;
      totalContentLength: number;
      expectedLimit: number;
    };
    counts: {
      markerCount: number;
      shortFormCount: number;
      imageCount: number;
    };
    images: Image[];
  }): void {
    const { pagination, counts, images } = options;
    const { append, offset, totalContentLength, expectedLimit } = pagination;
    const { markerCount, shortFormCount, imageCount } = counts;
    
    if (this.settings.imagesOnly) {
      this.calculateHasMoreForImagesOnly(images, append, offset, imageCount, expectedLimit);
    } else {
      this.calculateHasMoreForMixedContent(
        append,
        offset,
        totalContentLength,
        expectedLimit,
        markerCount,
        shortFormCount,
        imageCount
      );
    }
  }

  /**
   * Check if images should be loaded
   */
  private shouldLoadImages(): boolean {
    const imagesEnabled = this.settings.includeImagesInFeed ?? true;
    const imagesOnly = this.settings.imagesOnly ?? false;
    const hasFileTypes = (this.settings.enabledFileTypes?.length ?? 0) > 0;
    return (imagesEnabled || imagesOnly) && hasFileTypes;
  }

  /**
   * Check if short-form content should be loaded based on settings and HD mode
   */
  private shouldLoadShortFormContent(): boolean {
    if (this.useHDMode) {
      return this.settings.shortFormInHDMode === true;
    } else {
      return this.settings.shortFormInNonHDMode !== false;
    }
  }

  /**
   * Log short-form content settings for debugging
   */
  private logShortFormSettings(shouldLoadShortForm: boolean): void {
    const shortFormEnabledForCurrentMode = this.shouldLoadShortFormContent();
  }

  /**
   * Fetch short-form videos for loading
   */
  private async fetchShortFormVideosForLoad(
    currentFilters: FilterOptions,
    limit: number,
    offset: number,
    signal?: AbortSignal
  ): Promise<{ markers: SceneMarker[]; totalCount: number }> {
    if (!this.api) {
      return { markers: [], totalCount: 0 };
    }

    const maxDuration = this.settings.shortFormMaxDuration || 120;
    return await this.api.fetchShortFormVideos(
      currentFilters,
      maxDuration,
      limit,
      offset,
      signal
    );
  }

  /**
   * Load images from Stash
   */
  private async loadImages(
    filters: FilterOptions,
    limit: number,
    offset: number,
    signal?: AbortSignal
  ): Promise<{ images: Image[]; totalCount: number }> {
    if (!this.shouldLoadImages() || !this.api) {
      return { images: [], totalCount: 0 };
    }

    try {
      const fileExtensions = this.settings.enabledFileTypes || ['.gif'];
      const imageFilters: {
        performerIds?: number[];
        tagIds?: string[];
      } = {};

      // Apply performer filter if set
      if (filters.performers && filters.performers.length > 0) {
        imageFilters.performerIds = filters.performers
          .map(p => Number.parseInt(p, 10))
          .filter(id => !Number.isNaN(id));
      }

      // Apply tag filter if set
      if (filters.tags && filters.tags.length > 0) {
        imageFilters.tagIds = filters.tags;
      }

      const imageFiltersWithOrientation = {
        ...imageFilters,
        ...(this.settings.orientationFilter && this.settings.orientationFilter.length > 0
          ? { orientationFilter: this.settings.orientationFilter }
          : {}),
      };

      const { images: graphQLImages, totalCount } = await this.api.findImages(
        fileExtensions,
        Object.keys(imageFiltersWithOrientation).length > 0 ? imageFiltersWithOrientation : undefined,
        limit,
        offset,
        signal
      );

      // Convert GraphQL Image to simplified Image type
      const images = graphQLImages.map(img => this.convertGraphQLImageToImage(img));
      return { images, totalCount };
    } catch (error) {
      console.error('FeedContainer: Failed to load images', error);
      return { images: [], totalCount: 0 };
    }
  }

  /**
   * Convert GraphQL Image to simplified Image type
   */
  private convertGraphQLImageToImage(graphqlImage: GraphQLImage): Image {
    const visualFile = graphqlImage.visual_files?.find(
      (file) => typeof (file as { width?: number }).width === 'number' && typeof (file as { height?: number }).height === 'number'
    ) as { width?: number; height?: number } | undefined;
    const width = visualFile?.width;
    const height = visualFile?.height;
    const aspectRatio = width && height && height !== 0 ? width / height : undefined;

    return {
      id: graphqlImage.id,
      title: graphqlImage.title,
      date: graphqlImage.date,
      rating100: graphqlImage.rating100,
      o_counter: graphqlImage.o_counter,
      width,
      height,
      aspectRatio,
      paths: graphqlImage.paths,
      tags: graphqlImage.tags,
      performers: graphqlImage.performers?.map(p => ({
        id: p.id,
        name: p.name,
        image_path: p.image_path,
      })),
    };
  }

  /**
   * Merge markers and images by interleaving in chunks
   * Preserves the random order from API (no sorting)
   */
  private mergeMarkersAndImages(markers: SceneMarker[], images: Image[]): Array<{ type: 'marker' | 'image'; data: SceneMarker | Image; date?: string }> {
    const content: Array<{ type: 'marker' | 'image'; data: SceneMarker | Image; date?: string }> = [];

    // If only one type, return it in original order
    if (markers.length === 0) {
      for (const image of images) {
        content.push({
          type: 'image',
          data: image,
          date: image.date,
        });
      }
      return content;
    }

    if (images.length === 0) {
      for (const marker of markers) {
        content.push({
          type: 'marker',
          data: marker,
          date: marker.scene.date,
        });
      }
      return content;
    }

    // Both types present - interleave in chunks
    const markerCount = markers.length;
    const imageCount = images.length;

    // Determine chunk sizes - always show 1-2 images between videos
    let videoChunkSize: number;
    const imageChunkSize = 1 + Math.floor(Math.random() * 2); // Always 1-2 images between videos

    if (markerCount > imageCount) {
      // More videos: larger video chunks
      videoChunkSize = 4 + Math.floor(Math.random() * 2); // 4-5
    } else if (imageCount > markerCount) {
      // More images: smaller video chunks
      videoChunkSize = 2 + Math.floor(Math.random() * 2); // 2-3
    } else {
      // Roughly equal: balanced chunks
      videoChunkSize = 3 + Math.floor(Math.random() * 2); // 3-4
    }

    // Interleave in chunks
    let markerIndex = 0;
    let imageIndex = 0;

    while (markerIndex < markerCount || imageIndex < imageCount) {
      // Add chunk of videos
      const videosToAdd = Math.min(videoChunkSize, markerCount - markerIndex);
      for (let i = 0; i < videosToAdd; i++) {
        const marker = markers[markerIndex++];
        content.push({
          type: 'marker',
          data: marker,
          date: marker.scene.date,
        });
      }

      // Add chunk of images
      const imagesToAdd = Math.min(imageChunkSize, imageCount - imageIndex);
      for (let i = 0; i < imagesToAdd; i++) {
        const image = images[imageIndex++];
        content.push({
          type: 'image',
          data: image,
          date: image.date,
        });
      }
    }

    return content;
  }

  /**
   * Check if only a single content type is present
   */
  private getSingleContentTypeResult(
    markers: SceneMarker[],
    shortFormMarkers: SceneMarker[],
    images: Image[]
  ): Array<{ type: 'marker' | 'image'; data: SceneMarker | Image; date?: string }> | null {
    // If only images
    if (markers.length === 0 && shortFormMarkers.length === 0) {
      return this.createImageContentArray(images);
    }

    // If only regular markers
    if (images.length === 0 && shortFormMarkers.length === 0) {
      return this.createMarkerContentArray(markers);
    }

    // If only short-form markers
    if (markers.length === 0 && images.length === 0) {
      return this.createMarkerContentArray(shortFormMarkers);
    }

    return null;
  }

  /**
   * Merge regular markers, short-form markers, and images in a unified, proportional mix
   * Interleaves all three types together evenly throughout the feed
   */
  private mergeMarkersShortFormAndImages(
    markers: SceneMarker[],
    shortFormMarkers: SceneMarker[],
    images: Image[]
  ): Array<{ type: 'marker' | 'image'; data: SceneMarker | Image; date?: string }> {
    // If only one type, return it in original order
    const singleTypeResult = this.getSingleContentTypeResult(markers, shortFormMarkers, images);
    if (singleTypeResult !== null) {
      return singleTypeResult;
    }

    // Multiple types present - mix all three together proportionally
    return this.unifiedMixContent(markers, shortFormMarkers, images);
  }

  /**
   * Create content array from images
   */
  private createImageContentArray(images: Image[]): Array<{ type: 'image'; data: Image; date?: string }> {
    return images.map(image => ({
      type: 'image' as const,
      data: image,
      date: image.date,
    }));
  }

  /**
   * Create content array from markers
   */
  private createMarkerContentArray(markers: SceneMarker[]): Array<{ type: 'marker'; data: SceneMarker; date?: string }> {
    return markers.map(marker => ({
      type: 'marker' as const,
      data: marker,
      date: marker.scene.date,
    }));
  }

  /**
   * Calculate proportions for content types
   */
  /**
   * Calculate proportions for content mixing
   * Uses stored ratio from initial load if available, otherwise falls back to remaining items
   */
  private calculateProportions(
    remainingMarkers: number,
    remainingShortForm: number,
    remainingImages: number,
    totalRemaining: number
  ): { markerRatio: number; shortFormRatio: number } {
    // If we have a stored ratio, use it adjusted by consumed items
    if (this.contentRatio && this.contentTotals && this.contentConsumed) {
      // Calculate how much of each type we should have consumed based on the ratio
      const totalConsumed = this.contentConsumed.markers + this.contentConsumed.shortForm + this.contentConsumed.images;
      const expectedMarkerConsumed = totalConsumed * this.contentRatio.markerRatio;
      const expectedShortFormConsumed = totalConsumed * this.contentRatio.shortFormRatio;
      const expectedImageConsumed = totalConsumed * this.contentRatio.imageRatio;
      
      // Calculate how far behind/ahead each type is from expected consumption
      const markerDeviation = expectedMarkerConsumed - this.contentConsumed.markers;
      const shortFormDeviation = expectedShortFormConsumed - this.contentConsumed.shortForm;
      const imageDeviation = expectedImageConsumed - this.contentConsumed.images;
      
      // Adjust ratios to favor types that are behind
      // Types that are behind get higher weight, types ahead get lower weight
      let markerWeight = this.contentRatio.markerRatio;
      let shortFormWeight = this.contentRatio.shortFormRatio;
      let imageWeight = this.contentRatio.imageRatio;
      
      // If a type is significantly behind, boost its weight
      const maxDeviation = Math.max(Math.abs(markerDeviation), Math.abs(shortFormDeviation), Math.abs(imageDeviation));
      if (maxDeviation > 0) {
        if (markerDeviation > 0 && remainingMarkers > 0) {
          markerWeight += markerDeviation / this.contentTotals.markerTotal * 0.5;
        }
        if (shortFormDeviation > 0 && remainingShortForm > 0) {
          shortFormWeight += shortFormDeviation / this.contentTotals.shortFormTotal * 0.5;
        }
        if (imageDeviation > 0 && remainingImages > 0) {
          imageWeight += imageDeviation / this.contentTotals.imageTotal * 0.5;
        }
      }
      
      // Normalize weights
      const totalWeight = markerWeight + shortFormWeight + imageWeight;
      if (totalWeight > 0) {
        return {
          markerRatio: markerWeight / totalWeight,
          shortFormRatio: shortFormWeight / totalWeight
        };
      }
    }
    
    // Fallback to original behavior: calculate from remaining items
    return {
      markerRatio: remainingMarkers / totalRemaining,
      shortFormRatio: remainingShortForm / totalRemaining
    };
  }

  /**
   * Select content type when max consecutive is reached
   */
  private selectContentTypeWhenMaxConsecutive(
    remaining: { markers: number; shortForm: number; images: number },
    ratios: { markerRatio: number; shortFormRatio: number },
    lastType: ContentType
  ): ContentType {
    const availableTypes: Array<ContentType> = [];
    if (remaining.markers > 0 && lastType !== 'marker') availableTypes.push('marker');
    if (remaining.shortForm > 0 && lastType !== 'shortform') availableTypes.push('shortform');
    if (remaining.images > 0 && lastType !== 'image') availableTypes.push('image');
    
    if (availableTypes.length > 0) {
      return availableTypes[Math.floor(Math.random() * availableTypes.length)];
    }
    
    // Fallback to proportional selection if no other types available
    const random = Math.random();
    if (random < ratios.markerRatio && remaining.markers > 0) {
      return 'marker';
    }
    if (random < ratios.markerRatio + ratios.shortFormRatio && remaining.shortForm > 0) {
      return 'shortform';
    }
    return 'image';
  }

  /**
   * Select content type using normal proportional selection
   */
  private selectContentTypeProportional(
    remaining: { markers: number; shortForm: number; images: number },
    ratios: { markerRatio: number; shortFormRatio: number }
  ): ContentType {
    const random = Math.random();
    if (random < ratios.markerRatio && remaining.markers > 0) {
      return 'marker';
    }
    if (random < ratios.markerRatio + ratios.shortFormRatio && remaining.shortForm > 0) {
      return 'shortform';
    }
    if (remaining.images > 0) {
      return 'image';
    }
    if (remaining.shortForm > 0) {
      return 'shortform';
    }
    return 'marker';
  }

  /**
   * Select content type based on proportions and consecutive count constraints
   */
  private selectContentType(options: {
    remaining: {
      markers: number;
      shortForm: number;
      images: number;
    };
    ratios: {
      markerRatio: number;
      shortFormRatio: number;
    };
    constraints: {
      consecutiveCount: number;
      maxConsecutive: number;
      lastType: ContentType | null;
    };
  }): ContentType {
    const { remaining, ratios, constraints } = options;
    const { consecutiveCount, maxConsecutive, lastType } = constraints;
    
    // If we've hit max consecutive, prefer other types
    if (consecutiveCount >= maxConsecutive && lastType) {
      return this.selectContentTypeWhenMaxConsecutive(remaining, ratios, lastType);
    }
    
    // Normal proportional selection
    return this.selectContentTypeProportional(remaining, ratios);
  }

  /**
   * Add content items of the selected type to the content array
   */
  private addContentItems(options: {
    content: Array<{ type: 'marker' | 'image'; data: SceneMarker | Image; date?: string }>;
    selectedType: ContentType;
    itemsToAdd: number;
    contentArrays: {
      markers: SceneMarker[];
      shortFormMarkers: SceneMarker[];
      images: Image[];
    };
    indices: {
      markerIndex: { value: number };
      shortFormIndex: { value: number };
      imageIndex: { value: number };
    };
  }): void {
    const { content, selectedType, itemsToAdd, contentArrays, indices } = options;
    const { markers, shortFormMarkers, images } = contentArrays;
    const { markerIndex, shortFormIndex, imageIndex } = indices;
    for (let i = 0; i < itemsToAdd; i++) {
      if (selectedType === 'marker' && markerIndex.value < markers.length) {
        const marker = markers[markerIndex.value++];
        content.push({
          type: 'marker',
          data: marker,
          date: marker.scene.date,
        });
      } else if (selectedType === 'shortform' && shortFormIndex.value < shortFormMarkers.length) {
        const shortForm = shortFormMarkers[shortFormIndex.value++];
        content.push({
          type: 'marker',
          data: shortForm,
          date: shortForm.scene.date,
        });
      } else if (selectedType === 'image' && imageIndex.value < images.length) {
        const image = images[imageIndex.value++];
        content.push({
          type: 'image',
          data: image,
          date: image.date,
        });
      }
    }
  }

  /**
   * Unified mixing algorithm that mixes markers, shortform, and images proportionally
   * Uses smaller alternations (1-3 items) and prevents any type from dominating
   */
  private unifiedMixContent(
    markers: SceneMarker[],
    shortFormMarkers: SceneMarker[],
    images: Image[]
  ): Array<{ type: 'marker' | 'image'; data: SceneMarker | Image; date?: string }> {
    const content: Array<{ type: 'marker' | 'image'; data: SceneMarker | Image; date?: string }> = [];
    
    const markerIndex = { value: 0 };
    const shortFormIndex = { value: 0 };
    const imageIndex = { value: 0 };
    
    // Track consecutive items of the same type to prevent dominance
    let consecutiveCount = 0;
    let lastType: ContentType | null = null;
    const maxConsecutive = 3; // Maximum consecutive items of same type
    
    while (markerIndex.value < markers.length || shortFormIndex.value < shortFormMarkers.length || imageIndex.value < images.length) {
      // Calculate remaining counts
      const remainingMarkers = markers.length - markerIndex.value;
      const remainingShortForm = shortFormMarkers.length - shortFormIndex.value;
      const remainingImages = images.length - imageIndex.value;
      const totalRemaining = remainingMarkers + remainingShortForm + remainingImages;
      
      if (totalRemaining === 0) break;
      
      // Calculate proportions
      const { markerRatio, shortFormRatio } = this.calculateProportions(
        remainingMarkers,
        remainingShortForm,
        remainingImages,
        totalRemaining
      );
      
      // Determine how many items to add from selected type (1-3 items)
      const itemsToAdd = 1 + Math.floor(Math.random() * 3); // 1-3 items
      
      // Select type based on proportions, but avoid too many consecutive items
      const selectedType = this.selectContentType({
        remaining: {
          markers: remainingMarkers,
          shortForm: remainingShortForm,
          images: remainingImages
        },
        ratios: {
          markerRatio,
          shortFormRatio
        },
        constraints: {
          consecutiveCount,
          maxConsecutive,
          lastType
        }
      });
      
      // Update consecutive count
      if (selectedType === lastType) {
        consecutiveCount++;
      } else {
        consecutiveCount = 1;
        lastType = selectedType;
      }
      
      // Calculate remaining for selected type
      let remainingForType: number;
      if (selectedType === 'marker') {
        remainingForType = remainingMarkers;
      } else if (selectedType === 'shortform') {
        remainingForType = remainingShortForm;
      } else {
        remainingForType = remainingImages;
      }
      const actualItemsToAdd = Math.min(itemsToAdd, remainingForType);
      
      // Add items from selected type
      this.addContentItems({
        content,
        selectedType,
        itemsToAdd: actualItemsToAdd,
        contentArrays: {
          markers,
          shortFormMarkers,
          images
        },
        indices: {
          markerIndex,
          shortFormIndex,
          imageIndex
        }
      });
      
      // Track consumed items for ratio maintenance
      if (this.contentConsumed) {
        if (selectedType === 'marker') {
          this.contentConsumed.markers += actualItemsToAdd;
        } else if (selectedType === 'shortform') {
          this.contentConsumed.shortForm += actualItemsToAdd;
        } else if (selectedType === 'image') {
          this.contentConsumed.images += actualItemsToAdd;
        }
      }
    }
    
    return content;
  }

  /**
   * Check if browser supports the video codec/format
   * Returns true if supported, false if not
   */
  private isVideoCodecSupported(marker: SceneMarker, videoUrl: string): boolean {
    // Create a temporary video element to check codec support
    const testVideo = document.createElement('video');
    
    // Check for HEVC/H.265 codec from scene files
    const sceneFiles = marker.scene?.files;
    if (!sceneFiles || sceneFiles.length === 0) {
      return true; // If no file info, assume supported
    }
    const firstFile = sceneFiles[0];
    if (firstFile) {
      const videoCodec = firstFile.video_codec?.toLowerCase() || '';
      const isHevc = videoCodec.includes('hevc') || 
                     videoCodec.includes('h.265') ||
                     videoCodec.includes('h265');
      
      if (isHevc) {
        // Check if browser supports HEVC
        const hevcSupport1 = testVideo.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0,mp4a.40.2"');
        const hevcSupport2 = testVideo.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0,mp4a.40.2"');
        const hevcSupport3 = testVideo.canPlayType('video/mp4; codecs="hev1"');
        const hevcSupport4 = testVideo.canPlayType('video/mp4; codecs="hvc1"');
        
        const hevcSupport = hevcSupport1 || hevcSupport2 || hevcSupport3 || hevcSupport4;
        
        // Empty string means not supported
        if (!hevcSupport || hevcSupport.length === 0) {
          return false; // HEVC not supported
        }
      }
    }
    
    // Check for Matroska/MKV format
    const isMatroska = videoUrl.toLowerCase().includes('.mkv') ||
                       videoUrl.toLowerCase().includes('matroska');
    
    if (isMatroska) {
      // Check if browser supports Matroska
      const matroskaSupport = testVideo.canPlayType('video/x-matroska') ||
                              testVideo.canPlayType('video/mkv');
      
      if (!matroskaSupport || matroskaSupport.length === 0) {
        return false; // Matroska not supported
      }
    }
    
    return true; // Codec/format appears to be supported
  }

  /**
   * Clean up all active load observers
   */
  private cleanupLoadObservers(): void {
    for (const [, observer] of this.loadObservers.entries()) {
      observer.disconnect();
    }
    this.loadObservers.clear();
  }

  /**
   * Cancel all pending requests (used during marker creation)
   */
  cancelAllPendingRequests(): void {
    if (this.activeLoadVideosAbortController) {
      this.activeLoadVideosAbortController.abort();
      this.activeLoadVideosAbortController = undefined;
    }
    if (this.activeSearchAbortController) {
      this.activeSearchAbortController.abort();
      this.activeSearchAbortController = undefined;
    }
    // Also stop any loading videos
    this.stopLoadingVideos();
  }

  /**
   * Stop video elements that are currently loading
   */
  private stopLoadingVideos(): void {
    for (const [, post] of this.posts.entries()) {
      const player = post.getPlayer();
      // Only handle video players (NativeVideoPlayer), not image players
      if (isNativeVideoPlayer(player)) {
        const videoElement = player.getVideoElement();
        // If video is loading (networkState is LOADING or networkState is 2), stop it
        if (videoElement.networkState === 2 || videoElement.readyState < 2) {
          try {
            videoElement.pause();
            videoElement.src = '';
            videoElement.load(); // This cancels the network request
          } catch (e: unknown) {
            // Ignore errors when stopping video (non-critical)
            if (e instanceof Error) {
              // Silently ignore - video stopping errors are not critical
            }
          }
        }
      }
    }
  }

  // Removed marker proximity checks for random start time to improve performance

  /**
   * Create a video post from a scene marker
   * Returns the post container element for batch DOM insertion
   */
  private async createPost(marker: SceneMarker, signal?: AbortSignal): Promise<HTMLElement | null> {
    const safeVideoUrl = this.getVideoUrlForPost(marker);
    if (!safeVideoUrl || !this.isVideoCodecSupported(marker, safeVideoUrl)) {
      return null;
    }

    const postContainer = this.createPostContainer();
    const startTime = this.calculateStartTime(marker);
    const post = this.createVideoPostInstance(postContainer, marker, safeVideoUrl, startTime);
    
    this.posts.set(marker.id, post);
    this.postOrder.push(marker.id);
    this.visibilityManager.observePost(postContainer, marker.id);

    if (signal?.aborted) {
      return null;
    }

    this.setupLazyLoading(postContainer, post, marker, safeVideoUrl, signal);
    return postContainer;
  }

  /**
   * Get video URL for post based on HD mode
   */
  private getVideoUrlForPost(marker: SceneMarker): string | undefined {
    const selectedUrl = this.useHDMode
      ? this.api.getVideoUrl(marker.scene)
      : this.api.getMarkerVideoUrl(marker);
    
    if (!isValidMediaUrl(selectedUrl)) {
      console.warn('FeedContainer: Skipping post creation - no valid video URL', {
        markerId: marker.id,
        markerTitle: marker.title,
        videoUrl: selectedUrl,
      });
      return undefined;
    }
    
    return selectedUrl;
  }

  /**
   * Create post container element
   */
  private createPostContainer(): HTMLElement {
    const postContainer = document.createElement('article');
    postContainer.className = 'video-post-wrapper';
    return postContainer;
  }

  /**
   * Calculate start time for video based on HD mode and shuffle mode
   */
  private calculateStartTime(marker: SceneMarker): number | undefined {
    if (!this.useHDMode) {
      return undefined; // Marker videos are pre-rendered clips
    }

    if (this.shuffleMode > 0) {
      return this.calculateRandomStartTime(marker);
    }

    return marker.seconds;
  }

  /**
   * Calculate random start time for shuffle mode
   */
  private calculateRandomStartTime(marker: SceneMarker): number {
    const sceneDuration = marker.scene?.files?.[0]?.duration;
    if (sceneDuration && sceneDuration > 0) {
      const maxStartTime = Math.floor(sceneDuration * 0.9);
      return Math.floor(Math.random() * maxStartTime);
    }
    return 0;
  }

  /**
   * Create VideoPost instance
   */
  private createVideoPostInstance(
    postContainer: HTMLElement,
    marker: SceneMarker,
    safeVideoUrl: string,
    startTime: number | undefined
  ): VideoPost {
    const postData: VideoPostData = {
      marker,
      videoUrl: safeVideoUrl,
      startTime: startTime,
      endTime: marker.end_seconds,
    };

    const post = new VideoPost(
      postContainer, 
      postData,
      {
        favoritesManager: this.favoritesManager,
        api: this.api,
        visibilityManager: this.visibilityManager,
        onPerformerChipClick: (performerId, performerName) => this.handlePerformerChipClick(performerId, performerName),
        onTagChipClick: (tagId, tagName) => this.handleTagChipClick(tagId, tagName),
        useShuffleMode: this.shuffleMode > 0,
        onCancelRequests: () => this.cancelAllPendingRequests()
      }
    );
    
    post.initialize();
    
    // Short form content is always HD by default, even when feed-level HD mode is off
    const isShortForm = typeof marker.id === 'string' && marker.id.startsWith('shortform-');
    if (isShortForm || this.useHDMode) {
      post.setHQMode(true);
    }
    
    return post;
  }

  /**
   * Setup lazy loading for video post
   */
  private setupLazyLoading(
    postContainer: HTMLElement,
    post: VideoPost,
    marker: SceneMarker,
    safeVideoUrl: string,
    signal?: AbortSignal
  ): void {
    const lazyLoadDistance = this.getLazyLoadDistance();
    const rootMargin = this.isMobileDevice 
      ? lazyLoadDistance 
      : this.getDesktopRootMargin(lazyLoadDistance);
    
    this.createLazyLoadObserver(postContainer, post, marker, rootMargin, signal);
  }

  /**
   * Get lazy load distance based on device capabilities
   */
  private getLazyLoadDistance(): string {
    if (this.deviceCapabilities.availableRAM < 2048) {
      return '25px';
    }
    if (this.deviceCapabilities.isHighEnd) {
      return '100px';
    }
    return '50px';
  }

  /**
   * Get root margin for desktop lazy loading
   */
  private getDesktopRootMargin(lazyLoadDistance: string): string {
    if (this.useHDMode) {
      return lazyLoadDistance;
    }
    if (this.deviceCapabilities.isHighEnd) {
      return '200px';
    }
    return '100px';
  }

  /**
   * Create and setup intersection observer for lazy loading
   */
  private createLazyLoadObserver(
    postContainer: HTMLElement,
    post: VideoPost,
    marker: SceneMarker,
    rootMargin: string,
    signal?: AbortSignal
  ): void {
    const loadObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this.handleVideoLoad(entry, post, marker, loadObserver, signal);
          }
        }
      },
      { rootMargin, threshold: 0 }
    );
    
    this.loadObservers.set(marker.id, loadObserver);
    loadObserver.observe(postContainer);
  }

  /**
   * Handle video loading when intersection observer triggers
   */
  private handleVideoLoad(
    entry: IntersectionObserverEntry,
    post: VideoPost,
    marker: SceneMarker,
    loadObserver: IntersectionObserver,
    signal?: AbortSignal
  ): void {
    if (signal?.aborted) {
      loadObserver.disconnect();
      this.loadObservers.delete(marker.id);
      return;
    }
    
    const player = post.preload();
    if (isNativeVideoPlayer(player)) {
      // Only register video players with visibility manager
      this.visibilityManager.registerPlayer(marker.id, player);
    } else {
      console.warn('FeedContainer: Player not created', { markerId: marker.id });
    }
    
    loadObserver.disconnect();
    this.loadObservers.delete(marker.id);
  }


  /**
   * Clear all posts
   */
  private clearPosts(): void {
    // Stop background preloading
    this.stopBackgroundPreloading();
    
    for (const post of this.posts.values()) {
      post.destroy();
    }
    this.posts.clear();
    this.postOrder = [];
    this.eagerPreloadedPosts.clear();
    this.activePreloadPosts.clear();
    this.backgroundPreloadPriorityQueue = [];
    this.currentlyPreloadingCount = 0;
    this.mobilePreloadQueue = [];
    this.mobilePreloadActive = false;
    this.cancelScheduledPreload();
    // Don't clear posts container - let browser handle cleanup naturally
    // if (this.postsContainer) {
    //   // Clear posts efficiently
    //   while (this.postsContainer.firstChild) {
    //     this.postsContainer.removeChild(this.postsContainer.firstChild);
    //   }
    // }
    
    // Clean up all load observers
    this.cleanupLoadObservers();
    
    // Recreate load more trigger at bottom of posts
    if (this.loadMoreTrigger && this.postsContainer) {
      this.postsContainer.appendChild(this.loadMoreTrigger);
    }
  }

  /**
   * Setup infinite scroll
   */
  private setupInfiniteScroll(): void {
    // Create a trigger element at the bottom of the feed
    this.loadMoreTrigger = document.createElement('div');
    this.loadMoreTrigger.className = 'load-more-trigger';
    this.loadMoreTrigger.style.height = '100px';
    this.loadMoreTrigger.style.width = '100%';
    // Append the trigger to the posts container so the filter bar stays intact
    if (this.postsContainer) {
      this.postsContainer.appendChild(this.loadMoreTrigger);
    } else {
      this.scrollContainer.appendChild(this.loadMoreTrigger);
    }

    // Use Intersection Observer to detect when trigger is visible
    // Use document as root to work with window scrolling
    // Less aggressive on mobile to prevent loading too much content ahead
    const rootMargin = this.isMobileDevice ? '50px' : '200px';
    this.scrollObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !this.isLoading && this.hasMore) {
            this.loadVideos(undefined, true).catch((error) => {
              console.error('Error loading more markers:', error);
            });
          }
        }
      },
      {
        root: null, // Use viewport (window) as root
        rootMargin, // Start loading before reaching the trigger (less aggressive on mobile)
        threshold: 0.1,
      }
    );

    if (this.loadMoreTrigger) {
      this.scrollObserver.observe(this.loadMoreTrigger);
    }
  }

  /**
   * Update infinite scroll trigger position
   */
  private updateInfiniteScrollTrigger(): void {
    if (this.loadMoreTrigger && this.postsContainer) {
      // Ensure trigger is at the bottom of posts
      this.postsContainer.appendChild(this.loadMoreTrigger);
    }
  }

  /**
   * Autoplay the first N posts by force-loading and playing them
   */
  private async autoplayInitial(count: number): Promise<void> {
    const initial = this.markers.slice(0, Math.min(count, this.markers.length));
    
    // Load all players first
    for (const marker of initial) {
      const post = this.posts.get(marker.id);
      if (!post) continue;
      if (!post.hasVideoSource()) continue;
      const player = post.preload();
      if (isNativeVideoPlayer(player)) {
        // Register with visibility manager (only video players)
        this.visibilityManager.registerPlayer(marker.id, player);
        this.eagerPreloadedPosts.add(marker.id);
      }
    }
    
    // Wait a bit for players to initialize
    await new Promise((r) => setTimeout(r, 100));
    
    // Now attempt to play with robust retry logic
    for (const marker of initial) {
      const post = this.posts.get(marker.id);
      if (!post) continue;
      const player = post.getPlayer();
      if (!player) continue;
      
      // Only handle video players (skip image players)
      if (!isNativeVideoPlayer(player)) continue;
      
      // Robust play with multiple retries
      const tryPlay = async (attempt: number = 1, maxAttempts: number = 5): Promise<void> => {
        try {
          // Wait for video to be ready
          await player.waitUntilCanPlay(5000);
          
          // Small delay to ensure layout/visibility settles
          await new Promise((r) => setTimeout(r, 100));
          
          // Attempt to play
          await player.play();
        } catch (e) {
          console.warn(`Autoplay initial attempt ${attempt} failed for marker ${marker.id}`, e);
          
          if (attempt < maxAttempts) {
            // Exponential backoff: 200ms, 400ms, 800ms, 1600ms
            const delay = Math.min(200 * Math.pow(2, attempt - 1), 1600);
            await new Promise((r) => setTimeout(r, delay));
            await tryPlay(attempt + 1, maxAttempts);
          } else {
            console.error(`Autoplay initial: All attempts failed for marker ${marker.id}`);
          }
        }
      };
      
      // Start playing attempt (don't await to allow parallel attempts)
      // Intentionally ignore errors - errors are handled within tryPlay()
      tryPlay().catch(() => {
        // Errors are handled within tryPlay() function
      });
    }
  }

  private shouldEnableVisibilityDebug(): boolean {
    try {
      if (globalThis.window !== undefined && globalThis.localStorage !== undefined) {
        return globalThis.localStorage.getItem('stashgifs-visibility-debug') === '1';
      }
    } catch {
      // Ignore storage errors
    }
    return false;
  }

  private scheduleEagerPreload(): void {
    if (this.eagerPreloadScheduled) {
      return;
    }

    const execute = () => {
      this.eagerPreloadScheduled = false;
      this.eagerPreloadHandle = undefined;
      this.runEagerPreload();
    };

    if (globalThis.window === undefined) {
      execute();
      return;
    }

    this.eagerPreloadScheduled = true;
    this.eagerPreloadHandle = globalThis.setTimeout(execute, 32);
  }

  private runEagerPreload(): void {
    const orderedPosts = this.postOrder
      .map((id) => this.posts.get(id))
      .filter((post): post is VideoPost => !!post);

    if (!orderedPosts.length) {
      return;
    }

    let started = 0;
    const budget = Math.max(1, this.maxSimultaneousPreloads);

    for (let index = 0; index < orderedPosts.length && index < this.eagerPreloadCount; index++) {
      const post = orderedPosts[index];
      if (!post) continue;
      const postId = post.getPostId();

      if (this.eagerPreloadedPosts.has(postId)) {
        continue;
      }

      if (!post.hasVideoSource()) {
        this.eagerPreloadedPosts.add(postId);
        continue;
      }

      const player = post.preload();
      this.eagerPreloadedPosts.add(postId);

      if (isNativeVideoPlayer(player)) {
        // Only register video players with visibility manager
        this.visibilityManager.registerPlayer(postId, player);
        started += 1;
      }

      if (started >= budget) {
        break;
      }
    }

    const hasPending = orderedPosts
      .slice(0, this.eagerPreloadCount)
      .some((post) => {
        const postId = post.getPostId();
        if (this.eagerPreloadedPosts.has(postId)) {
          return false;
        }
        return post.hasVideoSource() && !post.isPlayerLoaded();
      });

    if (hasPending) {
      this.scheduleEagerPreload();
    }
  }

  private cancelScheduledPreload(): void {
    if (!this.eagerPreloadHandle) {
      return;
    }

    if (globalThis.window !== undefined) {
      globalThis.clearTimeout(this.eagerPreloadHandle);
    }

    this.eagerPreloadHandle = undefined;
    this.eagerPreloadScheduled = false;
  }

  /**
   * Calculate distance of element from viewport
   */
  private getViewportDistance(element: HTMLElement): number {
    if (!element) {
      return 0;
    }
    
    const rect = element.getBoundingClientRect();
    
    // Fallback for mobile: if element isn't laid out yet (rect is all zeros), return 0 (assume visible)
    if (rect.width === 0 && rect.height === 0 && rect.top === 0 && rect.left === 0) {
      // Element might not be laid out yet, especially on mobile
      // Check if it's actually in the DOM
      if (!element.offsetParent && element.style.display !== 'none') {
        return 0;
      }
    }
    const viewportHeight = globalThis.innerHeight;
    const viewportTop = 0;
    const viewportBottom = viewportHeight;

    // If element is above viewport
    if (rect.bottom < viewportTop) {
      return viewportTop - rect.bottom;
    }
    // If element is below viewport
    if (rect.top > viewportBottom) {
      return rect.top - viewportBottom;
    }
    // Element is in or overlapping viewport
    return 0;
  }

  /**
   * Calculate preload priority by sorting posts by viewport distance
   */
  private calculatePreloadPriority(): string[] {
    const orderedPosts = this.postOrder
      .map((id) => {
        const post = this.posts.get(id);
        if (!post || !post.hasVideoSource() || post.isPlayerLoaded()) {
          return null;
        }
        const container = post.getContainer();
        const distance = this.getViewportDistance(container);
        return { id, distance };
      })
      .filter((item): item is { id: string; distance: number } => item !== null)
      .sort((a, b) => a.distance - b.distance)
      .map((item) => item.id);

    return orderedPosts;
  }

  /**
   * Get next unloaded video from priority queue
   */
  private getNextUnloadedVideo(): string | null {
    // Refresh priority queue if empty
    if (this.backgroundPreloadPriorityQueue.length === 0) {
      this.backgroundPreloadPriorityQueue = this.calculatePreloadPriority();
    }

    // Remove already loaded videos from queue
    while (this.backgroundPreloadPriorityQueue.length > 0) {
      const postId = this.backgroundPreloadPriorityQueue[0];
      if (!postId) {
        this.backgroundPreloadPriorityQueue.shift();
        continue;
      }
      const post = this.posts.get(postId);
      
      if (!post || post.isPlayerLoaded() || !post.hasVideoSource()) {
        this.backgroundPreloadPriorityQueue.shift();
        continue;
      }

      if (this.activePreloadPosts.has(postId)) {
        this.backgroundPreloadPriorityQueue.shift();
        continue;
      }

      // Check if already in eager preload set
      if (this.eagerPreloadedPosts.has(postId)) {
        this.backgroundPreloadPriorityQueue.shift();
        continue;
      }

      return postId;
    }

    return null;
  }

  /**
   * Calculate delay based on scroll velocity
   */
  private getPreloadDelay(): number {
    const threshold = this.settings.backgroundPreloadScrollVelocityThreshold ?? 2;
    const normalDelay = this.settings.backgroundPreloadDelay ?? 150;
    const fastScrollDelay = this.settings.backgroundPreloadFastScrollDelay ?? 400;

    if (this.scrollVelocity > threshold) {
      return fastScrollDelay;
    }

    return normalDelay;
  }

  /**
   * Check if preloading should be throttled
   */
  private shouldThrottlePreloading(): boolean {
    // Check if tab is in background
    if (typeof document !== 'undefined' && document.hidden) {
      return true;
    }

    // Check if we've hit concurrent preload limit
    if (this.currentlyPreloadingCount >= this.maxSimultaneousPreloads) {
      return true;
    }

    return false;
  }

  /**
   * Track an active background preload and decrement counters when ready or timed out
   */
  private trackBackgroundPreload(postId: string, player: NativeVideoPlayer): void {
    if (this.activePreloadPosts.has(postId)) {
      return;
    }

    this.activePreloadPosts.add(postId);
    this.currentlyPreloadingCount += 1;

    const readinessTimeout = 5000;
    const scheduleTimeout = (cb: () => void, delay: number) => {
      if (globalThis.window !== undefined && typeof globalThis.setTimeout === 'function') {
        globalThis.setTimeout(cb, delay);
      } else {
        setTimeout(cb, delay);
      }
    };
    const waitForReady = async (): Promise<void> => {
      try {
        await Promise.race([
          player.waitUntilCanPlay(3000).catch(() => undefined),
          new Promise<void>((resolve) => {
            scheduleTimeout(() => resolve(), readinessTimeout);
          }),
        ]);
      } catch {
        // Ignore readiness errors – cleanup happens in finally
      } finally {
        this.activePreloadPosts.delete(postId);
        this.currentlyPreloadingCount = Math.max(0, this.currentlyPreloadingCount - 1);
      }
    };

    waitForReady().catch(() => {
      this.activePreloadPosts.delete(postId);
      this.currentlyPreloadingCount = Math.max(0, this.currentlyPreloadingCount - 1);
    });
  }

  /**
   * Process mobile preload queue with controlled concurrency
   */
  private processMobilePreloadQueue(): void {
    if (this.mobilePreloadQueue.length === 0) {
      this.mobilePreloadActive = false;
      return;
    }

    // Check if we've reached max concurrent preloads
    if (this.currentlyPreloadingCount >= this.maxSimultaneousPreloads) {
      // Retry after a short delay
      globalThis.setTimeout(() => {
        this.processMobilePreloadQueue();
      }, 100);
      return;
    }

    const postId = this.mobilePreloadQueue.shift();
    if (!postId) {
      this.mobilePreloadActive = false;
      return;
    }

    // Check if post is still in viewport before preloading
    if (!this.isPostInViewport(postId)) {
      this.processMobilePreloadQueue();
      return;
    }

    const post = this.posts.get(postId);
    if (!post || post.isPlayerLoaded() || !post.hasVideoSource()) {
      // Skip and continue
      this.processMobilePreloadQueue();
      return;
    }

    // Mark as active
    this.currentlyPreloadingCount++;
    this.activePreloadPosts.add(postId);

    // Preload the video
    try {
      const player = post.preload();
      if (isNativeVideoPlayer(player)) {
        // Only register video players with visibility manager
        this.visibilityManager.registerPlayer(postId, player);
        this.trackBackgroundPreload(postId, player);
      } else {
        this.currentlyPreloadingCount = Math.max(0, this.currentlyPreloadingCount - 1);
        this.activePreloadPosts.delete(postId);
      }
    } catch (error) {
      console.warn('Mobile preload failed for post', postId, error);
      this.currentlyPreloadingCount = Math.max(0, this.currentlyPreloadingCount - 1);
      this.activePreloadPosts.delete(postId);
    }

    // Continue processing queue with a small delay to prevent network congestion
    // Add delay between queue items on mobile to space out requests
    const delay = this.isMobileDevice ? 150 : 0;
    if (delay > 0) {
      globalThis.setTimeout(() => {
        this.processMobilePreloadQueue();
      }, delay);
    } else {
      this.processMobilePreloadQueue();
    }
  }

  /**
   * Check if a post is currently in or near the viewport
   */
  private isPostInViewport(postId: string): boolean {
    const post = this.posts.get(postId);
    if (!post) return false;
    
    const container = post.getContainer();
    const rect = container.getBoundingClientRect();
    const viewportHeight = globalThis.innerHeight;
    const viewportWidth = globalThis.innerWidth;
    const margin = 500; // Consider posts within 500px as "near" viewport
    
    return rect.bottom > -margin && 
           rect.top < viewportHeight + margin &&
           rect.right > -margin && 
           rect.left < viewportWidth + margin;
  }

  /**
   * Cancel preload for a post if it's out of view
   */
  private cancelPreloadIfOutOfView(postId: string): void {
    if (!this.isPostInViewport(postId)) {
      // Remove from active preloads
      if (this.activePreloadPosts.has(postId)) {
        this.activePreloadPosts.delete(postId);
        this.currentlyPreloadingCount = Math.max(0, this.currentlyPreloadingCount - 1);
      }
      
      // Remove from queues
      const queueIndex = this.backgroundPreloadPriorityQueue.indexOf(postId);
      if (queueIndex !== -1) {
        this.backgroundPreloadPriorityQueue.splice(queueIndex, 1);
      }
      
      const mobileIndex = this.mobilePreloadQueue.indexOf(postId);
      if (mobileIndex !== -1) {
        this.mobilePreloadQueue.splice(mobileIndex, 1);
      }
    }
  }

  /**
   * Process next video in background preload queue
   */
  private preloadNextVideo(): void {
    // Check if preloading should be paused
    if (this.shouldThrottlePreloading()) {
      // Schedule next attempt after delay
      const delay = this.getPreloadDelay();
      this.backgroundPreloadHandle = globalThis.setTimeout(() => {
        this.preloadNextVideo();
      }, delay);
      return;
    }

    // Get next video to preload
    if (this.backgroundPreloadPriorityQueue.length === 0) {
      // No more videos to preload, stop background preloading
      this.backgroundPreloadActive = false;
      return;
    }

    const postId = this.backgroundPreloadPriorityQueue[0];
    if (!postId) {
      this.backgroundPreloadPriorityQueue.shift();
      this.preloadNextVideo();
      return;
    }

    // Check if post is still in viewport before preloading
    if (!this.isPostInViewport(postId)) {
      this.backgroundPreloadPriorityQueue.shift();
      this.preloadNextVideo();
      return;
    }

    const post = this.posts.get(postId);
    if (!post || post.isPlayerLoaded() || !post.hasVideoSource()) {
      // Skip this one and try next
      this.backgroundPreloadPriorityQueue.shift();
      this.preloadNextVideo();
      return;
    }

    // Mark as preloaded to avoid duplicates
    this.eagerPreloadedPosts.add(postId);

    // Preload the video
    try {
      const player = post.preload();
      if (isNativeVideoPlayer(player)) {
        // Only register video players with visibility manager
        this.visibilityManager.registerPlayer(postId, player);
        this.trackBackgroundPreload(postId, player);
      }
    } catch (error) {
      console.warn('Background preload failed for post', postId, error);
    }

    // Remove from queue
    this.backgroundPreloadPriorityQueue.shift();

    // Schedule next preload
    const delay = this.getPreloadDelay();
    this.backgroundPreloadHandle = globalThis.setTimeout(() => {
      this.preloadNextVideo();
    }, delay);
  }

  /**
   * Start background preloading system
   */
  private startBackgroundPreloading(): void {
    // Check if enabled
    if (!this.settings.backgroundPreloadEnabled) {
      return;
    }

    // Don't start if already active
    if (this.backgroundPreloadActive) {
      return;
    }

    // Don't start if no posts yet
    if (this.posts.size === 0) {
      return;
    }

    this.backgroundPreloadActive = true;
    this.backgroundPreloadPriorityQueue = this.calculatePreloadPriority();

    // Start preloading after a short delay
    const delay = this.getPreloadDelay();
    this.backgroundPreloadHandle = globalThis.setTimeout(() => {
      this.preloadNextVideo();
    }, delay);
  }

  /**
   * Stop background preloading
   */
  private stopBackgroundPreloading(): void {
    this.backgroundPreloadActive = false;
    if (this.backgroundPreloadHandle) {
      globalThis.clearTimeout(this.backgroundPreloadHandle);
      this.backgroundPreloadHandle = undefined;
    }
  }

  /**
   * Clean up posts that are far from viewport to free memory
   * Called periodically during scrolling
   * More aggressive cleanup to prevent excessive RAM usage
   */
  private cleanupDistantPosts(): void {
    // Less aggressive: keep more posts in memory to avoid jarring DOM removals
    // Keep 15 posts in HD mode, 20 in normal mode
    const maxPostsInMemory = this.useHDMode ? 15 : 20;
    
    // Only enforce maximum if we significantly exceed limit
    if (this.posts.size <= maxPostsInMemory * 1.5) {
      return;
    }

    const postsWithDistance = this.calculatePostDistances();
    const postsToRemove = this.determinePostsToRemove(postsWithDistance, maxPostsInMemory);
    
    for (const { postId } of postsToRemove) {
      this.removePost(postId);
    }
    
    this.cleanupMarkersForRemovedPosts(postsToRemove);
  }

  /**
   * Calculate distance from viewport for each post
   */
  private calculatePostDistances(): Array<{ postId: string; distance: number; isVisible: boolean }> {
    const viewportTop = globalThis.scrollY || globalThis.pageYOffset;
    const viewportBottom = viewportTop + globalThis.innerHeight;
    const postsWithDistance: Array<{ postId: string; distance: number; isVisible: boolean }> = [];
    
    for (const [postId, post] of this.posts.entries()) {
      const container = post.getContainer();
      const rect = container.getBoundingClientRect();
      const elementTop = viewportTop + rect.top;
      const elementBottom = elementTop + rect.height;
      
      const isVisible = elementBottom > viewportTop && elementTop < viewportBottom;
      const distance = this.calculateDistanceFromViewport(elementTop, elementBottom, viewportTop, viewportBottom);
      
      postsWithDistance.push({ postId, distance, isVisible });
    }
    
    // Sort by distance (furthest first), but prioritize non-visible posts
    postsWithDistance.sort((a, b) => {
      if (a.isVisible !== b.isVisible) {
        return a.isVisible ? 1 : -1; // Non-visible first
      }
      return b.distance - a.distance; // Furthest first
    });
    
    return postsWithDistance;
  }

  /**
   * Calculate distance from viewport for an element
   */
  private calculateDistanceFromViewport(
    elementTop: number,
    elementBottom: number,
    viewportTop: number,
    viewportBottom: number
  ): number {
    if (elementBottom < viewportTop) {
      return viewportTop - elementBottom;
    }
    if (elementTop > viewportBottom) {
      return elementTop - viewportBottom;
    }
    return 0;
  }

  /**
   * Determine which posts should be removed based on distance and memory limits
   */
  private determinePostsToRemove(
    postsWithDistance: Array<{ postId: string; distance: number; isVisible: boolean }>,
    maxPostsInMemory: number
  ): Array<{ postId: string; distance: number; isVisible: boolean }> {
    const minPostsToKeep = Math.max(5, maxPostsInMemory - 3);
    const postsToRemove = postsWithDistance.slice(0, Math.max(0, this.posts.size - minPostsToKeep));
    
    // Also remove posts that are very far from viewport (even if under limit)
    const cleanupDistance = this.useHDMode ? 1000 : 1500;
    for (const postInfo of postsWithDistance) {
      if (this.shouldRemoveDistantPost(postInfo, cleanupDistance, postsToRemove, minPostsToKeep)) {
        postsToRemove.push(postInfo);
      }
    }
    
    return postsToRemove;
  }

  /**
   * Check if a distant post should be removed
   */
  private shouldRemoveDistantPost(
    postInfo: { postId: string; distance: number; isVisible: boolean },
    cleanupDistance: number,
    postsToRemove: Array<{ postId: string; distance: number; isVisible: boolean }>,
    minPostsToKeep: number
  ): boolean {
    if (postInfo.isVisible || postInfo.distance <= cleanupDistance) {
      return false;
    }
    if (postsToRemove.some(p => p.postId === postInfo.postId)) {
      return false;
    }
    return this.posts.size - postsToRemove.length > minPostsToKeep;
  }

  /**
   * Remove a single post and clean up all associated resources
   */
  private removePost(postId: string): void {
    this.cancelPreloadIfOutOfView(postId);
    
    const post = this.posts.get(postId);
    if (post) {
      this.destroyPostPlayer(post);
      this.visibilityManager.unobservePost(postId);
      post.destroy();
      this.posts.delete(postId);
      this.removePostFromOrder(postId);
    }
    
    this.cleanupLoadObserver(postId);
  }

  /**
   * Destroy a post's video player
   */
  private destroyPostPlayer(post: VideoPost | ImagePost): void {
    const player = post.getPlayer();
    if (!player) {
      return;
    }
    
    // Only video players have unload method
    if (isNativeVideoPlayer(player) && !player.getIsUnloaded()) {
      player.unload();
    }
    player.destroy();
  }

  /**
   * Remove post ID from post order array
   */
  private removePostFromOrder(postId: string): void {
    const index = this.postOrder.indexOf(postId);
    if (index !== -1) {
      this.postOrder.splice(index, 1);
    }
  }

  /**
   * Clean up load observer for a post
   */
  private cleanupLoadObserver(postId: string): void {
    const observer = this.loadObservers.get(postId);
    if (observer) {
      observer.disconnect();
      this.loadObservers.delete(postId);
    }
  }

  /**
   * Remove markers for deleted posts to free memory
   */
  private cleanupMarkersForRemovedPosts(
    postsToRemove: Array<{ postId: string; distance: number; isVisible: boolean }>
  ): void {
    if (postsToRemove.length === 0) {
      return;
    }
    
    const removedPostIds = new Set(postsToRemove.map(p => p.postId));
    this.markers = this.markers.filter(marker => !removedPostIds.has(marker.id));
  }

  /**
   * Trigger video loading when user hovers over a video that hasn't loaded yet
   */
  private triggerVideoLoadOnHover(postId: string): void {
    const post = this.posts.get(postId);
    if (!post) {
      return;
    }

    // If player already exists, nothing to do
    if (post.isPlayerLoaded()) {
      return;
    }

    // If post has a video source, trigger preload
    if (post.hasVideoSource()) {
      const player = post.preload();
      if (isNativeVideoPlayer(player)) {
        // Register player with VisibilityManager - it will handle playing when ready
        // Only register video players, not image players
        this.visibilityManager.registerPlayer(postId, player);
      }
    }
  }

  /**
   * Aggressively unload videos that are not visible to free RAM
   * Unloads videos even if posts are still in memory
   * Extremely aggressive to prevent 8GB+ RAM usage
   */
  private aggressiveVideoUnload(): void {
    const viewportTop = window.scrollY || window.pageYOffset;
    const viewportBottom = viewportTop + window.innerHeight;
    const unloadDistance = 100;
    const maxLoadedVideos = this.useHDMode ? 2 : 3;
    
    const loadedVideoCount = this.countLoadedVideosInViewport(viewportTop, viewportBottom);
    this.unloadVideosFarFromViewport(viewportTop, viewportBottom, unloadDistance);
    this.unloadExcessVideos(viewportTop, viewportBottom, maxLoadedVideos, loadedVideoCount);
  }

  /**
   * Count loaded videos that are in or near the viewport
   */
  private countLoadedVideosInViewport(viewportTop: number, viewportBottom: number): number {
    let loadedVideoCount = 0;
    const viewportMargin = 200;
    
    for (const [, post] of this.posts.entries()) {
      if (this.isPostNearViewport(post, viewportTop, viewportBottom, viewportMargin)) {
        const player = post.getPlayer();
        // Only count video players (images don't need unloading)
        if (player && 'getIsUnloaded' in player && !player.getIsUnloaded()) {
          loadedVideoCount++;
        }
      }
    }
    
    return loadedVideoCount;
  }

  /**
   * Check if a post is near the viewport
   */
  private isPostNearViewport(
    post: VideoPost | ImagePost,
    viewportTop: number,
    viewportBottom: number,
    margin: number
  ): boolean {
    const container = post.getContainer();
    const rect = container.getBoundingClientRect();
    const elementTop = viewportTop + rect.top;
    const elementBottom = elementTop + rect.height;
    
    return elementBottom > viewportTop - margin && elementTop < viewportBottom + margin;
  }

  /**
   * Unload videos that are far from the viewport
   */
  private unloadVideosFarFromViewport(
    viewportTop: number,
    viewportBottom: number,
    unloadDistance: number
  ): void {
    for (const [, post] of this.posts.entries()) {
      if (this.isPostFarFromViewport(post, viewportTop, viewportBottom, unloadDistance)) {
        this.unloadPostVideo(post);
      }
    }
  }

  /**
   * Check if a post is far from the viewport
   */
  private isPostFarFromViewport(
    post: VideoPost | ImagePost,
    viewportTop: number,
    viewportBottom: number,
    unloadDistance: number
  ): boolean {
    const container = post.getContainer();
    const rect = container.getBoundingClientRect();
    const elementTop = viewportTop + rect.top;
    const elementBottom = elementTop + rect.height;
    
    const isFarAbove = elementBottom < viewportTop - unloadDistance;
    const isFarBelow = elementTop > viewportBottom + unloadDistance;
    
    return isFarAbove || isFarBelow;
  }

  /**
   * Unload excess videos when we exceed the maximum limit
   */
  private unloadExcessVideos(
    viewportTop: number,
    viewportBottom: number,
    maxLoadedVideos: number,
    loadedVideoCount: number
  ): void {
    if (loadedVideoCount <= maxLoadedVideos) {
      return;
    }
    
    for (const [, post] of this.posts.entries()) {
      if (loadedVideoCount <= maxLoadedVideos) {
        break;
      }
      
      if (!this.isPostImmediatelyVisible(post, viewportTop, viewportBottom)) {
        const player = post.getPlayer();
        // Only unload video players (images don't need unloading)
        if (isNativeVideoPlayer(player) && !player.getIsUnloaded()) {
          player.unload();
          loadedVideoCount--;
        }
      }
    }
  }

  /**
   * Check if a post is immediately visible in the viewport
   */
  private isPostImmediatelyVisible(
    post: VideoPost | ImagePost,
    viewportTop: number,
    viewportBottom: number
  ): boolean {
    const container = post.getContainer();
    const rect = container.getBoundingClientRect();
    const elementTop = viewportTop + rect.top;
    const elementBottom = elementTop + rect.height;
    
    return elementBottom > viewportTop && elementTop < viewportBottom;
  }

  /**
   * Unload a post's video if it's loaded
   */
  private unloadPostVideo(post: VideoPost | ImagePost): void {
    const player = post.getPlayer();
    // Only unload video players (images don't need unloading)
    if (isNativeVideoPlayer(player) && !player.getIsUnloaded()) {
      player.unload();
    }
  }

  /**
   * Update scroll velocity for background preloading
   */
  private updateScrollVelocity(currentScrollY: number, timeDelta: number): void {
    if (timeDelta > 0) {
      const scrollDelta = Math.abs(currentScrollY - this.lastScrollTop);
      this.scrollVelocity = scrollDelta / timeDelta; // pixels per ms
    }
    
    this.lastScrollTop = currentScrollY;
    this.lastScrollTime = Date.now();
  }

  /**
   * Handle video unloading during scrolling
   */
  private handleScrollVideoUnloading(timeDelta: number): void {
    const unloadInterval = 500;
    if (timeDelta > unloadInterval) {
      this.aggressiveVideoUnload();
    }
  }

  /**
   * Handle fast scrolling by stopping background preloading
   */
  private handleFastScrolling(): void {
    const fastScrollThreshold = 3;
    if (this.scrollVelocity > fastScrollThreshold && this.backgroundPreloadActive) {
      this.stopBackgroundPreloading();
    }
  }

  /**
   * Cancel preloads for posts that have gone out of view
   */
  private cancelOutOfViewPreloads(): void {
    if (this.activePreloadPosts.size === 0) {
      return;
    }
    
    for (const postId of Array.from(this.activePreloadPosts)) {
      this.cancelPreloadIfOutOfView(postId);
    }
  }

  /**
   * Check if header handling should be skipped
   */
  private shouldSkipHeaderHandling(): boolean {
    const suggestions = document.querySelector('.feed-filters__suggestions') as HTMLElement;
    if (suggestions && suggestions.style.display !== 'none' && suggestions.style.display !== '') {
      return true;
    }

    if (this.shuffleMode > 0) {
      this.ensureHeaderVisibleInRandomMode();
      return true;
    }

    return false;
  }

  /**
   * Ensure header is visible in random discovery mode
   */
  private ensureHeaderVisibleInRandomMode(): void {
    if (!this.headerBar) {
      return;
    }
    
    const currentTransform = this.headerBar.style.transform;
    if (currentTransform && currentTransform !== 'translateY(0)' && currentTransform !== '') {
      this.headerBar.style.transform = 'translateY(0)';
    }
    this.headerBar.style.opacity = '1';
  }

  /**
   * Handle header visibility based on scroll direction
   */
  private handleHeaderVisibility(
    currentScrollY: number,
    lastScrollY: number,
    isHeaderHidden: boolean
  ): { lastScrollY: number; isHeaderHidden: boolean } {
    const scrollDelta = currentScrollY - lastScrollY;
    const minScrollDelta = 5;
    
    if (Math.abs(scrollDelta) <= minScrollDelta) {
      return { lastScrollY: currentScrollY, isHeaderHidden };
    }

    if (scrollDelta > 0 && !isHeaderHidden && currentScrollY > 100) {
      this.hideHeader();
      return { lastScrollY: currentScrollY, isHeaderHidden: true };
    }
    
    if (scrollDelta < 0 && isHeaderHidden) {
      this.showHeader();
      return { lastScrollY: currentScrollY, isHeaderHidden: false };
    }

    return { lastScrollY: currentScrollY, isHeaderHidden };
  }

  /**
   * Hide the header by translating it up
   */
  private hideHeader(): void {
    if (!this.headerBar) {
      return;
    }
    
    const headerHeight = this.headerBar.getBoundingClientRect().height;
    const hideDistance = headerHeight + 30;
    this.headerBar.style.transform = `translateY(-${hideDistance}px)`;
  }

  /**
   * Show the header by translating it to normal position
   */
  private showHeader(): void {
    if (this.headerBar) {
      this.headerBar.style.transform = 'translateY(0)';
    }
  }

  /**
   * Setup scroll handler
   * Handles header hide/show based on scroll direction and tracks scroll velocity
   */
  private setupScrollHandler(): void {
    let lastScrollY = globalThis.scrollY;
    let isHeaderHidden = false;
    
    // Store reference to isHeaderHidden so we can access it from other methods (for debugging/extension)
    const debugThis = this as FeedContainer & FeedContainerDebug;
    debugThis.__isHeaderHidden = () => isHeaderHidden;
    debugThis.__setHeaderHidden = (val: boolean) => { isHeaderHidden = val; };
    debugThis.__showHeader = () => {
      if (this.headerBar) {
        this.headerBar.style.transform = 'translateY(0)';
        isHeaderHidden = false;
      }
    };

    // Initialize scroll tracking
    this.lastScrollTop = globalThis.scrollY || document.documentElement.scrollTop;
    this.lastScrollTime = Date.now();

    const handleScroll = () => {
      const now = Date.now();
      const currentScrollY = globalThis.scrollY || document.documentElement.scrollTop;
      const timeDelta = now - this.lastScrollTime;
      
      this.updateScrollVelocity(currentScrollY, timeDelta);
      this.handleScrollVideoUnloading(timeDelta);
      this.handleFastScrolling();
      this.cancelOutOfViewPreloads();

      if (this.shouldSkipHeaderHandling()) {
        return;
      }

      const headerState = this.handleHeaderVisibility(currentScrollY, lastScrollY, isHeaderHidden);
      lastScrollY = headerState.lastScrollY;
      isHeaderHidden = headerState.isHeaderHidden;
    };

    // Use passive listener for better performance
    globalThis.addEventListener('scroll', handleScroll, { passive: true });

    // Listen for page visibility changes to pause/resume preloading
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // Pause preloading when tab is hidden
        this.stopBackgroundPreloading();
      } else if (this.settings.backgroundPreloadEnabled && this.posts.size > 0) {
        // Resume preloading when tab becomes visible
        this.startBackgroundPreloading();
      }
    });
  }

  /**
   * Lock body scroll (prevent page scrolling)
   */
  private lockBodyScroll(): void {
    const body = document.body;
    // Only lock if not already locked
    if (body.dataset.scrollLock === 'true') {
      return;
    }
    body.dataset.scrollLock = 'true';
    // Preserve layout when scrollbar disappears
    const scrollbarWidth = globalThis.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }
    body.style.overflow = 'hidden';
  }

  /**
   * Unlock body scroll (restore page scrolling)
   */
  private unlockBodyScroll(): void {
    const body = document.body;
    // Only unlock if currently locked
    if (body.dataset.scrollLock !== 'true') {
      return;
    }
    body.style.overflow = '';
    body.style.paddingRight = '';
    delete body.dataset.scrollLock;
  }

  /**
   * Show loading indicator
   */
  private showLoading(): void {
    let loading = this.container.querySelector('.feed-loading') as HTMLElement;
    if (!loading) {
      loading = document.createElement('div');
      loading.className = 'feed-loading';
      loading.textContent = 'Loading videos...';
      this.container.appendChild(loading);
    }
    loading.style.display = 'block';
  }

  /**
   * Hide loading indicator
   */
  private hideLoading(): void {
    const loading = this.container.querySelector('.feed-loading') as HTMLElement;
    if (loading) {
      loading.style.display = 'none';
    }
  }

  /**
   * Show skeleton loaders for better perceived performance
   */
  private showSkeletonLoaders(): void {
    // Check for existing skeleton loaders in the HTML (from initial page load)
    const existingSkeletons = Array.from(this.postsContainer.querySelectorAll('.video-post-skeleton'));
    
    if (existingSkeletons.length > 0) {
      // Reuse existing skeletons from HTML
      this.skeletonLoaders = existingSkeletons as HTMLElement[];
      
      // If we need more skeletons than exist, create additional ones
      const skeletonCount = this.initialLoadLimit;
      const needed = skeletonCount - existingSkeletons.length;
      if (needed > 0) {
        for (let i = 0; i < needed; i++) {
          const skeleton = this.createSkeletonLoader();
          this.postsContainer.appendChild(skeleton);
          this.skeletonLoaders.push(skeleton);
        }
      } else if (needed < 0) {
        // If we have too many, remove the excess
        const excess = existingSkeletons.slice(skeletonCount);
        for (const skeleton of excess) {
          skeleton.remove();
        }
        this.skeletonLoaders = existingSkeletons.slice(0, skeletonCount) as HTMLElement[];
      }
    } else {
      // No existing skeletons, create new ones
      this.hideSkeletonLoaders();
      
      // Create skeleton loaders matching expected initial load count
      const skeletonCount = this.initialLoadLimit;
      this.skeletonLoaders = [];
      
      for (let i = 0; i < skeletonCount; i++) {
        const skeleton = this.createSkeletonLoader();
        this.postsContainer.appendChild(skeleton);
        this.skeletonLoaders.push(skeleton);
      }
    }
  }

  /**
   * Create a single skeleton loader element
   */
  private createSkeletonLoader(): HTMLElement {
    const skeleton = document.createElement('article');
    skeleton.className = 'video-post-wrapper video-post-skeleton';
    
    const card = document.createElement('div');
    card.className = 'video-post';
    
    // Header skeleton
    const header = document.createElement('div');
    header.className = 'video-post__header';
    header.style.padding = '8px 16px';
    header.style.marginBottom = '0';
    
    const chips = document.createElement('div');
    chips.className = 'chips';
    chips.style.display = 'flex';
    chips.style.flexWrap = 'wrap';
    chips.style.gap = '4px';
    chips.style.margin = '0';
    
    // Add 2-3 chip skeletons
    for (let i = 0; i < 3; i++) {
      const chip = document.createElement('div');
      chip.className = 'chip-skeleton';
      chip.style.width = `${60 + Math.random() * 40}px`;
      chip.style.height = '24px';
      chip.style.borderRadius = '12px';
      chips.appendChild(chip);
    }
    header.appendChild(chips);
    card.appendChild(header);
    
    // Player skeleton
    const player = document.createElement('div');
    player.className = 'video-post__player aspect-16-9';
    player.style.position = 'relative';
    player.style.backgroundColor = '#1C1C1E';
    player.style.overflow = 'hidden';
    card.appendChild(player);
    
    // Footer skeleton
    const footer = document.createElement('div');
    footer.className = 'video-post__footer';
    footer.style.padding = '8px 16px';
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '4px';
    
    // Add 4 button skeletons
    for (let i = 0; i < 4; i++) {
      const btn = document.createElement('div');
      btn.className = 'button-skeleton';
      btn.style.width = '44px';
      btn.style.height = '44px';
      btn.style.borderRadius = '8px';
      footer.appendChild(btn);
    }
    card.appendChild(footer);
    
    skeleton.appendChild(card);
    return skeleton;
  }

  /**
   * Hide and remove all skeleton loaders
   */
  private hideSkeletonLoaders(): void {
    for (const skeleton of this.skeletonLoaders) {
      skeleton.remove();
    }
    this.skeletonLoaders = [];
  }

  /**
   * Remove a single skeleton loader (when real post is added)
   */
  private removeSkeletonLoader(): void {
    if (this.skeletonLoaders.length > 0) {
      const skeleton = this.skeletonLoaders.shift();
      skeleton?.remove();
    }
  }

  /**
   * Get current skeleton count
   */
  private getSkeletonCount(): number {
    return this.skeletonLoaders.length;
  }

  /**
   * Load saved filters if not already loaded
   */
  private async loadSavedFiltersIfNeeded(): Promise<void> {
    if (this.savedFiltersLoaded) return;
    this.savedFiltersLoaded = true;
    try {
      const items = await this.api.fetchSavedMarkerFilters();
      this.savedFiltersCache = items.map((f) => ({ id: f.id, name: f.name }));
    } catch (e) {
      console.error('Failed to load saved marker filters', e);
      this.savedFiltersCache = [];
    }
  }

  /**
   * Show error message
   */
  private showError(message: string): void {
    let error = this.container.querySelector('.feed-error') as HTMLElement;
    if (!error) {
      error = document.createElement('div');
      error.className = 'feed-error';
      this.container.appendChild(error);
    }
    error.textContent = message;
    error.style.display = 'block';
  }

  /**
   * Update settings
   */
  updateSettings(newSettings: Partial<FeedSettings>): void {
    this.settings = { ...this.settings, ...newSettings };
    // Recreate visibility manager with new settings
    this.visibilityManager.cleanup();
    this.visibilityManager = new VisibilityManager({
      threshold: this.settings.autoPlayThreshold,
      autoPlay: this.settings.autoPlay,
      maxConcurrent: this.settings.maxConcurrentVideos,
    });

    // Re-observe all posts
    for (const post of this.posts.values()) {
      const postId = post.getPostId();
      // Only observe video posts with VisibilityManager (images use their own IntersectionObserver)
      if (post.hasVideoSource()) {
        this.visibilityManager.observePost(post.getContainer(), postId);
        const player = post.getPlayer();
        // Only register video players with visibility manager
        if (isNativeVideoPlayer(player)) {
          this.visibilityManager.registerPlayer(postId, player);
        }
      }
    }
  }

  /**
   * Get current settings
   */
  getSettings(): FeedSettings {
    return { ...this.settings };
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    // Stop background preloading
    this.stopBackgroundPreloading();
    
    // Clean up visibility manager
    this.visibilityManager.cleanup();
    
    // Clear all posts (which will destroy players and clean up observers)
    this.clearPosts();
    
    
    // Clear skeleton loaders
    this.hideSkeletonLoaders();
    
    // Cancel all pending requests
    this.cancelAllPendingRequests();

    // Clear mobile load timeout
    const debugThis = this as FeedContainer & FeedContainerDebug;
    if (debugThis._mobileLoadTimeout) {
      clearTimeout(debugThis._mobileLoadTimeout);
      debugThis._mobileLoadTimeout = null;
    }
    
    // Clean up all load observers
    this.cleanupLoadObservers();
    
    // Stop all loading videos to free memory
    this.stopLoadingVideos();
    
    // Clean up scroll observer
    if (this.scrollObserver) {
      this.scrollObserver.disconnect();
      this.scrollObserver = undefined;
    }
    if (this.loadMoreTrigger) {
      this.loadMoreTrigger = undefined;
    }
    
    // Clean up placeholder animation
    if (this.placeholderAnimationInterval) {
      clearInterval(this.placeholderAnimationInterval);
      this.placeholderAnimationInterval = undefined;
    }
  }
}

