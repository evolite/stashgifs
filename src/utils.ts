/**
 * Utility functions
 */

import { Image } from './types.js';

export const THEME_DEFAULTS = {
  backgroundPrimary: '#1F2A33',
  backgroundSecondary: '#24323C',
  surface: '#2C3B46',
  accentPrimary: '#4FA3D1',
};

export const THEME = {
  colors: {
    backgroundPrimary: THEME_DEFAULTS.backgroundPrimary,
    backgroundSecondary: THEME_DEFAULTS.backgroundSecondary,
    surface: THEME_DEFAULTS.surface,
    border: '#3A4A55',
    textPrimary: '#E6EEF4',
    textSecondary: '#B4C0C9',
    textMuted: '#8A99A6',
    accentPrimary: THEME_DEFAULTS.accentPrimary,
    ratingHigh: '#E53935',
    ratingMedium: '#F39C12',
    ratingLow: '#F1C40F',
    success: '#2ECC71',
    iconInactive: '#9FB0BC',
    iconActive: '#E6EEF4',
    overlay: 'rgba(31, 42, 51, 0.96)',
    overlayMuted: 'rgba(36, 50, 60, 0.96)',
    surfaceHover: '#324351',
  },
  typography: {
    fontFamily: '"Manrope", "Space Grotesk", "Sora", system-ui, -apple-system, "Segoe UI", sans-serif',
    lineHeight: '1.5',
    lineHeightTight: '1.4',
    sizeTitle: '16px',
    sizeBody: '14px',
    sizeMeta: '12px',
    sizeControl: '13px',
    weightTitle: '600',
    weightBody: '400',
    weightBodyStrong: '500',
    weightMeta: '400',
  },
  spacing: {
    cardPadding: '14px',
    cardGap: '16px',
  },
  radius: {
    card: '8px',
    button: '6px',
    tag: '4px',
  },
  icon: {
    size: '16px',
    sizeLarge: '18px',
  },
};

/**
 * Throttle function calls
 */
export function throttle<T extends (...args: never[]) => unknown>(
  func: T,
  delay: number
): T {
  let lastCall = 0;
  return ((...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      func(...args);
    }
  }) as T;
}

/**
 * Debounce function calls
 */
export function debounce<T extends (...args: never[]) => unknown>(
  func: T,
  delay: number
): T {
  let timeoutId: number | null = null;
  return ((...args: Parameters<T>) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = (globalThis.setTimeout(() => {
      func(...args);
      timeoutId = null;
    }, delay) as unknown as number);
  }) as T;
}

const windowScrollSubscribers = new Set<() => void>();
let windowScrollRafId: number | undefined;
let windowScrollListenerAttached = false;
const windowScrollListener = () => {
  if (windowScrollRafId !== undefined) {
    return;
  }
  const requestFrame = globalThis.requestAnimationFrame?.bind(globalThis) ?? ((cb: FrameRequestCallback) => globalThis.setTimeout(cb, 16));
  windowScrollRafId = requestFrame(() => {
    windowScrollRafId = undefined;
    const handlers = Array.from(windowScrollSubscribers);
    for (const handler of handlers) {
      try {
        handler();
      } catch (error) {
        console.error('Window scroll handler failed', error);
      }
    }
  });
};

