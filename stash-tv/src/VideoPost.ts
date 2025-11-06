/**
 * Video Post Component
 * Individual video post card in the feed
 */

import { VideoPostData, Scene } from './types';
import { NativeVideoPlayer } from './NativeVideoPlayer';
import { escapeHtml, formatDuration, calculateAspectRatio, getAspectRatioClass } from './utils';

export class VideoPost {
  private container: HTMLElement;
  private data: VideoPostData;
  private player?: NativeVideoPlayer;
  private thumbnailUrl?: string;
  private isLoaded: boolean = false;

  constructor(container: HTMLElement, data: VideoPostData) {
    this.container = container;
    this.data = data;
    this.thumbnailUrl = data.thumbnailUrl;

    this.render();
  }

  private render(): void {
    this.container.className = 'video-post';
    this.container.dataset.postId = this.data.scene.id;
    this.container.innerHTML = '';

    // Header
    const header = this.createHeader();
    this.container.appendChild(header);

    // Player container
    const playerContainer = this.createPlayerContainer();
    this.container.appendChild(playerContainer);

    // Footer
    const footer = this.createFooter();
    this.container.appendChild(footer);
  }

  private createHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'video-post__header';

    if (this.data.scene.title) {
      const title = document.createElement('h3');
      title.className = 'video-post__title';
      title.textContent = this.data.scene.title;
      header.appendChild(title);
    }

    if (this.data.scene.date) {
      const date = document.createElement('span');
      date.className = 'video-post__date';
      date.textContent = new Date(this.data.scene.date).toLocaleDateString();
      header.appendChild(date);
    }

    return header;
  }

  private createPlayerContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'video-post__player';

    // Calculate aspect ratio
    let aspectRatioClass = 'aspect-16-9';
    if (this.data.scene.files && this.data.scene.files.length > 0) {
      const file = this.data.scene.files[0];
      if (file.width && file.height) {
        const ratio = calculateAspectRatio(file.width, file.height);
        aspectRatioClass = getAspectRatioClass(ratio);
      }
    }
    container.classList.add(aspectRatioClass);

    // Thumbnail/poster
    if (this.thumbnailUrl) {
      const thumbnail = document.createElement('img');
      thumbnail.className = 'video-post__thumbnail';
      thumbnail.src = this.thumbnailUrl;
      thumbnail.alt = this.data.scene.title || 'Video thumbnail';
      thumbnail.style.display = this.isLoaded ? 'none' : 'block';
      container.appendChild(thumbnail);
    }

    // Loading indicator
    const loading = document.createElement('div');
    loading.className = 'video-post__loading';
    loading.innerHTML = '<div class="spinner"></div>';
    loading.style.display = this.isLoaded ? 'none' : 'flex';
    container.appendChild(loading);

    return container;
  }

  private createFooter(): HTMLElement {
    const footer = document.createElement('div');
    footer.className = 'video-post__footer';

    // Scene info
    const info = document.createElement('div');
    info.className = 'video-post__info';

    // Performers
    if (this.data.scene.performers && this.data.scene.performers.length > 0) {
      const performers = document.createElement('div');
      performers.className = 'video-post__performers';
      const performerNames = this.data.scene.performers.map(p => escapeHtml(p.name)).join(', ');
      performers.innerHTML = `<strong>Performers:</strong> ${performerNames}`;
      info.appendChild(performers);
    }

    // Studio
    if (this.data.scene.studio) {
      const studio = document.createElement('div');
      studio.className = 'video-post__studio';
      studio.innerHTML = `<strong>Studio:</strong> ${escapeHtml(this.data.scene.studio.name)}`;
      info.appendChild(studio);
    }

    // Duration
    if (this.data.scene.files && this.data.scene.files.length > 0 && this.data.scene.files[0].duration) {
      const duration = document.createElement('div');
      duration.className = 'video-post__duration';
      duration.textContent = `Duration: ${formatDuration(this.data.scene.files[0].duration)}`;
      info.appendChild(duration);
    }

    // Tags
    if (this.data.scene.tags && this.data.scene.tags.length > 0) {
      const tags = document.createElement('div');
      tags.className = 'video-post__tags';
      const tagNames = this.data.scene.tags.slice(0, 5).map(t => escapeHtml(t.name)).join(', ');
      tags.innerHTML = `<strong>Tags:</strong> ${tagNames}${this.data.scene.tags.length > 5 ? '...' : ''}`;
      info.appendChild(tags);
    }

    footer.appendChild(info);

    return footer;
  }

  /**
   * Load the video player
   */
  loadPlayer(videoUrl: string): void {
    if (this.isLoaded || !videoUrl) {
      return;
    }

    const playerContainer = this.container.querySelector('.video-post__player') as HTMLElement;
    if (!playerContainer) {
      return;
    }

    this.player = new NativeVideoPlayer(playerContainer, videoUrl, {
      muted: false,
      autoplay: false,
    });

    // Hide thumbnail and loading
    const thumbnail = playerContainer.querySelector('.video-post__thumbnail') as HTMLElement;
    const loading = playerContainer.querySelector('.video-post__loading') as HTMLElement;
    if (thumbnail) thumbnail.style.display = 'none';
    if (loading) loading.style.display = 'none';

    this.isLoaded = true;
  }

  /**
   * Get the video player instance
   */
  getPlayer(): NativeVideoPlayer | undefined {
    return this.player;
  }

  /**
   * Get the post ID
   */
  getPostId(): string {
    return this.data.scene.id;
  }

  /**
   * Get the container element
   */
  getContainer(): HTMLElement {
    return this.container;
  }

  /**
   * Destroy the post
   */
  destroy(): void {
    if (this.player) {
      this.player.destroy();
    }
    this.container.remove();
  }
}

