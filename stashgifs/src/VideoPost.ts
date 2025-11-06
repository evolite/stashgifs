/**
 * Video Post Component
 * Individual video post card in the feed
 */

import { VideoPostData } from './types.js';
import { NativeVideoPlayer } from './NativeVideoPlayer.js';
import { escapeHtml, formatDuration, calculateAspectRatio, getAspectRatioClass, isValidMediaUrl } from './utils.js';

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
    this.container.dataset.postId = this.data.marker.id;
    this.container.innerHTML = '';

    // Player container
    const playerContainer = this.createPlayerContainer();
    this.container.appendChild(playerContainer);

    // Footer
    const footer = this.createFooter();
    this.container.appendChild(footer);
  }

  private createPlayerContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'video-post__player';
    container.style.position = 'relative';

    // Calculate aspect ratio
    let aspectRatioClass = 'aspect-16-9';
    if (this.data.marker.scene.files && this.data.marker.scene.files.length > 0) {
      const file = this.data.marker.scene.files[0];
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
      thumbnail.alt = this.data.marker.title || 'Video thumbnail';
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

    const info = document.createElement('div');
    info.className = 'video-post__info';

    // Row: performers chips + icon button link (inline)
    const row = document.createElement('div');
    row.className = 'video-post__row';

    const chips = document.createElement('div');
    chips.className = 'chips';
    if (this.data.marker.scene.performers && this.data.marker.scene.performers.length > 0) {
      for (const performer of this.data.marker.scene.performers) {
        const chip = document.createElement('a');
        chip.className = 'chip';
        chip.href = this.getPerformerLink(performer.id);
        chip.target = '_blank';
        chip.rel = 'noopener noreferrer';
        if (performer.image_path) {
          const avatar = document.createElement('img');
          avatar.className = 'chip__avatar';
          avatar.src = performer.image_path.startsWith('http') ? performer.image_path : `${window.location.origin}${performer.image_path}`;
          avatar.alt = performer.name;
          chip.appendChild(avatar);
        }
        chip.appendChild(document.createTextNode(performer.name));
        chips.appendChild(chip);
      }
    }

    // Tag chip: show only the primary tag if available; otherwise show nothing
    if (this.data.marker.primary_tag && this.data.marker.primary_tag.id && this.data.marker.primary_tag.name) {
      const tag = this.data.marker.primary_tag;
      const chip = document.createElement('a');
      chip.className = 'chip chip--tag';
      chip.href = this.getTagLink(tag.id);
      chip.target = '_blank';
      chip.rel = 'noopener noreferrer';
      chip.appendChild(document.createTextNode(tag.name));
      chips.appendChild(chip);
    }
    row.appendChild(chips);

    // Icon-only button to open full scene in Stash
    const sceneLink = this.getSceneLink();
    const iconBtn = document.createElement('a');
    iconBtn.className = 'icon-btn icon-btn--primary';
    iconBtn.href = sceneLink;
    iconBtn.target = '_blank';
    iconBtn.rel = 'noopener noreferrer';
    iconBtn.setAttribute('aria-label', 'View full scene');
    iconBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
    row.appendChild(iconBtn);

    info.appendChild(row);
    footer.appendChild(info);
    return footer;
  }

  private getSceneLink(): string {
    const s = this.data.marker.scene;
    // Link to the local Stash scene route with timestamp set to marker start seconds
    const t = Math.max(0, Math.floor(this.data.marker.seconds || 0));
    return `${window.location.origin}/scenes/${s.id}?t=${t}`;
  }

  private getPerformerLink(performerId: string): string {
    return `${window.location.origin}/performers/${performerId}`;
  }

  private getTagLink(tagId: string): string {
    return `${window.location.origin}/tags/${tagId}`;
  }

  /**
   * Load the video player
   */
  loadPlayer(videoUrl: string, startTime?: number, endTime?: number): void {
    if (this.isLoaded || !videoUrl) {
      return;
    }

    const playerContainer = this.container.querySelector('.video-post__player') as HTMLElement;
    if (!playerContainer) {
      return;
    }

    if (!isValidMediaUrl(videoUrl)) {
      console.warn('VideoPost: Invalid media URL, skipping player creation', { videoUrl });
      return;
    }

    this.player = new NativeVideoPlayer(playerContainer, videoUrl, {
      muted: true, // Always muted for autoplay
      autoplay: false, // Will be controlled by VisibilityManager
      startTime: startTime || this.data.startTime,
      endTime: endTime || this.data.endTime,
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
    return this.data.marker.id;
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

