/**
 * Feed Container
 * Main application container managing the feed
 */

import { Scene, FilterOptions, FeedSettings, VideoPostData } from './types';
import { StashAPI } from './StashAPI';
import { VideoPost } from './VideoPost';
import { VisibilityManager } from './VisibilityManager';
import { throttle } from './utils';

const DEFAULT_SETTINGS: FeedSettings = {
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
  private container: HTMLElement;
  private scrollContainer: HTMLElement;
  private api: StashAPI;
  private visibilityManager: VisibilityManager;
  private posts: Map<string, VideoPost>;
  private settings: FeedSettings;
  private scenes: Scene[];
  private isLoading: boolean = false;
  private currentFilters?: FilterOptions;

  constructor(container: HTMLElement, api?: StashAPI, settings?: Partial<FeedSettings>) {
    this.container = container;
    this.api = api || new StashAPI();
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.posts = new Map();
    this.scenes = [];

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
  }

  /**
   * Initialize the feed
   */
  async init(filters?: FilterOptions): Promise<void> {
    this.currentFilters = filters;
    await this.loadVideos(filters);
  }

  /**
   * Load videos from Stash
   */
  async loadVideos(filters?: FilterOptions): Promise<void> {
    if (this.isLoading) {
      return;
    }

    this.isLoading = true;
    this.showLoading();

    try {
      const scenes = await this.api.fetchScenes(filters || this.currentFilters);
      this.scenes = scenes;

      // Clear existing posts
      this.clearPosts();

      // Create posts for each scene
      for (const scene of scenes) {
        await this.createPost(scene);
      }

      this.hideLoading();
    } catch (error) {
      console.error('Error loading videos:', error);
      this.showError('Failed to load videos');
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Create a video post
   */
  private async createPost(scene: Scene): Promise<void> {
    const postContainer = document.createElement('article');
    postContainer.className = 'video-post-wrapper';

    const videoUrl = this.api.getVideoUrl(scene);
    const thumbnailUrl = this.api.getThumbnailUrl(scene);

    const postData: VideoPostData = {
      scene,
      videoUrl,
      thumbnailUrl,
    };

    const post = new VideoPost(postContainer, postData);
    this.posts.set(scene.id, post);

    // Add to scroll container
    this.scrollContainer.appendChild(postContainer);

    // Observe for visibility
    this.visibilityManager.observePost(postContainer, scene.id);

    // Load video when it becomes visible (lazy loading)
    if (videoUrl) {
      // Use Intersection Observer to load video when near viewport
      const loadObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              post.loadPlayer(videoUrl);
              this.visibilityManager.registerPlayer(scene.id, post.getPlayer()!);
              loadObserver.disconnect();
            }
          }
        },
        { rootMargin: '200px' }
      );
      loadObserver.observe(postContainer);
    }
  }

  /**
   * Clear all posts
   */
  private clearPosts(): void {
    for (const post of this.posts.values()) {
      post.destroy();
    }
    this.posts.clear();
    this.scrollContainer.innerHTML = '';
  }

  /**
   * Setup scroll handler
   */
  private setupScrollHandler(): void {
    const handleScroll = throttle(() => {
      // Scroll handling can be used for additional features
      // like infinite scroll, etc.
    }, 100);

    this.scrollContainer.addEventListener('scroll', handleScroll);
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

