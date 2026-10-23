/**
 * Feed Container
 * Main application container managing the feed
 */

import { SceneMarker, FilterOptions, FeedSettings, VideoPostData, ImagePostData, ImageVideoPostData, Image, SavedSearch, DateRangeFilter, SavedFilterMode } from './types.js';

type SavedFilter = { id: string; name: string; mode: SavedFilterMode };

// Serializable snapshot of the interactive filter state, stored in history.state
// so browser back/forward steps through filter changes.
interface FilterSnapshot {
  tags: [number, string][];
  performers: [number, string][];
  studios: [number, string][];
  markerName?: string;
  dateRange?: DateRangeFilter;
  savedFilter?: SavedFilter;
}
import { StashAPI, generateRandomSortSeed } from './StashAPI.js';
import { PluginSettingsManager } from './PluginSettingsManager.js';
import { VideoPost } from './VideoPost.js';
import { ImagePost } from './ImagePost.js';
import { ImageVideoPost } from './ImageVideoPost.js';
import type { IVideoPlayer } from './types.js';
import { ImagePlayer } from './ImagePlayer.js';
import { ReelPlaybackController } from './ReelPlaybackController.js';
import { ReelScroller } from './ReelScroller.js';
import { FavoritesManager } from './FavoritesManager.js';
import { BookmarkManager } from './BookmarkManager.js';
import type { SettingsPage } from './SettingsPage.js';
import { debounce, isTypingTarget, showToast, normalizeMediaUrl, detectDeviceCapabilities, DeviceCapabilities, isStandaloneNavigator, isMobileDevice, detectVideoFromVisualFiles, isMp4File, getImageUrlForDisplay, THEME, THEME_DEFAULTS, normalizeHexColor, toRgba, buildFullUrl, applyThemeColors } from './utils.js';
import { GQLImage } from './graphql/types.js';
import { getStashBaseUrl } from './utils/baseUrl.js';
import { SETTINGS_SVG, STASHGIFS_LOGO_SVG, IMAGE_SVG, MARKER_SVG, HEART_SVG_OUTLINE } from './icons.js';
import { DiscoveryPanel } from './DiscoveryPanel.js';
import { WhisparrClient } from './WhisparrClient.js';
import { DiscoveryManager } from './DiscoveryManager.js';
import { buildEndOfFeedCard, END_CARD_POST_ID } from './EndOfFeedCard.js';

// Lazy-load videos only as they enter the viewport — no speculative look-ahead.
const LAZY_LOAD_ROOT_MARGIN = '0px';

const DEFAULT_SETTINGS: FeedSettings = {
  cardMaxWidth: 800,
  aspectRatio: 'preserve',
  enabledFileTypes: ['.jpg', '.png', '.gif', '.mp4', '.m4v'], // Default file types to include
  includeImagesInFeed: true, // Whether to include images in feed
  searchMarkersByName: false, // Show a Markers section in search suggestions
  imagesOnly: false,
  includeShortForm: true, // Include short-form content
  shortFormMaxDuration: 120, // Maximum duration in seconds for short-form content
  includeScenePreviews: false, // Include scene hover-preview clips
  autoHideSearchBar: true,
  themeBackground: THEME_DEFAULTS.backgroundPrimary,
  themePrimary: THEME_DEFAULTS.surface,
  themeSecondary: THEME_DEFAULTS.backgroundSecondary,
  themeAccent: THEME_DEFAULTS.accentPrimary,
  showVerifiedCheckmarks: true,
  showProductionAge: false,
  showStudioChips: true,
  showPerformerEmbellishment: false,
  showMalePerformers: true,
  showFemalePerformers: true,
  showOtherGenderPerformers: true,
  showSceneTitle: false,
  excludedTagNames: ['VR'],
  imagesInGalleryOnly: false,
  galleryIds: [],
  seenHistorySize: 500,
  contentLimit: 5000,
  enableDiscoveryPanel: true,
  hdMode: true,
  showPerformerTags: false,
  showSceneTags: false,
};

/**
 * Debug interface for FeedContainer (for extension/debugging purposes)
 */
interface FeedContainerDebug {
  _mobileLoadTimeout?: ReturnType<typeof setTimeout> | null;
}

/**
 * Type guard to check if a player is a video player (vs the GIF ImagePlayer).
 */
