/**
 * Feed Container
 * Main application container managing the feed
 */

import { SceneMarker, FilterOptions, FeedSettings, VideoPostData } from './types.js';
import { StashAPI } from './StashAPI.js';
import { VideoPost } from './VideoPost.js';
import { NativeVideoPlayer } from './NativeVideoPlayer.js';
import { VisibilityManager } from './VisibilityManager.js';
import { FavoritesManager } from './FavoritesManager.js';
import { throttle, debounce, isValidMediaUrl, detectDeviceCapabilities, DeviceCapabilities, isStandaloneNavigator } from './utils.js';
import { posterPreloader } from './PosterPreloader.js';

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
  backgroundPreloadScrollVelocityThreshold: 2.0, // pixels/ms, threshold for fast scroll detection
};

export class FeedContainer {
  private container: HTMLElement;
  private scrollContainer: HTMLElement;
  private api: StashAPI;
  private visibilityManager: VisibilityManager;
  private favoritesManager: FavoritesManager;
  private posts: Map<string, VideoPost>;
  private postOrder: string[];
  private settings: FeedSettings;
  private markers: SceneMarker[] = [];
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
  private readonly eagerPreloadCount: number;
  private readonly maxSimultaneousPreloads: number;
  private readonly isMobileDevice: boolean;
  private preloadedTags: Array<{ id: string; name: string }> = [];
  private preloadedPerformers: Array<{ id: string; name: string; image_path?: string }> = [];
  private isPreloading: boolean = false;
  private backgroundPreloadActive: boolean = false;
  private backgroundPreloadHandle?: number;
  private backgroundPreloadPriorityQueue: string[] = [];
  private activePreloadPosts: Set<string> = new Set();
  private lastScrollTop: number = 0;
  private lastScrollTime: number = 0;
  private scrollVelocity: number = 0;
  private currentlyPreloadingCount: number = 0;
  private mobilePreloadQueue: string[] = [];
  private mobilePreloadActive: boolean = false;
  private readonly initialLoadLimit: number; // Set in constructor based on device
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
  private loadObservers: Map<string, IntersectionObserver> = new Map(); // Track load observers for cleanup
  private deviceCapabilities: DeviceCapabilities; // Device capabilities for adaptive quality
  private shuffleToggle?: HTMLElement; // Reference to shuffle toggle button

  constructor(container: HTMLElement, api?: StashAPI, settings?: Partial<FeedSettings>) {
    this.container = container;
    this.api = api || new StashAPI();
    this.settings = { ...DEFAULT_SETTINGS, ...settings };

    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
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

    // Check if container structure already exists (from initial HTML skeleton)
    let existingScrollContainer = this.container.querySelector('.feed-scroll-container') as HTMLElement;
    if (existingScrollContainer) {
      this.scrollContainer = existingScrollContainer;
    } else {
      // Create scroll container
      this.scrollContainer = document.createElement('div');
      this.scrollContainer.className = 'feed-scroll-container';
      this.container.appendChild(this.scrollContainer);
    }
    
    // Load HD mode preference (default OFF -> marker previews) BEFORE rendering header/toggle
    try {
      const savedHD = localStorage.getItem('stashgifs-useHDMode');
      this.useHDMode = savedHD === 'true' ? true : false;
    } catch {
      this.useHDMode = false;
    }
    // Load shuffle mode preference (0 = off, 1 = markers only, 2 = all)
    try {
      const savedShuffle = localStorage.getItem('stashgifs-shuffleMode');
      if (savedShuffle !== null) {
        const parsed = parseInt(savedShuffle, 10);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 2) {
          this.shuffleMode = parsed;
        }
      }
    } catch {
      this.shuffleMode = 0;
    }
    // Always default to muted (volume mode disabled)
    this.useVolumeMode = false;
    
    // Create header bar with unified search
    this.createHeaderBar();
    
