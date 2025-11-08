/**
 * Feed Container
 * Main application container managing the feed
 */

import { SceneMarker, FilterOptions, FeedSettings, VideoPostData } from './types.js';
import { StashAPI } from './StashAPI.js';
import { VideoPost } from './VideoPost.js';
import { VisibilityManager } from './VisibilityManager.js';
import { FavoritesManager } from './FavoritesManager.js';
import { throttle, isValidMediaUrl } from './utils.js';

const DEFAULT_SETTINGS: FeedSettings = {
  autoPlay: true, // Enable autoplay for markers
  autoPlayThreshold: 0.2, // Lower threshold - start playing when 20% visible instead of 50%
  maxConcurrentVideos: 3,
  unloadDistance: 1000,
  cardMaxWidth: 800,
  aspectRatio: 'preserve',
  showControls: 'hover',
  enableFullscreen: true,
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
  private isLoading: boolean = false;
  private currentFilters?: FilterOptions;
  private selectedTagId?: number;
  private selectedTagName?: string;
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
  private readonly eagerPreloadCount: number = 6;
  private readonly maxSimultaneousPreloads: number = 2;

  constructor(container: HTMLElement, api?: StashAPI, settings?: Partial<FeedSettings>) {
    this.container = container;
    this.api = api || new StashAPI();
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.posts = new Map();
    this.postOrder = [];
    this.eagerPreloadedPosts = new Set();

    // Create scroll container
    this.scrollContainer = document.createElement('div');
    this.scrollContainer.className = 'feed-scroll-container';
    this.container.appendChild(this.scrollContainer);
    // Create header bar with unified search
    this.createHeaderBar();
    // Create posts container (separate from filter bar so we don't wipe it)
    this.postsContainer = document.createElement('div');
    this.postsContainer.className = 'feed-posts';
    this.scrollContainer.appendChild(this.postsContainer);

    // Initialize visibility manager
    this.visibilityManager = new VisibilityManager({
      threshold: this.settings.autoPlayThreshold,
      autoPlay: this.settings.autoPlay,
      maxConcurrent: this.settings.maxConcurrentVideos,
      debug: this.shouldEnableVisibilityDebug(),
    });

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
   * Create top header bar with unified search
   */
  private createHeaderBar(): void {
    // Cache saved filters
    let savedFiltersCache: Array<{ id: string; name: string }> = [];
    this.api.fetchSavedMarkerFilters().then((items) => {
      savedFiltersCache = items.map((f) => ({ id: f.id, name: f.name }));
    }).catch((e) => console.error('Failed to load saved marker filters', e));

    const header = document.createElement('div');
    this.headerBar = header;
    header.className = 'feed-header-bar';
    header.style.position = 'sticky';
    header.style.top = '0';
    header.style.width = '100%';
    // Account for padding (12px left + 12px right = 24px) so inner content matches card width
    header.style.maxWidth = `${this.settings.cardMaxWidth + 24}px`;
    header.style.marginLeft = 'auto';
    header.style.marginRight = 'auto';
    header.style.height = '56px';
    header.style.zIndex = '220';
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'flex-start';
    header.style.padding = '8px 12px';
    header.style.transition = 'transform 0.24s var(--ease-spring, ease), opacity 0.24s var(--ease-spring, ease)';
    header.style.boxSizing = 'border-box';
    header.style.transform = 'translateY(0)';

    // Inner container - full width of header (already constrained)
    const headerInner = document.createElement('div');
    headerInner.style.display = 'grid';
    headerInner.style.gridTemplateColumns = 'auto 1fr';
    headerInner.style.alignItems = 'center';
    headerInner.style.gap = '12px';
    headerInner.style.width = '100%';
    headerInner.style.height = '100%';
    headerInner.style.maxWidth = `${this.settings.cardMaxWidth}px`; // Match card width exactly
    headerInner.style.marginLeft = '0'; // Ensure no left margin
    headerInner.style.marginRight = '0'; // Ensure no right margin
    headerInner.style.boxSizing = 'border-box'; // Ensure consistent box model
    headerInner.style.flex = '1 1 auto'; // Ensure it fills available space in flex container

    const brand = document.createElement('div');
    brand.textContent = 'stashgifs';
    brand.style.fontWeight = '700';
    brand.style.letterSpacing = '0.5px';
    brand.style.color = '#F5C518';
    brand.style.fontSize = '17px';
    brand.style.lineHeight = '1.2';
    brand.style.cursor = 'pointer';
    brand.style.userSelect = 'none';
    brand.style.transition = 'opacity 0.2s ease';
    brand.title = 'Click to refresh feed';
    
    // Hover effect
    brand.addEventListener('mouseenter', () => {
      brand.style.opacity = '0.8';
    });
    brand.addEventListener('mouseleave', () => {
      brand.style.opacity = '1';
    });
    
    // Click to scroll to top
    brand.addEventListener('click', () => {
      try {
        // Prefer scrolling the window
        window.scrollTo({ top: 0, behavior: 'smooth' });
        // Also attempt to scroll the internal container if used
        const sc: any = (this as any).scrollContainer;
        if (sc && typeof sc.scrollTo === 'function') {
          sc.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (sc) {
          sc.scrollTop = 0;
        }
      } catch (e) {
        // Fallback
        window.scrollTo(0, 0);
        const sc: any = (this as any).scrollContainer;
        if (sc) sc.scrollTop = 0;
      }
    });
    
    // ensure smoother animation
    header.style.willChange = 'transform, opacity';
    headerInner.appendChild(brand);

    // Search area - constrained to grid column
    const searchArea = document.createElement('div');
    searchArea.style.position = 'relative';
    searchArea.style.width = '100%';
    searchArea.style.minWidth = '0'; // Allow grid to constrain width
    searchArea.style.maxWidth = '100%';
    searchArea.style.overflow = 'hidden'; // Prevent overflow
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
    inputWrapper.style.position = 'relative';
    inputWrapper.style.width = '100%';
    inputWrapper.style.minWidth = '0'; // Allow grid to constrain width
    inputWrapper.style.boxSizing = 'border-box';
    inputWrapper.style.marginRight = '0'; // Ensure no right margin that could create gap

    const queryInput = document.createElement('input');
    queryInput.type = 'text';
    queryInput.placeholder = 'Search tags or apply saved filters…';
    queryInput.className = 'feed-filters__input';
    queryInput.style.width = '100%';
    queryInput.style.minWidth = '0';
    queryInput.style.height = '36px';
    queryInput.style.padding = '0 14px';
    queryInput.style.borderRadius = '10px';
    queryInput.style.border = '1px solid rgba(255,255,255,0.12)';
    queryInput.style.background = 'rgba(28, 28, 30, 0.6)';
    queryInput.style.color = 'inherit';
    queryInput.style.fontSize = '15px';
    queryInput.style.lineHeight = '1.4';
    queryInput.style.boxSizing = 'border-box';
    queryInput.style.transition = 'background 0.2s ease, border-color 0.2s ease';

    // Append input to wrapper
    inputWrapper.appendChild(queryInput);

    const suggestions = document.createElement('div');
    suggestions.className = 'feed-filters__suggestions hide-scrollbar';
    suggestions.style.position = 'fixed';
    suggestions.style.left = '0';
    suggestions.style.right = '0';
    suggestions.style.top = '72px'; // Position below search bar (56px header + 16px padding)
    suggestions.style.bottom = '0';
    suggestions.style.zIndex = '1000';
    suggestions.style.display = 'none';
    suggestions.style.background = 'rgba(0, 0, 0, 0.85)';
    suggestions.style.backdropFilter = 'blur(20px) saturate(180%)';
    (suggestions.style as any).webkitBackdropFilter = 'blur(20px) saturate(180%)';
    suggestions.style.overflowY = 'auto';
    suggestions.style.paddingTop = '16px';
    suggestions.style.paddingBottom = '20px';
    suggestions.style.paddingLeft = '16px';
    suggestions.style.paddingRight = '16px';
    suggestions.style.boxSizing = 'border-box';

    // Input wrapper (contains input and reset button), then tag header below
    searchArea.appendChild(inputWrapper);
    searchArea.appendChild(tagHeader);
    // Append suggestions to body for full-screen overlay
    document.body.appendChild(suggestions);

    // Append header to scroll container at the top (before posts)
    this.scrollContainer.insertBefore(header, this.scrollContainer.firstChild);

    // No need for paddingTop since header is sticky and inside scroll container

    const updateSearchBarDisplay = () => {
      // Show the active search term in the search bar
      if (this.selectedTagName) {
        queryInput.value = this.selectedTagName;
      } else if (this.selectedSavedFilter) {
        queryInput.value = this.selectedSavedFilter.name;
      } else {
        queryInput.value = '';
      }
      // Hide tag header since we're showing it in the search bar
      tagHeader.style.display = 'none';
    };

    const apply = () => {
      const q = queryInput.value.trim();
      // Use query for text-based search (includes partial matches like "finger" matching "fingers", "finger - pov", etc.)
      // When a tag is selected, use its name for fuzzy matching
      // When user types manually, use that query (unless a saved filter is active)
      let queryValue: string | undefined = undefined;
      if (this.selectedTagName) {
        queryValue = this.selectedTagName;
      } else if (q && !this.selectedSavedFilter) {
        queryValue = q;
      }
      
      const newFilters: FilterOptions = {
        query: queryValue,
        // Don't use primary_tags with exact ID - use query instead for fuzzy matching
        primary_tags: undefined,
        savedFilterId: this.selectedSavedFilter?.id || undefined,
        limit: 20,
        offset: 0,
      };
      this.currentFilters = newFilters;
      this.loadVideos(newFilters, false).catch((e) => console.error('Apply filters failed', e));
    };

    // Suggestions
    let suggestTimeout: any;
    let suggestTerm = '';
    
    // Helper to format post count
    const formatPostCount = (count: number): string => {
      if (count >= 1000) {
        const k = Math.floor(count / 1000);
        return `${k}K POSTS`;
      }
      return `${count} POSTS`;
    };

    // Helper to get marker count for a tag
    const getMarkerCount = async (tagId: number): Promise<number> => {
      try {
        const query = `query GetMarkerCount($scene_marker_filter: SceneMarkerFilterType) {
          findSceneMarkers(scene_marker_filter: $scene_marker_filter) { count }
        }`;
        const sceneMarkerFilter: any = { tags: { value: [tagId], modifier: 'INCLUDES' } };
        const variables: any = { scene_marker_filter: sceneMarkerFilter };
        
        const apiAny = this.api as any;
        if (apiAny.pluginApi?.GQL?.client) {
          const res = await apiAny.pluginApi.GQL.client.query({ query: query as any, variables });
          return res.data?.findSceneMarkers?.count || 0;
        }
        const response = await fetch(`${apiAny.baseUrl}/graphql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiAny.apiKey && { 'ApiKey': apiAny.apiKey }),
          },
          body: JSON.stringify({ query, variables }),
        });
        if (!response.ok) return 0;
        const data = await response.json();
        return data.data?.findSceneMarkers?.count || 0;
      } catch {
        return 0;
      }
    };

    const fetchAndShowSuggestions = async (text: string, forceShow: boolean = false) => {
      const trimmedText = text.trim();
      // Show suggestions if we have text (2+ chars) OR if forced (on focus with empty/minimal text)
      if (!trimmedText || trimmedText.length < 2) {
        if (forceShow) {
          suggestions.innerHTML = '';
          
          // Create container for content (max-width on desktop)
          const contentContainer = document.createElement('div');
          contentContainer.style.maxWidth = '600px';
          contentContainer.style.margin = '0 auto';
          contentContainer.style.width = '100%';
          
          // Trending Searches section
          const trendingLabel = document.createElement('div');
          trendingLabel.textContent = 'Trending Searches';
          trendingLabel.style.fontSize = '17px';
          trendingLabel.style.fontWeight = '600';
          trendingLabel.style.color = '#FFFFFF';
          trendingLabel.style.marginBottom = '16px';
          trendingLabel.style.paddingTop = '8px';
          contentContainer.appendChild(trendingLabel);
          
          // On focus with empty text, show trending tags (top 3 only)
          const pageSize = 3;
          const items = await this.api.searchMarkerTags('', pageSize);
          
          // Get counts for tags
          const itemsWithCounts = await Promise.all(
            items.slice(0, 3).map(async (tag) => {
              const tagId = parseInt(tag.id, 10);
              if (this.selectedTagId === tagId) return null;
              const count = await getMarkerCount(tagId);
              return { ...tag, count };
            })
          );
          
          const validItems = itemsWithCounts.filter((item): item is { id: string; name: string; count: number } => item !== null && item.count > 0);
          
          validItems.forEach((tag) => {
            const item = document.createElement('button');
            item.style.width = '100%';
            item.style.display = 'flex';
            item.style.alignItems = 'center';
            item.style.gap = '12px';
            item.style.padding = '12px';
            item.style.borderRadius = '12px';
            item.style.border = 'none';
            item.style.background = 'transparent';
            item.style.cursor = 'pointer';
            item.style.textAlign = 'left';
            item.style.transition = 'background 0.2s ease';
            item.style.marginBottom = '4px';
            
            item.addEventListener('mouseenter', () => {
              item.style.background = 'rgba(255, 255, 255, 0.08)';
            });
            item.addEventListener('mouseleave', () => {
              item.style.background = 'transparent';
            });
            
            // Hash icon
            const hashIcon = document.createElement('div');
            hashIcon.textContent = '#';
            hashIcon.style.width = '32px';
            hashIcon.style.height = '32px';
            hashIcon.style.borderRadius = '50%';
            hashIcon.style.background = 'rgba(255, 255, 255, 0.1)';
            hashIcon.style.display = 'flex';
            hashIcon.style.alignItems = 'center';
            hashIcon.style.justifyContent = 'center';
            hashIcon.style.fontSize = '16px';
            hashIcon.style.fontWeight = '600';
            hashIcon.style.color = 'rgba(255, 255, 255, 0.8)';
            hashIcon.style.flexShrink = '0';
            
            // Tag name and count container
            const textContainer = document.createElement('div');
            textContainer.style.flex = '1';
            textContainer.style.display = 'flex';
            textContainer.style.flexDirection = 'column';
            textContainer.style.gap = '4px';
            
            const tagName = document.createElement('div');
            tagName.textContent = tag.name;
            tagName.style.fontSize = '15px';
            tagName.style.fontWeight = '500';
            tagName.style.color = '#FFFFFF';
            
            const postCount = document.createElement('div');
            postCount.textContent = formatPostCount(tag.count);
            postCount.style.fontSize = '13px';
            postCount.style.color = 'rgba(255, 255, 255, 0.6)';
            
            textContainer.appendChild(tagName);
            textContainer.appendChild(postCount);
            
            item.appendChild(hashIcon);
            item.appendChild(textContainer);
            
            item.addEventListener('click', () => {
              const tagId = parseInt(tag.id, 10);
              // Clear saved filter when selecting a tag
              this.selectedSavedFilter = undefined;
              this.selectedTagId = tagId;
              this.selectedTagName = tag.name;
              updateSearchBarDisplay();
              apply();
              suggestions.style.display = 'none';
              suggestions.innerHTML = '';
            });
            
            contentContainer.appendChild(item);
          });
          
          if (validItems.length > 0) {
            const divider = document.createElement('div');
            divider.style.width = '100%';
            divider.style.height = '1px';
            divider.style.background = 'rgba(255,255,255,0.08)';
            divider.style.margin = '16px 0';
            contentContainer.appendChild(divider);
          }
          
          // Saved Filters section
          if (savedFiltersCache.length > 0) {
            const savedLabel = document.createElement('div');
            savedLabel.textContent = 'SAVED FILTERS';
            savedLabel.style.width = '100%';
            savedLabel.style.fontSize = '11px';
            savedLabel.style.fontWeight = '600';
            savedLabel.style.textTransform = 'uppercase';
            savedLabel.style.letterSpacing = '0.5px';
            savedLabel.style.marginBottom = '12px';
            savedLabel.style.marginTop = '8px';
            savedLabel.style.color = 'rgba(255,255,255,0.6)';
            contentContainer.appendChild(savedLabel);
            
            // Container for horizontal layout
            const filtersContainer = document.createElement('div');
            filtersContainer.style.display = 'flex';
            filtersContainer.style.flexWrap = 'wrap';
            filtersContainer.style.gap = '8px';
            filtersContainer.style.width = '100%';
            
            savedFiltersCache.forEach((f) => {
              const item = document.createElement('button');
              item.style.display = 'inline-flex';
              item.style.alignItems = 'center';
              item.style.padding = '8px 16px';
              item.style.borderRadius = '12px';
              item.style.border = 'none';
              item.style.background = 'transparent';
              item.style.cursor = 'pointer';
              item.style.transition = 'background 0.2s ease';
              item.style.whiteSpace = 'nowrap';
              
              item.addEventListener('mouseenter', () => {
                item.style.background = 'rgba(255, 255, 255, 0.08)';
              });
              item.addEventListener('mouseleave', () => {
                item.style.background = 'transparent';
              });
              
              const filterName = document.createElement('div');
              filterName.textContent = f.name;
              filterName.style.fontSize = '15px';
              filterName.style.fontWeight = '500';
              filterName.style.color = '#FFFFFF';
              
              item.appendChild(filterName);
              
          item.addEventListener('click', () => {
            this.selectedSavedFilter = { id: f.id, name: f.name };
            this.selectedTagId = undefined;
            this.selectedTagName = undefined;
            updateSearchBarDisplay();
            this.currentFilters = { savedFilterId: f.id, limit: 20, offset: 0 };
            this.loadVideos(this.currentFilters, false).catch((e) => console.error('Apply saved filter failed', e));
            suggestions.style.display = 'none';
            suggestions.innerHTML = '';
          });
              
              filtersContainer.appendChild(item);
            });
            
            contentContainer.appendChild(filtersContainer);
          }
          
          suggestions.appendChild(contentContainer);
          suggestions.style.display = suggestions.children.length > 0 ? 'block' : 'none';
        } else {
          suggestions.style.display = 'none';
          suggestions.innerHTML = '';
        }
        return;
      }
      
      if (trimmedText !== suggestTerm) suggestions.innerHTML = '';
      suggestTerm = trimmedText;
      
      // Create container for content (max-width on desktop)
      const contentContainer = document.createElement('div');
      contentContainer.style.maxWidth = '600px';
      contentContainer.style.margin = '0 auto';
      contentContainer.style.width = '100%';
      
      const pageSize = 20;
      const items = await this.api.searchMarkerTags(trimmedText, pageSize);
      
      // Get counts for tags
      const itemsWithCounts = await Promise.all(
        items.slice(0, 20).map(async (tag) => {
          const tagId = parseInt(tag.id, 10);
          if (this.selectedTagId === tagId) return null;
          const count = await getMarkerCount(tagId);
          return { ...tag, count };
        })
      );
      
      const validItems = itemsWithCounts.filter((item): item is { id: string; name: string; count: number } => item !== null && item.count > 0);
      
      // Tags
      validItems.forEach((tag) => {
        const item = document.createElement('button');
        item.style.width = '100%';
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.gap = '12px';
        item.style.padding = '12px';
        item.style.borderRadius = '12px';
        item.style.border = 'none';
        item.style.background = 'transparent';
        item.style.cursor = 'pointer';
        item.style.textAlign = 'left';
        item.style.transition = 'background 0.2s ease';
        item.style.marginBottom = '4px';
        
        item.addEventListener('mouseenter', () => {
          item.style.background = 'rgba(255, 255, 255, 0.08)';
        });
        item.addEventListener('mouseleave', () => {
          item.style.background = 'transparent';
        });
        
        // Hash icon
        const hashIcon = document.createElement('div');
        hashIcon.textContent = '#';
        hashIcon.style.width = '32px';
        hashIcon.style.height = '32px';
        hashIcon.style.borderRadius = '50%';
        hashIcon.style.background = 'rgba(255, 255, 255, 0.1)';
        hashIcon.style.display = 'flex';
        hashIcon.style.alignItems = 'center';
        hashIcon.style.justifyContent = 'center';
        hashIcon.style.fontSize = '16px';
        hashIcon.style.fontWeight = '600';
        hashIcon.style.color = 'rgba(255, 255, 255, 0.8)';
        hashIcon.style.flexShrink = '0';
        
        // Tag name and count container
        const textContainer = document.createElement('div');
        textContainer.style.flex = '1';
        textContainer.style.display = 'flex';
        textContainer.style.flexDirection = 'column';
        textContainer.style.gap = '4px';
        
        const tagName = document.createElement('div');
        tagName.textContent = tag.name;
        tagName.style.fontSize = '15px';
        tagName.style.fontWeight = '500';
        tagName.style.color = '#FFFFFF';
        
        const postCount = document.createElement('div');
        postCount.textContent = formatPostCount(tag.count);
        postCount.style.fontSize = '13px';
        postCount.style.color = 'rgba(255, 255, 255, 0.6)';
        
        textContainer.appendChild(tagName);
        textContainer.appendChild(postCount);
        
        item.appendChild(hashIcon);
        item.appendChild(textContainer);
        
        item.addEventListener('click', () => {
          const tagId = parseInt(tag.id, 10);
          // Clear saved filter when selecting a tag
          this.selectedSavedFilter = undefined;
          this.selectedTagId = tagId;
          this.selectedTagName = tag.name;
          updateSearchBarDisplay();
          apply();
          suggestions.style.display = 'none';
          suggestions.innerHTML = '';
        });
        
        contentContainer.appendChild(item);
      });
      
      // Saved filters section
      const term = trimmedText.toLowerCase();
      const matches = savedFiltersCache.filter((f) => f.name.toLowerCase().includes(term));
      if (matches.length) {
        if (validItems.length > 0) {
          const divider = document.createElement('div');
          divider.style.width = '100%';
          divider.style.height = '1px';
          divider.style.background = 'rgba(255,255,255,0.08)';
          divider.style.margin = '16px 0';
          contentContainer.appendChild(divider);
        }
        
        const label = document.createElement('div');
        label.textContent = 'SAVED FILTERS';
        label.style.width = '100%';
        label.style.fontSize = '11px';
        label.style.fontWeight = '600';
        label.style.textTransform = 'uppercase';
        label.style.letterSpacing = '0.5px';
        label.style.marginBottom = '12px';
        label.style.marginTop = '8px';
        label.style.color = 'rgba(255,255,255,0.6)';
        contentContainer.appendChild(label);
        
        // Container for horizontal layout
        const filtersContainer = document.createElement('div');
        filtersContainer.style.display = 'flex';
        filtersContainer.style.flexWrap = 'wrap';
        filtersContainer.style.gap = '8px';
        filtersContainer.style.width = '100%';
        
        matches.forEach((f) => {
          const item = document.createElement('button');
          item.style.display = 'inline-flex';
          item.style.alignItems = 'center';
          item.style.padding = '8px 16px';
          item.style.borderRadius = '12px';
          item.style.border = 'none';
          item.style.background = 'transparent';
          item.style.cursor = 'pointer';
          item.style.transition = 'background 0.2s ease';
          item.style.whiteSpace = 'nowrap';
          
          item.addEventListener('mouseenter', () => {
            item.style.background = 'rgba(255, 255, 255, 0.08)';
          });
          item.addEventListener('mouseleave', () => {
            item.style.background = 'transparent';
          });
          
          const filterName = document.createElement('div');
          filterName.textContent = f.name;
          filterName.style.fontSize = '15px';
          filterName.style.fontWeight = '500';
          filterName.style.color = '#FFFFFF';
          
          item.appendChild(filterName);
          
          item.addEventListener('click', () => {
            this.selectedSavedFilter = { id: f.id, name: f.name };
            this.selectedTagId = undefined;
            this.selectedTagName = undefined;
            updateSearchBarDisplay();
            this.currentFilters = { savedFilterId: f.id, limit: 20, offset: 0 };
            this.loadVideos(this.currentFilters, false).catch((e) => console.error('Apply saved filter failed', e));
            suggestions.style.display = 'none';
            suggestions.innerHTML = '';
          });
          
          filtersContainer.appendChild(item);
        });
        
        contentContainer.appendChild(filtersContainer);
      }

      suggestions.appendChild(contentContainer);
      suggestions.style.display = (validItems.length || matches.length) ? 'block' : 'none';
    };
    
    queryInput.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') apply(); });
    queryInput.addEventListener('focus', () => {
      queryInput.style.background = 'rgba(28, 28, 30, 0.8)';
      queryInput.style.borderColor = 'rgba(255,255,255,0.16)';
      // Clear and reset when focusing on search bar for fresh search
      this.selectedTagId = undefined;
      this.selectedTagName = undefined;
      this.selectedSavedFilter = undefined;
      queryInput.value = '';
      // Calculate header height dynamically and position dropdown below it
      if (header) {
        const headerRect = header.getBoundingClientRect();
        suggestions.style.top = `${headerRect.bottom}px`;
      }
      fetchAndShowSuggestions('', true);
    });
    queryInput.addEventListener('blur', () => {
      queryInput.style.background = 'rgba(28, 28, 30, 0.6)';
      queryInput.style.borderColor = 'rgba(255,255,255,0.12)';
    });
    queryInput.addEventListener('input', () => {
      clearTimeout(suggestTimeout);
      const text = queryInput.value;
      // Clear selected tag/filter when user types (they're searching for something new)
      if (text !== this.selectedTagName && text !== this.selectedSavedFilter?.name) {
        this.selectedTagId = undefined;
        this.selectedTagName = undefined;
        this.selectedSavedFilter = undefined;
      }
      // Update dropdown position in case header moved
      if (header && suggestions.style.display !== 'none') {
        const headerRect = header.getBoundingClientRect();
        suggestions.style.top = `${headerRect.bottom}px`;
      }
      suggestTimeout = setTimeout(() => {
        fetchAndShowSuggestions(text, false);
      }, 150);
    });

    // Close suggestions when clicking outside or on backdrop
    suggestions.addEventListener('click', (e) => {
      if (e.target === suggestions) {
        suggestions.style.display = 'none';
        suggestions.innerHTML = '';
      }
    });
    
    document.addEventListener('click', (e) => {
      if (!searchArea.contains(e.target as Node) && !suggestions.contains(e.target as Node)) {
        suggestions.style.display = 'none';
        suggestions.innerHTML = '';
      }
    });

    // Initial render of search bar display (in case defaults are provided)
    updateSearchBarDisplay();
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

    // Cache saved filters and populate select
    let savedFiltersCache: Array<{ id: string; name: string }> = [];
    this.api.fetchSavedMarkerFilters().then((items) => {
      savedFiltersCache = items.map((f) => ({ id: f.id, name: f.name }));
      for (const f of savedFiltersCache) {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = f.name;
        savedSelect.appendChild(opt);
      }
    }).catch((e) => console.error('Failed to load saved marker filters', e));

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
    // Hide scrollbars in suggestions grid/list
    suggestions.classList.add('hide-scrollbar');
    suggestions.style.position = 'absolute';
    suggestions.style.zIndex = '1000';
    suggestions.style.display = 'none';
    suggestions.style.background = 'var(--bg, #161616)';
    suggestions.style.border = '1px solid rgba(255,255,255,0.1)';
    suggestions.style.left = '0';
    suggestions.style.right = '0';
    suggestions.style.borderRadius = '12px';
    suggestions.style.marginTop = '8px';
    suggestions.style.padding = '10px';
    suggestions.style.flexWrap = 'wrap';
    suggestions.style.gap = '8px';
    suggestions.style.maxHeight = '50vh';
    suggestions.style.overflowY = 'auto';
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
    clearBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';

    const apply = () => {
      const q = queryInput.value.trim();
      const savedId = (this.selectedSavedFilter?.id) || (savedSelect.value || undefined);
      const newFilters: FilterOptions = {
        query: q || undefined,
        primary_tags: this.selectedTagId ? [String(this.selectedTagId)] : undefined,
        savedFilterId: savedId,
        limit: 20,
        offset: 0,
      };
      this.currentFilters = newFilters;
      this.loadVideos(newFilters, false).catch((e) => console.error('Apply filters failed', e));
    };

    // Apply immediately when selecting a saved filter
    savedSelect.addEventListener('change', () => {
      if (savedSelect.value) {
        const match = savedFiltersCache.find((f) => f.id === savedSelect.value);
        if (match) {
          this.selectedSavedFilter = { id: match.id, name: match.name };
        }
        // Clear tag selections when a saved filter is chosen
        this.selectedTagId = undefined;
        this.selectedTagName = undefined;
      } else {
        this.selectedSavedFilter = undefined;
      }
      updateSearchBarDisplay();
      apply();
    });
    queryInput.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') apply(); });

    // Debounced suggestions
    let suggestTimeout: any;
    let suggestPage = 1;
    let suggestTerm = '';
    let suggestHasMore = false;
    const updateSearchBarDisplay = () => {
      // Show the active search term in the search bar
      if (this.selectedTagName) {
        queryInput.value = this.selectedTagName;
      } else if (this.selectedSavedFilter) {
        queryInput.value = this.selectedSavedFilter.name;
      } else {
        queryInput.value = '';
      }
      // Hide tag header since we're showing it in the search bar
      tagHeader.style.display = 'none';
    };

    const fetchSuggestions = async (text: string, page: number = 1, forceShow: boolean = false) => {
      const trimmedText = text.trim();
      // Show suggestions if we have text (2+ chars) OR if forced (on focus)
      if (!trimmedText || trimmedText.length < 2) {
        if (forceShow) {
          // On focus with empty text, show some tags and all saved filters
          suggestions.innerHTML = '';
          const pageSize = 24;
          const tags = await this.api.searchMarkerTags('', pageSize);
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
          if (tags.length) {
            const divider = document.createElement('div');
            divider.style.width = '100%';
            divider.style.height = '1px';
            divider.style.background = 'rgba(255,255,255,0.08)';
            divider.style.margin = '6px 0';
            suggestions.appendChild(divider);
          }
          // Saved filters label
          const label = document.createElement('div');
          label.textContent = 'Saved Filters';
          label.style.opacity = '0.75';
          label.style.fontSize = '12px';
          label.style.width = '100%';
          label.style.marginBottom = '6px';
          suggestions.appendChild(label);
          savedFiltersCache.forEach((f) => {
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
              suggestions.style.display = 'none';
              suggestions.innerHTML = '';
              updateSearchBarDisplay();
              apply();
            });
            suggestions.appendChild(chip);
          });
          suggestions.style.display = suggestions.children.length > 0 ? 'flex' : 'none';
        } else {
          suggestions.style.display = 'none';
          suggestions.innerHTML = '';
        }
        return;
      }
      // Reset grid when term changes
      if (trimmedText !== suggestTerm) {
        suggestPage = 1;
        suggestions.innerHTML = '';
      }
      suggestTerm = trimmedText;
      const pageSize = 24;
      const items = await this.api.searchMarkerTags(trimmedText, pageSize);

      // Render as chips
      items.forEach((tag) => {
        if (this.selectedTagId === parseInt(tag.id, 10)) return;
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
      const matchingSaved = (savedFiltersCache || []).filter((f) => f.name.toLowerCase().includes(term));
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
            suggestions.style.display = 'none';
            suggestions.innerHTML = '';
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
          const next = await this.api.searchMarkerTags(trimmedText, pageSize);
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

    queryInput.addEventListener('focus', () => {
      fetchSuggestions(queryInput.value, 1, true);
    });
    queryInput.addEventListener('input', () => {
      clearTimeout(suggestTimeout);
      const text = queryInput.value;
      suggestTimeout = setTimeout(() => { fetchSuggestions(text, 1, false); }, 150);
    });
    document.addEventListener('click', (e) => {
      if (!searchWrapper.contains(e.target as Node)) {
        suggestions.style.display = 'none';
      }
    });

    clearBtn.addEventListener('click', () => {
      queryInput.value = '';
      this.selectedTagId = undefined;
      this.selectedTagName = undefined;
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
  }

  /**
   * Load scene markers from Stash
   */
  async loadVideos(filters?: FilterOptions, append: boolean = false): Promise<void> {
    if (this.isLoading) {
      return;
    }

    this.isLoading = true;
    if (!append) {
      this.showLoading();
      this.currentPage = 1;
      this.hasMore = true;
    }

    try {
      const currentFilters = filters || this.currentFilters || {};
      const page = append ? this.currentPage + 1 : 1;
      
      
      const markers = await this.api.fetchSceneMarkers({
        ...currentFilters,
        limit: currentFilters.limit || 20,
        offset: append ? (page - 1) * (currentFilters.limit || 20) : 0,
      });
      
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
        this.hideLoading();
        return;
      }

      // Check if we got fewer results than requested (means no more pages)
      if (markers.length < (currentFilters.limit || 20)) {
        this.hasMore = false;
      }

      // Create posts for each marker
      for (const marker of markers) {
        await this.createPost(marker);
      }

      if (append) {
        this.currentPage = page;
      }

      // Autoplay first two on initial load (page 1) so they start without scroll
      if (!append && page === 1) {
        await this.autoplayInitial(2).catch((e) => console.warn('Autoplay initial failed', e));
      }

      this.hideLoading();
      
      // Update infinite scroll trigger position
      this.updateInfiniteScrollTrigger();
    } catch (error: any) {
      console.error('Error loading scene markers:', error);
      if (!append) {
        this.showError(`Failed to load scene markers: ${error.message || 'Unknown error'}`);
      }
      this.hideLoading();
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Create a video post from a scene marker
   */
  private async createPost(marker: SceneMarker): Promise<void> {
    const videoUrl = this.api.getMarkerVideoUrl(marker);
    const safeVideoUrl = isValidMediaUrl(videoUrl) ? videoUrl : undefined;
    
    // Skip creating post if no valid video URL is available
    if (!safeVideoUrl) {
      console.warn('FeedContainer: Skipping post creation - no valid video URL', {
        markerId: marker.id,
        markerTitle: marker.title,
        videoUrl,
      });
      return;
    }

    const postContainer = document.createElement('article');
    postContainer.className = 'video-post-wrapper';

    const thumbnailUrl = this.api.getMarkerThumbnailUrl(marker);

    const postData: VideoPostData = {
      marker,
      videoUrl: safeVideoUrl, // Use safeVideoUrl instead of potentially invalid videoUrl
      thumbnailUrl,
      startTime: marker.seconds,
      endTime: marker.end_seconds,
    };

    const post = new VideoPost(postContainer, postData, this.favoritesManager, this.api, this.visibilityManager);
    this.posts.set(marker.id, post);
    this.postOrder.push(marker.id);

    // Add to posts container
    this.postsContainer.appendChild(postContainer);

    // Observe for visibility
    this.visibilityManager.observePost(postContainer, marker.id);

    // Load video when it becomes visible (aggressive preloading, especially on mobile)
    // Load videos much earlier to prevent black screens
    if (safeVideoUrl) {
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      // Much larger rootMargin on mobile - load videos very early to account for slower mobile networks
      const rootMargin = isMobile ? '2000px' : '800px';
      
      // Use Intersection Observer to load video when near viewport
      const loadObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
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
            }
          }
        },
        { rootMargin, threshold: 0 } // Load as soon as any part enters the expanded viewport
      );
      loadObserver.observe(postContainer);
    } else {
      console.warn('FeedContainer: No video URL for marker', { markerId: marker.id });
    }

    this.scheduleEagerPreload();
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
    this.eagerPreloadedPosts.clear();
    this.cancelScheduledPreload();
    if (this.postsContainer) {
      this.postsContainer.innerHTML = '';
    }
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
        rootMargin: '200px', // Start loading 200px before reaching the trigger
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
   * Setup scroll handler
   * Handles header hide/show based on scroll direction
   */
  private setupScrollHandler(): void {
    let lastScrollY = window.scrollY;
    let isHeaderHidden = false;

    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      const scrollDelta = currentScrollY - lastScrollY;

      // Only hide/show header if scroll delta is significant enough
      if (Math.abs(scrollDelta) > 5) {
        if (scrollDelta > 0 && !isHeaderHidden && currentScrollY > 100) {
          // Scrolling down - hide header
          if (this.headerBar) {
            this.headerBar.style.transform = 'translateY(-100%)';
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
    this.visibilityManager.cleanup();
    this.clearPosts();
  }
}