export function subscribeWindowScroll(handler: () => void): () => void {
  windowScrollSubscribers.add(handler);
  if (!windowScrollListenerAttached && typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('scroll', windowScrollListener, { passive: true });
    windowScrollListenerAttached = true;
  }
  return () => {
    windowScrollSubscribers.delete(handler);
    if (windowScrollSubscribers.size === 0 && windowScrollListenerAttached && typeof globalThis.removeEventListener === 'function') {
      globalThis.removeEventListener('scroll', windowScrollListener);
      windowScrollListenerAttached = false;
      if (windowScrollRafId !== undefined) {
        const cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis) ?? ((id: number) => globalThis.clearTimeout(id));
        cancelFrame(windowScrollRafId);
        windowScrollRafId = undefined;
      }
    }
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
  toast.style.background = THEME.colors.overlay;
  toast.style.color = THEME.colors.textPrimary;
  toast.style.padding = '12px 24px';
  toast.style.borderRadius = THEME.radius.button;
  toast.style.fontSize = THEME.typography.sizeBody;
  toast.style.fontFamily = THEME.typography.fontFamily;
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
        toast.remove();
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
  const isMobile = isMobileDevice();
  const isTablet = /iPad|Android/i.test(navigator.userAgent) && !/Mobile/i.test(navigator.userAgent);
  
  // Detect high DPI display
  const hasHighDPI = globalThis.devicePixelRatio > 1.5;
  
  // Estimate available RAM (rough heuristic)
  // Modern browsers don't expose RAM directly, so we use heuristics
  // deviceMemory is an experimental API, so we need to check and cast
  const nav = navigator as Navigator & { deviceMemory?: number };
  let estimatedRAM: number;
  if (nav.deviceMemory) {
    estimatedRAM = nav.deviceMemory * 1024; // Convert GB to MB
  } else if (isMobile) {
    estimatedRAM = 2048; // Most modern phones have 4-8GB, but we'll be conservative
  } else if (isTablet) {
    estimatedRAM = 3072; // Tablets typically have more RAM
  } else {
    estimatedRAM = 4096; // Desktop typically has more RAM
  }
  
  // Determine if high-end device
  const isHighEnd = estimatedRAM >= 3072 && hasHighDPI;
  
  // Recommend video quality based on device capabilities
  let recommendedQuality: '480p' | '720p' | '1080p';
  if (estimatedRAM < 2048) {
    recommendedQuality = '480p'; // Low RAM devices
  } else if (estimatedRAM >= 4096 && !isMobile) {
    recommendedQuality = '1080p'; // High-end desktop
  } else {
    recommendedQuality = '720p'; // Default for most devices
  }
  
  // Recommend thumbnail width based on viewport and DPI
  const viewportWidth = globalThis.innerWidth;
  let thumbnailWidth: number;
  if (recommendedQuality === '1080p') {
    thumbnailWidth = 800;
  } else if (recommendedQuality === '720p') {
    thumbnailWidth = 600;
  } else {
    thumbnailWidth = 400;
  }
  const finalThumbnailWidth = Math.min(
    Math.ceil(viewportWidth * (hasHighDPI ? 1.5 : 1)),
    thumbnailWidth
  );
  
  return {
    isHighEnd,
    hasHighDPI,
    availableRAM: estimatedRAM,
    recommendedVideoQuality: recommendedQuality,
    recommendedThumbnailWidth: finalThumbnailWidth,
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
  try {
    return new URL(url, globalThis.location.origin).toString();
  } catch {
    try {
      return new URL(encodeURI(url), globalThis.location.origin).toString();
    } catch {
      if (/^https?:\/\//i.test(url)) return url;
      if (url.startsWith('/')) return `${globalThis.location.origin}${url}`;
      return `${globalThis.location.origin}/${url}`;
    }
  }
}

/**
 * Normalize media URL to a safe absolute URL
 */
export function normalizeMediaUrl(url?: string): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return trimmed;
  try {
    return new URL(trimmed, globalThis.location.origin).toString();
  } catch {
    try {
      return new URL(encodeURI(trimmed), globalThis.location.origin).toString();
    } catch {
      return undefined;
    }
  }
}

/**
 * Add cache-busting query parameter to a URL to prevent 304 responses with empty/corrupted cache
 * @param url - The URL to add cache-busting to
 * @returns URL with cache-busting timestamp parameter
 */
export function addCacheBusting(url: string): string {
  if (!url) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}t=${Date.now()}`;
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

/**
 * Cached mobile device detection result
 */
let cachedIsMobile: boolean | null = null;

/**
 * Detect if the current device is a mobile device
 * Uses both user agent detection and feature detection for reliability
 * Result is cached to avoid repeated checks
 */
export function isMobileDevice(): boolean {
  if (cachedIsMobile !== null) {
    return cachedIsMobile;
  }

  // Feature detection: check for touch support
  const hasTouchSupport = 'ontouchstart' in globalThis || navigator.maxTouchPoints > 0;

  // User agent detection
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const isMobileUA = /iPhone|iPad|iPod|Android/i.test(userAgent);

  // Consider it mobile if either check is true
  cachedIsMobile = hasTouchSupport || isMobileUA;

  return cachedIsMobile;
}

/**
 * Detect if the current device is an iOS device
 */
export function isIOSDevice(): boolean {
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return /iPhone|iPad|iPod/i.test(userAgent);
}

/**
 * Detect if the current device is an Android device
 */
export function isAndroidDevice(): boolean {
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return /Android/i.test(userAgent);
}

/**
 * Network information interface for adaptive buffering
 */
export interface NetworkInfo {
  effectiveType?: 'slow-2g' | '2g' | '3g' | '4g';
  downlink?: number; // Mbps
  saveData?: boolean;
  type?: 'bluetooth' | 'cellular' | 'ethernet' | 'none' | 'wifi' | 'wimax' | 'other' | 'unknown';
}

/**
 * NetworkInformation API interface (experimental)
 * Used for network-aware optimizations
 */
interface NetworkInformation {
  effectiveType?: 'slow-2g' | '2g' | '3g' | '4g';
  downlink?: number;
  saveData?: boolean;
  type?: 'bluetooth' | 'cellular' | 'ethernet' | 'none' | 'wifi' | 'wimax' | 'other' | 'unknown';
}

/**
 * Get network information if available
 * Uses the NetworkInformation API when supported
 */
export function getNetworkInfo(): NetworkInfo | null {
  if (typeof navigator === 'undefined') {
    return null;
  }

  const connection = (navigator as Navigator & { connection?: NetworkInformation; mozConnection?: NetworkInformation; webkitConnection?: NetworkInformation }).connection ||
                     (navigator as Navigator & { connection?: NetworkInformation; mozConnection?: NetworkInformation; webkitConnection?: NetworkInformation }).mozConnection ||
                     (navigator as Navigator & { connection?: NetworkInformation; mozConnection?: NetworkInformation; webkitConnection?: NetworkInformation }).webkitConnection;

  if (!connection) {
    return null;
  }

  return {
    effectiveType: connection.effectiveType,
    downlink: connection.downlink,
    saveData: connection.saveData,
    type: connection.type,
  };
}

/**
 * Check if network connection is slow
 * Returns true if effectiveType is 'slow-2g' or '2g', or if saveData is enabled
 */
export function isSlowNetwork(): boolean {
  const networkInfo = getNetworkInfo();
  if (!networkInfo) {
    return false;
  }

  if (networkInfo.saveData) {
    return true;
  }

  return networkInfo.effectiveType === 'slow-2g' || networkInfo.effectiveType === '2g';
}

/**
 * Check if network connection is cellular
 */
export function isCellularConnection(): boolean {
  const networkInfo = getNetworkInfo();
  if (!networkInfo) {
    return false;
  }

  return networkInfo.type === 'cellular';
}

/**
 * Image codecs that should be treated as images (not videos)
 * These codecs may have animation but should be displayed as images
 */
export const IMAGE_CODECS = ['gif', 'webp', 'apng', 'avif', 'heic', 'heif'] as const;

/**
 * Image file extensions that should always be displayed as images (not videos)
 * Even if they have animation or video-like properties
 */
const IMAGE_EXTENSIONS = [
  '.gif', '.png', '.jpg', '.jpeg', '.webp', '.avif', 
  '.apng', '.heic', '.heif', '.bmp', '.svg', '.ico'
] as const;

/**
 * Video file extensions that should be rendered as looping videos
 */
const VIDEO_EXTENSIONS = [
  '.m4v', '.mp4', '.wmv', '.avi', '.mpg', '.mpeg',
  '.rmvb', '.rm', '.flv', '.asf', '.mkv', '.webm',
  '.f4v', '.mov', '.ogv', '.3gp', '.ts', '.m2v'
] as const;

/**
 * Check if a URL points to an image file that should always be displayed as an image
 * @param url The URL to check
 * @returns true if the URL ends with an image extension
 */
export function isImageFile(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  return IMAGE_EXTENSIONS.some(ext => lowerUrl.endsWith(ext));
}

/**
 * Check if a URL points to a video file based on extension
 * @param url The URL to check
 * @returns true if the URL ends with a video extension
 */
export function isVideoFile(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  return VIDEO_EXTENSIONS.some(ext => lowerUrl.endsWith(ext));
}

/**
 * Check if a codec is an image codec (should be treated as image, not video)
 * @param codec The codec string to check
 * @returns true if the codec is an image codec
 */
export function isImageCodec(codec: string): boolean {
  return IMAGE_CODECS.includes(codec.toLowerCase() as typeof IMAGE_CODECS[number]);
}

/**
 * Check if a codec is a video codec (not an image codec)
 * @param codec The codec string to check
 * @returns true if the codec is a video codec
 */
export function isVideoCodec(codec: string): boolean {
  return !isImageCodec(codec);
}

/**
 * Detect if visualFiles indicates a video (has video_codec that's not an image codec)
 * @param visualFiles Array of visual file information
 * @returns Object with isVideo boolean and the video file if found
 */
export function detectVideoFromVisualFiles(visualFiles?: Array<{
  path?: string;
  video_codec?: string;
  duration?: number;
}>): { isVideo: boolean; videoFile?: { path?: string; video_codec?: string } } {
  if (!visualFiles) {
    return { isVideo: false };
  }

  const videoFile = visualFiles.find(vf => vf.video_codec);
  if (!videoFile?.video_codec) {
    return { isVideo: false };
  }

  const codec = videoFile.video_codec.toLowerCase();
  const isVideo = !isImageCodec(codec);

  return {
    isVideo,
    videoFile: isVideo ? videoFile : undefined,
  };
}

/**
 * Check if a file path is an MP4 or M4V file
 * @param path The file path to check
 * @returns true if the path ends with .mp4 or .m4v
 */
export function isMp4File(path?: string): boolean {
  if (!path) {
    return false;
  }
  const filePath = path.toLowerCase();
  return filePath.endsWith('.mp4') || filePath.endsWith('.m4v');
}

/**
 * Get the appropriate image URL for display based on image data and settings
 * @param image The image data
 * @param treatMp4AsVideo Whether MP4/M4V files should be treated as videos (use paths.image) or images (use paths.preview)
 * @returns The URL to use for display, or undefined if no valid URL found
 */
/**
 * Build full URL from path
 */
function buildFullUrl(path: string, baseUrl: string): string {
  try {
    return new URL(path, baseUrl).toString();
  } catch {
    try {
      return new URL(encodeURI(path), baseUrl).toString();
    } catch {
      return path.startsWith('http') ? path : `${baseUrl}${path}`;
    }
  }
}

/**
 * Try to get a valid URL from a path
 */
function tryGetUrlFromPath(path: string | undefined | null, baseUrl: string): string | undefined {
  if (!path) return undefined;
  const url = buildFullUrl(path, baseUrl);
  return normalizeMediaUrl(url) ?? undefined;
}

/**
 * Get URL for MP4 video files
 */
function getMp4VideoUrl(image: Image, videoFile: { path?: string }, baseUrl: string): string | undefined {
  if (!videoFile.path || !isMp4File(videoFile.path)) return undefined;
  const videoPath = videoFile.path;
  if (/^https?:\/\//i.test(videoPath)) {
    return tryGetUrlFromPath(videoPath, baseUrl);
  }
  if (image.paths?.image) {
    return tryGetUrlFromPath(image.paths.image, baseUrl);
  }
  return undefined;
}

/**
 * Get URL for video preview (WebM)
 */
function getVideoPreviewUrl(image: Image, baseUrl: string): string | undefined {
  return tryGetUrlFromPath(image.paths?.preview, baseUrl);
}

/**
 * Get URL for regular images (tries image, preview, thumbnail in order)
 */
function getImageUrl(image: Image, baseUrl: string): string | undefined {
  return tryGetUrlFromPath(image.paths?.image, baseUrl) ||
         tryGetUrlFromPath(image.paths?.preview, baseUrl) ||
         tryGetUrlFromPath(image.paths?.thumbnail, baseUrl);
}

export function getImageUrlForDisplay(image: Image, treatMp4AsVideo: boolean): string | undefined {
  const baseUrl = globalThis.location.origin;
  
  // Detect if this is a video from visualFiles
  const { isVideo, videoFile } = detectVideoFromVisualFiles(image.visualFiles);
  
  // For .m4v and .mp4 files, use the actual video file path if treatMp4AsVideo is enabled
  if (isVideo && videoFile?.path && treatMp4AsVideo) {
    const mp4Url = getMp4VideoUrl(image, videoFile, baseUrl);
    if (mp4Url) return mp4Url;
  }

  // For other videos, use preview path (WebM)
  if (isVideo) {
    const previewUrl = getVideoPreviewUrl(image, baseUrl);
    if (previewUrl) return previewUrl;
  }

  // For regular images, try paths.image first, then paths.preview, then paths.thumbnail
  return getImageUrl(image, baseUrl);
}

/**
 * Setup a video element for looping playback (like GIFs)
 * Configures loop, muted, autoplay, playsInline, and mobile attributes
 * @param videoElement The video element to configure
 */
export function setupLoopingVideoElement(
  videoElement: HTMLVideoElement,
  options?: { objectFit?: 'cover' | 'contain' }
): void {
  // Basic looping video properties
  videoElement.loop = true;
  videoElement.muted = true;
  videoElement.autoplay = true;
  videoElement.playsInline = true;
  videoElement.style.objectFit = options?.objectFit ?? 'cover';
  videoElement.style.width = '100%';
  videoElement.style.height = '100%';
  videoElement.style.display = 'block';
  
  // Mobile-specific attributes (reused from NativeVideoPlayer patterns)
  videoElement.setAttribute('playsinline', 'true');
  videoElement.setAttribute('webkit-playsinline', 'true');
  videoElement.setAttribute('x5-playsinline', 'true');
  videoElement.setAttribute('x-webkit-airplay', 'allow');
  
  // Prevent video element from receiving focus
  videoElement.setAttribute('tabindex', '-1');
}
