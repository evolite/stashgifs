/**
 * Feed Container
 * Main application container managing the feed
 */

import { SceneMarker, Scene, FilterOptions, FeedSettings, VideoPostData, ImagePostData, ImageVideoPostData, Image } from './types.js';
import { StashAPI, generateRandomSortSeed } from './StashAPI.js';
import { PluginSettingsManager } from './PluginSettingsManager.js';
import { VideoPost } from './VideoPost.js';
import { ImagePost } from './ImagePost.js';
import { ImageVideoPost } from './ImageVideoPost.js';
import { NativeVideoPlayer } from './NativeVideoPlayer.js';
import { ImagePlayer } from './ImagePlayer.js';
import { VisibilityManager } from './VisibilityManager.js';
import { FavoritesManager } from './FavoritesManager.js';
import { SettingsPage } from './SettingsPage.js';
import { debounce, normalizeMediaUrl, detectDeviceCapabilities, DeviceCapabilities, isStandaloneNavigator, isMobileDevice, detectVideoFromVisualFiles, isMp4File, getImageUrlForDisplay, THEME, THEME_DEFAULTS, normalizeHexColor, toRgba, buildFullUrl, applyThemeColors } from './utils.js';
import { posterPreloader } from './PosterPreloader.js';
import { GQLImage } from './graphql/types.js';
import { SETTINGS_SVG, STASHGIFS_LOGO_SVG } from './icons.js';
import { DiscoveryPanel } from './DiscoveryPanel.js';
import { WhisparrClient } from './WhisparrClient.js';
import { DiscoveryManager } from './DiscoveryManager.js';

const DEFAULT_SETTINGS: FeedSettings = {
  autoPlay: true, // Enable autoplay for markers
  autoPlayThreshold: 0.2, // Lower threshold - start playing when 20% visible instead of 50%
  unloadDistance: 1000,
  cardMaxWidth: 800,
  aspectRatio: 'preserve',
  showControls: 'hover',
  enableFullscreen: true,
  backgroundPreloadEnabled: true,
  backgroundPreloadDelay: 150, // ms, delay between videos
  backgroundPreloadFastScrollDelay: 400, // ms, delay during fast scrolling
  backgroundPreloadScrollVelocityThreshold: 2, // pixels/ms, threshold for fast scroll detection
  enabledFileTypes: ['.jpg', '.png', '.gif', '.mp4', '.m4v'], // Default file types to include
  includeImagesInFeed: true, // Whether to include images in feed
  imagesOnly: false,
  includeShortFormContent: false, // Enable/disable short-form content
  shortFormInHDMode: true, // Include short-form in HD mode
  shortFormInNonHDMode: true, // Include short-form in non-HD mode
  shortFormMaxDuration: 120, // Maximum duration in seconds for short-form content
  shortFormOnly: false, // When true, only load short-form content and skip regular markers
  snapToCards: false, // When true, scroll/swipe snaps to center next/previous card
  reelMode: false, // When true, use full-screen reel layout
  autoHideSearchBar: true,
  themeBackground: THEME_DEFAULTS.backgroundPrimary,
  themePrimary: THEME_DEFAULTS.surface,
  themeSecondary: THEME_DEFAULTS.backgroundSecondary,
  themeAccent: THEME_DEFAULTS.accentPrimary,
  showVerifiedCheckmarks: true,
  showProductionAge: false,
  showStudioChips: true,
  showSceneTitle: false,
  excludedTagNames: [],
  imagesInGalleryOnly: false,
  galleryIds: [],
  seenHistorySize: 500,
  contentLimit: 5000,
  enableDiscoveryPanel: true,
};

/**
 * Debug interface for FeedContainer (for extension/debugging purposes)
 */
interface FeedContainerDebug {
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

/**
 * Union type for all post types
 */
type PostType = VideoPost | ImagePost | ImageVideoPost;

export class FeedContainer {
  private static readonly CONTENT_LOAD_LIMIT: number = 8;
  private static readonly SEEN_IDS_KEY = 'stashgifs-seen-ids';
  private readonly container: HTMLElement;
  private scrollContainer: HTMLElement;
  private readonly api: StashAPI;
  private readonly settingsManager: PluginSettingsManager;
  private visibilityManager: VisibilityManager;
  private favoritesManager: FavoritesManager;
  private discoveryPanel?: DiscoveryPanel;
  private discoveryManager?: DiscoveryManager;
  private posts: Map<string, PostType>;
  private postOrder: string[];
  private images: Image[] = [];
  private settings: FeedSettings;
  private settingsPage?: SettingsPage;
  private settingsContainer?: HTMLElement;
  private ratingSystemConfig: { type?: string; starPrecision?: string } | null | undefined;
  private markers: SceneMarker[] = [];
  private imagesLoadedCount: number = 0; // Track how many images we've loaded
  private markersLoadedCount: number = 0; // Track how many markers we've loaded
  private shortFormLoadedCount: number = 0; // Track how many short-form items we've loaded
  private shortFormUnfilteredOffset: number = 0; // Track offset in UNFILTERED scene list for short-form pagination
  private markerPageSize: number = 0; // Track the page size used for markers (for consistent pagination)
  private imagePageSize: number = 0; // Track the page size used for images (for consistent pagination)
  // Batch poster prefetching aligns with previous commit behavior
  private isLoading: boolean = false;
  private currentFilters?: FilterOptions;
  private readonly selectedTagIds: Map<number, string> = new Map();
  private readonly selectedPerformerIds: Map<number, string> = new Map();
  private readonly selectedStudioIds: Map<number, string> = new Map();
  private readonly debouncedApplyFilters!: () => void;
  private activePillsBar?: HTMLElement;
  private hasMore: boolean = true;
  private seenSkipCount = 0;
  private currentPage: number = 1;
  private appendRetryCount = 0;
  private appendRetryTimeoutId?: ReturnType<typeof setTimeout>;
  private latestLoadId = 0;
  private scrollObserver?: IntersectionObserver;
  private loadMoreTrigger?: HTMLElement;
  private postsContainer!: HTMLElement;
  private headerBar?: HTMLElement;
  private selectedSavedFilter?: { id: string; name: string };
  private maxSimultaneousPreloads: number;
  private preloadedTags: Array<{ id: string; name: string }> = [];
  private preloadedPerformers: Array<{ id: string; name: string; image_path?: string }> = [];
  private isPreloading: boolean = false;
  private backgroundPreloadActive: boolean = false;
  private excludedTagIds: string[] = [];
  private excludedTagNamesNormalized: string[] = [];
  private backgroundPreloadHandle?: number;
  private backgroundPreloadPriorityQueue: string[] = [];
  private readonly activePreloadPosts: Set<string> = new Set();
  private readonly reelNextPreloadIds: Set<string> = new Set();
  private reelPlaybackStarted: boolean = false;
  private lastScrollTop: number = 0;
  private lastScrollTime: number = 0;
  private scrollVelocity: number = 0;
  private scrollRafPending: boolean = false;
  private videoUnloadTimer?: ReturnType<typeof setTimeout>;
  private seenSetCache?: { ids: string[]; set: Set<string> };
  private seenFlushTimer?: ReturnType<typeof setTimeout>;
  private cleanupScrollTimeout?: ReturnType<typeof setTimeout>;
  private scrollHandler?: () => void;
  private scrollEventTarget?: Window | HTMLElement;
  private visibilityChangeHandler?: () => void;
  private suggestionsClickOutsideHandler?: (event: Event) => void;
  private suggestionsTouchOutsideHandler?: (event: Event) => void;
  private currentlyPreloadingCount: number = 0;
  private placeholderAnimationInterval?: ReturnType<typeof setInterval>; // For scrolling placeholder animation
  private savedFiltersCache: Array<{ id: string; name: string }> = [];
  private savedFiltersLoaded: boolean = false;
  private activeSearchAbortController?: AbortController;
  private activeLoadVideosAbortController?: AbortController;
  private nextPagePosterPrefetchAbortController?: AbortController;
  private lastNextPagePosterPrefetchKey?: string;
  private skeletonLoaders: HTMLElement[] = [];
  private useHDMode: boolean = false;
  private globalMuteState: boolean = false; // Global mute state - all videos muted when true
  private readonly loadObservers: Map<string, IntersectionObserver> = new Map(); // Track load observers for cleanup
  private deviceCapabilities: DeviceCapabilities; // Device capabilities for adaptive quality
  private updatePlaceholderVisibilityRef?: () => void; // Reference to updatePlaceholderVisibility function
  // Card snapping state
  private cardSnapWheelHandler?: (e: WheelEvent) => void;
  private cardSnapTouchStartHandler?: (e: TouchEvent) => void;
  private cardSnapTouchMoveHandler?: (e: TouchEvent) => void;
  private cardSnapTouchEndHandler?: (e: TouchEvent) => void;
  private cardSnapEventTarget?: Window | HTMLElement;
  private cardSnapScrollTarget?: Window | HTMLElement;
  private touchStartY: number = 0;
  private touchStartTime: number = 0;
  private isSnapping: boolean = false; // Prevent multiple snaps in progress
  private snapThrottleTimeout?: ReturnType<typeof setTimeout>;
  private cardSnapScrollHandler?: () => void;
  private cardSnapScrollTimeout?: ReturnType<typeof setTimeout>;
  private mobileAutoplayUnlockHandler?: (event: Event) => void;
  private autoplayUnlockHandler?: (event: Event) => void;
  private readonly mobileAutoplayUnlockEvents: ReadonlyArray<string> = [
    'touchstart',
    'touchend',
    'click',
    'scroll',
    'touchmove',
  ];

  constructor(container: HTMLElement, api?: StashAPI, settings?: Partial<FeedSettings>, settingsManager?: PluginSettingsManager) {
    this.container = container;
    this.api = api || new StashAPI();
    this.settingsManager = settingsManager || new PluginSettingsManager(this.api);
    // Merge settings: defaults first, then passed settings (which may include loaded settings from index.ts)
    // If no settings passed, load from localStorage
    const loadedSettings = settings && Object.keys(settings).length > 0 ? settings : this.loadSettingsFromStorage();
    this.settings = { ...DEFAULT_SETTINGS, ...loadedSettings };
    this.api.maxContentLimit = this.settings.contentLimit ?? 5000;
    // Initialize properties that will be set in methods
    this.scrollContainer = null!; // Will be set in initializeContainers
    this.visibilityManager = null!; // Will be set in initializeManagers
    this.favoritesManager = null!; // Will be set in initializeManagers
    this.posts = new Map();
    this.postOrder = [];
    this.maxSimultaneousPreloads = 0;

    this.deviceCapabilities = null!; // Will be set in initializeDeviceConfiguration

    this.initializeDeviceConfiguration();
    this.initializeContainers();
    this.applyThemeSettings(this.settings);
    this.loadUserPreferences();
    
    // Create header bar with unified search
    this.createHeaderBar();
    this.debouncedApplyFilters = debounce(() => {
      this.applyFilters().catch((e) => console.error('Apply filters failed', e));
    }, 300);
    
    this.initializePostsContainer();
    this.applyReelModeLayout();
    this.initializeManagers();

    // Setup scroll handler
    this.setupScrollHandler();
    
    // Setup card snapping if enabled
    this.setupCardSnapping();
    
    // Setup infinite scroll
    this.setupInfiniteScroll();
    
    // Unlock autoplay on mobile after first user interaction
    this.unlockMobileAutoplay();
    this.setupAutoplayUnlockHandlers();

    // Defer suggestion preload until after initial videos load to avoid competing for bandwidth
    // Will be triggered lazily when user opens filter dropdown or after initial load completes
  }

