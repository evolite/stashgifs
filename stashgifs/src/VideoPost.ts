/**
 * Video Post Component
 * Individual video post card in the feed
 */

import { VideoPostData } from './types.js';
import { NativeVideoPlayer } from './NativeVideoPlayer.js';
import { FavoritesManager } from './FavoritesManager.js';
import { StashAPI } from './StashAPI.js';
import { escapeHtml, formatDuration, calculateAspectRatio, getAspectRatioClass, isValidMediaUrl, showToast } from './utils.js';

export class VideoPost {
  private container: HTMLElement;
  private data: VideoPostData;
  private player?: NativeVideoPlayer;
  private thumbnailUrl?: string;
  private isLoaded: boolean = false;
  private favoritesManager?: FavoritesManager;
  private api?: StashAPI;
  private heartButton?: HTMLElement;
  private oCountButton?: HTMLElement;
  private isFavorite: boolean = false;
  private oCount: number = 0;

  constructor(container: HTMLElement, data: VideoPostData, favoritesManager?: FavoritesManager, api?: StashAPI) {
    this.container = container;
    this.data = data;
    this.thumbnailUrl = data.thumbnailUrl;
    this.favoritesManager = favoritesManager;
    this.api = api;
    this.oCount = this.data.marker.scene.o_counter || 0;

    this.render();
    this.checkFavoriteStatus();
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
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'space-between'; // Push buttons to right, chips to left
    row.style.gap = '12px'; // Spacing between chips and button group

    // Button group container for right-aligned buttons
    const buttonGroup = document.createElement('div');
    buttonGroup.style.display = 'flex';
    buttonGroup.style.alignItems = 'center';
    buttonGroup.style.gap = '4px'; // Tight spacing between buttons

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
    // Heart button for favorites (if FavoritesManager is available) - placed before play button
    if (this.favoritesManager) {
      const heartBtn = this.createHeartButton();
      buttonGroup.appendChild(heartBtn);
    }

    // O count button with splashing emoji - placed before play button
    if (this.api) {
      const oCountBtn = this.createOCountButton();
      buttonGroup.appendChild(oCountBtn);
    }

    // Icon-only button to open full scene in Stash - styled to match heart/o-count buttons
    const sceneLink = this.getSceneLink();
    const iconBtn = document.createElement('a');
    iconBtn.className = 'icon-btn icon-btn--play';
    iconBtn.href = sceneLink;
    iconBtn.target = '_blank';
    iconBtn.rel = 'noopener noreferrer';
    iconBtn.setAttribute('aria-label', 'View full scene');
    iconBtn.style.background = 'transparent';
    iconBtn.style.border = 'none';
    iconBtn.style.cursor = 'pointer';
    iconBtn.style.padding = '4px';
    iconBtn.style.display = 'flex';
    iconBtn.style.alignItems = 'center';
    iconBtn.style.justifyContent = 'center';
    iconBtn.style.color = 'rgba(255, 255, 255, 0.7)';
    iconBtn.style.transition = 'color 0.2s ease, transform 0.2s ease';
    iconBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
    
    // Hover effect to match other buttons
    iconBtn.addEventListener('mouseenter', () => {
      iconBtn.style.transform = 'scale(1.1)';
    });
    iconBtn.addEventListener('mouseleave', () => {
      iconBtn.style.transform = 'scale(1)';
    });
    
    buttonGroup.appendChild(iconBtn);

    // Add chips first (left-aligned), then button group (right-aligned)
    row.appendChild(chips);
    row.appendChild(buttonGroup);

    info.appendChild(row);
    footer.appendChild(info);
    return footer;
  }

