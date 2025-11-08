/**
 * Video Post Component
 * Individual video post card in the feed
 */

import { VideoPostData } from './types.js';
import { NativeVideoPlayer } from './NativeVideoPlayer.js';
import { FavoritesManager } from './FavoritesManager.js';
import { StashAPI } from './StashAPI.js';
import { VisibilityManager } from './VisibilityManager.js';
import { calculateAspectRatio, getAspectRatioClass, isValidMediaUrl, showToast, throttle } from './utils.js';

// Constants for magic numbers and strings
const FAVORITE_TAG_NAME = 'StashGifs Favorite';
const RATING_MAX_STARS = 10;
const RATING_MIN_STARS = 0;
const RATING_DIALOG_MAX_WIDTH = 900;
const RATING_DIALOG_MIN_WIDTH = 200;
const RATING_DIALOG_DEFAULT_PADDING = 32;
const RATING_DIALOG_MIN_PADDING = 16;
const OCOUNT_DIGIT_WIDTH_PX = 8; // Approximate pixels per digit for 14px font
const OCOUNT_MIN_WIDTH_PX = 14;
const OCOUNT_THREE_DIGIT_PADDING = 10;
const OCOUNT_DEFAULT_PADDING = 8;
const RESIZE_THROTTLE_MS = 100;

// SVG Constants
const HEART_SVG_OUTLINE = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
</svg>`;

const HEART_SVG_FILLED = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
</svg>`;

const HQ_SVG_OUTLINE = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="4" y="6" width="16" height="12" rx="2"/>
  <path d="M8 10h8M8 14h8" stroke-width="1.5"/>
  <text x="12" y="15" font-size="7" font-weight="bold" fill="currentColor" text-anchor="middle" font-family="Arial, sans-serif">HD</text>
</svg>`;

const HQ_SVG_FILLED = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
  <rect x="4" y="6" width="16" height="12" rx="2"/>
  <text x="12" y="15" font-size="7" font-weight="bold" fill="white" text-anchor="middle" font-family="Arial, sans-serif">HD</text>
</svg>`;

const PLAY_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

const STAR_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" focusable="false">
  <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.62L12 2 9.19 8.62 2 9.24l5.46 4.73L5.82 21z"/>