  /**
   * Initialize device detection and configuration
   */
  private initializeDeviceConfiguration(): void {
    this.deviceCapabilities = detectDeviceCapabilities();

    if (this.deviceCapabilities.availableRAM >= 4096) {
      this.maxSimultaneousPreloads = 3;
      this.settings.backgroundPreloadDelay = 60;
      this.settings.backgroundPreloadFastScrollDelay = 150;
    } else if (this.deviceCapabilities.availableRAM >= 3072) {
      this.maxSimultaneousPreloads = 2;
      this.settings.backgroundPreloadDelay = 80;
      this.settings.backgroundPreloadFastScrollDelay = 200;
    } else {
      this.maxSimultaneousPreloads = 1;
      this.settings.backgroundPreloadDelay = 120;
      this.settings.backgroundPreloadFastScrollDelay = 300;
    }

    this.posts = new Map();
    this.postOrder = [];
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

    const hasEarlyTheme = document.documentElement.dataset.stashgifsThemeReady === 'true';
    this.container.style.backgroundColor = hasEarlyTheme
      ? 'var(--color-bg, #1F2A33)'
      : THEME.colors.backgroundPrimary;
    this.container.style.color = hasEarlyTheme
      ? 'var(--color-text-primary, #E6EEF4)'
      : THEME.colors.textPrimary;
    this.container.style.fontFamily = THEME.typography.fontFamily;
    this.container.style.lineHeight = THEME.typography.lineHeight;
    this.scrollContainer.style.backgroundColor = hasEarlyTheme
      ? 'var(--color-bg, #1F2A33)'
      : THEME.colors.backgroundPrimary;
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

  private applyThemeSettings(settings: FeedSettings): void {
    const background = normalizeHexColor(settings.themeBackground, THEME.colors.backgroundPrimary);
    const primary = normalizeHexColor(settings.themePrimary, THEME.colors.surface);
    const secondary = normalizeHexColor(settings.themeSecondary, THEME.colors.backgroundSecondary);
    const accent = normalizeHexColor(settings.themeAccent, THEME.colors.accentPrimary);

    THEME.colors.backgroundPrimary = background;
    THEME.colors.surface = primary;
    THEME.colors.backgroundSecondary = secondary;
    THEME.colors.accentPrimary = accent;
    THEME.colors.overlay = toRgba(background, 0.96);
    THEME.colors.overlayMuted = toRgba(secondary, 0.96);

    applyThemeColors({ background, primary, secondary, overlay: THEME.colors.overlay, accent });

    const accentGlow = toRgba(accent, 0.3);
    const backgroundGradient = `linear-gradient(180deg, ${background} 0%, ${background} 70%, ${accentGlow} 100%)`;

    if (this.container) {
      this.container.style.backgroundColor = THEME.colors.backgroundPrimary;
      this.container.style.backgroundImage = backgroundGradient;
      this.container.style.backgroundAttachment = 'fixed';
      this.container.style.backgroundRepeat = 'no-repeat';
      this.container.style.backgroundSize = '100% 100%';
      this.container.style.color = THEME.colors.textPrimary;
    }

    if (this.scrollContainer) {
      this.scrollContainer.style.backgroundColor = 'transparent';
      this.scrollContainer.style.backgroundImage = 'none';
    }

    document.documentElement.dataset.stashgifsThemeReady = 'true';
  }

  private isReelModeEnabled(): boolean {
    return this.settings.reelMode === true;
  }

  private getScrollEventTarget(): Window | HTMLElement {
    return this.isReelModeEnabled() && this.scrollContainer
      ? this.scrollContainer
      : (globalThis as unknown as Window);
  }

  private getViewportTop(): number {
    if (this.isReelModeEnabled() && this.scrollContainer) {
      return this.scrollContainer.scrollTop;
    }
    return globalThis.scrollY || document.documentElement.scrollTop || 0;
  }

  private getViewportHeight(): number {
    if (this.isReelModeEnabled() && this.scrollContainer) {
      return this.scrollContainer.clientHeight;
    }
    return globalThis.innerHeight;
  }

  private getViewportRect(): { top: number; left: number; width: number; height: number } {
    if (this.isReelModeEnabled() && this.scrollContainer) {
      const rect = this.scrollContainer.getBoundingClientRect();
      return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
    }
    return { top: 0, left: 0, width: globalThis.innerWidth, height: globalThis.innerHeight };
  }

  private isScrollContainerActive(): boolean {
    if (!this.scrollContainer) {
      return false;
    }
    return this.scrollContainer.scrollHeight > this.scrollContainer.clientHeight;
  }

  private getObserverRoot(): Element | null {
    if (this.scrollContainer && (this.isReelModeEnabled() || this.isScrollContainerActive())) {
      return this.scrollContainer;
    }
    return null;
  }

  private parseRootMarginToPx(rootMargin: string): number {
    const match = /-?\d+/.exec(rootMargin);
    if (!match) {
      return 0;
    }
    const value = Number(match[0]);
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.max(0, value);
  }

  private isElementWithinLazyLoadRange(element: HTMLElement, marginPx: number): boolean {
    const rect = element.getBoundingClientRect();
    const viewport = this.getViewportRect();
    const elementTop = rect.top - viewport.top;
    const elementBottom = rect.bottom - viewport.top;
    return elementBottom >= -marginPx && elementTop <= viewport.height + marginPx;
  }

  private getElementTop(rect: DOMRect): number {
    if (this.isReelModeEnabled() && this.scrollContainer) {
      const containerRect = this.scrollContainer.getBoundingClientRect();
      return this.scrollContainer.scrollTop + rect.top - containerRect.top;
    }
    return this.getViewportTop() + rect.top;
  }

  private scrollToPosition(top: number, behavior: ScrollBehavior = 'auto'): void {
    if (this.isReelModeEnabled() && this.scrollContainer) {
      this.scrollContainer.scrollTo({ top, behavior });
      return;
    }
    (globalThis as unknown as Window).scrollTo({ top, behavior });
  }

  private scrollToTop(): void {
    this.scrollToPosition(0, 'auto');
  }

  private applyReelModeLayout(): void {
    const isReelMode = this.isReelModeEnabled();
    this.applyReelRootStyles(isReelMode);
    this.applyReelContainerStyles(isReelMode);
    this.applyReelHeaderStyles(isReelMode);
    this.applyReelPostStyles(isReelMode);
    if (this.visibilityManager) {
      this.visibilityManager.setObserverRoot(isReelMode ? this.scrollContainer : null);
    }
    this.setupScrollHandler();
    this.setupCardSnapping();
    this.resetScrollObserver();
    this.refreshAutoplayAfterLayout();
    if (this.settings.backgroundPreloadEnabled) {
      this.startBackgroundPreloading();
    }
    if (isReelMode) {
      this.warmStartPreloads();
      this.ensureReelInitialCardLoaded();
    }
    this.ensureVisiblePostsLoaded();
  }

  private refreshAutoplayAfterLayout(): void {
    if (!this.visibilityManager) {
      return;
    }

    requestAnimationFrame(() => {
      this.visibilityManager.refreshVisibilityAndAutoplay();
    });
  }

  private applyReelRootStyles(isReelMode: boolean): void {
    const root = document.documentElement;
    const body = document.body;
    root.style.scrollSnapType = '';
    if (isReelMode) {
      root.dataset.reelMode = 'true';
      root.style.overflow = 'hidden';
      if (body.dataset.scrollLock !== 'true') {
        body.style.overflow = 'hidden';
      }
      return;
    }
    delete root.dataset.reelMode;
    root.style.overflow = '';
    if (body.dataset.scrollLock !== 'true') {
      body.style.overflow = '';
    }
  }

  private applyReelContainerStyles(isReelMode: boolean): void {
    this.applyReelContainerLayout(isReelMode);
    this.applyReelScrollContainerLayout(isReelMode);
    this.applyReelPostsLayout(isReelMode);
  }

  private applyReelContainerLayout(isReelMode: boolean): void {
    if (!this.container) {
      return;
    }

    this.container.style.width = isReelMode ? '100vw' : '';
    this.container.style.maxWidth = isReelMode ? '100vw' : '';
    this.container.style.margin = isReelMode ? '0' : '';
    this.container.style.marginLeft = isReelMode ? 'calc(50% - 50vw)' : '';
    this.container.style.marginRight = isReelMode ? 'calc(50% - 50vw)' : '';
    this.container.style.padding = isReelMode ? '0' : '';
    this.container.style.left = '';
    this.container.style.right = '';
    this.container.style.transform = '';
  }

  private applyReelScrollContainerLayout(isReelMode: boolean): void {
    if (!this.scrollContainer) {
      return;
    }

    const reelHeight = CSS.supports('height', '100svh') ? '100svh' : '100vh';
    this.scrollContainer.style.width = isReelMode ? '100vw' : '';
    this.scrollContainer.style.maxWidth = isReelMode ? '100vw' : '';
    this.scrollContainer.style.margin = isReelMode ? '0' : '';
    this.scrollContainer.style.marginLeft = isReelMode ? 'calc(50% - 50vw)' : '';
    this.scrollContainer.style.marginRight = isReelMode ? 'calc(50% - 50vw)' : '';
    this.scrollContainer.style.padding = isReelMode ? '0' : '';
    this.scrollContainer.style.height = isReelMode ? reelHeight : '';
    this.scrollContainer.style.minHeight = isReelMode ? reelHeight : '';
    this.scrollContainer.style.overflowY = isReelMode ? 'auto' : '';
    this.scrollContainer.style.overflowX = isReelMode ? 'hidden' : '';
    this.scrollContainer.style.overscrollBehavior = isReelMode ? 'contain' : '';
    this.scrollContainer.style.scrollSnapType = isReelMode ? 'y mandatory' : '';
  }

  private applyReelPostsLayout(isReelMode: boolean): void {
    if (!this.postsContainer) {
      return;
    }

    this.postsContainer.style.display = isReelMode ? 'flex' : '';
    this.postsContainer.style.flexDirection = isReelMode ? 'column' : '';
    this.postsContainer.style.gap = isReelMode ? '0' : '';
    this.postsContainer.style.padding = isReelMode ? '0' : '';
    this.postsContainer.style.margin = isReelMode ? '0' : '';

    const wrappers = this.postsContainer.querySelectorAll<HTMLElement>('.video-post-wrapper');
    for (const wrapper of wrappers) {
      wrapper.style.width = isReelMode ? '100%' : '';
      wrapper.style.maxWidth = isReelMode ? '100%' : '';
      wrapper.style.margin = isReelMode ? '0' : '';
    }
  }

  private applyReelHeaderStyles(isReelMode: boolean): void {
    const header = this.headerBar || this.scrollContainer?.querySelector<HTMLElement>('.feed-header-bar');
    if (!header) {
      return;
    }

    const headerInner = header.querySelector<HTMLElement>('.feed-header-inner');
    const inputWrapper = header.querySelector<HTMLElement>('.feed-input-wrapper');
    const queryInput = header.querySelector<HTMLInputElement>('.feed-filters__input');
    const brandContainer = header.querySelector<HTMLElement>('.feed-brand-container');
    const settingsButton = header.querySelector<HTMLElement>('[aria-label="Open settings"]');

    if (isReelMode) {
      this.setReelHeaderActive(header, headerInner, inputWrapper, queryInput, brandContainer, settingsButton);
    } else {
      this.setReelHeaderDefault(header, headerInner, inputWrapper, queryInput, brandContainer, settingsButton);
    }
  }

  private setReelHeaderActive(
    header: HTMLElement,
    headerInner: HTMLElement | null,
    inputWrapper: HTMLElement | null,
    queryInput: HTMLInputElement | null,
    brandContainer: HTMLElement | null,
    settingsButton: HTMLElement | null
  ): void {
    header.style.position = 'fixed';
    header.style.left = '0';
    header.style.right = '0';
    header.style.width = '100%';
    header.style.maxWidth = '100%';
    header.style.zIndex = '900';
    header.style.background = 'transparent';
    header.style.backdropFilter = '';
    header.style.borderRadius = '0';
    header.style.padding = '8px 16px';
    header.style.display = 'flex';
    header.style.justifyContent = 'center';
    header.style.alignItems = 'center';

    if (headerInner) {
      headerInner.style.maxWidth = `${this.settings.cardMaxWidth}px`;
      headerInner.style.width = '100%';
      headerInner.style.margin = '0 auto';
    }
    if (inputWrapper) { inputWrapper.style.background = 'transparent'; }
    if (queryInput) {
      queryInput.style.background = 'rgba(0, 0, 0, 0.35)';
      queryInput.style.border = '1px solid rgba(255, 255, 255, 0.2)';
      queryInput.style.color = THEME.colors.textPrimary;
      queryInput.style.backdropFilter = 'blur(8px)';
    }
    if (brandContainer) {
      brandContainer.style.background = 'rgba(0, 0, 0, 0.35)';
      brandContainer.style.border = '1px solid rgba(255, 255, 255, 0.2)';
    }
    if (settingsButton) {
      settingsButton.style.background = 'rgba(0, 0, 0, 0.35)';
      settingsButton.style.border = '1px solid rgba(255, 255, 255, 0.2)';
      settingsButton.style.color = THEME.colors.textPrimary;
    }
  }

  private setReelHeaderDefault(
    header: HTMLElement,
    headerInner: HTMLElement | null,
    inputWrapper: HTMLElement | null,
    queryInput: HTMLInputElement | null,
    brandContainer: HTMLElement | null,
    settingsButton: HTMLElement | null
  ): void {
    header.style.position = '';
    header.style.left = '';
    header.style.right = '';
    header.style.width = '';
    header.style.maxWidth = `${this.settings.cardMaxWidth + 24}px`;
    header.style.zIndex = '';
    header.style.background = '';
    header.style.backdropFilter = '';
    header.style.borderRadius = '';
    header.style.padding = '';
    header.style.display = '';
    header.style.justifyContent = '';
    header.style.alignItems = '';

    if (headerInner) {
      headerInner.style.maxWidth = `${this.settings.cardMaxWidth}px`;
      headerInner.style.width = '';
      headerInner.style.margin = '';
    }
    if (inputWrapper) { inputWrapper.style.background = ''; }
    if (queryInput) {
      queryInput.style.background = '';
      queryInput.style.border = '';
      queryInput.style.color = '';
      queryInput.style.backdropFilter = '';
    }
    if (brandContainer) {
      brandContainer.style.background = '';
      brandContainer.style.border = `1px solid ${THEME.colors.border}`;
    }
    if (settingsButton) {
      settingsButton.style.background = THEME.colors.backgroundSecondary;
      settingsButton.style.border = `1px solid ${THEME.colors.border}`;
      settingsButton.style.color = THEME.colors.iconInactive;
    }
  }

  private applyReelPostStyles(isReelMode: boolean): void {
    for (const post of this.posts.values()) {
      post.setReelMode?.(isReelMode);
    }
  }

  /**
   * Save settings to localStorage
   */
  private handleSettingsChange(newSettings: Partial<FeedSettings>): void {
    const previousShowVerified = this.settings.showVerifiedCheckmarks;
    const previousShowProductionAge = this.settings.showProductionAge;
    const previousShowStudioChips = this.settings.showStudioChips;
    const previousShowSceneTitle = this.settings.showSceneTitle;
    const previousExcludedTags = this.normalizeExcludedTagNames(this.settings.excludedTagNames ?? []);
    const previousOrientation = this.normalizeOrientationFilter(this.settings.orientationFilter ?? []);

    const updatedSettings = { ...this.settings, ...newSettings };
    this.settings = updatedSettings;
    this.api.maxContentLimit = updatedSettings.contentLimit ?? 5000;
    this.saveSettingsToStorage(updatedSettings);
    this.applyThemeSettings(updatedSettings);

    if (newSettings.hdMode !== undefined) {
      const newHDMode = newSettings.hdMode;
      this.useHDMode = newHDMode;
      this.settingsManager.save({ hdMode: newHDMode });
      this.visibilityManager.setHDMode(newHDMode);
      this.visibilityManager.setAutoPlay(!newHDMode || (updatedSettings.reelMode ?? false));
    }

    const reelModeChanged = newSettings.reelMode !== undefined;
    this.handleLayoutSettingsChange(newSettings, reelModeChanged);
    this.handlePostDisplaySettingsChange(newSettings, updatedSettings, previousShowVerified, previousShowProductionAge, previousShowStudioChips, previousShowSceneTitle);

    const excludedTagsChanged = !this.areExcludedTagNamesEqual(
      previousExcludedTags,
      this.normalizeExcludedTagNames(updatedSettings.excludedTagNames ?? [])
    );
    const orientationFilterChanged = newSettings.orientationFilter !== undefined
      && !this.areOrientationFiltersEqual(
        previousOrientation,
        this.normalizeOrientationFilter(updatedSettings.orientationFilter ?? [])
      );

    if (newSettings.autoHideSearchBar !== undefined && newSettings.autoHideSearchBar === false) {
      this.showHeader();
    }

    if (newSettings.enableDiscoveryPanel !== undefined) {
      if (updatedSettings.enableDiscoveryPanel === true) {
        this.mountDiscoveryPanel();
      } else {
        this.unmountDiscoveryPanel();
      }
    }
    if (newSettings.discoveryPanelSize !== undefined && this.discoveryPanel) {
      this.discoveryPanel.setSize(updatedSettings.discoveryPanelSize ?? 260);
    }
    if (newSettings.discoverySceneOrder !== undefined && this.discoveryManager) {
      this.discoveryManager.setSceneOrder(updatedSettings.discoverySceneOrder ?? 'latest');
    }
    if (
      this.discoveryPanel
      && (newSettings.whisparrBaseUrl !== undefined
        || newSettings.whisparrApiKey !== undefined
        || newSettings.whisparrRootFolderPath !== undefined
        || newSettings.whisparrQualityProfileId !== undefined)
    ) {
      this.discoveryPanel.setWhisparrClient(WhisparrClient.fromSettings(updatedSettings));
    }

    if (this.shouldReloadFeed(newSettings, excludedTagsChanged, orientationFilterChanged, reelModeChanged)) {
      this.loadVideos(this.currentFilters, false, undefined, true).catch((e) => {
        console.error('Failed to reload feed after settings change', e);
      });
    }
  }

  private mountDiscoveryPanel(): void {
    if (this.discoveryPanel || isMobileDevice()) return;
    this.discoveryPanel = new DiscoveryPanel(
      this.container,
      this.settings.discoveryPanelSize ?? 260,
      WhisparrClient.fromSettings(this.settings),
    );
    this.discoveryManager = new DiscoveryManager(this.api, this.discoveryPanel, this.settings.discoverySceneOrder ?? 'latest');
  }

  private unmountDiscoveryPanel(): void {
    if (!this.discoveryPanel) return;
    this.discoveryManager?.destroy();
    this.discoveryPanel.destroy();
    this.discoveryManager = undefined;
    this.discoveryPanel = undefined;
  }

  private handleLayoutSettingsChange(newSettings: Partial<FeedSettings>, reelModeChanged: boolean): void {
    if (newSettings.snapToCards !== undefined || reelModeChanged) {
      this.setupCardSnapping();
    }
    if (reelModeChanged) {
      this.applyReelModeLayout();
    }
    if (!reelModeChanged && newSettings.snapToCards !== undefined) {
      this.refreshAutoplayAfterLayout();
    }
  }

  private handlePostDisplaySettingsChange(
    newSettings: Partial<FeedSettings>,
    updatedSettings: FeedSettings,
    previousShowVerified: boolean | undefined,
    previousShowProductionAge: boolean | undefined,
    previousShowStudioChips: boolean | undefined,
    previousShowSceneTitle: boolean | undefined
  ): void {
    if (newSettings.showVerifiedCheckmarks !== undefined && updatedSettings.showVerifiedCheckmarks !== previousShowVerified) {
      for (const post of this.posts.values()) {
        post.setShowVerifiedCheckmarks?.(updatedSettings.showVerifiedCheckmarks !== false);
      }
    }
    if (newSettings.showProductionAge !== undefined && updatedSettings.showProductionAge !== previousShowProductionAge) {
      for (const post of this.posts.values()) {
        post.setShowProductionAge?.(updatedSettings.showProductionAge === true);
      }
    }
    if (newSettings.showStudioChips !== undefined) {
      const show = updatedSettings.showStudioChips !== false;
      for (const post of this.posts.values()) {
        post.setShowStudioChips?.(show);
      }
    }
    if (newSettings.showSceneTitle !== undefined && updatedSettings.showSceneTitle !== previousShowSceneTitle) {
      const show = updatedSettings.showSceneTitle === true;
      for (const post of this.posts.values()) {
        post.setShowSceneTitle?.(show);
      }
    }
  }

  private shouldReloadFeed(
    newSettings: Partial<FeedSettings>,
    excludedTagsChanged: boolean,
    orientationFilterChanged: boolean,
    reelModeChanged: boolean
  ): boolean {
    return !!(
      newSettings.hdMode !== undefined ||
      newSettings.includeImagesInFeed !== undefined ||
      newSettings.enabledFileTypes ||
      newSettings.imagesOnly !== undefined ||
      newSettings.shortFormInHDMode !== undefined ||
      newSettings.shortFormInNonHDMode !== undefined ||
      newSettings.shortFormMaxDuration !== undefined ||
      newSettings.shortFormOnly !== undefined ||
      newSettings.imagesInGalleryOnly !== undefined ||
      newSettings.galleryIds !== undefined ||
      newSettings.contentLimit !== undefined ||
      orientationFilterChanged ||
      reelModeChanged ||
      excludedTagsChanged
    );
  }

  private saveSettingsToStorage(settings: FeedSettings): void {
    const completeSettings: FeedSettings = { ...DEFAULT_SETTINGS, ...settings };
    this.settingsManager.save({ settings: completeSettings });
  }

  /**
   * Load user preferences from localStorage
   */
  private loadUserPreferences(): void {
    this.useHDMode = this.loadHDModePreference();
    this.globalMuteState = this.loadGlobalMuteState();
  }

  private getExcludedTagNames(): string[] {
    return (this.settings.excludedTagNames ?? [])
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
  }

  private normalizeExcludedTagNames(names: string[]): string[] {
    return names.map((name) => name.toLowerCase());
  }

  private normalizeOrientationFilter(values: Array<'landscape' | 'portrait' | 'square'>): string[] {
    return values.map((value) => value.toLowerCase());
  }

  private areExcludedTagNamesEqual(a: string[], b: string[]): boolean {
    return this.areStringListsEqual(a, b);
  }

  private areOrientationFiltersEqual(a: string[], b: string[]): boolean {
    return this.areStringListsEqual(a, b);
  }

  private areStringListsEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) {
      return false;
    }

    const sortedA = [...a].sort((left, right) => left.localeCompare(right));
    const sortedB = [...b].sort((left, right) => left.localeCompare(right));

    return sortedA.every((value, index) => value === sortedB[index]);
  }

  private async updateExcludedTagIds(): Promise<void> {
    const trimmedNames = this.getExcludedTagNames();
    const normalizedNames = this.normalizeExcludedTagNames(trimmedNames);

    if (this.areExcludedTagNamesEqual(normalizedNames, this.excludedTagNamesNormalized)) {
      return;
    }

    this.excludedTagNamesNormalized = normalizedNames;

    if (!this.api || normalizedNames.length === 0) {
      this.excludedTagIds = [];
      return;
    }

    const uniqueNameMap = new Map<string, string>();
    for (const name of trimmedNames) {
      const key = name.toLowerCase();
      if (!uniqueNameMap.has(key)) {
        uniqueNameMap.set(key, name);
      }
    }

    const resolvedTags = await Promise.all(
      Array.from(uniqueNameMap.values()).map(async (name) => {
        try {
          return await this.api.findTagByName(name);
        } catch (error) {
          console.warn('Failed to resolve excluded tag', { name, error });
          return null;
        }
      })
    );

    this.excludedTagIds = resolvedTags
      .filter((tag): tag is { id: string; name: string } => tag !== null)
      .map((tag) => tag.id);
  }

  private applyExcludedTagsToFilters(filters: FilterOptions): void {
    if (this.excludedTagIds.length > 0) {
      filters.excludedTagIds = [...this.excludedTagIds];
      return;
    }

    delete filters.excludedTagIds;
  }

  private applyOrientationFilterToFilters(filters: FilterOptions): void {
    if (this.settings.orientationFilter && this.settings.orientationFilter.length > 0) {
      filters.orientationFilter = [...this.settings.orientationFilter];
      return;
    }

    delete filters.orientationFilter;
  }


  private shouldExcludeTags(tags?: Array<{ id: string; name: string }>): boolean {
    if (!tags || tags.length === 0) {
      return false;
    }

    if (this.excludedTagIds.length > 0) {
      const excludedIds = new Set(this.excludedTagIds);
      if (tags.some((tag) => excludedIds.has(tag.id))) {
        return true;
      }
    }

    if (this.excludedTagNamesNormalized.length > 0) {
      const excludedNames = new Set(this.excludedTagNamesNormalized);
      if (tags.some((tag) => excludedNames.has(tag.name.toLowerCase()))) {
        return true;
      }
    }

    return false;
  }

  private shouldExcludeMarker(marker: SceneMarker): boolean {
    if (marker.primary_tag && this.shouldExcludeTags([marker.primary_tag])) {
      return true;
    }

    if (this.shouldExcludeTags(marker.tags)) {
      return true;
    }

    return this.shouldExcludeTags(marker.scene?.tags);
  }

  private filterMarkersByExcludedTags(markers: SceneMarker[]): SceneMarker[] {
    if (this.excludedTagIds.length === 0 && this.excludedTagNamesNormalized.length === 0) {
      return markers;
    }

    return markers.filter((marker) => !this.shouldExcludeMarker(marker));
  }

  private filterImagesByExcludedTags(images: Image[]): Image[] {
    if (this.excludedTagIds.length === 0 && this.excludedTagNamesNormalized.length === 0) {
      return images;
    }

    return images.filter((image) => !this.shouldExcludeTags(image.tags));
  }

  private getSeenCache(): { ids: string[]; set: Set<string> } {
    if (this.seenSetCache) return this.seenSetCache;
    try {
      const raw = localStorage.getItem(FeedContainer.SEEN_IDS_KEY);
      const ids: string[] = raw ? JSON.parse(raw) as string[] : [];
      this.seenSetCache = { ids, set: new Set(ids) };
    } catch {
      this.seenSetCache = { ids: [], set: new Set() };
    }
    return this.seenSetCache;
  }

  private getSeenSet(): Set<string> {
    const maxSeen = this.settings.seenHistorySize ?? 500;
    if (maxSeen === 0) return new Set();
    return this.getSeenCache().set;
  }

  private flushSeenSet(): void {
    if (!this.seenSetCache) return;
    try {
      localStorage.setItem(FeedContainer.SEEN_IDS_KEY, JSON.stringify(this.seenSetCache.ids));
    } catch {
      // ignore localStorage errors
    }
  }

  private markItemSeen(id: string): void {
    const maxSeen = this.settings.seenHistorySize ?? 500;
    if (maxSeen === 0) return;
    const cache = this.getSeenCache();
    if (cache.set.has(id)) {
      // Move to end (most recent)
      const idx = cache.ids.indexOf(id);
      if (idx !== -1) cache.ids.splice(idx, 1);
    } else {
      cache.set.add(id);
    }
    cache.ids.push(id);
    if (cache.ids.length > maxSeen) {
      const removed = cache.ids.splice(0, cache.ids.length - maxSeen);
      for (const r of removed) cache.set.delete(r);
    }
    // Debounce the write — flush once after the render batch settles
    if (this.seenFlushTimer) clearTimeout(this.seenFlushTimer);
    this.seenFlushTimer = setTimeout(() => {
      this.seenFlushTimer = undefined;
      this.flushSeenSet();
    }, 500);
  }

  private deferAutoAdvance(retries = 5): void {
    if (retries <= 0) return;
    requestAnimationFrame(() => {
      if (this.isLoading) {
        this.deferAutoAdvance(retries - 1);
      } else if (this.hasMore) {
        void this.loadVideos(undefined, true);
      }
    });
  }

  private filterSeenContent(
    content: Array<{ type: 'marker' | 'image'; data: SceneMarker | Image; date?: string }>,
    append: boolean
  ): Array<{ type: 'marker' | 'image'; data: SceneMarker | Image; date?: string }> {
    const maxSeen = this.settings.seenHistorySize ?? 500;
    if (maxSeen === 0) return content;
    const seen = this.getSeenSet();
    if (seen.size === 0) return content;
    const unseen = content.filter(item => !seen.has((item.data as { id: string }).id));
    // Scroll: strict — never show seen content
    // Initial load: fall back to showing all if pool exhausted
    return (!append && unseen.length === 0) ? content : unseen;
  }

  /**
   * Load HD mode preference from localStorage
   */
  private loadHDModePreference(): boolean {
    // Read from FeedSettings first (new path), fall back to legacy hdMode field
    if (this.settings.hdMode !== undefined) {
      return this.settings.hdMode;
    }
    return this.settingsManager.data.hdMode;
  }



  private loadGlobalMuteState(): boolean {
    return this.settingsManager.data.globalMuteState;
  }

  /**
   * Set global mute state and apply to all videos
   */
  private setGlobalMuteState(isMuted: boolean): void {
    this.globalMuteState = isMuted;
    this.settingsManager.save({ globalMuteState: isMuted });
    
    // Apply to all players
    this.applyGlobalMuteState();
    
    // Update AudioManager
    if (this.visibilityManager) {
      this.visibilityManager.getAudioManager().setGlobalMuteState(isMuted);
      this.updateAllMuteButtons();
    }

    // AudioManager will automatically handle audio focus when global mute state changes
  }

  /**
   * Apply mute state to a video post
   */
  private applyMuteStateToPost(post: VideoPost | ImageVideoPost): void {
    const player = post.getPlayer();
    if (player) {
      // Apply mute state immediately, even if video isn't playing
      // This ensures the mute state is correct when user toggles it
      player.setMuted(this.globalMuteState);
    }
    // Update overlay mute button appearance
    post.updateMuteOverlayButton();
  }

  /**
   * Apply global mute state to all existing video players
   */
  private applyGlobalMuteState(): void {
    for (const post of this.posts.values()) {
      if (post instanceof VideoPost || post instanceof ImageVideoPost) {
        this.applyMuteStateToPost(post);
      }
      // ImagePost videos are always muted (no audio playback), no need to handle here
    }
    
    // Also update AudioManager to ensure consistency
    this.visibilityManager?.getAudioManager().setGlobalMuteState(this.globalMuteState);
  }

  /**
   * Update all mute buttons to reflect current global mute state
   */
  private updateAllMuteButtons(): void {
    for (const post of this.posts.values()) {
      if (post instanceof VideoPost || post instanceof ImageVideoPost) {
        post.updateMuteOverlayButton();
      }
      // ImagePost videos are always muted (no audio playback), no mute button to update
    }
  }

  /**
   * Get current global mute state
   */
  getGlobalMuteState(): boolean {
    return this.globalMuteState;
  }

  /**
   * Initialize visibility and favorites managers
   */
  private initializeManagers(): void {
    // Initialize visibility manager
    // Enable autoplay for non-HD mode (viewport-based), disable for HD mode (hover-based only)
    this.visibilityManager = new VisibilityManager({
      threshold: this.settings.autoPlayThreshold,
      autoPlay: !this.useHDMode || this.settings.reelMode, // Enable autoplay in non-HD mode or reel mode
      debug: this.shouldEnableVisibilityDebug(),
      onHoverLoadRequest: (postId: string) => this.triggerVideoLoadOnHover(postId),
      onPlaybackStarted: (postId: string) => this.handleReelPlaybackStarted(postId),
      onPrimaryPostChanged: (postId: string) => {
        if (!this.discoveryManager) return;
        this.discoveryManager.onPrimaryPostChanged(postId, this.getPerformersForPost(postId));
      },
      isReelMode: this.settings.reelMode, // Pass reel mode state
      root: this.settings.reelMode ? this.scrollContainer : null,
    });

    // Set HD mode state for more aggressive unloading
    this.visibilityManager.setHDMode(this.useHDMode);
    
    // Initialize AudioManager with the loaded global mute state
    this.visibilityManager.getAudioManager().setGlobalMuteState(this.globalMuteState);

    // Apply global mute state to all existing players and update mute buttons
    // This ensures the loaded state is applied to any posts that were created before managers were initialized
    this.applyGlobalMuteState();
    this.updateAllMuteButtons();

    // Initialize favorites manager
    this.favoritesManager = new FavoritesManager(this.api);

    // Initialize discovery panel (opt-out via setting; hidden on mobile)
    if (this.settings.enableDiscoveryPanel === true && !isMobileDevice()) {
      this.discoveryPanel = new DiscoveryPanel(
        this.container,
        this.settings.discoveryPanelSize ?? 260,
        WhisparrClient.fromSettings(this.settings),
      );
      this.discoveryManager = new DiscoveryManager(this.api, this.discoveryPanel, this.settings.discoverySceneOrder ?? 'latest');
    }
  }
  
