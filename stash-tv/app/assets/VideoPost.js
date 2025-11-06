/**
 * Video Post Component
 * Individual video post card in the feed
 */
import { NativeVideoPlayer } from './NativeVideoPlayer.js';
import { escapeHtml, formatDuration, calculateAspectRatio, getAspectRatioClass } from './utils.js';
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
    createHeader() {
        const header = document.createElement('div');
        header.className = 'video-post__header';
        // Marker title
        if (this.data.marker.title) {
            const title = document.createElement('h3');
            title.className = 'video-post__title';
            title.textContent = this.data.marker.title;
            header.appendChild(title);
        }
        // Scene title
        if (this.data.marker.scene.title) {
            const sceneTitle = document.createElement('div');
            sceneTitle.className = 'video-post__scene-title';
            sceneTitle.textContent = this.data.marker.scene.title;
            header.appendChild(sceneTitle);
        }
        // Scene date
        if (this.data.marker.scene.date) {
            const date = document.createElement('span');
            date.className = 'video-post__date';
            date.textContent = new Date(this.data.marker.scene.date).toLocaleDateString();
            header.appendChild(date);
        }
        return header;
    }
    createPlayerContainer() {
        const container = document.createElement('div');
        container.className = 'video-post__player';
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
    createFooter() {
        const footer = document.createElement('div');
        footer.className = 'video-post__footer';
        // Scene info
        const info = document.createElement('div');
        info.className = 'video-post__info';
        // Primary tag (marker-specific)
        if (this.data.marker.primary_tag) {
            const primaryTag = document.createElement('div');
            primaryTag.className = 'video-post__primary-tag';
            primaryTag.innerHTML = `<strong>Category:</strong> ${escapeHtml(this.data.marker.primary_tag.name)}`;
            info.appendChild(primaryTag);
        }
        // Marker time range
        if (this.data.startTime !== undefined) {
            const timeRange = document.createElement('div');
            timeRange.className = 'video-post__time-range';
            const startTime = formatDuration(this.data.startTime);
            const endTime = this.data.endTime ? formatDuration(this.data.endTime) : '';
            timeRange.textContent = `Time: ${startTime}${endTime ? ` - ${endTime}` : ''}`;
            info.appendChild(timeRange);
        }
        // Performers (from scene)
        if (this.data.marker.scene.performers && this.data.marker.scene.performers.length > 0) {
            const performers = document.createElement('div');
            performers.className = 'video-post__performers';
            const performerNames = this.data.marker.scene.performers.map(p => escapeHtml(p.name)).join(', ');
            performers.innerHTML = `<strong>Performers:</strong> ${performerNames}`;
            info.appendChild(performers);
        }
        // Studio
        if (this.data.marker.scene.studio) {
            const studio = document.createElement('div');
            studio.className = 'video-post__studio';
            studio.innerHTML = `<strong>Studio:</strong> ${escapeHtml(this.data.marker.scene.studio.name)}`;
            info.appendChild(studio);
        }
        // Tags (from marker)
        if (this.data.marker.tags && this.data.marker.tags.length > 0) {
            const tags = document.createElement('div');
            tags.className = 'video-post__tags';
            const tagNames = this.data.marker.tags.slice(0, 5).map(t => escapeHtml(t.name)).join(', ');
            tags.innerHTML = `<strong>Tags:</strong> ${tagNames}${this.data.marker.tags.length > 5 ? '...' : ''}`;
            info.appendChild(tags);
        }
        footer.appendChild(info);
        return footer;
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
        this.player = new NativeVideoPlayer(playerContainer, videoUrl, {
            muted: false,
            autoplay: false,
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