function isVideoPlayer(player: IVideoPlayer | ImagePlayer | undefined): player is IVideoPlayer {
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
  // Reel scroll advances one card per gesture, so the pixel-based loadMoreTrigger only
  // enters its prefetch margin once the user is basically on the last card. Prefetch the
  // next batch this many cards before the end so the (often multi-second) fetch is ready
  // by the time they arrive.
  private static readonly PREFETCH_CARDS_AHEAD = 5;
  private static readonly SEEN_IDS_KEY = 'stashgifs-seen-ids';
  private readonly container: HTMLElement;
  private scrollContainer: HTMLElement;
  private readonly api: StashAPI;
  private readonly settingsManager: PluginSettingsManager;
  private playback: ReelPlaybackController;
  private favoritesManager: FavoritesManager;
  private bookmarkManager: BookmarkManager;
  private discoveryPanel?: DiscoveryPanel;
  private discoveryManager?: DiscoveryManager;
  private posts: Map<string, PostType>;
  private postOrder: string[];
  private settings: FeedSettings;
  private settingsPage?: SettingsPage;
  private isOpeningSettings = false;
  private settingsContainer?: HTMLElement;
  private ratingConfigReady: Promise<void> = Promise.resolve();
  private ratingSystemConfig: { type?: string; starPrecision?: string } | null | undefined;
  private imagesLoadedCount: number = 0; // Track how many images we've loaded
  private markersLoadedCount: number = 0; // Track how many markers we've loaded
  private shortFormLoadedCount: number = 0; // Track how many short-form items we've loaded
  private shortFormUnfilteredOffset: number = 0; // Track offset in UNFILTERED scene list for short-form pagination
  private scenePreviewLoadedCount: number = 0; // Track how many scene-preview items we've loaded
  private scenePreviewUnfilteredOffset: number = 0; // Track offset in UNFILTERED scene list for scene-preview pagination
  private markerPageSize: number = 0; // Track the page size used for markers (for consistent pagination)
  private imagePageSize: number = 0; // Track the page size used for images (for consistent pagination)
  private isLoading: boolean = false;
  private currentFilters?: FilterOptions;
  private readonly selectedTagIds: Map<number, string> = new Map();
  private readonly selectedPerformerIds: Map<number, string> = new Map();
  private readonly selectedStudioIds: Map<number, string> = new Map();
  private selectedMarkerName?: string; // Active "search markers by name" filter (exact title)
  private selectedDateRange?: DateRangeFilter; // Active "created within" filter (week/month/year)
  private readonly debouncedApplyFilters!: () => void;
  private activePillsBar?: HTMLElement;
  private hasMore: boolean = true;
  private seenSkipCount = 0;
  private currentPage: number = 1;
  private appendRetryCount = 0;
  private appendRetryTimeoutId?: ReturnType<typeof setTimeout>;
  // Coalesce the rapid per-toggle reloads fired while the settings page is open into a
  // single full reset, so concurrent force-loads can't race and blank the feed.
  private settingsReloadTimeoutId?: ReturnType<typeof setTimeout>;
  private latestLoadId = 0;
  private scrollObserver?: IntersectionObserver;
  private loadMoreTrigger?: HTMLElement;
  private endCard?: HTMLElement;
  private saveSearchInputVisible = false;
  private postsContainer!: HTMLElement;
  private headerBar?: HTMLElement;
  private selectedSavedFilter?: SavedFilter;
  private lastSnapshotJson = '';
  private suppressHistoryPush = false;
  private preloadedTags: Array<{ id: string; name: string }> = [];
  private preloadedPerformers: Array<{ id: string; name: string; image_path?: string }> = [];
  private isPreloading: boolean = false;
  private excludedTagIds: string[] = [];
  private excludedTagNamesNormalized: string[] = [];
  private scrollRafPending: boolean = false;
  private seenSetCache?: { ids: string[]; set: Set<string> };
  private seenFlushTimer?: ReturnType<typeof setTimeout>;
  private cleanupScrollTimeout?: ReturnType<typeof setTimeout>;
  private scrollHandler?: () => void;
  private scrollEventTarget?: Window | HTMLElement;
  private suggestionsClickOutsideHandler?: (event: Event) => void;
  private suggestionsTouchOutsideHandler?: (event: Event) => void;
  private placeholderAnimationInterval?: ReturnType<typeof setInterval>; // For scrolling placeholder animation
  private savedFiltersCache: SavedFilter[] = [];
  private savedFiltersPromise?: Promise<void>;
  private activeSearchAbortController?: AbortController;
  private suggestionAbortController?: AbortController;
  private activeLoadVideosAbortController?: AbortController;
  private skeletonLoaders: HTMLElement[] = [];
  private useHDMode: boolean = false;
  private globalMuteState: boolean = false; // Global mute state - all videos muted when true
  private readonly loadObservers: Map<string, IntersectionObserver> = new Map(); // Track load observers for cleanup
  private deviceCapabilities: DeviceCapabilities; // Device capabilities for adaptive quality
  private updatePlaceholderVisibilityRef?: () => void; // Reference to updatePlaceholderVisibility function
  // Reel scrolling: JS-driven, one-card-per-gesture (replaces CSS scroll-snap)
  private reelScroller?: ReelScroller;
  private mobileAutoplayUnlockHandler?: (event: Event) => void;
  private autoplayUnlockHandler?: (event: Event) => void;
  private visibilityResumeHandler?: () => void;
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
    this.api.maxResolution = this.settings.maxResolution ?? 0;
    // Initialize properties that will be set in methods
    this.scrollContainer = null!; // Will be set in initializeContainers
    this.playback = null!; // Will be set in initializeManagers
    this.favoritesManager = null!; // Will be set in initializeManagers
    this.bookmarkManager = null!; // Will be set in initializeManagers
    this.posts = new Map();
    this.postOrder = [];

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
    
    // Setup JS reel scroller if reel mode is enabled
    this.setupReelScroller();
    
    // Setup infinite scroll
    this.setupInfiniteScroll();
    
    // Unlock autoplay on mobile after first user interaction
    this.unlockMobileAutoplay();
    this.setupAutoplayUnlockHandlers();
    document.addEventListener('keydown', this.onRatingHotkey);

    // Defer suggestion preload until after initial videos load to avoid competing for bandwidth
    // Will be triggered lazily when user opens filter dropdown or after initial load completes
  }

  /**
   * Initialize device detection and configuration
   */
  private initializeDeviceConfiguration(): void {
    this.deviceCapabilities = detectDeviceCapabilities();

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

  private getScrollEventTarget(): HTMLElement {
    return this.scrollContainer;
  }

  private getViewportTop(): number {
    return this.scrollContainer.scrollTop;
  }

  private getViewportHeight(): number {
    return this.scrollContainer.clientHeight;
  }

  private getViewportRect(): { top: number; left: number; width: number; height: number } {
    const rect = this.scrollContainer.getBoundingClientRect();
    return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
  }

  private getObserverRoot(): Element {
    return this.scrollContainer;
  }

  private getElementTop(rect: DOMRect): number {
    const containerRect = this.scrollContainer.getBoundingClientRect();
    return this.scrollContainer.scrollTop + rect.top - containerRect.top;
  }

  private scrollToPosition(top: number, behavior: ScrollBehavior = 'auto'): void {
    this.scrollContainer.scrollTo({ top, behavior });
  }

  private scrollToTop(): void {
    this.scrollToPosition(0, 'auto');
  }

  private applyReelModeLayout(): void {
    this.applyReelRootStyles();
    this.applyReelContainerStyles();
    this.applyReelHeaderStyles();
    this.setupScrollHandler();
    this.setupReelScroller();
    this.resetScrollObserver();
    this.refreshAutoplayAfterLayout();
    requestAnimationFrame(() => this.reelScroller?.realign());
    this.ensureReelInitialCardLoaded();
  }

  private refreshAutoplayAfterLayout(): void {
    requestAnimationFrame(() => {
      this.playback?.retryActive();
    });
  }

  private applyReelRootStyles(): void {
    const root = document.documentElement;
    const body = document.body;
    root.style.overflow = 'hidden';
    if (body.dataset.scrollLock !== 'true') {
      body.style.overflow = 'hidden';
    }
  }

  private applyReelContainerStyles(): void {
    if (this.container) {
      this.container.style.width = '100vw';
      this.container.style.maxWidth = '100vw';
      this.container.style.margin = '0';
      this.container.style.marginLeft = 'calc(50% - 50vw)';
      this.container.style.marginRight = 'calc(50% - 50vw)';
      this.container.style.padding = '0';
    }

    const reelHeight = CSS.supports('height', '100svh') ? '100svh' : '100vh';
    this.scrollContainer.style.width = '100vw';
    this.scrollContainer.style.maxWidth = '100vw';
    this.scrollContainer.style.margin = '0';
    this.scrollContainer.style.marginLeft = 'calc(50% - 50vw)';
    this.scrollContainer.style.marginRight = 'calc(50% - 50vw)';
    this.scrollContainer.style.padding = '0';
    this.scrollContainer.style.height = reelHeight;
    this.scrollContainer.style.minHeight = reelHeight;
    this.scrollContainer.style.overflowY = 'auto';
    this.scrollContainer.style.overflowX = 'hidden';
    this.scrollContainer.style.overscrollBehavior = 'contain';
    // The reel owns scroll position outright. Without this, the browser's native
    // scroll-anchoring silently shifts scrollTop whenever DOM above the viewport changes
    // (video.js players mounting/unmounting, images decoding) as the user scrolls — which
    // surfaces as sudden backward/up jumps. Cards are fixed-height, so there is nothing
    // legitimate to anchor; pruning compensates explicitly via ReelScroller.snapToCard.
    this.scrollContainer.style.overflowAnchor = 'none';

    if (this.postsContainer) {
      this.postsContainer.style.display = 'flex';
      this.postsContainer.style.flexDirection = 'column';
      this.postsContainer.style.gap = '0';
      this.postsContainer.style.padding = '0';
      this.postsContainer.style.margin = '0';
      for (const wrapper of this.postsContainer.querySelectorAll<HTMLElement>('.video-post-wrapper')) {
        wrapper.style.width = '100%';
        wrapper.style.maxWidth = '100%';
        wrapper.style.margin = '0';
      }
    }
  }

  private applyReelHeaderStyles(): void {
    const header = this.headerBar || this.scrollContainer.querySelector<HTMLElement>('.feed-header-bar');
    if (!header) return;

    const headerInner = header.querySelector<HTMLElement>('.feed-header-inner');
    const inputWrapper = header.querySelector<HTMLElement>('.feed-input-wrapper');
    const queryInput = header.querySelector<HTMLInputElement>('.feed-filters__input');
    const brandContainer = header.querySelector<HTMLElement>('.feed-brand-container');
    const settingsButton = header.querySelector<HTMLElement>('[aria-label="Open settings"]');

    header.style.position = 'fixed';
    header.style.left = '0';
    header.style.right = '0';
    header.style.width = '100%';
    header.style.maxWidth = '100%';
    if (header.dataset.overlayZIndex === undefined) {
      header.style.zIndex = '900';
    } else {
      // overlay is open; header must stay above it — update the stashed value that
      // setHeaderOverlayState(false) will restore instead of the live z-index
      header.dataset.overlayZIndex = '900';
    }
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
    if (inputWrapper) inputWrapper.style.background = 'transparent';
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

  /**
   * Save settings to localStorage
   */
  private handleSettingsChange(newSettings: Partial<FeedSettings>): void {
    const previousSettings = { ...this.settings };
    const previousShowVerified = this.settings.showVerifiedCheckmarks;
    const previousShowProductionAge = this.settings.showProductionAge;
    const previousShowStudioChips = this.settings.showStudioChips;
    const previousShowSceneTitle = this.settings.showSceneTitle;
    const previousExcludedTags = this.normalizeExcludedTagNames(this.settings.excludedTagNames ?? []);
    const previousOrientation = this.normalizeOrientationFilter(this.settings.orientationFilter ?? []);

    const updatedSettings = { ...this.settings, ...newSettings };
    this.settings = updatedSettings;
    this.api.maxContentLimit = updatedSettings.contentLimit ?? 5000;
    this.api.maxResolution = updatedSettings.maxResolution ?? 0;
    this.saveSettingsToStorage(updatedSettings);
    this.applyThemeSettings(updatedSettings);

    if (newSettings.hdMode !== undefined) {
      const newHDMode = newSettings.hdMode;
      this.useHDMode = newHDMode;
      this.settingsManager.save({ hdMode: newHDMode });
    }

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

    if (newSettings.cardMaxWidth !== undefined && this.headerBar) {
      const w = updatedSettings.cardMaxWidth;
      this.headerBar.style.maxWidth = `${w + 24}px`;
      const headerInner = this.headerBar.querySelector<HTMLElement>('.feed-header-inner');
      if (headerInner) headerInner.style.maxWidth = `${w}px`;
    }

    this.handleDiscoverySettingsChange(newSettings, updatedSettings);

    if (this.shouldReloadFeed(newSettings, previousSettings, excludedTagsChanged, orientationFilterChanged)) {
      this.scheduleSettingsReload();
    }
  }

  private handleDiscoverySettingsChange(newSettings: Partial<FeedSettings>, updatedSettings: FeedSettings): void {
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
  }

  /**
   * Debounce content-affecting settings reloads. Toggling several content types in the
   * overflow menu (e.g. markers off, short-form off, images on) used to fire one
   * forced loadVideos per toggle; those ran concurrently, mutated the shared filter
   * object, and aborted each other — leaving hasMore=false and a blank feed until a
   * manual refresh. Collapsing them into a single delayed refreshFeed() removes the race.
   */
  private scheduleSettingsReload(): void {
    if (this.settingsReloadTimeoutId) {
      clearTimeout(this.settingsReloadTimeoutId);
    }
    this.settingsReloadTimeoutId = setTimeout(() => {
      this.settingsReloadTimeoutId = undefined;
      this.refreshFeed().catch((e) => {
        console.error('Failed to reload feed after settings change', e);
      });
    }, 250);
  }

  private mountDiscoveryPanel(): void {
    if (this.discoveryPanel || isMobileDevice()) return;
    this.createDiscoveryPanel();
  }

  /** Construct the discovery panel + manager. Callers gate on platform/settings. */
  private createDiscoveryPanel(): void {
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

  private forEachPost(condition: boolean, fn: (post: PostType) => void): void {
    if (!condition) return;
    for (const post of this.posts.values()) {
      fn(post);
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
    this.forEachPost(
      newSettings.showVerifiedCheckmarks !== undefined && updatedSettings.showVerifiedCheckmarks !== previousShowVerified,
      p => p.setShowVerifiedCheckmarks?.(updatedSettings.showVerifiedCheckmarks !== false)
    );
    this.forEachPost(
      newSettings.showProductionAge !== undefined && updatedSettings.showProductionAge !== previousShowProductionAge,
      p => p.setShowProductionAge?.(updatedSettings.showProductionAge === true)
    );
    this.forEachPost(
      newSettings.showStudioChips !== undefined,
      p => p.setShowStudioChips?.(updatedSettings.showStudioChips !== false)
    );
    this.forEachPost(
      newSettings.showPerformerEmbellishment !== undefined,
      p => p.setShowPerformerEmbellishment?.(updatedSettings.showPerformerEmbellishment === true)
    );
    this.forEachPost(
      newSettings.showMalePerformers !== undefined
        || newSettings.showFemalePerformers !== undefined
        || newSettings.showOtherGenderPerformers !== undefined,
      p => p.setPerformerGenderVisibility?.(
        updatedSettings.showMalePerformers !== false,
        updatedSettings.showFemalePerformers !== false,
        updatedSettings.showOtherGenderPerformers !== false
      )
    );
    this.forEachPost(
      newSettings.showSceneTitle !== undefined && updatedSettings.showSceneTitle !== previousShowSceneTitle,
      p => p.setShowSceneTitle?.(updatedSettings.showSceneTitle === true)
    );
    this.forEachPost(
      newSettings.showPerformerTags !== undefined,
      p => p.setShowPerformerTags?.(updatedSettings.showPerformerTags === true)
    );
    this.forEachPost(
      newSettings.showSceneTags !== undefined,
      p => p.setShowSceneTags?.(updatedSettings.showSceneTags === true)
    );
    this.forEachPost(newSettings.reelAutoScroll !== undefined, p => p.setReelAutoScroll(newSettings.reelAutoScroll!));
    this.forEachPost(newSettings.showOCountButton !== undefined, p => p.setShowOCountButton(newSettings.showOCountButton!));
    this.forEachPost(newSettings.showRatingButton !== undefined, p => p.setShowRatingButton(newSettings.showRatingButton!));
    this.forEachPost(newSettings.showViewCountBadge !== undefined, p => p.setShowViewCountBadge(newSettings.showViewCountBadge!));
    this.forEachPost(
      newSettings.showBookmarkButton !== undefined,
      p => { if (p instanceof VideoPost) p.setShowBookmarkButton(newSettings.showBookmarkButton!); }
    );
  }

  private shouldReloadFeed(
    newSettings: Partial<FeedSettings>,
    previousSettings: FeedSettings,
    excludedTagsChanged: boolean,
    orientationFilterChanged: boolean
  ): boolean {
    const changed = <K extends keyof FeedSettings>(key: K): boolean =>
      newSettings[key] !== undefined && newSettings[key] !== previousSettings[key];

    const enabledFileTypesChanged = newSettings.enabledFileTypes !== undefined
      && !this.areStringListsEqual(newSettings.enabledFileTypes, previousSettings.enabledFileTypes ?? []);
    const galleryIdsChanged = newSettings.galleryIds !== undefined
      && !this.areStringListsEqual(newSettings.galleryIds, previousSettings.galleryIds ?? []);

    return !!(
      changed('hdMode') ||
      changed('includeMarkersInFeed') ||
      changed('includeImagesInFeed') ||
      changed('includeRandomInFeed') ||
      changed('randomIncludeScenesWithMarkers') ||
      enabledFileTypesChanged ||
      changed('imagesOnly') ||
      changed('includeShortForm') ||
      changed('shortFormMaxDuration') ||
      changed('includeScenePreviews') ||
      changed('imagesInGalleryOnly') ||
      galleryIdsChanged ||
      changed('contentLimit') ||
      changed('includeSubtags') ||
      changed('seenHistorySize') ||
      orientationFilterChanged ||
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

  private applySceneTagSettingToFilters(filters: FilterOptions): void {
    filters.includeSceneTagsInMarkerFilter = this.settings.showSceneTags ?? false;
    filters.showPerformerTags = this.settings.showPerformerTags ?? false;
  }


  // Tag/exclude filtering is fully server-side (StashAPI.applyRoutedTags / applyExcludedTags /
  // buildImageFilter route every selected tag to one field and exclude across enabled fields), so
  // there is no client-side tag or exclude post-filter — that would desync the displayed length
  // from the server count and break pagination. Marker title search (filterMarkersByName) is the
  // only remaining client filter, since Stash has no marker-title filter field.

  private getSeenCache(): { ids: string[]; set: Set<string> } {
    if (this.seenSetCache) return this.seenSetCache;
    try {
      const raw = localStorage.getItem(FeedContainer.SEEN_IDS_KEY);
      // Keys are "<type>:<id>"; bare legacy ids could match an unrelated item of another type.
      const ids: string[] = raw ? (JSON.parse(raw) as string[]).filter((k) => k.includes(':')) : [];
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

  /** Marker, scene and image ids are separate sequences, so seen keys carry the content type. */
  private static seenKey(type: 'marker' | 'image', id: string): string {
    return `${type}:${id}`;
  }

  private markItemSeen(type: 'marker' | 'image', itemId: string): void {
    const id = FeedContainer.seenKey(type, itemId);
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
    append: boolean,
    savedFilterActive: boolean
  ): Array<{ type: 'marker' | 'image'; data: SceneMarker | Image; date?: string }> {
    const maxSeen = this.settings.seenHistorySize ?? 500;
    // A saved filter is a curated pool the user explicitly picked: never thin it out by history.
    if (maxSeen === 0 || savedFilterActive) return content;
    const seen = this.getSeenSet();
    if (seen.size === 0) return content;
    const unseen = content.filter(item => !seen.has(FeedContainer.seenKey(item.type, (item.data as { id: string }).id)));
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

    // Apply to every existing player, then re-apply audio to the active card.
    this.applyGlobalMuteState();
    this.playback?.setGlobalMute(isMuted);
    this.updateAllMuteButtons();
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
   * Initialize playback and favorites managers
   */
  private initializeManagers(): void {
    // Reel playback: one active card at a time, driven by ReelScroller.
    this.playback = new ReelPlaybackController({
      getOrderedPostIds: () => this.postOrder,
      getPost: (postId: string) => this.posts.get(postId),
    });
    this.playback.setGlobalMute(this.globalMuteState);

    // Apply global mute state to all existing players and update mute buttons
    // This ensures the loaded state is applied to any posts that were created before managers were initialized
    this.applyGlobalMuteState();
    this.updateAllMuteButtons();

    // Initialize favorites and bookmark managers
    this.favoritesManager = new FavoritesManager(this.api);
    this.bookmarkManager = new BookmarkManager(this.api);

    // Initialize discovery panel (opt-out via setting; hidden on mobile)
    if (this.settings.enableDiscoveryPanel === true && !isMobileDevice()) {
      this.createDiscoveryPanel();
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

          // Try to play the active card now that autoplay is unlocked
          setTimeout(() => {
            this.playback.retryActive();
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

    // A real user gesture lifts the browser's autoplay restrictions. Re-run the
    // play decision on gesture so any video the browser refused to autoplay starts.
    const handler = () => {
      this.playback?.retryActive();
    };

    this.autoplayUnlockHandler = handler;
    for (const event of this.mobileAutoplayUnlockEvents) {
      document.addEventListener(event, handler, { passive: true });
    }

    // Resume the active card when the page comes back to the foreground.
    // Mobile browsers (especially iOS Safari) pause all media when backgrounded,
    // but never auto-resume — we need to call play() ourselves.
    if (!this.visibilityResumeHandler) {
      const visibilityHandler = () => {
        if (document.visibilityState === 'visible') {
          this.playback?.retryActive();
        }
      };
      this.visibilityResumeHandler = visibilityHandler;
      document.addEventListener('visibilitychange', visibilityHandler);
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

    if (this.visibilityResumeHandler) {
      document.removeEventListener('visibilitychange', this.visibilityResumeHandler);
      this.visibilityResumeHandler = undefined;
    }
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

  private createPillButton(label: string, onSelect: () => void | Promise<void>, iconSvg?: string): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'feed-pill-button';
    if (iconSvg) button.innerHTML = iconSvg; // trusted markup from icons.ts
    button.append(label);
    this.attachSuggestionClickHandler(button, onSelect);
    return button;
  }

  /**
   * Create list button element
   */
  private createListButton(
    label: string,
    onSelect: () => void | Promise<void>,
    options: { subtitle?: string; leadingText?: string; leadingIcon?: string; leadingImage?: string; imageObjectFit?: string } = {}
  ): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'feed-list-button';

    if (options.leadingText || options.leadingIcon || options.leadingImage) {
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
      } else if (options.leadingIcon) {
        leading.innerHTML = options.leadingIcon; // trusted markup from icons.ts
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
    filter: SavedFilter,
    updateSearchBarDisplay: () => void,
    withScroll: boolean
  ): void {
    this.selectedSavedFilter = filter;
    this.selectedTagIds.clear();
    this.selectedPerformerIds.clear();
    this.selectedMarkerName = undefined;
    this.closeSuggestions();
    updateSearchBarDisplay();
    this.currentFilters = { savedFilterId: filter.id, savedFilterMode: filter.mode, limit: FeedContainer.CONTENT_LOAD_LIMIT, offset: 0 };
    this.pushFilterHistory();
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
    filtersSection.appendChild(this.createSectionLabel('Saved Filters', true));

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
    }, HEART_SVG_OUTLINE));

    for (const filter of this.getApplicableSavedFilters()) {
      pillRow.appendChild(this.createPillButton(
        filter.name,
        () => this.applySavedFilter(filter, updateSearchBarDisplay, true),
        filter.mode === 'IMAGES' ? IMAGE_SVG : MARKER_SVG
      ));
    }

    filtersSection.appendChild(pillRow);
    container.appendChild(filtersSection);
  }

  // Generic words that surface all three date-range options; each option's own word
  // ("week"/"month"/"year") also surfaces just itself, so typing "week" works without "created".
  private static readonly DATE_RANGE_KEYWORDS = ['created', 'new', 'recent', 'recently'];
  private static readonly DATE_RANGE_OPTIONS: Array<{ label: string; value: DateRangeFilter; word: string }> = [
    { label: 'This Week', value: 'week', word: 'week' },
    { label: 'This Month', value: 'month', word: 'month' },
    { label: 'This Year', value: 'year', word: 'year' },
  ];

  private matchingDateRangeOptions(trimmedText: string): Array<{ label: string; value: DateRangeFilter }> {
    const q = trimmedText.toLowerCase();
    if (!q) return [];
    const genericMatch = FeedContainer.DATE_RANGE_KEYWORDS.some((k) => k.startsWith(q));
    return FeedContainer.DATE_RANGE_OPTIONS.filter((opt) => genericMatch || opt.word.startsWith(q));
  }

  /**
   * Create "created within" date-range section, shown only when the typed search text
   * matches a date keyword (e.g. "created", "recent", "week") — kept out of the default
   * dropdown so it doesn't add permanent clutter.
   */
  private createMatchingDateRangeSection(
    container: HTMLElement,
    trimmedText: string,
    updateSearchBarDisplay: () => void
  ): void {
    const matches = this.matchingDateRangeOptions(trimmedText);
    if (matches.length === 0) return;

    const dateSection = document.createElement('div');
    dateSection.style.display = 'flex';
    dateSection.style.flexDirection = 'column';
    dateSection.style.gap = '8px';
    dateSection.appendChild(this.createSectionLabel('Created'));

    for (const option of matches) {
      dateSection.appendChild(this.createListButton(`Created ${option.label}`, () => {
        this.selectedDateRange = option.value;
        this.closeSuggestions();
        updateSearchBarDisplay();
        this.debouncedApplyFilters();
      }));
    }

    container.appendChild(dateSection);
  }

  private createSavedSearchesSection(
    container: HTMLElement,
    updateSearchBarDisplay: () => void
  ): void {
    const searches = this.settingsManager.data.settings.savedSearches ?? [];
    if (searches.length === 0) return;

    const section = document.createElement('div');
    section.style.display = 'flex';
    section.style.flexDirection = 'column';
    section.style.gap = '12px';
    section.appendChild(this.createSectionLabel('My Searches', true));

    const pillRow = document.createElement('div');
    pillRow.style.display = 'flex';
    pillRow.style.flexWrap = 'wrap';
    pillRow.style.gap = '8px';

    for (const search of searches) {
      const wrapper = document.createElement('div');
      wrapper.style.display = 'flex';
      wrapper.style.alignItems = 'center';
      wrapper.style.gap = '2px';

      const pill = this.createPillButton(search.name, () => {
        this.applyCustomSavedSearch(search);
        updateSearchBarDisplay();
      });

      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = '×';
      del.setAttribute('aria-label', `Delete saved search "${search.name}"`);
      Object.assign(del.style, {
        background: 'transparent',
        border: 'none',
        color: 'inherit',
        opacity: '0.5',
        cursor: 'pointer',
        fontSize: '16px',
        lineHeight: '1',
        padding: '4px 2px',
        minWidth: '20px',
        minHeight: '44px',
      });
      del.addEventListener('mouseenter', () => { del.style.opacity = '1'; });
      del.addEventListener('mouseleave', () => { del.style.opacity = '0.5'; });
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteCustomSavedSearch(search.id);
        wrapper.remove();
      });

      wrapper.append(pill, del);
      pillRow.appendChild(wrapper);
    }

    section.appendChild(pillRow);
    container.appendChild(section);
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

  /**
   * Create markers section — lists markers by title. Selecting one runs a
   * free-text title search (via filters.query) showing all matching markers.
   */
  private createMarkersSection(
    container: HTMLElement,
    markers: Array<{ id: string; title: string }>,
    label: string = 'Title'
  ): void {
    if (markers.length === 0) return;
    const markersSection = document.createElement('div');
    markersSection.style.display = 'flex';
    markersSection.style.flexDirection = 'column';
    markersSection.style.gap = '8px';
    markersSection.appendChild(this.createSectionLabel(label));
    for (const marker of markers) {
      const btn = this.createListButton(
        marker.title,
        () => this.applyMarkerTitleSearch(marker.title),
        { leadingText: '▶' }
      );
      markersSection.appendChild(btn);
    }
    container.appendChild(markersSection);
  }

  /**
   * Run a marker title search. Bypasses resolveQueryToFilters (which would coerce
   * the text into a tag/performer chip) and instead passes the title straight
   * through as filters.query → findSceneMarkers `q`.
   */
  private applyMarkerTitleSearch(title: string): void {
    this.selectedSavedFilter = undefined;
    this.selectedTagIds.clear();
    this.selectedPerformerIds.clear();
    this.selectedStudioIds.clear();
    this.selectedMarkerName = title;
    this.closeSuggestions();

    const queryInput = this.container.querySelector<HTMLInputElement>('.feed-filters__input');
    if (queryInput) queryInput.value = '';
    this.updateActivePills();

    this.currentFilters = {
      query: title,
      limit: FeedContainer.CONTENT_LOAD_LIMIT,
      offset: 0,
      tagDepth: this.settings.includeSubtags ? -1 : 0,
      studioDepth: this.settings.includeSubtags ? -1 : 0,
    };
    this.pushFilterHistory();
    this.scrollToTop();
    this.loadVideos(this.currentFilters, false).catch((e) => console.error('Apply marker search failed', e));
  }

  /**
   * Restrict markers to those whose title exactly matches the active marker-name
   * filter. Stash's SceneMarkerFilterType has no title field, so the `query`/`q`
   * narrows server-side (fuzzy) and this enforces "only markers with that name".
   */
  private filterMarkersByName(markers: SceneMarker[]): SceneMarker[] {
    if (!this.selectedMarkerName) return markers;
    const target = this.selectedMarkerName.trim().toLowerCase();
    return markers.filter((marker) => (marker.title ?? '').trim().toLowerCase() === target);
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

    this.createSavedSearchesSection(container, updateSearchBarDisplay);
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
      if (this.preloadedTags.length > 0 && this.preloadedPerformers.length > 0) {
        // Reuse the background-preloaded pool (reshuffled for variety) instead of two requests per open.
        freshTags = this.shuffleArray([...this.preloadedTags]).slice(0, 3);
        freshPerformers = this.shuffleArray([...this.preloadedPerformers]).slice(0, 3);
      } else {
        [freshTags, freshPerformers] = await Promise.all([
          this.api.searchMarkerTags('', 3),
          this.api.searchPerformers('', 3)
        ]);
        if (!ensureLatest()) return;
      }
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

    const matchingSavedFilters = this.getApplicableSavedFilters()
      .filter((filter) => filter.name.toLowerCase().includes(trimmedText.toLowerCase()))
      .slice(0, 6);

    if (matchingSavedFilters.length > 0) {
      const savedSection = document.createElement('div');
      savedSection.style.display = 'flex';
      savedSection.style.flexDirection = 'column';
      savedSection.style.gap = '8px';
      savedSection.appendChild(this.createSectionLabel('Matching Saved Filters'));
      for (const filter of matchingSavedFilters) {
        const btn = this.createListButton(
          filter.name,
          () => this.applySavedFilter(filter, updateSearchBarDisplay, false),
          { leadingIcon: filter.mode === 'IMAGES' ? IMAGE_SVG : MARKER_SVG }
        );
        btn.dataset.savedFilter = 'true';
        savedSection.appendChild(btn);
      }
      container.appendChild(savedSection);
    }

    this.createMatchingDateRangeSection(container, trimmedText, updateSearchBarDisplay);

    let tagItems: Array<{ id: string; name: string }> = [];
    let performerItems: Array<{ id: string; name: string; image_path?: string }> = [];
    let studioItems: Array<{ id: string; name: string; image_path?: string }> = [];
    let markerItems: Array<{ id: string; title: string }> = [];

    const searchMarkers = this.settings.searchMarkersByName === true;

    // Cancel the previous keystroke's queries rather than letting 3-4 stale requests finish.
    this.suggestionAbortController?.abort();
    const suggestionSignal = (this.suggestionAbortController = new AbortController()).signal;

    try {
      [tagItems, performerItems, studioItems, markerItems] = await Promise.all([
        this.api.searchMarkerTags(trimmedText, 20, suggestionSignal),
        this.api.searchPerformers(trimmedText, 20, suggestionSignal),
        this.api.searchStudios(trimmedText, 20, suggestionSignal),
        searchMarkers ? this.api.searchMarkersByTitle(trimmedText, 20, suggestionSignal) : Promise.resolve([]),
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

    if (searchMarkers) {
      const sortedMarkers = this.sortByMatchAccuracy(
        markerItems.map((m) => ({ ...m, name: m.title })),
        trimmedText
      ).slice(0, 20);
      this.createMarkersSection(container, sortedMarkers);
    }

    if (container.children.length === 0) {
      this.appendEmptyState(container, `No matches found for "${trimmedText}".`);
    }

    suggestions.scrollTop = 0;
  }

  private sortByMatchAccuracy<T extends { name: string; aliases?: string[] }>(items: T[], query: string): T[] {
    if (!query) return items;
    const q = query.toLowerCase();
    const score = (item: T): number => {
      const name = item.name.toLowerCase();
      if (name === q) return 0;
      if (name.startsWith(q)) return 1;
      const aliases = item.aliases ?? [];
      if (aliases.some((a) => a.toLowerCase() === q)) return 2;
      if (aliases.some((a) => a.toLowerCase().startsWith(q))) return 3;
      return 4;
    };
    return [...items].sort((a, b) => {
      const diff = score(a) - score(b);
      return diff === 0 ? a.name.toLowerCase().localeCompare(b.name.toLowerCase()) : diff;
    });
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
      this.selectedMarkerName = undefined;
      this.selectedSavedFilter = undefined;
      this.currentFilters = undefined;
      this.pushFilterHistory();

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
    // A bare, unnamed lone text input trips Chrome's "this is a username field"
    // heuristic and it offers saved-password autofill. Name it, label it and opt
    // out of autofill so it reads as the search box it is.
    queryInput.name = 'stashgifs-feed-search';
    queryInput.setAttribute('autocomplete', 'off');
    queryInput.setAttribute('autocapitalize', 'none');
    queryInput.setAttribute('autocorrect', 'off');
    queryInput.spellcheck = false;
    queryInput.setAttribute('aria-label', 'Search performers, tags and filters');
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
      void this.openSettings();
    });

    return settingsButton;
  }

  /**
   * Open settings page
   */
  private async openSettings(): Promise<void> {
    if (this.isOpeningSettings) return; // a second click while the chunk loads must not build a second modal
    this.isOpeningSettings = true;
    let SettingsPageCtor: typeof SettingsPage;
    try {
      // Lazy: SettingsPage is large and only needed when the modal opens.
      ({ SettingsPage: SettingsPageCtor } = await import('./SettingsPage.js'));
    } catch (error) {
      console.error('Failed to load settings', error);
      showToast('Failed to open settings. Please reload the page.');
      return;
    } finally {
      this.isOpeningSettings = false;
    }
    if (!this.settingsContainer) {
      this.settingsContainer = document.createElement('div');
      document.body.appendChild(this.settingsContainer);
    }

    this.settingsPage = new SettingsPageCtor(
      this.settingsContainer,
      this.settings,
      (signal) => this.api.findGalleries(signal),
      (newSettings) => this.handleSettingsChange(newSettings),
      () => {
        this.settingsContainer?.remove();
        this.settingsContainer = undefined;
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
      this.applyReelHeaderStyles();
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
      savedFilterMode: this.selectedSavedFilter?.mode,
      limit: FeedContainer.CONTENT_LOAD_LIMIT,
      offset: 0,
      tagDepth: this.settings.includeSubtags ? -1 : 0,
      studioDepth: this.settings.includeSubtags ? -1 : 0,
      dateRangeFilter: this.selectedDateRange,
    };
    this.currentFilters = newFilters;
    this.pushFilterHistory();
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
      query: this.selectedMarkerName,
      tags: filterValues.tags,
      performers: filterValues.performers,
      studios: filterValues.studios,
      savedFilterId: this.selectedSavedFilter?.id || undefined,
      savedFilterMode: this.selectedSavedFilter?.mode,
      limit: FeedContainer.CONTENT_LOAD_LIMIT,
      offset: 0,
      tagDepth: this.settings.includeSubtags ? -1 : 0,
      studioDepth: this.settings.includeSubtags ? -1 : 0,
      dateRangeFilter: this.selectedDateRange,
    };
    this.currentFilters = newFilters;
    this.pushFilterHistory();
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

  private appendMarkerNamePill(): void {
    if (!this.selectedMarkerName) return;
    this.activePillsBar!.appendChild(this.createActivePill(`▶ ${this.selectedMarkerName}`, () => {
      this.selectedMarkerName = undefined;
      this.updateActivePills();
      this.updateQueryInputDisplay();
      this.debouncedApplyFilters();
    }));
  }

  private static readonly DATE_RANGE_LABELS: Record<DateRangeFilter, string> = {
    week: 'This Week',
    month: 'This Month',
    year: 'This Year',
  };

  private appendDateRangePill(): void {
    if (!this.selectedDateRange) return;
    this.activePillsBar!.appendChild(this.createActivePill(
      `📅 ${FeedContainer.DATE_RANGE_LABELS[this.selectedDateRange]}`,
      () => {
        this.selectedDateRange = undefined;
        this.updateActivePills();
        this.debouncedApplyFilters();
      }
    ));
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

    const total = this.selectedTagIds.size + this.selectedPerformerIds.size + this.selectedStudioIds.size
      + (this.selectedMarkerName ? 1 : 0) + (this.selectedDateRange ? 1 : 0);
    if (total === 0) {
      this.activePillsBar.style.display = 'none';
      return;
    }

    this.activePillsBar.style.display = 'flex';
    this.appendMarkerNamePill();
    this.appendDateRangePill();
    this.appendTagPills();
    this.appendPerformerPills();
    this.appendStudioPills();

    if (this.saveSearchInputVisible) {
      this.activePillsBar.appendChild(this.buildSaveSearchInput());
    } else {
      const saveBtn = this.createActivePill('Save', () => this.showSaveSearchInput(), true);
      this.activePillsBar.appendChild(saveBtn);
    }

    if (total >= 2) {
      const clearAll = this.createActivePill('Clear all', () => {
        this.selectedTagIds.clear();
        this.selectedPerformerIds.clear();
        this.selectedStudioIds.clear();
        this.selectedMarkerName = undefined;
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

  private showSaveSearchInput(): void {
    this.saveSearchInputVisible = true;
    this.updateActivePills();
    // Focus the input we just rendered
    const input = this.activePillsBar?.querySelector<HTMLInputElement>('.feed-save-search-input');
    input?.focus();
  }

  private buildSaveSearchInput(): HTMLElement {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      flexShrink: '0',
    });

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Name this search…';
    input.className = 'feed-save-search-input';
    // Same anti-credential-autofill treatment as the main search input.
    input.name = 'stashgifs-save-search-name';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('aria-label', 'Name this search');
    Object.assign(input.style, {
      height: '28px',
      padding: '0 8px',
      borderRadius: '14px',
      border: `1px solid ${THEME.colors.border}`,
      background: THEME.colors.backgroundSecondary,
      color: THEME.colors.textPrimary,
      fontSize: THEME.typography.sizeMeta,
      fontFamily: THEME.typography.fontFamily,
      outline: 'none',
      width: '140px',
      minWidth: '0',
    });

    const confirm = (): void => {
      const name = input.value.trim();
      this.saveSearchInputVisible = false;
      if (name) this.saveCurrentSearch(name);
      this.updateActivePills();
    };

    const cancel = (): void => {
      this.saveSearchInputVisible = false;
      this.updateActivePills();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); confirm(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });

    // blur → cancel only if confirm wasn't already triggered
    input.addEventListener('blur', () => {
      if (this.saveSearchInputVisible) cancel();
    });

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.textContent = '✓';
    confirmBtn.setAttribute('aria-label', 'Save search');
    // mousedown before blur so the value is captured
    confirmBtn.addEventListener('mousedown', (e) => { e.preventDefault(); });
    confirmBtn.addEventListener('click', confirm);
    Object.assign(confirmBtn.style, {
      height: '28px',
      width: '28px',
      borderRadius: '50%',
      border: 'none',
      background: THEME.colors.accentPrimary,
      color: '#fff',
      cursor: 'pointer',
      fontSize: '14px',
      flexShrink: '0',
    });

    wrap.append(input, confirmBtn);
    return wrap;
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
    window.addEventListener('popstate', this.onPopState);
    const initialSnapshot = this.captureSnapshot();
    this.lastSnapshotJson = JSON.stringify(initialSnapshot);
    history.replaceState({ filterSnapshot: initialSnapshot }, '');

    // Load rating system configuration in parallel with the first feed fetch; posts only
    // need it at render time, so loadVideos awaits ratingConfigReady before building them.
    this.ratingConfigReady = this.api.getUIConfiguration()
      .then((config) => { this.ratingSystemConfig = config || { type: 'stars', starPrecision: 'full' }; })
      .catch((error) => {
        console.warn('Failed to load rating system configuration, using defaults', error);
        this.ratingSystemConfig = { type: 'stars', starPrecision: 'full' }; // Default fallback
      });
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
        this.api.searchPerformers('', 20),
        this.loadSavedFiltersIfNeeded()
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
  private prepareLoadVideos(signal?: AbortSignal, append: boolean = false): AbortSignal {
    if (!append && this.activeLoadVideosAbortController) {
      // Fresh load: cancel the previous batch and its in-flight image lazy-load observers.
      // (clearPosts() in initializeLoadState also clears observers, so this only matters
      // for cancelling in-flight fetches.) On append we must NOT abort, or the previous
      // batch's not-yet-fired image observers would be orphaned and never load.
      this.activeLoadVideosAbortController.abort();
      this.cleanupLoadObservers();
      this.stopLoadingVideos();
      this.activeLoadVideosAbortController = undefined;
    }
    if (signal) {
      return signal;
    }
    // Reuse the live controller across appends so earlier batches' image observers
    // (which captured this signal) keep loading instead of being aborted/orphaned.
    this.activeLoadVideosAbortController ??= new AbortController();
    return this.activeLoadVideosAbortController.signal;
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
    // Guard against rendering an id that's already on screen (e.g. a paginated re-fetch
    // returned a duplicate): adding it twice would push a second entry into postOrder and a
    // second DOM card, desyncing index/next tracking. Skip it.
    const itemId = (item.data as { id: string }).id;
    if (this.posts.has(itemId)) {
      return { fragment: fragment ?? document.createDocumentFragment(), postContainer: null };
    }

    const result = item.type === 'marker'
      ? await this.processMarkerForRender(item.data as SceneMarker, fragment, signal)
      : await this.processImageForRender(item.data as Image, fragment, signal);
    if (result.postContainer) {
      this.markItemSeen(item.type, itemId);
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

    if (signal?.aborted) {
      return null;
    }

    // Set HQ mode if feed-level HD is enabled (mirroring regular marker behavior)
    if (this.useHDMode) {
      post.setHQMode(true);
    }

    // Loading is driven by ReelPlaybackController.activate() → post.preload() once
    // the reel scroller settles on this card — no separate per-post load observer.
    return postContainer;
  }

  /**
   * Build the common options shared by all post constructors
   */
  private buildCommonPostOptions() {
    return {
      favoritesManager: this.favoritesManager,
      api: this.api,
      onPlayerReady: (postId: string) => this.playback?.onPlayerReady(postId),
      onPauseAll: () => this.playback?.pauseAll(),
      onPerformerChipClick: (performerId: number, performerName: string) => { this.handlePerformerChipClick(performerId, performerName); },
      onTagChipClick: (tagId: number, tagName: string) => { this.handleTagChipClick(tagId, tagName); },
      onStudioChipClick: (studioId: number, studioName: string) => { this.handleStudioChipClick(studioId, studioName); },
      showVerifiedCheckmarks: this.settings.showVerifiedCheckmarks !== false,
      showProductionAge: this.settings.showProductionAge === true,
      showStudioChips: this.settings.showStudioChips !== false,
      showPerformerEmbellishment: this.settings.showPerformerEmbellishment === true,
      showMalePerformers: this.settings.showMalePerformers !== false,
      showFemalePerformers: this.settings.showFemalePerformers !== false,
      showOtherGenderPerformers: this.settings.showOtherGenderPerformers !== false,
      showSceneTitle: this.settings.showSceneTitle === true,
      showPerformerTags: this.settings.showPerformerTags === true,
      showSceneTags: this.settings.showSceneTags === true,
      tagDisplayLimit: this.settings.tagDisplayLimit ?? 10,
      performerDisplayLimit: this.settings.performerDisplayLimit ?? 3,
      showMarkerTitle: this.settings.searchMarkersByName === true,
      showBookmarkButton: this.settings.showBookmarkButton === true,
      showOCountButton: this.settings.showOCountButton !== false,
      showRatingButton: this.settings.showRatingButton !== false,
      showViewCountBadge: this.settings.showViewCountBadge !== false,
      ratingSystemConfig: this.ratingSystemConfig,
      hdModeFromSettings: this.useHDMode,
      discoveryPanel: this.discoveryPanel,
      reelAutoScroll: this.settings.reelAutoScroll === true,
      onReelAdvance: () => this.reelScroller?.next(),
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
    const baseUrl = getStashBaseUrl();
    
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
   * Initialize load state for video loading
   */
  private initializeLoadState(append: boolean): void {
    this.isLoading = true;
    this.hideError();
    if (!append) {
      // Clear all cached content when starting a new search/filter
      this.clearPosts();
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

    return this.finalizeMarkersResult(result, currentFilters);
  }

  /** Shared tail for marker-fetching loaders: persist a regenerated sortSeed back onto the filters, then apply the client-side name filter. */
  private finalizeMarkersResult<T extends { sortSeed?: string; markers: SceneMarker[] }>(
    result: T,
    currentFilters: FilterOptions
  ): T & { markers: SceneMarker[] } {
    if (result.sortSeed && currentFilters) {
      currentFilters.sortSeed = result.sortSeed;
    }

    return {
      ...result,
      markers: this.filterMarkersByName(result.markers),
    };
  }

  /**
   * Handle empty markers result
   */
  private handleEmptyMarkers(append: boolean): void {
    if (append) {
      this.scheduleAppendRetry();
    } else {
      // Fresh load returned nothing — mark done so updateEndCard shows the end card.
      this.hasMore = false;
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
      // First batch rendered: align to the first card and start it playing.
      requestAnimationFrame(() => {
        this.reelScroller?.realign();
        this.ensureReelInitialCardLoaded();
      });
    }
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
    
    // Refresh depth fields so a settings change (e.g. includeSubtags toggle) takes effect
    // even when currentFilters was built before the setting changed.
    if (this.currentFilters && !this.currentFilters.savedFilterId) {
      this.currentFilters.tagDepth = this.settings.includeSubtags ? -1 : 0;
      this.currentFilters.studioDepth = this.settings.includeSubtags ? -1 : 0;
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
    shouldLoadScenePreviews: boolean;
  } {
    // Use provided filters or fall back to currentFilters
    const activeFilters = filters || this.currentFilters || {};

    // A saved filter only applies to its own content type (markers or images); a marker-name
    // search only to markers — other content types ignore them and would pollute results.
    if (activeFilters.savedFilterId && activeFilters.savedFilterMode === 'IMAGES') {
      return {
        shouldLoadMarkers: false,
        shouldLoadImages: true,
        shouldLoadShortForm: false,
        shouldLoadRandom: false,
        shouldLoadScenePreviews: false
      };
    }
    const isUsingSavedFilter = !!(activeFilters.savedFilterId);
    const isMarkerNameSearch = !!this.selectedMarkerName;

    if (isUsingSavedFilter || isMarkerNameSearch) {
      return {
        shouldLoadMarkers: true,
        shouldLoadImages: false,
        shouldLoadShortForm: false,
        shouldLoadRandom: false,
        shouldLoadScenePreviews: false
      };
    }

    const shortFormEnabledForCurrentMode = this.shouldLoadShortFormContent();
    const shouldLoadShortForm = shortFormEnabledForCurrentMode;
    const shouldLoadMarkers = this.settings.includeMarkersInFeed !== false;
    const shouldLoadImages = this.shouldLoadImages();
    const shouldLoadRandom = this.settings.includeRandomInFeed === true;
    const shouldLoadScenePreviews = this.settings.includeScenePreviews === true;

    return {
      shouldLoadMarkers,
      shouldLoadImages,
      shouldLoadShortForm,
      shouldLoadRandom,
      shouldLoadScenePreviews
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
      shouldLoadScenePreviews: boolean;
    };
    append: boolean;
  }): Promise<{
    markers: SceneMarker[];
    images: Image[];
    shortFormMarkers: SceneMarker[];
    randomMarkers: SceneMarker[];
    scenePreviewMarkers: SceneMarker[];
    markerCount: number;
    imageCount: number;
    shortFormCount: number;
    randomCount: number;
    scenePreviewCount: number;
  }> {
    const { currentFilters, limits, signal, loadingFlags, append } = options;
    const { limit, markerLimit, shortFormLimit } = limits;
    const { shouldLoadMarkers, shouldLoadImages, shouldLoadShortForm, shouldLoadRandom, shouldLoadScenePreviews } = loadingFlags;

    this.ensureSortSeed(currentFilters);

    const { markerPageSize, imagePageSize } = this.calculatePaginationForContent(append, markerLimit, limit);
    const { markerOffset, imageOffset, shortFormOffset, scenePreviewOffset } = this.getLoadOffsets(append);

    const fetchStart = performance.now();
    const [markersResult, imagesResult, shortFormResult, randomResult, scenePreviewResult] = await Promise.all([
      this.fetchMarkersIfNeeded({ currentFilters, markerPageSize, markerOffset, signal, shouldLoadMarkers }),
      this.fetchImagesIfNeeded({ currentFilters, imagePageSize, imageOffset, signal, shouldLoadImages }),
      this.fetchShortFormIfNeeded({ currentFilters, shortFormLimit, shortFormOffset, signal, shouldLoadShortForm }),
      this.fetchRandomIfNeeded({ currentFilters, limit, signal, shouldLoadRandom }),
      this.fetchScenePreviewsIfNeeded({ currentFilters, scenePreviewLimit: limit, scenePreviewOffset, signal, shouldLoadScenePreviews })
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
    this.updateScenePreviewOffsetIfNeeded(shouldLoadScenePreviews, append, scenePreviewResult);

    return {
      markers: markersResult.markers,
      images: imagesResult.images,
      shortFormMarkers: shortFormResult.markers,
      randomMarkers: randomResult.markers,
      scenePreviewMarkers: scenePreviewResult.markers,
      markerCount: markersResult.totalCount,
      imageCount: imagesResult.totalCount,
      shortFormCount: shortFormResult.totalCount,
      randomCount: randomResult.totalCount,
      scenePreviewCount: scenePreviewResult.totalCount,
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
    scenePreviewOffset: number;
  } {
    return {
      markerOffset: append ? this.markersLoadedCount : 0,
      imageOffset: append ? this.imagesLoadedCount : 0,
      shortFormOffset: append ? this.shortFormUnfilteredOffset : 0,
      scenePreviewOffset: append ? this.scenePreviewUnfilteredOffset : 0
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
      markers: this.filterMarkersByName(result.markers),
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

  private async fetchScenePreviewsIfNeeded(options: {
    currentFilters: FilterOptions;
    scenePreviewLimit: number;
    scenePreviewOffset: number;
    signal: AbortSignal | undefined;
    shouldLoadScenePreviews: boolean;
  }): Promise<{ markers: SceneMarker[]; totalCount: number; unfilteredOffsetConsumed?: number }> {
    const { currentFilters, scenePreviewLimit, scenePreviewOffset, signal, shouldLoadScenePreviews } = options;
    if (!shouldLoadScenePreviews) {
      return { markers: [], totalCount: 0, unfilteredOffsetConsumed: 0 };
    }
    return this.fetchScenePreviewVideosForLoad(currentFilters, scenePreviewLimit, scenePreviewOffset, signal);
  }

  /**
   * Fetch scene-preview videos for loading
   */
  private async fetchScenePreviewVideosForLoad(
    currentFilters: FilterOptions,
    limit: number,
    offset: number,
    signal?: AbortSignal
  ): Promise<{ markers: SceneMarker[]; totalCount: number; unfilteredOffsetConsumed: number }> {
    if (!this.api) {
      return { markers: [], totalCount: 0, unfilteredOffsetConsumed: 0 };
    }

    const result = await this.api.fetchScenePreviews(currentFilters, limit, offset, signal);
    return this.finalizeMarkersResult(result, currentFilters);
  }

  private updateScenePreviewOffsetIfNeeded(
    shouldLoadScenePreviews: boolean,
    append: boolean,
    scenePreviewResult: { unfilteredOffsetConsumed?: number }
  ): void {
    if (!shouldLoadScenePreviews) {
      return;
    }
    this.updateScenePreviewUnfilteredOffset(append, scenePreviewResult);
  }

  private updateScenePreviewUnfilteredOffset(
    append: boolean,
    scenePreviewResult: { unfilteredOffsetConsumed?: number }
  ): void {
    const unfilteredOffsetConsumed = scenePreviewResult.unfilteredOffsetConsumed;
    if (typeof unfilteredOffsetConsumed !== 'number') {
      return;
    }

    const scenesPerPage = 24;
    if (append) {
      const page = Math.floor(this.scenePreviewUnfilteredOffset / scenesPerPage) + 1;
      this.scenePreviewUnfilteredOffset = (page - 1) * scenesPerPage + unfilteredOffsetConsumed;
      return;
    }

    this.scenePreviewUnfilteredOffset = unfilteredOffsetConsumed;
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
      scenePreviewMarkers: SceneMarker[];
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
    const { markers, shortFormMarkers, scenePreviewMarkers, images } = content;
    const { markerCount, shortFormCount, imageCount } = counts;

    // Merge regular markers, short-form markers, scene previews, and images, then filter seen items
    const mergedContent = this.filterSeenContent(this.mergeMarkersShortFormAndImages(markers, shortFormMarkers, images, scenePreviewMarkers), append, !!currentFilters.savedFilterId);

    const expectedLimit = currentFilters.limit || FeedContainer.CONTENT_LOAD_LIMIT;

    // Use real (non-synthetic) counts for pagination offsets so random markers
    // don't inflate markersLoadedCount and push regular marker queries past the pool.
    const trackableMarkers = realMarkersCount ?? markers.length;
    const trackableShortForm = realShortFormCount ?? shortFormMarkers.length;

    // Track loaded counts for each content type separately
    if (append) {
      this.markersLoadedCount += trackableMarkers;
      this.shortFormLoadedCount += trackableShortForm;
      this.scenePreviewLoadedCount += scenePreviewMarkers.length;
      this.imagesLoadedCount += images.length;
    } else {
      // Reset counts when starting fresh
      this.markersLoadedCount = trackableMarkers;
      this.shortFormLoadedCount = trackableShortForm;
      this.scenePreviewLoadedCount = scenePreviewMarkers.length;
      this.imagesLoadedCount = images.length;
    }

    const allMarkers = [...markers, ...shortFormMarkers, ...scenePreviewMarkers];
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
        totalContentLength: markers.length + shortFormMarkers.length + scenePreviewMarkers.length + images.length
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

    // Memory cleanup is driven solely by scheduleCleanupAfterScroll (debounced after the
    // user stops scrolling). Pruning synchronously here — right after appending to the
    // bottom while the user is scrolling toward those new cards — risked removing cards and
    // shifting layout mid-gesture; the debounced path runs only once the reel has settled.
    this.finalizeLoadState(append, page);
  }

  async loadVideos(filters?: FilterOptions, append: boolean = false, signal?: AbortSignal, force: boolean = false): Promise<void> {
    if (!force && this.isLoading) {
      return;
    }

    signal = this.prepareLoadVideos(signal, append);
    this.initializeLoadState(append);
    const reqId = ++this.latestLoadId;

    try {
      // Work on a shallow copy: ensureSortSeed/applyExcludedTags/applyOrientation and the
      // image fetch all mutate this object, so a superseded concurrent load must not be able
      // to corrupt the winning load's filters/sortSeed. The resolved copy is written back to
      // this.currentFilters below for pagination persistence.
      const currentFilters: FilterOptions = { ...(filters || this.currentFilters) };
      // Independent lookups: run together instead of back to back.
      await Promise.all([
        this.updateExcludedTagIds(),
        // Warm the tag→effective-source cache so the filter builders can route each selected tag to
        // the single server-side field that can match it (own ∪ descendants resolves parent tags).
        this.selectedTagIds.size > 0
          ? this.api.getTagSources([...this.selectedTagIds.keys()].map(String))
          : undefined,
      ]);
      this.applyExcludedTagsToFilters(currentFilters);
      this.applyOrientationFilterToFilters(currentFilters);
      this.applySceneTagSettingToFilters(currentFilters);
      const { limit, offset, page } = this.calculatePaginationParams(currentFilters, append);

      if (this.checkAbortAndCleanup(signal)) {
        return;
      }

      const { shouldLoadMarkers, shouldLoadImages, shouldLoadShortForm, shouldLoadRandom, shouldLoadScenePreviews } = this.determineContentLoadingFlags(currentFilters);

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
        scenePreviewMarkers,
        markerCount,
        imageCount,
        shortFormCount,
        randomCount,
        scenePreviewCount,
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
          shouldLoadRandom,
          shouldLoadScenePreviews
        },
        append
      });

      // Store currentFilters (with sortSeed) back to this.currentFilters for pagination persistence
      this.currentFilters = currentFilters;
      await this.ratingConfigReady;

      if (reqId !== this.latestLoadId || this.checkAbortAndCleanup(signal)) {
        return;
      }

      const allMarkersForContent = this.shuffleArray([...markers, ...shortFormMarkers, ...randomMarkers]);
      const mergedContent = await this.processFetchedContent({
        content: {
          markers: allMarkersForContent,
          shortFormMarkers: [],
          scenePreviewMarkers,
          images
        },
        counts: {
          markerCount: markerCount + randomCount,
          shortFormCount: shortFormCount + scenePreviewCount,
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

      const totalUnfiltered = markers.length + shortFormMarkers.length + randomMarkers.length + scenePreviewMarkers.length + images.length;
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
        [...allMarkersForContent, ...scenePreviewMarkers],
        shouldLoadMarkers || shouldLoadRandom || shouldLoadScenePreviews,
        currentFilters,
        append,
        signal,
        page
      );
    } catch (error: unknown) {
      this.handleLoadError(error, append);
    } finally {
      this.isLoading = false;
      // Only the winning load reconciles the end card — a superseded load's
      // hasMore is stale and would flicker it.
      if (reqId === this.latestLoadId) this.updateEndCard();
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
    } else if (!append && totalContentLength === 0) {
      // Fresh load returned nothing AND no count — could be a transient/raced fetch rather
      // than a truly empty feed. Don't latch hasMore=false (which bricks the feed until a
      // manual refresh); leave it true so the append path retries once. If the feed really
      // is empty, that retry hits the `append && 0 results` guard below and stops cleanly.
      this.hasMore = true;
      console.log('[hasMore] Fresh load returned 0 with no count — keeping hasMore true to retry');
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

    if (!append) {
      this.clearPosts();
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
    return this.settings.includeShortForm !== false;
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

    return this.finalizeMarkersResult(result, currentFilters);
  }

  private buildImageFilters(filters: FilterOptions): Record<string, unknown> {
    const { tagIds, performerIds, excludedTagIds, studioIds } = this.api.extractTagAndPerformerFilters(filters);

    const imageFilters: {
      performerIds?: number[];
      tagIds?: string[];
      excludedTagIds?: string[];
      studioIds?: string[];
      studioDepth?: number;
      tagDepth?: number;
    } = {};

    if (performerIds.length > 0) imageFilters.performerIds = performerIds;
    if (tagIds.length > 0) imageFilters.tagIds = tagIds;
    if (excludedTagIds.length > 0) imageFilters.excludedTagIds = excludedTagIds;
    if (studioIds.length > 0) imageFilters.studioIds = studioIds;
    imageFilters.studioDepth = this.settings.includeSubtags ? -1 : 0;
    imageFilters.tagDepth = this.settings.includeSubtags ? -1 : 0;

    return {
      ...imageFilters,
      ...(filters.savedFilterId && filters.savedFilterMode === 'IMAGES' ? { savedFilterId: filters.savedFilterId } : {}),
      ...(filters.orientationFilter && filters.orientationFilter.length > 0
        ? { orientationFilter: filters.orientationFilter }
        : {}),
      ...(filters.dateRangeFilter ? { dateRangeFilter: filters.dateRangeFilter } : {}),
      ...(filters.sortSeed ? { sortSeed: filters.sortSeed } : {}),
      ...(this.settings.imagesInGalleryOnly
        ? { imagesInGalleryOnly: true, galleryIds: this.settings.galleryIds ?? [] }
        : {}),
      ...(this.settings.showPerformerTags ? { showPerformerTags: true } : {}),
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
      const imageFiltersWithOrientation = this.buildImageFilters(filters);

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

      // Convert GraphQL Image to simplified Image type. No client-side tag/exclude filter — the
      // server query is exact, so the returned page IS the result (keeps pagination correct).
      const images = graphQLImages.map((img) => this.convertGraphQLImageToImage(img));
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
        birthdate: p.birthdate,
        rating100: p.rating100,
        stash_ids: p.stash_ids,
        tags: p.tags,
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
   * Check if only a single content type is present
   */
  private getSingleContentTypeResult(
    markers: SceneMarker[],
    shortFormMarkers: SceneMarker[],
    images: Image[],
    scenePreviewMarkers: SceneMarker[]
  ): Array<{ type: 'marker' | 'image'; data: SceneMarker | Image; date?: string }> | null {
    const videoMarkers = [...markers, ...shortFormMarkers, ...scenePreviewMarkers];

    // If only images
    if (videoMarkers.length === 0) {
      return this.createImageContentArray(images);
    }

    // If only video-shaped content (markers/shortform/scene previews, no images)
    if (images.length === 0) {
      return this.createMarkerContentArray(videoMarkers);
    }

    return null;
  }

  /**
   * Merge regular markers, short-form markers, images, and scene previews in a unified mix.
   * Interleaves markers/shortform and images as before; scene previews get their own
   * lower-frequency slot in the cycle.
   */
  private mergeMarkersShortFormAndImages(
    markers: SceneMarker[],
    shortFormMarkers: SceneMarker[],
    images: Image[],
    scenePreviewMarkers: SceneMarker[] = []
  ): Array<{ type: 'marker' | 'image'; data: SceneMarker | Image; date?: string }> {
    // If only one type, return it in original order
    const singleTypeResult = this.getSingleContentTypeResult(markers, shortFormMarkers, images, scenePreviewMarkers);
    if (singleTypeResult !== null) {
      return singleTypeResult;
    }

    // Multiple types present - mix all together proportionally
    return this.unifiedMixContent(markers, shortFormMarkers, images, scenePreviewMarkers);
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
   * Simple interleaving algorithm that mixes markers, shortform, images, and scene previews.
   * Shows 3-5 video items (markers/shortform), then up to 1 scene-preview clip (its own
   * lower-frequency slot), then 1-2 images, repeat. Prevents more than 3 consecutive
   * items of the same type for videos/images.
   */
  private unifiedMixContent(
    markers: SceneMarker[],
    shortFormMarkers: SceneMarker[],
    images: Image[],
    scenePreviewMarkers: SceneMarker[] = []
  ): Array<{ type: 'marker' | 'image'; data: SceneMarker | Image; date?: string }> {
    const content: Array<{ type: 'marker' | 'image'; data: SceneMarker | Image; date?: string }> = [];

    // Combine markers and shortform into single video array for simpler logic
    const allVideos = [...markers.map(m => ({ type: 'marker' as const, data: m })), ...shortFormMarkers.map(m => ({ type: 'marker' as const, data: m }))];

    const state = {
      videoIdx: 0,
      imageIdx: 0,
      scenePreviewIdx: 0,
      consecutiveCount: 0,
      lastType: null as ContentType | null,
      maxConsecutive: 3,
    };

    while (state.videoIdx < allVideos.length || state.imageIdx < images.length || state.scenePreviewIdx < scenePreviewMarkers.length) {
      // Determine chunk sizes: 3-5 videos, then up to 1 scene preview, then 1-2 images
      const videoChunkSize = 3 + Math.floor(Math.random() * 3); // 3-5
      const imageChunkSize = 1 + Math.floor(Math.random() * 2); // 1-2

      // Add video chunk
      this.addVideoChunk(content, allVideos, videoChunkSize, state);

      // Add scene-preview chunk (own, lower-frequency slot)
      this.addScenePreviewChunk(content, scenePreviewMarkers, 1, state);

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
   * Add a chunk of scene-preview items to the content array (its own, lower-frequency slot)
   */
  private addScenePreviewChunk(
    content: Array<{ type: 'marker' | 'image'; data: SceneMarker | Image; date?: string }>,
    scenePreviewMarkers: SceneMarker[],
    chunkSize: number,
    state: { scenePreviewIdx: number }
  ): void {
    for (let i = 0; i < chunkSize && state.scenePreviewIdx < scenePreviewMarkers.length; i++) {
      const marker = scenePreviewMarkers[state.scenePreviewIdx++];
      if (!marker) continue;

      content.push({
        type: 'marker',
        data: marker,
        date: marker.scene.date,
      });
    }
  }

  /**
   * Add remaining video/image items once the other has been exhausted. Scene previews are
   * drained separately, at most one per cycle, by addScenePreviewChunk — the loop in
   * unifiedMixContent keeps running (even after videos/images are empty) until they're gone,
   * which preserves their own lower-frequency pacing instead of dumping them all at once.
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
    // Also stop any loading videos
    this.stopLoadingVideos();
  }

  /**
   * Stop video elements that are currently loading
   */
  private stopLoadingVideos(): void {
    for (const [, post] of this.posts.entries()) {
      const player = post.getPlayer();
      if (isVideoPlayer(player)) {
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

    if (signal?.aborted) {
      return null;
    }

    // Loading is driven by ReelPlaybackController.activate() → post.preload() once
    // the reel scroller settles on this card — no separate per-post load observer.
    return postContainer;
  }

  /**
   * Get video URL for post based on HD mode
   */
  private getVideoUrlForPost(marker: SceneMarker): string | undefined {
    const isScenePreview = typeof marker.id === 'string' && marker.id.startsWith('scenepreview-');
    const selectedUrl = (this.useHDMode && !isScenePreview)
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
    // Shortform and scene previews play the whole scene (seconds=0, no end); other
    // synthetic markers default to a randomSnippetDuration-second clip from their random start position.
    const isShortForm = typeof marker.id === 'string' && marker.id.startsWith('shortform-');
    const isScenePreview = typeof marker.id === 'string' && marker.id.startsWith('scenepreview-');
    const postData: VideoPostData = {
      marker,
      videoUrl: safeVideoUrl,
      startTime: startTime,
      endTime: (isShortForm || isScenePreview) ? marker.end_seconds : (marker.end_seconds ?? (marker.seconds + (this.settings.randomSnippetDuration ?? 20))),
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
        bookmarkManager: this.bookmarkManager,
        onMarkerTitleChipClick: (title: string) => this.applyMarkerTitleSearch(title),
        trackWatchHistory: this.settings.trackWatchHistory !== false,
      }
    );
    
    post.initialize();

    // Short form content is always HD by default, even when feed-level HD mode is off.
    // Scene previews stay preview-only — they never upgrade to the full scene.
    if ((isShortForm || this.useHDMode) && !isScenePreview) {
      post.setHQMode(true);
    }
    
    return post;
  }

  /**
   * Clear all posts
   */
  private clearPosts(): void {
    for (const post of this.posts.values()) {
      post.destroy();
    }
    this.posts.clear();
    this.postOrder = [];
    this.endCard = undefined; // innerHTML reset below detaches it
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
    const rootMargin = isMobileDevice() ? '200px' : '600px';
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
    // appendChild on an existing child removes + reinserts it (layout + observer churn), so only move it if needed.
    if (this.loadMoreTrigger && this.postsContainer && this.postsContainer.lastElementChild !== this.loadMoreTrigger) {
      // Ensure trigger is at the bottom of posts
      this.postsContainer.appendChild(this.loadMoreTrigger);
    }
  }

  private getPerformersForPost(postId: string) {
    const post = this.posts.get(postId);
    return post?.getPerformers() ?? [];
  }

  private saveCurrentSearch(name: string): void {
    const existing = this.settingsManager.data.settings.savedSearches ?? [];
    const matchIndex = existing.findIndex((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase());

    const entry: SavedSearch = {
      id: matchIndex >= 0 ? existing[matchIndex]!.id : crypto.randomUUID(),
      name,
      tags: [...this.selectedTagIds.entries()],
      performers: [...this.selectedPerformerIds.entries()],
      studios: [...this.selectedStudioIds.entries()],
      markerName: this.selectedMarkerName,
    };

    const savedSearches = matchIndex >= 0
      ? existing.map((s, i) => (i === matchIndex ? entry : s))
      : [...existing, entry];
    this.settingsManager.save({ settings: { savedSearches } });
  }

  private applyCustomSavedSearch(search: SavedSearch): void {
    this.selectedTagIds.clear();
    this.selectedPerformerIds.clear();
    this.selectedStudioIds.clear();
    this.selectedMarkerName = undefined;
    this.selectedSavedFilter = undefined;
    for (const [id, name] of search.tags) this.selectedTagIds.set(id, name);
    for (const [id, name] of search.performers) this.selectedPerformerIds.set(id, name);
    for (const [id, name] of search.studios) this.selectedStudioIds.set(id, name);
    this.selectedMarkerName = search.markerName;
    this.closeSuggestions();
    this.updateActivePills();
    this.updateQueryInputDisplay();
    this.debouncedApplyFilters();
  }

  private captureSnapshot(): FilterSnapshot {
    return {
      tags: [...this.selectedTagIds.entries()],
      performers: [...this.selectedPerformerIds.entries()],
      studios: [...this.selectedStudioIds.entries()],
      markerName: this.selectedMarkerName,
      dateRange: this.selectedDateRange,
      savedFilter: this.selectedSavedFilter,
    };
  }

  private pushFilterHistory(): void {
    if (this.suppressHistoryPush) return;
    const snapshot = this.captureSnapshot();
    const json = JSON.stringify(snapshot);
    if (json === this.lastSnapshotJson) return; // dedupe consecutive identical states
    this.lastSnapshotJson = json;
    history.pushState({ filterSnapshot: snapshot }, ''); // same URL — reload-safe
  }

  private restoreSnapshot(snapshot: FilterSnapshot): void {
    this.selectedTagIds.clear();
    this.selectedPerformerIds.clear();
    this.selectedStudioIds.clear();
    for (const [id, name] of snapshot.tags) this.selectedTagIds.set(id, name);
    for (const [id, name] of snapshot.performers) this.selectedPerformerIds.set(id, name);
    for (const [id, name] of snapshot.studios) this.selectedStudioIds.set(id, name);
    this.selectedMarkerName = snapshot.markerName;
    this.selectedDateRange = snapshot.dateRange;
    this.selectedSavedFilter = snapshot.savedFilter;
    this.updateActivePills();
    this.updateQueryInputDisplay();
    this.applyFilters().catch((e) => console.error('Restore filters failed', e));
  }

  private readonly onPopState = (event: PopStateEvent): void => {
    const snapshot = (event.state as { filterSnapshot?: FilterSnapshot } | null)?.filterSnapshot;
    if (!snapshot) return; // not one of our entries
    this.suppressHistoryPush = true;
    this.lastSnapshotJson = JSON.stringify(snapshot);
    try {
      this.restoreSnapshot(snapshot);
    } finally {
      this.suppressHistoryPush = false;
    }
  };

  private deleteCustomSavedSearch(id: string): void {
    const existing = this.settingsManager.data.settings.savedSearches ?? [];
    this.settingsManager.save({ settings: { savedSearches: existing.filter(s => s.id !== id) } });
  }

  /**
   * Reconcile the synthetic end-of-feed card with the current hasMore state:
   * show it (as a full-viewport snap card just before the load-more trigger)
   * once there's content but nothing more to load, hide it otherwise.
   */
  private updateEndCard(): void {
    const container = this.postsContainer;
    if (!container) return;
    const shouldShow = !this.hasMore;
    const present = this.endCard?.parentNode === container;
    if (shouldShow && !present) {
      this.endCard = buildEndOfFeedCard(() => this.openSearchFromEndCard());
      if (this.loadMoreTrigger?.parentNode === container) {
        container.insertBefore(this.endCard, this.loadMoreTrigger);
      } else {
        container.appendChild(this.endCard);
      }
    } else if (!shouldShow && this.endCard) {
      this.endCard.remove();
      this.endCard = undefined;
    }
  }

  /** Open the header search UI from the end card's "Search for more?" button. */
  private openSearchFromEndCard(): void {
    // Focusing fires the input's focus handler, which opens the suggestions UI.
    this.headerBar?.querySelector<HTMLInputElement>('.feed-filters__input')?.focus();
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


  // Background video preloading was removed: videos now load only as they enter
  // the viewport (see LAZY_LOAD_ROOT_MARGIN), so nothing is fetched ahead of time.

  /**
   * Free memory by removing cards the user has already scrolled past.
   *
   * Only ever removes cards strictly BEHIND the current one (lower DOM index). The current
   * card, everything ahead, and a buffer behind are never touched — so the scroller's
   * current/next indices below the removal point don't move, nothing ahead/below shrinks,
   * and there's no oscillation or "lost track of next". The current card is re-aligned
   * once afterwards because native scroll-anchoring is disabled.
   */
  private cleanupDistantPosts(): void {
    const keepBehind = this.useHDMode ? 8 : 12;

    // Never prune mid-interaction: removing cards while the reel is snapping or the user is
    // mid-swipe would shift geometry under the gesture. Wait until it settles.
    if (this.reelScroller?.isBusy()) {
      return;
    }

    const currentIdx = this.getCurrentPostOrderIndex();
    if (currentIdx < 0) {
      return;
    }

    const firstToKeep = currentIdx - keepBehind;
    if (firstToKeep <= 0) {
      return; // nothing far enough behind to prune
    }

    const currentCard = this.posts.get(this.postOrder[currentIdx])?.getContainer();
    const removeIds = this.postOrder.slice(0, firstToKeep);

    for (const postId of removeIds) {
      this.removePost(postId);
    }

    // Deleting cards above shifts content up; re-anchor the current card explicitly (single
    // source of compensation now that native scroll-anchoring is off).
    if (currentCard?.parentNode) {
      this.reelScroller?.snapToCard(currentCard);
    }
  }

  /**
   * Index in postOrder of the card currently at the top of the viewport, or -1 if it
   * can't be determined. Prefers the reel scroller's geometry; falls back to the card
   * whose top is nearest the container top (same rule as the scroller) so every consumer
   * shares one definition of "current card".
   */
  private getCurrentPostOrderIndex(): number {
    const currentId = this.reelScroller?.getCurrentPostId() ?? this.getTopMostCardPostId();
    return currentId ? this.postOrder.indexOf(currentId) : -1;
  }

  /** Post id of the card whose top is nearest the scroll container's top edge. */
  private getTopMostCardPostId(): string | null {
    const cards = this.getAllCardContainers();
    if (cards.length === 0) {
      return null;
    }
    const containerTop = this.scrollContainer.getBoundingClientRect().top;
    let best: HTMLElement = cards[0];
    let bestDistance = Infinity;
    for (const card of cards) {
      const distance = Math.abs(card.getBoundingClientRect().top - containerTop);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = card;
      }
    }
    return this.getPostIdFromCard(best);
  }

  /**
   * Remove a single post and clean up all associated resources
   */
  private removePost(postId: string): void {
    const post = this.posts.get(postId);
    if (post) {
      this.destroyPostPlayer(post);
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
    if (isVideoPlayer(player) && !player.getIsUnloaded()) {
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
      this.cleanupDistantPosts();
    }, 2000);
  }

  /**
   * Setup scroll handler
   * Handles header hide/show based on scroll direction and tracks scroll velocity
   */
  private setupScrollHandler(): void {
    let lastScrollY = this.getViewportTop();
    let isHeaderHidden = false;

    const processScroll = () => {
      this.scrollRafPending = false;
      const currentScrollY = this.getViewportTop();

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
  }

  /**
   * Enable/disable the JS reel scroller to match the current reel-mode state.
   * The scroller owns scroll position in reel mode (one card per gesture) and
   * drives autoplay via onSettle; outside reel mode the feed scrolls natively.
   */
  private setupReelScroller(): void {
    if (!this.scrollContainer) return;

    this.reelScroller ??= new ReelScroller({
      scrollContainer: this.scrollContainer,
      getCards: () => this.getAllCardContainers(),
      getPostId: (card) => this.getPostIdFromCard(card),
      onSettle: (postId, index) => this.handleReelSettle(postId, index),
      onAdvance: (index) => this.maybePrefetchMore(index),
    });
    this.reelScroller.enable();
  }

  /**
   * Autoplay + audio for the card the reel scroller just landed on. Prefetch is driven
   * separately by the scroller's onAdvance hook (which fires earlier, as soon as a gesture
   * commits to a new index), so we don't repeat it here.
   */
  private handleReelSettle(postId: string, _index: number): void {
    if (postId === END_CARD_POST_ID) {
      // No video on the end card — silence whatever was playing, and force the
      // search bar back in (auto-hide leaves it tucked away after scrolling down)
      // so the card's arrow has something to point at.
      this.playback.pauseAll();
      this.showHeader();
      return;
    }
    this.playback.setActive(postId);
    this.discoveryManager?.onPrimaryPostChanged(postId, this.getPerformersForPost(postId));
  }

  /**
   * Kick off the next batch once the active card is within PREFETCH_CARDS_AHEAD of the
   * last loaded card. Complements the pixel-based loadMoreTrigger, which fires too late
   * in reel mode (one full-viewport card per gesture). loadVideos guards against
   * concurrent loads, so an overlap with the observer is harmless.
   */
  private maybePrefetchMore(index: number): void {
    if (!this.hasMore || this.isLoading) return;
    if (index < this.postOrder.length - FeedContainer.PREFETCH_CARDS_AHEAD) return;
    this.loadVideos(undefined, true).catch((error) => {
      console.error('Error prefetching more content:', error);
    });
  }

  private cleanupReelScroller(): void {
    this.reelScroller?.destroy();
    this.reelScroller = undefined;
  }

  /** Digit keys rate the current card (0 = 10), Backspace/Delete clears. */
  private readonly onRatingHotkey = (event: KeyboardEvent): void => {
    if (this.settings.enableRatingHotkeys === false) return;
    if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (isTypingTarget(event.target)) return;
    let key: number | 'clear';
    if (/^\d$/.test(event.key)) key = Number(event.key);
    else if (event.key === 'Backspace' || event.key === 'Delete') key = 'clear';
    else return;
    const postId = this.reelScroller?.getCurrentPostId() ?? this.getTopMostCardPostId();
    const message = postId ? this.posts.get(postId)?.rateByHotkey(key) : null;
    if (message) showToast(message);
  };

  private teardownListeners(): void {
    document.removeEventListener('keydown', this.onRatingHotkey);
    window.removeEventListener('popstate', this.onPopState);
    this.removeMobileAutoplayUnlockListeners();
    this.removeAutoplayUnlockHandlers();

    if (this.scrollHandler && this.scrollEventTarget) {
      this.scrollEventTarget.removeEventListener('scroll', this.scrollHandler);
      this.scrollHandler = undefined;
      this.scrollEventTarget = undefined;
    }
    if (this.suggestionsClickOutsideHandler) {
      document.removeEventListener('click', this.suggestionsClickOutsideHandler);
      this.suggestionsClickOutsideHandler = undefined;
    }
    if (this.suggestionsTouchOutsideHandler) {
      document.removeEventListener('touchend', this.suggestionsTouchOutsideHandler);
      this.suggestionsTouchOutsideHandler = undefined;
    }

    this.cleanupReelScroller();

    if (this.cleanupScrollTimeout) {
      clearTimeout(this.cleanupScrollTimeout);
      this.cleanupScrollTimeout = undefined;
    }
    if (this.seenFlushTimer) {
      clearTimeout(this.seenFlushTimer);
      this.flushSeenSet();
      this.seenFlushTimer = undefined;
    }
    this.seenSetCache = undefined;
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
    this.suggestionAbortController?.abort();
    this.cancelAllPendingRequests(); // don't let an in-flight load keep building posts into a detached DOM
    if (this.settingsReloadTimeoutId) {
      clearTimeout(this.settingsReloadTimeoutId);
      this.settingsReloadTimeoutId = undefined;
    }
    this.teardownListeners();
    this.clearPosts();
    this.discoveryManager?.destroy();
    this.discoveryPanel?.destroy();
    this.api.destroy();
  }

  /**
   * Get all card containers in true visual (DOM) order.
   *
   * The reel addresses "current" and "next" by index into this list, so it MUST match
   * what's on screen top-to-bottom. Reading the live DOM children (rather than walking
   * postOrder) guarantees that — any drift between postOrder and the DOM can no longer
   * make the scroller advance to the wrong card. Cards carry data-post-id; the
   * load-more trigger and skeletons don't, so they're filtered out.
   */
  private getAllCardContainers(): HTMLElement[] {
    if (!this.postsContainer) {
      return [];
    }
    const cards: HTMLElement[] = [];
    for (const child of this.postsContainer.children) {
      if (child instanceof HTMLElement && child.dataset.postId) {
        cards.push(child);
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
   * Extract post ID from a card element
   */
  private getPostIdFromCard(card: HTMLElement): string | null {
    return card.dataset.postId ?? null;
  }

  private ensureReelInitialCardLoaded(): void {
    // Prefer the scroller's top-aligned index (consistent with how it computes the
    // current card during normal scrolling). Fall back to center-distance for the
    // initial call before the scroller exists.
    const postId = this.reelScroller?.getCurrentPostId()
      ?? this.getPostIdFromCard(this.findCardClosestToCenter() ?? document.createElement('div'));
    if (!postId) return;
    this.playback.setActive(postId);
    this.discoveryManager?.onPrimaryPostChanged(postId, this.getPerformersForPost(postId));
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
    body.style.overflow = 'hidden'; // reel-only: always locked
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

    skeleton.style.height = '100vh';
    skeleton.style.minHeight = '100vh';
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

  /** Saved filters whose content type the feed can currently show (image ones need images enabled). */
  private getApplicableSavedFilters(): SavedFilter[] {
    const imagesOn = this.shouldLoadImages();
    return this.savedFiltersCache.filter((f) => f.mode !== 'IMAGES' || imagesOn);
  }

  /**
   * Load saved filters once; concurrent callers share the in-flight request
   */
  private loadSavedFiltersIfNeeded(): Promise<void> {
    this.savedFiltersPromise ??= this.api.fetchSavedFilters().then(
      (items) => { this.savedFiltersCache = items; },
      (e) => { console.error('Failed to load saved filters', e); this.savedFiltersCache = []; this.savedFiltersPromise = undefined; }
    );
    return this.savedFiltersPromise;
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
    const previousShowPerformerEmbellishment = this.settings.showPerformerEmbellishment;
    const previousShowSceneTitle = this.settings.showSceneTitle;
    const previousOrientation = this.normalizeOrientationFilter(this.settings.orientationFilter ?? []);
    this.settings = { ...this.settings, ...newSettings };

    this.refreshAutoplayAfterLayout();
    this.applyPostDisplaySettings(newSettings, previousShowVerified, previousShowProductionAge, previousShowStudioChips, previousShowPerformerEmbellishment, previousShowSceneTitle);
    this.reloadFeedIfFiltersChanged(newSettings, previousExcludedTags, previousOrientation);
  }

  private applyPostDisplaySettings(
    newSettings: Partial<FeedSettings>,
    previousShowVerified: boolean | undefined,
    previousShowProductionAge: boolean | undefined,
    previousShowStudioChips: boolean | undefined,
    previousShowPerformerEmbellishment: boolean | undefined,
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
      newSettings.showPerformerEmbellishment,
      previousShowPerformerEmbellishment,
      this.settings.showPerformerEmbellishment,
      (post, on) => post.setShowPerformerEmbellishment?.(on),
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
    this.cancelAllPendingRequests();
    this.stopLoadingVideos();
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