  /**
   * Unlock autoplay on mobile by playing a dummy video on first user interaction
   * This allows subsequent videos to autoplay
   */
  private unlockMobileAutoplay(): void {
    const isMobile = isMobileDevice();
    if (!isMobile) return;

    let unlocked = false;
    const unlock = () => {
      void (async () => {
        if (unlocked) return;
        unlocked = true;
        this.removeMobileAutoplayUnlockListeners();

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
      })();
    };

    // Unlock on any user interaction
    this.mobileAutoplayUnlockHandler = unlock;
    for (const event of this.mobileAutoplayUnlockEvents) {
      document.addEventListener(event, unlock, { once: true, passive: true });
    }
  }

  private setupAutoplayUnlockHandlers(): void {
    if (this.autoplayUnlockHandler) {
      return;
    }

    const handler = () => {
      if (!this.visibilityManager?.isAutoplayBlocked?.()) {
        return;
      }
      this.visibilityManager.clearAutoplayBlocked();
      this.visibilityManager.retryVisibleVideos();
    };

    this.autoplayUnlockHandler = handler;
    for (const event of this.mobileAutoplayUnlockEvents) {
      document.addEventListener(event, handler, { passive: true });
    }
  }

  private removeAutoplayUnlockHandlers(): void {
    if (!this.autoplayUnlockHandler) {
      return;
    }
    for (const event of this.mobileAutoplayUnlockEvents) {
      document.removeEventListener(event, this.autoplayUnlockHandler);
    }
    this.autoplayUnlockHandler = undefined;
  }

  private removeMobileAutoplayUnlockListeners(): void {
    if (!this.mobileAutoplayUnlockHandler) {
      return;
    }
    for (const event of this.mobileAutoplayUnlockEvents) {
      document.removeEventListener(event, this.mobileAutoplayUnlockHandler);
    }
    this.mobileAutoplayUnlockHandler = undefined;
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

    this.setHeaderOverlayState(false);
    this.unlockBodyScroll();

    // Refresh cache in the background for next time the overlay opens
    // Don't await - let it run asynchronously
    if (!this.isPreloading) {
      this.preloadSuggestions().catch((e) => console.warn('Failed to refresh suggestions cache', e));
    }
  }

  private setHeaderOverlayState(isOpen: boolean): void {
    if (!this.headerBar) {
      return;
    }

    if (isOpen) {
      this.headerBar.dataset.overlayZIndex ??= this.headerBar.style.zIndex;
      this.headerBar.style.zIndex = '1100';
      return;
    }

    const previousZIndex = this.headerBar.dataset.overlayZIndex ?? '';
    this.headerBar.style.zIndex = previousZIndex;
    delete this.headerBar.dataset.overlayZIndex;
  }

  /**
   * Create section label element
   */
  private createSectionLabel(label: string, uppercase: boolean = false): HTMLElement {
    const el = document.createElement('div');
    el.className = uppercase ? 'feed-section-label feed-section-label--uppercase' : 'feed-section-label';
    el.textContent = uppercase ? label.toUpperCase() : label;
    return el;
  }

  /**
   * Create pill button element
   */
  private attachSuggestionClickHandler(button: HTMLElement, onSelect: () => void | Promise<void>): void {
    button.addEventListener('mousedown', (event) => {
      event.preventDefault(); // prevent blur on queryInput before selection is committed
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      Promise.resolve(onSelect()).catch((error) => console.error('Suggestion selection failed', error));
    });
  }

