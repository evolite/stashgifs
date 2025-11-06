/**
 * Feed Container
 * Main application container managing the feed
 */
import { StashAPI } from './StashAPI.js';
import { VideoPost } from './VideoPost.js';
import { VisibilityManager } from './VisibilityManager.js';
import { throttle } from './utils.js';
const DEFAULT_SETTINGS = {
    autoPlay: false,
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
        // Initialize visibility manager
        this.visibilityManager = new VisibilityManager({
            threshold: this.settings.autoPlayThreshold,
            autoPlay: this.settings.autoPlay,
            maxConcurrent: this.settings.maxConcurrentVideos,
        });
        // Setup scroll handler
        this.setupScrollHandler();
        // Setup infinite scroll
        this.setupInfiniteScroll();
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
            console.log('FeedContainer: Fetching scene markers...', { ...currentFilters, page });
            const markers = await this.api.fetchSceneMarkers({
                ...currentFilters,
                limit: currentFilters.limit || 20,
                offset: append ? (page - 1) * (currentFilters.limit || 20) : 0,
            });
            console.log('FeedContainer: Received markers', markers.length);
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
        const postContainer = document.createElement('article');
        postContainer.className = 'video-post-wrapper';
        const videoUrl = this.api.getMarkerVideoUrl(marker);
        const thumbnailUrl = this.api.getMarkerThumbnailUrl(marker);
        const postData = {
            marker,
            videoUrl,
            thumbnailUrl,
            startTime: marker.seconds,
            endTime: marker.end_seconds,
        };
        const post = new VideoPost(postContainer, postData);
        this.posts.set(marker.id, post);
        // Add to scroll container
        this.scrollContainer.appendChild(postContainer);
        // Observe for visibility
        this.visibilityManager.observePost(postContainer, marker.id);
        // Load video when it becomes visible (lazy loading)
        if (videoUrl) {
            // Use Intersection Observer to load video when near viewport
            const loadObserver = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        post.loadPlayer(videoUrl, marker.seconds, marker.end_seconds);
                        this.visibilityManager.registerPlayer(marker.id, post.getPlayer());
                        loadObserver.disconnect();
                    }
                }
            }, { rootMargin: '200px' });
            loadObserver.observe(postContainer);
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
        this.scrollContainer.innerHTML = '';
        // Recreate load more trigger
        if (this.loadMoreTrigger) {
            this.scrollContainer.appendChild(this.loadMoreTrigger);
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
        this.scrollContainer.appendChild(this.loadMoreTrigger);
        // Use Intersection Observer to detect when trigger is visible
        this.scrollObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting && !this.isLoading && this.hasMore) {
                    console.log('Load more triggered');
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
        if (this.loadMoreTrigger && this.scrollContainer) {
            // Ensure trigger is at the bottom
            this.scrollContainer.appendChild(this.loadMoreTrigger);
        }
    }
    /**
     * Setup scroll handler
     */
    setupScrollHandler() {
        const handleScroll = throttle(() => {
            // Scroll handling can be used for additional features
            // like infinite scroll, etc.
        }, 100);
        this.scrollContainer.addEventListener('scroll', handleScroll);
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