    // Check if posts container already exists
    let existingPostsContainer = this.scrollContainer.querySelector('.feed-posts') as HTMLElement;
    if (existingPostsContainer) {
      this.postsContainer = existingPostsContainer;
    } else {
      // Create posts container (separate from filter bar so we don't wipe it)
      this.postsContainer = document.createElement('div');
      this.postsContainer.className = 'feed-posts';
      this.scrollContainer.appendChild(this.postsContainer);
    }

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
      } finally {
        // Clean up after a short delay
        setTimeout(() => {
          if (dummyVideo.parentNode) {
            dummyVideo.parentNode.removeChild(dummyVideo);
          }
        }, 1000);
      }
    };
    
    // Unlock on any user interaction
    const events = ['touchstart', 'touchend', 'click', 'scroll', 'touchmove'];
    events.forEach(event => {
      document.addEventListener(event, unlock, { once: true, passive: true });
    });
  }

  /**
   * Close suggestions overlay and unlock body scroll
   */
  private closeSuggestions(): void {
    // Find all suggestion overlays (there might be multiple instances)
    const suggestions = document.querySelectorAll('.feed-filters__suggestions');
    suggestions.forEach((suggestion) => {
      const el = suggestion as HTMLElement;
      // Hide panel first to prevent any flash of old content
      el.style.display = 'none';
      // Clear all content while hidden to ensure panel is empty when it opens next time
      // Use removeChild for better performance than innerHTML
      while (el.firstChild) {
        el.removeChild(el.firstChild);
      }
    });
    
    this.unlockBodyScroll();
    
    // Refresh cache in the background for next time the overlay opens
    // Don't await - let it run asynchronously
    if (!this.isPreloading) {
      this.preloadSuggestions().catch((e) => console.warn('Failed to refresh suggestions cache', e));
    }
  }

  /**
   * Create top header bar with unified search
   */
  private createHeaderBar(): void {
    // Saved filters will be loaded lazily when filter dropdown opens
    let savedFiltersCache: Array<{ id: string; name: string }> = [];

    const header = document.createElement('div');
    this.headerBar = header;
    header.className = 'feed-header-bar';
    header.style.position = 'sticky';
    
    // Detect if we're in mobile Safari standalone/app mode
    const nav = window.navigator;
    const isStandalone = (isStandaloneNavigator(nav) && nav.standalone) || 
                         window.matchMedia('(display-mode: standalone)').matches;
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    
    // On mobile Safari app mode, position header right below the notch
    if (isStandalone && isIOS) {
      // Position sticky header a bit more down when visible
      header.style.top = 'calc(env(safe-area-inset-top, 0px) * 0.7)';
      // Add a small padding for spacing below the notch
      header.style.paddingTop = '8px';
      header.style.paddingBottom = '8px';
      header.style.paddingLeft = '12px';
      header.style.paddingRight = '12px';
    } else {
      // Normal positioning for non-standalone
      header.style.top = '0';
      header.style.padding = '8px 12px';
    }
    
    header.style.width = '100%';
    // Account for padding (12px left + 12px right = 24px) so inner content matches card width
    header.style.maxWidth = `${this.settings.cardMaxWidth + 24}px`;
    header.style.marginLeft = 'auto';
    header.style.marginRight = 'auto';
    // Height should be auto to accommodate safe area padding, or fixed if not standalone
    if (isStandalone && isIOS) {
      header.style.minHeight = '72px'; // Minimum height, can grow with safe area padding
      header.style.height = 'auto';
    } else {
      header.style.height = '72px';
    }
    header.style.zIndex = '1001'; // Higher than suggestions (1000) to stay in front
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'flex-start';
    header.style.transition = 'transform 0.24s var(--ease-spring, ease), opacity 0.24s var(--ease-spring, ease)';
    header.style.boxSizing = 'border-box';
    header.style.transform = 'translateY(0)';

    // Inner container - full width of header (already constrained)
    const headerInner = document.createElement('div');
    headerInner.style.display = 'grid';
    headerInner.style.gridTemplateColumns = 'auto 1fr auto'; // Logo, search, buttons
    headerInner.style.alignItems = 'center';
    headerInner.style.gap = '12px';
    headerInner.style.width = '100%';
    headerInner.style.height = '100%';
    headerInner.style.maxWidth = `${this.settings.cardMaxWidth}px`; // Match card width exactly
    headerInner.style.marginLeft = '0'; // Ensure no left margin
    headerInner.style.marginRight = '0'; // Ensure no right margin
    headerInner.style.boxSizing = 'border-box'; // Ensure consistent box model
    headerInner.style.flex = '1 1 auto'; // Ensure it fills available space in flex container

    // Logo container with transparent box
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
    
    // Hover effect on container
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
    
    const brand = document.createElement('div');
    brand.textContent = 'stashgifs';
    brand.style.fontWeight = '700';
    brand.style.letterSpacing = '0.5px';
    brand.style.color = '#F5C518';
    brand.style.fontSize = '17px';
    brand.style.lineHeight = '1.2';
    brand.style.userSelect = 'none';
    brand.style.transition = 'opacity 0.2s ease';
    
    brandContainer.appendChild(brand);
    
    // Click to refresh page and ensure it starts at top
    brandContainer.addEventListener('click', () => {
      // Set flag in sessionStorage to scroll to top on reload
      sessionStorage.setItem('stashgifs-scroll-to-top', 'true');
      // Scroll to top immediately (no smooth behavior)
      window.scrollTo(0, 0);
      // Also scroll any internal container
      if (this.scrollContainer) {
        this.scrollContainer.scrollTop = 0;
      }
      // Reload the page
      window.location.reload();
    });
    
    // ensure smoother animation
    header.style.willChange = 'transform, opacity';
    headerInner.appendChild(brandContainer);

    // Search area - constrained to grid column
    const searchArea = document.createElement('div');
    searchArea.style.position = 'relative';
    searchArea.style.width = '100%';
    searchArea.style.minWidth = '0'; // Allow grid to constrain width
    searchArea.style.maxWidth = '100%';
    searchArea.style.overflow = 'hidden'; // Prevent overflow beyond layout tracks
    searchArea.style.boxSizing = 'border-box'; // Ensure padding/border included in width
    searchArea.style.marginRight = '0'; // Ensure no right margin that could create gap
    headerInner.appendChild(searchArea);

    header.appendChild(headerInner);

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

    // Create a wrapper for the input
    const inputWrapper = document.createElement('div');
    inputWrapper.style.position = 'relative'; // Needed for absolute positioned placeholder
    inputWrapper.style.width = '100%';
    inputWrapper.style.minWidth = '0'; // Allow grid to constrain width
    inputWrapper.style.boxSizing = 'border-box';
    inputWrapper.style.marginRight = '0'; // Ensure no right margin that could create gap

    // Scrolling placeholder animation (like redgifs.com)
    // Only the dynamic part animates, "Search" stays constant
    const dynamicPlaceholders = [
      'performers',
      'tags',
      'filters',
      'favorites',
    ];
    
    // Create input element first
    const queryInput = document.createElement('input');
    queryInput.type = 'text';
    queryInput.placeholder = ''; // No native placeholder, we use custom
    queryInput.className = 'feed-filters__input';
    queryInput.style.transition = 'background 0.2s ease, border-color 0.2s ease';
    
    // Create a wrapper for the animated placeholder
    const placeholderWrapper = document.createElement('div');
    placeholderWrapper.id = 'feed-search-placeholder';
    placeholderWrapper.style.position = 'absolute';
    placeholderWrapper.style.left = '14px';
    placeholderWrapper.style.top = '50%';
    placeholderWrapper.style.transform = 'translateY(-50%)';
    placeholderWrapper.style.pointerEvents = 'none';
    placeholderWrapper.style.overflow = 'visible'; // Allow overflow for sliding animation
    placeholderWrapper.style.width = 'calc(100% - 28px)';
    placeholderWrapper.style.height = '20px';
    placeholderWrapper.style.color = 'rgba(255, 255, 255, 0.5)';
    placeholderWrapper.style.fontSize = '15px';
    placeholderWrapper.style.lineHeight = '20px';
    placeholderWrapper.style.whiteSpace = 'nowrap';
    
    // Static "Search " text
    const staticText = document.createElement('span');
    staticText.textContent = 'Search ';
    staticText.style.display = 'inline-block';
    staticText.style.marginRight = '4px'; // Add spacing between "Search" and dynamic text
    
    // Container for dynamic text with overflow hidden for sliding effect
    const dynamicContainer = document.createElement('span');
    dynamicContainer.style.display = 'inline-block';
    dynamicContainer.style.position = 'relative';
    dynamicContainer.style.overflow = 'hidden';
    dynamicContainer.style.verticalAlign = 'top';
    dynamicContainer.style.minWidth = '80px'; // Reserve space for longest word
    
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
      textEl.style.fontWeight = 'bold'; // Make dynamic text bold
      return textEl;
    };
    
    // Initialize with first placeholder
    if (dynamicPlaceholders[0]) {
      placeholderText = createPlaceholderText(dynamicPlaceholders[0]);
      dynamicContainer.appendChild(placeholderText);
    }
    
    // Assemble placeholder: "Search " + [dynamic part]
    placeholderWrapper.appendChild(staticText);
    placeholderWrapper.appendChild(dynamicContainer);
    
    // Hide native placeholder when we have custom animated one
    queryInput.style.color = 'transparent';
    queryInput.style.caretColor = '#FFFFFF'; // Show caret
    
    // Show custom placeholder only when input is empty and not focused
    const updatePlaceholderVisibility = () => {
      if (queryInput.value || document.activeElement === queryInput) {
        placeholderWrapper.style.display = 'none';
      } else {
        placeholderWrapper.style.display = 'block';
      }
    };
    
    const updatePlaceholder = () => {
      if (!placeholderText || !dynamicContainer) return;
      
      // Slide current text out to the left
      placeholderText.style.transform = 'translateX(-100%)';
      placeholderText.style.opacity = '0';
      
      setTimeout(() => {
        // Remove old text
        if (placeholderText && placeholderText.parentNode) {
          placeholderText.parentNode.removeChild(placeholderText);
        }
        
        // Move to next placeholder
        currentPlaceholderIndex = (currentPlaceholderIndex + 1) % dynamicPlaceholders.length;
        
        // Create new text sliding in from right
        const nextPlaceholder = dynamicPlaceholders[currentPlaceholderIndex];
        if (nextPlaceholder) {
          placeholderText = createPlaceholderText(nextPlaceholder, true);
          dynamicContainer.appendChild(placeholderText);
        }
        
        // Trigger reflow
        void dynamicContainer.offsetHeight;
        
        // Slide in
        setTimeout(() => {
          if (placeholderText) {
            placeholderText.style.transform = 'translateX(0)';
            placeholderText.style.opacity = '1';
          }
        }, 10);
      }, 250); // Half of transition duration
    };
    
    // Start animation when input is not focused and empty
    const startPlaceholderAnimation = () => {
      if (this.placeholderAnimationInterval) return;
      this.placeholderAnimationInterval = setInterval(() => {
        if (document.activeElement !== queryInput && !queryInput.value) {
          updatePlaceholder();
        }
      }, 3000); // Change every 3 seconds
    };
    
    const stopPlaceholderAnimation = () => {
      if (this.placeholderAnimationInterval) {
        clearInterval(this.placeholderAnimationInterval);
        this.placeholderAnimationInterval = undefined;
      }
    };
    
    // Start animation after a short delay
    setTimeout(() => {
      if (document.activeElement !== queryInput && !queryInput.value) {
        startPlaceholderAnimation();
      }
    }, 1000);
    
    // Add placeholder wrapper to input wrapper
    inputWrapper.appendChild(placeholderWrapper);

    // Random (shuffle) left helper to replace placeholder in random mode
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
    randomLeftIconSpan.innerHTML = '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" width=\"16\" height=\"16\"><path d=\"M16 3h5v5M21 3l-5 5\"/><path d=\"M4 20l5-5m0 0l5 5m-5-5h3\"/><path d=\"M4 4l7 7\"/></svg>';
    const randomLeftText = document.createElement('span');
    randomLeftText.textContent = 'Discovering randomly';
    randomLeftIcon.appendChild(randomLeftIconSpan);
    randomLeftIcon.appendChild(randomLeftText);
    inputWrapper.appendChild(randomLeftIcon);
    
    // Stop animation on focus, restart on blur if empty
    queryInput.addEventListener('focus', () => {
      stopPlaceholderAnimation();
      updatePlaceholderVisibility();
    });
    
    queryInput.addEventListener('blur', () => {
      updatePlaceholderVisibility();
      if (!queryInput.value) {
        setTimeout(() => startPlaceholderAnimation(), 500);
      }
    });
    
    // Stop animation when user types, restart when cleared
    queryInput.addEventListener('input', () => {
      updatePlaceholderVisibility();
      if (queryInput.value) {
        stopPlaceholderAnimation();
      } else {
        setTimeout(() => startPlaceholderAnimation(), 500);
      }
    });
    queryInput.style.width = '100%';
    queryInput.style.minWidth = '0';
    queryInput.style.height = '44px';
    // Normal padding now that buttons are outside
    queryInput.style.padding = '0 14px';
    queryInput.style.borderRadius = '10px';
    queryInput.style.border = '1px solid rgba(255,255,255,0.12)';
    queryInput.style.background = 'rgba(28, 28, 30, 0.9)';
    queryInput.style.color = 'inherit';
    queryInput.style.fontSize = '15px';
    queryInput.style.lineHeight = '1.4';
    queryInput.style.boxSizing = 'border-box';
    queryInput.style.transition = 'background 0.2s ease, border-color 0.2s ease';

    // Create loading spinner for search input
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
    inputWrapper.appendChild(loadingSpinner);

    // Shuffle indicator (shows when random mode is active)
    const shuffleIndicator = document.createElement('div');
    shuffleIndicator.className = 'feed-random-indicator';
    shuffleIndicator.style.position = 'absolute';
    shuffleIndicator.style.right = '40px'; // leave space for spinner
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
    // SVG shuffle icon
    const randomIconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    randomIconSvg.setAttribute('viewBox', '0 0 24 24');
    randomIconSvg.setAttribute('width', '14');
    randomIconSvg.setAttribute('height', '14');
    randomIconSvg.setAttribute('fill', 'currentColor');
    const p1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p1.setAttribute('d', 'M14.59 7.41L13.17 6 9 10.17 7.41 8.59 6 10l3 3 5.59-5.59z');
    const p2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p2.setAttribute('d', 'M14 6h5v5h-2V8h-3V6z');
    randomIconSvg.appendChild(p1);
    randomIconSvg.appendChild(p2);
    const shuffleText = document.createElement('span');
    shuffleText.textContent = 'Random';
    shuffleIndicator.appendChild(randomIconSvg);
    shuffleIndicator.appendChild(shuffleText);
    inputWrapper.appendChild(shuffleIndicator);

    // Buttons container (separate from search input, like logo)
    const buttonsContainer = document.createElement('div');
    buttonsContainer.style.display = 'inline-flex';
    buttonsContainer.style.alignItems = 'center';
    buttonsContainer.style.gap = '8px';
    buttonsContainer.style.height = '36px';

    // Declare shuffle button variable early so it can be referenced in setHDToggleVisualState
    let shuffleToggle: HTMLButtonElement | null = null;

    // HD toggle button (separate element like logo)
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
    hdToggle.textContent = 'HD';

    const setHDToggleVisualState = () => {
      if (this.useHDMode) {
        hdToggle.style.background = 'rgba(76, 175, 80, 0.25)'; // green-ish background
        hdToggle.style.borderColor = 'rgba(76, 175, 80, 0.55)';
        hdToggle.style.color = '#C8E6C9';
        // Show shuffle button when HD mode is enabled
        if (shuffleToggle) {
          shuffleToggle.style.display = 'inline-flex';
        }
      } else {
        hdToggle.style.background = 'rgba(28, 28, 30, 0.9)';
        hdToggle.style.borderColor = 'rgba(255,255,255,0.16)';
        hdToggle.style.color = 'rgba(255,255,255,0.85)';
        // Hide shuffle button when HD mode is disabled
        if (shuffleToggle) {
          shuffleToggle.style.display = 'none';
        }
      }
    };
    setHDToggleVisualState();

    hdToggle.addEventListener('mouseenter', () => {
      hdToggle.style.background = 'rgba(28, 28, 30, 0.95)';
      hdToggle.style.borderColor = 'rgba(255,255,255,0.16)';
      hdToggle.style.opacity = '0.9';
    });
    hdToggle.addEventListener('mouseleave', () => {
      setHDToggleVisualState();
      hdToggle.style.opacity = '1';
    });

    const onHDToggleClick = () => {
      // Flip mode
      const newHDMode = !this.useHDMode;
      
      // If turning off HD mode, reset shuffle mode to default (0 = off)
      if (!newHDMode && this.shuffleMode > 0) {
        this.shuffleMode = 0;
        try {
          localStorage.setItem('stashgifs-shuffleMode', '0');
        } catch (e) {
          console.error('Failed to save shuffle mode preference:', e);
        }
      }
      
      // Persist the new HD mode preference to localStorage
      // This will be read when the page reloads
      try {
        localStorage.setItem('stashgifs-useHDMode', newHDMode ? 'true' : 'false');
      } catch (e) {
        console.error('Failed to save HD mode preference:', e);
      }
      
      // Do a full page refresh to reload the entire site with the new HD setting
      // This ensures a clean state and proper initialization
      window.location.reload();
    };
    hdToggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onHDToggleClick();
    });

    // Volume toggle button (separate element like logo)
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
    
    // Muted icon (using same icon as video controls)
    const mutedIcon = '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" style="display: block;"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>';
    
    // Unmuted icon (using same icon as video controls)
    const unmutedIcon = '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" style="display: block;"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';

    const setVolToggleVisualState = () => {
      if (this.useVolumeMode) {
        volToggle.style.background = 'rgba(33, 150, 243, 0.25)'; // blue-ish
        volToggle.style.borderColor = 'rgba(33, 150, 243, 0.55)';
        volToggle.style.color = '#BBDEFB';
        volToggle.innerHTML = unmutedIcon;
      } else {
        volToggle.style.background = 'rgba(28, 28, 30, 0.9)';
        volToggle.style.borderColor = 'rgba(255,255,255,0.16)';
        volToggle.style.color = 'rgba(255,255,255,0.85)';
        volToggle.innerHTML = mutedIcon;
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
      // Apply to visibility manager
      this.visibilityManager.setExclusiveAudio(this.useVolumeMode);
      this.visibilityManager.reevaluateAudioFocus();
    };
    volToggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      void onVolToggleClick();
    });

    // Append input to wrapper
    inputWrapper.appendChild(queryInput);
    
    // Shuffle button (only visible in HD mode)
    shuffleToggle = document.createElement('button');
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
    
    // Icons for different states
    const shuffleIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" style="display: block;"><path d="M16 3h5v5M21 3l-5 5M8 21H3v-5M3 16l5-5"/><path d="M21 16v-5h-5M16 21l5-5"/></svg>';
    const noMarkersIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" style="display: block;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/><path d="M6 6l12 12" stroke-width="2.5"/></svg>';
    
    shuffleToggle.innerHTML = shuffleIcon;

    const setShuffleToggleVisualState = () => {
      if (this.shuffleMode === 0) {
        // Off state
        shuffleToggle.style.background = 'rgba(28, 28, 30, 0.9)';
        shuffleToggle.style.borderColor = 'rgba(255,255,255,0.12)';
        shuffleToggle.style.color = 'rgba(255,255,255,0.85)';
        shuffleToggle.innerHTML = shuffleIcon;
        shuffleToggle.title = 'Shuffle mode: Off';
      } else if (this.shuffleMode === 1) {
        // Shuffle all scenes (with and without markers) - Blue/cyan color
        shuffleToggle.style.background = 'rgba(33, 150, 243, 0.25)'; // Blue-500
        shuffleToggle.style.borderColor = 'rgba(33, 150, 243, 0.65)';
        shuffleToggle.style.color = '#64B5F6'; // Blue-300
        shuffleToggle.innerHTML = shuffleIcon;
        shuffleToggle.title = 'Shuffle mode: All scenes';
      } else {
        // Shuffle only scenes with no markers - Purple/magenta color
        shuffleToggle.style.background = 'rgba(156, 39, 176, 0.25)'; // Purple-500
        shuffleToggle.style.borderColor = 'rgba(156, 39, 176, 0.65)';
        shuffleToggle.style.color = '#BA68C8'; // Purple-300
        shuffleToggle.innerHTML = noMarkersIcon;
        shuffleToggle.title = 'Shuffle mode: Scenes with no markers';
      }
    };
    setShuffleToggleVisualState();

    shuffleToggle.addEventListener('mouseenter', () => {
      if (this.shuffleMode === 0) {
        shuffleToggle.style.background = 'rgba(28, 28, 30, 0.95)';
        shuffleToggle.style.borderColor = 'rgba(255,255,255,0.16)';
      } else if (this.shuffleMode === 1) {
        // Slightly brighter blue on hover
        shuffleToggle.style.background = 'rgba(33, 150, 243, 0.35)';
        shuffleToggle.style.borderColor = 'rgba(33, 150, 243, 0.75)';
      } else {
        // Slightly brighter purple on hover
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
      // Cycle through three states: 0 (off) -> 1 (markers only) -> 2 (all) -> 0
      this.shuffleMode = (this.shuffleMode + 1) % 3;
      
      // Save to localStorage
      try {
        localStorage.setItem('stashgifs-shuffleMode', String(this.shuffleMode));
      } catch (e) {
        console.error('Failed to save shuffle mode preference:', e);
      }
      
      setShuffleToggleVisualState();
      
      // If shuffle is enabled (mode 1 or 2), reload the feed
      if (this.shuffleMode > 0) {
        // Clear current posts
        this.clearPosts();
        
        // Clear posts container
        if (this.postsContainer) {
          this.postsContainer.innerHTML = '';
        }
        
        // Reset pagination
        this.currentPage = 1;
        this.hasMore = true;
        this.isLoading = false;
        
        // Reload videos with current filters
        await this.loadVideos(this.currentFilters, false, undefined, true);
      } else {
        // When turning off shuffle, reload to show normal markers
        this.clearPosts();
        if (this.postsContainer) {
          this.postsContainer.innerHTML = '';
        }
        this.currentPage = 1;
        this.hasMore = true;
        this.isLoading = false;
        await this.loadVideos(this.currentFilters, false, undefined, true);
      }
    };
    
    shuffleToggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      void onShuffleClick();
    });

    // Store reference to shuffle button for visibility updates
    // Note: This is stored as a private property, accessed via this.shuffleToggle
    this.shuffleToggle = shuffleToggle;
    
    // Update shuffle button visibility now that it's created
    setHDToggleVisualState();

    // Add buttons to buttons container (keep mute/volume only; move HD/Shuffle to search popup)
    buttonsContainer.appendChild(volToggle);
    
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
      (queryInput as HTMLInputElement).readOnly = disabled;
      queryInput.style.opacity = disabled ? '0.6' : '1';
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
    
    const fetchAndShowSuggestions = async (text: string, forceShow: boolean = false) => {
      // In random mode, disable suggestions entirely and show notice
      if (this.shuffleMode > 0) {
        suggestions.style.display = 'flex';
        this.lockBodyScroll();
        while (suggestions.firstChild) suggestions.removeChild(suggestions.firstChild);
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
        return;
      }
      const trimmedText = text.trim();
      const requestId = ++suggestionsRequestId;
      const showDefault = forceShow || trimmedText.length === 0 || trimmedText.length < 2;
      const isMobileViewport = window.innerWidth <= 768;
      const maxContentWidth = isMobileViewport ? '100%' : '640px';
      const horizontalPadding = isMobileViewport ? 16 : 24;
      const topPadding = 0;

      const ensureLatest = () => requestId === suggestionsRequestId;

      // Early bailout check: if another request started, abort immediately
      if (!ensureLatest()) {
        return;
      }

      const ensurePanelVisible = () => {
        // Always show the panel when fetching suggestions
        suggestions.style.display = 'flex';
        this.lockBodyScroll();
      };

      const createSectionLabel = (label: string, uppercase: boolean = false) => {
        const el = document.createElement('div');
        el.textContent = uppercase ? label.toUpperCase() : label;
        el.style.width = '100%';
        el.style.fontSize = uppercase ? '11px' : '15px';
        el.style.fontWeight = uppercase ? '600' : '500';
        el.style.letterSpacing = uppercase ? '0.5px' : 'normal';
        el.style.textTransform = uppercase ? 'uppercase' : 'none';
        el.style.color = uppercase ? 'rgba(255,255,255,0.6)' : '#FFFFFF';
        return el;
      };

      const createPillButton = (label: string, onSelect: () => void | Promise<void>) => {
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
      };

      const createListButton = (
        label: string,
        onSelect: () => void | Promise<void>,
        options: { subtitle?: string; leadingText?: string; leadingImage?: string } = {}
      ) => {
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
      };

      const appendEmptyState = (target: HTMLElement, message: string) => {
        const emptyState = document.createElement('div');
        emptyState.style.padding = '12px';
        emptyState.style.borderRadius = '10px';
        emptyState.style.background = 'rgba(255,255,255,0.04)';
        emptyState.style.color = 'rgba(255,255,255,0.7)';
        emptyState.style.fontSize = '14px';
        emptyState.style.textAlign = 'center';
        emptyState.textContent = message;
        target.appendChild(emptyState);
      };

      // Clear any existing containers BEFORE showing panel to prevent flash of old content
      // Hide panel first, clear while hidden, then show with new content
      // Check again after clearing to ensure we're still the latest request
      suggestions.style.display = 'none';
      while (suggestions.firstChild) {
        suggestions.removeChild(suggestions.firstChild);
      }
      
      // Critical check: if another request started during clearing, abort now
      if (!ensureLatest()) {
        return;
      }
      
      // Now show the panel after clearing is complete
      ensurePanelVisible();
      
      // Final check before proceeding with DOM manipulation
      if (!ensureLatest()) {
        return;
      }

      const container = document.createElement('div');
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.gap = '24px';
      container.style.width = '100%';
      container.style.maxWidth = maxContentWidth;
      container.style.margin = '0 auto';
      container.style.boxSizing = 'border-box';
      container.style.paddingTop = `${topPadding}px`;
      container.style.paddingLeft = `${horizontalPadding}px`;
      container.style.paddingRight = `${horizontalPadding}px`;
      container.style.paddingBottom = isMobileViewport ? '32px' : '48px';
      container.style.minHeight = '100%';

      suggestions.appendChild(container);
      suggestions.scrollTop = 0;

      if (showDefault) {
        // Clear container efficiently
        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }

        // Playback & Shuffle options (moved from header into popup)
        const playbackSection = document.createElement('div');
        playbackSection.style.display = 'flex';
        playbackSection.style.flexDirection = 'row';
        playbackSection.style.alignItems = 'center';
        playbackSection.style.gap = '8px';

        // HD toggle button
        const hdBtn = document.createElement('button');
        hdBtn.type = 'button';
        hdBtn.textContent = this.useHDMode ? 'HD Video: On' : 'HD Video: Off';
        hdBtn.style.padding = '10px 12px';
        hdBtn.style.borderRadius = '10px';
        hdBtn.style.border = '1px solid rgba(255,255,255,0.12)';
        hdBtn.style.background = this.useHDMode ? 'rgba(76, 175, 80, 0.25)' : 'rgba(28, 28, 30, 0.95)';
        hdBtn.style.color = this.useHDMode ? '#C8E6C9' : 'rgba(255,255,255,0.85)';
        hdBtn.style.cursor = 'pointer';
        hdBtn.addEventListener('click', () => {
          // Toggle HD mode with existing logic
          onHDToggleClick();
          // Reflect state
          hdBtn.textContent = this.useHDMode ? 'HD Video: On' : 'HD Video: Off';
          hdBtn.style.background = this.useHDMode ? 'rgba(76, 175, 80, 0.25)' : 'rgba(28, 28, 30, 0.95)';
          hdBtn.style.color = this.useHDMode ? '#C8E6C9' : 'rgba(255,255,255,0.85)';
          // Update random toggle visibility based on HD (only in HD)
          randomBtn.style.display = this.useHDMode ? 'inline-flex' : 'none';
        });
        // Random positions toggle (appears only when HD is ON)
        const randomBtn = document.createElement('button');
        randomBtn.type = 'button';
        const setRandomBtnState = () => {
          const isOn = this.shuffleMode > 0;
          randomBtn.textContent = isOn ? 'Random Positions: On' : 'Random Positions: Off';
          randomBtn.style.background = isOn ? 'rgba(33, 150, 243, 0.25)' : 'rgba(28, 28, 30, 0.95)';
          randomBtn.style.color = isOn ? '#BBDEFB' : 'rgba(255,255,255,0.85)';
        };
        randomBtn.style.padding = '10px 12px';
        randomBtn.style.borderRadius = '10px';
        randomBtn.style.border = '1px solid rgba(255,255,255,0.12)';
        randomBtn.style.cursor = 'pointer';
        setRandomBtnState();
        randomBtn.style.display = this.useHDMode ? 'inline-flex' : 'none';
        randomBtn.addEventListener('click', async () => {
          // Toggle shuffleMode between 0 (off) and 1 (on) for random positions
          this.shuffleMode = this.shuffleMode > 0 ? 0 : 1;
          try { localStorage.setItem('stashgifs-shuffleMode', String(this.shuffleMode)); } catch {}
          setRandomBtnState();
          updateSearchBarDisplay();
          // Apply changes
          this.clearPosts();
          if (this.postsContainer) this.postsContainer.innerHTML = '';
          this.currentPage = 1;
          this.hasMore = true;
          this.isLoading = false;
          await this.loadVideos(this.currentFilters, false, undefined, true);
        });

        playbackSection.appendChild(hdBtn);
        playbackSection.appendChild(randomBtn);
        container.appendChild(playbackSection);

        // Show saved filters from cache immediately (no loading needed)
        await this.loadSavedFiltersIfNeeded();
        if (!ensureLatest()) {
          return;
        }

        const filtersSection = document.createElement('div');
        filtersSection.style.display = 'flex';
        filtersSection.style.flexDirection = 'column';
        filtersSection.style.gap = '12px';
        filtersSection.appendChild(createSectionLabel('Saved Filters', true));

        const pillRow = document.createElement('div');
        pillRow.style.display = 'flex';
        pillRow.style.flexWrap = 'wrap';
        pillRow.style.gap = '8px';

        pillRow.appendChild(createPillButton('Favorites', async () => {
            if (this.shuffleMode > 0) return;
            this.selectedSavedFilter = undefined;
            this.selectedPerformerId = undefined;
            this.selectedPerformerName = undefined;
            try {
              const favoriteTag = await this.api.findTagByName('StashGifs Favorite');
              if (favoriteTag) {
                this.selectedTagId = parseInt(favoriteTag.id, 10);
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

        // Show saved filters from cache
        this.savedFiltersCache.forEach((filter) => {
          pillRow.appendChild(createPillButton(filter.name, () => {
            if (this.shuffleMode > 0) return;
            this.selectedSavedFilter = { id: filter.id, name: filter.name };
                this.selectedTagId = undefined;
                this.selectedTagName = undefined;
                this.selectedPerformerId = undefined;
                this.selectedPerformerName = undefined;
                this.closeSuggestions();
                updateSearchBarDisplay();
            this.currentFilters = { savedFilterId: filter.id, limit: this.initialLoadLimit, offset: 0 };
                this.loadVideos(this.currentFilters, false).catch((e) => console.error('Apply saved filter failed', e));
          }));
        });

        filtersSection.appendChild(pillRow);
        container.appendChild(filtersSection);

        // Prepare loading animation section (only show if fetch takes > 200ms)
        let loadingSection: HTMLElement | null = null;
        let loadingTimeout: ReturnType<typeof setTimeout> | null = null;
        let loadingSectionCreated = false;
        
        const showLoadingSkeletons = () => {
          if (loadingSectionCreated) return; // Already shown
          loadingSectionCreated = true;
          
          loadingSection = document.createElement('div');
          loadingSection.style.display = 'flex';
          loadingSection.style.flexDirection = 'column';
          loadingSection.style.gap = '8px';
          loadingSection.appendChild(createSectionLabel('Suggested Tags'));
          
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
            leadingSkeleton.setAttribute('data-suggestion-skeleton', 'true');
            leadingSkeleton.style.width = '36px';
            leadingSkeleton.style.height = '36px';
            leadingSkeleton.style.borderRadius = '50%';
            leadingSkeleton.style.flexShrink = '0';
            
            // Text skeleton
            const textSkeleton = document.createElement('div');
            textSkeleton.className = 'chip-skeleton';
            textSkeleton.setAttribute('data-suggestion-skeleton', 'true');
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
          
          container.appendChild(loadingSection);
        };
        
        // Ensure panel is visible with saved filters
        ensurePanelVisible();

        // Start timeout to show loading skeletons after 200ms
        loadingTimeout = setTimeout(() => {
          if (!ensureLatest()) return;
          showLoadingSkeletons();
        }, 200);

        // Fetch fresh tags and performers (always fetch, no cache for empty terms)
        let freshTags: Array<{ id: string; name: string }> = [];
        let freshPerformers: Array<{ id: string; name: string; image_path?: string }> = [];
        
        try {
          [freshTags, freshPerformers] = await Promise.all([
            this.api.searchMarkerTags('', 3),
            this.api.searchPerformers('', 3)
          ]);
          if (!ensureLatest()) {
            return;
          }
          // Update cache for preload feature, but use fresh data for display
          this.preloadedTags = freshTags;
          this.preloadedPerformers = freshPerformers;
        } catch (error) {
          console.warn('Failed to fetch suggestions', error);
          if (!ensureLatest()) {
            return;
          }
        }

        // Clear timeout if fetch completed quickly
        if (loadingTimeout) {
          clearTimeout(loadingTimeout);
          loadingTimeout = null;
        }

        // Remove loading section if it was shown
        if (loadingSectionCreated && loadingSection) {
          const section: HTMLElement = loadingSection;
          const parent = section.parentNode;
          if (parent) {
            parent.removeChild(section);
          }
        }

        // Use freshly fetched tags instead of cached data
        const availableTags = freshTags
              .filter((tag) => {
                const tagId = parseInt(tag.id, 10);
            return !Number.isNaN(tagId) && this.selectedTagId !== tagId;
              })
              .slice(0, 3);
            
        if (availableTags.length > 0) {
          const tagsSection = document.createElement('div');
          tagsSection.style.display = 'flex';
          tagsSection.style.flexDirection = 'column';
          tagsSection.style.gap = '8px';
          tagsSection.appendChild(createSectionLabel('Suggested Tags'));
          availableTags.forEach((tag) => {
            tagsSection.appendChild(
              createListButton(tag.name, () => {
                if (this.shuffleMode > 0) return;
                this.selectedSavedFilter = undefined;
                this.selectedPerformerId = undefined;
                this.selectedPerformerName = undefined;
                this.selectedTagId = parseInt(tag.id, 10);
                this.selectedTagName = tag.name;
                this.closeSuggestions();
                updateSearchBarDisplay();
                apply();
              }, { leadingText: '#' })
            );
          });
          container.appendChild(tagsSection);
        }

        // Use freshly fetched performers instead of cached data
        const availablePerformers = freshPerformers
          .filter((performer) => {
            const performerId = parseInt(performer.id, 10);
            return !Number.isNaN(performerId) && this.selectedPerformerId !== performerId;
          })
          .slice(0, 3);

        if (availablePerformers.length > 0) {
          const performersSection = document.createElement('div');
          performersSection.style.display = 'flex';
          performersSection.style.flexDirection = 'column';
          performersSection.style.gap = '8px';
          performersSection.appendChild(createSectionLabel('Suggested Performers'));
          availablePerformers.forEach((performer) => {
                const performerId = parseInt(performer.id, 10);
            const imageSrc = performer.image_path
              ? (performer.image_path.startsWith('http') ? performer.image_path : `${window.location.origin}${performer.image_path}`)
              : undefined;
            performersSection.appendChild(
              createListButton(
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
          });
          container.appendChild(performersSection);
        }

        if (container.children.length === 0) {
          appendEmptyState(container, 'No suggestions available yet.');
        }

        suggestions.scrollTop = 0;
        return;
      }
      
      container.innerHTML = '';

      // If random mode is on, short-circuit and show notice
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
      // Load saved filters if needed
      await this.loadSavedFiltersIfNeeded();
      const matchingSavedFilters = this.savedFiltersCache
        .filter((filter) => filter.name.toLowerCase().includes(trimmedText.toLowerCase()))
        .slice(0, 6);

      if (matchingSavedFilters.length > 0 && this.shuffleMode === 0) {
        const savedSection = document.createElement('div');
        savedSection.style.display = 'flex';
        savedSection.style.flexDirection = 'column';
        savedSection.style.gap = '8px';
        savedSection.appendChild(createSectionLabel('Matching Saved Filters'));
        matchingSavedFilters.forEach((filter) => {
          savedSection.appendChild(
            createListButton(filter.name, () => {
              this.selectedSavedFilter = { id: filter.id, name: filter.name };
          this.selectedTagId = undefined;
          this.selectedTagName = undefined;
              this.selectedPerformerId = undefined;
              this.selectedPerformerName = undefined;
          this.closeSuggestions();
          updateSearchBarDisplay();
              this.currentFilters = { savedFilterId: filter.id, limit: this.initialLoadLimit, offset: 0 };
              this.loadVideos(this.currentFilters, false).catch((e) => console.error('Apply saved filter failed', e));
            })
          );
        });
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

      if (!ensureLatest()) {
        return;
      }

      const filteredTags = tagItems
        .filter((tag) => {
          const tagId = parseInt(tag.id, 10);
          return !Number.isNaN(tagId) && this.selectedTagId !== tagId;
        })
        .slice(0, 20);

      if (filteredTags.length > 0) {
        const tagsSection = document.createElement('div');
        tagsSection.style.display = 'flex';
        tagsSection.style.flexDirection = 'column';
        tagsSection.style.gap = '8px';
        tagsSection.appendChild(createSectionLabel('Tags'));
        filteredTags.forEach((tag) => {
          tagsSection.appendChild(
            createListButton(tag.name, () => {
          this.selectedSavedFilter = undefined;
          this.selectedPerformerId = undefined;
          this.selectedPerformerName = undefined;
              this.selectedTagId = parseInt(tag.id, 10);
          this.selectedTagName = tag.name;
          this.closeSuggestions();
          updateSearchBarDisplay();
          apply();
            }, { leadingText: '#' })
          );
        });
        container.appendChild(tagsSection);
      }

      const filteredPerformers = performerItems
        .filter((performer) => {
          const performerId = parseInt(performer.id, 10);
          return !Number.isNaN(performerId) && this.selectedPerformerId !== performerId;
        })
        .slice(0, 20);

      if (filteredPerformers.length > 0) {
        const performersSection = document.createElement('div');
        performersSection.style.display = 'flex';
        performersSection.style.flexDirection = 'column';
        performersSection.style.gap = '8px';
        performersSection.appendChild(createSectionLabel('Performers'));
        filteredPerformers.forEach((performer) => {
          const performerId = parseInt(performer.id, 10);
          const imageSrc = performer.image_path
            ? (performer.image_path.startsWith('http') ? performer.image_path : `${window.location.origin}${performer.image_path}`)
            : undefined;
          performersSection.appendChild(
            createListButton(
              performer.name,
              () => {
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
        });
        container.appendChild(performersSection);
      }

      // Append Playback & Shuffle options for non-empty searches as well
      const playbackSection2 = document.createElement('div');
      playbackSection2.style.display = 'flex';
      playbackSection2.style.flexDirection = 'row';
      playbackSection2.style.alignItems = 'center';
      playbackSection2.style.gap = '8px';
      const hdBtn2 = document.createElement('button');
      hdBtn2.type = 'button';
      hdBtn2.textContent = this.useHDMode ? 'HD Video: On' : 'HD Video: Off';
      hdBtn2.style.padding = '10px 12px';
      hdBtn2.style.borderRadius = '10px';
      hdBtn2.style.border = '1px solid rgba(255,255,255,0.12)';
      hdBtn2.style.background = this.useHDMode ? 'rgba(76, 175, 80, 0.25)' : 'rgba(28, 28, 30, 0.95)';
      hdBtn2.style.color = this.useHDMode ? '#C8E6C9' : 'rgba(255,255,255,0.85)';
      hdBtn2.style.cursor = 'pointer';
      hdBtn2.addEventListener('click', () => {
        onHDToggleClick();
        hdBtn2.textContent = this.useHDMode ? 'HD Video: On' : 'HD Video: Off';
        hdBtn2.style.background = this.useHDMode ? 'rgba(76, 175, 80, 0.25)' : 'rgba(28, 28, 30, 0.95)';
        hdBtn2.style.color = this.useHDMode ? '#C8E6C9' : 'rgba(255,255,255,0.85)';
        randomBtn2.style.display = this.useHDMode ? 'inline-flex' : 'none';
      });
      // Random positions toggle (inline)
      const randomBtn2 = document.createElement('button');
      randomBtn2.type = 'button';
      const setRandom2 = () => {
        const isOn = this.shuffleMode > 0;
        randomBtn2.textContent = isOn ? 'Random Positions: On' : 'Random Positions: Off';
        randomBtn2.style.background = isOn ? 'rgba(33, 150, 243, 0.25)' : 'rgba(28, 28, 30, 0.95)';
        randomBtn2.style.color = isOn ? '#BBDEFB' : 'rgba(255,255,255,0.85)';
      };
      randomBtn2.style.padding = '10px 12px';
      randomBtn2.style.borderRadius = '10px';
      randomBtn2.style.border = '1px solid rgba(255,255,255,0.12)';
      randomBtn2.style.cursor = 'pointer';
      setRandom2();
      randomBtn2.style.display = this.useHDMode ? 'inline-flex' : 'none';
      randomBtn2.addEventListener('click', async () => {
        this.shuffleMode = this.shuffleMode > 0 ? 0 : 1;
        try { localStorage.setItem('stashgifs-shuffleMode', String(this.shuffleMode)); } catch {}
        setRandom2();
        updateSearchBarDisplay();
        this.clearPosts();
        if (this.postsContainer) this.postsContainer.innerHTML = '';
        this.currentPage = 1;
        this.hasMore = true;
        this.isLoading = false;
        await this.loadVideos(this.currentFilters, false, undefined, true);
      });

      playbackSection2.appendChild(hdBtn2);
      playbackSection2.appendChild(randomBtn2);
      container.appendChild(playbackSection2);

      if (container.children.length === 0) {
        appendEmptyState(container, `No matches found for "${trimmedText}".`);
      }

      suggestions.scrollTop = 0;
      return;
    };
    
    queryInput.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') apply(); });
    
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

    const handleFocus = () => {
      // If click handler already processed this, skip to prevent duplicate calls
      if (clickHandled) {
        clickHandled = false; // Reset for next interaction
        return;
      }
      if (focusHandled) return;
      focusHandled = true;
      
      // If random mode is active, disable it when engaging search
      void disableRandomIfActive();
      
      // Ensure background suggestions stay fresh
      this.preloadSuggestions().catch((e) => console.warn('Suggestion preload refresh failed', e));
      
      queryInput.style.background = 'rgba(28, 28, 30, 0.95)';
      queryInput.style.borderColor = 'rgba(255,255,255,0.16)';
      // Clear and reset when focusing on search bar for fresh search
      this.selectedTagId = undefined;
      this.selectedTagName = undefined;
      this.selectedPerformerId = undefined;
      this.selectedPerformerName = undefined;
      this.selectedSavedFilter = undefined;
      queryInput.value = '';
      
      fetchAndShowSuggestions('', true);
      
      // Reset flag after a short delay
      setTimeout(() => { focusHandled = false; }, 100);
    };
    
    // Detect mobile device
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    
    if (isMobile) {
      // Mobile: use touchend for immediate focus response
      queryInput.addEventListener('touchend', (e) => {
        e.stopPropagation();
        // Ensure focus without scrolling jump
        try {
          queryInput.focus({ preventScroll: true } as FocusOptions);
        } catch {
          queryInput.focus();
        }
        // Disable random mode on interaction
        void disableRandomIfActive();
        handleFocus();
      }, { passive: false });
      
      // Click handler as fallback (shouldn't fire if touchend worked, but keep for compatibility)
      queryInput.addEventListener('click', (e) => {
        e.stopPropagation();
        // Focus might already be handled by touchend, but ensure it's focused
        if (document.activeElement !== queryInput) {
          try {
            queryInput.focus({ preventScroll: true } as FocusOptions);
          } catch {
            queryInput.focus();
          }
        }
        if (!focusHandled) {
          clickHandled = true; // Mark that click handled it to prevent focus handler from duplicating
          // Clear and reset when clicking on search bar for fresh search (same as focus handler)
          // Disable random mode on interaction
          void disableRandomIfActive();
          this.selectedTagId = undefined;
          this.selectedTagName = undefined;
          this.selectedPerformerId = undefined;
          this.selectedPerformerName = undefined;
          this.selectedSavedFilter = undefined;
          queryInput.value = '';
          fetchAndShowSuggestions('', true);
        }
      });
    } else {
      // Desktop: use click and focus handlers
      queryInput.addEventListener('click', (e) => {
        e.stopPropagation();
        // Mark that click is handling this to prevent focus handler from duplicating
        // Set this synchronously IMMEDIATELY to prevent race condition
        clickHandled = true;
        // Ensure focus without scrolling jump
        try {
          queryInput.focus({ preventScroll: true } as FocusOptions);
        } catch {
          queryInput.focus();
        }
        // Disable random mode on interaction
        void disableRandomIfActive();
        // Clear and reset when clicking on search bar for fresh search (same as focus handler)
        this.selectedTagId = undefined;
        this.selectedTagName = undefined;
        this.selectedPerformerId = undefined;
        this.selectedPerformerName = undefined;
        this.selectedSavedFilter = undefined;
        queryInput.value = '';
        fetchAndShowSuggestions('', true);
        // Reset flag after a delay to allow focus handler to work on next interaction
        setTimeout(() => { clickHandled = false; }, 100);
      });
    }
    
    queryInput.addEventListener('focus', handleFocus);
    
    queryInput.addEventListener('blur', () => {
      queryInput.style.background = 'rgba(28, 28, 30, 0.9)';
      queryInput.style.borderColor = 'rgba(255,255,255,0.12)';
    });
    
    // Debounced unified apply on typing when selection was cleared and term is substantive
    const debouncedUnifiedApply = debounce(() => {
      // Don't block UI; use new abort controller to align with apply()
      void apply();
    }, 300);

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
      debouncedFetchSuggestions(text, false);
      // Auto-apply if user is entering a new free-text search
      if (text.trim().length >= 2) {
        debouncedUnifiedApply();
      }
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
      clickHandlerTimeout = window.setTimeout(() => {
        // Check if suggestions are visible
        const isSuggestionsVisible = suggestions.style.display !== 'none';
        
        // Don't close if clicking inside searchArea or suggestions overlay
        const clickedInsideSearch = searchArea.contains(e.target as Node);
        const clickedInsideSuggestions = suggestions.contains(e.target as Node);
        
        if (isSuggestionsVisible && !clickedInsideSearch && !clickedInsideSuggestions) {
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * Apply current search across UIs using unified logic
   * Resolves selectedTagName to tag IDs, tries performer by name, or falls back to plain text.
   */
  private async applyCurrentSearch(loadSignal?: AbortSignal): Promise<void> {
    // Determine current text input if available (used only when no explicit selection)
    let q: string | undefined = undefined;
    const activeEl = document.activeElement as HTMLElement | null;
    if (activeEl && activeEl.classList && activeEl.classList.contains('feed-filters__input')) {
      const input = activeEl as HTMLInputElement;
      q = input.value?.trim() || undefined;
    }

    // In random mode we ignore search/tag resolution and just (re)load with random settings
    if (this.shuffleMode > 0) {
      const newFilters: FilterOptions = {
        limit: this.initialLoadLimit,
        offset: 0,
        shuffleMode: true,
        includeScenesWithoutMarkers: this.shuffleMode === 2,
      };
      this.currentFilters = newFilters;
      await this.loadVideos(newFilters, false, loadSignal, true);
      return;
    }

    // Build filters similar to header bar robust logic
    let queryValue: string | undefined = undefined;
    let primaryTags: string[] | undefined = undefined;
    let performers: string[] | undefined = undefined;

    const useExactMatch = this.selectedTagName?.toLowerCase() === 'cowgirl';

    if (this.selectedTagName) {
      if (useExactMatch && this.selectedTagId) {
        primaryTags = [String(this.selectedTagId)];
      } else {
        try {
          const matchingTags = await this.api.searchMarkerTags(this.selectedTagName, 50, loadSignal);
          if (loadSignal?.aborted) return;
          const matchingTagIds = (matchingTags || [])
            .map(tag => parseInt(tag.id, 10))
            .filter(id => !Number.isNaN(id))
            .map(id => String(id));
          if (matchingTagIds.length > 0) {
            primaryTags = matchingTagIds;
          } else if (this.selectedTagId) {
            primaryTags = [String(this.selectedTagId)];
          }
        } catch {
          if (this.selectedTagId) {
            primaryTags = [String(this.selectedTagId)];
          }
        }
      }
    } else if (this.selectedPerformerId) {
      performers = [String(this.selectedPerformerId)];
    } else if (q && !this.selectedSavedFilter) {
      try {
        const matchingTags = await this.api.searchMarkerTags(q, 50, loadSignal);
        if ((loadSignal as any)?.aborted) return;
        const matchingTagIds = (matchingTags || [])
          .map(tag => parseInt(tag.id, 10))
          .filter(id => !Number.isNaN(id))
          .map(id => String(id));
        if (matchingTagIds.length > 0) {
          primaryTags = matchingTagIds;
          this.selectedTagName = q;
          this.selectedTagId = undefined;
        } else {
          const matchingPerformers = await this.api.searchPerformers(q, 10, loadSignal);
          if (loadSignal?.aborted) return;
          if (matchingPerformers && matchingPerformers.length > 0 && matchingPerformers[0]) {
            performers = [String(matchingPerformers[0].id)];
            this.selectedPerformerName = matchingPerformers[0].name;
            this.selectedPerformerId = parseInt(String(matchingPerformers[0].id), 10);
          } else {
            queryValue = q;
          }
        }
      } catch {
        queryValue = q;
      }
    }

    const newFilters: FilterOptions = {
      query: queryValue,
      primary_tags: primaryTags,
      performers: performers,
      savedFilterId: this.selectedSavedFilter?.id || undefined,
      limit: this.initialLoadLimit,
      offset: 0,
    };
    this.currentFilters = newFilters;
    await this.loadVideos(newFilters, false, loadSignal);
  }

  /**
   * Apply current filters and update UI
   */
  private async applyFilters(): Promise<void> {
    // Find the search input and update its display
    const queryInput = this.container.querySelector('.feed-filters__input') as HTMLInputElement;
    if (queryInput) {
      if (this.selectedTagName) {
        queryInput.value = this.selectedTagName;
      } else if (this.selectedPerformerName) {
        queryInput.value = this.selectedPerformerName;
      } else if (this.selectedSavedFilter) {
        queryInput.value = this.selectedSavedFilter.name;
      } else {
        queryInput.value = '';
      }
      // Hide animated helper/placeholder immediately (without triggering suggestions)
      const ph = document.getElementById('feed-search-placeholder') as HTMLElement | null;
      if (ph) {
        ph.style.display = 'none';
      }
    }

    // Apply the filters using the same logic as in createHeaderBar
    // Check performer first to ensure it takes priority
    let queryValue: string | undefined = undefined;
    let primaryTags: string[] | undefined = undefined;
    let performers: string[] | undefined = undefined;
    
    if (this.selectedPerformerId) {
      // Use performer ID for filtering
      performers = [String(this.selectedPerformerId)];
    } else if (this.selectedTagId || this.selectedTagName) {
      // Use tag filtering
      const useExactMatch = this.selectedTagName?.toLowerCase() === 'cowgirl';
      
      if (useExactMatch && this.selectedTagId) {
        // Use exact tag ID matching for "cowgirl" to exclude "reverse cowgirl"
        primaryTags = [String(this.selectedTagId)];
      } else if (this.selectedTagName) {
        // For fuzzy matching: search for tags matching the name, then use their IDs
        // This allows "finger" to match "fingers", "finger - pov", etc.
        try {
          const matchingTags = await this.api.searchMarkerTags(this.selectedTagName, 50);
          const matchingTagIds = matchingTags
            .map(tag => parseInt(tag.id, 10))
            .filter(id => !Number.isNaN(id))
            .map(id => String(id));
          
          if (matchingTagIds.length > 0) {
            primaryTags = matchingTagIds;
          } else {
            // Fallback: use the selected tag ID if no matches found
            if (this.selectedTagId) {
              primaryTags = [String(this.selectedTagId)];
            }
          }
        } catch (error) {
          console.error('Failed to search for matching tags', error);
          // Fallback: use the selected tag ID
          if (this.selectedTagId) {
            primaryTags = [String(this.selectedTagId)];
          }
        }
      } else if (this.selectedTagId) {
        // Fallback: just use the tag ID if we have it
        primaryTags = [String(this.selectedTagId)];
      }
    }
    
    const newFilters: FilterOptions = {
      query: queryValue,
      primary_tags: primaryTags,
      performers: performers,
      savedFilterId: this.selectedSavedFilter?.id || undefined,
      limit: this.initialLoadLimit,
      offset: 0,
    };
    this.currentFilters = newFilters;
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
    const getScrollbarWidth = (): number => Math.max(0, window.innerWidth - document.documentElement.clientWidth);

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
    // Use createElement instead of innerHTML for better performance
    const clearSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    clearSvg.setAttribute('viewBox', '0 0 24 24');
    clearSvg.setAttribute('width', '16');
    clearSvg.setAttribute('height', '16');
    clearSvg.setAttribute('fill', 'currentColor');
    clearSvg.setAttribute('aria-hidden', 'true');
    const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path1.setAttribute('d', 'M18 6L6 18M6 6l12 12');
    clearSvg.appendChild(path1);
    clearBtn.appendChild(clearSvg);

    const apply = () => {
      // Clear suggestions when applying a search
      while (suggestions.firstChild) {
        suggestions.removeChild(suggestions.firstChild);
      }
      suggestions.style.display = 'none';
      this.applyCurrentSearch().catch((e: any) => {
        if (e?.name !== 'AbortError') console.error('Apply filters failed', e);
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
              this.selectedTagId = parseInt(favoriteTag.id, 10);
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
    queryInput.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') apply(); });

    // Debounced suggestions with proper debouncing
    let suggestPage = 1;
    let suggestTerm = '';
    let suggestHasMore = false;
    
    // Debounced suggestion fetcher (150ms delay)
    const debouncedFetchSuggestions2 = debounce((text: string, page: number, forceShow: boolean) => {
      fetchSuggestions(text, page, forceShow);
    }, 150);
    // Debounced unified apply for filter sheet typing
    const debouncedUnifiedApply2 = debounce(() => {
      apply();
    }, 300);
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

    // Auto-apply on typing when entering a substantive term
    queryInput.addEventListener('input', () => {
      const val = queryInput.value.trim();
      if (val.length >= 2) {
        debouncedUnifiedApply2();
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
        suggestions.removeChild(suggestions.firstChild);
      }
      // Show suggestions if we have text (2+ chars) OR if forced (on focus)
      if (!trimmedText || trimmedText.length < 2) {
        if (forceShow) {
          // On focus with empty text, show saved filters from cache immediately, then fetch fresh tags/performers
          // (Suggestions already cleared at function start)
          
          // Show saved filters from cache immediately (no loading needed)
          await this.loadSavedFiltersIfNeeded();
          if (signal.aborted) return;
          
          if (this.savedFiltersCache.length > 0) {
            // Saved filters label
            const label = document.createElement('div');
            label.textContent = 'Saved Filters';
            label.style.opacity = '0.75';
            label.style.fontSize = '12px';
            label.style.width = '100%';
            label.style.marginBottom = '6px';
            suggestions.appendChild(label);
            
            this.savedFiltersCache.forEach((f) => {
              const chip = document.createElement('button');
              chip.textContent = f.name;
              chip.className = 'suggest-chip';
              chip.style.padding = '6px 10px';
              chip.style.borderRadius = '999px';
              chip.style.border = '1px solid rgba(255,255,255,0.12)';
              chip.style.color = 'inherit';
              chip.style.fontSize = '13px';
              chip.style.cursor = 'pointer';
              chip.addEventListener('click', () => {
                savedSelect.value = f.id;
                this.selectedSavedFilter = { id: f.id, name: f.name };
                // Clear tag selections when applying a saved filter
                this.selectedTagId = undefined;
                this.selectedTagName = undefined;
                queryInput.value = '';
                this.closeSuggestions();
                updateSearchBarDisplay();
                apply();
              });
              suggestions.appendChild(chip);
            });
            
            // Add divider before tags/performers
            const divider = document.createElement('div');
            divider.style.width = '100%';
            divider.style.height = '1px';
            divider.style.background = 'rgba(255,255,255,0.08)';
            divider.style.margin = '6px 0';
            suggestions.appendChild(divider);
          }
          
          // Prepare loading animation (only show if fetch takes > 200ms)
          let loadingContainer: HTMLElement | null = null;
          let loadingTimeout: ReturnType<typeof setTimeout> | null = null;
          let loadingContainerCreated = false;
          
          const showLoadingSkeletons = () => {
            if (loadingContainerCreated) return; // Already shown
            loadingContainerCreated = true;
            
            // Create 6 skeleton chip placeholders that match the chip style
            for (let i = 0; i < 6; i++) {
              const skeletonChip = document.createElement('div');
              skeletonChip.className = 'chip-skeleton';
              skeletonChip.setAttribute('data-suggestion-skeleton', 'true');
              skeletonChip.style.display = 'inline-block';
              skeletonChip.style.padding = '6px 10px';
              skeletonChip.style.borderRadius = '999px';
              skeletonChip.style.height = '28px';
              skeletonChip.style.marginRight = '8px';
              skeletonChip.style.marginBottom = '8px';
              // Vary width for more natural look
              const widths = [70, 85, 65, 90, 75, 80];
              skeletonChip.style.width = `${widths[i % widths.length]}px`;
              
              suggestions.appendChild(skeletonChip);
            }
          };
          
          suggestions.style.display = 'flex';
          
          // Start timeout to show loading skeletons after 200ms
          loadingTimeout = setTimeout(() => {
            if (signal.aborted) return;
            showLoadingSkeletons();
          }, 200);
          
          // Fetch fresh tags and performers (always fetch, no cache for empty terms)
          const [tags, performers] = await Promise.all([
            this.api.searchMarkerTags('', 3, signal),
            this.api.searchPerformers('', 3, signal)
          ]);
          if (signal.aborted) return;
          
          // Clear timeout if fetch completed quickly
          if (loadingTimeout) {
            clearTimeout(loadingTimeout);
            loadingTimeout = null;
          }
          
          // Remove loading skeletons if they were shown
          if (loadingContainerCreated) {
            // Remove all skeleton chips we created (identified by data attribute)
            const skeletonChips = Array.from(suggestions.querySelectorAll('[data-suggestion-skeleton="true"]'));
            skeletonChips.forEach((chip) => {
              const parent = chip.parentNode;
              if (parent) {
                parent.removeChild(chip);
              }
            });
          }
          
          // Display tags
          tags.forEach((tag) => {
            if (this.selectedTagId === parseInt(tag.id, 10)) return;
            const chip = document.createElement('button');
            chip.textContent = tag.name;
            chip.className = 'suggest-chip';
            chip.style.padding = '6px 10px';
            chip.style.borderRadius = '999px';
            chip.style.border = '1px solid rgba(255,255,255,0.12)';
            chip.style.color = 'inherit';
            chip.style.fontSize = '13px';
            chip.style.cursor = 'pointer';
            chip.addEventListener('click', () => {
              this.selectedSavedFilter = undefined;
              savedSelect.value = '';
              const tagId = parseInt(tag.id, 10);
              this.selectedTagId = tagId;
              this.selectedTagName = tag.name;
              updateSearchBarDisplay();
              apply();
              fetchSuggestions('', 1, true);
            });
            suggestions.appendChild(chip);
          });
          
          // Display performers if any
          if (performers.length > 0) {
            if (tags.length) {
              const divider = document.createElement('div');
              divider.style.width = '100%';
              divider.style.height = '1px';
              divider.style.background = 'rgba(255,255,255,0.08)';
              divider.style.margin = '6px 0';
              suggestions.appendChild(divider);
            }
            performers.forEach((performer) => {
              if (this.selectedPerformerId === parseInt(performer.id, 10)) return;
              const chip = document.createElement('button');
              chip.textContent = performer.name;
              chip.className = 'suggest-chip';
              chip.style.padding = '6px 10px';
              chip.style.borderRadius = '999px';
              chip.style.border = '1px solid rgba(255,255,255,0.12)';
              chip.style.color = 'inherit';
              chip.style.fontSize = '13px';
              chip.style.cursor = 'pointer';
              chip.addEventListener('click', () => {
                this.selectedSavedFilter = undefined;
                savedSelect.value = '';
                const performerId = parseInt(performer.id, 10);
                this.selectedPerformerId = performerId;
                this.selectedPerformerName = performer.name;
                updateSearchBarDisplay();
                apply();
                fetchSuggestions('', 1, true);
              });
              suggestions.appendChild(chip);
            });
          }
          
          suggestions.style.display = suggestions.children.length > 0 ? 'flex' : 'none';
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

      // Render as chips
      items.forEach((tag) => {
        if (this.selectedTagId === parseInt(tag.id, 10)) return;
        // Skip StashGifs Favorite and StashGifs Marker tags (internal plugin tags)
        if (tag.name === 'StashGifs Favorite' || tag.name === 'StashGifs Marker') return;
        const chip = document.createElement('button');
        chip.textContent = tag.name;
        chip.className = 'suggest-chip';
        chip.style.padding = '6px 10px';
        chip.style.borderRadius = '999px';
        chip.style.border = '1px solid rgba(255,255,255,0.12)';
        chip.style.background = 'rgba(255,255,255,0.05)';
        chip.style.color = 'inherit';
        chip.style.fontSize = '13px';
        chip.style.cursor = 'pointer';
        chip.addEventListener('mouseenter', () => { chip.style.background = 'rgba(255,255,255,0.1)'; });
        chip.addEventListener('mouseleave', () => { chip.style.background = 'rgba(255,255,255,0.05)'; });
        chip.addEventListener('click', () => {
          // Selecting a tag clears any saved filter to avoid conflicts
          this.selectedSavedFilter = undefined;
          savedSelect.value = '';
          const tagId = parseInt(tag.id, 10);
          this.selectedTagId = tagId;
          this.selectedTagName = tag.name;
          updateSearchBarDisplay();
          apply();
          // Refresh suggestions to remove the newly selected tag and keep menu open
          fetchSuggestions(trimmedText, 1, false);
        });
        suggestions.appendChild(chip);
      });

      // Simple heuristic for more results (if we filled the page)
      suggestHasMore = items.length >= pageSize;

      // Also surface matching saved filters as chips (unified UX)
      const term = trimmedText.toLowerCase();
      // Load saved filters if needed
      await this.loadSavedFiltersIfNeeded();
      if (signal.aborted) return;
      const matchingSaved = this.savedFiltersCache.filter((f) => f.name.toLowerCase().includes(term));
      if (matchingSaved.length) {
        const label = document.createElement('div');
        label.textContent = 'Saved Filters';
        label.style.opacity = '0.75';
        label.style.fontSize = '12px';
        label.style.width = '100%';
        label.style.marginTop = '6px';
        suggestions.appendChild(label);
        matchingSaved.forEach((f) => {
          const chip = document.createElement('button');
          chip.textContent = f.name;
          chip.className = 'suggest-chip';
          chip.style.padding = '6px 10px';
          chip.style.borderRadius = '999px';
          chip.style.border = '1px solid rgba(255,255,255,0.12)';
          chip.style.background = 'rgba(255,255,255,0.05)';
          chip.style.color = 'inherit';
          chip.style.fontSize = '13px';
          chip.style.cursor = 'pointer';
          chip.addEventListener('mouseenter', () => { chip.style.background = 'rgba(255,255,255,0.1)'; });
          chip.addEventListener('mouseleave', () => { chip.style.background = 'rgba(255,255,255,0.05)'; });
          chip.addEventListener('click', () => {
            savedSelect.value = f.id;
            this.selectedSavedFilter = { id: f.id, name: f.name };
            // Clear tag selections when applying a saved filter
            this.selectedTagId = undefined;
            this.selectedTagName = undefined;
            queryInput.value = '';
            this.closeSuggestions();
            updateSearchBarDisplay();
            apply();
          });
          suggestions.appendChild(chip);
        });
      }

      // Add/load more button
      const existingMore = suggestions.querySelector('[data-more="1"]') as HTMLElement | null;
      if (existingMore) existingMore.remove();
      if (suggestHasMore) {
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
          suggestPage += 1;
          // Fetch next page and append
          // Use the same signal for consistency
          const next = await this.api.searchMarkerTags(trimmedText, pageSize, signal);
          if (signal.aborted) return;
          next.forEach((tag) => {
            if (this.selectedTagId === parseInt(tag.id, 10)) return;
            const chip = document.createElement('button');
            chip.textContent = tag.name;
            chip.className = 'suggest-chip';
            chip.style.padding = '6px 10px';
            chip.style.borderRadius = '999px';
            chip.style.border = '1px solid rgba(255,255,255,0.12)';
            chip.style.color = 'inherit';
            chip.style.fontSize = '13px';
            chip.style.cursor = 'pointer';
            chip.addEventListener('click', () => {
              this.selectedSavedFilter = undefined;
              savedSelect.value = '';
              const tagId = parseInt(tag.id, 10);
              this.selectedTagId = tagId;
              this.selectedTagName = tag.name;
              updateSearchBarDisplay();
              apply();
              // Refresh suggestions to remove the newly selected tag
              fetchSuggestions(trimmedText, 1, false);
            });
            suggestions.appendChild(chip);
          });
          // If fewer than page size returned, hide more
          if (next.length < pageSize) {
            more.remove();
          }
        });
        suggestions.appendChild(more);
      }

      suggestions.style.display = (items.length || (matchingSaved && matchingSaved.length)) ? 'flex' : 'none';
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
      this.loadVideos({}, false).catch((e) => console.error('Clear filters failed', e));
    });

    bar.appendChild(savedSelect);
    bar.appendChild(searchWrapper);
    searchWrapper.appendChild(clearBtn);

    // Insert backdrop and panel into root container (not scrollable)
    this.container.appendChild(backdrop);
    this.container.appendChild(bar);

    // Responsive layout helpers
    const isMobile = () => window.matchMedia('(max-width: 700px)').matches;
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
      (clearBtn as HTMLButtonElement).style.display = isMobile() ? 'none' : 'inline-flex';
      (savedSelect as HTMLSelectElement).style.display = isMobile() ? 'none' : 'block';
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
      (queryInput as HTMLInputElement).focus();
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
    window.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape') closePanel();
    });
    window.addEventListener('resize', () => {
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
    if (typeof window !== 'undefined') {
      const suggestionDelay = this.isMobileDevice ? 10000 : 5000;
      window.setTimeout(() => {
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
   * Load scene markers from Stash
   */
  async loadVideos(filters?: FilterOptions, append: boolean = false, signal?: AbortSignal, force: boolean = false): Promise<void> {
    // Always cancel previous loadVideos queries (including append operations) to prevent overload
    if (this.activeLoadVideosAbortController) {
      this.activeLoadVideosAbortController.abort();
      // Clean up all active load observers from previous operation
      this.cleanupLoadObservers();
      // Stop any video elements that are loading
      this.stopLoadingVideos();
    }
    // Create new AbortController if no signal provided
    if (!signal) {
      this.activeLoadVideosAbortController = new AbortController();
      signal = this.activeLoadVideosAbortController.signal;
    }
    
    // Skip loading check if force is true (used for HD toggle reloads)
    if (!force && this.isLoading) {
      return;
    }

    this.isLoading = true;
    if (!append) {
      // Show skeleton loaders immediately for better perceived performance
      this.showSkeletonLoaders();
      this.currentPage = 1;
      this.hasMore = true;
    }

    try {
      const currentFilters = filters || this.currentFilters || {};
      const page = append ? this.currentPage + 1 : 1;
      
      
      // Load fewer items on initial load for faster page load, more on subsequent loads
      const limit = append ? this.subsequentLoadLimit : (currentFilters.limit || this.initialLoadLimit);
      
      // Calculate offset: page 1 = 0, page 2 = initialLoadLimit, page 3+ = initialLoadLimit + (page-2) * subsequentLoadLimit
      let offset = 0;
      if (append && page > 1) {
        offset = this.initialLoadLimit + (page - 2) * this.subsequentLoadLimit;
      }
      
      // Check if aborted before fetching
      if (signal?.aborted) {
        this.isLoading = false;
        this.hideSkeletonLoaders();
        return;
      }
      
      const markers = await this.api.fetchSceneMarkers({
        ...currentFilters,
        limit,
        offset,
        shuffleMode: this.shuffleMode > 0,
        includeScenesWithoutMarkers: this.shuffleMode === 2, // Mode 2: only scenes with no markers
      }, signal);
      
      // Check if aborted after fetching
      if (signal?.aborted) {
        this.isLoading = false;
        this.hideSkeletonLoaders();
        return;
      }
      
      // Markers are fetched with random sorting from GraphQL API

      
      if (!append) {
        this.markers = markers;
        this.clearPosts();
      } else {
        this.markers.push(...markers);
      }

      if (markers.length === 0) {
        if (!append) {
          this.showError('No scene markers found. Try adjusting your filters.');
        }
        this.hasMore = false;
        this.hideSkeletonLoaders();
        return;
      }

      // Check if we got fewer results than requested (means no more pages)
      const expectedLimit = append ? this.subsequentLoadLimit : (currentFilters.limit || this.initialLoadLimit);
      if (markers.length < expectedLimit) {
        this.hasMore = false;
      }

      // Prefetch poster screenshots for the first batch before rendering, non-blocking
      try {
        // Prefetch a reasonable number; align with initial load size on first page, smaller when appending
        const prefetchCount = append ? this.subsequentLoadLimit : (currentFilters.limit || this.initialLoadLimit);
        posterPreloader.prefetchForMarkers(markers, prefetchCount);
      } catch (e) {
        // Non-fatal
        console.warn('Poster prefetch failed', e);
      }

      // Create posts progressively - render immediately as each post is ready
      // This provides instant visual feedback instead of waiting for all posts
      // Use DocumentFragment for batch DOM insertions to reduce layout thrashing
      const renderChunkSize = 6; // Render 6 posts at a time (increased from 3 for better performance)
      const renderDelay = 8; // Reduced delay for faster rendering (8ms instead of 16ms)
      
      let fragment: DocumentFragment | null = null;
      let fragmentPostCount = 0;
      
      for (let i = 0; i < markers.length; i++) {
        if (signal?.aborted) {
          this.isLoading = false;
          this.hideSkeletonLoaders();
          return;
        }
        
        // Create post (returns container element)
        // Pass abort signal to allow cleanup if aborted during creation
        const marker = markers[i];
        if (!marker) continue;
        const postContainer = await this.createPost(marker, signal);
        
        // Remove one skeleton loader as each real post is added
        if (!append && i < this.getSkeletonCount()) {
          this.removeSkeletonLoader();
        }
        
        // Add to fragment for batch insertion
        if (!fragment) {
          fragment = document.createDocumentFragment();
        }
        if (postContainer) {
          fragment.appendChild(postContainer);
          fragmentPostCount++;
        }
        
        // Insert fragment when chunk is complete or at end
        const shouldInsert = (i + 1) % renderChunkSize === 0 || i === markers.length - 1;
        if (shouldInsert && fragment && fragmentPostCount > 0) {
          // If loadMoreTrigger exists, insert before it to keep trigger at the end
          if (this.loadMoreTrigger && this.loadMoreTrigger.parentNode === this.postsContainer) {
            this.postsContainer.insertBefore(fragment, this.loadMoreTrigger);
          } else {
            this.postsContainer.appendChild(fragment);
          }
          fragment = null;
          fragmentPostCount = 0;
          
          // Small delay between chunks to prevent blocking the main thread
          if (i < markers.length - 1) {
            await new Promise(resolve => setTimeout(resolve, renderDelay));
          }
        }
      }
      
      // Check if aborted after creating posts
      if (signal?.aborted) {
        this.isLoading = false;
        this.hideSkeletonLoaders();
        return;
      }

      if (append) {
        this.currentPage = page;
      }

      // Initial autoplay disabled - using hover-based autoplay instead
      // Videos will play when user hovers over them
      // if (!append && page === 1) {
      //   window.setTimeout(() => {
      //     this.autoplayInitial(2).catch((e) => console.warn('Autoplay initial failed', e));
      //   }, 500);
      // }
      // Suggestion preloading is handled in init() with longer delay
      // Background preloading disabled - videos load on-demand when close to viewport (50px) or on click

      // Hide skeleton loaders after all posts are rendered
      if (!append) {
        this.hideSkeletonLoaders();
      }
      
      // Update infinite scroll trigger position - must be done BEFORE isLoading is set to false
      // This ensures the trigger is moved to the new bottom before the observer can fire again
      this.updateInfiniteScrollTrigger();
    } catch (error: any) {
      console.error('Error loading scene markers:', error);
      if (!append) {
        this.showError(`Failed to load scene markers: ${error.message || 'Unknown error'}`);
      }
      this.hideSkeletonLoaders();
    } finally {
      // Defer setting isLoading to false to ensure trigger has moved and observer won't fire immediately
      // This prevents the "machine-gun" effect where multiple loads fire in rapid succession
      // Use double requestAnimationFrame to ensure DOM update is complete
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.isLoading = false;
        });
      });
    }
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
    for (const [postId, observer] of this.loadObservers.entries()) {
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
    for (const [postId, post] of this.posts.entries()) {
      const player = post.getPlayer();
      if (player) {
        const videoElement = player.getVideoElement();
        // If video is loading (networkState is LOADING or networkState is 2), stop it
        if (videoElement.networkState === 2 || videoElement.readyState < 2) {
          try {
            videoElement.pause();
            videoElement.src = '';
            videoElement.load(); // This cancels the network request
          } catch (e) {
            // Ignore errors when stopping video
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
    // Choose video source based on HD toggle
    const selectedUrl = this.useHDMode
      ? this.api.getVideoUrl(marker.scene)
      : this.api.getMarkerVideoUrl(marker);
    const videoUrl = selectedUrl;
    const safeVideoUrl = isValidMediaUrl(videoUrl) ? videoUrl : undefined;
    
    // Skip creating post if no valid video URL is available
    if (!safeVideoUrl) {
      console.warn('FeedContainer: Skipping post creation - no valid video URL', {
        markerId: marker.id,
        markerTitle: marker.title,
        videoUrl,
      });
      return null;
    }
    
    // Check if browser supports the video codec/format
    // Skip unsupported codecs (HEVC, Matroska, etc.) to avoid showing broken content
    if (!this.isVideoCodecSupported(marker, safeVideoUrl)) {
      // Silently skip - don't log to avoid console spam
      return null;
    }

    const postContainer = document.createElement('article');
    postContainer.className = 'video-post-wrapper';

    // When shuffle mode is enabled and we're in HD mode (loading full scene videos),
    // randomize the start time instead of using the marker's specific timestamp
    // For non-HD marker videos, don't set startTime - marker clips are pre-rendered and should start at beginning
    let startTime: number | undefined = undefined;
    if (this.useHDMode) {
      // Only set startTime for HD mode (full scene videos)
      if (this.shuffleMode > 0) {
        // Randomize start time when shuffle mode is enabled
        // Try to get video duration from scene files to calculate random start time
        const sceneDuration = marker.scene?.files?.[0]?.duration;
        if (sceneDuration && sceneDuration > 0) {
          // Randomize start time within the video (leave some buffer at the end)
          // Use 90% of duration to avoid starting too close to the end
          const maxStartTime = Math.floor(sceneDuration * 0.9);
          
          // Simple random start without checking proximity to existing markers
          startTime = Math.floor(Math.random() * maxStartTime);
        } else {
          // If duration not available, start at beginning (0) instead of using marker.seconds
          // This prevents the conflict where both marker timestamp and random timestamp are used
          startTime = 0;
        }
      } else {
        // HD mode but not shuffle - use marker's timestamp
        startTime = marker.seconds;
      }
    }
    // For non-HD mode, startTime remains undefined - marker videos are pre-rendered clips

    const postData: VideoPostData = {
      marker,
      videoUrl: safeVideoUrl, // Use safeVideoUrl instead of potentially invalid videoUrl
      startTime: startTime,
      endTime: marker.end_seconds,
    };

    const post = new VideoPost(
      postContainer, 
      postData, 
      this.favoritesManager, 
      this.api, 
      this.visibilityManager,
      (performerId, performerName) => this.handlePerformerChipClick(performerId, performerName),
      (tagId, tagName) => this.handleTagChipClick(tagId, tagName),
      this.shuffleMode > 0,
      () => this.cancelAllPendingRequests() // Callback to cancel requests during marker creation
    );
    this.posts.set(marker.id, post);
    this.postOrder.push(marker.id);

    // If HD mode is enabled at feed level, reflect this on the card's HD icon
    if (this.useHDMode) {
      post.setHQMode(true);
    }

    // Don't append to DOM here - return container for batch insertion
    // Caller will handle DOM insertion using DocumentFragment

    // Observe for visibility
    this.visibilityManager.observePost(postContainer, marker.id);


    // Check if aborted before setting up observers
    if (signal?.aborted) {
      return null;
    }

    // Load video only when very close to viewport (lazy loading)
    // Use device capabilities to determine optimal loading distance
    if (safeVideoUrl) {
      // Adaptive lazy loading based on device capabilities
      // Low-end devices: load closer (25px), high-end: load earlier (100px)
      const lazyLoadDistance = this.deviceCapabilities.availableRAM < 2048 ? '25px' : 
                              this.deviceCapabilities.isHighEnd ? '100px' : '50px';
      
      if (this.isMobileDevice) {
        // On mobile: only load when very close - conserve bandwidth and memory
        const rootMargin = lazyLoadDistance;
        const loadObserver = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) {
                // Check if aborted before loading
                if (signal?.aborted) {
                  loadObserver.disconnect();
                  this.loadObservers.delete(marker.id);
                  return;
                }
                const player = post.preload();
                if (player) {
                  this.visibilityManager.registerPlayer(marker.id, player);
                }
                loadObserver.disconnect();
                this.loadObservers.delete(marker.id);
              }
            }
          },
          { rootMargin, threshold: 0 }
        );
        // Track observer for cleanup
        this.loadObservers.set(marker.id, loadObserver);
        loadObserver.observe(postContainer);
        return postContainer;
      }

      // Desktop: load based on device capabilities and HD mode
      // High-end devices can load earlier, low-end should wait
      const rootMargin = this.useHDMode 
        ? lazyLoadDistance // HD mode: load closer to conserve bandwidth
        : (this.deviceCapabilities.isHighEnd ? '200px' : '100px'); // Non-HD: load earlier on high-end devices
      
      // Use Intersection Observer to load video when very close to viewport
      const loadObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              // Check if aborted before loading
              if (signal?.aborted) {
                loadObserver.disconnect();
                this.loadObservers.delete(marker.id);
                return;
              }
              // Load the player
              const player = post.preload();
              if (player) {
                // Register player immediately - VisibilityManager will wait for ready state
                this.visibilityManager.registerPlayer(marker.id, player);
                // Don't play here - let VisibilityManager handle it based on visibility
              } else {
                console.warn('FeedContainer: Player not created', { markerId: marker.id });
              }
              loadObserver.disconnect();
              this.loadObservers.delete(marker.id);
            }
          }
        },
        { rootMargin, threshold: 0 } // Load when very close to viewport
      );
      // Track observer for cleanup
      this.loadObservers.set(marker.id, loadObserver);
      loadObserver.observe(postContainer);
    } else {
      console.warn('FeedContainer: No video URL for marker', { markerId: marker.id });
    }
    // Eager preload disabled - videos load on-demand via Intersection Observer
    
    // Return container for batch DOM insertion
    return postContainer;
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
        entries.forEach((entry) => {
          if (entry.isIntersecting && !this.isLoading && this.hasMore) {
            this.loadVideos(undefined, true).catch((error) => {
              console.error('Error loading more markers:', error);
            });
          }
        });
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
      if (player) {
        // Register with visibility manager
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
      tryPlay().catch(() => {});
    }
  }

  private shouldEnableVisibilityDebug(): boolean {
    try {
      if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
        return window.localStorage.getItem('stashgifs-visibility-debug') === '1';
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

    if (typeof window === 'undefined') {
      execute();
      return;
    }

    this.eagerPreloadScheduled = true;
    this.eagerPreloadHandle = window.setTimeout(execute, 32);
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

      if (player) {
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

    if (typeof window !== 'undefined') {
      window.clearTimeout(this.eagerPreloadHandle);
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
    const viewportHeight = window.innerHeight;
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
    const threshold = this.settings.backgroundPreloadScrollVelocityThreshold ?? 2.0;
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
      if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
        window.setTimeout(cb, delay);
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
      window.setTimeout(() => {
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
      if (player) {
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
      window.setTimeout(() => {
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
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
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
      this.backgroundPreloadHandle = window.setTimeout(() => {
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
      if (player) {
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
    this.backgroundPreloadHandle = window.setTimeout(() => {
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
    this.backgroundPreloadHandle = window.setTimeout(() => {
      this.preloadNextVideo();
    }, delay);
  }

  /**
   * Stop background preloading
   */
  private stopBackgroundPreloading(): void {
    this.backgroundPreloadActive = false;
    if (this.backgroundPreloadHandle) {
      window.clearTimeout(this.backgroundPreloadHandle);
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
    if (this.posts.size > maxPostsInMemory * 1.5) {
      const viewportTop = window.scrollY || window.pageYOffset;
      const viewportBottom = viewportTop + window.innerHeight;
      
      // Calculate distance for each post
      const postsWithDistance: Array<{ postId: string; distance: number; isVisible: boolean }> = [];
      
      for (const [postId, post] of this.posts.entries()) {
        const container = post.getContainer();
        const rect = container.getBoundingClientRect();
        const elementTop = viewportTop + rect.top;
        const elementBottom = elementTop + rect.height;
        
        // Check if visible in viewport
        const isVisible = elementBottom > viewportTop && elementTop < viewportBottom;
        
        // Calculate distance from viewport
        let distance = 0;
        if (elementBottom < viewportTop) {
          distance = viewportTop - elementBottom;
        } else if (elementTop > viewportBottom) {
          distance = elementTop - viewportBottom;
        }
        
        postsWithDistance.push({ postId, distance, isVisible });
      }
      
      // Sort by distance (furthest first), but prioritize non-visible posts
      postsWithDistance.sort((a, b) => {
        if (a.isVisible !== b.isVisible) {
          return a.isVisible ? 1 : -1; // Non-visible first
        }
        return b.distance - a.distance; // Furthest first
      });
      
      // Remove posts until we're under the limit
      // But keep a good buffer to ensure loadMoreTrigger stays accessible
      const minPostsToKeep = Math.max(5, maxPostsInMemory - 3); // Keep a larger buffer
      const postsToRemove = postsWithDistance.slice(0, Math.max(0, this.posts.size - minPostsToKeep));
      
      // Also remove posts that are very far from viewport (even if under limit)
      // Less aggressive: only remove posts that are very far away
      // 1000px in HD mode, 1500px in normal mode (much less aggressive)
      const cleanupDistance = this.useHDMode ? 1000 : 1500;
      for (const { postId, distance, isVisible } of postsWithDistance) {
        if (!isVisible && distance > cleanupDistance && !postsToRemove.find(p => p.postId === postId)) {
          // Only add if we won't remove too many posts
          if (this.posts.size - postsToRemove.length > minPostsToKeep) {
            postsToRemove.push({ postId, distance, isVisible });
          }
        }
      }
      
      // Remove posts
      for (const { postId } of postsToRemove) {
        // Cancel any pending preloads for this post
        this.cancelPreloadIfOutOfView(postId);
        
        const post = this.posts.get(postId);
        if (post) {
          // Aggressively unload video before destroying to free memory
          const player = post.getPlayer();
          if (player) {
            // Force unload even if already marked as unloaded
            if (!player.getIsUnloaded()) {
              player.unload();
            }
            // Destroy player completely to free all resources
            player.destroy();
          }
          
          // Remove from visibility manager before destroying
          this.visibilityManager.unobservePost(postId);
          
          // Destroy post (removes from DOM)
          post.destroy();
          this.posts.delete(postId);
          const index = this.postOrder.indexOf(postId);
          if (index !== -1) {
            this.postOrder.splice(index, 1);
          }
        }
        
        // Clean up load observer if exists
        const observer = this.loadObservers.get(postId);
        if (observer) {
          observer.disconnect();
          this.loadObservers.delete(postId);
        }
      }
      
      
      // Remove markers for deleted posts to free memory
      // This prevents the markers array from growing unbounded
      const removedPostIds = new Set(postsToRemove.map(p => p.postId));
      this.markers = this.markers.filter(marker => {
        // Keep marker if its post still exists
        return !removedPostIds.has(marker.id);
      });
      
      // Force garbage collection hint by clearing any cached references
      if (postsToRemove.length > 0) {
        // Request browser to consider garbage collection after cleanup
        setTimeout(() => {
          // Small delay to let cleanup complete
        }, 0);
      }
    }
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
      if (player) {
        // Register player with VisibilityManager - it will handle playing when ready
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
    // Extremely aggressive: unload videos that are more than 100px from viewport
    // In HD mode, be even more aggressive: 50px
    const unloadDistance = this.useHDMode ? 50 : 100;
    
    // Also limit concurrent loaded videos to prevent memory buildup
    const maxLoadedVideos = this.useHDMode ? 2 : 3;
    let loadedVideoCount = 0;
    
    // First pass: count loaded videos in viewport
    for (const [postId, post] of this.posts.entries()) {
      const container = post.getContainer();
      const rect = container.getBoundingClientRect();
      const elementTop = viewportTop + rect.top;
      const elementBottom = elementTop + rect.height;
      
      // Check if post is in or near viewport
      const isNearViewport = elementBottom > viewportTop - 200 && elementTop < viewportBottom + 200;
      
      if (isNearViewport) {
        const player = post.getPlayer();
        if (player && !player.getIsUnloaded()) {
          loadedVideoCount++;
        }
      }
    }
    
    // Second pass: unload videos that are far from viewport
    for (const [postId, post] of this.posts.entries()) {
      const container = post.getContainer();
      const rect = container.getBoundingClientRect();
      const elementTop = viewportTop + rect.top;
      const elementBottom = elementTop + rect.height;
      
      // Check if post is outside viewport by more than unloadDistance
      const isFarAbove = elementBottom < viewportTop - unloadDistance;
      const isFarBelow = elementTop > viewportBottom + unloadDistance;
      
      if (isFarAbove || isFarBelow) {
        const player = post.getPlayer();
        if (player && !player.getIsUnloaded()) {
          // Aggressively unload video to free RAM
          player.unload();
        }
      } else if (loadedVideoCount > maxLoadedVideos) {
        // If we have too many loaded videos, unload ones that are not immediately visible
        const isImmediatelyVisible = elementBottom > viewportTop && elementTop < viewportBottom;
        if (!isImmediatelyVisible) {
          const player = post.getPlayer();
          if (player && !player.getIsUnloaded()) {
            player.unload();
            loadedVideoCount--;
          }
        }
      }
    }
  }

  /**
   * Setup scroll handler
   * Handles header hide/show based on scroll direction and tracks scroll velocity
   */
  private setupScrollHandler(): void {
    let lastScrollY = window.scrollY;
    let isHeaderHidden = false;

    // Initialize scroll tracking
    this.lastScrollTop = window.scrollY || document.documentElement.scrollTop;
    this.lastScrollTime = Date.now();

    const handleScroll = () => {
      // Update scroll velocity for background preloading
      const now = Date.now();
      const currentScrollY = window.scrollY || document.documentElement.scrollTop;
      const timeDelta = now - this.lastScrollTime;
      
      if (timeDelta > 0) {
        const scrollDelta = Math.abs(currentScrollY - this.lastScrollTop);
        this.scrollVelocity = scrollDelta / timeDelta; // pixels per ms
      }
      
      this.lastScrollTop = currentScrollY;
      this.lastScrollTime = now;
      
      // Only unload videos during scrolling (don't remove posts from DOM - too jarring)
      // Periodically unload videos that are not visible to free RAM
      // Less frequent to avoid performance impact (every 500ms)
      const unloadInterval = 500;
      if (timeDelta > unloadInterval) {
        // Only unload videos, don't remove posts from DOM
        this.aggressiveVideoUnload();
      }
      
      // Stop background preloading when scrolling fast to prevent memory buildup
      // Fast scroll threshold: 3 pixels/ms (very fast scrolling)
      const fastScrollThreshold = 3.0;
      if (this.scrollVelocity > fastScrollThreshold) {
        if (this.backgroundPreloadActive) {
          this.stopBackgroundPreloading();
        }
      }
      
      // Cancel preloads for posts that have gone out of view
      if (this.activePreloadPosts.size > 0) {
        for (const postId of Array.from(this.activePreloadPosts)) {
          this.cancelPreloadIfOutOfView(postId);
        }
      }

      // Don't hide/show header if suggestions overlay is open
      const suggestions = document.querySelector('.feed-filters__suggestions') as HTMLElement;
      if (suggestions && suggestions.style.display !== 'none' && suggestions.style.display !== '') {
        return;
      }

      const scrollDelta = currentScrollY - lastScrollY;

      // Only hide/show header if scroll delta is significant enough
      if (Math.abs(scrollDelta) > 5) {
        if (scrollDelta > 0 && !isHeaderHidden && currentScrollY > 100) {
          // Scrolling down - hide header
          // Move up by full header height to completely hide it
          if (this.headerBar) {
            // Get the actual rendered height including all padding and safe area
            const headerHeight = this.headerBar.getBoundingClientRect().height;
            // Calculate the total distance needed: full height + extra buffer
            // Use a larger buffer (30px) to absolutely guarantee it's completely hidden
            const hideDistance = headerHeight + 30;
            this.headerBar.style.transform = `translateY(-${hideDistance}px)`;
            isHeaderHidden = true;
          }
        } else if (scrollDelta < 0 && isHeaderHidden) {
          // Scrolling up - show header
          if (this.headerBar) {
            this.headerBar.style.transform = 'translateY(0)';
            isHeaderHidden = false;
          }
        }
      }

      lastScrollY = currentScrollY;
    };

    // Use passive listener for better performance
    window.addEventListener('scroll', handleScroll, { passive: true });

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
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
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
    const existingSkeletons = Array.from(this.postsContainer.querySelectorAll('.video-post-skeleton')) as HTMLElement[];
    
    if (existingSkeletons.length > 0) {
      // Reuse existing skeletons from HTML
      this.skeletonLoaders = existingSkeletons;
      
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
          if (skeleton.parentNode) {
            skeleton.parentNode.removeChild(skeleton);
          }
        }
        this.skeletonLoaders = existingSkeletons.slice(0, skeletonCount);
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
      if (skeleton.parentNode) {
        skeleton.parentNode.removeChild(skeleton);
      }
    }
    this.skeletonLoaders = [];
  }

  /**
   * Remove a single skeleton loader (when real post is added)
   */
  private removeSkeletonLoader(): void {
    if (this.skeletonLoaders.length > 0) {
      const skeleton = this.skeletonLoaders.shift();
      if (skeleton && skeleton.parentNode) {
        skeleton.parentNode.removeChild(skeleton);
      }
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
      this.visibilityManager.observePost(post.getContainer(), post.getPostId());
      const player = post.getPlayer();
      if (player) {
        this.visibilityManager.registerPlayer(post.getPostId(), player);
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
    if ((this as any)._mobileLoadTimeout) {
      clearTimeout((this as any)._mobileLoadTimeout);
      (this as any)._mobileLoadTimeout = null;
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