</svg>`;

interface HoverHandlers {
  mouseenter: () => void;
  mouseleave: () => void;
}

export class VideoPost {
  private container: HTMLElement;
  private data: VideoPostData;
  private player?: NativeVideoPlayer;
  private thumbnailUrl?: string;
  private isLoaded: boolean = false;
  private favoritesManager?: FavoritesManager;
  private api?: StashAPI;
  private visibilityManager?: VisibilityManager;
  private heartButton?: HTMLElement;
  private oCountButton?: HTMLElement;
  private hqButton?: HTMLElement;
  private playButton?: HTMLElement;
  private isFavorite: boolean = false;
  private oCount: number = 0;
  private isHQMode: boolean = false;
  private ratingValue: number = 0;
  private hasRating: boolean = false;
  private ratingWrapper?: HTMLElement;
  private ratingDisplayButton?: HTMLButtonElement;
  private ratingDisplayValue?: HTMLElement;
  private ratingDialog?: HTMLElement;
  private ratingStarButtons: HTMLButtonElement[] = [];
  private isRatingDialogOpen: boolean = false;
  private isSavingRating: boolean = false;
  private isTogglingFavorite: boolean = false;
  
  // Event handlers for cleanup
  private ratingOutsideClickHandler = (event: Event) => this.onRatingOutsideClick(event);
  private ratingKeydownHandler = (event: KeyboardEvent) => this.onRatingKeydown(event);
  private ratingResizeHandler: () => void;
  private hoverHandlers: Map<HTMLElement, HoverHandlers> = new Map();
  
  // Cached DOM elements
  private playerContainer?: HTMLElement;
  private footer?: HTMLElement;

  constructor(container: HTMLElement, data: VideoPostData, favoritesManager?: FavoritesManager, api?: StashAPI, visibilityManager?: VisibilityManager) {
    this.container = container;
    this.data = data;
    this.thumbnailUrl = data.thumbnailUrl;
    this.favoritesManager = favoritesManager;
    this.api = api;
    this.visibilityManager = visibilityManager;
    this.oCount = this.data.marker.scene.o_counter || 0;
    this.ratingValue = this.convertRating100ToStars(this.data.marker.scene.rating100);
    this.hasRating = typeof this.data.marker.scene.rating100 === 'number' && !Number.isNaN(this.data.marker.scene.rating100);
    
    // Throttle resize handler for performance
    this.ratingResizeHandler = throttle(() => this.syncRatingDialogLayout(), RESIZE_THROTTLE_MS);

    this.render();
    this.checkFavoriteStatus();
  }

  /**
   * Render the complete video post structure
   */
  private render(): void {
    this.container.className = 'video-post';
    this.container.dataset.postId = this.data.marker.id;
    this.container.innerHTML = '';

    // Header with performers and tags
    const header = this.createHeader();
    this.container.appendChild(header);

    // Player container
    const playerContainer = this.createPlayerContainer();
    this.container.appendChild(playerContainer);
    this.playerContainer = playerContainer;

    // Footer with buttons and rating
    const footer = this.createFooter();
    this.container.appendChild(footer);
    this.footer = footer;
  }

  /**
   * Create the player container with thumbnail and loading indicator
   */
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

  /**
   * Create header with performer and tag chips
   */
  private createHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'video-post__header';
    header.style.padding = '0';
    header.style.marginBottom = '4px';
    header.style.borderBottom = 'none';

    const chips = document.createElement('div');
    chips.className = 'chips';
    chips.style.display = 'flex';
    chips.style.flexWrap = 'wrap';
    chips.style.gap = '6px';
    chips.style.margin = '0';
    chips.style.padding = '4px 0'; // Match footer vertical padding for uniform height
    
    // Add performer chips
    if (this.data.marker.scene.performers && this.data.marker.scene.performers.length > 0) {
      for (const performer of this.data.marker.scene.performers) {
        const chip = this.createPerformerChip(performer);
        chips.appendChild(chip);
      }
    }

    // Add tag chip: show only the primary tag if available
    if (this.data.marker.primary_tag && this.data.marker.primary_tag.id && this.data.marker.primary_tag.name) {
      const chip = this.createTagChip(this.data.marker.primary_tag);
      chips.appendChild(chip);
    }

    header.appendChild(chips);
    return header;
  }

  /**
   * Create a performer chip element
   */
  private createPerformerChip(performer: { id: string; name: string; image_path?: string }): HTMLElement {
    const chip = document.createElement('a');
    chip.className = 'chip';
    chip.href = this.getPerformerLink(performer.id);
    chip.target = '_blank';
    chip.rel = 'noopener noreferrer';
    chip.style.padding = '4px 8px';
    chip.style.fontSize = '0.75rem';
    chip.style.gap = '4px';
    
    if (performer.image_path) {
      const avatar = document.createElement('img');
      avatar.className = 'chip__avatar';
      avatar.src = performer.image_path.startsWith('http') ? performer.image_path : `${window.location.origin}${performer.image_path}`;
      avatar.alt = performer.name;
      avatar.style.width = '16px';
      avatar.style.height = '16px';
      chip.appendChild(avatar);
    }
    chip.appendChild(document.createTextNode(performer.name));
    return chip;
  }

  /**
   * Create a tag chip element
   */
  private createTagChip(tag: { id: string; name: string }): HTMLElement {
    const chip = document.createElement('a');
    chip.className = 'chip chip--tag';
    chip.href = this.getTagLink(tag.id);
    chip.target = '_blank';
    chip.rel = 'noopener noreferrer';
    chip.style.padding = '4px 8px';
    chip.style.fontSize = '0.75rem';
    chip.appendChild(document.createTextNode(tag.name));
    return chip;
  }

  /**
   * Create footer with action buttons
   */
  private createFooter(): HTMLElement {
    const footer = document.createElement('div');
    footer.className = 'video-post__footer';
    footer.style.padding = '4px 8px';

    const info = document.createElement('div');
    info.className = 'video-post__info';
    info.style.gap = '0';
    info.style.display = 'flex';
    info.style.flexDirection = 'row'; // Change from column to row for right alignment
    info.style.justifyContent = 'flex-end'; // Right-align the content

    const row = document.createElement('div');
    row.className = 'video-post__row';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'flex-end';
    row.style.gap = '2px';

    const buttonGroup = document.createElement('div');
    buttonGroup.style.display = 'flex';
    buttonGroup.style.alignItems = 'center';
    buttonGroup.style.gap = '2px';

    // Add buttons in order
    if (this.favoritesManager) {
      const heartBtn = this.createHeartButton();
      buttonGroup.appendChild(heartBtn);
    }

    if (this.api) {
      const oCountBtn = this.createOCountButton();
      buttonGroup.appendChild(oCountBtn);
    }

    const ratingControl = this.createRatingSection();
    buttonGroup.appendChild(ratingControl);

    if (this.api) {
      const hqBtn = this.createHQButton();
      buttonGroup.appendChild(hqBtn);
    }

    const playBtn = this.createPlayButton();
    buttonGroup.appendChild(playBtn);

    row.appendChild(buttonGroup);
    info.appendChild(row);
    footer.appendChild(info);
    return footer;
  }

  /**
   * Create play button to open scene in Stash
   */
  private createPlayButton(): HTMLElement {
    const sceneLink = this.getSceneLink();
    const iconBtn = document.createElement('a');
    iconBtn.className = 'icon-btn icon-btn--play';
    iconBtn.href = sceneLink;
    iconBtn.target = '_blank';
    iconBtn.rel = 'noopener noreferrer';
    iconBtn.setAttribute('aria-label', 'View full scene');
    this.applyIconButtonStyles(iconBtn);
    iconBtn.style.padding = '2px';
    iconBtn.style.width = 'auto';
    iconBtn.style.height = 'auto';
    iconBtn.style.minWidth = 'auto';
    iconBtn.style.minHeight = 'auto';
    iconBtn.innerHTML = PLAY_SVG;
    
    this.addHoverEffect(iconBtn);
    this.playButton = iconBtn;
    return iconBtn;
  }

  /**
   * Apply common icon button styles
   */
  private applyIconButtonStyles(button: HTMLElement): void {
    button.style.background = 'transparent';
    button.style.border = 'none';
    button.style.cursor = 'pointer';
    button.style.display = 'flex';
    button.style.alignItems = 'center';
    button.style.justifyContent = 'center';
    button.style.color = 'rgba(255, 255, 255, 0.7)';
    button.style.transition = 'color 0.2s ease, transform 0.2s ease';
  }

  /**
   * Add hover effect to a button element
   */
  private addHoverEffect(button: HTMLElement): void {
    const mouseenter = () => {
      if (!(button instanceof HTMLButtonElement) || !button.disabled) {
        button.style.transform = 'scale(1.1)';
      }
    };
    const mouseleave = () => {
      button.style.transform = 'scale(1)';
    };
    
    button.addEventListener('mouseenter', mouseenter);
    button.addEventListener('mouseleave', mouseleave);
    
    this.hoverHandlers.set(button, { mouseenter, mouseleave });
  }

  /**
   * Remove hover effect from a button element
   */
  private removeHoverEffect(button: HTMLElement): void {
    const handlers = this.hoverHandlers.get(button);
    if (handlers) {
      button.removeEventListener('mouseenter', handlers.mouseenter);
      button.removeEventListener('mouseleave', handlers.mouseleave);
      this.hoverHandlers.delete(button);
    }
  }

  /**
   * Create heart button for favorites
   */
  private createHeartButton(): HTMLElement {
    const heartBtn = document.createElement('button');
    heartBtn.className = 'icon-btn icon-btn--heart';
    heartBtn.type = 'button';
    heartBtn.setAttribute('aria-label', 'Toggle favorite');
    this.applyIconButtonStyles(heartBtn);
    heartBtn.style.padding = '4px';

    this.updateHeartButton(heartBtn);

    const clickHandler = async (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (!this.favoritesManager || this.isTogglingFavorite) return;

      this.isTogglingFavorite = true;
      heartBtn.disabled = true;
      heartBtn.style.opacity = '0.5';

      try {
        const newFavoriteState = await this.favoritesManager.toggleFavorite(this.data.marker);
        this.isFavorite = newFavoriteState;
        
        // Update local marker tags to reflect the change
        if (!this.data.marker.tags) {
          this.data.marker.tags = [];
        }
        
        if (newFavoriteState) {
          if (!this.data.marker.tags.some(tag => tag.name === FAVORITE_TAG_NAME)) {
            this.data.marker.tags.push({ id: '', name: FAVORITE_TAG_NAME });
          }
        } else {
          this.data.marker.tags = this.data.marker.tags.filter(
            tag => tag.name !== FAVORITE_TAG_NAME
          );
        }
        
        this.updateHeartButton(heartBtn);
      } catch (error) {
        console.error('Failed to toggle favorite', error);
        showToast('Failed to update favorite. Please try again.');
        // Revert UI state
        this.isFavorite = !this.isFavorite;
        this.updateHeartButton(heartBtn);
      } finally {
        this.isTogglingFavorite = false;
        heartBtn.disabled = false;
        heartBtn.style.opacity = '1';
      }
    };

    heartBtn.addEventListener('click', clickHandler);
    this.addHoverEffect(heartBtn);
    this.heartButton = heartBtn;
    return heartBtn;
  }

  /**
   * Update heart button appearance based on favorite state
   */
  private updateHeartButton(button: HTMLElement): void {
    if (this.isFavorite) {
      button.innerHTML = HEART_SVG_FILLED;
      button.style.color = '#ff6b9d';
    } else {
      button.innerHTML = HEART_SVG_OUTLINE;
      button.style.color = 'rgba(255, 255, 255, 0.7)';
    }
  }

  /**
   * Create O-count button
   */
  private createOCountButton(): HTMLElement {
    const oCountBtn = document.createElement('button');
    oCountBtn.className = 'icon-btn icon-btn--ocount';
    oCountBtn.type = 'button';
    oCountBtn.setAttribute('aria-label', 'Increment o count');
    this.applyIconButtonStyles(oCountBtn);
    oCountBtn.style.padding = '4px 8px';
    oCountBtn.style.gap = '6px';
    oCountBtn.style.fontSize = '16px';
    oCountBtn.style.width = 'auto';
    oCountBtn.style.minWidth = 'auto';
    
    oCountBtn.innerHTML = '💦';
    
    this.oCountButton = oCountBtn;
    this.updateOCountButton();

    const clickHandler = async (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (!this.api) return;

      oCountBtn.disabled = true;
      oCountBtn.style.opacity = '0.5';

      try {
        const result = await this.api.incrementOCount(this.data.marker.scene.id);
        this.oCount = result.count;
        this.data.marker.scene.o_counter = result.count;
        this.updateOCountButton();
      } catch (error) {
        console.error('Failed to increment o count', error);
        showToast('Failed to update o-count. Please try again.');
      } finally {
        oCountBtn.disabled = false;
        oCountBtn.style.opacity = '1';
      }
    };

    oCountBtn.addEventListener('click', clickHandler);
    this.addHoverEffect(oCountBtn);
    return oCountBtn;
  }

  /**
   * Update O-count button display
   */
  private updateOCountButton(): void {
    if (!this.oCountButton) return;
    
    const emoji = '💦';
    this.oCountButton.innerHTML = emoji;
    
    const digitCount = this.oCount > 0 ? this.oCount.toString().length : 0;
    const minWidth = digitCount > 0 ? `${Math.max(OCOUNT_MIN_WIDTH_PX, digitCount * OCOUNT_DIGIT_WIDTH_PX)}px` : `${OCOUNT_MIN_WIDTH_PX}px`;
    
    const countSpan = document.createElement('span');
    countSpan.style.fontSize = '14px';
    countSpan.style.fontWeight = '500';
    countSpan.style.minWidth = minWidth;
    countSpan.style.textAlign = 'left';
    countSpan.style.display = 'inline-block';
    countSpan.textContent = this.oCount > 0 ? this.oCount.toString() : '';
    this.oCountButton.appendChild(countSpan);
    
    if (digitCount >= 3) {
      this.oCountButton.style.paddingRight = `${OCOUNT_THREE_DIGIT_PADDING}px`;
    } else {
      this.oCountButton.style.paddingRight = `${OCOUNT_DEFAULT_PADDING}px`;
    }
  }

  /**
   * Create HQ button
   */
  private createHQButton(): HTMLElement {
    const hqBtn = document.createElement('button');
    hqBtn.className = 'icon-btn icon-btn--hq';
    hqBtn.type = 'button';
    hqBtn.setAttribute('aria-label', 'Load high-quality scene video with audio');
    this.applyIconButtonStyles(hqBtn);
    hqBtn.style.padding = '4px';

    this.updateHQButton(hqBtn);
    this.hqButton = hqBtn;

    const clickHandler = async (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (!this.api || this.isHQMode) return;

      hqBtn.disabled = true;
      hqBtn.style.opacity = '0.5';

      try {
        await this.upgradeToSceneVideo();
        this.isHQMode = true;
        this.updateHQButton(hqBtn);
      } catch (error) {
        console.error('Failed to upgrade to scene video', error);
        showToast('Failed to load high-quality video. Please try again.');
      } finally {
        hqBtn.disabled = false;
        hqBtn.style.opacity = '1';
      }
    };

    hqBtn.addEventListener('click', clickHandler);
    this.addHoverEffect(hqBtn);
    return hqBtn;
  }

  /**
   * Update HQ button appearance based on mode
   */
  private updateHQButton(button: HTMLElement): void {
    if (this.isHQMode) {
      button.innerHTML = HQ_SVG_FILLED;
      button.style.color = '#4CAF50';
    } else {
      button.innerHTML = HQ_SVG_OUTLINE;
      button.style.color = 'rgba(255, 255, 255, 0.7)';
    }
  }

  /**
   * Create rating section with dialog
   */
  private createRatingSection(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'rating-control';
    wrapper.setAttribute('data-role', 'rating');
    this.ratingWrapper = wrapper;

    const displayButton = this.createRatingDisplayButton();
    wrapper.appendChild(displayButton);

    const dialog = this.createRatingDialog();
    wrapper.appendChild(dialog);

    this.updateRatingDisplay();
    this.updateRatingStarButtons();

    return wrapper;
  }

  /**
   * Create rating display button
   */
  private createRatingDisplayButton(): HTMLElement {
    const displayButton = document.createElement('button');
    displayButton.type = 'button';
    displayButton.className = 'icon-btn icon-btn--rating';
    displayButton.setAttribute('aria-haspopup', 'dialog');
    displayButton.setAttribute('aria-expanded', 'false');
    this.applyIconButtonStyles(displayButton);
    displayButton.style.padding = '4px 8px';
    displayButton.style.gap = '6px';
    
    displayButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.isSavingRating) return;
      this.toggleRatingDialog();
    });
    
    this.addHoverEffect(displayButton);
    this.ratingDisplayButton = displayButton;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'rating-display__icon';
    iconSpan.innerHTML = STAR_SVG;

    const valueSpan = document.createElement('span');
    valueSpan.className = 'rating-display__value';
    valueSpan.style.fontSize = '14px';
    valueSpan.style.fontWeight = '500';
    valueSpan.style.minWidth = '14px';
    valueSpan.style.textAlign = 'left';
    this.ratingDisplayValue = valueSpan;

    displayButton.appendChild(iconSpan);
    displayButton.appendChild(valueSpan);
    return displayButton;
  }

  /**
   * Create rating dialog with star buttons
   */
  private createRatingDialog(): HTMLElement {
    const dialog = document.createElement('div');
    dialog.className = 'rating-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-hidden', 'true');
    dialog.hidden = true;
    this.ratingDialog = dialog;

    const dialogHeader = document.createElement('div');
    dialogHeader.className = 'rating-dialog__header';
    dialog.appendChild(dialogHeader);

    const starsContainer = document.createElement('div');
    starsContainer.className = 'rating-dialog__stars';
    starsContainer.setAttribute('role', 'radiogroup');
    starsContainer.setAttribute('aria-label', 'Rate this scene from 0 to 10 stars');
    this.ratingStarButtons = [];

    for (let i = 1; i <= RATING_MAX_STARS; i++) {
      const starBtn = document.createElement('button');
      starBtn.type = 'button';
      starBtn.className = 'rating-dialog__star';
      starBtn.setAttribute('role', 'radio');
      starBtn.setAttribute('aria-label', `${i} star${i === 1 ? '' : 's'}`);
      starBtn.dataset.value = i.toString();
      starBtn.textContent = '☆';
      starBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.onRatingStarSelect(i);
      });
      starBtn.addEventListener('keydown', (event) => {
        this.handleRatingKeydown(event, i);
      });
      this.ratingStarButtons.push(starBtn);
      starsContainer.appendChild(starBtn);
    }

    dialog.appendChild(starsContainer);
    return dialog;
  }

  /**
   * Handle keyboard navigation for rating stars
   */
  private handleRatingKeydown(event: KeyboardEvent, currentIndex: number): void {
    if (!this.isRatingDialogOpen) return;
    
    let newIndex = currentIndex;
    
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        newIndex = Math.min(RATING_MAX_STARS, currentIndex + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        newIndex = Math.max(1, currentIndex - 1);
        break;
      case 'Home':
        event.preventDefault();
        newIndex = 1;
        break;
      case 'End':
        event.preventDefault();
        newIndex = RATING_MAX_STARS;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        void this.onRatingStarSelect(currentIndex);
        return;
      default:
        return;
    }
    
    if (newIndex !== currentIndex) {
      const newButton = this.ratingStarButtons[newIndex - 1];
      if (newButton) {
        newButton.focus();
      }
    }
  }

  /**
   * Toggle rating dialog open/closed state
   */
  private toggleRatingDialog(force?: boolean): void {
    const shouldOpen = typeof force === 'boolean' ? force : !this.isRatingDialogOpen;
    if (shouldOpen) {
      this.openRatingDialog();
    } else {
      this.closeRatingDialog();
    }
  }

  /**
   * Open rating dialog
   */
  private openRatingDialog(): void {
    if (!this.ratingDialog || this.isRatingDialogOpen) return;
    this.isRatingDialogOpen = true;
    this.ratingDialog.hidden = false;
    this.ratingDialog.setAttribute('aria-hidden', 'false');
    this.ratingDialog.classList.add('rating-dialog--open');
    this.ratingDisplayButton?.setAttribute('aria-expanded', 'true');
    this.ratingWrapper?.classList.add('rating-control--open');
    this.syncRatingDialogLayout();
    document.addEventListener('mousedown', this.ratingOutsideClickHandler);
    document.addEventListener('touchstart', this.ratingOutsideClickHandler);
    document.addEventListener('keydown', this.ratingKeydownHandler);
    window.addEventListener('resize', this.ratingResizeHandler);
    this.updateRatingStarButtons();
    
    // Focus first star button for keyboard navigation
    if (this.ratingStarButtons.length > 0) {
      const firstButton = this.ratingStarButtons[this.hasRating ? this.ratingValue - 1 : 0];
      if (firstButton) {
        firstButton.focus();
      }
    }
  }

  /**
   * Close rating dialog
   */
  private closeRatingDialog(): void {
    if (!this.ratingDialog || !this.isRatingDialogOpen) return;
    this.isRatingDialogOpen = false;
    this.ratingDialog.classList.remove('rating-dialog--open');
    this.ratingDialog.setAttribute('aria-hidden', 'true');
    this.ratingDialog.hidden = true;
    this.ratingDisplayButton?.setAttribute('aria-expanded', 'false');
    this.ratingWrapper?.classList.remove('rating-control--open');
    this.detachRatingGlobalListeners();
  }

  /**
   * Detach global event listeners for rating dialog
   */
  private detachRatingGlobalListeners(): void {
    document.removeEventListener('mousedown', this.ratingOutsideClickHandler);
    document.removeEventListener('touchstart', this.ratingOutsideClickHandler);
    document.removeEventListener('keydown', this.ratingKeydownHandler);
    window.removeEventListener('resize', this.ratingResizeHandler);
  }

  /**
   * Handle clicks outside rating dialog
   */
  private onRatingOutsideClick(event: Event): void {
    if (!this.isRatingDialogOpen || !this.ratingWrapper) return;
    const target = event.target as Node | null;
    if (target && this.ratingWrapper.contains(target)) {
      return;
    }
    this.closeRatingDialog();
  }

  /**
   * Handle keyboard events for rating dialog
   */
  private onRatingKeydown(event: KeyboardEvent): void {
    if (!this.isRatingDialogOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeRatingDialog();
      this.ratingDisplayButton?.focus();
    }
  }

  /**
   * Update rating display button and value
   */
  private updateRatingDisplay(): void {
    if (this.ratingDisplayButton) {
      const ariaLabel = this.hasRating
        ? `Scene rating ${this.ratingValue} out of ${RATING_MAX_STARS}`
        : 'Rate this scene';
      this.ratingDisplayButton.setAttribute('aria-label', ariaLabel);
      this.ratingDisplayButton.classList.toggle('icon-btn--rating-active', this.hasRating);
    }
    if (this.ratingDisplayValue) {
      this.ratingDisplayValue.textContent = this.hasRating ? this.ratingValue.toString() : '0';
    }
  }

  /**
   * Update star buttons appearance and state
   */
  private updateRatingStarButtons(): void {
    if (!this.ratingStarButtons || this.ratingStarButtons.length === 0) return;
    this.ratingStarButtons.forEach((button, index) => {
      const value = Number(button.dataset.value || '0');
      const isActive = this.hasRating && value <= this.ratingValue;
      const isChecked = this.hasRating && value === this.ratingValue;
      button.classList.toggle('rating-dialog__star--active', isActive);
      button.setAttribute('aria-checked', isChecked ? 'true' : 'false');
      button.tabIndex = isChecked || (!this.hasRating && index === 0) ? 0 : -1;
      button.textContent = isActive ? '★' : '☆';
      button.disabled = this.isSavingRating;
    });
  }

  /**
   * Handle star selection
   */
  private async onRatingStarSelect(value: number): Promise<void> {
    if (this.isSavingRating) return;

    const nextValue = this.clampRatingValue(value);
    const previousValue = this.ratingValue;
    const previousRating100 = this.data.marker.scene.rating100;
    const previousHasRating = this.hasRating;

    this.ratingValue = nextValue;
    this.hasRating = true;
    this.updateRatingDisplay();
    this.updateRatingStarButtons();
    this.closeRatingDialog();

    if (!this.api) {
      this.data.marker.scene.rating100 = this.ratingValue * 10;
      return;
    }

    this.isSavingRating = true;
    this.setRatingSavingState(true);
    this.updateRatingStarButtons();

    try {
      const updatedRating100 = await this.api.updateSceneRating(this.data.marker.scene.id, this.ratingValue);
      this.data.marker.scene.rating100 = updatedRating100;
      this.ratingValue = this.convertRating100ToStars(updatedRating100);
      this.hasRating = true;
      this.updateRatingDisplay();
      this.updateRatingStarButtons();
    } catch (error) {
      console.error('Failed to update scene rating', error);
      showToast('Failed to update rating. Please try again.');
      this.ratingValue = previousValue;
      this.hasRating = previousHasRating;
      this.data.marker.scene.rating100 = previousRating100;
      this.updateRatingDisplay();
      this.updateRatingStarButtons();
    } finally {
      this.isSavingRating = false;
      this.setRatingSavingState(false);
      this.updateRatingStarButtons();
    }
  }

  /**
   * Set rating saving state on UI elements
   */
  private setRatingSavingState(isSaving: boolean): void {
    if (!this.ratingDisplayButton) return;
    if (isSaving) {
      this.ratingDisplayButton.classList.add('icon-btn--rating-saving');
      this.ratingDisplayButton.setAttribute('aria-busy', 'true');
      this.ratingDisplayButton.disabled = true;
      this.ratingDisplayButton.style.transform = 'scale(1)';
    } else {
      this.ratingDisplayButton.classList.remove('icon-btn--rating-saving');
      this.ratingDisplayButton.removeAttribute('aria-busy');
      this.ratingDisplayButton.disabled = false;
    }
    this.ratingStarButtons.forEach((button) => {
      button.disabled = isSaving;
    });
  }

  /**
   * Sync rating dialog layout with container
   */
  private syncRatingDialogLayout(): void {
    if (!this.ratingWrapper) return;
    const dialog = this.ratingDialog;
    if (!dialog) return;

    const cardRect = this.container.getBoundingClientRect();
    const wrapperRect = this.ratingWrapper.getBoundingClientRect();
    if (!cardRect.width || !wrapperRect.width) return;

    const footer = this.footer || this.container.querySelector('.video-post__footer') as HTMLElement;
    let horizontalPadding = RATING_DIALOG_DEFAULT_PADDING;
    if (footer) {
      const footerStyles = window.getComputedStyle(footer);
      const paddingLeft = parseFloat(footerStyles.paddingLeft || '0');
      const paddingRight = parseFloat(footerStyles.paddingRight || '0');
      horizontalPadding = Math.max(RATING_DIALOG_MIN_PADDING, Math.round(paddingLeft + paddingRight));
    }

    const availableWidth = Math.max(RATING_DIALOG_MIN_WIDTH, Math.floor(cardRect.width - horizontalPadding));
    const clampedWidth = Math.min(availableWidth, RATING_DIALOG_MAX_WIDTH);
    this.ratingWrapper.style.setProperty('--rating-dialog-width', `${clampedWidth}px`);

    const diffRight = cardRect.right - wrapperRect.right;
    this.ratingWrapper.style.setProperty('--rating-dialog-right', `${-diffRight}px`);
  }

  /**
   * Clamp rating value to valid range
   */
  private clampRatingValue(value: number): number {
    if (!Number.isFinite(value)) return RATING_MIN_STARS;
    return Math.min(RATING_MAX_STARS, Math.max(RATING_MIN_STARS, Math.round(value)));
  }

  /**
   * Convert rating100 (0-100) to stars (0-10)
   */
  private convertRating100ToStars(rating100?: number): number {
    if (typeof rating100 !== 'number' || Number.isNaN(rating100)) {
      return RATING_MIN_STARS;
    }
    return this.clampRatingValue(rating100 / 10);
  }

  /**
   * Upgrade from marker video to full scene video with audio
   */
  private async upgradeToSceneVideo(): Promise<void> {
    if (!this.api) {
      throw new Error('API not available');
    }

    // Get full scene video URL
    const sceneVideoUrl = this.api.getVideoUrl(this.data.marker.scene);
    if (!sceneVideoUrl || !isValidMediaUrl(sceneVideoUrl)) {
      throw new Error('Scene video URL not available');
    }

    const playerContainer = this.playerContainer || this.container.querySelector('.video-post__player') as HTMLElement;
    if (!playerContainer) {
      throw new Error('Player container not found');
    }

    // Capture current playback state with proper null checks
    const playerState = this.player?.getState();
    const wasPlaying = playerState?.isPlaying ?? false;

    // Destroy current marker player
    if (this.player) {
      this.player.destroy();
      this.player = undefined;
      this.isLoaded = false;
    }

    // Clear player container to prepare for new player
    playerContainer.innerHTML = '';

    // Create new player with full scene video (with error handling)
    try {
      this.player = new NativeVideoPlayer(playerContainer, sceneVideoUrl, {
        muted: false,
        autoplay: false,
        startTime: this.data.startTime ?? this.data.marker.seconds,
        endTime: this.data.endTime ?? this.data.marker.end_seconds,
      });

      // Hide thumbnail and loading if still visible
      const thumbnail = playerContainer.querySelector('.video-post__thumbnail') as HTMLElement;
      const loading = playerContainer.querySelector('.video-post__loading') as HTMLElement;
      if (thumbnail) thumbnail.style.display = 'none';
      if (loading) loading.style.display = 'none';

      this.isLoaded = true;
    } catch (error) {
      console.error('VideoPost: Failed to create scene video player', {
        error,
        sceneVideoUrl,
        markerId: this.data.marker.id,
        sceneId: this.data.marker.scene?.id,
      });
      throw error; // Re-throw since this is an async method that should fail if player creation fails
    }

    // Register with visibility manager if available
    if (this.visibilityManager && this.data.marker.id) {
      this.visibilityManager.registerPlayer(this.data.marker.id, this.player);
    }

    // If video was playing, resume playback
    if (wasPlaying) {
      try {
        await this.player.waitUntilCanPlay(2000);
        await this.player.play();
      } catch (error) {
        console.warn('Failed to resume playback after upgrade', error);
        showToast('Video upgraded but playback failed. Click play to start.');
      }
    }
  }

  /**
   * Check favorite status from marker tags
   */
  private async checkFavoriteStatus(): Promise<void> {
    if (!this.favoritesManager) return;

    try {
      const hasFavoriteTag = this.data.marker.tags?.some(
        tag => tag.name === FAVORITE_TAG_NAME
      ) || false;

      this.isFavorite = hasFavoriteTag;

      // Update heart button if it exists
      if (this.heartButton) {
        this.updateHeartButton(this.heartButton);
      }
    } catch (error) {
      console.error('Failed to check favorite status', error);
      // Don't show toast for background check failures
    }
  }

  /**
   * Get link to scene in Stash
   */
  private getSceneLink(): string {
    const s = this.data.marker.scene;
    const t = Math.max(0, Math.floor(this.data.marker.seconds || 0));
    return `${window.location.origin}/scenes/${s.id}?t=${t}`;
  }

  /**
   * Get link to performer page
   */
  private getPerformerLink(performerId: string): string {
    return `${window.location.origin}/performers/${performerId}`;
  }

  /**
   * Get link to tag page
   */
  private getTagLink(tagId: string): string {
    return `${window.location.origin}/tags/${tagId}`;
  }

  /**
   * Load the video player
   */
  loadPlayer(videoUrl: string, startTime?: number, endTime?: number): NativeVideoPlayer | undefined {
    // Early return if already loaded
    if (this.isLoaded) {
      return this.player;
    }

    // Validate URL early before any other checks
    if (!videoUrl || !isValidMediaUrl(videoUrl)) {
      console.warn('VideoPost: Invalid media URL, skipping player creation', { 
        videoUrl,
        markerId: this.data.marker.id,
        sceneId: this.data.marker.scene?.id,
      });
      return undefined;
    }

    const playerContainer = this.playerContainer || this.container.querySelector('.video-post__player') as HTMLElement;
    if (!playerContainer) {
      console.warn('VideoPost: Player container not found', { markerId: this.data.marker.id });
      return undefined;
    }

    try {
      this.player = new NativeVideoPlayer(playerContainer, videoUrl, {
        muted: false,
        autoplay: false,
        startTime: startTime ?? this.data.startTime ?? this.data.marker.seconds,
        endTime: endTime ?? this.data.endTime ?? this.data.marker.end_seconds,
      });

      // Hide thumbnail and loading
      const thumbnail = playerContainer.querySelector('.video-post__thumbnail') as HTMLElement;
      const loading = playerContainer.querySelector('.video-post__loading') as HTMLElement;
      if (thumbnail) thumbnail.style.display = 'none';
      if (loading) loading.style.display = 'none';

      this.isLoaded = true;
    } catch (error) {
      console.error('VideoPost: Failed to create video player', {
        error,
        videoUrl,
        markerId: this.data.marker.id,
      });
      // Don't set isLoaded to true if player creation failed
      return undefined;
    }

    return this.player;
  }

  /**
   * Get the video player instance
   */
  getPlayer(): NativeVideoPlayer | undefined {
    return this.player;
  }

  /**
   * Return true if player has been instantiated
   */
  isPlayerLoaded(): boolean {
    return this.isLoaded && !!this.player;
  }

  /**
   * Return true if there is a valid source to preload
   */
  hasVideoSource(): boolean {
    return !!this.data.videoUrl && isValidMediaUrl(this.data.videoUrl);
  }

  /**
   * Preload player using default source/range
   */
  preload(): NativeVideoPlayer | undefined {
    if (!this.hasVideoSource()) {
      return undefined;
    }

    return this.loadPlayer(
      this.data.videoUrl!,
      this.data.startTime ?? this.data.marker.seconds,
      this.data.endTime ?? this.data.marker.end_seconds
    );
  }

  /**
   * Check if currently in HQ mode (using scene video)
   */
  isInHQMode(): boolean {
    return this.isHQMode;
  }

  /**
   * Register player with visibility manager after upgrade
   * Called by FeedContainer when player is upgraded
   */
  registerPlayerWithVisibilityManager(visibilityManager: VisibilityManager): void {
    if (this.player && this.data.marker.id) {
      visibilityManager.registerPlayer(this.data.marker.id, this.player);
    }
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
   * Destroy the post and clean up all resources
   */
  destroy(): void {
    // Destroy player
    if (this.player) {
      this.player.destroy();
      this.player = undefined;
    }

    // Close rating dialog if open and clean up listeners
    if (this.isRatingDialogOpen) {
      this.closeRatingDialog();
    } else {
      // Ensure listeners are removed even if dialog wasn't open
      this.detachRatingGlobalListeners();
    }

    // Remove all hover effect listeners
    for (const [button] of this.hoverHandlers) {
      this.removeHoverEffect(button);
    }
    this.hoverHandlers.clear();

    // Remove container from DOM
    this.container.remove();
  }
}
