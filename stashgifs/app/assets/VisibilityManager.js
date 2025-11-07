/**
 * Visibility Manager
 * Handles video playback based on viewport visibility using Intersection Observer
 */
export class VisibilityManager {
    constructor(options) {
        // On mobile, use larger rootMargin to start loading videos earlier
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        const defaultRootMargin = isMobile ? '200px' : '50px';
        this.options = {
            threshold: options?.threshold ?? 0.5,
            rootMargin: options?.rootMargin ?? defaultRootMargin,
            autoPlay: options?.autoPlay ?? false,
            maxConcurrent: options?.maxConcurrent ?? 3,
        };
        this.entries = new Map();
        this.activeVideos = new Set();
        this.observer = new IntersectionObserver((intersectionEntries) => this.handleIntersection(intersectionEntries), {
            threshold: this.options.threshold,
            rootMargin: this.options.rootMargin,
        });
    }
    /**
     * Observe a post element
     */
    observePost(element, postId) {
        if (this.entries.has(postId)) {
            return;
        }
        this.entries.set(postId, {
            element,
            postId,
            isVisible: false,
        });
        this.observer.observe(element);
    }
    /**
     * Register a video player for a post
     */
    registerPlayer(postId, player) {
        const entry = this.entries.get(postId);
        if (entry) {
            entry.player = player;
        }
    }
    /**
     * Handle intersection changes
     */
    handleIntersection(entries) {
        for (const entry of entries) {
            const postId = this.findPostId(entry.target);
            if (!postId)
                continue;
            const visibilityEntry = this.entries.get(postId);
            if (!visibilityEntry)
                continue;
            const isVisible = entry.isIntersecting && entry.intersectionRatio >= this.options.threshold;
            const wasVisible = visibilityEntry.isVisible;
            visibilityEntry.isVisible = isVisible;
            if (isVisible && !wasVisible) {
                this.handlePostEnteredViewport(postId, visibilityEntry);
            }
            else if (!isVisible && wasVisible) {
                this.handlePostExitedViewport(postId, visibilityEntry);
            }
        }
    }
    findPostId(element) {
        // Traverse up to find the post container
        let current = element;
        while (current) {
            if (current.dataset.postId) {
                return current.dataset.postId;
            }
            current = current.parentElement;
        }
        return null;
    }
    handlePostEnteredViewport(postId, entry) {
        if (this.activeVideos.size >= this.options.maxConcurrent) {
            // Pause the oldest video
            const oldestId = Array.from(this.activeVideos)[0];
            this.pauseVideo(oldestId);
            this.activeVideos.delete(oldestId);
        }
        if (entry.player) {
            if (this.options.autoPlay) {
                // Robust play with multiple retries
                const tryPlay = async (attempt = 1, maxAttempts = 5) => {
                    if (!entry.player)
                        return;
                    try {
                        // On mobile, use shorter timeout and less strict readiness check
                        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
                        const timeout = isMobile ? 1000 : 3000;
                        // Wait for video to be ready (shorter timeout on mobile)
                        await entry.player.waitUntilCanPlay(timeout);
                        // Minimal delay on mobile, slightly longer on desktop
                        const delay = isMobile ? 10 : 50;
                        await new Promise(resolve => setTimeout(resolve, delay));
                        // Attempt to play
                        await entry.player.play();
                    }
                    catch (err) {
                        console.warn(`VisibilityManager: Play attempt ${attempt} failed`, { postId, error: err });
                        if (attempt < maxAttempts && entry.player) {
                            // Faster retries on mobile
                            const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
                            const baseDelay = isMobile ? 50 : 100;
                            const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), isMobile ? 800 : 1600);
                            setTimeout(() => {
                                if (entry.player) {
                                    tryPlay(attempt + 1, maxAttempts).catch(() => { });
                                }
                            }, delay);
                        }
                        else {
                            console.error('VisibilityManager: All play attempts failed', { postId, attempts: attempt });
                        }
                    }
                };
                // Start playing attempt immediately
                tryPlay().catch(() => { });
            }
            this.activeVideos.add(postId);
        }
        else {
            console.warn('VisibilityManager: No player registered for post', postId);
        }
    }
    handlePostExitedViewport(postId, entry) {
        if (entry.player) {
            entry.player.pause();
            this.activeVideos.delete(postId);
        }
    }
    pauseVideo(postId) {
        const entry = this.entries.get(postId);
        if (entry?.player) {
            entry.player.pause();
        }
    }
    /**
     * Unobserve a post
     */
    unobservePost(postId) {
        const entry = this.entries.get(postId);
        if (entry) {
            this.observer.unobserve(entry.element);
            if (entry.player) {
                entry.player.destroy();
            }
            this.entries.delete(postId);
            this.activeVideos.delete(postId);
        }
    }
    /**
     * Retry playing all currently visible videos
     * Useful for unlocking autoplay on mobile after user interaction
     */
    retryVisibleVideos() {
        for (const [postId, entry] of this.entries.entries()) {
            if (entry.isVisible && entry.player && !this.activeVideos.has(postId)) {
                // Try to play visible videos that aren't already playing
                entry.player.play().catch(() => {
                    // Silently fail - video will play on tap if needed
                });
                this.activeVideos.add(postId);
            }
        }
    }
    /**
     * Cleanup
     */
    cleanup() {
        this.observer.disconnect();
        for (const entry of this.entries.values()) {
            if (entry.player) {
                entry.player.destroy();
            }
        }
        this.entries.clear();
        this.activeVideos.clear();
    }
}
//# sourceMappingURL=VisibilityManager.js.map