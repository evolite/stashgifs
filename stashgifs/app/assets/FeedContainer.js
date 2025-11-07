/**
 * Feed Container
 * Main application container managing the feed
 */
import { StashAPI } from './StashAPI.js';
import { VideoPost } from './VideoPost.js';
import { VisibilityManager } from './VisibilityManager.js';
import { FavoritesManager } from './FavoritesManager.js';
import { throttle, isValidMediaUrl } from './utils.js';
const DEFAULT_SETTINGS = {
    autoPlay: true, // Enable autoplay for markers
    autoPlayThreshold: 0.5,
    maxConcurrentVideos: 3,
    unloadDistance: 1000,
    cardMaxWidth: 800,
    aspectRatio: 'preserve',
    showControls: 'hover',
    enableFullscreen: true,
};
export class FeedContainer {
    constructor(container, api, settings) {
        this.markers = [];
        this.isLoading = false;
        this.selectedTagIds = [];
        this.selectedTagNames = [];
        this.hasMore = true;
        this.currentPage = 1;
        this.container = container;
        this.api = api || new StashAPI();
        this.settings = { ...DEFAULT_SETTINGS, ...settings };
        this.posts = new Map();
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
    unlockMobileAutoplay() {
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        if (!isMobile)
            return;
        let unlocked = false;
        const unlock = async () => {
            if (unlocked)
                return;
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
            }
            catch (e) {
                // Autoplay unlock failed, user will need to interact
            }
            finally {
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
    createHeaderBar() {
        // Cache saved filters
        let savedFiltersCache = [];
        this.api.fetchSavedMarkerFilters().then((items) => {
            savedFiltersCache = items.map((f) => ({ id: f.id, name: f.name }));
        }).catch((e) => console.error('Failed to load saved marker filters', e));
        const header = document.createElement('div');
        this.headerBar = header;
        header.style.position = 'fixed';
        header.style.top = '0';
        header.style.left = '0';
        header.style.right = '0';
        header.style.height = '72px';
        header.style.zIndex = '220';
        header.style.display = 'block';
        header.style.alignItems = 'center';
        header.style.padding = '8px 12px';
        header.style.background = 'rgba(18,18,18,0.75)';
        header.style.backdropFilter = 'blur(10px)';
        header.style.borderBottom = '1px solid rgba(255,255,255,0.06)';
        header.style.transition = 'transform .24s ease, opacity .24s ease';
        // Inner container constrained to card width
        const headerInner = document.createElement('div');
        headerInner.style.display = 'grid';
        headerInner.style.gridTemplateColumns = 'auto 1fr';
        headerInner.style.alignItems = 'center';
        headerInner.style.gap = '12px';
        headerInner.style.width = '100%';
        headerInner.style.maxWidth = `${this.settings.cardMaxWidth}px`;
        headerInner.style.margin = '0 auto';
        headerInner.style.height = '100%';
        const brand = document.createElement('div');
        brand.textContent = 'stashgifs';
        brand.style.fontWeight = '700';
        brand.style.letterSpacing = '0.5px';
        brand.style.color = '#F5C518';
        brand.style.fontSize = '16px';
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
                const sc = this.scrollContainer;
                if (sc && typeof sc.scrollTo === 'function') {
                    sc.scrollTo({ top: 0, behavior: 'smooth' });
                }
                else if (sc) {
                    sc.scrollTop = 0;
                }
            }
            catch (e) {
                // Fallback
                window.scrollTo(0, 0);
                const sc = this.scrollContainer;
                if (sc)
                    sc.scrollTop = 0;
            }
        });
        // ensure smoother animation
        header.style.willChange = 'transform, opacity';
        headerInner.appendChild(brand);
        // Search area
        const searchArea = document.createElement('div');
        searchArea.style.position = 'relative';
        // Constrain search width to match card width and center it
        searchArea.style.width = '100%';
        searchArea.style.maxWidth = '100%';
        searchArea.style.justifySelf = 'center';
        headerInner.appendChild(searchArea);
        header.appendChild(headerInner);
        // Chips container to visualize active filters
        const chips = document.createElement('div');
        chips.className = 'feed-filters__chips';
        chips.style.display = 'flex';
        chips.style.flexWrap = 'wrap';
        chips.style.gap = '6px';
        chips.style.marginTop = '6px';
        chips.style.width = '100%';
        chips.style.maxWidth = '100%';
        chips.style.overflow = 'hidden';
        chips.style.boxSizing = 'border-box';
        const queryInput = document.createElement('input');
        queryInput.type = 'text';
        queryInput.placeholder = 'Search tags or apply saved filters…';
        queryInput.className = 'feed-filters__input';
        queryInput.style.width = '100%';
        queryInput.style.height = '40px';
        queryInput.style.padding = '0 14px';
        queryInput.style.borderRadius = '999px';
        queryInput.style.border = '1px solid rgba(255,255,255,0.10)';
        queryInput.style.background = 'rgba(22,22,22,0.9)';
        queryInput.style.color = 'inherit';
        queryInput.style.fontSize = '14px';
        const suggestions = document.createElement('div');
        suggestions.className = 'feed-filters__suggestions hide-scrollbar';
        suggestions.style.position = 'absolute';
        suggestions.style.left = '0';
        suggestions.style.right = '0';
        suggestions.style.top = '46px';
        suggestions.style.zIndex = '221';
        suggestions.style.display = 'none';
        suggestions.style.background = 'rgba(22,22,22,0.98)';
        suggestions.style.border = '1px solid rgba(255,255,255,0.10)';
        suggestions.style.borderRadius = '12px';
        suggestions.style.padding = '10px';
        suggestions.style.maxHeight = '60vh';
        suggestions.style.overflowY = 'auto';
        suggestions.style.display = 'none';
        suggestions.style.flexWrap = 'wrap';
        suggestions.style.gap = '8px';
        // Input first, then suggestions overlay, then chips below the input
        searchArea.appendChild(queryInput);
        searchArea.appendChild(suggestions);
        searchArea.appendChild(chips);
        this.container.appendChild(header);
        // Add top padding to scroll container so content is not hidden under header
        this.scrollContainer.style.paddingTop = '90px';
        const renderChips = () => {
            chips.innerHTML = '';
            // Saved filter chip first (if any)
            if (this.selectedSavedFilter) {
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.textContent = this.selectedSavedFilter.name;
                chip.className = 'feed-chip';
                chip.style.padding = '4px 10px';
                chip.style.borderRadius = '999px';
                chip.style.border = '1px solid rgba(255,255,255,0.12)';
                chip.style.background = 'rgba(255,255,255,0.06)';
                chip.style.fontSize = '12px';
                chip.style.display = 'inline-flex';
                chip.style.alignItems = 'center';
                chip.style.gap = '6px';
                chip.style.flexShrink = '0';
                chip.style.whiteSpace = 'nowrap';
                chip.style.maxWidth = '100%';
                const x = document.createElement('button');
                x.textContent = '×';
                x.style.background = 'transparent';
                x.style.border = 'none';
                x.style.color = 'inherit';
                x.style.cursor = 'pointer';
                x.style.fontSize = '14px';
                x.addEventListener('click', () => {
                    this.selectedSavedFilter = undefined;
                    // ensure dropdown (if any) is cleared via shared state; header has no select
                    renderChips();
                    apply();
                });
                chip.appendChild(x);
                chips.appendChild(chip);
            }
            this.selectedTagNames.forEach((name, idx) => {
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.textContent = name;
                chip.className = 'feed-chip';
                chip.style.padding = '4px 10px';
                chip.style.borderRadius = '999px';
                chip.style.border = '1px solid rgba(255,255,255,0.12)';
                chip.style.background = 'rgba(255,255,255,0.06)';
                chip.style.fontSize = '12px';
                chip.style.display = 'inline-flex';
                chip.style.alignItems = 'center';
                chip.style.gap = '6px';
                chip.style.flexShrink = '0';
                chip.style.whiteSpace = 'nowrap';
                chip.style.maxWidth = '100%';
                const x = document.createElement('button');
                x.textContent = '×';
                x.style.background = 'transparent';
                x.style.border = 'none';
                x.style.color = 'inherit';
                x.style.cursor = 'pointer';
                x.style.fontSize = '14px';
                x.addEventListener('click', () => {
                    this.selectedTagIds.splice(idx, 1);
                    this.selectedTagNames.splice(idx, 1);
                    renderChips();
                    apply();
                });
                chip.appendChild(x);
                chips.appendChild(chip);
            });
        };
        const apply = () => {
            const q = queryInput.value.trim();
            const newFilters = {
                query: q || undefined,
                primary_tags: this.selectedTagIds.length ? this.selectedTagIds.map(String) : undefined,
                savedFilterId: this.selectedSavedFilter?.id || undefined,
                limit: 20,
                offset: 0,
            };
            this.currentFilters = newFilters;
            this.loadVideos(newFilters, false).catch((e) => console.error('Apply filters failed', e));
        };
        // Suggestions
        let suggestTimeout;
        let suggestTerm = '';
        const fetchAndShowSuggestions = async (text, forceShow = false) => {
            const trimmedText = text.trim();
            // Show suggestions if we have text (2+ chars) OR if forced (on focus with empty/minimal text)
            if (!trimmedText || trimmedText.length < 2) {
                if (forceShow) {
                    suggestions.innerHTML = '';
                    // On focus with empty text, show some tags first
                    const pageSize = 24;
                    const items = await this.api.searchMarkerTags('', pageSize);
                    items.forEach((tag) => {
                        if (this.selectedTagIds.includes(parseInt(tag.id, 10)))
                            return;
                        const btn = document.createElement('button');
                        btn.textContent = tag.name;
                        btn.className = 'suggest-chip';
                        btn.style.padding = '6px 10px';
                        btn.style.borderRadius = '999px';
                        btn.style.border = '1px solid rgba(255,255,255,0.12)';
                        btn.style.background = 'rgba(255,255,255,0.05)';
                        btn.style.color = 'inherit';
                        btn.style.fontSize = '13px';
                        btn.style.cursor = 'pointer';
                        btn.addEventListener('click', () => {
                            const tagId = parseInt(tag.id, 10);
                            if (!this.selectedTagIds.includes(tagId)) {
                                this.selectedTagIds.push(tagId);
                                this.selectedTagNames.push(tag.name);
                                renderChips();
                                apply();
                                fetchAndShowSuggestions('', true);
                            }
                        });
                        suggestions.appendChild(btn);
                    });
                    if (items.length) {
                        const divider = document.createElement('div');
                        divider.style.width = '100%';
                        divider.style.height = '1px';
                        divider.style.background = 'rgba(255,255,255,0.08)';
                        divider.style.margin = '6px 0';
                        suggestions.appendChild(divider);
                    }
                    // Then show ALL saved filters
                    const label = document.createElement('div');
                    label.textContent = 'Saved Filters';
                    label.style.width = '100%';
                    label.style.opacity = '0.75';
                    label.style.fontSize = '12px';
                    label.style.marginBottom = '6px';
                    suggestions.appendChild(label);
                    savedFiltersCache.forEach((f) => {
                        const btn = document.createElement('button');
                        btn.textContent = f.name;
                        btn.className = 'suggest-chip';
                        btn.style.padding = '6px 10px';
                        btn.style.borderRadius = '999px';
                        btn.style.border = '1px solid rgba(255,255,255,0.12)';
                        btn.style.background = 'rgba(255,255,255,0.05)';
                        btn.style.color = 'inherit';
                        btn.style.fontSize = '13px';
                        btn.style.cursor = 'pointer';
                        btn.addEventListener('click', () => {
                            this.selectedSavedFilter = { id: f.id, name: f.name };
                            this.selectedTagIds = [];
                            this.selectedTagNames = [];
                            queryInput.value = '';
                            this.currentFilters = { savedFilterId: f.id, limit: 20, offset: 0 };
                            this.loadVideos(this.currentFilters, false).catch((e) => console.error('Apply saved filter failed', e));
                            suggestions.style.display = 'none';
                            suggestions.innerHTML = '';
                            renderChips();
                        });
                        suggestions.appendChild(btn);
                    });
                    suggestions.style.display = suggestions.children.length > 0 ? 'flex' : 'none';
                }
                else {
                    suggestions.style.display = 'none';
                    suggestions.innerHTML = '';
                }
                return;
            }
            if (trimmedText !== suggestTerm)
                suggestions.innerHTML = '';
            suggestTerm = trimmedText;
            const pageSize = 24;
            const items = await this.api.searchMarkerTags(trimmedText, pageSize);
            // Tags
            items.forEach((tag) => {
                if (this.selectedTagIds.includes(parseInt(tag.id, 10)))
                    return;
                const btn = document.createElement('button');
                btn.textContent = tag.name;
                btn.className = 'suggest-chip';
                btn.style.padding = '6px 10px';
                btn.style.borderRadius = '999px';
                btn.style.border = '1px solid rgba(255,255,255,0.12)';
                btn.style.background = 'rgba(255,255,255,0.05)';
                btn.style.color = 'inherit';
                btn.style.fontSize = '13px';
                btn.style.cursor = 'pointer';
                btn.addEventListener('click', () => {
                    const tagId = parseInt(tag.id, 10);
                    if (!this.selectedTagIds.includes(tagId)) {
                        this.selectedTagIds.push(tagId);
                        this.selectedTagNames.push(tag.name);
                        renderChips();
                        apply();
                        queryInput.dispatchEvent(new Event('input'));
                    }
                });
                suggestions.appendChild(btn);
            });
            // Saved filters section
            const term = trimmedText.toLowerCase();
            const matches = savedFiltersCache.filter((f) => f.name.toLowerCase().includes(term));
            if (matches.length) {
                const label = document.createElement('div');
                label.textContent = 'Saved Filters';
                label.style.width = '100%';
                label.style.opacity = '0.75';
                label.style.fontSize = '12px';
                label.style.marginTop = '6px';
                suggestions.appendChild(label);
                matches.forEach((f) => {
                    const btn = document.createElement('button');
                    btn.textContent = f.name;
                    btn.className = 'suggest-chip';
                    btn.style.padding = '6px 10px';
                    btn.style.borderRadius = '999px';
                    btn.style.border = '1px solid rgba(255,255,255,0.12)';
                    btn.style.background = 'rgba(255,255,255,0.05)';
                    btn.style.color = 'inherit';
                    btn.style.fontSize = '13px';
                    btn.style.cursor = 'pointer';
                    btn.addEventListener('click', () => {
                        this.selectedSavedFilter = { id: f.id, name: f.name };
                        this.selectedTagIds = [];
                        this.selectedTagNames = [];
                        queryInput.value = '';
                        this.currentFilters = { savedFilterId: f.id, limit: 20, offset: 0 };
                        this.loadVideos(this.currentFilters, false).catch((e) => console.error('Apply saved filter failed', e));
                        suggestions.style.display = 'none';
                        suggestions.innerHTML = '';
                        renderChips();
                    });
                    suggestions.appendChild(btn);
                });
            }
            suggestions.style.display = (items.length || matches.length) ? 'flex' : 'none';
        };
        queryInput.addEventListener('keydown', (e) => { if (e.key === 'Enter')
            apply(); });
        queryInput.addEventListener('focus', () => {
            fetchAndShowSuggestions(queryInput.value, true);
        });
        queryInput.addEventListener('input', () => {
            clearTimeout(suggestTimeout);
            const text = queryInput.value;
            suggestTimeout = setTimeout(() => {
                fetchAndShowSuggestions(text, false);
            }, 150);
        });
        document.addEventListener('click', (e) => {
            if (!searchArea.contains(e.target))
                suggestions.style.display = 'none';
        });
        // Initial render of chips (in case defaults are provided)
        renderChips();
    }
    renderFilterSheet() {
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
        const getScrollbarWidth = () => Math.max(0, window.innerWidth - document.documentElement.clientWidth);
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
        let savedFiltersCache = [];
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
        const chips = document.createElement('div');
        chips.className = 'feed-filters__chips';
        chips.style.display = 'flex';
        chips.style.flexWrap = 'wrap';
        chips.style.gap = '6px';
        chips.style.width = '100%';
        chips.style.maxWidth = '100%';
        chips.style.overflow = 'hidden';
        chips.style.boxSizing = 'border-box';
        searchWrapper.style.position = 'relative';
        searchWrapper.appendChild(chips);
        searchWrapper.appendChild(queryInput);
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
            const newFilters = {
                query: q || undefined,
                primary_tags: this.selectedTagIds.length ? this.selectedTagIds.map(String) : undefined,
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
                this.selectedTagIds = [];
                this.selectedTagNames = [];
                queryInput.value = '';
                renderChips();
            }
            else {
                this.selectedSavedFilter = undefined;
                renderChips();
            }
            apply();
        });
        queryInput.addEventListener('keydown', (e) => { if (e.key === 'Enter')
            apply(); });
        // Debounced suggestions
        let suggestTimeout;
        let suggestPage = 1;
        let suggestTerm = '';
        let suggestHasMore = false;
        const renderChips = () => {
            chips.innerHTML = '';
            // Saved filter chip first (if any)
            if (this.selectedSavedFilter) {
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.textContent = this.selectedSavedFilter.name;
                chip.className = 'feed-chip';
                chip.style.padding = '4px 10px';
                chip.style.borderRadius = '999px';
                chip.style.border = '1px solid rgba(255,255,255,0.12)';
                chip.style.background = 'rgba(255,255,255,0.06)';
                chip.style.fontSize = '12px';
                chip.style.display = 'inline-flex';
                chip.style.alignItems = 'center';
                chip.style.gap = '6px';
                chip.style.flexShrink = '0';
                chip.style.whiteSpace = 'nowrap';
                chip.style.maxWidth = '100%';
                const x = document.createElement('button');
                x.textContent = '×';
                x.style.background = 'transparent';
                x.style.border = 'none';
                x.style.color = 'inherit';
                x.style.cursor = 'pointer';
                x.style.fontSize = '14px';
                x.addEventListener('click', () => {
                    this.selectedSavedFilter = undefined;
                    savedSelect.value = '';
                    apply();
                    renderChips();
                });
                chip.appendChild(x);
                chips.appendChild(chip);
            }
            this.selectedTagNames.forEach((name, idx) => {
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.textContent = name;
                chip.className = 'feed-chip';
                chip.style.padding = '4px 10px';
                chip.style.borderRadius = '999px';
                chip.style.border = '1px solid rgba(255,255,255,0.12)';
                chip.style.background = 'rgba(255,255,255,0.06)';
                chip.style.fontSize = '12px';
                chip.style.display = 'inline-flex';
                chip.style.alignItems = 'center';
                chip.style.gap = '6px';
                chip.style.flexShrink = '0';
                chip.style.whiteSpace = 'nowrap';
                chip.style.maxWidth = '100%';
                const x = document.createElement('button');
                x.textContent = '×';
                x.style.background = 'transparent';
                x.style.border = 'none';
                x.style.color = 'inherit';
                x.style.cursor = 'pointer';
                x.style.fontSize = '14px';
                x.addEventListener('click', () => {
                    this.selectedTagIds.splice(idx, 1);
                    this.selectedTagNames.splice(idx, 1);
                    renderChips();
                    apply();
                });
                chip.appendChild(x);
                chips.appendChild(chip);
            });
        };
        const fetchSuggestions = async (text, page = 1, forceShow = false) => {
            const trimmedText = text.trim();
            // Show suggestions if we have text (2+ chars) OR if forced (on focus)
            if (!trimmedText || trimmedText.length < 2) {
                if (forceShow) {
                    // On focus with empty text, show some tags and all saved filters
                    suggestions.innerHTML = '';
                    const pageSize = 24;
                    const tags = await this.api.searchMarkerTags('', pageSize);
                    tags.forEach((tag) => {
                        if (this.selectedTagIds.includes(parseInt(tag.id, 10)))
                            return;
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
                            this.selectedSavedFilter = undefined;
                            savedSelect.value = '';
                            const tagId = parseInt(tag.id, 10);
                            if (!this.selectedTagIds.includes(tagId)) {
                                this.selectedTagIds.push(tagId);
                                this.selectedTagNames.push(tag.name);
                                renderChips();
                                apply();
                                fetchSuggestions('', 1, true);
                            }
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
                            this.selectedTagIds = [];
                            this.selectedTagNames = [];
                            queryInput.value = '';
                            suggestions.style.display = 'none';
                            suggestions.innerHTML = '';
                            renderChips();
                            apply();
                        });
                        suggestions.appendChild(chip);
                    });
                    suggestions.style.display = suggestions.children.length > 0 ? 'flex' : 'none';
                }
                else {
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
                if (this.selectedTagIds.includes(parseInt(tag.id, 10)))
                    return;
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
                    if (!this.selectedTagIds.includes(tagId)) {
                        this.selectedTagIds.push(tagId);
                        this.selectedTagNames.push(tag.name);
                        renderChips();
                        apply();
                        // Refresh suggestions to remove the newly selected tag and keep menu open
                        fetchSuggestions(trimmedText, 1, false);
                    }
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
                        this.selectedTagIds = [];
                        this.selectedTagNames = [];
                        queryInput.value = '';
                        suggestions.style.display = 'none';
                        suggestions.innerHTML = '';
                        renderChips();
                        apply();
                    });
                    suggestions.appendChild(chip);
                });
            }
            // Add/load more button
            const existingMore = suggestions.querySelector('[data-more="1"]');
            if (existingMore)
                existingMore.remove();
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
                        if (this.selectedTagIds.includes(parseInt(tag.id, 10)))
                            return;
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
                            this.selectedSavedFilter = undefined;
                            savedSelect.value = '';
                            const tagId = parseInt(tag.id, 10);
                            if (!this.selectedTagIds.includes(tagId)) {
                                this.selectedTagIds.push(tagId);
                                this.selectedTagNames.push(tag.name);
                                renderChips();
                                apply();
                                // Refresh suggestions for continued multi-select
                                fetchSuggestions(trimmedText, 1, false);
                            }
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
            if (!searchWrapper.contains(e.target)) {
                suggestions.style.display = 'none';
            }
        });
        clearBtn.addEventListener('click', () => {
            queryInput.value = '';
            this.selectedTagIds = [];
            this.selectedTagNames = [];
            this.selectedSavedFilter = undefined;
            chips.innerHTML = '';
            savedSelect.value = '';
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
            if (isMobile())
                setMobileLayout();
            else
                setDesktopLayout();
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
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape')
                closePanel();
        });
        window.addEventListener('resize', () => {
            const wasOpen = sheetOpen;
            applyLayout();
            if (wasOpen) {
                // Re-apply the correct open transform for current layout
                openPanel();
            }
            else {
                closePanel();
            }
        });
    }
    /**
     * Initialize the feed
     */
    async init(filters) {
        this.currentFilters = filters;
        await this.loadVideos(filters);
    }
    /**
     * Load scene markers from Stash
     */
    async loadVideos(filters, append = false) {
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
            }
            else {
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
        }
        catch (error) {
            console.error('Error loading scene markers:', error);
            if (!append) {
                this.showError(`Failed to load scene markers: ${error.message || 'Unknown error'}`);
            }
            this.hideLoading();
        }
        finally {
            this.isLoading = false;
        }
    }
    /**
     * Create a video post from a scene marker
     */
    async createPost(marker) {
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
        const postData = {
            marker,
            videoUrl: safeVideoUrl, // Use safeVideoUrl instead of potentially invalid videoUrl
            thumbnailUrl,
            startTime: marker.seconds,
            endTime: marker.end_seconds,
        };
        const post = new VideoPost(postContainer, postData, this.favoritesManager, this.api, this.visibilityManager);
        this.posts.set(marker.id, post);
        // Add to posts container
        this.postsContainer.appendChild(postContainer);
        // Observe for visibility
        this.visibilityManager.observePost(postContainer, marker.id);
        // Load video when it becomes visible (lazy loading)
        // On mobile, start loading earlier (larger rootMargin)
        if (safeVideoUrl) {
            const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
            const rootMargin = isMobile ? '300px' : '100px';
            // Use Intersection Observer to load video when near viewport
            const loadObserver = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        post.loadPlayer(safeVideoUrl, marker.seconds, marker.end_seconds);
                        const player = post.getPlayer();
                        if (player) {
                            this.visibilityManager.registerPlayer(marker.id, player);
                            // Don't play here - let VisibilityManager handle it based on visibility
                        }
                        else {
                            console.warn('FeedContainer: Player not created', { markerId: marker.id });
                        }
                        loadObserver.disconnect();
                    }
                }
            }, { rootMargin } // Start loading earlier on mobile
            );
            loadObserver.observe(postContainer);
        }
        else {
            console.warn('FeedContainer: No video URL for marker', { markerId: marker.id });
        }
    }
    /**
     * Clear all posts
     */
    clearPosts() {
        for (const post of this.posts.values()) {
            post.destroy();
        }
        this.posts.clear();
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
    setupInfiniteScroll() {
        // Create a trigger element at the bottom of the feed
        this.loadMoreTrigger = document.createElement('div');
        this.loadMoreTrigger.className = 'load-more-trigger';
        this.loadMoreTrigger.style.height = '100px';
        this.loadMoreTrigger.style.width = '100%';
        // Append the trigger to the posts container so the filter bar stays intact
        if (this.postsContainer) {
            this.postsContainer.appendChild(this.loadMoreTrigger);
        }
        else {
            this.scrollContainer.appendChild(this.loadMoreTrigger);
        }
        // Use Intersection Observer to detect when trigger is visible
        this.scrollObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting && !this.isLoading && this.hasMore) {
                    this.loadVideos(undefined, true).catch((error) => {
                        console.error('Error loading more markers:', error);
                    });
                }
            });
        }, {
            root: null,
            rootMargin: '200px', // Start loading 200px before reaching the trigger
            threshold: 0.1,
        });
        if (this.loadMoreTrigger) {
            this.scrollObserver.observe(this.loadMoreTrigger);
        }
    }
    /**
     * Update infinite scroll trigger position
     */
    updateInfiniteScrollTrigger() {
        if (this.loadMoreTrigger && this.postsContainer) {
            // Ensure trigger is at the bottom of posts
            this.postsContainer.appendChild(this.loadMoreTrigger);
        }
    }
    /**
     * Autoplay the first N posts by force-loading and playing them
     */
    async autoplayInitial(count) {
        const initial = this.markers.slice(0, Math.min(count, this.markers.length));
        // Load all players first
        for (const marker of initial) {
            const post = this.posts.get(marker.id);
            if (!post)
                continue;
            const videoUrl = this.api.getMarkerVideoUrl(marker);
            if (!videoUrl || !isValidMediaUrl(videoUrl))
                continue;
            // Ensure player is created
            post.loadPlayer(videoUrl, marker.seconds, marker.end_seconds);
            const player = post.getPlayer();
            if (player) {
                // Register with visibility manager
                this.visibilityManager.registerPlayer(marker.id, player);
            }
        }
        // Wait a bit for players to initialize
        await new Promise((r) => setTimeout(r, 100));
        // Now attempt to play with robust retry logic
        for (const marker of initial) {
            const post = this.posts.get(marker.id);
            if (!post)
                continue;
            const player = post.getPlayer();
            if (!player)
                continue;
            // Robust play with multiple retries
            const tryPlay = async (attempt = 1, maxAttempts = 5) => {
                try {
                    // Wait for video to be ready
                    await player.waitUntilCanPlay(5000);
                    // Small delay to ensure layout/visibility settles
                    await new Promise((r) => setTimeout(r, 100));
                    // Attempt to play
                    await player.play();
                }
                catch (e) {
                    console.warn(`Autoplay initial attempt ${attempt} failed for marker ${marker.id}`, e);
                    if (attempt < maxAttempts) {
                        // Exponential backoff: 200ms, 400ms, 800ms, 1600ms
                        const delay = Math.min(200 * Math.pow(2, attempt - 1), 1600);
                        await new Promise((r) => setTimeout(r, delay));
                        await tryPlay(attempt + 1, maxAttempts);
                    }
                    else {
                        console.error(`Autoplay initial: All attempts failed for marker ${marker.id}`);
                    }
                }
            };
            // Start playing attempt (don't await to allow parallel attempts)
            tryPlay().catch(() => { });
        }
    }
    /**
     * Setup scroll handler
     */
    setupScrollHandler() {
        let lastTop = 0;
        const handleScroll = throttle(() => {
            const top = (typeof window !== 'undefined' && typeof window.scrollY === 'number')
                ? window.scrollY
                : this.scrollContainer.scrollTop;
            if (!this.headerBar)
                return;
            const delta = top - lastTop;
            const scrollingDown = delta > 2;
            const scrollingUp = delta < -2;
            if (scrollingDown && top > 8) {
                this.headerBar.style.opacity = '0';
                this.headerBar.style.transform = 'translateY(-100%)';
            }
            else if (scrollingUp || top <= 8) {
                this.headerBar.style.opacity = '1';
                this.headerBar.style.transform = 'translateY(0)';
            }
            lastTop = top;
        }, 70);
        // Listen to both window and container scrolling to cover all layouts
        window.addEventListener('scroll', handleScroll, { passive: true });
        this.scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    }
    /**
     * Show loading indicator
     */
    showLoading() {
        let loading = this.container.querySelector('.feed-loading');
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
    hideLoading() {
        const loading = this.container.querySelector('.feed-loading');
        if (loading) {
            loading.style.display = 'none';
        }
    }
    /**
     * Show error message
     */
    showError(message) {
        let error = this.container.querySelector('.feed-error');
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
    updateSettings(newSettings) {
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
    getSettings() {
        return { ...this.settings };
    }
    /**
     * Cleanup
     */
    cleanup() {
        this.visibilityManager.cleanup();
        this.clearPosts();
    }
}
//# sourceMappingURL=FeedContainer.js.map