  private createPillButton(label: string, onSelect: () => void | Promise<void>): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'feed-pill-button';
    button.textContent = label;
    this.attachSuggestionClickHandler(button, onSelect);
    return button;
  }

  /**
   * Create list button element
   */
  private createListButton(
    label: string,
    onSelect: () => void | Promise<void>,
    options: { subtitle?: string; leadingText?: string; leadingImage?: string; imageObjectFit?: string } = {}
  ): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'feed-list-button';

    if (options.leadingText || options.leadingImage) {
      const leading = document.createElement('div');
      leading.className = 'feed-list-button__leading';

      if (options.leadingImage) {
        const normalizedImage = normalizeMediaUrl(options.leadingImage);
        if (normalizedImage) {
          const img = document.createElement('img');
          img.src = normalizedImage;
          img.alt = label;
          if (options.imageObjectFit) {
            img.style.objectFit = options.imageObjectFit as 'contain' | 'cover';
          }
          leading.appendChild(img);
        } else {
          console.warn('FeedContainer: Invalid leading image URL', { url: options.leadingImage, label });
        }
      } else if (options.leadingText) {
        leading.textContent = options.leadingText;
      }

      button.appendChild(leading);
    }

    const textContainer = document.createElement('div');
    textContainer.className = 'feed-list-button__text';
    if (!options.subtitle) {
      textContainer.style.gap = '0';
    }

    const title = document.createElement('div');
    title.className = 'feed-list-button__title';
    title.textContent = label;
    textContainer.appendChild(title);

    if (options.subtitle) {
      const subtitle = document.createElement('div');
      subtitle.className = 'feed-list-button__subtitle';
      subtitle.textContent = options.subtitle;
      textContainer.appendChild(subtitle);
    }

    button.appendChild(textContainer);

    this.attachSuggestionClickHandler(button, onSelect);

    return button;
  }

  /**
   * Append empty state message
   */
  private appendEmptyState(target: HTMLElement, message: string): void {
    const emptyState = document.createElement('div');
    emptyState.className = 'feed-empty-state';
    emptyState.textContent = message;
    target.appendChild(emptyState);
  }

  /**


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

  private applySavedFilter(
    filter: { id: string; name: string },
    updateSearchBarDisplay: () => void,
    withScroll: boolean
  ): void {
    this.selectedSavedFilter = { id: filter.id, name: filter.name };
    this.selectedTagIds.clear();
    this.selectedPerformerIds.clear();
    this.closeSuggestions();
    updateSearchBarDisplay();
    this.currentFilters = { savedFilterId: filter.id, limit: FeedContainer.CONTENT_LOAD_LIMIT, offset: 0 };
    if (withScroll) this.scrollToTop();
    this.loadVideos(this.currentFilters, false).catch((e) => console.error('Apply saved filter failed', e));
  }

  /**
   * Create saved filters section
   */
  private createSavedFiltersSection(
    container: HTMLElement,
    updateSearchBarDisplay: () => void,
    apply: () => Promise<void>
  ): void {
    const filtersSection = document.createElement('div');
    filtersSection.style.display = 'flex';
    filtersSection.style.flexDirection = 'column';
    filtersSection.style.gap = '12px';
    filtersSection.appendChild(this.createSectionLabel('Saved Marker Filters', true));

    const pillRow = document.createElement('div');
    pillRow.style.display = 'flex';
    pillRow.style.flexWrap = 'wrap';
    pillRow.style.gap = '8px';

    pillRow.appendChild(this.createPillButton('Favorites', async () => {
      this.selectedSavedFilter = undefined;
      try {
        const favoriteTag = await this.api.findTagByName('StashGifs Favorite');
        if (favoriteTag) {
          const tagId = Number.parseInt(favoriteTag.id, 10);
          if (this.selectedTagIds.has(tagId)) {
            this.selectedTagIds.delete(tagId);
          } else {
            this.selectedTagIds.set(tagId, 'Favorites');
          }
        }
      } catch (error) {
        console.error('Failed to load favorite tag', error);
      }
      this.closeSuggestions();
      updateSearchBarDisplay();
      this.debouncedApplyFilters();
    }));

    for (const filter of this.savedFiltersCache) {
      pillRow.appendChild(this.createPillButton(filter.name, () => this.applySavedFilter(filter, updateSearchBarDisplay, true)));
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
    updateSearchBarDisplay: () => void,
    apply: () => Promise<void>,
    label: string = 'Tags'
  ): void {
    if (tags.length === 0) return;

    const tagsSection = document.createElement('div');
    tagsSection.style.display = 'flex';
    tagsSection.style.flexDirection = 'column';
    tagsSection.style.gap = '8px';
    tagsSection.appendChild(this.createSectionLabel(label));

    for (const tag of tags) {
      const tagId = Number.parseInt(tag.id, 10);
      const btn = this.createListButton(tag.name, () => {
        this.selectedSavedFilter = undefined;
        if (this.selectedTagIds.has(tagId)) {
          this.selectedTagIds.delete(tagId);
          btn.classList.remove('feed-list-button--selected');
        } else {
          this.selectedTagIds.set(tagId, tag.name);
          btn.classList.add('feed-list-button--selected');
        }
        updateSearchBarDisplay();
        this.debouncedApplyFilters();
        this.focusSearchInput();
      }, { leadingText: '#' });
      if (this.selectedTagIds.has(tagId)) {
        btn.classList.add('feed-list-button--selected');
      }
      tagsSection.appendChild(btn);
    }
    container.appendChild(tagsSection);
  }

  /**
   * Create performers section
   */
  private createPerformersSection(
    container: HTMLElement,
    performers: Array<{ id: string; name: string; image_path?: string }>,
    updateSearchBarDisplay: () => void,
    apply: () => Promise<void>,
    label: string = 'Performers'
  ): void {
    if (performers.length === 0) return;

    const performersSection = document.createElement('div');
    performersSection.style.display = 'flex';
    performersSection.style.flexDirection = 'column';
    performersSection.style.gap = '8px';
    performersSection.appendChild(this.createSectionLabel(label));

    for (const performer of performers) {
      const performerId = Number.parseInt(performer.id, 10);
      let imageSrc: string | undefined;
      if (performer.image_path) {
        imageSrc = normalizeMediaUrl(performer.image_path) ?? undefined;
      }
      const btn = this.createListButton(
        performer.name,
        () => {
          this.selectedSavedFilter = undefined;
          if (this.selectedPerformerIds.has(performerId)) {
            this.selectedPerformerIds.delete(performerId);
            btn.classList.remove('feed-list-button--selected');
          } else {
            this.selectedPerformerIds.set(performerId, performer.name);
            btn.classList.add('feed-list-button--selected');
          }
          updateSearchBarDisplay();
          this.debouncedApplyFilters();
          this.focusSearchInput();
        },
        { leadingImage: imageSrc, leadingText: imageSrc ? undefined : performer.name.charAt(0).toUpperCase() }
      );
      if (this.selectedPerformerIds.has(performerId)) {
        btn.classList.add('feed-list-button--selected');
      }
      performersSection.appendChild(btn);
    }
    container.appendChild(performersSection);
  }

  private createStudiosSection(
    container: HTMLElement,
    studios: Array<{ id: string; name: string; image_path?: string }>,
    updateSearchBarDisplay: () => void,
    apply: () => Promise<void>,
    label: string = 'Studios'
  ): void {
    if (studios.length === 0) return;
    const studiosSection = document.createElement('div');
    studiosSection.style.display = 'flex';
    studiosSection.style.flexDirection = 'column';
    studiosSection.style.gap = '8px';
    studiosSection.appendChild(this.createSectionLabel(label));
    for (const studio of studios) {
      const studioId = Number.parseInt(studio.id, 10);
      let imageSrc: string | undefined;
      if (studio.image_path) {
        imageSrc = normalizeMediaUrl(studio.image_path) ?? undefined;
      }
      const btn = this.createListButton(
        studio.name,
        () => {
          this.selectedSavedFilter = undefined;
          if (this.selectedStudioIds.has(studioId)) {
            this.selectedStudioIds.delete(studioId);
            btn.classList.remove('feed-list-button--selected');
          } else {
            this.selectedStudioIds.set(studioId, studio.name);
            btn.classList.add('feed-list-button--selected');
          }
          updateSearchBarDisplay();
          this.debouncedApplyFilters();
          this.focusSearchInput();
        },
        { leadingImage: imageSrc, leadingText: imageSrc ? undefined : studio.name.charAt(0).toUpperCase(), imageObjectFit: 'contain' }
      );
      if (this.selectedStudioIds.has(studioId)) {
        btn.classList.add('feed-list-button--selected');
      }
      studiosSection.appendChild(btn);
    }
    container.appendChild(studiosSection);
  }

  private filterUnselected<T extends { id: string }>(items: T[], selectedIds: Map<number, string>): T[] {
    return items.filter((item) => {
      const id = Number.parseInt(item.id, 10);
      return !Number.isNaN(id) && !selectedIds.has(id);
    });
  }

  /**
   * Render default suggestions view
   */
  private async renderDefaultSuggestionsView(
    container: HTMLElement,
    suggestions: HTMLElement,
    ensureLatest: () => boolean,
    updateSearchBarDisplay: () => void,
    apply: () => Promise<void>
  ): Promise<void> {
    while (container.firstChild) {
      container.firstChild.remove();
    }

    await this.loadSavedFiltersIfNeeded();
    if (!ensureLatest()) return;

    this.createSavedFiltersSection(container, updateSearchBarDisplay, apply);

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

    const availableTags = this.filterUnselected(freshTags, this.selectedTagIds).slice(0, 3);

    this.createTagsSection(container, availableTags, updateSearchBarDisplay, apply, 'Suggested Tags');

    const availablePerformers = this.filterUnselected(freshPerformers, this.selectedPerformerIds).slice(0, 3);

    this.createPerformersSection(container, availablePerformers, updateSearchBarDisplay, apply, 'Suggested Performers');

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
    ensureLatest: () => boolean,
    updateSearchBarDisplay: () => void,
    apply: () => Promise<void>
  ): Promise<void> {
    container.innerHTML = '';

    await this.loadSavedFiltersIfNeeded();

    const matchingSavedFilters = this.savedFiltersCache
      .filter((filter) => filter.name.toLowerCase().includes(trimmedText.toLowerCase()))
      .slice(0, 6);

    if (matchingSavedFilters.length > 0) {
      const savedSection = document.createElement('div');
      savedSection.style.display = 'flex';
      savedSection.style.flexDirection = 'column';
      savedSection.style.gap = '8px';
      savedSection.appendChild(this.createSectionLabel('Matching Saved Marker Filters'));
      for (const filter of matchingSavedFilters) {
        const btn = this.createListButton(filter.name, () => this.applySavedFilter(filter, updateSearchBarDisplay, false));
        btn.dataset.savedFilter = 'true';
        savedSection.appendChild(btn);
      }
      container.appendChild(savedSection);
    }

    let tagItems: Array<{ id: string; name: string }> = [];
    let performerItems: Array<{ id: string; name: string; image_path?: string }> = [];
    let studioItems: Array<{ id: string; name: string; image_path?: string }> = [];

    try {
      [tagItems, performerItems, studioItems] = await Promise.all([
        this.api.searchMarkerTags(trimmedText, 20),
        this.api.searchPerformers(trimmedText, 20),
        this.api.searchStudios(trimmedText, 20),
      ]);
    } catch (error) {
      console.warn('Failed to fetch search suggestions', error);
    }

    if (!ensureLatest()) return;

    const filteredTags = this.filterUnselected(tagItems, this.selectedTagIds).slice(0, 20);

    this.createTagsSection(container, this.sortByMatchAccuracy(filteredTags, trimmedText), updateSearchBarDisplay, apply);

    const filteredPerformers = this.filterUnselected(performerItems, this.selectedPerformerIds).slice(0, 20);

    this.createPerformersSection(container, this.sortByMatchAccuracy(filteredPerformers, trimmedText), updateSearchBarDisplay, apply);

    const filteredStudios = this.filterUnselected(studioItems, this.selectedStudioIds).slice(0, 20);

    this.createStudiosSection(container, this.sortByMatchAccuracy(filteredStudios, trimmedText), updateSearchBarDisplay, apply);

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
    chip.className = isSelected ? 'feed-suggestion-chip feed-suggestion-chip--selected' : 'feed-suggestion-chip';
    chip.addEventListener('mousedown', (e) => { e.preventDefault(); });
    chip.addEventListener('click', onClick);
    return chip;
  }

  /**
   * Create a section label for suggestions
   */
  private createSuggestionLabel(text: string): HTMLElement {
    const label = document.createElement('div');
    label.className = 'feed-suggestion-label';
    label.textContent = text;
    return label;
  }

  /**
   * Create a divider for suggestions
   */
  private createSuggestionDivider(): HTMLElement {
    const divider = document.createElement('div');
    divider.className = 'feed-suggestion-divider';
    return divider;
  }

  private sortByMatchAccuracy<T extends { name: string }>(items: T[], query: string): T[] {
    if (!query) return items;
    const q = query.toLowerCase();
    return [...items].sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      const score = (name: string): number => {
        if (name === q) return 0;
        if (name.startsWith(q)) return 1;
        return 2;
      };
      const diff = score(aName) - score(bName);
      return diff === 0 ? aName.localeCompare(bName) : diff;
    });
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

    container.appendChild(this.createSuggestionLabel('Saved Marker Filters'));

    for (const f of this.savedFiltersCache) {
      const chip = this.createSuggestionChip(f.name, () => {
        savedSelect.value = f.id;
        this.selectedSavedFilter = { id: f.id, name: f.name };
        this.selectedTagIds.clear();
        this.selectedPerformerIds.clear();
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
      if (tag.name === 'StashGifs Favorite' || tag.name === 'StashGifs Marker') continue;
      const tagId = Number.parseInt(tag.id, 10);
      const isSelected = this.selectedTagIds.has(tagId);

      const chip = this.createSuggestionChip(tag.name, () => {
        this.selectedSavedFilter = undefined;
        savedSelect.value = '';
        if (this.selectedTagIds.has(tagId)) {
          this.selectedTagIds.delete(tagId);
          chip.classList.remove('feed-suggestion-chip--selected');
        } else {
          this.selectedTagIds.set(tagId, tag.name);
          chip.classList.add('feed-suggestion-chip--selected');
        }
        updateSearchBarDisplay();
        this.debouncedApplyFilters();
        this.focusSearchInput();
      }, isSelected);
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
      const performerId = Number.parseInt(performer.id, 10);
      const isSelected = this.selectedPerformerIds.has(performerId);

      const chip = this.createSuggestionChip(performer.name, () => {
        this.selectedSavedFilter = undefined;
        savedSelect.value = '';
        if (this.selectedPerformerIds.has(performerId)) {
          this.selectedPerformerIds.delete(performerId);
          chip.classList.remove('feed-suggestion-chip--selected');
        } else {
          this.selectedPerformerIds.set(performerId, performer.name);
          chip.classList.add('feed-suggestion-chip--selected');
        }
        updateSearchBarDisplay();
        this.debouncedApplyFilters();
        this.focusSearchInput();
      }, isSelected);
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
    more.style.borderRadius = THEME.radius.button;
    more.style.border = `1px solid ${THEME.colors.border}`;
    more.style.background = THEME.colors.backgroundSecondary;
    more.style.cursor = 'pointer';
    more.style.width = '100%';
    more.style.marginTop = '4px';
    const handleMoreClick = async (): Promise<void> => {
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
    };
    more.addEventListener('click', () => { void handleMoreClick(); });
    return more;
  }

  /**
   * Create header element with proper styling
   */
  private createHeaderElement(): HTMLElement {
    const header = document.createElement('div');
    this.headerBar = header;
    header.className = 'feed-header-bar';
    
    // Dynamic styles that must remain inline
    header.style.maxWidth = `${this.settings.cardMaxWidth + 24}px`;
    header.style.top = '0';
    header.style.transform = 'translateY(0)';
    
    const nav = globalThis.navigator;
    const isStandalone = (isStandaloneNavigator(nav) && nav.standalone) || 
                         globalThis.matchMedia('(display-mode: standalone)').matches;
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    
    if (isStandalone && isIOS) {
      header.style.top = 'calc(env(safe-area-inset-top, 0px) * 0.7)';
      header.style.minHeight = '72px';
      header.style.height = 'auto';
    }
    
    return header;
  }

  /**
   * Create header inner container with grid layout
   */
  private createHeaderInnerContainer(): HTMLElement {
    const headerInner = document.createElement('div');
    headerInner.className = 'feed-header-inner';
    headerInner.style.maxWidth = `${this.settings.cardMaxWidth}px`;
    return headerInner;
  }

  /**
   * Create search area container
   */
  private createSearchArea(): HTMLElement {
    const searchArea = document.createElement('div');
    searchArea.className = 'feed-search-area';
    return searchArea;
  }

  /**
   * Create tag header element
   */
  private createTagHeader(): HTMLElement {
    const tagHeader = document.createElement('div');
    tagHeader.className = 'feed-filters__tag-header feed-tag-header';
    tagHeader.style.display = 'none';
    return tagHeader;
  }

  /**
   * Create brand container with logo and refresh functionality
   */
  private createBrandContainer(headerInner: HTMLElement): HTMLElement {
    const brandContainer = document.createElement('div');
    brandContainer.className = 'feed-brand-container';
    brandContainer.title = 'Click to refresh feed';
    brandContainer.style.display = 'inline-flex';
    brandContainer.style.alignItems = 'center';
    brandContainer.style.padding = '6px 12px';
    brandContainer.style.height = '36px';
    brandContainer.style.borderRadius = THEME.radius.button;
    brandContainer.style.border = `1px solid ${THEME.colors.border}`;
    brandContainer.style.background = THEME.colors.backgroundSecondary;
    brandContainer.style.cursor = 'pointer';
    brandContainer.style.transition = 'background 0.2s ease, border-color 0.2s ease, color 0.2s ease';

    const brand = document.createElement('span');
    brand.className = 'feed-brand-text';
    brand.innerHTML = STASHGIFS_LOGO_SVG;
    brand.style.color = 'var(--color-accent)';
    brand.style.display = 'inline-flex';
    brand.style.alignItems = 'center';

    brandContainer.addEventListener('mouseenter', () => {
      brandContainer.style.background = THEME.colors.surfaceHover;
      brandContainer.style.borderColor = THEME.colors.accentPrimary;
    });

    brandContainer.addEventListener('mouseleave', () => {
      brandContainer.style.background = THEME.colors.backgroundSecondary;
      brandContainer.style.borderColor = THEME.colors.border;
    });

    brandContainer.addEventListener('click', () => {
      this.selectedTagIds.clear();
      this.selectedPerformerIds.clear();
      this.selectedStudioIds.clear();
      this.selectedSavedFilter = undefined;
      this.currentFilters = undefined;

      this.updateActivePills();
      this.updateQueryInputDisplay();

      if (this.updatePlaceholderVisibilityRef) {
        this.updatePlaceholderVisibilityRef();
      }

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
    updatePlaceholderVisibility: () => void;
  } {
    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'feed-input-wrapper';

    const queryInput = this.createQueryInput();
    const placeholderSetup = this.setupPlaceholderAnimation(queryInput);
    const placeholderWrapper = placeholderSetup.placeholderWrapper;
    const loadingSpinner = this.createLoadingSpinner();

    inputWrapper.appendChild(placeholderWrapper);
    inputWrapper.appendChild(loadingSpinner);

    this.setupInputEventHandlers(queryInput, placeholderWrapper, placeholderSetup);

    return {
      inputWrapper,
      queryInput,
      placeholderWrapper,
      loadingSpinner,
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
    placeholderWrapper.className = 'feed-placeholder-wrapper';
    
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
      textEl.style.color = THEME.colors.accentPrimary;
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
   * Create loading spinner for search input
   */
  private createLoadingSpinner(): HTMLElement {
    const loadingSpinner = document.createElement('div');
    loadingSpinner.className = 'feed-search-loading feed-loading-spinner';
    loadingSpinner.style.display = 'none';
    return loadingSpinner;
  }

  /**
   * Create shuffle indicator element
   */
  /**
   * Setup header buttons (HD toggle)
   */
  /**
   * Create settings button
   */
  private createSettingsButton(): HTMLButtonElement {
    const settingsButton = document.createElement('button');
    settingsButton.type = 'button';
    settingsButton.title = 'Settings';
    settingsButton.setAttribute('aria-label', 'Open settings');
    settingsButton.style.padding = '10px 12px';
    settingsButton.style.borderRadius = THEME.radius.button;
    settingsButton.style.border = `1px solid ${THEME.colors.border}`;
    settingsButton.style.background = THEME.colors.backgroundSecondary;
    settingsButton.style.color = THEME.colors.iconInactive;
    settingsButton.style.cursor = 'pointer';
    settingsButton.style.display = 'inline-flex';
    settingsButton.style.alignItems = 'center';
    settingsButton.style.justifyContent = 'center';
    settingsButton.style.transition = 'background 0.2s ease, border-color 0.2s ease, color 0.2s ease';
    // Standard settings/gear icon
    settingsButton.innerHTML = SETTINGS_SVG;

    settingsButton.addEventListener('mouseenter', () => {
      settingsButton.style.color = THEME.colors.textPrimary;
      settingsButton.style.background = THEME.colors.surfaceHover;
      settingsButton.style.borderColor = THEME.colors.border;
    });

    settingsButton.addEventListener('mouseleave', () => {
      settingsButton.style.color = THEME.colors.iconInactive;
      settingsButton.style.background = THEME.colors.backgroundSecondary;
      settingsButton.style.borderColor = THEME.colors.border;
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
      (signal) => this.api.findGalleries(signal),
      (newSettings) => this.handleSettingsChange(newSettings),
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
   * Create top header bar with unified search
   */
  private createHeaderBar(): void {
    // Saved filters will be loaded lazily when filter dropdown opens
    let savedFiltersCache: Array<{ id: string; name: string }> = [];

    const header = this.createHeaderElement();
    const headerInner = this.createHeaderInnerContainer();

    this.createBrandContainer(headerInner);

    const searchArea = this.createSearchArea();
    
    // Create a container for search area and settings button
    const searchAndSettingsContainer = document.createElement('div');
    searchAndSettingsContainer.style.display = 'flex';
    searchAndSettingsContainer.style.alignItems = 'center';
    searchAndSettingsContainer.style.gap = '8px';
    searchAndSettingsContainer.style.width = '100%';
    searchAndSettingsContainer.style.minWidth = '0';
    searchAndSettingsContainer.style.position = 'relative';
    
    // Add search area to container
    searchAndSettingsContainer.appendChild(searchArea);
    
    // Create and add settings button to the right of search bar
    const settingsButton = this.createSettingsButton();
    searchAndSettingsContainer.appendChild(settingsButton);
    
    // Add the container to header inner (middle grid column)
    headerInner.appendChild(searchAndSettingsContainer);
    header.appendChild(headerInner);

    const activePillsBar = document.createElement('div');
    activePillsBar.className = 'feed-filters__active-pills';
    activePillsBar.style.display = 'none';
    activePillsBar.style.flexWrap = 'wrap';
    activePillsBar.style.gap = '6px';
    activePillsBar.style.padding = '4px 0 4px';
    activePillsBar.style.boxSizing = 'border-box';
    activePillsBar.style.justifyContent = 'center';
    header.appendChild(activePillsBar);
    this.activePillsBar = activePillsBar;

    const tagHeader = this.createTagHeader();

    const inputSetup = this.setupSearchInput();
    const inputWrapper = inputSetup.inputWrapper;
    const queryInput = inputSetup.queryInput;
    const loadingSpinner = inputSetup.loadingSpinner;
    const updatePlaceholderVisibility = inputSetup.updatePlaceholderVisibility;
    this.updatePlaceholderVisibilityRef = updatePlaceholderVisibility;

    // Append input to wrapper
    inputWrapper.appendChild(queryInput);

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
    suggestions.style.background = THEME.colors.overlay;
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
      queryInput.value = this.getSelectedFilterDisplayName();
      tagHeader.style.display = 'none';
      updatePlaceholderVisibility();
      if (queryInput instanceof HTMLInputElement) {
        queryInput.readOnly = false;
      }
      queryInput.style.opacity = '1';
      queryInput.style.paddingLeft = '14px';
      this.updateActivePills();
    };

    const apply = async () => {
      // Show loading state
      queryInput.disabled = true;
      queryInput.style.opacity = '0.6';
      loadingSpinner.style.display = 'block';
      try {
        updateSearchBarDisplay();
        await this.applyCurrentSearch();
        // Scroll to top (same approach as refreshFeed)
        this.scrollToTop();
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
    let pendingSuggestionsFetch: Promise<void> | null = null;

    const triggerFetchSuggestions = (text: string, forceShow: boolean): Promise<void> => {
      const p = fetchAndShowSuggestions(text, forceShow);
      pendingSuggestionsFetch = p;
      p.finally(() => { if (pendingSuggestionsFetch === p) pendingSuggestionsFetch = null; });
      return p;
    };

    // Debounced suggestion fetcher (150ms delay)
    const debouncedFetchSuggestions = debounce((text: string, forceShow: boolean) => {
      triggerFetchSuggestions(text, forceShow);
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

      this.setHeaderOverlayState(true);
      panel.style.setProperty('padding-top', this.getSuggestionsTopOffset(), 'important');
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
      ensureLatest: () => boolean,
      updateSearchBarDisplay: () => void,
      apply: () => Promise<void>
    ) => {
      await this.renderDefaultSuggestionsView(
        container,
        panel,
        ensureLatest,
        updateSearchBarDisplay,
        apply
      );
    };

    const renderSearchSuggestions = async (
      container: HTMLElement,
      panel: HTMLElement,
      trimmedText: string,
      ensureLatest: () => boolean,
      updateSearchBarDisplay: () => void,
      apply: () => Promise<void>
    ) => {
      await this.renderSearchResultsView(
        container,
        panel,
        trimmedText,
        ensureLatest,
        updateSearchBarDisplay,
        apply
      );
    };

    const fetchAndShowSuggestions = async (text: string, forceShow: boolean = false) => {
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
          ensureLatest,
          updateSearchBarDisplay,
          apply
        );
      } else {
        await renderSearchSuggestions(
          container,
          suggestions,
          trimmedText,
          ensureLatest,
          updateSearchBarDisplay,
          apply
        );
      }
    };
    
    queryInput.addEventListener('keydown', (e) => {
      if (!(e instanceof KeyboardEvent) || e.key !== 'Enter') return;

      const text = queryInput.value.trim();

      if (!text) {
        apply();
        return;
      }

      e.preventDefault();

      triggerFetchSuggestions(text, false).then(() => {
        if (queryInput.value.trim() !== text) return;
        const firstResult = suggestions.querySelector(
          'button.feed-list-button:not(.feed-list-button--selected):not([data-saved-filter]), button.feed-suggestion-chip:not(.feed-suggestion-chip--selected)'
        ) as HTMLButtonElement | null;
        if (firstResult) firstResult.click();
      });
    });
    
    // Handle focus and show suggestions
    let focusHandled = false;
    let clickHandled = false;

    const focusInputSafely = (input: HTMLInputElement) => {
      try {
        input.focus({ preventScroll: true } as FocusOptions);
      } catch {
        input.focus();
      }
    };

    const clearSearchSelection = () => {
      this.selectedSavedFilter = undefined;
    };

    const prepareSearchForInput = () => {
      this.preloadSuggestions().catch((e) => console.warn('Suggestion preload refresh failed', e));
      queryInput.style.background = THEME.colors.surface;
      queryInput.style.borderColor = THEME.colors.border;
      clearSearchSelection();
      queryInput.value = '';
      triggerFetchSuggestions('', true);
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
      handleFocus();
    };
    
    // Detect mobile device
    const isMobile = isMobileDevice();
    
    if (isMobile) {
      queryInput.addEventListener('touchend', handleMobileTouchEnd, { passive: false });
      queryInput.addEventListener('click', handleMobileClick);
    } else {
      queryInput.addEventListener('click', handleDesktopClick);
    }
    
    queryInput.addEventListener('focus', handleFocus);
    
    queryInput.addEventListener('blur', () => {
      updateSearchBarDisplay();
      this.applyReelHeaderStyles(this.isReelModeEnabled());
    });
    
    queryInput.addEventListener('input', () => {
      const text = queryInput.value;
      // Clear saved filter when user types something new
      if (text !== this.selectedSavedFilter?.name) {
        this.selectedSavedFilter = undefined;
      }
      // Use debounced function for better performance - only fetch suggestions, don't apply
      debouncedFetchSuggestions(text, false);
      // Don't auto-apply while typing - only apply when user presses Enter or selects a suggestion
    });

    suggestions.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('button, input, a, select, textarea')) {
        this.closeSuggestions();
      }
    });
    
    this.registerSuggestionsOutsideHandlers(searchArea, suggestions);

    // Initial render of search bar display (in case defaults are provided)
    updateSearchBarDisplay();
  }

  private registerSuggestionsOutsideHandlers(searchArea: HTMLElement, suggestions: HTMLElement): void {
    let clickHandlerTimeout: number | null = null;
    const handleClickOutside = (e: Event) => {
      if (clickHandlerTimeout !== null) {
        clearTimeout(clickHandlerTimeout);
      }

      clickHandlerTimeout = (globalThis.setTimeout(() => {
        const isSuggestionsVisible = suggestions.style.display !== 'none';
        const clickedInsideSearch = searchArea.contains(e.target as Node);
        const clickedInsideSuggestions = suggestions.contains(e.target as Node);

        const target = e.target as HTMLElement;
        const clickedOnHeaderButton = target.closest('button') &&
          (target.closest('.feed-header-bar') || target.closest('header'));

        if (isSuggestionsVisible && !clickedInsideSearch && !clickedInsideSuggestions && !clickedOnHeaderButton) {
          this.closeSuggestions();
        }
      }, 0) as unknown as number);
    };

    if (this.suggestionsClickOutsideHandler) {
      document.removeEventListener('click', this.suggestionsClickOutsideHandler);
    }
    this.suggestionsClickOutsideHandler = handleClickOutside;
    document.addEventListener('click', handleClickOutside);

    const isMobileDeviceLocal = isMobileDevice();
    if (this.suggestionsTouchOutsideHandler) {
      document.removeEventListener('touchend', this.suggestionsTouchOutsideHandler);
      this.suggestionsTouchOutsideHandler = undefined;
    }
    if (isMobileDeviceLocal) {
      this.suggestionsTouchOutsideHandler = handleClickOutside;
      document.addEventListener('touchend', handleClickOutside, { passive: true });
    }
  }

  /**
   * Handle performer chip click - toggle performer in active filter set
   */
  private handlePerformerChipClick(performerId: number, performerName: string): void {
    this.selectedSavedFilter = undefined;
    if (this.selectedPerformerIds.has(performerId)) {
      this.selectedPerformerIds.delete(performerId);
    } else {
      this.selectedPerformerIds.set(performerId, performerName);
    }
    this.updateActivePills();
    this.updateQueryInputDisplay();
    this.debouncedApplyFilters();
    this.scrollToTop();
  }

  /**
   * Handle tag chip click - toggle tag in active filter set
   */
  private handleTagChipClick(tagId: number, tagName: string): void {
    this.selectedSavedFilter = undefined;
    if (this.selectedTagIds.has(tagId)) {
      this.selectedTagIds.delete(tagId);
    } else {
      this.selectedTagIds.set(tagId, tagName);
    }
    this.updateActivePills();
    this.updateQueryInputDisplay();
    this.debouncedApplyFilters();
    this.scrollToTop();
  }

  private handleStudioChipClick(studioId: number, studioName: string): void {
    this.selectedSavedFilter = undefined;
    if (this.selectedStudioIds.has(studioId)) {
      this.selectedStudioIds.delete(studioId);
    } else {
      this.selectedStudioIds.set(studioId, studioName);
    }
    this.updateActivePills();
    this.updateQueryInputDisplay();
    this.debouncedApplyFilters();
    this.scrollToTop();
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
    // Fallback: query the input element directly even if not focused
    const queryInput = this.container.querySelector('.feed-filters__input') as HTMLInputElement;
    if (queryInput) {
      return queryInput.value?.trim() || undefined;
    }
    return undefined;
  }


  /**
   * Build filter values from selected performers Map
   */
  private buildPerformerFilters(): { performers: string[] } {
    return {
      performers: [...this.selectedPerformerIds.keys()].map(String),
    };
  }

  /**
   * Build filter values from selected tags Map
   */
  private buildTagFilters(): { tags?: string[] } {
    const ids = [...this.selectedTagIds.keys()].map(String);
    return ids.length ? { tags: ids } : {};
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
        this.selectedTagIds.set(Number.parseInt(exactTag.id, 10), exactTag.name);
        return {};
      }

      const matchingPerformers = await this.api.searchPerformers(q, 10, loadSignal);
      if (loadSignal?.aborted) {
        return {};
      }

      if (matchingPerformers && matchingPerformers.length > 0 && matchingPerformers[0]) {
        this.selectedPerformerIds.set(Number.parseInt(String(matchingPerformers[0].id), 10), matchingPerformers[0].name);
        return {};
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
   * Resolves text query to tag/performer if Maps are empty, or falls back to plain text.
   */
  private async applyCurrentSearch(loadSignal?: AbortSignal): Promise<void> {
    const q = this.getCurrentQueryFromInput();
    let queryValue: string | undefined;

    if (q && !this.selectedSavedFilter && this.selectedTagIds.size === 0 && this.selectedPerformerIds.size === 0) {
      const resolved = await this.resolveQueryToFilters(q, loadSignal);
      if (loadSignal?.aborted) return;
      queryValue = resolved.queryValue;
      this.updateActivePills();
    }

    const filterValues = this.buildFiltersForApply();
    const newFilters: FilterOptions = {
      query: queryValue,
      tags: filterValues.tags,
      performers: filterValues.performers,
      savedFilterId: this.selectedSavedFilter?.id || undefined,
      limit: FeedContainer.CONTENT_LOAD_LIMIT,
      offset: 0,
      tagDepth: this.settings.includeSubtags ? -1 : 0,
      studioDepth: this.settings.includeSubtags ? -1 : 0,
    };
    this.currentFilters = newFilters;
    await this.loadVideos(newFilters, false, loadSignal);
  }

  /**
   * Get display name for the current filter selection
   */
  private getSelectedFilterDisplayName(): string {
    if (this.selectedTagIds.size > 0 || this.selectedPerformerIds.size > 0) {
      return '';
    }
    return this.selectedSavedFilter ? this.selectedSavedFilter.name : '';
  }

  /**
   * Update query input display with current selection
   */
  private updateQueryInputDisplay(): void {
    const queryInput = this.container.querySelector('.feed-filters__input') as HTMLInputElement;
    if (!queryInput) {
      return;
    }

    queryInput.value = this.getSelectedFilterDisplayName();

    const ph = document.getElementById('feed-search-placeholder');
    if (ph) {
      ph.style.display = 'none';
    }
    this.updateActivePills();
  }

  /**
   * Build filter values from selected tag and performer Maps
   */
  private buildFiltersForApply(): { tags?: string[]; performers?: string[]; studios?: string[] } {
    const tags = [...this.selectedTagIds.keys()].map(String);
    const performers = [...this.selectedPerformerIds.keys()].map(String);
    const studios = [...this.selectedStudioIds.keys()].map(String);
    return {
      tags: tags.length ? tags : undefined,
      performers: performers.length ? performers : undefined,
      studios: studios.length ? studios : undefined,
    };
  }

  /**
   * Apply current filters and update UI
   */
  private async applyFilters(): Promise<void> {
    this.updateQueryInputDisplay();

    const filterValues = this.buildFiltersForApply();
    const newFilters: FilterOptions = {
      query: undefined,
      tags: filterValues.tags,
      performers: filterValues.performers,
      studios: filterValues.studios,
      savedFilterId: this.selectedSavedFilter?.id || undefined,
      limit: FeedContainer.CONTENT_LOAD_LIMIT,
      offset: 0,
      tagDepth: this.settings.includeSubtags ? -1 : 0,
      studioDepth: this.settings.includeSubtags ? -1 : 0,
    };
    this.currentFilters = newFilters;
    this.loadVideos(newFilters, false).catch((e) => console.error('Apply filters failed', e));
  }

  /**
   * Render active filter pills bar from current Maps
   */
  private createPillWord(text: string): HTMLElement {
    const sep = document.createElement('span');
    sep.textContent = text;
    sep.setAttribute('aria-hidden', 'true');
    sep.style.cssText = `font-size:11px;color:${THEME.colors.textSecondary};align-self:center;flex-shrink:0;padding:0 2px;`;
    return sep;
  }

  private appendTagPills(): void {
    for (const [id, name] of this.selectedTagIds) {
      this.activePillsBar!.appendChild(this.createActivePill(`#${name}`, () => {
        this.selectedTagIds.delete(id);
        this.updateActivePills();
        this.updateQueryInputDisplay();
        this.debouncedApplyFilters();
      }));
    }
  }

  private appendPerformerPills(): void {
    let first = true;
    for (const [id, name] of this.selectedPerformerIds) {
      if (first) {
        if (this.selectedTagIds.size > 0) this.activePillsBar!.appendChild(this.createPillWord('with'));
        first = false;
      } else {
        this.activePillsBar!.appendChild(this.createPillWord('and'));
      }
      this.activePillsBar!.appendChild(this.createActivePill(`@${name}`, () => {
        this.selectedPerformerIds.delete(id);
        this.updateActivePills();
        this.updateQueryInputDisplay();
        this.debouncedApplyFilters();
      }));
    }
  }

  private appendStudioPills(): void {
    const hasPrior = this.selectedTagIds.size > 0 || this.selectedPerformerIds.size > 0;
    let first = true;
    for (const [id, name] of this.selectedStudioIds) {
      if (first) {
        if (hasPrior) this.activePillsBar!.appendChild(this.createPillWord('by'));
        first = false;
      } else {
        this.activePillsBar!.appendChild(this.createPillWord('or'));
      }
      this.activePillsBar!.appendChild(this.createActivePill(name, () => {
        this.selectedStudioIds.delete(id);
        this.updateActivePills();
        this.updateQueryInputDisplay();
        this.debouncedApplyFilters();
      }));
    }
  }

  private updateActivePills(): void {
    if (!this.activePillsBar) return;

    while (this.activePillsBar.firstChild) {
      this.activePillsBar.firstChild.remove();
    }

    const total = this.selectedTagIds.size + this.selectedPerformerIds.size + this.selectedStudioIds.size;
    if (total === 0) {
      this.activePillsBar.style.display = 'none';
      return;
    }

    this.activePillsBar.style.display = 'flex';
    this.appendTagPills();
    this.appendPerformerPills();
    this.appendStudioPills();

    if (total >= 2) {
      const clearAll = this.createActivePill('Clear all', () => {
        this.selectedTagIds.clear();
        this.selectedPerformerIds.clear();
        this.selectedStudioIds.clear();
        this.updateActivePills();
        this.updateQueryInputDisplay();
        this.debouncedApplyFilters();
      }, true);
      this.activePillsBar.appendChild(clearAll);
    }

    const panel = document.querySelector<HTMLElement>('.feed-filters__suggestions');
    if (panel && panel.style.display !== 'none') {
      panel.style.setProperty('padding-top', this.getSuggestionsTopOffset(), 'important');
    }
  }

  private getSuggestionsTopOffset(): string {
    const h = this.headerBar?.getBoundingClientRect().bottom ?? 80;
    return `${Math.ceil(h)}px`;
  }

  private focusSearchInput(): void {
    const qi = this.container.querySelector<HTMLInputElement>('.feed-filters__input');
    if (!qi) return;
    try {
      qi.focus({ preventScroll: true } as FocusOptions);
    } catch {
      qi.focus();
    }
  }

  /**
   * Create a dismissible active-filter pill
   */
  private createActivePill(label: string, onRemove: () => void, isDestructive: boolean = false): HTMLElement {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.style.display = 'inline-flex';
    pill.style.alignItems = 'center';
    pill.style.gap = '4px';
    pill.style.padding = '3px 8px 3px 10px';
    pill.style.borderRadius = '999px';
    pill.style.border = 'none';
    pill.style.fontSize = '12px';
    pill.style.lineHeight = '1.4';
    pill.style.cursor = 'pointer';
    pill.style.whiteSpace = 'nowrap';
    pill.style.maxWidth = '200px';
    pill.style.overflow = 'hidden';
    pill.style.textOverflow = 'ellipsis';
    pill.style.transition = 'opacity 0.15s ease';

    if (isDestructive) {
      pill.style.background = THEME.colors.backgroundSecondary;
      pill.style.color = THEME.colors.textSecondary;
      pill.style.border = `1px solid ${THEME.colors.border}`;
      pill.textContent = label;
    } else {
      pill.style.background = THEME.colors.accentPrimary;
      pill.style.color = '#fff';

      const labelSpan = document.createElement('span');
      labelSpan.style.overflow = 'hidden';
      labelSpan.style.textOverflow = 'ellipsis';
      labelSpan.textContent = label;

      const xBtn = document.createElement('span');
      xBtn.textContent = '×';
      xBtn.style.fontSize = '14px';
      xBtn.style.lineHeight = '1';
      xBtn.style.opacity = '0.8';
      xBtn.style.flexShrink = '0';

      pill.appendChild(labelSpan);
      pill.appendChild(xBtn);
    }

    pill.addEventListener('mousedown', (e) => e.preventDefault());
    pill.addEventListener('click', onRemove);
    return pill;
  }

  /**
   * Initialize the feed
   */
  async init(filters?: FilterOptions): Promise<void> {
    // Load rating system configuration
    try {
      const config = await this.api.getUIConfiguration();
      this.ratingSystemConfig = config || { type: 'stars', starPrecision: 'full' };
    } catch (error) {
      console.warn('Failed to load rating system configuration, using defaults', error);
      this.ratingSystemConfig = { type: 'stars', starPrecision: 'full' }; // Default fallback
    }
    this.currentFilters = filters;
    await this.refreshFeed();
    if (this.posts.size === 0) {
      await this.loadVideos(this.currentFilters, false, undefined, true);
    }
    
    // Defer suggestion preloading significantly to avoid competing with initial load
    // Wait 10 seconds on mobile, 5 seconds on desktop to ensure initial content is loaded first
    if (globalThis.window !== undefined) {
      const suggestionDelay = 5000;
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
    const limit = filters.limit || FeedContainer.CONTENT_LOAD_LIMIT;
    let offset = 0;
    if (append && page > 1) {
      offset = FeedContainer.CONTENT_LOAD_LIMIT + (page - 2) * FeedContainer.CONTENT_LOAD_LIMIT;
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

  /**
   * Shared helper: create a post container and append it to a fragment
   */
  private async processItemForRender(
    createContainer: () => Promise<HTMLElement | null>,
    fragment: DocumentFragment | null
  ): Promise<{ fragment: DocumentFragment; postContainer: HTMLElement | null }> {
    const postContainer = await createContainer();
    const currentFragment = fragment ?? document.createDocumentFragment();

    if (postContainer) {
      currentFragment.appendChild(postContainer);
    }

    return { fragment: currentFragment, postContainer };
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
    return this.processItemForRender(() => this.createPost(marker, signal), fragment);
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

    const postsContainer = this.postsContainer;
    if (!postsContainer) {
      return;
    }

    if (this.loadMoreTrigger?.parentNode === postsContainer) {
      postsContainer.insertBefore(fragment, this.loadMoreTrigger);
    } else {
      postsContainer.appendChild(fragment);
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
      if (this.checkAbortAndCleanup(signal)) {
        return;
      }

      const result = await this.renderItemForRender(items[i], fragment, signal);
      fragment = result.fragment;
      
      if (result.postContainer) {
        fragmentPostCount++;
      }

      this.removeSkeletonIfNeeded(append, i);

      if (this.shouldInsertFragment(i, renderChunkSize, items.length) && fragment && fragmentPostCount > 0) {
        const flushed = this.flushFragment(fragment, fragmentPostCount);
        fragment = flushed.fragment;
        fragmentPostCount = flushed.fragmentPostCount;

        await this.waitForRenderDelay(i, items.length, renderDelay);
      }
    }
  }

  private async renderItemForRender(
    item: { type: 'marker' | 'image'; data: SceneMarker | Image; date?: string },
    fragment: DocumentFragment | null,
    signal?: AbortSignal
  ): Promise<{ fragment: DocumentFragment; postContainer: HTMLElement | null }> {
    const result = item.type === 'marker'
      ? await this.processMarkerForRender(item.data as SceneMarker, fragment, signal)
      : await this.processImageForRender(item.data as Image, fragment, signal);
    if (result.postContainer) {
      this.markItemSeen((item.data as { id: string }).id);
    }
    return result;
  }

  private flushFragment(
    fragment: DocumentFragment,
    fragmentPostCount: number
  ): { fragment: DocumentFragment | null; fragmentPostCount: number } {
    this.insertFragment(fragment, fragmentPostCount);
    return { fragment: null, fragmentPostCount: 0 };
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
    return this.processItemForRender(() => this.createPostFromImage(image, signal), fragment);
  }

  /**
   * Create a post from an image (can be either ImagePost or VideoPost depending on file type and settings)
   */
  private async createPostFromImage(image: Image, signal?: AbortSignal): Promise<HTMLElement | null> {
    // Use centralized utility to detect video
    const { isVideo, videoFile } = detectVideoFromVisualFiles(image.visualFiles);
    
    // Check if this is a .m4v or .mp4 file (always treat as video, behavior controlled by HD mode)
    const videoPath = videoFile?.path;
    const isMp4Video = isVideo && videoPath && isMp4File(videoPath);
    
    if (isMp4Video) {
      return this.createVideoPostFromImage(image, signal);
    }

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
   * Create a VideoPost from an Image (for .m4v/.mp4 files)
   */
  private async createVideoPostFromImage(image: Image, signal?: AbortSignal): Promise<HTMLElement | null> {
    const videoUrl = this.getImageUrlForPost(image);
    if (!videoUrl) {
      return null;
    }

    const postContainer = this.createPostContainer();
    const post = this.createImageVideoPostInstance(postContainer, image, videoUrl);
    
    this.posts.set(image.id, post);
    this.postOrder.push(image.id);
    this.visibilityManager.observePost(postContainer, image.id);

    if (signal?.aborted) {
      return null;
    }

    // Set HQ mode if feed-level HD is enabled (mirroring regular marker behavior)
    if (this.useHDMode) {
      post.setHQMode(true);
    }

    this.setupLazyLoadingForImageVideo(postContainer, post, image, videoUrl, signal);
    return postContainer;
  }

  /**
   * Build the common options shared by all post constructors
   */
  private buildCommonPostOptions() {
    return {
      favoritesManager: this.favoritesManager,
      api: this.api,
      visibilityManager: this.visibilityManager,
      onPerformerChipClick: (performerId: number, performerName: string) => { this.handlePerformerChipClick(performerId, performerName); },
      onTagChipClick: (tagId: number, tagName: string) => { this.handleTagChipClick(tagId, tagName); },
      onStudioChipClick: (studioId: number, studioName: string) => { this.handleStudioChipClick(studioId, studioName); },
      showVerifiedCheckmarks: this.settings.showVerifiedCheckmarks !== false,
      showProductionAge: this.settings.showProductionAge === true,
      showStudioChips: this.settings.showStudioChips !== false,
      showSceneTitle: this.settings.showSceneTitle === true,
      showOCountButton: this.settings.showOCountButton !== false,
      showViewCountBadge: this.settings.showViewCountBadge !== false,
      showAddTagButton: this.settings.showAddTagButton !== false,
      ratingSystemConfig: this.ratingSystemConfig,
      reelMode: this.settings.reelMode === true,
      hdModeFromSettings: this.useHDMode,
      discoveryPanel: this.discoveryPanel,
      reelAutoScroll: this.settings.reelAutoScroll === true,
    };
  }

  /**
   * Create ImageVideoPost instance
   */
  private createImageVideoPostInstance(
    postContainer: HTMLElement,
    image: Image,
    videoUrl: string
  ): ImageVideoPost {
    const postData: ImageVideoPostData = {
      image,
      videoUrl,
      aspectRatio: image.aspectRatio ?? (image.width && image.height ? image.width / image.height : undefined),
    };

    const post = new ImageVideoPost(
      postContainer,
      postData,
      {
        ...this.buildCommonPostOptions(),
        onCancelRequests: () => this.cancelAllPendingRequests(),
        onMuteToggle: (isMuted: boolean) => this.setGlobalMuteState(isMuted),
        getGlobalMuteState: () => this.getGlobalMuteState(),
      }
    );

    post.initialize();
    
    return post;
  }

  /**
   * Create a synthetic SceneMarker from Image data
   * This allows MP4/M4V images to be displayed as VideoPost with full video controls
   */
  private createSyntheticMarkerFromImage(image: Image): SceneMarker {
    const markerId = `image-${image.id}`;
    const duration = image.visualFiles?.find(vf => vf.duration)?.duration ?? 0;
    
    // Create Scene object from Image data
    const scene: Scene = {
      id: `scene-${image.id}`,
      title: image.title,
      date: image.date,
      rating100: image.rating100,
      o_counter: image.o_counter,
      performers: image.performers,
      tags: image.tags,
      files: image.visualFiles?.map(vf => ({
        id: vf.path || `file-${image.id}`,
        path: vf.path || '',
        duration: vf.duration,
        video_codec: vf.video_codec,
        width: vf.width ?? image.width,
        height: vf.height ?? image.height,
      })),
      paths: image.paths,
    };

    return {
      id: markerId,
      title: image.title || 'Image Video',
      seconds: 0,
      end_seconds: duration > 0 ? duration : undefined,
      preview: image.paths?.preview,
      tags: image.tags,
      scene,
    };
  }

  /**
   * Try to get valid media URL from path
   */
  private tryGetValidMediaUrl(path: string | undefined, baseUrl: string): string | undefined {
    if (!path) return undefined;
    const url = buildFullUrl(path, baseUrl);
    return normalizeMediaUrl(url) ?? undefined;
  }

  /**
   * Get MP4 video URL for image post in HD mode
   */
  private getMp4VideoUrlForImageHD(image: Image, videoPath: string | undefined, baseUrl: string): string | undefined {
    if (videoPath && /^https?:\/\//i.test(videoPath)) {
      return this.tryGetValidMediaUrl(videoPath, baseUrl);
    }
    return this.tryGetValidMediaUrl(image.paths?.image, baseUrl);
  }

  /**
   * Get MP4 video URL for image post in non-HD mode
   */
  private getMp4VideoUrlForImageNonHD(image: Image, videoPath: string | undefined, baseUrl: string): string | undefined {
    const previewUrl = this.tryGetValidMediaUrl(image.paths?.preview, baseUrl);
    if (previewUrl) return previewUrl;
    // Fallback to MP4 video file only if it's a valid absolute URL
    if (videoPath && /^https?:\/\//i.test(videoPath)) {
      const videoUrl = this.tryGetValidMediaUrl(videoPath, baseUrl);
      if (videoUrl) return videoUrl;
    }
    // Fallback to Stash media endpoint
    return this.tryGetValidMediaUrl(image.paths?.image, baseUrl);
  }

  /**
   * Get MP4 video URL for image post
   */
  private getMp4VideoUrlForImage(image: Image, videoPath: string | undefined, baseUrl: string): string | undefined {
    return this.useHDMode
      ? this.getMp4VideoUrlForImageHD(image, videoPath, baseUrl)
      : this.getMp4VideoUrlForImageNonHD(image, videoPath, baseUrl);
  }

  /**
   * Get image URL for post
   * For MP4/M4V images: returns preview (non-HD) or full video (HD) based on useHDMode
   * For regular images: uses centralized utility
   */
  private getImageUrlForPost(image: Image): string | undefined {
    const baseUrl = globalThis.location.origin;
    
    // Detect if this is a video from visualFiles
    const { isVideo, videoFile } = detectVideoFromVisualFiles(image.visualFiles);
    
    const videoPath = videoFile?.path;
    // Check if this is a .m4v or .mp4 file (always treat as video, behavior controlled by HD mode)
    const isMp4Video = isVideo && videoPath && isMp4File(videoPath);
    
    if (isMp4Video) {
      const mp4Url = this.getMp4VideoUrlForImage(image, videoPath, baseUrl);
      if (mp4Url) {
        return mp4Url;
      }
    }
    
    // For regular images, use centralized utility (always treat MP4 as video)
    return getImageUrlForDisplay(image, true);
  }

  /**
   * Create image post instance
   */
  private createImagePostInstance(
    postContainer: HTMLElement,
    image: Image,
    imageUrl: string,
    onLoadFullVideo?: () => void
  ): ImagePost {
    const postData: ImagePostData = {
      image,
      imageUrl,
      aspectRatio: image.aspectRatio ?? (image.width && image.height ? image.width / image.height : undefined),
    };

    const post = new ImagePost(
      postContainer,
      postData,
      {
        ...this.buildCommonPostOptions(),
        onLoadFullVideo: undefined,
      }
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
      { root: this.getObserverRoot(), rootMargin: '200px' }
    );

    observer.observe(postContainer);
    this.loadObservers.set(image.id, observer);
  }

  /**
   * Setup lazy loading for image video post
   */
  private setupLazyLoadingForImageVideo(
    postContainer: HTMLElement,
    post: ImageVideoPost,
    image: Image,
    videoUrl: string,
    signal?: AbortSignal
  ): void {
    const rootMargin = this.getDesktopRootMargin(this.getLazyLoadDistance());
    this.createLazyLoadObserverForImageVideo(postContainer, post, image, rootMargin, signal);
  }

  /**
   * Create and setup intersection observer for lazy loading image videos
   */
  private createLazyLoadObserverForImageVideo(
    postContainer: HTMLElement,
    post: ImageVideoPost,
    image: Image,
    rootMargin: string,
    signal?: AbortSignal
  ): void {
    const loadObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this.handleImageVideoLoad(entry, post, image, loadObserver, signal);
          }
        }
      },
      { root: this.getObserverRoot(), rootMargin, threshold: 0 }
    );
    
    this.loadObservers.set(image.id, loadObserver);
    loadObserver.observe(postContainer);
    this.scheduleLazyLoadFallback(postContainer, rootMargin, () => {
      this.loadImageVideoPost(post, image, signal);
    }, signal);
  }

  /**
   * Handle image video loading when intersection observer triggers
   */
  private handleImageVideoLoad(
    entry: IntersectionObserverEntry,
    post: ImageVideoPost,
    image: Image,
    loadObserver: IntersectionObserver,
    signal?: AbortSignal
  ): void {
    this.loadImageVideoPost(post, image, signal, loadObserver);
  }

  /**
   * Initialize load state for video loading
   */
  private initializeLoadState(append: boolean): void {
    this.isLoading = true;
    this.hideError();
    if (!append) {
      // Clear all cached content when starting a new search/filter
      this.clearPosts();
      this.reelPlaybackStarted = false;
      this.markers = [];
      this.images = [];
      this.showSkeletonLoaders();
      this.currentPage = 1;
      this.hasMore = true;
      // Reset loaded counts when starting fresh
      this.markersLoadedCount = 0;
      this.shortFormLoadedCount = 0;
      this.imagesLoadedCount = 0;
      this.shortFormUnfilteredOffset = 0;
      this.markerPageSize = 0;
      this.imagePageSize = 0;
      if (this.appendRetryTimeoutId) {
        clearTimeout(this.appendRetryTimeoutId);
        this.appendRetryTimeoutId = undefined;
        this.appendRetryCount = 0;
      }
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
    const result = await this.api.fetchSceneMarkers({
      ...currentFilters,
      limit,
      offset,
    }, signal);
    
    // Update sortSeed in filters if returned
    if (result.sortSeed && currentFilters) {
      currentFilters.sortSeed = result.sortSeed;
    }

    return {
      ...result,
      markers: this.filterMarkersByExcludedTags(result.markers),
    };
  }

  /**
   * Prefetch poster images for markers
   */
  private prefetchPosters(markers: SceneMarker[], append: boolean, currentFilters: FilterOptions): void {
    if (this.isReelModeEnabled() && !this.reelPlaybackStarted) {
      return;
    }
    try {
      const baseCount = currentFilters.limit || FeedContainer.CONTENT_LOAD_LIMIT;
      const prefetchCount = this.isReelModeEnabled() ? Math.min(2, baseCount) : baseCount;
      posterPreloader.prefetchForMarkers(markers, prefetchCount);
    } catch (e) {
      console.warn('Poster prefetch failed', e);
    }
  }

  private async prefetchNextPagePosters(currentFilters: FilterOptions, shouldLoadMarkers: boolean): Promise<void> {
    if (this.isReelModeEnabled() || !shouldLoadMarkers) {
      return;
    }
    if (!this.hasMore) {
      return;
    }

    const limit = this.markerPageSize || currentFilters.limit || FeedContainer.CONTENT_LOAD_LIMIT;
    if (limit <= 0) {
      return;
    }

    const nextOffset = this.markersLoadedCount;
    const sortSeed = currentFilters.sortSeed ?? '';
    const key = `${nextOffset}:${limit}:${sortSeed}`;
    if (this.lastNextPagePosterPrefetchKey === key) {
      return;
    }

    this.lastNextPagePosterPrefetchKey = key;
    this.cancelNextPagePosterPrefetch();

    const controller = new AbortController();
    this.nextPagePosterPrefetchAbortController = controller;

    try {
      const result = await this.fetchMarkersForLoad(currentFilters, limit, nextOffset, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      if (result.markers.length > 0) {
        posterPreloader.prefetchForMarkers(result.markers, limit);
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        console.warn('Next page poster prefetch failed', e);
      }
    } finally {
      if (this.nextPagePosterPrefetchAbortController === controller) {
        this.nextPagePosterPrefetchAbortController = undefined;
      }
    }
  }

  /**
   * Handle empty markers result
   */
  private handleEmptyMarkers(append: boolean): void {
    if (append) {
      this.scheduleAppendRetry();
    } else {
      this.showError("It's empty");
    }
    this.hideSkeletonLoaders();
  }

  /**
   * Finalize load state after rendering
   */
  private finalizeLoadState(append: boolean, page: number): void {
    this.appendRetryCount = 0;
    if (append) {
      this.currentPage = page;
    }

    if (!append) {
      this.hideSkeletonLoaders();
    }

    this.updateInfiniteScrollTrigger();

    if (!append) {
      this.refreshAutoplayAfterLayout();
      this.warmStartPreloads();
    }

    if (this.settings.backgroundPreloadEnabled && this.posts.size > 0) {
      this.startBackgroundPreloading();
    }

    this.ensureVisiblePostsLoaded();
  }

  private warmStartPreloads(): void {
    return;
  }

  /**
   * Handle load error
   */
  private handleLoadError(error: unknown, append: boolean): void {
    console.error('Error loading scene markers:', error);
    if (append) {
      this.scheduleAppendRetry();
    } else {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.showError(`Failed to load scene markers: ${errorMessage}`);
    }
    this.hideSkeletonLoaders();
  }

  private readonly MAX_APPEND_RETRIES = 3;

  private scheduleAppendRetry(): void {
    if (this.appendRetryCount >= this.MAX_APPEND_RETRIES) return;
    this.appendRetryCount++;
    this.appendRetryTimeoutId = setTimeout(() => {
      this.appendRetryTimeoutId = undefined;
      this.hasMore = true;
      this.loadVideos(undefined, true).catch((err) => {
        console.error('Error on append retry:', err);
      });
    }, 1500);
  }

  /**
   * Defer setting isLoading to false to prevent rapid successive loads
   */



  /**
   * Refresh the entire feed by clearing all posts and reloading from the beginning
   */
  async refreshFeed(): Promise<void> {
    // Clear all existing posts and DOM
    this.clearPosts();

    // Recreate load more trigger
    if (this.loadMoreTrigger && this.postsContainer) {
      this.postsContainer.appendChild(this.loadMoreTrigger);
    }
    
    // Scroll to top
    this.scrollToTop();
    
    // Reset pagination state
    this.currentPage = 1;
    this.hasMore = true;
    this.markers = [];
    this.images = [];
    this.markersLoadedCount = 0;
    this.shortFormLoadedCount = 0;
    this.imagesLoadedCount = 0;
    this.shortFormUnfilteredOffset = 0;
    this.markerPageSize = 0;
    this.imagePageSize = 0;
    this.appendRetryCount = 0;
    if (this.appendRetryTimeoutId) {
      clearTimeout(this.appendRetryTimeoutId);
      this.appendRetryTimeoutId = undefined;
    }
    
    // Reload feed with current filters
    await this.loadVideos(this.currentFilters, false, undefined, true);
  }

  /**
   * Determine what content types should be loaded
   */
  private determineContentLoadingFlags(filters?: FilterOptions): {
    shouldLoadMarkers: boolean;
    shouldLoadImages: boolean;
    shouldLoadShortForm: boolean;
    shouldLoadRandom: boolean;
  } {
    // Use provided filters or fall back to currentFilters
    const activeFilters = filters || this.currentFilters || {};
    
    // When using saved filters (marker-specific), only load markers
    // Saved filters are only for markers, so don't show other content types
    const isUsingSavedFilter = !!(activeFilters.savedFilterId);
    
    if (isUsingSavedFilter) {
      return {
        shouldLoadMarkers: true,
        shouldLoadImages: false,
        shouldLoadShortForm: false,
        shouldLoadRandom: false
      };
    }
    
    const shortFormEnabledForCurrentMode = this.shouldLoadShortFormContent();
    const shouldLoadShortForm = shortFormEnabledForCurrentMode;
    const shouldLoadMarkers = this.settings.includeMarkersInFeed !== false;
    const shouldLoadImages = this.shouldLoadImages();
    const shouldLoadRandom = this.settings.includeRandomInFeed === true;

    return {
      shouldLoadMarkers,
      shouldLoadImages,
      shouldLoadShortForm,
      shouldLoadRandom
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
    if (shouldLoadMarkers && shouldLoadShortForm) {
      return {
        markerLimit: limit,
        shortFormLimit: limit
      };
    }
    
    return {
      markerLimit: shouldLoadMarkers ? limit : 0,
      shortFormLimit: shouldLoadShortForm ? limit : 0
    };
  }

  /**
   * Calculate pagination parameters for content loading
   */
  private calculatePaginationForContent(
    append: boolean,
    markerLimit: number,
    limit: number
  ): { markerPageSize: number; imagePageSize: number } {
    // For markers and images: Use consistent page size (track the first limit used)
    // This prevents wrong page calculations when limit changes between initial and subsequent loads
    if (!append) {
      // Store the page sizes used for first load
      this.markerPageSize = markerLimit;
      this.imagePageSize = limit;
    }
    
    // Use stored page sizes for consistent pagination, or current limit if not set
    return {
      markerPageSize: this.markerPageSize || markerLimit,
      imagePageSize: this.imagePageSize || limit
    };
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
      shouldLoadRandom: boolean;
    };
    append: boolean;
  }): Promise<{
    markers: SceneMarker[];
    images: Image[];
    shortFormMarkers: SceneMarker[];
    randomMarkers: SceneMarker[];
    markerCount: number;
    imageCount: number;
    shortFormCount: number;
    randomCount: number;
  }> {
    const { currentFilters, limits, signal, loadingFlags, append } = options;
    const { limit, markerLimit, shortFormLimit } = limits;
    const { shouldLoadMarkers, shouldLoadImages, shouldLoadShortForm, shouldLoadRandom } = loadingFlags;

    this.ensureSortSeed(currentFilters);

    const { markerPageSize, imagePageSize } = this.calculatePaginationForContent(append, markerLimit, limit);
    const { markerOffset, imageOffset, shortFormOffset } = this.getLoadOffsets(append);

    const fetchStart = performance.now();
    const [markersResult, imagesResult, shortFormResult, randomResult] = await Promise.all([
      this.fetchMarkersIfNeeded({ currentFilters, markerPageSize, markerOffset, signal, shouldLoadMarkers }),
      this.fetchImagesIfNeeded({ currentFilters, imagePageSize, imageOffset, signal, shouldLoadImages }),
      this.fetchShortFormIfNeeded({ currentFilters, shortFormLimit, shortFormOffset, signal, shouldLoadShortForm }),
      this.fetchRandomIfNeeded({ currentFilters, limit, signal, shouldLoadRandom })
    ]);
    const fetchDuration = performance.now() - fetchStart;

    this.logFetchedContentResults({
      shouldLoadMarkers,
      shouldLoadShortForm,
      shouldLoadImages,
      markerLimit,
      shortFormLimit,
      limit,
      markersResult,
      shortFormResult,
      imagesResult,
      fetchDuration
    });

    this.updateShortFormOffsetIfNeeded(shouldLoadShortForm, append, shortFormResult);

    return {
      markers: markersResult.markers,
      images: imagesResult.images,
      shortFormMarkers: shortFormResult.markers,
      randomMarkers: randomResult.markers,
      markerCount: markersResult.totalCount,
      imageCount: imagesResult.totalCount,
      shortFormCount: shortFormResult.totalCount,
      randomCount: randomResult.totalCount,
    };
  }

  private ensureSortSeed(filters: FilterOptions): void {
    if (!filters.sortSeed) {
      filters.sortSeed = generateRandomSortSeed();
    }
  }

  private getLoadOffsets(append: boolean): {
    markerOffset: number;
    imageOffset: number;
    shortFormOffset: number;
  } {
    return {
      markerOffset: append ? this.markersLoadedCount : 0,
      imageOffset: append ? this.imagesLoadedCount : 0,
      shortFormOffset: append ? this.shortFormUnfilteredOffset : 0
    };
  }

  private async fetchMarkersIfNeeded(options: {
    currentFilters: FilterOptions;
    markerPageSize: number;
    markerOffset: number;
    signal: AbortSignal | undefined;
    shouldLoadMarkers: boolean;
  }): Promise<{ markers: SceneMarker[]; totalCount: number }> {
    const { currentFilters, markerPageSize, markerOffset, signal, shouldLoadMarkers } = options;
    if (!shouldLoadMarkers) {
      return { markers: [], totalCount: 0 };
    }
    return this.fetchMarkersForLoad(currentFilters, markerPageSize, markerOffset, signal);
  }

  private async fetchImagesIfNeeded(options: {
    currentFilters: FilterOptions;
    imagePageSize: number;
    imageOffset: number;
    signal: AbortSignal | undefined;
    shouldLoadImages: boolean;
  }): Promise<{ images: Image[]; totalCount: number }> {
    const { currentFilters, imagePageSize, imageOffset, signal, shouldLoadImages } = options;
    if (!shouldLoadImages) {
      return { images: [], totalCount: 0 };
    }
    return this.loadImages(currentFilters, imagePageSize, imageOffset, signal);
  }

  private async fetchShortFormIfNeeded(options: {
    currentFilters: FilterOptions;
    shortFormLimit: number;
    shortFormOffset: number;
    signal: AbortSignal | undefined;
    shouldLoadShortForm: boolean;
  }): Promise<{ markers: SceneMarker[]; totalCount: number; unfilteredOffsetConsumed?: number }> {
    const { currentFilters, shortFormLimit, shortFormOffset, signal, shouldLoadShortForm } = options;
    if (!shouldLoadShortForm) {
      return { markers: [], totalCount: 0, unfilteredOffsetConsumed: 0 };
    }
    return this.fetchShortFormVideosForLoad(currentFilters, shortFormLimit, shortFormOffset, signal);
  }

  private async fetchRandomIfNeeded(options: {
    currentFilters: FilterOptions;
    limit: number;
    signal: AbortSignal | undefined;
    shouldLoadRandom: boolean;
  }): Promise<{ markers: SceneMarker[]; totalCount: number }> {
    const { currentFilters, limit, signal, shouldLoadRandom } = options;
    if (!shouldLoadRandom) {
      return { markers: [], totalCount: 0 };
    }
    return this.fetchRandomScenesForLoad(currentFilters, limit, signal);
  }

  private async fetchRandomScenesForLoad(
    currentFilters: FilterOptions,
    limit: number,
    signal?: AbortSignal
  ): Promise<{ markers: SceneMarker[]; totalCount: number }> {
    if (!this.api) {
      return { markers: [], totalCount: 0 };
    }
    const filters: FilterOptions = {
      ...currentFilters,
      limit,
      shuffleMode: true,
      includeScenesWithoutMarkers: !this.settings.randomIncludeScenesWithMarkers
    };
    const result = await this.api.fetchSceneMarkers(filters, signal);
    return {
      markers: this.filterMarkersByExcludedTags(result.markers),
      totalCount: result.totalCount
    };
  }

  private updateShortFormOffsetIfNeeded(
    shouldLoadShortForm: boolean,
    append: boolean,
    shortFormResult: { unfilteredOffsetConsumed?: number }
  ): void {
    if (!shouldLoadShortForm) {
      return;
    }
    this.updateShortFormUnfilteredOffset(append, shortFormResult);
  }

  private logFetchedContentResults(options: {
    shouldLoadMarkers: boolean;
    shouldLoadShortForm: boolean;
    shouldLoadImages: boolean;
    markerLimit: number;
    shortFormLimit: number;
    limit: number;
    markersResult: { markers: SceneMarker[]; totalCount: number };
    shortFormResult: { markers: SceneMarker[]; totalCount: number };
    imagesResult: { images: Image[]; totalCount: number };
    fetchDuration: number;
  }): void {
    const {
      shouldLoadMarkers,
      shouldLoadShortForm,
      shouldLoadImages,
      markerLimit,
      shortFormLimit,
      limit,
      markersResult,
      shortFormResult,
      imagesResult,
      fetchDuration
    } = options;

    const ms = fetchDuration.toFixed(0);
    if (shouldLoadMarkers) {
      console.log(`[Load] Fetched ${markersResult.markers.length} markers (limit: ${markerLimit}, total: ${markersResult.totalCount}) in ${ms}ms`);
    }
    if (shouldLoadShortForm) {
      console.log(`[Load] Fetched ${shortFormResult.markers.length} short-form markers (limit: ${shortFormLimit}, total: ${shortFormResult.totalCount}) in ${ms}ms`);
    }
    if (shouldLoadImages) {
      console.log(`[Load] Fetched ${imagesResult.images.length} images (limit: ${limit}, total: ${imagesResult.totalCount}) in ${ms}ms`);
    }
  }

  private updateShortFormUnfilteredOffset(
    append: boolean,
    shortFormResult: { unfilteredOffsetConsumed?: number }
  ): void {
    const unfilteredOffsetConsumed = shortFormResult.unfilteredOffsetConsumed;
    if (typeof unfilteredOffsetConsumed !== 'number') {
      return;
    }

    const scenesPerPage = 24;
    if (append) {
      const page = Math.floor(this.shortFormUnfilteredOffset / scenesPerPage) + 1;
      this.shortFormUnfilteredOffset = (page - 1) * scenesPerPage + unfilteredOffsetConsumed;
      return;
    }

    this.shortFormUnfilteredOffset = unfilteredOffsetConsumed;
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
    shouldLoadRandom?: boolean;
    realMarkersCount?: number;
    realShortFormCount?: number;
  }): Promise<Array<{ type: 'marker' | 'image'; data: SceneMarker | Image; date?: string }>> {
    const { content, counts, currentFilters, offset, append, shouldLoadMarkers, shouldLoadRandom, realMarkersCount, realShortFormCount } = options;
    const { markers, shortFormMarkers, images } = content;
    const { markerCount, shortFormCount, imageCount } = counts;

    // Merge regular markers, short-form markers, and images, then filter seen items
    const mergedContent = this.filterSeenContent(this.mergeMarkersShortFormAndImages(markers, shortFormMarkers, images), append);

    const expectedLimit = currentFilters.limit || FeedContainer.CONTENT_LOAD_LIMIT;

    // Use real (non-synthetic) counts for pagination offsets so random markers
    // don't inflate markersLoadedCount and push regular marker queries past the pool.
    const trackableMarkers = realMarkersCount ?? markers.length;
    const trackableShortForm = realShortFormCount ?? shortFormMarkers.length;

    // Track loaded counts for each content type separately
    if (append) {
      this.markersLoadedCount += trackableMarkers;
      this.shortFormLoadedCount += trackableShortForm;
      this.imagesLoadedCount += images.length;
    } else {
      // Reset counts when starting fresh
      this.markersLoadedCount = trackableMarkers;
      this.shortFormLoadedCount = trackableShortForm;
      this.imagesLoadedCount = images.length;
    }
    
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
        totalContentLength: markers.length + shortFormMarkers.length + images.length
      },
      shouldLoadMarkers,
      shouldLoadRandom,
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

    this.hideError();

    if (shouldLoadMarkers && allMarkers.length > 0) {
      this.prefetchPosters(allMarkers, append, currentFilters);
    }

    // Pre-warm discovery cache with performers from this batch
    if (this.discoveryManager) {
      const performers = mergedContent.flatMap(item => {
        if (item.type === 'marker') return (item.data as SceneMarker).scene.performers ?? [];
        return (item.data as Image).performers ?? [];
      });
      this.discoveryManager.prefetch(performers);
    }

    const renderChunkSize = 6;
    const renderDelay = 8;
    await this.renderPostsProgressively(mergedContent, append, signal, renderChunkSize, renderDelay);

    if (this.checkAbortAndCleanup(signal)) {
      return;
    }

    this.cleanupDistantPosts();
    this.finalizeLoadState(append, page);
  }

  async loadVideos(filters?: FilterOptions, append: boolean = false, signal?: AbortSignal, force: boolean = false): Promise<void> {
    if (!force && this.isLoading) {
      return;
    }

    signal = this.prepareLoadVideos(signal);
    this.initializeLoadState(append);
    const reqId = ++this.latestLoadId;

    try {
      const currentFilters = filters || this.currentFilters || {};
      await this.updateExcludedTagIds();
      this.applyExcludedTagsToFilters(currentFilters);
      this.applyOrientationFilterToFilters(currentFilters);
      const { limit, offset, page } = this.calculatePaginationParams(currentFilters, append);

      if (this.checkAbortAndCleanup(signal)) {
        return;
      }

      const { shouldLoadMarkers, shouldLoadImages, shouldLoadShortForm, shouldLoadRandom } = this.determineContentLoadingFlags(currentFilters);

      // Calculate limits (simple split when both markers and shortform are enabled)
      const limits = this.calculateContentLimits(limit, shouldLoadMarkers, shouldLoadShortForm);
      const markerLimit = limits.markerLimit;
      const shortFormLimit = limits.shortFormLimit;

      // Debug logging for short-form content
      this.logShortFormSettings(shouldLoadShortForm);

      const {
        markers,
        images,
        shortFormMarkers,
        randomMarkers,
        markerCount,
        imageCount,
        shortFormCount,
        randomCount,
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
          shouldLoadShortForm,
          shouldLoadRandom
        },
        append
      });

      // Store currentFilters (with sortSeed) back to this.currentFilters for pagination persistence
      this.currentFilters = currentFilters;

      if (reqId !== this.latestLoadId || this.checkAbortAndCleanup(signal)) {
        return;
      }

      const allMarkersForContent = this.shuffleArray([...markers, ...shortFormMarkers, ...randomMarkers]);
      const mergedContent = await this.processFetchedContent({
        content: {
          markers: allMarkersForContent,
          shortFormMarkers: [],
          images
        },
        counts: {
          markerCount: markerCount + randomCount,
          shortFormCount,
          imageCount
        },
        // Track only real markers/shortform for pagination offsets — random synthetic
        // markers don't paginate and must not inflate markersLoadedCount.
        realMarkersCount: markers.length,
        realShortFormCount: shortFormMarkers.length,
        currentFilters,
        offset,
        append,
        shouldLoadMarkers: shouldLoadMarkers || shouldLoadRandom,
        shouldLoadRandom
      });

      const totalUnfiltered = markers.length + shortFormMarkers.length + randomMarkers.length + images.length;
      if (totalUnfiltered > 0 && mergedContent.length === 0 && append && this.seenSkipCount < 10) {
        this.currentPage = page;
        this.seenSkipCount++;
        this.deferAutoAdvance();
        return;
      }
      if (mergedContent.length > 0) {
        this.seenSkipCount = 0;
      }

      await this.renderAndFinalizeContent(
        mergedContent,
        allMarkersForContent,
        shouldLoadMarkers || shouldLoadRandom,
        currentFilters,
        append,
        signal,
        page
      );

      void this.prefetchNextPagePosters(currentFilters, shouldLoadMarkers || shouldLoadRandom);
    } catch (error: unknown) {
      this.handleLoadError(error, append);
    } finally {
      this.isLoading = false;
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
    
    // Process images - always replace to clear old cached images
    this.images = images;
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
    counts: { markerCount: number; shortFormCount: number; imageCount: number },
    shouldLoadRandom: boolean = false
  ): void {
    const { markerCount, shortFormCount, imageCount } = counts;
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

    // Random content is re-queryable at new positions on every fetch — treat as infinite
    // as long as this fetch returned something. The 0-results guard below is the real stop.
    if (shouldLoadRandom && !this.hasMore && totalContentLength > 0) {
      this.hasMore = true;
      console.log(`[hasMore] Random mode active with results — keeping hasMore true`);
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
    shouldLoadRandom?: boolean;
    append: boolean;
  }): void {
    const {
      content: { markers, images },
      counts: { markerCount, shortFormCount, imageCount },
      pagination: { offset, expectedLimit, totalContentLength },
      shouldLoadMarkers,
      shouldLoadRandom,
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
      images,
      shouldLoadRandom
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
    shouldLoadRandom?: boolean;
  }): void {
    const { pagination, counts, images, shouldLoadRandom } = options;
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
        { markerCount, shortFormCount, imageCount },
        shouldLoadRandom ?? false
      );
    }
  }

  /**
   * Check if images should be loaded
   */
  private shouldLoadImages(): boolean {
    const imagesEnabled = this.settings.includeImagesInFeed ?? true;
    const hasFileTypes = (this.settings.enabledFileTypes?.length ?? 0) > 0;
    return imagesEnabled && hasFileTypes;
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
    // Log short-form content settings for debugging
    this.shouldLoadShortFormContent();
  }

  /**
   * Fetch short-form videos for loading
   */
  private async fetchShortFormVideosForLoad(
    currentFilters: FilterOptions,
    limit: number,
    offset: number,
    signal?: AbortSignal
  ): Promise<{ markers: SceneMarker[]; totalCount: number; unfilteredOffsetConsumed: number }> {
    if (!this.api) {
      return { markers: [], totalCount: 0, unfilteredOffsetConsumed: 0 };
    }

    const maxDuration = this.settings.shortFormMaxDuration || 120;
    const result = await this.api.fetchShortFormVideos(
      currentFilters,
      maxDuration,
      limit,
      offset,
      signal
    );
    
    // Update sortSeed in filters if returned
    if (result.sortSeed && currentFilters) {
      currentFilters.sortSeed = result.sortSeed;
    }

    return {
      ...result,
      markers: this.filterMarkersByExcludedTags(result.markers),
    };
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
      const fileExtensions = this.settings.enabledFileTypes || ['.jpg', '.png', '.gif', '.mp4', '.m4v', '.webm'];
      
      // Use unified filter extraction for consistent filtering
      const { tagIds, performerIds, excludedTagIds, studioIds } = this.api.extractTagAndPerformerFilters(filters);

      const imageFilters: {
        performerIds?: number[];
        tagIds?: string[];
        excludedTagIds?: string[];
        studioIds?: string[];
        studioDepth?: number;
      } = {};

      if (performerIds.length > 0) {
        imageFilters.performerIds = performerIds;
      }

      if (tagIds.length > 0) {
        imageFilters.tagIds = tagIds;
      }

      if (excludedTagIds.length > 0) {
        imageFilters.excludedTagIds = excludedTagIds;
      }

      if (studioIds.length > 0) {
        imageFilters.studioIds = studioIds;
      }

      imageFilters.studioDepth = this.settings.includeSubtags ? -1 : 0;

      const imageFiltersWithOrientation = {
        ...imageFilters,
        ...(filters.orientationFilter && filters.orientationFilter.length > 0
          ? { orientationFilter: filters.orientationFilter }
          : {}),
        ...(filters.sortSeed ? { sortSeed: filters.sortSeed } : {}),
        ...(this.settings.imagesInGalleryOnly
          ? { imagesInGalleryOnly: true, galleryIds: this.settings.galleryIds ?? [] }
          : {}),
      };

      const { images: graphQLImages, totalCount, sortSeed } = await this.api.findImages(
        fileExtensions,
        Object.keys(imageFiltersWithOrientation).length > 0 ? imageFiltersWithOrientation : undefined,
        limit,
        offset,
        signal
      );
      
      // Store the sort seed back in filters for pagination (if it was generated)
      if (sortSeed && filters) {
        filters.sortSeed = sortSeed;
      }

      // Convert GraphQL Image to simplified Image type
      const images = this.filterImagesByExcludedTags(
        graphQLImages.map((img) => this.convertGraphQLImageToImage(img))
      );
      return { images, totalCount };
    } catch (error) {
      console.error('FeedContainer: Failed to load images', error);
      return { images: [], totalCount: 0 };
    }
  }

  /**
   * Convert GraphQL Image to simplified Image type
   */
  private convertGraphQLImageToImage(graphqlImage: GQLImage): Image {
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
      studio: graphqlImage.studio,
      tags: graphqlImage.tags,
      performers: graphqlImage.performers?.map(p => ({
        id: p.id,
        name: p.name,
        image_path: p.image_path,
        favorite: p.favorite,
        stash_ids: p.stash_ids,
      })),
      visualFiles: graphqlImage.visual_files?.map(vf => ({
        path: vf.path,
        video_codec: vf.video_codec,
        duration: vf.duration,
        width: (vf as { width?: number }).width,
        height: (vf as { height?: number }).height,
      })),
    };
  }

  private shuffleArray<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
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
   * Simple interleaving algorithm that mixes markers, shortform, and images
   * Shows 3-5 video items (markers/shortform), then 1-2 images, repeat
   * Prevents more than 3 consecutive items of the same type
   */
  private unifiedMixContent(
    markers: SceneMarker[],
    shortFormMarkers: SceneMarker[],
    images: Image[]
  ): Array<{ type: 'marker' | 'image'; data: SceneMarker | Image; date?: string }> {
    const content: Array<{ type: 'marker' | 'image'; data: SceneMarker | Image; date?: string }> = [];
    
    // Combine markers and shortform into single video array for simpler logic
    const allVideos = [...markers.map(m => ({ type: 'marker' as const, data: m })), ...shortFormMarkers.map(m => ({ type: 'marker' as const, data: m }))];
    
    const state = {
      videoIdx: 0,
      imageIdx: 0,
      consecutiveCount: 0,
      lastType: null as ContentType | null,
      maxConsecutive: 3,
    };
    
    while (state.videoIdx < allVideos.length || state.imageIdx < images.length) {
      // Determine chunk sizes: 3-5 videos, then 1-2 images
      const videoChunkSize = 3 + Math.floor(Math.random() * 3); // 3-5
      const imageChunkSize = 1 + Math.floor(Math.random() * 2); // 1-2
      
      // Add video chunk
      this.addVideoChunk(content, allVideos, videoChunkSize, state);
      
      // Add image chunk
      this.addImageChunk(content, images, imageChunkSize, state);
      
      // If we've run out of one type, add remaining of the other
      this.addRemainingItems(content, allVideos, images, state);
    }
    
    return content;
  }

  /**
   * Add a chunk of video items to the content array
   */
  private addVideoChunk(
    content: Array<{ type: 'marker' | 'image'; data: SceneMarker | Image; date?: string }>,
    allVideos: Array<{ type: 'marker'; data: SceneMarker }>,
    chunkSize: number,
    state: { videoIdx: number; consecutiveCount: number; lastType: ContentType | null; maxConsecutive: number }
  ): void {
    for (let i = 0; i < chunkSize && state.videoIdx < allVideos.length; i++) {
      const video = allVideos[state.videoIdx++];
      if (!video) continue;

      content.push({
        type: 'marker',
        data: video.data,
        date: video.data.scene.date,
      });
      
      // Track consecutive count
      if (state.lastType === 'marker') {
        state.consecutiveCount++;
        if (state.consecutiveCount >= state.maxConsecutive) {
          break; // Switch to images
        }
      } else {
        state.consecutiveCount = 1;
        state.lastType = 'marker';
      }
    }
  }

  /**
   * Add a chunk of image items to the content array
   */
  private addImageChunk(
    content: Array<{ type: 'marker' | 'image'; data: SceneMarker | Image; date?: string }>,
    images: Image[],
    chunkSize: number,
    state: { imageIdx: number; consecutiveCount: number; lastType: ContentType | null }
  ): void {
    for (let i = 0; i < chunkSize && state.imageIdx < images.length; i++) {
      const image = images[state.imageIdx++];
      if (!image) continue;

      content.push({
        type: 'image',
        data: image,
        date: image.date,
      });
      
      if (state.lastType === 'image') {
        state.consecutiveCount++;
      } else {
        state.consecutiveCount = 1;
        state.lastType = 'image';
      }
    }
  }

  /**
   * Add remaining items when one type has been exhausted
   */
  private addRemainingItems(
    content: Array<{ type: 'marker' | 'image'; data: SceneMarker | Image; date?: string }>,
    allVideos: Array<{ type: 'marker'; data: SceneMarker }>,
    images: Image[],
    state: { videoIdx: number; imageIdx: number }
  ): void {
    if (state.videoIdx >= allVideos.length && state.imageIdx < images.length) {
      while (state.imageIdx < images.length) {
        const image = images[state.imageIdx++];
        if (image) {
          content.push({
            type: 'image',
            data: image,
            date: image.date,
          });
        }
      }
    } else if (state.imageIdx >= images.length && state.videoIdx < allVideos.length) {
      while (state.videoIdx < allVideos.length) {
        const video = allVideos[state.videoIdx++];
        if (video) {
          content.push({
            type: 'marker',
            data: video.data,
            date: video.data.scene.date,
          });
        }
      }
    }
  }

  /**
   * Check if browser supports the video codec/format
   * Returns true if supported, false if not
   */
  private static readonly HEVC_MIME_TYPES = [
    'video/mp4; codecs="hev1.1.6.L93.B0,mp4a.40.2"',
    'video/mp4; codecs="hvc1.1.6.L93.B0,mp4a.40.2"',
    'video/mp4; codecs="hev1"',
    'video/mp4; codecs="hvc1"',
  ] as const;

  private static readonly MATROSKA_MIME_TYPES = [
    'video/x-matroska',
    'video/mkv',
  ] as const;

  private static canPlayAny(video: HTMLVideoElement, mimeTypes: readonly string[]): boolean {
    return mimeTypes.some(type => {
      const result = video.canPlayType(type);
      return result && result.length > 0;
    });
  }

  private isVideoCodecSupported(marker: SceneMarker, videoUrl: string): boolean {
    const firstFile = marker.scene?.files?.[0];
    if (firstFile) {
      const videoCodec = firstFile.video_codec?.toLowerCase() || '';
      const isHevc = videoCodec.includes('hevc') || videoCodec.includes('h.265') || videoCodec.includes('h265');
      if (isHevc) {
        const testVideo = document.createElement('video');
        if (!FeedContainer.canPlayAny(testVideo, FeedContainer.HEVC_MIME_TYPES)) {
          return false;
        }
      }
    }

    const lowerUrl = videoUrl.toLowerCase();
    if (lowerUrl.includes('.mkv') || lowerUrl.includes('matroska')) {
      const testVideo = document.createElement('video');
      if (!FeedContainer.canPlayAny(testVideo, FeedContainer.MATROSKA_MIME_TYPES)) {
        return false;
      }
    }

    return true;
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
    this.cancelNextPagePosterPrefetch();
    // Also stop any loading videos
    this.stopLoadingVideos();
  }

  private cancelNextPagePosterPrefetch(): void {
    if (this.nextPagePosterPrefetchAbortController) {
      this.nextPagePosterPrefetchAbortController.abort();
      this.nextPagePosterPrefetchAbortController = undefined;
    }
    this.lastNextPagePosterPrefetchKey = undefined;
  }

  /**
   * Stop video elements that are currently loading
   */
  private stopLoadingVideos(): void {
    for (const [, post] of this.posts.entries()) {
      const player = post.getPlayer();
      if (isNativeVideoPlayer(player)) {
        this.cancelVideoLoad(player.getVideoElement());
      }
    }
  }

  private cancelVideoLoad(video: HTMLVideoElement): void {
    if (video.networkState !== 2 && video.readyState >= 2) return;
    try {
      video.pause();
      video.removeAttribute('src');
      video.load();
    } catch {
      // Non-critical: video stopping errors are safe to ignore
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
    
    const normalizedUrl = normalizeMediaUrl(selectedUrl);
    if (!normalizedUrl) {
      console.warn('FeedContainer: Skipping post creation - no valid video URL', {
        markerId: marker.id,
        markerTitle: marker.title,
        videoUrl: selectedUrl,
      });
      return undefined;
    }
    
    return normalizedUrl;
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

    return marker.seconds;
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
      endTime: marker.end_seconds ?? (marker.seconds + 20),
    };

    const post = new VideoPost(
      postContainer,
      postData,
      {
        ...this.buildCommonPostOptions(),
        useShuffleMode: typeof marker.id === 'string' && marker.id.startsWith('synthetic-'),
        onCancelRequests: () => this.cancelAllPendingRequests(),
        onMuteToggle: (isMuted: boolean) => this.setGlobalMuteState(isMuted),
        getGlobalMuteState: () => this.getGlobalMuteState(),
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
    const rootMargin = this.getDesktopRootMargin(this.getLazyLoadDistance());
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
      { root: this.getObserverRoot(), rootMargin, threshold: 0 }
    );
    
    this.loadObservers.set(marker.id, loadObserver);
    loadObserver.observe(postContainer);
    this.scheduleLazyLoadFallback(postContainer, rootMargin, () => {
      this.loadVideoPost(post, marker, signal);
    }, signal);
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
    if (this.isReelModeEnabled()) {
      const reelWindow = this.getReelActiveWindowPostIds();
      if (!reelWindow.has(marker.id)) {
        return;
      }
    }
    this.loadVideoPost(post, marker, signal, loadObserver);
  }

  private loadImageVideoPost(
    post: ImageVideoPost,
    image: Image,
    signal?: AbortSignal,
    loadObserver?: IntersectionObserver
  ): void {
    const container = post.getContainer();
    if (this.isReelModeEnabled()) {
      const reelWindow = this.getReelActiveWindowPostIds();
      if (!reelWindow.has(image.id)) {
        return;
      }
    }
    if (signal?.aborted && !container.isConnected) {
      loadObserver?.disconnect();
      this.loadObservers.delete(image.id);
      return;
    }

    if (post.isPlayerLoaded()) {
      loadObserver?.disconnect();
      this.loadObservers.delete(image.id);
      return;
    }

    const player = post.preload();
    if (isNativeVideoPlayer(player)) {
      this.visibilityManager.registerPlayer(image.id, player);
    } else {
      console.warn('FeedContainer: Player not created, hiding post', { imageId: image.id });
      post.hidePost();
    }

    loadObserver?.disconnect();
    this.loadObservers.delete(image.id);
  }

  private loadVideoPost(
    post: VideoPost,
    marker: SceneMarker,
    signal?: AbortSignal,
    loadObserver?: IntersectionObserver
  ): void {
    const container = post.getContainer();
    if (this.isReelModeEnabled()) {
      const reelWindow = this.getReelActiveWindowPostIds();
      if (!reelWindow.has(marker.id)) {
        return;
      }
    }
    if (signal?.aborted && !container.isConnected) {
      loadObserver?.disconnect();
      this.loadObservers.delete(marker.id);
      return;
    }

    if (post.isPlayerLoaded()) {
      loadObserver?.disconnect();
      this.loadObservers.delete(marker.id);
      return;
    }

    const player = post.preload();
    if (isNativeVideoPlayer(player)) {
      this.visibilityManager.registerPlayer(marker.id, player);
    } else {
      console.warn('FeedContainer: Player not created, hiding post', { markerId: marker.id });
      post.hidePost();
    }

    loadObserver?.disconnect();
    this.loadObservers.delete(marker.id);
  }

  private scheduleLazyLoadFallback(
    postContainer: HTMLElement,
    rootMargin: string,
    loadHandler: () => void,
    signal?: AbortSignal
  ): void {
    const marginPx = this.parseRootMarginToPx(rootMargin);
    const check = () => {
      if (signal?.aborted && !postContainer.isConnected) {
        return;
      }
      if (!postContainer.isConnected) {
        return;
      }
      if (this.isElementWithinLazyLoadRange(postContainer, marginPx)) {
        loadHandler();
      }
    };

    const requestFrame = globalThis.requestAnimationFrame?.bind(globalThis) ?? ((cb: FrameRequestCallback) => setTimeout(cb, 16));
    requestFrame(() => requestFrame(check));
  }


  /**
   * Clear all posts
   */
  private clearPosts(): void {
    // Stop background preloading
    this.stopBackgroundPreloading();
    posterPreloader.cancelInflight();
    this.cancelNextPagePosterPrefetch();
    
    for (const [postId, post] of this.posts.entries()) {
      if (this.visibilityManager) {
        this.visibilityManager.unobservePost(postId);
      }
      post.destroy();
    }
    this.posts.clear();
    this.postOrder = [];
    this.activePreloadPosts.clear();
    this.reelNextPreloadIds.clear();
    this.reelPlaybackStarted = false;
    this.backgroundPreloadPriorityQueue = [];
    this.currentlyPreloadingCount = 0;
    if (this.postsContainer) {
      this.postsContainer.innerHTML = '';
    }
    
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

    this.resetScrollObserver();
  }

  private resetScrollObserver(): void {
    if (!this.loadMoreTrigger) {
      return;
    }

    if (this.scrollObserver) {
      this.scrollObserver.disconnect();
    }

    // Use Intersection Observer to detect when trigger is visible
    const rootMargin = '600px';
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
        root: this.getObserverRoot(),
        rootMargin,
        threshold: 0.1,
      }
    );

    this.scrollObserver.observe(this.loadMoreTrigger);
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

  private getPerformersForPost(postId: string) {
    const post = this.posts.get(postId);
    return post?.getPerformers() ?? [];
  }

  private handleReelPlaybackStarted(postId: string): void {
    if (!this.isReelModeEnabled()) {
      return;
    }
    this.reelPlaybackStarted = true;
    this.preloadNextReelPosts(postId);
  }

  private shouldSkipReelPreload(post: PostType | undefined, nextId: string): boolean {
    if (this.reelNextPreloadIds.has(nextId)) {
      return true;
    }
    if (!post || !(post instanceof VideoPost || post instanceof ImageVideoPost)) {
      this.reelNextPreloadIds.add(nextId);
      return true;
    }
    if (!post.hasVideoSource()) {
      this.reelNextPreloadIds.add(nextId);
      return true;
    }
    if (post.isPlayerLoaded()) {
      this.reelNextPreloadIds.add(nextId);
      return true;
    }
    return false;
  }

  private tryPreloadReelPost(nextId: string, post: VideoPost | ImageVideoPost): void {
    try {
      const player = post.preload();
      if (isNativeVideoPlayer(player)) {
        this.visibilityManager.registerPlayer(nextId, player);
      }
      this.reelNextPreloadIds.add(nextId);
    } catch (error) {
      console.warn('FeedContainer: Reel next preload failed', { postId: nextId, error });
    }
  }

  private preloadNextReelPosts(currentPostId: string): void {
    if (!this.isReelModeEnabled()) {
      return;
    }
    const currentIndex = this.postOrder.indexOf(currentPostId);
    if (currentIndex === -1) {
      return;
    }

    const nextIndexes = [currentIndex + 1, currentIndex + 2];
    for (const index of nextIndexes) {
      if (index < 0 || index >= this.postOrder.length) {
        continue;
      }
      const nextId = this.postOrder[index];
      const post = this.posts.get(nextId);
      if (this.shouldSkipReelPreload(post, nextId)) {
        continue;
      }
      this.tryPreloadReelPost(nextId, post as VideoPost | ImageVideoPost);
    }
  }

  /**
   * Autoplay the first N posts by force-loading and playing them
   */
  private async autoplayInitial(count: number): Promise<void> {
    if (!this.isReelModeEnabled()) {
      return;
    }
    const initial = this.markers.slice(0, Math.min(count, this.markers.length));
    const players = this.preloadInitialPlayers(initial);
    await new Promise((r) => setTimeout(r, 100));

    for (const entry of players) {
      this.attemptAutoplay(entry.player, entry.markerId).catch(() => {
        // Errors are handled inside attemptAutoplay
      });
    }
  }

  private preloadInitialPlayers(markers: SceneMarker[]): Array<{ markerId: string; player: NativeVideoPlayer }> {
    if (!this.isReelModeEnabled()) {
      return [];
    }
    const players: Array<{ markerId: string; player: NativeVideoPlayer }> = [];
    for (const marker of markers) {
      const post = this.posts.get(marker.id);
      if (!post?.hasVideoSource()) continue;
      const player = post.preload();
      if (!isNativeVideoPlayer(player)) continue;
      this.visibilityManager.registerPlayer(marker.id, player);
      players.push({ markerId: marker.id, player });
    }
    return players;
  }

  private async attemptAutoplay(player: NativeVideoPlayer, markerId: string): Promise<void> {
    const maxAttempts = 5;
    const attemptPlay = async (attempt: number): Promise<void> => {
      try {
        await player.waitForReady(1500);
        await new Promise((r) => setTimeout(r, 50));
        await player.play();
      } catch (e) {
        console.warn(`Autoplay initial attempt ${attempt} failed for marker ${markerId}`, e);
        if (attempt < maxAttempts) {
          const delay = Math.min(200 * Math.pow(2, attempt - 1), 1600);
          await new Promise((r) => setTimeout(r, delay));
          await attemptPlay(attempt + 1);
        } else {
          console.error(`Autoplay initial: All attempts failed for marker ${markerId}`);
        }
      }
    };

    await attemptPlay(1);
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
    const viewport = this.getViewportRect();
    const viewportTop = viewport.top;
    const viewportBottom = viewport.top + viewport.height;

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
  private trackBackgroundPreload(postId: string): void {
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
        await new Promise<void>((resolve) => {
          scheduleTimeout(() => resolve(), readinessTimeout);
        });
      } catch {
        // Ignore readiness errors – cleanup happens in finally
      } finally {
        if (this.activePreloadPosts.has(postId)) {
          this.activePreloadPosts.delete(postId);
          this.currentlyPreloadingCount = Math.max(0, this.currentlyPreloadingCount - 1);
        }
      }
    };

    waitForReady().catch(() => {
      if (this.activePreloadPosts.has(postId)) {
        this.activePreloadPosts.delete(postId);
        this.currentlyPreloadingCount = Math.max(0, this.currentlyPreloadingCount - 1);
      }
    });
  }


  /**
   * Check if a post is currently in or near the viewport
   */
  private isPostInViewport(postId: string): boolean {
    const post = this.posts.get(postId);
    if (!post) return false;
    
    const container = post.getContainer();
    const rect = container.getBoundingClientRect();
    const viewport = this.getViewportRect();
    let margin: number;
    if (this.isReelModeEnabled()) {
      margin = 800;
    } else {
      margin = 500; // Consider posts near viewport
    }
    
    return rect.bottom > viewport.top - margin && 
           rect.top < viewport.top + viewport.height + margin &&
           rect.right > viewport.left - margin && 
           rect.left < viewport.left + viewport.width + margin;
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
      
      // Remove from queue
      const queueIndex = this.backgroundPreloadPriorityQueue.indexOf(postId);
      if (queueIndex !== -1) {
        this.backgroundPreloadPriorityQueue.splice(queueIndex, 1);
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
      }, delay) as unknown as number;
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


    // Preload the video
    try {
      const player = post.preload();
      if (isNativeVideoPlayer(player)) {
        // Only register video players with visibility manager
        this.visibilityManager.registerPlayer(postId, player);
        this.trackBackgroundPreload(postId);
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
    }, delay) as unknown as number;
  }

  /**
   * Start background preloading system
   */
  private startBackgroundPreloading(): void {
    return;
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
    const viewportTop = this.getViewportTop();
    const viewportBottom = viewportTop + this.getViewportHeight();
    const postsWithDistance: Array<{ postId: string; distance: number; isVisible: boolean }> = [];
    
    for (const [postId, post] of this.posts.entries()) {
      const container = post.getContainer();
      const rect = container.getBoundingClientRect();
      const elementTop = this.getElementTop(rect);
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
  private destroyPostPlayer(post: PostType): void {
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

  private ensureVisiblePostsLoaded(maxToLoad: number = 1): void {
    if (this.posts.size === 0) {
      return;
    }

    const viewport = this.getViewportRect();
    let loaded = 0;

    for (const postId of this.postOrder) {
      if (loaded >= maxToLoad) break;
      if (this.activePreloadPosts.has(postId)) continue;

      const post = this.posts.get(postId);
      if (!post || post.isPlayerLoaded() || !post.hasVideoSource()) continue;
      if (!this.isPostVisibleInViewport(post, viewport)) continue;

      loaded += this.tryPreloadPost(postId, post);
    }
  }

  private isPostVisibleInViewport(post: PostType, viewport: { top: number; height: number }): boolean {
    const rect = post.getContainer().getBoundingClientRect();
    return rect.bottom > viewport.top && rect.top < viewport.top + viewport.height;
  }

  private tryPreloadPost(postId: string, post: PostType): number {
    try {
      const player = post.preload();
      if (isNativeVideoPlayer(player)) {
        this.visibilityManager.registerPlayer(postId, player);
        return 1;
      }
    } catch (error) {
      console.warn('Visible preload failed for post', postId, error);
    }
    return 0;
  }

  private aggressiveVideoUnload(): void {
    const viewportTop = this.getViewportTop();
    const viewportBottom = viewportTop + this.getViewportHeight();
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
    post: PostType,
    viewportTop: number,
    viewportBottom: number,
    margin: number
  ): boolean {
    const container = post.getContainer();
    const rect = container.getBoundingClientRect();
    const elementTop = this.getElementTop(rect);
    const elementBottom = elementTop + rect.height;
    
    return elementBottom > viewportTop - margin && elementTop < viewportBottom + margin;
  }

  private getReelActiveWindowPostIds(): Set<string> {
    const ids = new Set<string>();
    if (!this.isReelModeEnabled()) {
      return ids;
    }
    const closestCard = this.findCardClosestToCenter();
    if (!closestCard) {
      return ids;
    }
    const centerPostId = this.getPostIdFromCard(closestCard);
    if (!centerPostId) {
      return ids;
    }
    const centerIndex = this.postOrder.indexOf(centerPostId);
    if (centerIndex === -1) {
      ids.add(centerPostId);
      return ids;
    }
    const offsets = [-2, -1, 0, 1, 2];
    for (const offset of offsets) {
      const index = centerIndex + offset;
      if (index >= 0 && index < this.postOrder.length) {
        ids.add(this.postOrder[index]);
      }
    }
    return ids;
  }

  /**
   * Unload videos that are far from the viewport
   */
  private unloadVideosFarFromViewport(
    viewportTop: number,
    viewportBottom: number,
    unloadDistance: number
  ): void {
    const reelWindow = this.isReelModeEnabled() ? this.getReelActiveWindowPostIds() : null;
    for (const [postId, post] of this.posts.entries()) {
      if (reelWindow?.has(postId)) {
        continue;
      }
      if (this.isPostFarFromViewport(post, viewportTop, viewportBottom, unloadDistance)) {
        this.unloadPostVideo(post);
      }
    }
  }

  /**
   * Check if a post is far from the viewport
   */
  private isPostFarFromViewport(
    post: PostType,
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
    const reelWindow = this.isReelModeEnabled() ? this.getReelActiveWindowPostIds() : null;
    for (const [postId, post] of this.posts.entries()) {
      if (loadedVideoCount <= maxLoadedVideos) {
        break;
      }
      if (reelWindow?.has(postId)) {
        continue;
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
    post: PostType,
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
  private unloadPostVideo(post: PostType): void {
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
   * Debounce aggressiveVideoUnload so it fires once after scrolling settles,
   * not on every scroll event.
   */
  private scheduleVideoUnload(): void {
    if (this.videoUnloadTimer) clearTimeout(this.videoUnloadTimer);
    this.videoUnloadTimer = setTimeout(() => {
      this.videoUnloadTimer = undefined;
      this.aggressiveVideoUnload();
    }, 300);
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
    if (this.settings.autoHideSearchBar === false) return true;

    const suggestions = document.querySelector('.feed-filters__suggestions') as HTMLElement;
    if (suggestions && suggestions.style.display !== 'none' && suggestions.style.display !== '') {
      return true;
    }

    return false;
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

  private scheduleCleanupAfterScroll(): void {
    if (this.cleanupScrollTimeout) {
      clearTimeout(this.cleanupScrollTimeout);
    }
    this.cleanupScrollTimeout = setTimeout(() => {
      this.cleanupScrollTimeout = undefined;
      this.ensureVisiblePostsLoaded();
      this.cleanupDistantPosts();
    }, 2000);
  }

  private handleVisibilityChange(): void {
    if (document.hidden) {
      this.stopBackgroundPreloading();
    } else if (this.settings.backgroundPreloadEnabled && this.posts.size > 0) {
      this.startBackgroundPreloading();
    }
  }

  /**
   * Setup scroll handler
   * Handles header hide/show based on scroll direction and tracks scroll velocity
   */
  private setupScrollHandler(): void {
    let lastScrollY = this.getViewportTop();
    let isHeaderHidden = false;
    
    // Initialize scroll tracking
    this.lastScrollTop = this.getViewportTop();
    this.lastScrollTime = Date.now();

    const processScroll = () => {
      this.scrollRafPending = false;
      const now = Date.now();
      const currentScrollY = this.getViewportTop();
      const timeDelta = now - this.lastScrollTime;

      this.updateScrollVelocity(currentScrollY, timeDelta);
      this.scheduleVideoUnload();
      this.handleFastScrolling();
      this.cancelOutOfViewPreloads();

      if (!this.shouldSkipHeaderHandling()) {
        const headerState = this.handleHeaderVisibility(currentScrollY, lastScrollY, isHeaderHidden);
        lastScrollY = headerState.lastScrollY;
        isHeaderHidden = headerState.isHeaderHidden;
      }

      this.scheduleCleanupAfterScroll();
    };

    const handleScroll = () => {
      if (this.scrollRafPending) return;
      this.scrollRafPending = true;
      requestAnimationFrame(processScroll);
    };

    // Use passive listener for better performance
    const previousHandler = this.scrollHandler;
    const previousTarget = this.scrollEventTarget;
    if (previousHandler && previousTarget) {
      previousTarget.removeEventListener('scroll', previousHandler);
    }
    this.scrollHandler = handleScroll;
    this.scrollEventTarget = this.getScrollEventTarget();
    this.scrollEventTarget.addEventListener('scroll', handleScroll, { passive: true });

    // Listen for page visibility changes to pause/resume preloading
    if (this.visibilityChangeHandler) {
      document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
    }
    const handleVisibilityChange = () => this.handleVisibilityChange();
    this.visibilityChangeHandler = handleVisibilityChange;
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  /**
   * Setup card snapping - intercepts wheel and touch events to snap to cards
   */
  private setupCardSnapping(): void {
    // Clean up existing handlers
    this.cleanupCardSnapping();

    const shouldSnap = this.settings.snapToCards === true || this.settings.reelMode === true;
    // Only setup if snapToCards is enabled
    if (!shouldSnap) {
      return;
    }

    // Setup wheel event handler
    this.cardSnapWheelHandler = (e: WheelEvent) => {
      if (this.isSnapping) {
        e.preventDefault();
        return;
      }

      // Throttle to prevent rapid snapping
      if (this.snapThrottleTimeout) {
        e.preventDefault();
        return;
      }

      const deltaY = e.deltaY;
      if (Math.abs(deltaY) < 10) {
        return; // Ignore small movements
      }

      e.preventDefault();
      
      const direction = deltaY > 0 ? 'next' : 'previous';
      this.snapToNextCard(direction);
      
      // Throttle for 300ms
      this.snapThrottleTimeout = setTimeout(() => {
        this.snapThrottleTimeout = undefined;
      }, 300);
    };

    // Setup touch handlers for swipe detection
    this.cardSnapTouchStartHandler = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        this.touchStartY = e.touches[0].clientY;
        this.touchStartTime = Date.now();
      }
    };

    this.cardSnapTouchMoveHandler = (e: TouchEvent) => {
      if (this.isSnapping && e.touches.length === 1) {
        e.preventDefault(); // Prevent default scroll during snap
      }
    };

    this.cardSnapTouchEndHandler = (e: TouchEvent) => {
      if (this.isSnapping || !e.changedTouches.length) {
        return;
      }

      const touchEndY = e.changedTouches[0].clientY;
      const deltaY = this.touchStartY - touchEndY;
      const deltaTime = Date.now() - this.touchStartTime;
      const minSwipeDistance = 50; // Minimum pixels for swipe
      const maxSwipeTime = 500; // Maximum milliseconds for swipe

      // Check if this was a valid swipe
      if (Math.abs(deltaY) > minSwipeDistance && deltaTime < maxSwipeTime) {
        e.preventDefault();
        
        // Throttle to prevent rapid snapping
        if (this.snapThrottleTimeout) {
          return;
        }

        const direction = deltaY > 0 ? 'next' : 'previous';
        this.snapToNextCard(direction);
        
        // Throttle for 300ms
        this.snapThrottleTimeout = setTimeout(() => {
          this.snapThrottleTimeout = undefined;
        }, 300);
      }
    };

    // Add event listeners
    const snapTarget = this.getScrollEventTarget();
    this.cardSnapEventTarget = snapTarget;
    snapTarget.addEventListener('wheel', this.cardSnapWheelHandler as EventListener, { passive: false });
    snapTarget.addEventListener('touchstart', this.cardSnapTouchStartHandler as EventListener, { passive: true });
    snapTarget.addEventListener('touchmove', this.cardSnapTouchMoveHandler as EventListener, { passive: false });
    snapTarget.addEventListener('touchend', this.cardSnapTouchEndHandler as EventListener, { passive: false });

    if (this.settings.reelMode === true) {
      this.cardSnapScrollHandler = () => {
        if (this.cardSnapScrollTimeout) {
          clearTimeout(this.cardSnapScrollTimeout);
        }
        this.cardSnapScrollTimeout = setTimeout(() => {
          this.cardSnapScrollTimeout = undefined;
          if (this.isSnapping) {
            return;
          }
          const closestCard = this.findCardClosestToCenter();
          if (!closestCard) {
            return;
          }
          const postId = this.getPostIdFromCard(closestCard);
          if (!postId) {
            return;
          }
          this.triggerAutoplayForSnappedCard(postId).catch(() => {
            // Ignore autoplay errors
          });
          setTimeout(() => {
            this.requestAudioFocusForSnappedCard(postId);
          }, 300);
        }, 200);
      };
      this.cardSnapScrollTarget = this.getScrollEventTarget();
      this.cardSnapScrollTarget.addEventListener('scroll', this.cardSnapScrollHandler as EventListener, { passive: true });
    }
  }

  /**
   * Clean up card snapping event listeners
   */
  private cleanupCardSnapping(): void {
    if (this.cardSnapWheelHandler && this.cardSnapEventTarget) {
      this.cardSnapEventTarget.removeEventListener('wheel', this.cardSnapWheelHandler as EventListener);
      this.cardSnapWheelHandler = undefined;
    }
    if (this.cardSnapTouchStartHandler && this.cardSnapEventTarget) {
      this.cardSnapEventTarget.removeEventListener('touchstart', this.cardSnapTouchStartHandler as EventListener);
      this.cardSnapTouchStartHandler = undefined;
    }
    if (this.cardSnapTouchMoveHandler && this.cardSnapEventTarget) {
      this.cardSnapEventTarget.removeEventListener('touchmove', this.cardSnapTouchMoveHandler as EventListener);
      this.cardSnapTouchMoveHandler = undefined;
    }
    if (this.cardSnapTouchEndHandler && this.cardSnapEventTarget) {
      this.cardSnapEventTarget.removeEventListener('touchend', this.cardSnapTouchEndHandler as EventListener);
      this.cardSnapTouchEndHandler = undefined;
    }
    if (this.cardSnapScrollHandler && this.cardSnapScrollTarget) {
      this.cardSnapScrollTarget.removeEventListener('scroll', this.cardSnapScrollHandler as EventListener);
      this.cardSnapScrollHandler = undefined;
    }
    this.cardSnapEventTarget = undefined;
    this.cardSnapScrollTarget = undefined;
    if (this.snapThrottleTimeout) {
      clearTimeout(this.snapThrottleTimeout);
      this.snapThrottleTimeout = undefined;
    }
    if (this.cardSnapScrollTimeout) {
      clearTimeout(this.cardSnapScrollTimeout);
      this.cardSnapScrollTimeout = undefined;
    }
  }

  private teardownListeners(): void {
    this.removeMobileAutoplayUnlockListeners();
    this.removeAutoplayUnlockHandlers();

    if (this.scrollHandler && this.scrollEventTarget) {
      this.scrollEventTarget.removeEventListener('scroll', this.scrollHandler);
      this.scrollHandler = undefined;
      this.scrollEventTarget = undefined;
    }
    if (this.visibilityChangeHandler) {
      document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
      this.visibilityChangeHandler = undefined;
    }
    if (this.suggestionsClickOutsideHandler) {
      document.removeEventListener('click', this.suggestionsClickOutsideHandler);
      this.suggestionsClickOutsideHandler = undefined;
    }
    if (this.suggestionsTouchOutsideHandler) {
      document.removeEventListener('touchend', this.suggestionsTouchOutsideHandler);
      this.suggestionsTouchOutsideHandler = undefined;
    }

    this.cleanupCardSnapping();

    if (this.cleanupScrollTimeout) {
      clearTimeout(this.cleanupScrollTimeout);
      this.cleanupScrollTimeout = undefined;
    }
    if (this.videoUnloadTimer) {
      clearTimeout(this.videoUnloadTimer);
      this.videoUnloadTimer = undefined;
    }
    if (this.seenFlushTimer) {
      clearTimeout(this.seenFlushTimer);
      this.flushSeenSet();
      this.seenFlushTimer = undefined;
    }
    this.seenSetCache = undefined;
    if (this.snapThrottleTimeout) {
      clearTimeout(this.snapThrottleTimeout);
      this.snapThrottleTimeout = undefined;
    }
    if (this.cardSnapScrollTimeout) {
      clearTimeout(this.cardSnapScrollTimeout);
      this.cardSnapScrollTimeout = undefined;
    }
    if (this.backgroundPreloadHandle) {
      globalThis.clearTimeout(this.backgroundPreloadHandle);
      this.backgroundPreloadHandle = undefined;
    }
    if (this.placeholderAnimationInterval) {
      clearInterval(this.placeholderAnimationInterval);
      this.placeholderAnimationInterval = undefined;
    }
    if (this.appendRetryTimeoutId) {
      clearTimeout(this.appendRetryTimeoutId);
      this.appendRetryTimeoutId = undefined;
    }

    this.cleanupLoadObservers();
    if (this.scrollObserver) {
      this.scrollObserver.disconnect();
      this.scrollObserver = undefined;
    }
  }

  destroy(): void {
    this.stopBackgroundPreloading();
    posterPreloader.cancelInflight();
    this.teardownListeners();
    this.clearPosts();
    this.discoveryManager?.destroy();
    this.discoveryPanel?.destroy();
    this.api.destroy();
  }

  /**
   * Get all card containers ordered by postOrder
   */
  private getAllCardContainers(): HTMLElement[] {
    const cards: HTMLElement[] = [];
    for (const postId of this.postOrder) {
      const post = this.posts.get(postId);
      if (post) {
        const container = post.getContainer();
        if (container?.parentNode) {
          cards.push(container);
        }
      }
    }
    return cards;
  }

  /**
   * Find the card closest to the viewport center
   */
  private findCardClosestToCenter(): HTMLElement | null {
    const cards = this.getAllCardContainers();
    if (cards.length === 0) {
      return null;
    }

    const viewportCenter = this.getViewportTop() + this.getViewportHeight() / 2;
    let closestCard: HTMLElement | null = null;
    let minDistance = Infinity;

    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      const cardCenter = this.getElementTop(rect) + rect.height / 2;
      const distance = Math.abs(cardCenter - viewportCenter);

      if (distance < minDistance) {
        minDistance = distance;
        closestCard = card;
      }
    }

    return closestCard;
  }

  /**
   * Calculate scroll position to center a card in the viewport
   */
  private calculateCardCenterPosition(card: HTMLElement): number {
    const rect = card.getBoundingClientRect();
    const cardTop = this.getElementTop(rect);
    const cardHeight = rect.height;
    const viewportHeight = this.getViewportHeight();
    
    // Calculate position to center the card
    return cardTop + cardHeight / 2 - viewportHeight / 2;
  }

  private resolveTargetIndex(direction: 'next' | 'previous', currentIndex: number, cardCount: number): number | null {
    const targetIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
    if (targetIndex < 0 || targetIndex >= cardCount) return null;
    return targetIndex;
  }

  /**
   * Snap to the next or previous card
   */
  private snapToNextCard(direction: 'next' | 'previous'): void {
    if (this.isSnapping) {
      return;
    }

    const cards = this.getAllCardContainers();
    if (cards.length === 0) {
      return;
    }

    const currentCard = this.findCardClosestToCenter();
    if (!currentCard) {
      const targetCard = direction === 'next' ? cards[0] : cards[cards.length - 1];
      this.snapToCard(targetCard);
      return;
    }

    const currentIndex = cards.indexOf(currentCard);
    if (currentIndex === -1) {
      return;
    }

    const targetIndex = this.resolveTargetIndex(direction, currentIndex, cards.length);

    if (direction === 'next') {
      const isAtOrNearEnd = targetIndex === null || cards.length - 1 - targetIndex <= 2;
      if (isAtOrNearEnd && !this.isLoading && this.hasMore) {
        void this.loadVideos(undefined, true);
      }
    }

    if (targetIndex === null) {
      return;
    }

    this.snapToCard(cards[targetIndex]);
  }

  /**
   * Extract post ID from a card element
   */
  private getPostIdFromCard(card: HTMLElement): string | null {
    return card.dataset.postId ?? null;
  }

  private ensureReelInitialCardLoaded(): void {
    if (!this.isReelModeEnabled()) {
      return;
    }

    const closestCard = this.findCardClosestToCenter();
    if (!closestCard) {
      return;
    }

    const postId = this.getPostIdFromCard(closestCard);
    if (!postId) {
      return;
    }

    const post = this.posts.get(postId);
    if (!post || post.isPlayerLoaded() || !post.hasVideoSource()) {
      return;
    }

    try {
      const player = post.preload();
      if (isNativeVideoPlayer(player)) {
        this.visibilityManager.registerPlayer(postId, player);
        this.visibilityManager.observePost(post.getContainer(), postId);
      }
    } catch (error) {
      console.warn('Reel initial preload failed for post', postId, error);
    }

    if (this.settings.autoPlay) {
      this.triggerAutoplayForSnappedCard(postId).catch(() => {
        // Ignore autoplay errors
      });
      setTimeout(() => {
        this.requestAudioFocusForSnappedCard(postId);
      }, 300);
    }
  }


  /**
   * Trigger autoplay for a snapped card
   */
  private async triggerAutoplayForSnappedCard(postId: string): Promise<void> {
    const post = this.posts.get(postId);
    if (!post) {
      return; // Post doesn't exist
    }

    // Skip image posts
    if (!post.hasVideoSource()) {
      return;
    }

    // Check if autoplay is enabled
    if (!this.settings.autoPlay) {
      return;
    }

    // Preload the player if not already loaded
    const player = post.preload();
    if (!isNativeVideoPlayer(player)) {
      return; // Not a video player or failed to load
    }

    // Register with VisibilityManager if needed
    this.visibilityManager.registerPlayer(postId, player);
    this.visibilityManager.observePost(post.getContainer(), postId);

    // Wait a bit for player to initialize and IntersectionObserver to update
    await new Promise((r) => setTimeout(r, 150));

    // Check if video is manually paused - don't autoplay if user paused it
    if (player.isManuallyPaused?.()) {
      return;
    }

    // Trigger playback via VisibilityManager
    const container = post.getContainer();
    const rect = container.getBoundingClientRect();
    const viewport = this.getViewportRect();
    const isActuallyVisible = rect.bottom > viewport.top &&
                              rect.top < viewport.top + viewport.height &&
                              rect.right > viewport.left &&
                              rect.left < viewport.left + viewport.width;

    const triggered = this.visibilityManager.triggerSnapPlayback(postId, isActuallyVisible);
    if (!triggered) return;

    // Wait for playback to start, then ensure audio is granted
    const checkPlayback = async (attempts: number = 0): Promise<void> => {
      if (attempts > 10) return;
      if (player.isPlaying()) {
        this.visibilityManager.grantSnapAudioFocus(postId);
      } else {
        await new Promise((r) => setTimeout(r, 100));
        await checkPlayback(attempts + 1);
      }
    };
    checkPlayback().catch(() => {});
  }

  /**
   * Request audio focus for a snapped card
   * This is called after playback starts to ensure audio is granted
   */
  private requestAudioFocusForSnappedCard(postId: string): void {
    // Only request audio if global mute is off
    if (this.globalMuteState) {
      return; // Global mute is on, don't request audio
    }

    const post = this.posts.get(postId);
    if (!post) {
      return; // Post doesn't exist
    }

    // Skip image posts
    if (!post.hasVideoSource()) {
      return;
    }

    const player = post.getPlayer();
    if (!isNativeVideoPlayer(player)) {
      return;
    }

    // Only request audio if video is actually playing
    if (!player.isPlaying()) {
      return;
    }

    this.visibilityManager?.grantSnapAudioFocus(postId);
  }

  /**
   * Smoothly scroll to center a card
   */
  private snapToCard(card: HTMLElement): void {
    if (this.isSnapping) {
      return;
    }

    this.isSnapping = true;
    const targetPosition = this.calculateCardCenterPosition(card);
    const postId = this.getPostIdFromCard(card);

    this.scrollToPosition(targetPosition, 'smooth');

    const scrollTarget = this.isReelModeEnabled() && this.scrollContainer
      ? this.scrollContainer
      : (globalThis as unknown as Window);

    const finishSnap = () => {
      this.isSnapping = false;
      if (postId) {
        setTimeout(() => {
          this.triggerAutoplayForSnappedCard(postId).catch((e) => {
            console.warn('Failed to trigger autoplay for snapped card', e);
          });
          setTimeout(() => {
            this.requestAudioFocusForSnappedCard(postId);
          }, 500);
        }, 200);
      }
    };

    let safetyTimeout: ReturnType<typeof setTimeout>;

    const onScrollEnd = () => {
      clearTimeout(safetyTimeout);
      finishSnap();
    };

    scrollTarget.addEventListener('scrollend', onScrollEnd, { once: true });

    // Safety fallback for browsers where scrollend may not fire
    safetyTimeout = setTimeout(() => {
      scrollTarget.removeEventListener('scrollend', onScrollEnd);
      finishSnap();
    }, 1200);
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
    if (this.isReelModeEnabled()) {
      body.style.overflow = 'hidden';
    } else {
      body.style.overflow = '';
    }
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
      const skeletonCount = FeedContainer.CONTENT_LOAD_LIMIT;
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
      const skeletonCount = FeedContainer.CONTENT_LOAD_LIMIT;
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
    player.style.backgroundColor = THEME.colors.backgroundSecondary;
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

    if (this.isReelModeEnabled()) {
      skeleton.style.height = '100vh';
      skeleton.style.minHeight = '100vh';
      skeleton.style.scrollSnapAlign = 'start';
      skeleton.style.scrollSnapStop = 'always';

      card.style.border = 'none';
      card.style.borderRadius = '0';
      card.style.backgroundColor = 'transparent';
      card.style.height = '100%';
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.position = 'relative';

      header.style.position = 'absolute';
      header.style.left = '16px';
      header.style.right = '120px';
      header.style.bottom = '88px';
      header.style.top = 'auto';
      header.style.padding = '10px 14px';
      header.style.borderRadius = THEME.radius.button;
      header.style.background = 'rgba(0, 0, 0, 0.35)';

      player.style.height = '100%';
      player.style.aspectRatio = 'auto';
      player.classList.remove('aspect-16-9');

      footer.style.position = 'absolute';
      footer.style.right = '16px';
      footer.style.bottom = '88px';
      footer.style.top = 'auto';
      footer.style.transform = 'none';
      footer.style.padding = '0';
      footer.style.flexDirection = 'column';
      footer.style.alignItems = 'center';
    }
    
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

  private hideError(): void {
    const error = this.container.querySelector<HTMLElement>('.feed-error');
    if (error) error.style.display = 'none';
  }

  /**
   * Update settings
   */
  updateSettings(newSettings: Partial<FeedSettings>): void {
    const previousExcludedTags = this.normalizeExcludedTagNames(this.settings.excludedTagNames ?? []);
    const previousShowVerified = this.settings.showVerifiedCheckmarks;
    const previousShowProductionAge = this.settings.showProductionAge;
    const previousShowStudioChips = this.settings.showStudioChips;
    const previousShowSceneTitle = this.settings.showSceneTitle;
    const previousOrientation = this.normalizeOrientationFilter(this.settings.orientationFilter ?? []);
    this.settings = { ...this.settings, ...newSettings };

    const reelModeChanged = newSettings.reelMode !== undefined;
    if (reelModeChanged || newSettings.snapToCards !== undefined) {
      this.setupCardSnapping();
    }
    if (reelModeChanged) {
      this.applyReelModeSettings();
    }
    this.refreshAutoplayAfterLayout();

    this.applyPostDisplaySettings(newSettings, previousShowVerified, previousShowProductionAge, previousShowStudioChips, previousShowSceneTitle);
    this.reloadFeedIfFiltersChanged(newSettings, previousExcludedTags, previousOrientation);
  }

  private applyReelModeSettings(): void {
    this.applyReelModeLayout();
    this.visibilityManager.setReelMode(this.settings.reelMode === true);
    this.visibilityManager.setAutoPlay(!this.useHDMode || this.settings.reelMode === true);
  }

  private applyPostDisplaySettings(
    newSettings: Partial<FeedSettings>,
    previousShowVerified: boolean | undefined,
    previousShowProductionAge: boolean | undefined,
    previousShowStudioChips: boolean | undefined,
    previousShowSceneTitle: boolean | undefined
  ): void {
    this.applyPostDisplayToggle(
      newSettings.showVerifiedCheckmarks,
      previousShowVerified,
      this.settings.showVerifiedCheckmarks,
      (post, on) => post.setShowVerifiedCheckmarks?.(on),
      false,
    );
    this.applyPostDisplayToggle(
      newSettings.showProductionAge,
      previousShowProductionAge,
      this.settings.showProductionAge,
      (post, on) => post.setShowProductionAge?.(on),
      true,
    );
    this.applyPostDisplayToggle(
      newSettings.showStudioChips,
      previousShowStudioChips,
      this.settings.showStudioChips,
      (post, on) => post.setShowStudioChips?.(on),
      false,
    );
    this.applyPostDisplayToggle(
      newSettings.showSceneTitle,
      previousShowSceneTitle,
      this.settings.showSceneTitle,
      (post, on) => post.setShowSceneTitle?.(on),
      true,
    );
  }

  private applyPostDisplayToggle(
    next: boolean | undefined,
    previous: boolean | undefined,
    current: boolean | undefined,
    apply: (post: PostType, on: boolean) => void,
    defaultValue: boolean,
  ): void {
    if (next === undefined || current === previous) return;
    const on = current ?? defaultValue;
    for (const post of this.posts.values()) {
      apply(post, on);
    }
  }

  private reloadFeedIfFiltersChanged(
    newSettings: Partial<FeedSettings>,
    previousExcludedTags: string[],
    previousOrientation: string[]
  ): void {
    const nextExcludedTags = this.normalizeExcludedTagNames(this.settings.excludedTagNames ?? []);
    const nextOrientation = this.normalizeOrientationFilter(this.settings.orientationFilter ?? []);
    const excludedTagsChanged = !this.areExcludedTagNamesEqual(previousExcludedTags, nextExcludedTags);
    const orientationChanged = newSettings.orientationFilter !== undefined
      && !this.areOrientationFiltersEqual(previousOrientation, nextOrientation);
    if (excludedTagsChanged || orientationChanged) {
      this.loadVideos(this.currentFilters, false, undefined, true).catch((e) => {
        console.error('Failed to reload feed after filter update', e);
      });
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
    this.stopBackgroundPreloading();
    this.cancelAllPendingRequests();
    this.stopLoadingVideos();
    this.visibilityManager.cleanup();
    this.teardownListeners();
    this.clearPosts();
    this.hideSkeletonLoaders();

    const debugThis = this as FeedContainer & FeedContainerDebug;
    if (debugThis._mobileLoadTimeout) {
      clearTimeout(debugThis._mobileLoadTimeout);
      debugThis._mobileLoadTimeout = null;
    }

    if (this.loadMoreTrigger) {
      this.loadMoreTrigger = undefined;
    }
  }
}
