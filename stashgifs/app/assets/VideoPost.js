/**
 * Video Post Component
 * Individual video post card in the feed
 */
import { NativeVideoPlayer } from './NativeVideoPlayer.js';
import { calculateAspectRatio, getAspectRatioClass, isValidMediaUrl } from './utils.js';
export class VideoPost {
    constructor(container, data, favoritesManager, api, visibilityManager) {
        this.isLoaded = false;
        this.isFavorite = false;
        this.oCount = 0;
        this.isHQMode = false;
        this.ratingValue = 0;
        this.hasRating = false;
        this.ratingStarButtons = [];
        this.isRatingDialogOpen = false;
        this.isSavingRating = false;
        this.ratingOutsideClickHandler = (event) => this.onRatingOutsideClick(event);
        this.ratingKeydownHandler = (event) => this.onRatingKeydown(event);
        this.ratingResizeHandler = () => this.syncRatingDialogLayout();
        this.container = container;
        this.data = data;
        this.thumbnailUrl = data.thumbnailUrl;
        this.favoritesManager = favoritesManager;
        this.api = api;
        this.visibilityManager = visibilityManager;
        this.oCount = this.data.marker.scene.o_counter || 0;
        this.ratingValue = this.convertRating100ToStars(this.data.marker.scene.rating100);
        this.hasRating = typeof this.data.marker.scene.rating100 === 'number' && !Number.isNaN(this.data.marker.scene.rating100);
        this.render();
        this.checkFavoriteStatus();
    }
    render() {
        this.container.className = 'video-post';
        this.container.dataset.postId = this.data.marker.id;
        this.container.innerHTML = '';
        // Header with performers and tags
        const header = this.createHeader();
        this.container.appendChild(header);
        // Player container
        const playerContainer = this.createPlayerContainer();
        this.container.appendChild(playerContainer);
        // Footer with buttons and rating
        const footer = this.createFooter();
        this.container.appendChild(footer);
    }
    createPlayerContainer() {
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
    createHeader() {
        const header = document.createElement('div');
        header.className = 'video-post__header';
        header.style.padding = '0'; // Remove all padding
        header.style.marginBottom = '4px'; // Reduced margin
        header.style.borderBottom = 'none'; // Remove divider line
        const chips = document.createElement('div');
        chips.className = 'chips';
        chips.style.display = 'flex';
        chips.style.flexWrap = 'wrap';
        chips.style.gap = '6px';
        chips.style.margin = '0'; // Remove any margin from chips container
        // Add performer chips
        if (this.data.marker.scene.performers && this.data.marker.scene.performers.length > 0) {
            for (const performer of this.data.marker.scene.performers) {
                const chip = document.createElement('a');
                chip.className = 'chip';
                chip.href = this.getPerformerLink(performer.id);
                chip.target = '_blank';
                chip.rel = 'noopener noreferrer';
                // Reduce chip size
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
                chips.appendChild(chip);
            }
        }
        // Add tag chip: show only the primary tag if available
        if (this.data.marker.primary_tag && this.data.marker.primary_tag.id && this.data.marker.primary_tag.name) {
            const tag = this.data.marker.primary_tag;
            const chip = document.createElement('a');
            chip.className = 'chip chip--tag';
            chip.href = this.getTagLink(tag.id);
            chip.target = '_blank';
            chip.rel = 'noopener noreferrer';
            // Reduce chip size
            chip.style.padding = '4px 8px';
            chip.style.fontSize = '0.75rem';
            chip.appendChild(document.createTextNode(tag.name));
            chips.appendChild(chip);
        }
        header.appendChild(chips);
        return header;
    }
    createFooter() {
        const footer = document.createElement('div');
        footer.className = 'video-post__footer';
        footer.style.padding = '4px 8px'; // Even tighter padding
        const info = document.createElement('div');
        info.className = 'video-post__info';
        info.style.gap = '0'; // Remove gap
        // Row: button group (right-aligned)
        const row = document.createElement('div');
        row.className = 'video-post__row';
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'flex-end'; // Right-align buttons
        row.style.gap = '2px'; // Reduced gap
        // Button group container for right-aligned buttons
        const buttonGroup = document.createElement('div');
        buttonGroup.style.display = 'flex';
        buttonGroup.style.alignItems = 'center';
        buttonGroup.style.gap = '2px'; // Tighter spacing between buttons
        // Heart button for favorites (if FavoritesManager is available) - placed before play button
        if (this.favoritesManager) {
            const heartBtn = this.createHeartButton();
            buttonGroup.appendChild(heartBtn);
        }
        // O count button with splashing emoji - placed before rating button
        if (this.api) {
            const oCountBtn = this.createOCountButton();
            buttonGroup.appendChild(oCountBtn);
        }
        // Rating control - star icon with dialog
        const ratingControl = this.createRatingSection();
        buttonGroup.appendChild(ratingControl);
        // High-quality scene video button - placed before play button
        if (this.api) {
            const hqBtn = this.createHQButton();
            buttonGroup.appendChild(hqBtn);
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
        iconBtn.style.padding = '2px'; // Reduced padding
        iconBtn.style.display = 'flex';
        iconBtn.style.alignItems = 'center';
        iconBtn.style.justifyContent = 'center';
        iconBtn.style.color = 'rgba(255, 255, 255, 0.7)';
        iconBtn.style.transition = 'color 0.2s ease, transform 0.2s ease';
        iconBtn.style.width = 'auto'; // Allow smaller size
        iconBtn.style.height = 'auto'; // Allow smaller size
        iconBtn.style.minWidth = 'auto'; // Remove min-width constraint
        iconBtn.style.minHeight = 'auto'; // Remove min-height constraint
        iconBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>'; // Smaller SVG
        // Hover effect to match other buttons
        iconBtn.addEventListener('mouseenter', () => {
            iconBtn.style.transform = 'scale(1.1)';
        });
        iconBtn.addEventListener('mouseleave', () => {
            iconBtn.style.transform = 'scale(1)';
        });
        buttonGroup.appendChild(iconBtn);
        // Add button group to row
        row.appendChild(buttonGroup);
        info.appendChild(row);
        footer.appendChild(info);
        return footer;
    }
    createHeartButton() {
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
            if (!this.favoritesManager)
                return;
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
                }
                else {
                    // Remove favorite tag
                    this.data.marker.tags = this.data.marker.tags.filter(tag => tag.name !== favoriteTagName);
                }
                this.updateHeartButton(heartBtn, heartSvg, heartSvgFilled);
            }
            catch (error) {
                console.error('Failed to toggle favorite', error);
                // Revert UI state
                this.isFavorite = !this.isFavorite;
                this.updateHeartButton(heartBtn, heartSvg, heartSvgFilled);
            }
            finally {
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
    updateHeartButton(button, outlineSvg, filledSvg) {
        if (this.isFavorite) {
            button.innerHTML = filledSvg;
            button.style.color = '#ff6b9d';
        }
        else {
            button.innerHTML = outlineSvg;
            button.style.color = 'rgba(255, 255, 255, 0.7)';
        }
    }
    createOCountButton() {
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
        oCountBtn.style.gap = '6px'; // Consistent with rating button
        oCountBtn.style.color = 'rgba(255, 255, 255, 0.7)';
        oCountBtn.style.transition = 'color 0.2s ease, transform 0.2s ease';
        oCountBtn.style.fontSize = '16px';
        // Splashing emoji 💦
        const emoji = '💦';
        // Initial content - updateOCountButton will add the span
        oCountBtn.innerHTML = emoji;
        this.oCountButton = oCountBtn;
        this.updateOCountButton(); // This will add the count span with proper styling
        oCountBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!this.api)
                return;
            // Disable button during operation
            oCountBtn.disabled = true;
            oCountBtn.style.opacity = '0.5';
            try {
                const result = await this.api.incrementOCount(this.data.marker.scene.id);
                this.oCount = result.count;
                // Update local scene data
                this.data.marker.scene.o_counter = result.count;
                this.updateOCountButton();
            }
            catch (error) {
                console.error('Failed to increment o count', error);
            }
            finally {
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
    updateOCountButton() {
        if (!this.oCountButton)
            return;
        const emoji = '💦';
        // Clear existing content but keep structure
        this.oCountButton.innerHTML = emoji;
        // Always add count span for consistent spacing (even if 0)
        const countSpan = document.createElement('span');
        countSpan.style.fontSize = '14px';
        countSpan.style.fontWeight = '500';
        countSpan.style.minWidth = '14px'; // Consistent width for alignment
        countSpan.style.textAlign = 'left';
        countSpan.textContent = this.oCount > 0 ? this.oCount.toString() : '';
        this.oCountButton.appendChild(countSpan);
    }
    createHQButton() {
        const hqBtn = document.createElement('button');
        hqBtn.className = 'icon-btn icon-btn--hq';
        hqBtn.type = 'button';
        hqBtn.setAttribute('aria-label', 'Load high-quality scene video with audio');
        hqBtn.style.background = 'transparent';
        hqBtn.style.border = 'none';
        hqBtn.style.cursor = 'pointer';
        hqBtn.style.padding = '4px';
        hqBtn.style.display = 'flex';
        hqBtn.style.alignItems = 'center';
        hqBtn.style.justifyContent = 'center';
        hqBtn.style.color = 'rgba(255, 255, 255, 0.7)';
        hqBtn.style.transition = 'color 0.2s ease, transform 0.2s ease';
        // HD badge icon - outline version
        const hqSvgOutline = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="4" y="6" width="16" height="12" rx="2"/>
      <path d="M8 10h8M8 14h8" stroke-width="1.5"/>
      <text x="12" y="15" font-size="7" font-weight="bold" fill="currentColor" text-anchor="middle" font-family="Arial, sans-serif">HD</text>
    </svg>`;
        // HD badge icon - filled version (active state)
        const hqSvgFilled = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <rect x="4" y="6" width="16" height="12" rx="2"/>
      <text x="12" y="15" font-size="7" font-weight="bold" fill="white" text-anchor="middle" font-family="Arial, sans-serif">HD</text>
    </svg>`;
        this.updateHQButton(hqBtn, hqSvgOutline, hqSvgFilled);
        this.hqButton = hqBtn;
        hqBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!this.api || this.isHQMode)
                return;
            // Disable button during operation
            hqBtn.disabled = true;
            hqBtn.style.opacity = '0.5';
            try {
                await this.upgradeToSceneVideo();
                this.isHQMode = true;
                this.updateHQButton(hqBtn, hqSvgOutline, hqSvgFilled);
            }
            catch (error) {
                console.error('Failed to upgrade to scene video', error);
            }
            finally {
                hqBtn.disabled = false;
                hqBtn.style.opacity = '1';
            }
        });
        // Hover effect
        hqBtn.addEventListener('mouseenter', () => {
            if (!hqBtn.disabled) {
                hqBtn.style.transform = 'scale(1.1)';
            }
        });
        hqBtn.addEventListener('mouseleave', () => {
            hqBtn.style.transform = 'scale(1)';
        });
        return hqBtn;
    }
    updateHQButton(button, outlineSvg, filledSvg) {
        if (this.isHQMode) {
            button.innerHTML = filledSvg;
            button.style.color = '#4CAF50'; // Green for active HQ mode
        }
        else {
            button.innerHTML = outlineSvg;
            button.style.color = 'rgba(255, 255, 255, 0.7)';
        }
    }
    createRatingSection() {
        const wrapper = document.createElement('div');
        wrapper.className = 'rating-control';
        wrapper.setAttribute('data-role', 'rating');
        this.ratingWrapper = wrapper;
        const displayButton = document.createElement('button');
        displayButton.type = 'button';
        displayButton.className = 'icon-btn icon-btn--rating';
        displayButton.setAttribute('aria-haspopup', 'dialog');
        displayButton.setAttribute('aria-expanded', 'false');
        displayButton.style.background = 'transparent';
        displayButton.style.border = 'none';
        displayButton.style.cursor = 'pointer';
        displayButton.style.padding = '4px 8px'; // Consistent with o-count button
        displayButton.style.display = 'flex';
        displayButton.style.alignItems = 'center';
        displayButton.style.justifyContent = 'center';
        displayButton.style.gap = '6px'; // Consistent spacing
        displayButton.style.color = 'rgba(255, 255, 255, 0.7)';
        displayButton.style.transition = 'color 0.2s ease, transform 0.2s ease';
        displayButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (this.isSavingRating)
                return;
            this.toggleRatingDialog();
        });
        displayButton.addEventListener('mouseenter', () => {
            if (!displayButton.disabled) {
                displayButton.style.transform = 'scale(1.1)';
            }
        });
        displayButton.addEventListener('mouseleave', () => {
            displayButton.style.transform = 'scale(1)';
        });
        this.ratingDisplayButton = displayButton;
        const iconSpan = document.createElement('span');
        iconSpan.className = 'rating-display__icon';
        iconSpan.innerHTML = this.getDisplayStarSvg();
        const valueSpan = document.createElement('span');
        valueSpan.className = 'rating-display__value';
        valueSpan.style.fontSize = '14px'; // Consistent with o-count
        valueSpan.style.fontWeight = '500'; // Consistent with o-count
        valueSpan.style.minWidth = '14px'; // Consistent width for alignment
        valueSpan.style.textAlign = 'left';
        this.ratingDisplayValue = valueSpan;
        displayButton.appendChild(iconSpan);
        displayButton.appendChild(valueSpan);
        wrapper.appendChild(displayButton);
        const dialog = document.createElement('div');
        dialog.className = 'rating-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'false');
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
        for (let i = 1; i <= 10; i++) {
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
            this.ratingStarButtons.push(starBtn);
            starsContainer.appendChild(starBtn);
        }
        dialog.appendChild(starsContainer);
        wrapper.appendChild(dialog);
        this.updateRatingDisplay();
        this.updateRatingStarButtons();
        return wrapper;
    }
    toggleRatingDialog(force) {
        const shouldOpen = typeof force === 'boolean' ? force : !this.isRatingDialogOpen;
        if (shouldOpen) {
            this.openRatingDialog();
        }
        else {
            this.closeRatingDialog();
        }
    }
    openRatingDialog() {
        if (!this.ratingDialog || this.isRatingDialogOpen)
            return;
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
    }
    closeRatingDialog() {
        if (!this.ratingDialog || !this.isRatingDialogOpen)
            return;
        this.isRatingDialogOpen = false;
        this.ratingDialog.classList.remove('rating-dialog--open');
        this.ratingDialog.setAttribute('aria-hidden', 'true');
        this.ratingDialog.hidden = true;
        this.ratingDisplayButton?.setAttribute('aria-expanded', 'false');
        this.ratingWrapper?.classList.remove('rating-control--open');
        this.detachRatingGlobalListeners();
    }
    detachRatingGlobalListeners() {
        document.removeEventListener('mousedown', this.ratingOutsideClickHandler);
        document.removeEventListener('touchstart', this.ratingOutsideClickHandler);
        document.removeEventListener('keydown', this.ratingKeydownHandler);
        window.removeEventListener('resize', this.ratingResizeHandler);
    }
    onRatingOutsideClick(event) {
        if (!this.isRatingDialogOpen || !this.ratingWrapper)
            return;
        const target = event.target;
        if (target && this.ratingWrapper.contains(target)) {
            return;
        }
        this.closeRatingDialog();
    }
    onRatingKeydown(event) {
        if (!this.isRatingDialogOpen)
            return;
        if (event.key === 'Escape') {
            event.preventDefault();
            this.closeRatingDialog();
        }
    }
    updateRatingDisplay() {
        if (this.ratingDisplayButton) {
            const ariaLabel = this.hasRating
                ? `Scene rating ${this.ratingValue} out of 10`
                : 'Rate this scene';
            this.ratingDisplayButton.setAttribute('aria-label', ariaLabel);
            this.ratingDisplayButton.classList.toggle('icon-btn--rating-active', this.hasRating);
        }
        if (this.ratingDisplayValue) {
            this.ratingDisplayValue.textContent = this.hasRating ? this.ratingValue.toString() : '0';
        }
    }
    updateRatingStarButtons() {
        if (!this.ratingStarButtons || this.ratingStarButtons.length === 0)
            return;
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
    async onRatingStarSelect(value) {
        if (this.isSavingRating)
            return;
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
        }
        catch (error) {
            console.error('Failed to update scene rating', error);
            this.ratingValue = previousValue;
            this.hasRating = previousHasRating;
            this.data.marker.scene.rating100 = previousRating100;
            this.updateRatingDisplay();
            this.updateRatingStarButtons();
        }
        finally {
            this.isSavingRating = false;
            this.setRatingSavingState(false);
            this.updateRatingStarButtons();
        }
    }
    setRatingSavingState(isSaving) {
        if (!this.ratingDisplayButton)
            return;
        if (isSaving) {
            this.ratingDisplayButton.classList.add('icon-btn--rating-saving');
            this.ratingDisplayButton.setAttribute('aria-busy', 'true');
            this.ratingDisplayButton.disabled = true;
            this.ratingDisplayButton.style.transform = 'scale(1)';
        }
        else {
            this.ratingDisplayButton.classList.remove('icon-btn--rating-saving');
            this.ratingDisplayButton.removeAttribute('aria-busy');
            this.ratingDisplayButton.disabled = false;
        }
        this.ratingStarButtons.forEach((button) => {
            button.disabled = isSaving;
        });
    }
    syncRatingDialogLayout() {
        if (!this.ratingWrapper)
            return;
        const dialog = this.ratingDialog;
        if (!dialog)
            return;
        const cardRect = this.container.getBoundingClientRect();
        const wrapperRect = this.ratingWrapper.getBoundingClientRect();
        if (!cardRect.width || !wrapperRect.width)
            return;
        const footer = this.container.querySelector('.video-post__footer');
        let horizontalPadding = 32;
        if (footer) {
            const footerStyles = window.getComputedStyle(footer);
            const paddingLeft = parseFloat(footerStyles.paddingLeft || '0');
            const paddingRight = parseFloat(footerStyles.paddingRight || '0');
            horizontalPadding = Math.max(16, Math.round(paddingLeft + paddingRight));
        }
        const availableWidth = Math.max(200, Math.floor(cardRect.width - horizontalPadding));
        const clampedWidth = Math.min(availableWidth, 900);
        this.ratingWrapper.style.setProperty('--rating-dialog-width', `${clampedWidth}px`);
        const diffRight = cardRect.right - wrapperRect.right;
        this.ratingWrapper.style.setProperty('--rating-dialog-right', `${-diffRight}px`);
    }
    getDisplayStarSvg() {
        return `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.62L12 2 9.19 8.62 2 9.24l5.46 4.73L5.82 21z"/>
    </svg>`;
    }
    getCloseSvg() {
        return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>`;
    }
    clampRatingValue(value) {
        if (!Number.isFinite(value))
            return 0;
        return Math.min(10, Math.max(0, Math.round(value)));
    }
    convertRating100ToStars(rating100) {
        if (typeof rating100 !== 'number' || Number.isNaN(rating100)) {
            return 0;
        }
        return this.clampRatingValue(rating100 / 10);
    }
    /**
     * Upgrade from marker video to full scene video with audio
     */
    async upgradeToSceneVideo() {
        if (!this.api) {
            throw new Error('API not available');
        }
        // Get full scene video URL
        const sceneVideoUrl = this.api.getVideoUrl(this.data.marker.scene);
        if (!sceneVideoUrl || !isValidMediaUrl(sceneVideoUrl)) {
            throw new Error('Scene video URL not available');
        }
        const playerContainer = this.container.querySelector('.video-post__player');
        if (!playerContainer) {
            throw new Error('Player container not found');
        }
        // Capture current playback state
        const wasPlaying = this.player?.getState().isPlaying || false;
        const currentTime = this.player?.getState().currentTime || this.data.marker.seconds;
        // Destroy current marker player
        if (this.player) {
            this.player.destroy();
            this.player = undefined;
            this.isLoaded = false;
        }
        // Clear player container to prepare for new player
        // The NativeVideoPlayer will create its own wrapper
        playerContainer.innerHTML = '';
        // Create new player with full scene video
        this.player = new NativeVideoPlayer(playerContainer, sceneVideoUrl, {
            muted: false, // Enable audio for HQ mode
            autoplay: false,
            startTime: this.data.marker.seconds, // Start at marker timestamp
            endTime: this.data.marker.end_seconds, // End at marker end time if available
        });
        // Hide thumbnail and loading if still visible
        const thumbnail = playerContainer.querySelector('.video-post__thumbnail');
        const loading = playerContainer.querySelector('.video-post__loading');
        if (thumbnail)
            thumbnail.style.display = 'none';
        if (loading)
            loading.style.display = 'none';
        this.isLoaded = true;
        // Register with visibility manager if available
        if (this.visibilityManager && this.data.marker.id) {
            this.visibilityManager.registerPlayer(this.data.marker.id, this.player);
        }
        // If video was playing, resume playback
        if (wasPlaying) {
            try {
                await this.player.waitUntilCanPlay(2000);
                await this.player.play();
            }
            catch (error) {
                console.warn('Failed to resume playback after upgrade', error);
            }
        }
    }
    async checkFavoriteStatus() {
        if (!this.favoritesManager)
            return;
        try {
            // Check if marker has the favorite tag in its tags array
            const favoriteTagName = 'StashGifs Favorite';
            const hasFavoriteTag = this.data.marker.tags?.some(tag => tag.name === favoriteTagName) || false;
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
        }
        catch (error) {
            console.error('Failed to check favorite status', error);
        }
    }
    getSceneLink() {
        const s = this.data.marker.scene;
        // Link to the local Stash scene route with timestamp set to marker start seconds
        const t = Math.max(0, Math.floor(this.data.marker.seconds || 0));
        return `${window.location.origin}/scenes/${s.id}?t=${t}`;
    }
    getPerformerLink(performerId) {
        return `${window.location.origin}/performers/${performerId}`;
    }
    getTagLink(tagId) {
        return `${window.location.origin}/tags/${tagId}`;
    }
    /**
     * Load the video player
     */
    loadPlayer(videoUrl, startTime, endTime) {
        if (this.isLoaded || !videoUrl) {
            return;
        }
        const playerContainer = this.container.querySelector('.video-post__player');
        if (!playerContainer) {
            return;
        }
        if (!isValidMediaUrl(videoUrl)) {
            console.warn('VideoPost: Invalid media URL, skipping player creation', { videoUrl });
            return;
        }
        this.player = new NativeVideoPlayer(playerContainer, videoUrl, {
            muted: false, // Unmuted by default (markers don't have sound anyway)
            autoplay: false, // Will be controlled by VisibilityManager
            startTime: startTime || this.data.startTime,
            endTime: endTime || this.data.endTime,
        });
        // Hide thumbnail and loading
        const thumbnail = playerContainer.querySelector('.video-post__thumbnail');
        const loading = playerContainer.querySelector('.video-post__loading');
        if (thumbnail)
            thumbnail.style.display = 'none';
        if (loading)
            loading.style.display = 'none';
        this.isLoaded = true;
    }
    /**
     * Get the video player instance
     */
    getPlayer() {
        return this.player;
    }
    /**
     * Check if currently in HQ mode (using scene video)
     */
    isInHQMode() {
        return this.isHQMode;
    }
    /**
     * Register player with visibility manager after upgrade
     * Called by FeedContainer when player is upgraded
     */
    registerPlayerWithVisibilityManager(visibilityManager) {
        if (this.player && this.data.marker.id) {
            visibilityManager.registerPlayer(this.data.marker.id, this.player);
        }
    }
    /**
     * Get the post ID
     */
    getPostId() {
        return this.data.marker.id;
    }
    /**
     * Get the container element
     */
    getContainer() {
        return this.container;
    }
    /**
     * Destroy the post
     */
    destroy() {
        if (this.player) {
            this.player.destroy();
        }
        this.detachRatingGlobalListeners();
        this.container.remove();
    }
}
//# sourceMappingURL=VideoPost.js.map