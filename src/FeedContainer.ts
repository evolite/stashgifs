import { SceneMarker, FilterOptions, FeedSettings, VideoPostData, ImagePostData, ImageVideoPostData, Image, SavedSearch, DateRangeFilter } from './types.js';
import { FilterState, type SavedFilter } from './FilterState.js';
import { SeenHistory } from './SeenHistory.js';
import { AutoplayUnlock } from './AutoplayUnlock.js';
import { mixContent, shuffle } from './content/mix.js';
import { computeHasMore } from './content/hasMore.js';
import { FilterHistory } from './FilterHistory.js';
import { SavedSearches } from './SavedSearches.js';

import { StashAPI, generateRandomSortSeed } from './StashAPI.js';
import { PluginSettingsManager } from './PluginSettingsManager.js';
import { VideoPost } from './VideoPost.js';
import { VideoPostBase } from './VideoPostBase.js';
import { ImagePost } from './ImagePost.js';
import { ImageVideoPost } from './ImageVideoPost.js';
import type { IVideoPlayer } from './types.js';
import { ImagePlayer } from './ImagePlayer.js';
import { ReelPlaybackController } from './ReelPlaybackController.js';
import { ReelScroller } from './ReelScroller.js';
import { FavoritesManager } from './FavoritesManager.js';
import { BookmarkManager } from './BookmarkManager.js';
import type { SettingsPage } from './SettingsPage.js';
import { debounce, showToast, normalizeMediaUrl, isStandaloneNavigator, isMobileDevice, detectVideoFromVisualFiles, isMp4File, getImageUrlForDisplay, THEME, THEME_DEFAULTS, normalizeHexColor, toRgba, buildFullUrl, applyThemeColors, setIcon } from './utils.js';
import { GQLImage } from './graphql/types.js';
import { getStashBaseUrl } from './utils/baseUrl.js';
import { SETTINGS_SVG, KEYBOARD_SVG, STASHGIFS_LOGO_SVG, IMAGE_SVG, MARKER_SVG, HEART_SVG_OUTLINE } from './icons.js';
import { buildEndOfFeedCard, END_CARD_POST_ID } from './EndOfFeedCard.js';
import { handleHotkey, toggleHotkeyHelp, type HotkeyActions } from './Hotkeys.js';

const DEFAULT_SETTINGS: FeedSettings = {
  cardMaxWidth: 800,
  aspectRatio: 'preserve',
  enabledFileTypes: ['.jpg', '.png', '.gif', '.mp4', '.m4v'],
  includeImagesInFeed: true,
  searchMarkersByName: false,
  imagesOnly: false,
  includeShortForm: true,
  shortFormMaxDuration: 120,
  shortFormFolder: '',
  shortFormTags: [],
  randomLongScenesOnly: false,
  playMarkersToEnd: false,
  includeScenePreviews: false,
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
  hdMode: true,
  showPerformerTags: false,
  showSceneTags: false,
};

function isVideoPlayer(player: IVideoPlayer | ImagePlayer | undefined): player is IVideoPlayer {
  return player !== undefined && 'getVideoElement' in player;
}

type PostType = VideoPost | ImagePost | ImageVideoPost;

export class FeedContainer {
  private static readonly CONTENT_LOAD_LIMIT: number = 8;
  private static readonly PREFETCH_CARDS_AHEAD = 5;
  private readonly container: HTMLElement;
  private scrollContainer: HTMLElement;
  private readonly api: StashAPI;
  private readonly settingsManager: PluginSettingsManager;
  private playback: ReelPlaybackController;
  private favoritesManager: FavoritesManager;
  private bookmarkManager: BookmarkManager;
  private readonly posts: Map<string, PostType>;
  private postOrder: string[];
  private settings: FeedSettings;
  private isOpeningSettings = false;
  private settingsContainer?: HTMLElement;
  private ratingConfigReady: Promise<void> = Promise.resolve();
  private ratingSystemConfig: { type?: string; starPrecision?: string } | null | undefined;
  private imagesLoadedCount: number = 0;
  private markersLoadedCount: number = 0;
  private shortFormOffset: number | null = 0;
  private shortFormScanPaused = false;
  private scenePreviewUnfilteredOffset: number = 0;
  private markerPageSize: number = 0;
  private imagePageSize: number = 0;
  private isLoading: boolean = false;
  private currentFilters?: FilterOptions;
  private readonly filterState = new FilterState();
  private readonly debouncedApplyFilters!: () => void;
  private activePillsBar?: HTMLElement;
  private hasMore: boolean = true;
  private seenSkipCount = 0;
  private currentPage: number = 1;
  private appendRetryCount = 0;
  private appendRetryTimeoutId?: ReturnType<typeof setTimeout>;
  private settingsReloadTimeoutId?: ReturnType<typeof setTimeout>;
  private latestLoadId = 0;
  private endCard?: HTMLElement;
  private saveSearchInputVisible = false;
  private postsContainer!: HTMLElement;
  private headerBar?: HTMLElement;
  private readonly filterHistory = new FilterHistory(this.filterState, () => {
    this.updateActivePills();
    this.updateQueryInputDisplay();
    this.applyFilters();
  });
  private readonly savedSearches: SavedSearches;
  private preloadedTags: Array<{ id: string; name: string }> = [];
  private preloadedPerformers: Array<{ id: string; name: string; image_path?: string }> = [];
  private isPreloading: boolean = false;
  private excludedTagIds: string[] = [];
  private excludedTagNamesNormalized: string[] = [];
  private scrollRafPending: boolean = false;
  private readonly seenHistory = new SeenHistory(() => this.settings.seenHistorySize ?? 500);
  private cleanupScrollTimeout?: ReturnType<typeof setTimeout>;
  private scrollHandler?: () => void;
  private scrollEventTarget?: Window | HTMLElement;
  private suggestionsClickOutsideHandler?: (event: Event) => void;
  private suggestionsTouchOutsideHandler?: (event: Event) => void;
  private placeholderAnimationInterval?: ReturnType<typeof setInterval>;
  private savedFiltersCache: SavedFilter[] = [];
  private savedFiltersPromise?: Promise<void>;
  private suggestionAbortController?: AbortController;
  private activeLoadVideosAbortController?: AbortController;
  private skeletonLoaders: HTMLElement[] = [];
  private useHDMode: boolean = false;
  private globalMuteState: boolean = false;
  private readonly loadObservers: Map<string, IntersectionObserver> = new Map();
  private updatePlaceholderVisibilityRef?: () => void;
  private reelScroller?: ReelScroller;
  private readonly autoplayUnlock = new AutoplayUnlock(() => this.playback?.retryActive());

  constructor(container: HTMLElement, api?: StashAPI, settings?: Partial<FeedSettings>, settingsManager?: PluginSettingsManager) {
    this.container = container;
    this.api = api || new StashAPI();
    this.settingsManager = settingsManager || new PluginSettingsManager(this.api);
    this.savedSearches = new SavedSearches(this.settingsManager);
    const loadedSettings = settings && Object.keys(settings).length > 0 ? settings : this.loadSettingsFromStorage();
    this.settings = { ...DEFAULT_SETTINGS, ...loadedSettings };
    this.api.maxContentLimit = this.settings.contentLimit ?? 5000;
    this.api.maxResolution = this.settings.maxResolution ?? 0;
    this.scrollContainer = null!;
    this.playback = null!;
    this.favoritesManager = null!;
    this.bookmarkManager = null!;
    this.posts = new Map();
    this.postOrder = [];

    this.initializeContainers();
    this.applyThemeSettings(this.settings);
    this.applyFooterVisibility(this.settings);
    this.loadUserPreferences();
    
    this.createHeaderBar();
    this.debouncedApplyFilters = debounce(() => {
      this.applyFilters();
    }, 300);
    
    this.initializePostsContainer();
    this.applyReelModeLayout();
    this.initializeManagers();

    this.setupScrollHandler();
    
    this.setupReelScroller();
    
    this.autoplayUnlock.start();
    document.addEventListener('keydown', this.onHotkey);

  }

