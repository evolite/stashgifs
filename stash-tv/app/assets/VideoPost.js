/**
 * Video Post Component
 * Individual video post card in the feed
 */
import { NativeVideoPlayer } from './NativeVideoPlayer.js';
import { calculateAspectRatio, getAspectRatioClass, isValidMediaUrl } from './utils.js';
export class VideoPost {
    constructor(container, data) {
        this.isLoaded = false;
        this.container = container;
        this.data = data;
        this.thumbnailUrl = data.thumbnailUrl;
        this.render();
    }
    render() {
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
        // Tag badge (primary tag or first tag)
        const primaryTagName = (this.data.marker.primary_tag && this.data.marker.primary_tag.name)
            ? this.data.marker.primary_tag.name
            : (this.data.marker.tags && this.data.marker.tags.length > 0 ? this.data.marker.tags[0].name : undefined);
        if (primaryTagName) {
            const badge = document.createElement('div');
            badge.className = 'video-post__tag-badge';
            badge.textContent = primaryTagName;
            badge.style.position = 'absolute';
            badge.style.left = '8px';
            badge.style.top = '8px';
            badge.style.padding = '4px 8px';
            badge.style.borderRadius = '999px';
            badge.style.border = '1px solid rgba(255,255,255,0.25)';
            badge.style.background = 'rgba(0,0,0,0.5)';
            badge.style.backdropFilter = 'blur(6px)';
            badge.style.fontSize = '12px';
            badge.style.lineHeight = '1';
            badge.style.color = 'inherit';
            badge.style.pointerEvents = 'none';
            container.appendChild(badge);
        }
        return container;
    }
    createFooter() {
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
        // Tag chips (marker tags) next to performers
        if (this.data.marker.tags && this.data.marker.tags.length > 0) {
            for (const tag of this.data.marker.tags) {
                const chip = document.createElement('a');
                chip.className = 'chip chip--tag';
                chip.href = this.getTagLink(tag.id);
                chip.target = '_blank';
                chip.rel = 'noopener noreferrer';
                chip.appendChild(document.createTextNode(tag.name));
                chips.appendChild(chip);
            }
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
    getSceneLink() {
        const s = this.data.marker.scene;
        // Always link to the local Stash scene route
        return `${window.location.origin}/scenes/${s.id}`;
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
            muted: true, // Always muted for autoplay
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
        this.container.remove();
    }
}
//# sourceMappingURL=VideoPost.js.map