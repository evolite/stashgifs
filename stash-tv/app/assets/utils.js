/**
 * Utility functions
 */
/**
 * Throttle function calls
 */
export function throttle(func, delay) {
    let lastCall = 0;
    return function (...args) {
        const now = Date.now();
        if (now - lastCall >= delay) {
            lastCall = now;
            func.apply(this, args);
        }
    };
}
/**
 * Debounce function calls
 */
export function debounce(func, delay) {
    let timeoutId;
    return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
}
/**
 * Format duration in seconds to HH:MM:SS or MM:SS
 */
export function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}
/**
 * Calculate aspect ratio from width and height
 */
export function calculateAspectRatio(width, height) {
    return width / height;
}
/**
 * Get aspect ratio class name
 */
export function getAspectRatioClass(aspectRatio) {
    if (aspectRatio > 1.5) {
        return 'aspect-16-9'; // Landscape
    }
    else if (aspectRatio < 0.7) {
        return 'aspect-9-16'; // Portrait
    }
    else {
        return 'aspect-1-1'; // Square
    }
}
/**
 * Check if element is in viewport
 */
export function isInViewport(element, threshold = 0) {
    const rect = element.getBoundingClientRect();
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;
    const windowWidth = window.innerWidth || document.documentElement.clientWidth;
    return (rect.top >= -threshold &&
        rect.left >= -threshold &&
        rect.bottom <= windowHeight + threshold &&
        rect.right <= windowWidth + threshold);
}
/**
 * Create a unique ID
 */
export function generateId(prefix = 'post') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
/**
 * Shuffle array in-place using Fisher–Yates
 */
export function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}
/**
 * Basic media URL sanity check to avoid assigning the app root as a video src
 */
export function isValidMediaUrl(url) {
    if (!url)
        return false;
    try {
        const absolute = url.startsWith('http') ? url : `${window.location.origin}${url}`;
        const appRoot = `${window.location.origin}/plugin/stash-tv/assets/app/`;
        if (absolute === window.location.origin)
            return false;
        if (absolute === appRoot)
            return false;
        // Very short paths are suspicious
        if (absolute.length < window.location.origin.length + 4)
            return false;
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=utils.js.map