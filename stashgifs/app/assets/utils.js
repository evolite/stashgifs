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
// Removed unused debounce helper
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
// Removed unused isInViewport helper
/**
 * Create a unique ID
 */
// Removed unused generateId helper
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
        const appRoot = `${window.location.origin}/plugin/stashgifs/assets/app/`;
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
/**
 * Show a toast notification
 */
export function showToast(message, duration = 2000) {
    // Remove existing toast if any
    const existing = document.querySelector('.toast-notification');
    if (existing) {
        existing.remove();
    }
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.textContent = message;
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.background = 'rgba(0, 0, 0, 0.9)';
    toast.style.color = '#fff';
    toast.style.padding = '12px 24px';
    toast.style.borderRadius = '8px';
    toast.style.fontSize = '14px';
    toast.style.zIndex = '10000';
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    toast.style.pointerEvents = 'none';
    toast.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
    document.body.appendChild(toast);
    // Animate in
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
    });
    // Remove after duration
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(10px)';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, duration);
}
//# sourceMappingURL=utils.js.map