  private createHeartButton(): HTMLElement {
    const heartBtn = document.createElement('button');
    heartBtn.className = 'icon-btn icon-btn--heart';
    heartBtn.type = 'button';
    heartBtn.setAttribute('aria-label', 'Toggle favorite');
    heartBtn.style.background = 'transparent';
    heartBtn.style.border = 'none';
    heartBtn.style.cursor = 'pointer';
    heartBtn.style.padding = '4px';
    heartBtn.style.display = 'flex';
    heartBtn.style.alignItems = 'center';
    heartBtn.style.justifyContent = 'center';
    heartBtn.style.color = 'rgba(255, 255, 255, 0.7)';
    heartBtn.style.transition = 'color 0.2s ease, transform 0.2s ease';
    
    // Heart SVG - outline version
    const heartSvg = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
    </svg>`;
    
    // Heart SVG - filled version
    const heartSvgFilled = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
    </svg>`;

    this.updateHeartButton(heartBtn, heartSvg, heartSvgFilled);

    heartBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (!this.favoritesManager) return;

      // Disable button during operation
      heartBtn.disabled = true;
      heartBtn.style.opacity = '0.5';

      try {
        const newFavoriteState = await this.favoritesManager.toggleFavorite(this.data.marker);
        this.isFavorite = newFavoriteState;
        
        // Update local marker tags to reflect the change
        const favoriteTagName = 'StashGifs Favorite';
        if (!this.data.marker.tags) {
          this.data.marker.tags = [];
        }
        
        if (newFavoriteState) {
          // Add favorite tag if not present
          if (!this.data.marker.tags.some(tag => tag.name === favoriteTagName)) {
            // We don't have the tag ID, but we can add a placeholder or fetch it
            // For now, just mark as favorite - the tag will be there on server
            this.data.marker.tags.push({ id: '', name: favoriteTagName });
          }
        } else {
          // Remove favorite tag
          this.data.marker.tags = this.data.marker.tags.filter(
            tag => tag.name !== favoriteTagName
          );
        }
        
        this.updateHeartButton(heartBtn, heartSvg, heartSvgFilled);
      } catch (error) {
        console.error('Failed to toggle favorite', error);
        // Revert UI state
        this.isFavorite = !this.isFavorite;
        this.updateHeartButton(heartBtn, heartSvg, heartSvgFilled);
      } finally {
        heartBtn.disabled = false;
        heartBtn.style.opacity = '1';
      }
    });

    // Hover effect
    heartBtn.addEventListener('mouseenter', () => {
      if (!heartBtn.disabled) {
        heartBtn.style.transform = 'scale(1.1)';
      }
    });
    heartBtn.addEventListener('mouseleave', () => {
      heartBtn.style.transform = 'scale(1)';
    });

    this.heartButton = heartBtn;
    return heartBtn;
  }

  private updateHeartButton(button: HTMLElement, outlineSvg: string, filledSvg: string): void {
    if (this.isFavorite) {
      button.innerHTML = filledSvg;
      button.style.color = '#ff6b9d';
    } else {
      button.innerHTML = outlineSvg;
      button.style.color = 'rgba(255, 255, 255, 0.7)';
    }
  }

  private createOCountButton(): HTMLElement {
    const oCountBtn = document.createElement('button');
    oCountBtn.className = 'icon-btn icon-btn--ocount';
    oCountBtn.type = 'button';
    oCountBtn.setAttribute('aria-label', 'Increment o count');
    oCountBtn.style.background = 'transparent';
    oCountBtn.style.border = 'none';
    oCountBtn.style.cursor = 'pointer';
    oCountBtn.style.padding = '4px 8px';
    oCountBtn.style.display = 'flex';
    oCountBtn.style.alignItems = 'center';
    oCountBtn.style.justifyContent = 'center';
    oCountBtn.style.gap = '4px';
    oCountBtn.style.color = 'rgba(255, 255, 255, 0.7)';
    oCountBtn.style.transition = 'color 0.2s ease, transform 0.2s ease';
    oCountBtn.style.fontSize = '16px';
    
    // Splashing emoji 💦
    const emoji = '💦';
    
    // Count display
    const countSpan = document.createElement('span');
    countSpan.style.fontSize = '14px';
    countSpan.style.fontWeight = '500';
    countSpan.textContent = this.oCount > 0 ? this.oCount.toString() : '';
    
    oCountBtn.innerHTML = emoji;
    if (this.oCount > 0) {
      oCountBtn.appendChild(countSpan);
    }
    
    this.oCountButton = oCountBtn;
    this.updateOCountButton();

    oCountBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (!this.api) return;

      // Disable button during operation
      oCountBtn.disabled = true;
      oCountBtn.style.opacity = '0.5';

      try {
        const result = await this.api.incrementOCount(this.data.marker.scene.id);
        this.oCount = result.count;
        
        // Update local scene data
        this.data.marker.scene.o_counter = result.count;
        
        this.updateOCountButton();
      } catch (error) {
        console.error('Failed to increment o count', error);
      } finally {
        oCountBtn.disabled = false;
        oCountBtn.style.opacity = '1';
      }
    });

    // Hover effect
    oCountBtn.addEventListener('mouseenter', () => {
      if (!oCountBtn.disabled) {
        oCountBtn.style.transform = 'scale(1.1)';
      }
    });
    oCountBtn.addEventListener('mouseleave', () => {
      oCountBtn.style.transform = 'scale(1)';
    });

    return oCountBtn;
  }

  private updateOCountButton(): void {
    if (!this.oCountButton) return;
    
    const emoji = '💦';
    
    // Clear existing content
    this.oCountButton.innerHTML = emoji;
    
    // Add count if > 0
    if (this.oCount > 0) {
      const countSpan = document.createElement('span');
      countSpan.style.fontSize = '14px';
      countSpan.style.fontWeight = '500';
      countSpan.textContent = this.oCount.toString();
      this.oCountButton.appendChild(countSpan);
    }
  }

  private async checkFavoriteStatus(): Promise<void> {
    if (!this.favoritesManager) return;

    try {
      // Check if marker has the favorite tag in its tags array
      const favoriteTagName = 'StashGifs Favorite';
      const hasFavoriteTag = this.data.marker.tags?.some(
        tag => tag.name === favoriteTagName
      ) || false;

      this.isFavorite = hasFavoriteTag;

      // Update heart button if it exists
      if (this.heartButton) {
        const outlineSvg = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>`;
        const filledSvg = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>`;
        this.updateHeartButton(this.heartButton, outlineSvg, filledSvg);
      }
    } catch (error) {
      console.error('Failed to check favorite status', error);
    }
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

