/**
 * Utility functions
 */

/**
 * Throttle function calls
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  return function (this: any, ...args: Parameters<T>) {
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
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: number | null = null;
  return function (this: any, ...args: Parameters<T>) {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = window.setTimeout(() => {
      func.apply(this, args);
      timeoutId = null;
    }, delay);
  };
}

/**
 * Format duration in seconds to HH:MM:SS or MM:SS
 */
export function formatDuration(seconds: number): string {
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
export function calculateAspectRatio(width: number, height: number): number {
  return width / height;
}

/**
 * Get aspect ratio class name
 */
export function getAspectRatioClass(aspectRatio: number): string {
  if (aspectRatio > 1.5) {
    return 'aspect-16-9'; // Landscape
  } else if (aspectRatio < 0.7) {
    return 'aspect-9-16'; // Portrait
  } else {
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
 * Available utility function for future use if needed
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Shuffle array in-place using Fisher–Yates
 */
export function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = arr[i];
    arr[i] = arr[j]!;
    arr[j] = temp!;
  }
  return arr;
}

/**
 * Basic media URL sanity check to avoid assigning the app root as a video src
 */
export function isValidMediaUrl(url?: string): boolean {
  // Check for undefined, null, or empty string
  if (!url || typeof url !== 'string') return false;
  
  // Check for whitespace-only strings
  const trimmed = url.trim();
  if (trimmed.length === 0) return false;
  
  try {
    const absolute = trimmed.startsWith('http') ? trimmed : `${window.location.origin}${trimmed}`;
    const appRoot = `${window.location.origin}/plugin/stashgifs/assets/app/`;
    const appRootNoSlash = `${window.location.origin}/plugin/stashgifs/assets/app`;
    
    // Reject if URL equals origin or app root (with or without trailing slash)
    if (absolute === window.location.origin) return false;
    if (absolute === appRoot || absolute === appRootNoSlash) return false;
    
    // Reject URLs that start with app root path (more robust check)
    if (absolute.startsWith(appRoot) || absolute.startsWith(appRootNoSlash)) {
      // Only allow if there's additional path content after app root
      const remainingPath = absolute.replace(appRoot, '').replace(appRootNoSlash, '');
      if (!remainingPath || remainingPath.length === 0 || remainingPath === '/') {
        return false;
      }
    }
    
    // Reject URLs that end with just a slash (directory paths, not files)
    if (absolute.endsWith('/') && absolute !== `${window.location.origin}/`) return false;
    
    // Very short paths are suspicious (must have at least some path content)
    if (absolute.length < window.location.origin.length + 4) return false;
    
    // Check if URL appears to be a file path (has extension or query params)
    // Allow URLs with query parameters (e.g., streaming URLs with tokens)
    const hasQueryParams = absolute.includes('?');
    const hasFileExtension = /\.(mp4|webm|ogg|mov|avi|mkv|m3u8|ts|mpd)(\?|$|\/)/i.test(absolute);
    
    // If no query params and no file extension, it's likely not a valid media URL
    if (!hasQueryParams && !hasFileExtension) {
      // Allow streaming paths that might not have extensions (e.g., HLS playlists)
      const looksLikeStreamPath = /\/stream|\/video|\/media|\/play/i.test(absolute);
      if (!looksLikeStreamPath) return false;
    }
    
    return true;
  } catch {
    return false;
  }
}

/**
 * Show a toast notification
 */
export function showToast(message: string, duration: number = 2000): void {
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

/**
 * Device capability detection for adaptive media quality
 */
export interface DeviceCapabilities {
  isHighEnd: boolean;
  hasHighDPI: boolean;
  availableRAM: number; // in MB (estimated)
  recommendedVideoQuality: '480p' | '720p' | '1080p';
  recommendedThumbnailWidth: number;
}

/**
 * Detect device capabilities for adaptive media loading
 */
export function detectDeviceCapabilities(): DeviceCapabilities {
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const isTablet = /iPad|Android/i.test(navigator.userAgent) && !/Mobile/i.test(navigator.userAgent);
  
  // Detect high DPI display
  const hasHighDPI = window.devicePixelRatio > 1.5;
  
  // Estimate available RAM (rough heuristic)
  // Modern browsers don't expose RAM directly, so we use heuristics
  let estimatedRAM = 2048; // Default 2GB
  // deviceMemory is an experimental API, so we need to check and cast
  const nav = navigator as Navigator & { deviceMemory?: number };
  if (nav.deviceMemory) {
    estimatedRAM = nav.deviceMemory * 1024; // Convert GB to MB
  } else {
    // Heuristic based on user agent and screen size
    if (isMobile) {
      estimatedRAM = 2048; // Most modern phones have 4-8GB, but we'll be conservative
    } else if (isTablet) {
      estimatedRAM = 3072; // Tablets typically have more RAM
    } else {
      estimatedRAM = 4096; // Desktop typically has more RAM
    }
  }
  
  // Determine if high-end device
  const isHighEnd = estimatedRAM >= 3072 && hasHighDPI;
  
  // Recommend video quality based on device capabilities
  let recommendedQuality: '480p' | '720p' | '1080p' = '720p';
  if (estimatedRAM < 2048) {
    recommendedQuality = '480p'; // Low RAM devices
  } else if (estimatedRAM >= 4096 && !isMobile) {
    recommendedQuality = '1080p'; // High-end desktop
  } else {
    recommendedQuality = '720p'; // Default for most devices
  }
  
  // Recommend thumbnail width based on viewport and DPI
  const viewportWidth = window.innerWidth;
  const thumbnailWidth = Math.min(
    Math.ceil(viewportWidth * (hasHighDPI ? 1.5 : 1.0)),
    recommendedQuality === '1080p' ? 800 : recommendedQuality === '720p' ? 600 : 400
  );
  
  return {
    isHighEnd,
    hasHighDPI,
    availableRAM: estimatedRAM,
    recommendedVideoQuality: recommendedQuality,
    recommendedThumbnailWidth: thumbnailWidth,
  };
}

/**
 * Get optimized thumbnail URL with size parameters
 * Downsizes image before loading to reduce memory usage
 */
export function getOptimizedThumbnailUrl(baseUrl: string, maxWidth: number, maxHeight?: number): string {
  if (!baseUrl) return baseUrl;
  
  // If URL already has query parameters, append with &
  const separator = baseUrl.includes('?') ? '&' : '?';
  
  // Request specific dimensions to reduce memory footprint
  // Most image servers support width/height parameters
  const params = new URLSearchParams();
  params.set('w', maxWidth.toString());
  if (maxHeight) {
    params.set('h', maxHeight.toString());
  }
  params.set('fit', 'cover'); // Maintain aspect ratio with cover
  
  return `${baseUrl}${separator}${params.toString()}`;
}

/**
 * Convert a relative URL to an absolute URL
 * Handles both relative paths and already absolute URLs
 */
export function toAbsoluteUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return `${window.location.origin}${url}`;
  return `${window.location.origin}/${url}`;
}

// ============================================================================
// Browser API Type Guards
// ============================================================================

/**
 * Navigator with standalone property (iOS Safari)
 */
interface NavigatorStandalone extends Navigator {
  standalone?: boolean;
}

/**
 * Type guard for standalone navigator (iOS Safari app mode)
 */
export function isStandaloneNavigator(nav: Navigator): nav is NavigatorStandalone {
  return 'standalone' in nav;
}

/**
 * Element with webkit fullscreen methods
 */
export interface ElementWebkitFullscreen extends Element {
  webkitRequestFullscreen?: () => Promise<void>;
  webkitEnterFullscreen?: () => void;
}

/**
 * Element with moz fullscreen methods
 */
export interface ElementMozFullscreen extends Element {
  mozRequestFullscreen?: () => Promise<void>;
}

/**
 * Element with ms fullscreen methods
 */
export interface ElementMsFullscreen extends Element {
  msRequestFullscreen?: () => Promise<void>;
}

/**
 * Container with webkit fullscreen methods
 */
interface HTMLElementWebkitFullscreen extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void>;
}