  private initializeContainers(): void {
    const existingScrollContainer = this.container.querySelector('.feed-scroll-container') as HTMLElement;
    if (existingScrollContainer) {
    this.scrollContainer = existingScrollContainer;
    } else {
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

  private initializePostsContainer(): void {
    const existingPostsContainer = this.scrollContainer.querySelector('.feed-posts') as HTMLElement;
    if (existingPostsContainer) {
      this.postsContainer = existingPostsContainer;
    } else {
      this.postsContainer = document.createElement('div');
      this.postsContainer.className = 'feed-posts';
      this.scrollContainer.appendChild(this.postsContainer);
    }
  }

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

  private getViewportTop(): number {
    return this.scrollContainer.scrollTop;
  }

  private scrollToTop(): void {
    this.scrollContainer.scrollTo({ top: 0, behavior: 'auto' });
  }

  private applyReelModeLayout(): void {
    this.applyReelRootStyles();
    this.applyReelContainerStyles();
    this.applyReelHeaderStyles();
    this.setupScrollHandler();
    this.setupReelScroller();
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
    body.style.overflow = 'hidden';
    this.applyBarHideMode();
  }

  private isStandaloneDisplay(): boolean {
    const nav = globalThis.navigator;
    return (isStandaloneNavigator(nav) && nav.standalone) || globalThis.matchMedia('(display-mode: standalone)').matches;
  }

  private isBarHideMode(): boolean {
    return this.settings.hideBrowserBars !== false && isMobileDevice() && !this.isStandaloneDisplay();
  }

  private applyBarHideMode(): void {
    const on = this.isBarHideMode();
    document.documentElement.classList.toggle('reel-hide-bars', on);
    if (this.scrollContainer) {
      this.scrollContainer.style.overflowY = on ? 'hidden' : 'auto';
      this.scrollContainer.style.overscrollBehavior = on ? 'auto' : 'contain';
    }
    globalThis.visualViewport?.removeEventListener('resize', this.syncReelHeight);
    globalThis.removeEventListener('resize', this.syncReelHeight);
    if (on) {
      globalThis.visualViewport?.addEventListener('resize', this.syncReelHeight);
      globalThis.addEventListener('resize', this.syncReelHeight);
      this.syncReelHeight();
    } else {
      document.documentElement.style.removeProperty('--reel-h');
      globalThis.scrollTo(0, 0);
    }
  }

  private readonly syncReelHeight = (): void => {
    const height = globalThis.visualViewport?.height ?? globalThis.innerHeight;
    document.documentElement.style.setProperty('--reel-h', `${Math.round(height)}px`);
  };

  private pageYieldStreak = 0;

  private pageCanStillScroll(): boolean {
    if (!this.isBarHideMode()) return false;
    const page = document.scrollingElement ?? document.documentElement;
    if (page.scrollTop >= page.scrollHeight - page.clientHeight - 1) {
      this.pageYieldStreak = 0;
      return false;
    }
    if (this.pageYieldStreak >= 3) return false;
    this.pageYieldStreak++;
    return true;
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

    this.scrollContainer.style.width = '100vw';
    this.scrollContainer.style.maxWidth = '100vw';
    this.scrollContainer.style.margin = '0';
    this.scrollContainer.style.marginLeft = 'calc(50% - 50vw)';
    this.scrollContainer.style.marginRight = 'calc(50% - 50vw)';
    this.scrollContainer.style.padding = '0';
    this.scrollContainer.style.height = 'var(--reel-h)';
    this.scrollContainer.style.minHeight = 'var(--reel-h)';
    this.scrollContainer.style.overflowX = 'hidden';
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
    const iconButtons = header.querySelectorAll<HTMLElement>('.feed-header-icon-btn');

    header.style.position = 'fixed';
    header.style.left = '0';
    header.style.right = '0';
    header.style.width = '100%';
    header.style.maxWidth = '100%';
    if (header.dataset.overlayZIndex === undefined) {
      header.style.zIndex = '900';
    } else {
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
    for (const button of iconButtons) {
      button.style.background = 'rgba(0, 0, 0, 0.35)';
      button.style.border = '1px solid rgba(255, 255, 255, 0.2)';
      button.style.color = THEME.colors.textPrimary;
    }
  }

  private applySettings(newSettings: Partial<FeedSettings>, persist: boolean): void {
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
    if (persist) this.saveSettingsToStorage(updatedSettings);
    this.applyThemeSettings(updatedSettings);

    if (newSettings.hdMode !== undefined) {
      this.useHDMode = newSettings.hdMode;
      if (persist) this.settingsManager.save({ hdMode: newSettings.hdMode });
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

    if (newSettings.hideBrowserBars !== undefined && newSettings.hideBrowserBars !== previousSettings.hideBrowserBars) {
      this.applyBarHideMode();
      requestAnimationFrame(() => this.reelScroller?.realign());
    }

    if (newSettings.autoHideSearchBar !== undefined && newSettings.autoHideSearchBar === false) {
      this.showHeader();
    }

    if (newSettings.cardMaxWidth !== undefined && this.headerBar) {
      const w = updatedSettings.cardMaxWidth;
      this.headerBar.style.maxWidth = `${w + 24}px`;
      const headerInner = this.headerBar.querySelector<HTMLElement>('.feed-header-inner');
      if (headerInner) headerInner.style.maxWidth = `${w}px`;
    }

    if (this.shouldReloadFeed(newSettings, previousSettings, excludedTagsChanged, orientationFilterChanged)) {
      this.scheduleSettingsReload();
    }
  }

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

  private applyFooterVisibility(settings: FeedSettings): void {
    this.container.classList.toggle('feed-container--hide-ocount', settings.showOCountButton === false);
    this.container.classList.toggle('feed-container--hide-rating', settings.showRatingButton === false);
    this.container.classList.toggle('feed-container--hide-views', settings.showViewCountBadge === false);
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
    this.applyFooterVisibility(updatedSettings);
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
    const shortFormTagsChanged = newSettings.shortFormTags !== undefined
      && !this.areStringListsEqual(
        newSettings.shortFormTags.map(tag => tag.id),
        (previousSettings.shortFormTags ?? []).map(tag => tag.id),
      );

    return !!(
      changed('hdMode') ||
      changed('includeMarkersInFeed') ||
      changed('playMarkersToEnd') ||
      changed('includeImagesInFeed') ||
      changed('includeRandomInFeed') ||
      changed('randomIncludeScenesWithMarkers') ||
      changed('randomLongScenesOnly') ||
      enabledFileTypesChanged ||
      changed('imagesOnly') ||
      changed('includeShortForm') ||
      changed('shortFormMaxDuration') ||
      changed('shortFormFolder') ||
      shortFormTagsChanged ||
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

    let lookupFailed = false;
    const resolvedTags = await Promise.all(
      Array.from(uniqueNameMap.values()).map(async (name) => {
        try {
          return await this.api.findTagByName(name);
        } catch (error) {
          lookupFailed = true;
          console.warn('Failed to resolve excluded tag', { name, error });
          return null;
        }
      })
    );
    if (lookupFailed) this.excludedTagNamesNormalized = [];

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

  private loadHDModePreference(): boolean {
    if (this.settings.hdMode !== undefined) {
      return this.settings.hdMode;
    }
    return this.settingsManager.data.hdMode;
  }

  private loadGlobalMuteState(): boolean {
    return this.settingsManager.data.globalMuteState;
  }

  private setGlobalMuteState(isMuted: boolean): void {
    this.globalMuteState = isMuted;
    this.settingsManager.save({ globalMuteState: isMuted });

    this.applyGlobalMuteState();
    this.playback?.setGlobalMute(isMuted);
    this.updateAllMuteButtons();
  }

  private applyMuteStateToPost(post: VideoPost | ImageVideoPost): void {
    const player = post.getPlayer();
    if (player) {
      player.setMuted(this.globalMuteState);
    }
    post.updateMuteOverlayButton();
  }

  private applyGlobalMuteState(): void {
    for (const post of this.posts.values()) {
      if (post instanceof VideoPost || post instanceof ImageVideoPost) {
        this.applyMuteStateToPost(post);
      }
    }
  }

  private updateAllMuteButtons(): void {
    for (const post of this.posts.values()) {
      if (post instanceof VideoPost || post instanceof ImageVideoPost) {
        post.updateMuteOverlayButton();
      }
    }
  }

  getGlobalMuteState(): boolean {
    return this.globalMuteState;
  }

  private initializeManagers(): void {
    this.playback = new ReelPlaybackController({
      getOrderedPostIds: () => this.postOrder,
      getPost: (postId: string) => this.posts.get(postId),
    });
    this.playback.setGlobalMute(this.globalMuteState);

    this.applyGlobalMuteState();
    this.updateAllMuteButtons();

    this.favoritesManager = new FavoritesManager(this.api);
    this.bookmarkManager = new BookmarkManager(this.api);
  }
  
  private closeSuggestions(): void {
    const suggestions = document.querySelectorAll('.feed-filters__suggestions');
    for (const suggestion of suggestions) {
      const el = suggestion as HTMLElement;
      el.style.display = 'none';
      while (el.firstChild) {
        el.firstChild.remove();
      }
    }

    this.setHeaderOverlayState(false);

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

  private createSectionLabel(label: string, uppercase: boolean = false): HTMLElement {
    const el = document.createElement('div');
    el.className = uppercase ? 'feed-section-label feed-section-label--uppercase' : 'feed-section-label';
    el.textContent = uppercase ? label.toUpperCase() : label;
    return el;
  }

  private attachSuggestionClickHandler(button: HTMLElement, onSelect: () => void | Promise<void>): void {
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
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
    if (iconSvg) button.innerHTML = iconSvg;
    button.append(label);
    this.attachSuggestionClickHandler(button, onSelect);
    return button;
  }

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
        leading.innerHTML = options.leadingIcon;
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

  private appendEmptyState(target: HTMLElement, message: string): void {
    const emptyState = document.createElement('div');
    emptyState.className = 'feed-empty-state';
    emptyState.textContent = message;
    target.appendChild(emptyState);
  }

  private createLoadingSkeletons(): HTMLElement {
    const loadingSection = document.createElement('div');
    loadingSection.style.display = 'flex';
    loadingSection.style.flexDirection = 'column';
    loadingSection.style.gap = '8px';
    loadingSection.appendChild(this.createSectionLabel('Suggested Tags'));
    
    for (let i = 0; i < 6; i++) {
      const skeletonButton = document.createElement('div');
      skeletonButton.style.width = '100%';
      skeletonButton.style.display = 'flex';
      skeletonButton.style.alignItems = 'center';
      skeletonButton.style.gap = '12px';
      skeletonButton.style.padding = '12px';
      skeletonButton.style.borderRadius = '12px';
      skeletonButton.style.background = 'transparent';
      
      const leadingSkeleton = document.createElement('div');
      leadingSkeleton.className = 'chip-skeleton';
      leadingSkeleton.dataset.suggestionSkeleton = 'true';
      leadingSkeleton.style.width = '36px';
      leadingSkeleton.style.height = '36px';
      leadingSkeleton.style.borderRadius = '50%';
      leadingSkeleton.style.flexShrink = '0';
      
      const textSkeleton = document.createElement('div');
      textSkeleton.className = 'chip-skeleton';
      textSkeleton.dataset.suggestionSkeleton = 'true';
      textSkeleton.style.height = '16px';
      textSkeleton.style.borderRadius = '4px';
      textSkeleton.style.flex = '1';
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
    this.filterState.replace({ savedFilter: filter });
    this.closeSuggestions();
    updateSearchBarDisplay();
    this.currentFilters = this.buildCurrentFilterOptions();
    this.filterHistory.push();
    if (withScroll) this.scrollToTop();
    this.loadVideos(this.currentFilters, false).catch((e) => console.error('Apply saved filter failed', e));
  }

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
      this.filterState.savedFilter = undefined;
      try {
        const favoriteTagId = await this.favoritesManager.getFavoriteTagId();
        if (favoriteTagId) {
          const tagId = Number.parseInt(favoriteTagId, 10);
          if (this.filterState.tags.has(tagId)) {
            this.filterState.tags.delete(tagId);
          } else {
            this.filterState.tags.set(tagId, 'Favorites');
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
        this.filterState.dateRange = option.value;
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
    const searches = this.savedSearches.list();
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
        this.savedSearches.delete(search.id);
        wrapper.remove();
      });

      wrapper.append(pill, del);
      pillRow.appendChild(wrapper);
    }

    section.appendChild(pillRow);
    container.appendChild(section);
  }

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
        this.filterState.savedFilter = undefined;
        if (this.filterState.tags.has(tagId)) {
          this.filterState.tags.delete(tagId);
          btn.classList.remove('feed-list-button--selected');
        } else {
          this.filterState.tags.set(tagId, tag.name);
          btn.classList.add('feed-list-button--selected');
        }
        updateSearchBarDisplay();
        this.debouncedApplyFilters();
        this.focusSearchInput();
      }, { leadingText: '#' });
      if (this.filterState.tags.has(tagId)) {
        btn.classList.add('feed-list-button--selected');
      }
      tagsSection.appendChild(btn);
    }
    container.appendChild(tagsSection);
  }

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
          this.filterState.savedFilter = undefined;
          if (this.filterState.performers.has(performerId)) {
            this.filterState.performers.delete(performerId);
            btn.classList.remove('feed-list-button--selected');
          } else {
            this.filterState.performers.set(performerId, performer.name);
            btn.classList.add('feed-list-button--selected');
          }
          updateSearchBarDisplay();
          this.debouncedApplyFilters();
          this.focusSearchInput();
        },
        { leadingImage: imageSrc, leadingText: imageSrc ? undefined : performer.name.charAt(0).toUpperCase() }
      );
      if (this.filterState.performers.has(performerId)) {
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
          this.filterState.savedFilter = undefined;
          if (this.filterState.studios.has(studioId)) {
            this.filterState.studios.delete(studioId);
            btn.classList.remove('feed-list-button--selected');
          } else {
            this.filterState.studios.set(studioId, studio.name);
            btn.classList.add('feed-list-button--selected');
          }
          updateSearchBarDisplay();
          this.debouncedApplyFilters();
          this.focusSearchInput();
        },
        { leadingImage: imageSrc, leadingText: imageSrc ? undefined : studio.name.charAt(0).toUpperCase(), imageObjectFit: 'contain' }
      );
      if (this.filterState.studios.has(studioId)) {
        btn.classList.add('feed-list-button--selected');
      }
      studiosSection.appendChild(btn);
    }
    container.appendChild(studiosSection);
  }

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

  private applyMarkerTitleSearch(title: string): void {
    this.filterState.replace({ markerName: title });
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
    this.filterHistory.push();
    this.scrollToTop();
    this.loadVideos(this.currentFilters, false).catch((e) => console.error('Apply marker search failed', e));
  }

  private filterMarkersByName(markers: SceneMarker[]): SceneMarker[] {
    if (!this.filterState.markerName) return markers;
    const target = this.filterState.markerName.trim().toLowerCase();
    return markers.filter((marker) => (marker.title ?? '').trim().toLowerCase() === target);
  }

  private filterUnselected<T extends { id: string }>(items: T[], selectedIds: Map<number, string>): T[] {
    return items.filter((item) => {
      const id = Number.parseInt(item.id, 10);
      return !Number.isNaN(id) && !selectedIds.has(id);
    });
  }

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

    loadingTimeout = setTimeout(() => {
      if (!ensureLatest()) return;
      showLoadingSkeletons();
    }, 200);

    let freshTags: Array<{ id: string; name: string }> = [];
    let freshPerformers: Array<{ id: string; name: string; image_path?: string }> = [];

    try {
      if (this.preloadedTags.length > 0 && this.preloadedPerformers.length > 0) {
        freshTags = shuffle([...this.preloadedTags]).slice(0, 3);
        freshPerformers = shuffle([...this.preloadedPerformers]).slice(0, 3);
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

    const availableTags = this.filterUnselected(freshTags, this.filterState.tags).slice(0, 3);

    this.createTagsSection(container, availableTags, updateSearchBarDisplay, apply, 'Suggested Tags');

    const availablePerformers = this.filterUnselected(freshPerformers, this.filterState.performers).slice(0, 3);

    this.createPerformersSection(container, availablePerformers, updateSearchBarDisplay, apply, 'Suggested Performers');

    if (container.children.length === 0) {
      this.appendEmptyState(container, 'No suggestions available yet.');
    }

    suggestions.scrollTop = 0;
  }

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

    this.suggestionAbortController?.abort();
    this.suggestionAbortController = new AbortController();
    const suggestionSignal = this.suggestionAbortController.signal;

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

    const filteredTags = this.filterUnselected(tagItems, this.filterState.tags).slice(0, 20);

    this.createTagsSection(container, this.sortByMatchAccuracy(filteredTags, trimmedText), updateSearchBarDisplay, apply);

    const filteredPerformers = this.filterUnselected(performerItems, this.filterState.performers).slice(0, 20);

    this.createPerformersSection(container, this.sortByMatchAccuracy(filteredPerformers, trimmedText), updateSearchBarDisplay, apply);

    const filteredStudios = this.filterUnselected(studioItems, this.filterState.studios).slice(0, 20);

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

  private createHeaderElement(): HTMLElement {
    const header = document.createElement('div');
    this.headerBar = header;
    header.className = 'feed-header-bar';
    
    header.style.maxWidth = `${this.settings.cardMaxWidth + 24}px`;
    header.style.top = '0';
    header.style.transform = 'translateY(0)';
    
    const isStandalone = this.isStandaloneDisplay();
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    
    if (isStandalone && isIOS) {
      header.style.top = 'calc(env(safe-area-inset-top, 0px) * 0.7)';
      header.style.minHeight = '72px';
      header.style.height = 'auto';
    }
    
    return header;
  }

  private createHeaderInnerContainer(): HTMLElement {
    const headerInner = document.createElement('div');
    headerInner.className = 'feed-header-inner';
    headerInner.style.maxWidth = `${this.settings.cardMaxWidth}px`;
    return headerInner;
  }

  private createSearchArea(): HTMLElement {
    const searchArea = document.createElement('div');
    searchArea.className = 'feed-search-area';
    return searchArea;
  }

  private createTagHeader(): HTMLElement {
    const tagHeader = document.createElement('div');
    tagHeader.className = 'feed-filters__tag-header feed-tag-header';
    tagHeader.style.display = 'none';
    return tagHeader;
  }

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
    setIcon(brand, STASHGIFS_LOGO_SVG);
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
      this.filterState.reset();
      this.currentFilters = undefined;
      this.filterHistory.push();

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

  private createQueryInput(): HTMLInputElement {
    const queryInput = document.createElement('input');
    queryInput.type = 'text';
    queryInput.placeholder = '';
    queryInput.className = 'feed-filters__input';
    queryInput.name = 'stashgifs-feed-search';
    queryInput.setAttribute('autocomplete', 'off');
    queryInput.setAttribute('autocapitalize', 'none');
    queryInput.setAttribute('autocorrect', 'off');
    queryInput.spellcheck = false;
    queryInput.setAttribute('aria-label', 'Search performers, tags and filters');
    return queryInput;
  }

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

  private createLoadingSpinner(): HTMLElement {
    const loadingSpinner = document.createElement('div');
    loadingSpinner.className = 'feed-search-loading feed-loading-spinner';
    loadingSpinner.style.display = 'none';
    return loadingSpinner;
  }

  private createHeaderIconButton(icon: string, title: string, ariaLabel: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'feed-header-icon-btn';
    button.title = title;
    button.setAttribute('aria-label', ariaLabel);
    button.style.padding = '10px 12px';
    button.style.borderRadius = THEME.radius.button;
    button.style.border = `1px solid ${THEME.colors.border}`;
    button.style.background = THEME.colors.backgroundSecondary;
    button.style.color = THEME.colors.iconInactive;
    button.style.cursor = 'pointer';
    button.style.display = 'inline-flex';
    button.style.alignItems = 'center';
    button.style.justifyContent = 'center';
    button.style.flexShrink = '0';
    button.style.transition = 'background 0.2s ease, border-color 0.2s ease, color 0.2s ease';
    setIcon(button, icon);

    button.addEventListener('mouseenter', () => {
      button.style.color = THEME.colors.textPrimary;
      button.style.background = THEME.colors.surfaceHover;
      button.style.borderColor = THEME.colors.border;
    });
    button.addEventListener('mouseleave', () => {
      button.style.color = THEME.colors.iconInactive;
      button.style.background = THEME.colors.backgroundSecondary;
      button.style.borderColor = THEME.colors.border;
    });
    button.addEventListener('click', onClick);
    return button;
  }

  private async openSettings(): Promise<void> {
    if (this.isOpeningSettings) return;
    this.isOpeningSettings = true;
    let SettingsPageCtor: typeof SettingsPage;
    try {
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

    SettingsPageCtor.mount(
      this.settingsContainer,
      this.settings,
      (signal) => this.api.findGalleries(signal),
      (newSettings) => this.applySettings(newSettings, true),
      () => {
        this.settingsContainer?.remove();
        this.settingsContainer = undefined;
      },
      (query, signal) => this.api.findTagsForSelect(query, 30, signal),
    );
  }

  private createHeaderBar(): void {
    const header = this.createHeaderElement();
    const headerInner = this.createHeaderInnerContainer();

    this.createBrandContainer(headerInner);

    const searchArea = this.createSearchArea();
    
    const searchAndSettingsContainer = document.createElement('div');
    searchAndSettingsContainer.style.display = 'flex';
    searchAndSettingsContainer.style.alignItems = 'center';
    searchAndSettingsContainer.style.gap = '8px';
    searchAndSettingsContainer.style.width = '100%';
    searchAndSettingsContainer.style.minWidth = '0';
    searchAndSettingsContainer.style.position = 'relative';
    
    searchAndSettingsContainer.appendChild(searchArea);
    
    if (!isMobileDevice()) {
      searchAndSettingsContainer.appendChild(
        this.createHeaderIconButton(KEYBOARD_SVG, 'Keyboard shortcuts (?)', 'Show keyboard shortcuts', () => toggleHotkeyHelp())
      );
    }
    searchAndSettingsContainer.appendChild(
      this.createHeaderIconButton(SETTINGS_SVG, 'Settings', 'Open settings', () => void this.openSettings())
    );
    
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

    inputWrapper.appendChild(queryInput);

    const suggestions = document.createElement('div');
    suggestions.className = 'feed-filters__suggestions hide-scrollbar';
    suggestions.style.position = 'fixed';
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
    suggestions.style.setProperty('-webkit-backdrop-filter', 'blur(20px) saturate(180%)');
    suggestions.style.overflowY = 'auto';
    suggestions.style.padding = '0';
    suggestions.style.boxSizing = 'border-box';

    searchArea.appendChild(inputWrapper);
    searchArea.appendChild(tagHeader);
    document.body.appendChild(suggestions);

    const existingHeader = this.scrollContainer.querySelector('.feed-header-bar');
    if (existingHeader) {
      this.scrollContainer.replaceChild(header, existingHeader);
    } else {
      this.scrollContainer.insertBefore(header, this.scrollContainer.firstChild);
    }

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
      queryInput.disabled = true;
      queryInput.style.opacity = '0.6';
      loadingSpinner.style.display = 'block';
      try {
        updateSearchBarDisplay();
        await this.applyCurrentSearch();
        this.scrollToTop();
      } catch (e: unknown) {
        if (!(e instanceof Error && e.name === 'AbortError')) {
          console.error('Apply filters failed', e);
        }
      } finally {
        queryInput.disabled = false;
        queryInput.style.opacity = '1';
        loadingSpinner.style.display = 'none';
      }
    };

    let suggestionsRequestId = 0;
    let pendingSuggestionsFetch: Promise<void> | null = null;

    const triggerFetchSuggestions = (text: string, forceShow: boolean): Promise<void> => {
      const p = fetchAndShowSuggestions(text, forceShow);
      pendingSuggestionsFetch = p;
      void p.finally(() => { if (pendingSuggestionsFetch === p) pendingSuggestionsFetch = null; });
      return p;
    };

    const debouncedFetchSuggestions = debounce((text: string, forceShow: boolean) => {
      void triggerFetchSuggestions(text, forceShow);
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
        void apply();
        return;
      }

      e.preventDefault();

      void triggerFetchSuggestions(text, false).then(() => {
        if (queryInput.value.trim() !== text) return;
        const firstResult = suggestions.querySelector(
          'button.feed-list-button:not(.feed-list-button--selected):not([data-saved-filter]), button.feed-suggestion-chip:not(.feed-suggestion-chip--selected)'
        ) as HTMLButtonElement | null;
        if (firstResult) firstResult.click();
      });
    });
    
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
      this.filterState.savedFilter = undefined;
    };

    const prepareSearchForInput = () => {
      this.preloadSuggestions().catch((e) => console.warn('Suggestion preload refresh failed', e));
      queryInput.style.background = THEME.colors.surface;
      queryInput.style.borderColor = THEME.colors.border;
      clearSearchSelection();
      queryInput.value = '';
      void triggerFetchSuggestions('', true);
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
      if (text !== this.filterState.savedFilter?.name) {
        this.filterState.savedFilter = undefined;
      }
      debouncedFetchSuggestions(text, false);
    });

    suggestions.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('button, input, a, select, textarea')) {
        this.closeSuggestions();
      }
    });
    
    this.registerSuggestionsOutsideHandlers(searchArea, suggestions);

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

  private handlePerformerChipClick(performerId: number, performerName: string): void {
    this.filterState.savedFilter = undefined;
    if (this.filterState.performers.has(performerId)) {
      this.filterState.performers.delete(performerId);
    } else {
      this.filterState.performers.set(performerId, performerName);
    }
    this.updateActivePills();
    this.updateQueryInputDisplay();
    this.debouncedApplyFilters();
    this.scrollToTop();
  }

  private handleTagChipClick(tagId: number, tagName: string): void {
    this.filterState.savedFilter = undefined;
    if (this.filterState.tags.has(tagId)) {
      this.filterState.tags.delete(tagId);
    } else {
      this.filterState.tags.set(tagId, tagName);
    }
    this.updateActivePills();
    this.updateQueryInputDisplay();
    this.debouncedApplyFilters();
    this.scrollToTop();
  }

  private handleStudioChipClick(studioId: number, studioName: string): void {
    this.filterState.savedFilter = undefined;
    if (this.filterState.studios.has(studioId)) {
      this.filterState.studios.delete(studioId);
    } else {
      this.filterState.studios.set(studioId, studioName);
    }
    this.updateActivePills();
    this.updateQueryInputDisplay();
    this.debouncedApplyFilters();
    this.scrollToTop();
  }

  private getCurrentQueryFromInput(): string | undefined {
    const activeEl = document.activeElement as HTMLElement | null;
    if (activeEl?.classList?.contains('feed-filters__input')) {
      const input = activeEl as HTMLInputElement;
      return input.value?.trim() || undefined;
    }
    const queryInput = this.container.querySelector('.feed-filters__input') as HTMLInputElement;
    if (queryInput) {
      return queryInput.value?.trim() || undefined;
    }
    return undefined;
  }

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
        this.filterState.tags.set(Number.parseInt(exactTag.id, 10), exactTag.name);
        return {};
      }

      const matchingPerformers = await this.api.searchPerformers(q, 10, loadSignal);
      if (loadSignal?.aborted) {
        return {};
      }

      if (matchingPerformers && matchingPerformers.length > 0 && matchingPerformers[0]) {
        this.filterState.performers.set(Number.parseInt(String(matchingPerformers[0].id), 10), matchingPerformers[0].name);
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

  private async applyCurrentSearch(loadSignal?: AbortSignal): Promise<void> {
    const q = this.getCurrentQueryFromInput();
    let queryValue: string | undefined;

    if (q && !this.filterState.savedFilter && this.filterState.tags.size === 0
      && this.filterState.performers.size === 0 && this.filterState.studios.size === 0) {
      const resolved = await this.resolveQueryToFilters(q, loadSignal);
      if (loadSignal?.aborted) return;
      queryValue = resolved.queryValue;
      this.updateActivePills();
    }

    const newFilters = this.buildCurrentFilterOptions(queryValue);
    this.currentFilters = newFilters;
    this.filterHistory.push();
    await this.loadVideos(newFilters, false, loadSignal);
  }

  private getSelectedFilterDisplayName(): string {
    if (this.filterState.tags.size > 0 || this.filterState.performers.size > 0) {
      return '';
    }
    return this.filterState.savedFilter ? this.filterState.savedFilter.name : '';
  }

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

  private buildCurrentFilterOptions(query?: string): FilterOptions {
    return this.filterState.toFilterOptions({
      limit: FeedContainer.CONTENT_LOAD_LIMIT,
      includeSubtags: !!this.settings.includeSubtags,
      query,
    });
  }

  private applyFilters(): void {
    this.updateQueryInputDisplay();

    const newFilters = this.buildCurrentFilterOptions();
    this.currentFilters = newFilters;
    this.filterHistory.push();
    this.loadVideos(newFilters, false).catch((e) => console.error('Apply filters failed', e));
  }

  private createPillWord(text: string): HTMLElement {
    const sep = document.createElement('span');
    sep.textContent = text;
    sep.setAttribute('aria-hidden', 'true');
    sep.style.cssText = `font-size:11px;color:${THEME.colors.textSecondary};align-self:center;flex-shrink:0;padding:0 2px;`;
    return sep;
  }

  private appendMarkerNamePill(): void {
    if (!this.filterState.markerName) return;
    this.activePillsBar!.appendChild(this.createActivePill(`▶ ${this.filterState.markerName}`, () => {
      this.filterState.markerName = undefined;
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
    if (!this.filterState.dateRange) return;
    this.activePillsBar!.appendChild(this.createActivePill(
      `📅 ${FeedContainer.DATE_RANGE_LABELS[this.filterState.dateRange]}`,
      () => {
        this.filterState.dateRange = undefined;
        this.updateActivePills();
        this.debouncedApplyFilters();
      }
    ));
  }

  private appendTagPills(): void {
    for (const [id, name] of this.filterState.tags) {
      this.activePillsBar!.appendChild(this.createActivePill(`#${name}`, () => {
        this.filterState.tags.delete(id);
        this.updateActivePills();
        this.updateQueryInputDisplay();
        this.debouncedApplyFilters();
      }));
    }
  }

  private appendPerformerPills(): void {
    let first = true;
    for (const [id, name] of this.filterState.performers) {
      if (first) {
        if (this.filterState.tags.size > 0) this.activePillsBar!.appendChild(this.createPillWord('with'));
        first = false;
      } else {
        this.activePillsBar!.appendChild(this.createPillWord('and'));
      }
      this.activePillsBar!.appendChild(this.createActivePill(`@${name}`, () => {
        this.filterState.performers.delete(id);
        this.updateActivePills();
        this.updateQueryInputDisplay();
        this.debouncedApplyFilters();
      }));
    }
  }

  private appendStudioPills(): void {
    const hasPrior = this.filterState.tags.size > 0 || this.filterState.performers.size > 0;
    let first = true;
    for (const [id, name] of this.filterState.studios) {
      if (first) {
        if (hasPrior) this.activePillsBar!.appendChild(this.createPillWord('by'));
        first = false;
      } else {
        this.activePillsBar!.appendChild(this.createPillWord('or'));
      }
      this.activePillsBar!.appendChild(this.createActivePill(name, () => {
        this.filterState.studios.delete(id);
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

    const total = this.filterState.pillCount;
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
        this.filterState.reset();
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
      if (name) this.savedSearches.save(name, this.filterState.toSnapshot());
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

    input.addEventListener('blur', () => {
      if (this.saveSearchInputVisible) cancel();
    });

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.textContent = '✓';
    confirmBtn.setAttribute('aria-label', 'Save search');
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

  async init(filters?: FilterOptions): Promise<void> {
    this.filterHistory.start();

    this.ratingConfigReady = this.api.getUIConfiguration()
      .then((config) => { this.ratingSystemConfig = config || { type: 'stars', starPrecision: 'full' }; })
      .catch((error) => {
        console.warn('Failed to load rating system configuration, using defaults', error);
        this.ratingSystemConfig = { type: 'stars', starPrecision: 'full' };
      });
    this.currentFilters = filters;
    await this.refreshFeed();
    if (this.posts.size === 0) {
      await this.loadVideos(this.currentFilters, false, undefined, true);
    }
    
    if (globalThis.window !== undefined) {
      const suggestionDelay = 5000;
      globalThis.setTimeout(() => {
        this.preloadSuggestions().catch((e) => console.warn('Preload suggestions failed', e));
      }, suggestionDelay);
    }
  }

  private async preloadSuggestions(): Promise<void> {
    if (this.isPreloading) {
      return;
    }

    this.isPreloading = true;
    try {
      const [tags, performers] = await Promise.all([
        this.api.searchMarkerTags('', 20),
        this.api.searchPerformers('', 20),
        this.loadSavedFiltersIfNeeded()
      ]);

      this.preloadedTags = tags;
      this.preloadedPerformers = performers;
    } catch (error) {
      console.warn('Failed to preload suggestions:', error);
    } finally {
      this.isPreloading = false;
    }
  }

  private prepareLoadVideos(signal?: AbortSignal, append: boolean = false): AbortSignal {
    if (!append && this.activeLoadVideosAbortController) {
      this.activeLoadVideosAbortController.abort();
      this.cleanupLoadObservers();
      this.stopLoadingVideos();
      this.activeLoadVideosAbortController = undefined;
    }
    if (signal) {
      return signal;
    }
    this.activeLoadVideosAbortController ??= new AbortController();
    return this.activeLoadVideosAbortController.signal;
  }

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

  private async processItemForRender(
    createContainer: () => HTMLElement | null | Promise<HTMLElement | null>,
    fragment: DocumentFragment | null
  ): Promise<{ fragment: DocumentFragment; postContainer: HTMLElement | null }> {
    const postContainer = await createContainer();
    const currentFragment = fragment ?? document.createDocumentFragment();

    if (postContainer) {
      currentFragment.appendChild(postContainer);
    }

    return { fragment: currentFragment, postContainer };
  }

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

  private removeSkeletonIfNeeded(append: boolean, index: number): void {
    if (!append && index < this.getSkeletonCount()) {
      this.removeSkeletonLoader();
    }
  }

  private shouldInsertFragment(index: number, renderChunkSize: number, markersLength: number): boolean {
    return (index + 1) % renderChunkSize === 0 || index === markersLength - 1;
  }

  private insertFragment(fragment: DocumentFragment, fragmentPostCount: number): void {
    if (fragmentPostCount === 0) {
      return;
    }

    const postsContainer = this.postsContainer;
    if (!postsContainer) {
      return;
    }

    postsContainer.appendChild(fragment);
  }

  private async waitForRenderDelay(index: number, markersLength: number, renderDelay: number): Promise<void> {
    if (index < markersLength - 1) {
      await new Promise(resolve => setTimeout(resolve, renderDelay));
    }
  }

  private async renderPostsProgressively(
    content: Array<{ type: 'marker' | 'image'; data: SceneMarker | Image; date?: string }> | SceneMarker[],
    append: boolean,
    signal: AbortSignal | undefined,
    renderChunkSize: number,
    renderDelay: number
  ): Promise<void> {
    let fragment: DocumentFragment | null = null;
    let fragmentPostCount = 0;

    const isMergedContent = content.length > 0 && 'type' in content[0];
    const items = isMergedContent 
      ? content as Array<{ type: 'marker' | 'image'; data: SceneMarker | Image; date?: string }>
      : (content as SceneMarker[]).map(m => ({ type: 'marker' as const, data: m, date: m.scene.date }));

    for (let i = 0; i < items.length; i++) {
      if (this.checkAbortAndCleanup(signal)) {
        return;
      }

      const result = await this.renderItemForRender(items[i], fragment, signal); // NOSONAR: in-order progressive render
      fragment = result.fragment;
      
      if (result.postContainer) {
        fragmentPostCount++;
      }

      this.removeSkeletonIfNeeded(append, i);

      if (this.shouldInsertFragment(i, renderChunkSize, items.length) && fragment && fragmentPostCount > 0) {
        const flushed = this.flushFragment(fragment, fragmentPostCount);
        fragment = flushed.fragment;
        fragmentPostCount = flushed.fragmentPostCount;

        await this.waitForRenderDelay(i, items.length, renderDelay); // NOSONAR: deliberate yield between chunks
      }
    }
  }

  private async renderItemForRender(
    item: { type: 'marker' | 'image'; data: SceneMarker | Image; date?: string },
    fragment: DocumentFragment | null,
    signal?: AbortSignal
  ): Promise<{ fragment: DocumentFragment; postContainer: HTMLElement | null }> {
    const itemId = (item.data as { id: string }).id;
    if (this.posts.has(itemId)) {
      return { fragment: fragment ?? document.createDocumentFragment(), postContainer: null };
    }

    const result = item.type === 'marker'
      ? await this.processMarkerForRender(item.data as SceneMarker, fragment, signal)
      : await this.processImageForRender(item.data as Image, fragment, signal);
    if (result.postContainer) {
      this.seenHistory.mark(item.type, itemId);
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

  private createPostFromImage(image: Image, signal?: AbortSignal): HTMLElement | null {
    const { isVideo, videoFile } = detectVideoFromVisualFiles(image.visualFiles);
    
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

    if (signal?.aborted) {
      return null;
    }

    this.setupLazyLoadingForImage(postContainer, post, image, imageUrl, signal);
    return postContainer;
  }

  private createVideoPostFromImage(image: Image, signal?: AbortSignal): HTMLElement | null {
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

    if (this.useHDMode) {
      post.setHQMode(true);
    }

    return postContainer;
  }

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
      showViewCountBadge: this.settings.showViewCountBadge !== false,
      ratingSystemConfig: this.ratingSystemConfig,
      hdModeFromSettings: this.useHDMode,
      reelAutoScroll: this.settings.reelAutoScroll === true,
      onReelAdvance: () => this.reelScroller?.next(),
    };
  }

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

  private tryGetValidMediaUrl(path: string | undefined, baseUrl: string): string | undefined {
    if (!path) return undefined;
    const url = buildFullUrl(path, baseUrl);
    return normalizeMediaUrl(url) ?? undefined;
  }

  private getMp4VideoUrlForImageHD(image: Image, videoPath: string | undefined, baseUrl: string): string | undefined {
    if (videoPath && /^https?:\/\//i.test(videoPath)) {
      return this.tryGetValidMediaUrl(videoPath, baseUrl);
    }
    return this.tryGetValidMediaUrl(image.paths?.image, baseUrl);
  }

  private getMp4VideoUrlForImageNonHD(image: Image, videoPath: string | undefined, baseUrl: string): string | undefined {
    const previewUrl = this.tryGetValidMediaUrl(image.paths?.preview, baseUrl);
    if (previewUrl) return previewUrl;
    if (videoPath && /^https?:\/\//i.test(videoPath)) {
      const videoUrl = this.tryGetValidMediaUrl(videoPath, baseUrl);
      if (videoUrl) return videoUrl;
    }
    return this.tryGetValidMediaUrl(image.paths?.image, baseUrl);
  }

  private getMp4VideoUrlForImage(image: Image, videoPath: string | undefined, baseUrl: string): string | undefined {
    return this.useHDMode
      ? this.getMp4VideoUrlForImageHD(image, videoPath, baseUrl)
      : this.getMp4VideoUrlForImageNonHD(image, videoPath, baseUrl);
  }

  private getImageUrlForPost(image: Image): string | undefined {
    const baseUrl = getStashBaseUrl();
    
    const { isVideo, videoFile } = detectVideoFromVisualFiles(image.visualFiles);
    
    const videoPath = videoFile?.path;
    const isMp4Video = isVideo && videoPath && isMp4File(videoPath);
    
    if (isMp4Video) {
      const mp4Url = this.getMp4VideoUrlForImage(image, videoPath, baseUrl);
      if (mp4Url) {
        return mp4Url;
      }
    }
    
    return getImageUrlForDisplay(image, true);
  }

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
      {
        ...this.buildCommonPostOptions(),
      }
    );
    
    post.initialize();
    return post;
  }

  private setupLazyLoadingForImage(
    postContainer: HTMLElement,
    post: ImagePost,
    image: Image,
    imageUrl: string,
    signal?: AbortSignal
  ): void {
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
      { root: this.scrollContainer, rootMargin: '200px' }
    );

    observer.observe(postContainer);
    this.loadObservers.set(image.id, observer);
  }

  private initializeLoadState(append: boolean): void {
    this.isLoading = true;
    this.hideError();
    if (!append) {
      this.clearPosts();
      this.showSkeletonLoaders();
      this.currentPage = 1;
      this.hasMore = true;
      this.markersLoadedCount = 0;
      this.imagesLoadedCount = 0;
      this.shortFormOffset = 0;
      this.shortFormScanPaused = false;
      this.markerPageSize = 0;
      this.imagePageSize = 0;
      if (this.appendRetryTimeoutId) {
        clearTimeout(this.appendRetryTimeoutId);
        this.appendRetryTimeoutId = undefined;
        this.appendRetryCount = 0;
      }
    }
  }

  private checkAbortAndCleanup(signal?: AbortSignal): boolean {
    if (signal?.aborted) {
      this.isLoading = false;
      this.hideSkeletonLoaders();
      return true;
    }
    return false;
  }

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

  private handleEmptyMarkers(append: boolean): void {
    if (append) {
      this.scheduleAppendRetry();
    } else {
      this.hasMore = false;
    }
    this.hideSkeletonLoaders();
  }

  private finalizeLoadState(append: boolean, page: number, firstCards: boolean): void {
    this.appendRetryCount = 0;
    if (append) {
      this.currentPage = page;
    }

    if (!append) {
      this.hideSkeletonLoaders();
    }

    setTimeout(() => this.prefetchIfNearEnd(), 0);

    if (firstCards) {
      requestAnimationFrame(() => {
        this.reelScroller?.realign();
        this.ensureReelInitialCardLoaded();
      });
    }
  }

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

  async refreshFeed(): Promise<void> {
    this.clearPosts();

    this.scrollToTop();
    
    this.currentPage = 1;
    this.hasMore = true;
    this.markersLoadedCount = 0;
    this.imagesLoadedCount = 0;
    this.shortFormOffset = 0;
    this.markerPageSize = 0;
    this.imagePageSize = 0;
    this.appendRetryCount = 0;
    if (this.appendRetryTimeoutId) {
      clearTimeout(this.appendRetryTimeoutId);
      this.appendRetryTimeoutId = undefined;
    }
    
    if (this.currentFilters && !this.currentFilters.savedFilterId) {
      this.currentFilters.tagDepth = this.settings.includeSubtags ? -1 : 0;
      this.currentFilters.studioDepth = this.settings.includeSubtags ? -1 : 0;
    }

    await this.loadVideos(this.currentFilters, false, undefined, true);
  }

  private determineContentLoadingFlags(filters?: FilterOptions): {
    shouldLoadMarkers: boolean;
    shouldLoadImages: boolean;
    shouldLoadShortForm: boolean;
    shouldLoadRandom: boolean;
    shouldLoadScenePreviews: boolean;
  } {
    const activeFilters = filters || this.currentFilters || {};

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
    const isMarkerNameSearch = !!this.filterState.markerName;

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

  private calculatePaginationForContent(
    append: boolean,
    markerLimit: number,
    limit: number
  ): { markerPageSize: number; imagePageSize: number } {
    if (!append) {
      this.markerPageSize = markerLimit;
      this.imagePageSize = limit;
    }
    
    return {
      markerPageSize: this.markerPageSize || markerLimit,
      imagePageSize: this.imagePageSize || limit
    };
  }

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
    shortFormNextOffset: number | null;
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
      shortFormNextOffset: shortFormResult.nextOffset,
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
    shortFormOffset: number | null;
    scenePreviewOffset: number;
  } {
    return {
      markerOffset: append ? this.markersLoadedCount : 0,
      imageOffset: append ? this.imagesLoadedCount : 0,
      shortFormOffset: append ? this.shortFormOffset : 0,
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
    shortFormOffset: number | null;
    signal: AbortSignal | undefined;
    shouldLoadShortForm: boolean;
  }): Promise<{ markers: SceneMarker[]; totalCount: number; nextOffset: number | null }> {
    const { currentFilters, shortFormLimit, shortFormOffset, signal, shouldLoadShortForm } = options;
    if (!shouldLoadShortForm || shortFormOffset === null) {
      return { markers: [], totalCount: 0, nextOffset: null };
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
      includeScenesWithoutMarkers: !this.settings.randomIncludeScenesWithMarkers,
      randomMinSceneDuration: this.settings.randomLongScenesOnly ? this.settings.shortFormMaxDuration || 120 : undefined,
    };
    const result = await this.api.fetchSceneMarkers(filters, signal);
    return {
      markers: this.filterMarkersByName(result.markers),
      totalCount: result.totalCount
    };
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

  private processFetchedContent(options: {
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
    shouldLoadRandom?: boolean;
    realMarkersCount?: number;
  }): Array<{ type: 'marker' | 'image'; data: SceneMarker | Image; date?: string }> {
    const { content, counts, currentFilters, offset, append, shouldLoadRandom, realMarkersCount } = options;
    const { markers, shortFormMarkers, scenePreviewMarkers, images } = content;
    const { markerCount, shortFormCount, imageCount } = counts;

    const mergedContent = this.seenHistory.filter(mixContent(markers, shortFormMarkers, images, scenePreviewMarkers), append, !!currentFilters.savedFilterId);

    const expectedLimit = currentFilters.limit || FeedContainer.CONTENT_LOAD_LIMIT;

    const trackableMarkers = realMarkersCount ?? markers.length;

    if (append) {
      this.markersLoadedCount += trackableMarkers;
      this.imagesLoadedCount += images.length;
    } else {
      this.markersLoadedCount = trackableMarkers;
      this.imagesLoadedCount = images.length;
    }

    this.processLoadedContent({
      images,
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
      shouldLoadRandom,
      append
    });

    return mergedContent;
  }

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

    const renderChunkSize = 6;
    const renderDelay = 8;
    const firstCards = this.postOrder.length === 0;
    await this.renderPostsProgressively(mergedContent, append, signal, renderChunkSize, renderDelay);

    if (this.checkAbortAndCleanup(signal)) {
      return;
    }

    this.finalizeLoadState(append, page, firstCards);
  }

  private holdForShortFormScan(contentCount: number, hasMoreShortForm: boolean, page: number): boolean {
    const wasPaused = this.shortFormScanPaused;
    const pauseShortForm = contentCount === 0 && hasMoreShortForm;
    if (wasPaused !== pauseShortForm) {
      this.shortFormScanPaused = pauseShortForm;
      this.endCard?.remove();
      this.endCard = undefined;
    }
    if (contentCount === 0 && (wasPaused || pauseShortForm)) {
      this.hasMore = false;
      this.currentPage = page;
      this.hideSkeletonLoaders();
      return true;
    }
    if (hasMoreShortForm) this.hasMore = true;
    return false;
  }

  async loadVideos(filters?: FilterOptions, append: boolean = false, signal?: AbortSignal, force: boolean = false): Promise<void> {
    if (!force && this.isLoading) {
      return;
    }

    signal = this.prepareLoadVideos(signal, append);
    this.initializeLoadState(append);
    const reqId = ++this.latestLoadId;

    try {
      const currentFilters: FilterOptions = { ...(filters || this.currentFilters) };
      await Promise.all([
        this.updateExcludedTagIds(),
        this.filterState.tags.size > 0
          ? this.api.getTagSources([...this.filterState.tags.keys()].map(String))
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

      const markerLimit = shouldLoadMarkers ? limit : 0;
      const shortFormLimit = shouldLoadShortForm ? limit : 0;

      const {
        markers,
        images,
        shortFormMarkers,
        randomMarkers,
        scenePreviewMarkers,
        markerCount,
        imageCount,
        shortFormCount,
        shortFormNextOffset,
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

      this.currentFilters = currentFilters;
      await this.ratingConfigReady;

      if (reqId !== this.latestLoadId || this.checkAbortAndCleanup(signal)) {
        return;
      }
      this.shortFormOffset = shortFormNextOffset;

      const allMarkersForContent = shuffle([...markers, ...shortFormMarkers, ...randomMarkers]);
      const mergedContent = this.processFetchedContent({
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
        realMarkersCount: markers.length,
        currentFilters,
        offset,
        append,
        shouldLoadRandom
      });
      if (this.holdForShortFormScan(mergedContent.length, shortFormNextOffset !== null, page)) {
        return;
      }

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
      if (reqId === this.latestLoadId) this.updateEndCard();
    }
  }

  private processLoadedContent(options: {
    images: Image[];
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
    shouldLoadRandom?: boolean;
    append: boolean;
  }): void {
    const {
      images,
      counts: { markerCount, shortFormCount, imageCount },
      pagination: { offset, expectedLimit, totalContentLength },
      shouldLoadRandom,
      append
    } = options;

    this.hasMore = computeHasMore({
      append,
      offset,
      expectedLimit,
      totalContentLength,
      counts: { markerCount, shortFormCount, imageCount },
      imagesOnly: !!this.settings.imagesOnly,
      imagesLoaded: images.length,
      shouldLoadRandom: shouldLoadRandom ?? false,
    });
  }

  private shouldLoadImages(): boolean {
    const imagesEnabled = this.settings.includeImagesInFeed ?? true;
    const hasFileTypes = (this.settings.enabledFileTypes?.length ?? 0) > 0;
    return imagesEnabled && hasFileTypes;
  }

  private shouldLoadShortFormContent(): boolean {
    return this.settings.includeShortForm !== false;
  }

  private async fetchShortFormVideosForLoad(
    currentFilters: FilterOptions,
    limit: number,
    offset: number,
    signal?: AbortSignal
  ): Promise<{ markers: SceneMarker[]; totalCount: number; nextOffset: number | null }> {
    if (!this.api) {
      return { markers: [], totalCount: 0, nextOffset: null };
    }

    const maxDuration = this.settings.shortFormMaxDuration || 120;
    const result = await this.api.fetchShortFormVideos(
      currentFilters,
      maxDuration,
      limit,
      offset,
      signal,
      { tagIds: this.settings.shortFormTags?.map(tag => tag.id), folder: this.settings.shortFormFolder }
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
      
      if (sortSeed && filters) {
        filters.sortSeed = sortSeed;
      }

      const images = graphQLImages.map((img) => this.convertGraphQLImageToImage(img));
      return { images, totalCount };
    } catch (error) {
      console.error('FeedContainer: Failed to load images', error);
      return { images: [], totalCount: 0 };
    }
  }

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

  private cleanupLoadObservers(): void {
    for (const [, observer] of this.loadObservers.entries()) {
      observer.disconnect();
    }
    this.loadObservers.clear();
  }

  cancelAllPendingRequests(): void {
    if (this.activeLoadVideosAbortController) {
      this.activeLoadVideosAbortController.abort();
      this.activeLoadVideosAbortController = undefined;
    }
    this.stopLoadingVideos();
  }

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

  private createPost(marker: SceneMarker, signal?: AbortSignal): HTMLElement | null {
    const playMarkerToEnd = this.settings.playMarkersToEnd === true
      && !/^(synthetic|shortform|scenepreview|image)-/.test(marker.id);
    const safeVideoUrl = playMarkerToEnd
      ? this.api.getSceneSources(marker.scene)[0]?.src
      : this.getVideoUrlForPost(marker);
    if (!safeVideoUrl || (!playMarkerToEnd && !this.isVideoCodecSupported(marker, safeVideoUrl))) {
      return null;
    }

    const postContainer = this.createPostContainer();
    const post = this.createVideoPostInstance(postContainer, marker, safeVideoUrl, playMarkerToEnd);
    
    this.posts.set(marker.id, post);
    this.postOrder.push(marker.id);

    if (signal?.aborted) {
      return null;
    }

    return postContainer;
  }

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

  private createPostContainer(): HTMLElement {
    const postContainer = document.createElement('article');
    postContainer.className = 'video-post-wrapper';
    return postContainer;
  }

  private calculateStartTime(marker: SceneMarker): number | undefined {
    if (!this.useHDMode) {
      return undefined;
    }

    return marker.seconds;
  }

  private createVideoPostInstance(
    postContainer: HTMLElement,
    marker: SceneMarker,
    safeVideoUrl: string,
    playMarkerToEnd: boolean
  ): VideoPost {
    const isShortForm = typeof marker.id === 'string' && marker.id.startsWith('shortform-');
    const isScenePreview = typeof marker.id === 'string' && marker.id.startsWith('scenepreview-');
    const wholeScene = playMarkerToEnd || isShortForm || isScenePreview;
    const snippetEnd = wholeScene ? undefined : marker.seconds + (this.settings.randomSnippetDuration ?? 20);
    const postData: VideoPostData = {
      marker,
      videoUrl: safeVideoUrl,
      startTime: playMarkerToEnd ? marker.seconds : this.calculateStartTime(marker),
      endTime: playMarkerToEnd ? undefined : marker.end_seconds ?? snippetEnd,
      playMarkerToEnd,
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

    if ((isShortForm || this.useHDMode) && !isScenePreview) {
      post.setHQMode(true);
    }
    
    return post;
  }

  private clearPosts(): void {
    for (const post of this.posts.values()) {
      post.destroy();
    }
    this.posts.clear();
    this.postOrder = [];
    this.endCard = undefined;
    if (this.postsContainer) {
      this.postsContainer.innerHTML = '';
    }
    
    this.cleanupLoadObservers();
  }

  private applyCustomSavedSearch(search: SavedSearch): void {
    this.filterState.replace(search);
    this.closeSuggestions();
    this.updateActivePills();
    this.updateQueryInputDisplay();
    this.debouncedApplyFilters();
  }

  private updateEndCard(): void {
    const container = this.postsContainer;
    if (!container) return;
    const shouldShow = !this.hasMore;
    const present = this.endCard?.parentNode === container;
    if (shouldShow && !present) {
      const onContinue = this.shortFormScanPaused ? () => this.loadVideos(undefined, true) : undefined;
      this.endCard = buildEndOfFeedCard(() => this.openSearchFromEndCard(), onContinue);
      container.appendChild(this.endCard);
    } else if (!shouldShow && this.endCard) {
      this.endCard.remove();
      this.endCard = undefined;
    }
  }

  private openSearchFromEndCard(): void {
    this.headerBar?.querySelector<HTMLInputElement>('.feed-filters__input')?.focus();
  }

  private cleanupDistantPosts(): void {
    const keepBehind = this.useHDMode ? 8 : 12;

    if (this.reelScroller?.isBusy()) {
      return;
    }

    const currentIdx = this.getCurrentPostOrderIndex();
    if (currentIdx < 0) {
      return;
    }

    const firstToKeep = currentIdx - keepBehind;
    if (firstToKeep <= 0) {
      return;
    }

    const currentCard = this.posts.get(this.postOrder[currentIdx])?.getContainer();
    const removeIds = this.postOrder.slice(0, firstToKeep);

    for (const postId of removeIds) {
      this.removePost(postId);
    }

    if (currentCard?.parentNode) {
      this.reelScroller?.snapToCard(currentCard);
    }
  }

  private getCurrentPostOrderIndex(): number {
    const currentId = this.reelScroller?.getCurrentPostId() ?? this.getTopMostCardPostId();
    return currentId ? this.postOrder.indexOf(currentId) : -1;
  }

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

  private removePost(postId: string): void {
    const post = this.posts.get(postId);
    if (post) {
      post.destroy();
      this.posts.delete(postId);
      this.removePostFromOrder(postId);
    }
    
    this.cleanupLoadObserver(postId);
  }

  private removePostFromOrder(postId: string): void {
    const index = this.postOrder.indexOf(postId);
    if (index !== -1) {
      this.postOrder.splice(index, 1);
    }
  }

  private cleanupLoadObserver(postId: string): void {
    const observer = this.loadObservers.get(postId);
    if (observer) {
      observer.disconnect();
      this.loadObservers.delete(postId);
    }
  }

  private shouldSkipHeaderHandling(): boolean {
    if (this.settings.autoHideSearchBar === false) return true;

    const suggestions = document.querySelector('.feed-filters__suggestions') as HTMLElement;
    if (suggestions && suggestions.style.display !== 'none' && suggestions.style.display !== '') {
      return true;
    }

    return false;
  }

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

  private hideHeader(): void {
    if (!this.headerBar) {
      return;
    }
    
    const headerHeight = this.headerBar.getBoundingClientRect().height;
    const hideDistance = headerHeight + 30;
    this.headerBar.style.transform = `translateY(-${hideDistance}px)`;
  }

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

    const previousHandler = this.scrollHandler;
    const previousTarget = this.scrollEventTarget;
    if (previousHandler && previousTarget) {
      previousTarget.removeEventListener('scroll', previousHandler);
    }
    this.scrollHandler = handleScroll;
    this.scrollEventTarget = this.scrollContainer;
    this.scrollEventTarget.addEventListener('scroll', handleScroll, { passive: true });
  }

  private setupReelScroller(): void {
    if (!this.scrollContainer) return;

    this.reelScroller ??= new ReelScroller({
      scrollContainer: this.scrollContainer,
      getCards: () => this.getAllCardContainers(),
      getPostId: (card) => this.getPostIdFromCard(card),
      onSettle: (postId, index) => this.handleReelSettle(postId, index),
      onAdvance: (index) => this.maybePrefetchMore(index),
      yieldToPage: () => this.pageCanStillScroll(),
    });
    this.reelScroller.enable();
  }

  private handleReelSettle(postId: string, _index: number): void {
    if (postId === END_CARD_POST_ID) {
      this.playback.pauseAll();
      this.showHeader();
      return;
    }
    this.playback.setActive(postId);
  }

  private lastSafetyPrefetchLength = -1;

  private prefetchIfNearEnd(): void {
    if (this.postOrder.length === this.lastSafetyPrefetchLength) return;
    this.lastSafetyPrefetchLength = this.postOrder.length;
    const currentId = this.reelScroller?.getCurrentPostId();
    this.maybePrefetchMore(currentId ? Math.max(0, this.postOrder.indexOf(currentId)) : 0);
  }

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

  private getCurrentPost(): PostType | undefined {
    const postId = this.reelScroller?.getCurrentPostId() ?? this.getTopMostCardPostId();
    return postId ? this.posts.get(postId) : undefined;
  }

  private readonly hotkeyActions: HotkeyActions = {
    step: (direction) => {
      if (!this.reelScroller) return false;
      if (direction > 0) this.reelScroller.next();
      else this.reelScroller.prev();
      return true;
    },
    seek: (direction) => {
      const post = this.getCurrentPost();
      if (!(post instanceof VideoPostBase)) return false;
      post.seekBy(direction * (this.settings.arrowSeekSeconds ?? 5));
      return true;
    },
    togglePlay: () => {
      const post = this.getCurrentPost();
      return post instanceof VideoPostBase && post.togglePlayback();
    },
    toggleMute: () => {
      this.setGlobalMuteState(!this.globalMuteState);
      showToast(this.globalMuteState ? 'Muted' : 'Unmuted');
      return true;
    },
    press: (button) => this.getCurrentPost()?.pressButton(button) ?? false,
    rate: (key) => {
      if (this.settings.enableRatingHotkeys === false) return false;
      const message = this.getCurrentPost()?.rateByHotkey(key);
      if (message) showToast(message);
      return !!message;
    },
    toggleHelp: () => {
      toggleHotkeyHelp();
      return true;
    },
  };

  private readonly onHotkey = (event: KeyboardEvent): void => handleHotkey(event, this.hotkeyActions);

  private teardownListeners(): void {
    document.removeEventListener('keydown', this.onHotkey);
    globalThis.visualViewport?.removeEventListener('resize', this.syncReelHeight);
    globalThis.removeEventListener('resize', this.syncReelHeight);
    this.filterHistory.stop();
    this.autoplayUnlock.stop();

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
    this.seenHistory.dispose();
    if (this.placeholderAnimationInterval) {
      clearInterval(this.placeholderAnimationInterval);
      this.placeholderAnimationInterval = undefined;
    }
    if (this.appendRetryTimeoutId) {
      clearTimeout(this.appendRetryTimeoutId);
      this.appendRetryTimeoutId = undefined;
    }

    this.cleanupLoadObservers();
  }

  destroy(): void {
    this.suggestionAbortController?.abort();
    this.cancelAllPendingRequests();
    if (this.settingsReloadTimeoutId) {
      clearTimeout(this.settingsReloadTimeoutId);
      this.settingsReloadTimeoutId = undefined;
    }
    this.teardownListeners();
    this.clearPosts();
    this.api.destroy();
  }

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

  private getPostIdFromCard(card: HTMLElement): string | null {
    return card.dataset.postId ?? null;
  }

  private ensureReelInitialCardLoaded(): void {
    const postId = this.reelScroller?.getCurrentPostId();
    if (!postId) return;
    this.playback.setActive(postId);
  }

  private showSkeletonLoaders(): void {
    const existingSkeletons = Array.from(this.postsContainer.querySelectorAll('.video-post-skeleton'));
    
    if (existingSkeletons.length > 0) {
      this.skeletonLoaders = existingSkeletons as HTMLElement[];
      
      const skeletonCount = FeedContainer.CONTENT_LOAD_LIMIT;
      const needed = skeletonCount - existingSkeletons.length;
      if (needed > 0) {
        for (let i = 0; i < needed; i++) {
          const skeleton = this.createSkeletonLoader();
          this.postsContainer.appendChild(skeleton);
          this.skeletonLoaders.push(skeleton);
        }
      } else if (needed < 0) {
        const excess = existingSkeletons.slice(skeletonCount);
        for (const skeleton of excess) {
          skeleton.remove();
        }
        this.skeletonLoaders = existingSkeletons.slice(0, skeletonCount) as HTMLElement[];
      }
    } else {
      this.hideSkeletonLoaders();
      
      const skeletonCount = FeedContainer.CONTENT_LOAD_LIMIT;
      this.skeletonLoaders = [];
      
      for (let i = 0; i < skeletonCount; i++) {
        const skeleton = this.createSkeletonLoader();
        this.postsContainer.appendChild(skeleton);
        this.skeletonLoaders.push(skeleton);
      }
    }
  }

  private createSkeletonLoader(): HTMLElement {
    const skeleton = document.createElement('article');
    skeleton.className = 'video-post-wrapper video-post-skeleton';
    
    const card = document.createElement('div');
    card.className = 'video-post';
    
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
    
    const player = document.createElement('div');
    player.className = 'video-post__player aspect-16-9';
    player.style.position = 'relative';
    player.style.backgroundColor = THEME.colors.backgroundSecondary;
    player.style.overflow = 'hidden';
    card.appendChild(player);
    
    const footer = document.createElement('div');
    footer.className = 'video-post__footer';
    footer.style.padding = '8px 16px';
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '4px';
    
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

  private hideSkeletonLoaders(): void {
    for (const skeleton of this.skeletonLoaders) {
      skeleton.remove();
    }
    this.skeletonLoaders = [];
  }

  private removeSkeletonLoader(): void {
    if (this.skeletonLoaders.length > 0) {
      const skeleton = this.skeletonLoaders.shift();
      skeleton?.remove();
    }
  }

  private getSkeletonCount(): number {
    return this.skeletonLoaders.length;
  }

  private getApplicableSavedFilters(): SavedFilter[] {
    const imagesOn = this.shouldLoadImages();
    return this.savedFiltersCache.filter((f) => f.mode !== 'IMAGES' || imagesOn);
  }

  private loadSavedFiltersIfNeeded(): Promise<void> {
    this.savedFiltersPromise ??= this.api.fetchSavedFilters().then(
      (items) => { this.savedFiltersCache = items; },
      (e) => { console.error('Failed to load saved filters', e); this.savedFiltersCache = []; this.savedFiltersPromise = undefined; }
    );
    return this.savedFiltersPromise;
  }

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

  updateSettings(newSettings: Partial<FeedSettings>): void {
    this.applySettings(newSettings, false);
    this.refreshAutoplayAfterLayout();
  }

  getSettings(): FeedSettings {
    return { ...this.settings };
  }
}