/**
 * Container with moz fullscreen methods
 */
interface HTMLElementMozFullscreen extends HTMLElement {
  mozRequestFullscreen?: () => Promise<void>;
}

/**
 * Container with ms fullscreen methods
 */
interface HTMLElementMsFullscreen extends HTMLElement {
  msRequestFullscreen?: () => Promise<void>;
}

/**
 * Document with webkit fullscreen methods
 */
interface DocumentWebkitFullscreen extends Document {
  webkitExitFullscreen?: () => Promise<void>;
  webkitFullscreenElement?: Element | null;
}

/**
 * Document with moz fullscreen methods
 */
interface DocumentMozFullscreen extends Document {
  mozCancelFullscreen?: () => Promise<void>;
  mozFullScreenElement?: Element | null;
}

/**
 * Document with ms fullscreen methods
 */
interface DocumentMsFullscreen extends Document {
  msExitFullscreen?: () => Promise<void>;
  msFullscreenElement?: Element | null;
}

/**
 * Type guard for element with webkit fullscreen support
 */
export function hasWebkitFullscreen(element: Element): element is ElementWebkitFullscreen {
  return 'webkitRequestFullscreen' in element || 'webkitEnterFullscreen' in element;
}

/**
 * Type guard for element with moz fullscreen support
 */
export function hasMozFullscreen(element: Element): element is ElementMozFullscreen {
  return 'mozRequestFullscreen' in element;
}

/**
 * Type guard for element with ms fullscreen support
 */
export function hasMsFullscreen(element: Element): element is ElementMsFullscreen {
  return 'msRequestFullscreen' in element;
}

/**
 * Type guard for HTML element with webkit fullscreen support
 */
export function hasWebkitFullscreenHTMLElement(element: HTMLElement): element is HTMLElementWebkitFullscreen {
  return 'webkitRequestFullscreen' in element;
}

/**
 * Type guard for HTML element with moz fullscreen support
 */
export function hasMozFullscreenHTMLElement(element: HTMLElement): element is HTMLElementMozFullscreen {
  return 'mozRequestFullscreen' in element;
}

/**
 * Type guard for HTML element with ms fullscreen support
 */
export function hasMsFullscreenHTMLElement(element: HTMLElement): element is HTMLElementMsFullscreen {
  return 'msRequestFullscreen' in element;
}

/**
 * Type guard for document with webkit fullscreen support
 */
export function hasWebkitFullscreenDocument(doc: Document): doc is DocumentWebkitFullscreen {
  return 'webkitExitFullscreen' in doc || 'webkitFullscreenElement' in doc;
}

/**
 * Type guard for document with moz fullscreen support
 */
export function hasMozFullscreenDocument(doc: Document): doc is DocumentMozFullscreen {
  return 'mozCancelFullscreen' in doc || 'mozFullScreenElement' in doc;
}

/**
 * Type guard for document with ms fullscreen support
 */
export function hasMsFullscreenDocument(doc: Document): doc is DocumentMsFullscreen {
  return 'msExitFullscreen' in doc || 'msFullscreenElement' in doc;
}

/**
 * Check if fullscreen API is supported
 */
export function hasFullscreenSupport(element: Element): boolean {
  return !!(
    element.requestFullscreen ||
    hasWebkitFullscreen(element) ||
    hasMozFullscreen(element) ||
    hasMsFullscreen(element)
  );
}
